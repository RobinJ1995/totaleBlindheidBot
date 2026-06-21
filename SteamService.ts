import SteamUser from 'steam-user';
import SteamTotp from 'steam-totp';
import TelegramBot from 'node-telegram-bot-api';
import UserDAO, { UserSettings } from './dao/UserDAO.js';
import ChatDAO, { ChatSettings } from './dao/ChatDAO.js';
import GameUpdateDAO, { GameUpdate } from './dao/GameUpdateDAO.js';
import GameHistoryDAO, { CurrentMatch, GameHistoryEntry, GameHistoryCoPlayer } from './dao/GameHistoryDAO.js';
import RollcallPlayerDAO from './dao/RollcallPlayerDAO.js';
import { escapeMarkdown } from './utils.js';
import { parseMention } from './rsvp.js';
import { saveSteamFile, readSteamFile } from './dao/Database.js';

// A finished match with no further score progress is recorded once it has been idle
// (CS2 not running, score unchanged) for this long. Overridable for tests.
const MATCH_IDLE_MS = Number(process.env.MATCH_IDLE_MS) || 10 * 60 * 1000;

// How often the idle-match sweep runs. Overridable for tests.
const MATCH_SWEEP_MS = Number(process.env.MATCH_SWEEP_MS) || 60 * 1000;

// How far a freshly reported round-total may dip below the running match total before we
// treat it as a brand new match rather than out-of-order update noise.
const RESET_TOLERANCE = 2;

interface GameUpdateInfo {
    gameId?: string | number;
    map?: string;
    status?: string;
    score?: string;
}

interface SteamRichPresenceItem {
    key: string;
    value: string;
}

interface SteamUserUpdate {
    player_name?: string;
    persona_name?: string;
    gameid?: string | number;
    rich_presence?: SteamRichPresenceItem[] | Record<string, string>;
    rich_presence_string?: string;
    game_played_app_id?: number | null;
    online_session_instances?: number | null;
}

class SteamService {
    private bot: TelegramBot;
    private client: SteamUser; // Initialize in constructor
    private userDao: UserDAO;
    private chatDao: ChatDAO;
    private gameUpdateDao: GameUpdateDAO;
    private gameHistoryDao: GameHistoryDAO;
    private rollcallPlayerDao: RollcallPlayerDAO;
    private steamToTelegram: Record<string, number>;
    private appIdCS2: number;
    private steamGuardCallback: ((code: string) => void) | null;
    private telegramNameCache: Record<string, { name: string; fetchedAt: number }> = {};
    // Serialises read-modify-write of a (chat,user)'s match buffer so rapidly-arriving
    // presence updates can't race (a score reset finalising before a continuation persists).
    private matchLocks: Record<string, Promise<unknown>> = {};
    private friendsListLoaded: boolean = false;
    private adminUserId: string | undefined;
    private updateInterval: NodeJS.Timeout | null;
    private matchSweepInterval: NodeJS.Timeout | null;
    private reconnectTimer: NodeJS.Timeout | null;
    private logOnOptions: any;
    private sharedSecret: string | undefined;
    public static instance: SteamService | null = null;

    constructor(bot: TelegramBot) {
        this.bot = bot;

        // Where the steam-user library persists its own session/sentry files.
        const backend = (process.env.STEAM_STORAGE_BACKEND || 'filesystem').toLowerCase();
        if (backend === 'database') {
            console.log('Using database storage for Steam data.');
            this.client = new SteamUser({ dataDirectory: 'data' });
            this.client.storage.on('save', (filename: string, contents: Buffer, callback: (err: Error | null) => void) => {
                saveSteamFile(`steam-user/${filename}`, contents)
                    .then(() => callback(null))
                    .catch(err => callback(err));
            });
            this.client.storage.on('read', (filename: string, callback: (err: Error | null, content?: any) => void) => {
                readSteamFile(`steam-user/${filename}`)
                    .then(contents => callback(null, contents))
                    .catch(err => callback(err));
            });
        } else {
            // filesystem (default): persist to a fixed directory so a mounted volume keeps the
            // session across restarts, independent of $HOME.
            this.client = new SteamUser({ dataDirectory: process.env.STEAM_DATA_DIRECTORY || 'data' });
        }

        this.userDao = new UserDAO();
        this.chatDao = new ChatDAO();
        this.gameUpdateDao = new GameUpdateDAO();
        this.gameHistoryDao = new GameHistoryDAO();
        this.rollcallPlayerDao = new RollcallPlayerDAO();
        this.steamToTelegram = {};
        this.appIdCS2 = 730;
        this.steamGuardCallback = null;
        this.adminUserId = process.env.STEAM_ADMIN_TELEGRAM_USER_ID;
        this.updateInterval = null;
        this.matchSweepInterval = null;
        this.reconnectTimer = null;
        this.logOnOptions = null;
        this.sharedSecret = undefined;
        SteamService.instance = this;
    }

    start(): void {
        const username = process.env.STEAM_USERNAME;
        const password = process.env.STEAM_PASSWORD;
        const sharedSecret = process.env.STEAM_SHARED_SECRET;

        console.log(`Starting SteamService for user: ${username}`);

        if (!username || !password) {
            console.warn('STEAM_USERNAME or STEAM_PASSWORD not set. SteamService will not start.');
            return;
        }

        this.sharedSecret = sharedSecret;
        this.logOnOptions = {
            accountName: username,
            password: password
        };

        if (this.sharedSecret) {
            this.logOnOptions.twoFactorCode = SteamTotp.generateAuthCode(this.sharedSecret);
        }

        this.client.logOn(this.logOnOptions);

        this.client.on('loggedOn', () => {
            console.log(`Logged on to Steam as ${this.client.steamID?.getSteamID64()}`);
            this.client.setPersona(SteamUser.EPersonaState.Online);
            this.updateUserMappings();
        });

        this.client.on('friendsList', () => {
            console.log(`Friends list loaded. Bot has ${Object.keys(this.client.myFriends).length} friends.`);
            this.friendsListLoaded = true;
            this.updateUserMappings();
        });

        this.client.on('steamGuard', (domain: string | null, callback: (code: string) => void, lastCodeWrong: boolean) => {
            if (lastCodeWrong) {
                console.error('Last Steam Guard code was wrong.');
                if (this.adminUserId) {
                    this.bot.sendMessage(this.adminUserId, 'Last Steam Guard code was wrong. Please try again with /steam_guard <code>')
                        .catch(err => console.error('Failed to send error to admin:', err));
                }
            }
            if (this.sharedSecret) {
                callback(SteamTotp.generateAuthCode(this.sharedSecret));
            } else {
                this.steamGuardCallback = callback;
                const method = domain ? `email to ${domain}` : 'mobile app';
                console.warn(`Steam Guard code needed (${method}). Please use /steam_guard <code>.`);
                if (this.adminUserId) {
                    this.bot.sendMessage(this.adminUserId, `Steam Guard code needed (${method}). Please use /steam_guard <code> to log in.`)
                        .catch(err => console.error('Failed to notify admin:', err));
                } else {
                    console.warn('Set STEAM_ADMIN_TELEGRAM_USER_ID to your Telegram user ID to receive these notifications directly in Telegram.');
                }
            }
        });

        this.client.on('error', (err: any) => {
            console.error('Steam fatal error (will reconnect):', err);
            if (this.adminUserId) {
                this.bot.sendMessage(this.adminUserId, `Steam fatal error: ${err.message ?? err}. Reconnecting in 30s...`)
                    .catch(() => {});
            }
            this.reconnect();
        });

        this.client.on('disconnected', (eresult: any, msg?: string) => {
            console.warn(`Steam disconnected (eresult=${eresult}${msg ? ', ' + msg : ''}). Library auto-reconnect is active.`);
        });

        this.client.on('user', (sid: any, user: any) => {
            this.handleUserUpdate(sid.getSteamID64(), user);
        });

        // Periodically update mappings in case new users register
        this.updateInterval = setInterval(() => this.updateUserMappings(), 60000);

        // Finalise matches that have gone idle (the last match of a play session has no
        // following reset to close it).
        this.matchSweepInterval = setInterval(() => {
            this.sweepIdleMatches().catch(err => console.error('Error sweeping idle matches:', err));
        }, MATCH_SWEEP_MS);
    }

    private reconnect(delayMs = 30_000): void {
        if (this.reconnectTimer) return;
        console.warn(`Steam: scheduling reconnect in ${delayMs / 1000}s...`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.sharedSecret) {
                this.logOnOptions.twoFactorCode = SteamTotp.generateAuthCode(this.sharedSecret);
            }
            console.log('Steam: attempting reconnect...');
            this.client.logOn(this.logOnOptions);
        }, delayMs);
    }

    stop(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        if (this.matchSweepInterval) {
            clearInterval(this.matchSweepInterval);
            this.matchSweepInterval = null;
        }
        this.client.logOff();
    }

    async updateUserMappings(): Promise<void> {
        try {
            const settings = await this.userDao.getAllUserSettings();
            const newMappings: Record<string, number> = {};
            const steamIds: string[] = [];
            for (const [tgId, data] of Object.entries<UserSettings>(settings)) {
                const sids = data.steam_ids || [];
                for (const steamId of sids) {
                    newMappings[steamId] = Number(tgId);
                    steamIds.push(steamId);

                    if (this.friendsListLoaded && this.client.myFriends && this.client.myFriends[steamId] !== SteamUser.EFriendRelationship.Friend) {
                        console.warn(`Tracked user ${tgId} (Steam ID: ${steamId}) is NOT a friend of the bot account. Updates might not work.`);
                    }
                }
            }
            this.steamToTelegram = newMappings;
            console.log(`Updated user mappings. Tracking ${steamIds.length} Steam users: ${steamIds.join(', ')}`);
            if (steamIds.length > 0 && this.client.steamID) {
                this.client.getPersonas(steamIds);
            }
        } catch (err) {
            console.error('Error updating user mappings:', err);
        }
    }

    async handleUserUpdate(steamId: string, user: SteamUserUpdate): Promise<void> {
        /* Example user update format for CS2:
           ... (omitted docs) ...
         */
        const playerName: string = user.player_name || user.persona_name || 'Unknown';
        const gameId: string | number | undefined = user.gameid;
        
        const tgUserId = this.steamToTelegram[steamId];
        if (!tgUserId) {
            console.debug(`Received Steam update for non-tracked user: ${playerName} (${steamId})`);
            return;
        }

        if (process.env.LOG_DEBUG) {
            console.debug(`Received Steam update for tracked user: ${playerName} (${steamId}).`, { gameId, ...user });
        } else {
            console.debug(`Received Steam update for tracked user: ${playerName} (${steamId}).`, { gameId, game_played_app_id: user?.game_played_app_id, online_session_instances: user?.online_session_instances, rich_presence: user?.rich_presence });
        }

        // Check if playing CS2
        const isPlayingCS2 = gameId == this.appIdCS2;
        if (!isPlayingCS2) {
            if (gameId) {
                console.debug(`User ${playerName} (${steamId}) is playing something else (ID: ${gameId}), ignoring.`);
            } else {
                console.debug(`User ${playerName} (${steamId}) is not playing anything, ignoring.`);
            }

            const chats = await this.userDao.getUserChats(tgUserId);
            for (const chatId of chats) {
                // The match (if any) is not over yet — a relaunch may continue it. Just mark
                // it idle so the periodic sweep can finalise it after the idle window.
                await this.markMatchNotPlaying(chatId, tgUserId);
                await this.maybeCloseSession(chatId, tgUserId);
            }
            return;
        }

        console.debug(`User update: ${playerName} (${steamId}) is playing CS2`);

        // Extract game info from rich presence
        let map: string | undefined, status: string | undefined, score: string | undefined, mode: string | undefined;
        const rp = user.rich_presence;
        if (Array.isArray(rp)) {
            map = rp.find((i: SteamRichPresenceItem) => i.key === 'game:map' || i.key === 'map')?.value;
            status = rp.find((i: SteamRichPresenceItem) => i.key === 'status')?.value;
            score = rp.find((i: SteamRichPresenceItem) => i.key === 'game:score' || i.key === 'score')?.value;
            mode = rp.find((i: SteamRichPresenceItem) => i.key === 'game:mode' || i.key === 'mode')?.value;
        } else if (rp && typeof rp === 'object') {
            map = rp['game:map'] || rp['map'];
            status = rp['status'];
            score = rp['game:score'] || rp['score'];
            mode = rp['game:mode'] || rp['mode'];
        }

        if (user.rich_presence_string) {
            // If we have a rich_presence_string, it's usually the most user-friendly summary
            status = user.rich_presence_string;
        }

        // The game mode often isn't its own key; fall back to the status string.
        if (!mode) {
            mode = status;
        }

        // Keep the raw "16-14" before it's turned into emoji digits for display, so we can
        // record it in history and compute win/loss/tie.
        const rawScore: string | undefined = score ? score.replace(/[\[\]]/g, '').trim() : undefined;

        if (score) {
            score = this.formatScore(score);
        }

        if (map || status || score) {
            console.debug(`Rich presence for ${playerName}: map=${map}, status=${status}, score=${score}`);
        }

        const info: GameUpdateInfo = { gameId, map, status, score };

        const chats = await this.userDao.getUserChats(tgUserId);
        if (chats.length === 0) {
            console.debug(`No chats found for user ${tgUserId} (Steam ID: ${steamId}). Cannot publish update.`);
        }
        for (const chatId of chats) {
            // Track match progress / boundaries regardless of the chat's live-update setting;
            // history is a separate pull (/game_history) and the end-of-game notification is
            // gated by steam_updates inside finalizeMatch.
            await this.updateMatchState(chatId, tgUserId, { map, mode, rawScore, playerName });

            const chatSettings: ChatSettings = await this.chatDao.getChatSettings(chatId);
            if (chatSettings.steam_updates === false) {
                console.debug(`Steam updates are disabled for chat ${chatId}. Skipping update for user ${tgUserId}.`);
                continue;
            }

            // Prefer the user's Telegram name; fall back to their Steam display name
            const displayName = (await this.getTelegramDisplayName(chatId, tgUserId)) || playerName;

            // If no map/status yet, maybe it's just starting
            let text = `🟢 *${escapeMarkdown(displayName)}* is playing Counter-Strike`;
            if (map || status || score) text += `\n`;
            if (map) text += `\nMap: ${escapeMarkdown(map)}`;
            if (status) text += `\nStatus: ${escapeMarkdown(status)}`;
            if (score) text += `\nScore: ${escapeMarkdown(score)}`;

            console.debug(`Publishing update for user ${tgUserId} to chat ${chatId}`);
            await this.publishUpdate(chatId, tgUserId, text, info);
        }
    }

    async getTelegramDisplayName(chatId: number, tgUserId: number): Promise<string | null> {
        const cacheKey = `${chatId}:${tgUserId}`;
        const cached = this.telegramNameCache[cacheKey];
        if (cached && Date.now() - cached.fetchedAt < 60 * 60 * 1000) {
            return cached.name || null;
        }
        try {
            const member = await this.bot.getChatMember(chatId, tgUserId);
            // Use the username without the @ prefix so it doesn't trigger a mention notification
            const name = member.user.first_name || member.user.username || '';
            this.telegramNameCache[cacheKey] = { name, fetchedAt: Date.now() };
            return name || null;
        } catch (err) {
            console.debug(`Could not fetch Telegram name for user ${tgUserId} in chat ${chatId}:`, err);
            return null;
        }
    }

    async publishUpdate(chatId: number, tgUserId: number, text: string, info: GameUpdateInfo): Promise<void> {
        try {
            const lastUpdate: GameUpdate = await this.gameUpdateDao.getGameUpdate(chatId, tgUserId);
            
            // Avoid redundant updates
            if (lastUpdate && lastUpdate.text === text) {
                console.log(`Update for user ${tgUserId} in chat ${chatId} is redundant (text hasn't changed), skipping.`);
                return;
            }

            const now = new Date();
            const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

            if (lastUpdate && new Date(lastUpdate.timestamp) > sixHoursAgo) {
                const oldInfo: GameUpdateInfo = lastUpdate.info || {};
                
                // Check if the new update is less detailed than the previous one.
                // We should NOT replace a more detailed message with a less detailed one
                // UNLESS the map or game mode/status or game itself has changed.
                const gameChanged = info.gameId !== oldInfo.gameId;
                const mapChanged = info.map && info.map !== oldInfo.map;
                const meaningfulStatusChanged = info.status && info.status !== oldInfo.status && !this.isGenericStatus(info.status);
                
                if (!gameChanged && !mapChanged && !meaningfulStatusChanged) {
                    // Critical info is the same. Now check if we are losing detail.
                    const lostScore = oldInfo.score && !info.score;
                    const lostMap = oldInfo.map && !info.map;
                    const lostStatus = oldInfo.status && !this.isGenericStatus(oldInfo.status) && this.isGenericStatus(info.status);

                    if (lostScore || lostMap || lostStatus) {
                        console.log(`New update for user ${tgUserId} is less detailed than the existing one and map/mode haven't changed. Skipping update.`);
                        return;
                    }
                }

                console.log(`Last update for user ${tgUserId} in chat ${chatId} was at ${lastUpdate.timestamp} (less than 6h ago). Attempting to edit message ${lastUpdate.message_id}.`);
                // Update existing message
                try {
                    console.log(`Editing message ${lastUpdate.message_id} in chat ${chatId} for user ${tgUserId}`);
                    await this.bot.editMessageText(text, {
                        chat_id: chatId,
                        message_id: lastUpdate.message_id,
                        parse_mode: 'Markdown'
                    });
                    // Keep original timestamp, but update text and info
                    await this.gameUpdateDao.updateGameUpdateText(chatId, tgUserId, text, info);
                    return;
                } catch (err: any) {
                    if (err.message && err.message.includes('message is not modified')) {
                        console.log(`Message ${lastUpdate.message_id} in chat ${chatId} was already up to date according to Telegram.`);
                        // Still update our DAO to match what Telegram has (or what we think it should have)
                        await this.gameUpdateDao.updateGameUpdateText(chatId, tgUserId, text, info);
                        return;
                    }
                    console.error(`Failed to edit message ${lastUpdate.message_id} in chat ${chatId}:`, err);
                    // If editing fails (e.g. message too old or deleted), send a new one
                }
            }

            // Send new message
            console.log(`Sending new update message to chat ${chatId} for user ${tgUserId}`);
            const sentMessage = await this.bot.sendMessage(chatId, text, {
                parse_mode: 'Markdown'
            });
            if (sentMessage && sentMessage.message_id) {
                await this.gameUpdateDao.setGameUpdate(chatId, tgUserId, sentMessage.message_id, text, info);
            }
        } catch (err) {
            console.error(`Error publishing update to chat ${chatId}:`, err);
        }
    }

    submitSteamGuardCode(code: string): boolean {
        if (this.steamGuardCallback) {
            this.steamGuardCallback(code);
            this.steamGuardCallback = null;
            return true;
        }
        return false;
    }

    isGenericStatus(status: string | null | undefined): boolean {
        if (!status) return true;
        const generic = [
            'playing counter-strike 2',
            'counter-strike 2',
            'playing counter-strike',
            'counter-strike',
            'playing cs2',
            'cs2',
            'playing'
        ];
        return generic.includes(status.toLowerCase().trim());
    }

    formatScore(score: string): string {
        if (!score) return score;
        // Strip surrounding brackets and whitespace
        const cleanScore = score.replace(/[\[\]]/g, '').trim();
        const numberEmojis = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
        return cleanScore.replace(/\d/g, (match: string) => numberEmojis[parseInt(match)]);
    }

    // Parse a raw "16-14" (or "16:14") score into its parts and round total.
    parseRawScore(score?: string): { a: number; b: number; total: number } | null {
        if (!score) return null;
        const m = score.replace(/[\[\]]/g, '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
        if (!m) return null;
        const a = parseInt(m[1], 10);
        const b = parseInt(m[2], 10);
        return { a, b, total: a + b };
    }

    // 🏆/☠️/🤝 from a raw score (first part = player, second = opponents).
    resultEmoji(score?: string): string {
        const parsed = this.parseRawScore(score);
        if (!parsed) return '•';
        if (parsed.a > parsed.b) return '🏆';
        if (parsed.a < parsed.b) return '☠️';
        return '🤝';
    }

    // Pull map / mode / round-total out of a steam-user presence object (used when looking at
    // other tracked players to decide who is in the same match).
    private extractMapModeTotal(user: any): { map?: string; mode?: string; total?: number } {
        let map: string | undefined, status: string | undefined, score: string | undefined, mode: string | undefined;
        const rp = user?.rich_presence;
        if (Array.isArray(rp)) {
            map = rp.find((i: SteamRichPresenceItem) => i.key === 'game:map' || i.key === 'map')?.value;
            status = rp.find((i: SteamRichPresenceItem) => i.key === 'status')?.value;
            score = rp.find((i: SteamRichPresenceItem) => i.key === 'game:score' || i.key === 'score')?.value;
            mode = rp.find((i: SteamRichPresenceItem) => i.key === 'game:mode' || i.key === 'mode')?.value;
        } else if (rp && typeof rp === 'object') {
            map = rp['game:map'] || rp['map'];
            status = rp['status'];
            score = rp['game:score'] || rp['score'];
            mode = rp['game:mode'] || rp['mode'];
        }
        if (!mode) mode = status;
        return { map, mode, total: this.parseRawScore(score)?.total };
    }

    // Run fn with exclusive access to a (chat,user)'s match buffer, chaining onto any in-flight
    // operation for the same key so concurrent presence updates are applied in series.
    private withMatchLock<T>(chatId: number, tgUserId: number, fn: () => Promise<T>): Promise<T> {
        const key = `${chatId}_${tgUserId}`;
        const prev = this.matchLocks[key] || Promise.resolve();
        const run = prev.then(fn, fn);
        this.matchLocks[key] = run.then(() => undefined, () => undefined);
        return run;
    }

    // Update the persisted "current match" buffer for a (chat, user) from a presence tick,
    // detecting match boundaries (score reset / map change / mode change) and accumulating
    // co-players. Finalises the previous match when a boundary is crossed.
    private updateMatchState(chatId: number, tgUserId: number, info: { map?: string; mode?: string; rawScore?: string; playerName?: string }): Promise<void> {
      return this.withMatchLock(chatId, tgUserId, async () => {
        try {
            const { map, mode, rawScore, playerName } = info;
            const cur = await this.gameHistoryDao.getCurrentMatch(chatId, tgUserId);
            const newParsed = this.parseRawScore(rawScore);

            if (cur) {
                const mapChanged = !!(map && cur.map && map.toLowerCase() !== cur.map.toLowerCase());
                const modeChanged = !!(mode && cur.mode && mode !== cur.mode);
                const curParsed = this.parseRawScore(cur.max_score);
                const scoreReset = !!(newParsed && curParsed && newParsed.total < curParsed.total - RESET_TOLERANCE);

                if (!mapChanged && !modeChanged && !scoreReset) {
                    // Continuation of the same match (incl. a relaunch resuming it).
                    let max_score = cur.max_score;
                    if (newParsed && (!curParsed || newParsed.total > curParsed.total)) {
                        max_score = rawScore;
                    }
                    const matchMap = cur.map || map;
                    const matchMode = cur.mode || mode;
                    const incoming = await this.collectCoPlayers(chatId, tgUserId, matchMap, matchMode, this.parseRawScore(max_score)?.total);
                    await this.gameHistoryDao.setCurrentMatch({
                        chat_id: chatId,
                        user_id: tgUserId,
                        map: matchMap,
                        mode: matchMode,
                        max_score,
                        player_name: playerName || cur.player_name,
                        co_players: this.mergeCoPlayers(cur.co_players, incoming),
                        started_at: cur.started_at,
                        last_progress_at: new Date(),
                        playing: true
                    });
                    return;
                }

                // Boundary: the previous match is finished. Record it, then start fresh.
                await this.finalizeMatch(cur);
            }

            const coPlayers = await this.collectCoPlayers(chatId, tgUserId, map, mode, newParsed?.total);
            const now = new Date();
            await this.gameHistoryDao.setCurrentMatch({
                chat_id: chatId,
                user_id: tgUserId,
                map,
                mode,
                max_score: rawScore,
                player_name: playerName,
                co_players: coPlayers,
                started_at: now,
                last_progress_at: now,
                playing: true
            });
        } catch (err) {
            console.error(`Error updating match state for user ${tgUserId} in chat ${chatId}:`, err);
        }
      });
    }

    // Other tracked users currently in the same match: playing CS2, same map + mode, scores
    // not diverging too far, and sharing this chat. Returns them as resolved co-player names.
    private async collectCoPlayers(chatId: number, tgUserId: number, map?: string, mode?: string, total?: number): Promise<GameHistoryCoPlayer[]> {
        const result: GameHistoryCoPlayer[] = [];
        const seen = new Set<number>();
        for (const [otherSteamId, otherTgId] of Object.entries(this.steamToTelegram)) {
            if (otherTgId === tgUserId || seen.has(otherTgId)) continue;
            const otherUser = this.client.users[otherSteamId];
            if (!otherUser || otherUser.gameid != this.appIdCS2) continue;

            const other = this.extractMapModeTotal(otherUser);
            if (map && other.map && map.toLowerCase() !== other.map.toLowerCase()) continue;
            if (mode && other.mode && mode !== other.mode) continue;
            if (total != null && other.total != null && Math.abs(total - other.total) > RESET_TOLERANCE) continue;

            const otherChats = await this.userDao.getUserChats(otherTgId);
            if (!otherChats.includes(chatId)) continue;

            const name = await this.resolveCoPlayerName(chatId, otherTgId, otherUser.player_name);
            result.push({ tg_user_id: otherTgId, name });
            seen.add(otherTgId);
        }
        return result;
    }

    private mergeCoPlayers(existing: GameHistoryCoPlayer[], incoming: GameHistoryCoPlayer[]): GameHistoryCoPlayer[] {
        const byId = new Map<number, GameHistoryCoPlayer>();
        for (const p of existing || []) byId.set(p.tg_user_id, p);
        for (const p of incoming || []) byId.set(p.tg_user_id, p);
        return Array.from(byId.values());
    }

    // Resolve a co-player's display name: Telegram name → rollcall mention → Steam name → id.
    private async resolveCoPlayerName(chatId: number, otherTgId: number, fallback?: string): Promise<string> {
        const tgName = await this.getTelegramDisplayName(chatId, otherTgId);
        if (tgName) return tgName;
        try {
            const rotation = await this.rollcallPlayerDao.getRollcallPlayerUsernames(chatId);
            for (const mention of rotation) {
                const parsed = parseMention(mention);
                if (parsed.id === otherTgId) {
                    return parsed.display;
                }
            }
        } catch (err) {
            console.debug(`Could not match co-player ${otherTgId} against rollcall:`, err);
        }
        return fallback || String(otherTgId);
    }

    // The user stopped playing CS2: don't finalise yet (a relaunch may continue the match),
    // just mark it idle so the periodic sweep can finalise it after the idle window.
    private markMatchNotPlaying(chatId: number, tgUserId: number): Promise<void> {
        return this.withMatchLock(chatId, tgUserId, async () => {
            try {
                const cur = await this.gameHistoryDao.getCurrentMatch(chatId, tgUserId);
                if (cur && cur.playing) {
                    cur.playing = false;
                    await this.gameHistoryDao.setCurrentMatch(cur);
                }
            } catch (err) {
                console.error(`Error marking match not playing for user ${tgUserId} in chat ${chatId}:`, err);
            }
        });
    }

    // Record a finished match to history and (if the chat allows) post an end-of-game message.
    private async finalizeMatch(match: CurrentMatch): Promise<void> {
        const chatId = match.chat_id;
        const tgUserId = match.user_id;
        try {
            if (match.max_score) {
                const entry: GameHistoryEntry = {
                    chat_id: chatId,
                    user_id: tgUserId,
                    mode: match.mode,
                    map: match.map,
                    score: match.max_score,
                    co_players: match.co_players || [],
                    started_at: match.started_at,
                    ended_at: new Date()
                };
                await this.gameHistoryDao.addGameHistoryEntry(entry);

                const chatSettings: ChatSettings = await this.chatDao.getChatSettings(chatId);
                if (chatSettings.steam_updates !== false) {
                    await this.postEndOfGameNotification(chatId, tgUserId, match);
                }
            }
        } catch (err) {
            console.error(`Failed to finalise match for user ${tgUserId} in chat ${chatId}:`, err);
        } finally {
            // Clear the buffer either way so we never record the same match twice.
            await this.gameHistoryDao.deleteCurrentMatch(chatId, tgUserId).catch(() => {});
        }
    }

    private async postEndOfGameNotification(chatId: number, tgUserId: number, match: CurrentMatch): Promise<void> {
        const displayName = (await this.getTelegramDisplayName(chatId, tgUserId)) || match.player_name || 'Someone';
        let text = `🏁 *${escapeMarkdown(displayName)}* finished a game`;
        if (match.map) text += ` on ${escapeMarkdown(match.map)}`;
        if (match.mode) text += ` (${escapeMarkdown(match.mode)})`;
        if (match.max_score) text += `: ${escapeMarkdown(this.formatScore(match.max_score))} ${this.resultEmoji(match.max_score)}`;
        await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    }

    // Finalise matches that have gone idle (CS2 not running, no score progress) past the window.
    private async sweepIdleMatches(): Promise<void> {
        try {
            const cutoff = new Date(Date.now() - MATCH_IDLE_MS);
            const idle = await this.gameHistoryDao.getIdleMatches(cutoff);
            for (const match of idle) {
                await this.withMatchLock(match.chat_id, match.user_id, async () => {
                    // Re-read under the lock so we don't race a concurrent presence update.
                    const cur = await this.gameHistoryDao.getCurrentMatch(match.chat_id, match.user_id);
                    if (cur && !cur.playing && (Date.now() - new Date(cur.last_progress_at).getTime()) > MATCH_IDLE_MS) {
                        console.log(`Match for user ${match.user_id} in chat ${match.chat_id} is idle; finalising.`);
                        await this.finalizeMatch(cur);
                    }
                });
            }
        } catch (err) {
            console.error('Error during idle match sweep:', err);
        }
    }

    async maybeCloseSession(chatId: number, tgUserId: number): Promise<void> {
        try {
            // Check if ANY tracked steam ID for this user is playing CS2
            // We need to fetch settings first to know all steam IDs
            const settings = await this.userDao.getUserSettings(tgUserId);
            const steamIds = settings.steam_ids || [];
            
            const isAnyPlaying = steamIds.some(sid => {
                 const user = this.client.users[sid];
                 // Check if playing CS2 (AppID 730)
                 return user && user.gameid == this.appIdCS2;
            });
    
            if (isAnyPlaying) {
                 if (process.env.LOG_DEBUG) {
                     console.debug(`User ${tgUserId} has an active session on one of their accounts. Not closing.`);
                 }
                 return;
            }

            const lastUpdate: GameUpdate = await this.gameUpdateDao.getGameUpdate(chatId, tgUserId);
            if (!lastUpdate || !lastUpdate.text) return;

            // If message is too old (> 6 hours), ignore
            const now = new Date();
            const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
            if (new Date(lastUpdate.timestamp) < sixHoursAgo) return;

            let newText = lastUpdate.text;

            // Check if already closed
            if (newText.startsWith('🔴')) {
                return;
            }

            if (newText.startsWith('🟢')) {
                newText = newText.replace('🟢', '🔴');
            } else {
                // Legacy or unexpected format, prepend red
                newText = `🔴 ${newText}`;
            }

            console.log(`Closing session for user ${tgUserId} in chat ${chatId}. Editing message ${lastUpdate.message_id}.`);

            await this.bot.editMessageText(newText, {
                chat_id: chatId,
                message_id: lastUpdate.message_id,
                parse_mode: 'Markdown'
            });

            // Update DAO with new text but keep old info
            await this.gameUpdateDao.updateGameUpdateText(chatId, tgUserId, newText, lastUpdate.info);

        } catch (err: any) {
            if (err.message && err.message.includes('message is not modified')) {
                // Ignore
                return;
            }
            console.error(`Failed to close session in chat ${chatId}:`, err);
        }
    }
}

export default SteamService;
