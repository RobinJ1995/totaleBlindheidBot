import SteamUser from 'steam-user';
import SteamTotp from 'steam-totp';
import TelegramBot from 'node-telegram-bot-api';
import UserDAO, { UserSettings } from './dao/UserDAO.js';
import ChatDAO, { ChatSettings } from './dao/ChatDAO.js';
import GameUpdateDAO, { GameUpdate } from './dao/GameUpdateDAO.js';
import GameHistoryDAO, { GameHistoryEntry, GameHistoryCoPlayer, SessionMatch, SiblingMatch } from './dao/GameHistoryDAO.js';
import PresenceEventDAO from './dao/PresenceEventDAO.js';
import RollcallPlayerDAO from './dao/RollcallPlayerDAO.js';
import { escapeMarkdown } from './utils.js';
import { parseMention } from './rsvp.js';
import { saveSteamFile, readSteamFile, withTransaction } from './dao/Database.js';
import {
    segmentStream, findCoPlayers, deriveRounds, parseRawScore as parseRawScoreFn,
    DerivationConfig, MatchSegment, PresenceEvent, RoundOutcome
} from './matchDerivation.js';

// A finished match with no further score progress is recorded once it has been idle
// (CS2 not running, score unchanged) for this long. Overridable for tests.
const MATCH_IDLE_MS = Number(process.env.MATCH_IDLE_MS) || 10 * 60 * 1000;

// How often the idle-match sweep runs. Overridable for tests.
const MATCH_SWEEP_MS = Number(process.env.MATCH_SWEEP_MS) || 60 * 1000;

// How recently a match must have been announced for a later-finalising player of the same match
// to be grouped into (and edit) that existing message rather than posting a fresh one. Players'
// Steam presence — and thus finalisations — for one match can arrive minutes apart. Overridable.
const EOG_GROUP_WINDOW_MS = Number(process.env.EOG_GROUP_WINDOW_MS) || 2 * 60 * 60 * 1000;

// How far a freshly reported round-total may dip below the running match total before we
// treat it as a brand new match rather than out-of-order update noise.
const RESET_TOLERANCE = 2;

// How long an uncontradicted score reset must stand before the old match is finalised. A dip
// that returns to the old range within this window is folded away as presence noise instead of
// splitting the match. Overridable for tests.
const MATCH_RESET_CONFIRM_MS = Number(process.env.MATCH_RESET_CONFIRM_MS) || 30 * 1000;

// How long raw presence events are kept after they've been finalised into history. The log is
// what makes retrospective (re-)derivation possible, so keep a forensically useful window.
const PRESENCE_EVENT_TTL_MS = Number(process.env.PRESENCE_EVENT_TTL_MS) || 7 * 24 * 60 * 60 * 1000;

// How often, at most, the presence-event TTL prune runs (piggybacked on the sweep timer).
const PRESENCE_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

// How old another account's last observation may be and still count as its "state" for
// co-player matching (the live-presence check this replaces was at most minutes stale).
const CO_PLAYER_STALE_MS = 15 * 60 * 1000;

// The live message's session overview lists matches that ended after the message was created,
// widened by this slack: the session's first presence event precedes the message it triggers,
// so a match observed only around that instant would otherwise fall just outside the window.
const SESSION_OVERVIEW_SLACK_MS = 60 * 1000;

const DERIVATION_CONFIG: DerivationConfig = {
    resetTolerance: RESET_TOLERANCE,
    matchIdleMs: MATCH_IDLE_MS,
    resetConfirmMs: MATCH_RESET_CONFIRM_MS,
    coPlayerStaleMs: CO_PLAYER_STALE_MS
};

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
    private presenceEventDao: PresenceEventDAO;
    private rollcallPlayerDao: RollcallPlayerDAO;
    private steamToTelegram: Record<string, number>;
    private appIdCS2: number;
    private steamGuardCallback: ((code: string) => void) | null;
    private telegramNameCache: Record<string, { name: string; fetchedAt: number }> = {};
    // Serialises append+derive+finalise per Steam account (and announcement editing per chat)
    // so rapidly-arriving presence updates and the sweep can't race each other.
    private matchLocks: Record<string, Promise<unknown>> = {};
    private lastPresencePruneAt: number = 0;
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
        this.presenceEventDao = new PresenceEventDAO();
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
            // Not awaited (steam-user's emitter is synchronous); catch here so a transient
            // failure (e.g. a DB blip) can't become an unhandled rejection and kill the process.
            this.handleUserUpdate(sid.getSteamID64(), user)
                .catch(err => console.error(`Error handling Steam user update for ${sid.getSteamID64()}:`, err));
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

            // Record that THIS account stopped playing — a match can't continue on another
            // account, so a sibling account staying in CS2 is irrelevant. This is never a match
            // boundary by itself (a relaunch on the same account resumes the match); the sweep
            // finalises the match once it has been idle past the window.
            await this.recordPresence(steamId, tgUserId, { playing: false });

            const chats = await this.userDao.getUserChats(tgUserId);
            for (const chatId of chats) {
                // The live message is per-user, so it only closes once no account is playing.
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

        // The raw status value (e.g. "Competitive"), before the verbose summary overrides it.
        const rawStatus: string | undefined = status;

        if (user.rich_presence_string) {
            // If we have a rich_presence_string, it's usually the most user-friendly summary
            status = user.rich_presence_string;
        }

        // The game mode often isn't its own key; fall back to the raw status rich-presence
        // value (e.g. "Competitive"), captured BEFORE rich_presence_string overrides status
        // for display. Using the volatile summary here would make the mode change mid-match
        // and spuriously split one match into many.
        if (!mode) {
            mode = rawStatus;
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

        // Record the presence transition and derive match progress / boundaries from the stream,
        // regardless of any chat's live-update setting; history is a separate pull
        // (/game_history) and the end-of-game notification is gated per chat at finalisation.
        await this.recordPresence(steamId, tgUserId, { playing: true, map, mode, rawScore, playerName });

        // Per-round outcomes of the current match, replayed from the (just-updated) stream.
        const rounds = await this.getLiveRounds(steamId);

        const chats = await this.userDao.getUserChats(tgUserId);
        if (chats.length === 0) {
            console.debug(`No chats found for user ${tgUserId} (Steam ID: ${steamId}). Cannot publish update.`);
        }
        for (const chatId of chats) {
            const chatSettings: ChatSettings = await this.chatDao.getChatSettings(chatId);
            if (chatSettings.steam_updates === false) {
                console.debug(`Steam updates are disabled for chat ${chatId}. Skipping update for user ${tgUserId}.`);
                continue;
            }

            // Prefer the user's Telegram name; fall back to their Steam display name
            const displayName = (await this.getTelegramDisplayName(chatId, tgUserId)) || playerName;

            // If no map/status yet, maybe it's just starting
            let text = `🟢 *${escapeMarkdown(displayName)}* is playing Counter-Strike`;
            if (map || status || score || rounds.length > 0) text += `\n`;
            if (map) text += `\nMap: ${escapeMarkdown(map)}`;
            if (status) text += `\nStatus: ${escapeMarkdown(status)}`;
            if (score) text += `\nScore: ${escapeMarkdown(score)}`;
            if (rounds.length > 0) text += `\nRounds: ${this.formatRounds(rounds)}`;

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

            const now = new Date();
            const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

            // The live message doubles as the session's scoreboard: matches that finished during
            // its lifetime are listed above the current game state. A fresh message starts a
            // fresh session, so it carries no overview.
            if (lastUpdate && new Date(lastUpdate.timestamp) > sixHoursAgo) {
                const sessionStart = new Date(new Date(lastUpdate.timestamp).getTime() - SESSION_OVERVIEW_SLACK_MS);
                const sessionMatches = await this.gameHistoryDao.getGameHistorySince(chatId, tgUserId, sessionStart);
                if (sessionMatches.length > 0) {
                    text = `${sessionMatches.map(m => this.sessionOverviewLine(m)).join('\n')}\n\n${text}`;
                }
            }

            // Avoid redundant updates
            if (lastUpdate && lastUpdate.text === text) {
                console.log(`Update for user ${tgUserId} in chat ${chatId} is redundant (text hasn't changed), skipping.`);
                return;
            }

            if (lastUpdate && new Date(lastUpdate.timestamp) > sixHoursAgo) {
                const oldInfo: GameUpdateInfo = lastUpdate.info || {};
                
                // Check if the new update is less detailed than the previous one.
                // We should NOT replace a more detailed message with a less detailed one
                // UNLESS the map or game mode/status or game itself has changed.
                // Compare as strings: the live gameId comes straight from steam-user (a
                // string like "730"), while the stored one is reconstructed from the DB. A
                // raw !== would always report a change on a type mismatch, disabling the
                // less-detailed-update guard below.
                const gameChanged = String(info.gameId ?? '') !== String(oldInfo.gameId ?? '');
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
        return parseRawScoreFn(score);
    }

    // One session-overview line: "🏆 Competitive: Vertigo 1️⃣3️⃣:8️⃣". The score keeps the raw
    // player-opponent order but is rendered with a colon so it can't be mistaken for the raw
    // "13-8" form used elsewhere.
    sessionOverviewLine(match: SessionMatch): string {
        const parts: string[] = [this.resultEmoji(match.score)];
        if (match.mode) parts.push(`${escapeMarkdown(match.mode)}:`);
        if (match.map) parts.push(escapeMarkdown(match.map));
        const parsed = this.parseRawScore(match.score);
        if (parsed) parts.push(this.formatScore(`${parsed.a}:${parsed.b}`));
        return parts.join(' ');
    }

    // 🎖️ per round won, ☠️ per round lost, e.g. "🎖️☠️🎖️🎖️".
    formatRounds(rounds: RoundOutcome[]): string {
        return rounds.map(r => r === 'win' ? '🎖️' : '☠️').join('');
    }

    // Per-round outcomes of the account's current (unfinalised) match, replayed from the
    // stream's open segment under its lock so a concurrent append or finalisation can't be
    // observed halfway. Returns [] (also on error) — the live message just omits the line.
    private getLiveRounds(steamId: string): Promise<RoundOutcome[]> {
        return this.withStreamLock(steamId, async () => {
            try {
                const cursor = await this.presenceEventDao.getCursor(steamId);
                const events = await this.presenceEventDao.getEventsAfter(steamId, cursor);
                if (events.length === 0) {
                    return [];
                }
                // A pending (unconfirmed) reset holds the newest observations — including the
                // score the live message is showing — so its rounds are the ones to render.
                const { open, pending } = segmentStream(events, new Date(), DERIVATION_CONFIG);
                const current = pending ?? open;
                return current ? deriveRounds(current.events) : [];
            } catch (err) {
                console.error(`Error deriving live rounds for Steam ID ${steamId}:`, err);
                return [];
            }
        });
    }

    // 🏆/☠️/🤝 from a raw score (first part = player, second = opponents).
    resultEmoji(score?: string): string {
        const parsed = this.parseRawScore(score);
        if (!parsed) return '•';
        if (parsed.a > parsed.b) return '🏆';
        if (parsed.a < parsed.b) return '☠️';
        return '🤝';
    }

    // Run fn with exclusive access to a named lock, chaining onto any in-flight operation for the
    // same key so concurrent callers are serialised.
    private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.matchLocks[key] || Promise.resolve();
        const run = prev.then(fn, fn);
        this.matchLocks[key] = run.then(() => undefined, () => undefined);
        return run;
    }

    // Run fn with exclusive access to a Steam account's event stream, chaining onto any in-flight
    // operation for the same account so presence updates and the sweep are applied in series.
    private withStreamLock<T>(steamId: string, fn: () => Promise<T>): Promise<T> {
        return this.withLock(`stream_${steamId}`, fn);
    }

    // Record a presence transition for a Steam account and re-derive its match state from the
    // stream. Only transitions are stored: a snapshot identical to the stream's last event
    // (same playing flag, map, mode and score) is dropped, so pure re-broadcasts — including
    // updates carrying nothing but the game id — never grow the log.
    private recordPresence(
        steamId: string,
        tgUserId: number,
        snapshot: { playing: boolean; map?: string; mode?: string; rawScore?: string; playerName?: string }
    ): Promise<void> {
        return this.withStreamLock(steamId, async () => {
            try {
                const last = await this.presenceEventDao.getLastEvent(steamId);

                if (!snapshot.playing) {
                    // Only a playing→stopped transition is worth recording; for an account with
                    // no (playing) history, "still not in CS2" is not an event.
                    if (!last || !last.playing) {
                        return;
                    }
                } else if (
                    last && last.playing &&
                    (last.map ?? null) === (snapshot.map ?? null) &&
                    (last.mode ?? null) === (snapshot.mode ?? null) &&
                    (last.raw_score ?? null) === (snapshot.rawScore ?? null)
                ) {
                    return; // no transition
                }

                await this.presenceEventDao.appendEvent({
                    steam_id: steamId,
                    user_id: tgUserId,
                    playing: snapshot.playing,
                    map: snapshot.map,
                    mode: snapshot.mode,
                    raw_score: snapshot.rawScore,
                    score_total: this.parseRawScore(snapshot.rawScore)?.total ?? null,
                    player_name: snapshot.playerName,
                    created_at: new Date()
                });

                await this.deriveAndFinalize(steamId);
            } catch (err) {
                console.error(`Error recording presence for Steam ID ${steamId} (user ${tgUserId}):`, err);
            }
        });
    }

    // Replay the stream's unfinalised events and finalise every segment the derivation considers
    // finished. Must run under the stream's lock. Idempotent: only closed segments have side
    // effects, closing is monotone in (events, time), and finalisation advances the cursor.
    private async deriveAndFinalize(steamId: string): Promise<void> {
        const cursor = await this.presenceEventDao.getCursor(steamId);
        const events = await this.presenceEventDao.getEventsAfter(steamId, cursor);
        if (events.length === 0) {
            return;
        }
        const { closed } = segmentStream(events, new Date(), DERIVATION_CONFIG);
        let expectedCursor = cursor;
        for (const segment of closed) {
            try {
                await this.finalizeSegment(steamId, segment, expectedCursor);
                expectedCursor = segment.lastEventId;
            } catch (err) {
                // Stop at the first failed segment: a later segment's cursor advance would skip
                // past this one and its match would never be recorded. Left unfinalised, it is
                // retried on the next derivation (every event and every sweep tick).
                console.error(`Failed to finalise match for Steam ID ${steamId}; will retry:`, err);
                break;
            }
        }
    }

    // Record a finished match segment to history for each of the owner's chats, advancing the
    // stream cursor (compare-and-swap from expectedCursor) in the same transaction — a match is
    // therefore *recorded* exactly once, even against a concurrent finaliser. The Telegram
    // announcement afterwards is at-most-once per finaliser: a crash between the commit and the
    // send loses it, which is accepted (the alternative, announcing before committing, could
    // announce a match that was never recorded). Throws if the match could not be recorded (so
    // the caller stops and the segment is retried later); announcement failures are contained
    // per chat since by then the cursor has already advanced.
    private async finalizeSegment(steamId: string, segment: MatchSegment, expectedCursor: number): Promise<void> {
        const tgUserId = segment.user_id;
        const entries: { chatId: number; entry: GameHistoryEntry }[] = [];

        if (segment.max_score) {
            const coPlayers = await this.findSegmentCoPlayers(steamId, segment);
            const chats = await this.userDao.getUserChats(tgUserId);
            for (const chatId of chats) {
                // Resolve and store the owner's display name now so a later-finalising player
                // of the same match can render it into the shared announcement without having
                // to re-resolve it. Co-players must share the chat.
                const playerName = (await this.getTelegramDisplayName(chatId, tgUserId)) || segment.player_name || String(tgUserId);
                const chatCoPlayers: GameHistoryCoPlayer[] = [];
                for (const co of coPlayers) {
                    const coChats = await this.userDao.getUserChats(co.user_id);
                    if (!coChats.includes(chatId)) continue;
                    const name = await this.resolveCoPlayerName(chatId, co.user_id, co.player_name);
                    chatCoPlayers.push({ tg_user_id: co.user_id, name });
                }
                entries.push({
                    chatId,
                    entry: {
                        chat_id: chatId,
                        user_id: tgUserId,
                        player_name: playerName,
                        mode: segment.mode,
                        map: segment.map,
                        score: segment.max_score,
                        co_players: chatCoPlayers,
                        started_at: segment.started_at,
                        // The last in-game observation, not finalisation time: idle-finalised
                        // matches would otherwise carry the idle window + sweep delay into
                        // ended_at (and inflate /stats playtime by it).
                        ended_at: segment.last_playing_at
                    }
                });
            }
        }

        const historyIds = await withTransaction(async conn => {
            const ids: number[] = [];
            for (const { entry } of entries) {
                ids.push(await this.gameHistoryDao.addGameHistoryEntry(entry, conn));
            }
            await this.presenceEventDao.advanceCursor(conn, steamId, expectedCursor, segment.lastEventId);
            return ids;
        });

        for (let i = 0; i < entries.length; i++) {
            const { chatId, entry } = entries[i];
            try {
                const chatSettings: ChatSettings = await this.chatDao.getChatSettings(chatId);
                if (chatSettings.steam_updates !== false) {
                    // Serialise announcing per chat so two players finalising the same match
                    // concurrently can't each create a separate message.
                    await this.withLock(`eog_${chatId}`, () =>
                        this.announceFinishedMatch(chatId, historyIds[i], entry));
                }
            } catch (err) {
                console.error(`Failed to announce finished match in chat ${chatId}:`, err);
            }
        }
    }

    // Reconstruct the segment's co-players from the other tracked accounts' event streams (see
    // findCoPlayers): their state at the segment's observation points must have been in CS2 on a
    // compatible map/mode with a score in range.
    private async findSegmentCoPlayers(steamId: string, segment: MatchSegment): Promise<{ user_id: number; player_name?: string }[]> {
        const otherStreams = new Map<string, PresenceEvent[]>();
        const trackedIds = await this.presenceEventDao.getTrackedSteamIds();
        for (const otherId of trackedIds) {
            if (otherId === steamId) continue;
            const stream = await this.presenceEventDao.getStreamAround(otherId, segment.started_at, segment.last_event_at);
            if (stream.length > 0) {
                otherStreams.set(otherId, stream);
            }
        }
        return findCoPlayers(segment, otherStreams, DERIVATION_CONFIG);
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

    // win/loss/tie classification of a raw "16-14" score (player-opponent), or null if unparseable.
    private matchResult(score?: string): 'win' | 'loss' | 'tie' | null {
        const parsed = this.parseRawScore(score);
        if (!parsed) {
            return null;
        } else if (parsed.a > parsed.b) {
            return 'win';
        } else if (parsed.a < parsed.b) {
            return 'loss';
        } else {
            return 'tie';
        }
    }

    // Join names into "A", "A and B", or "A, B and C". Order is irrelevant.
    private formatNameList(names: string[]): string {
        if (names.length === 0) {
            return 'Someone';
        } else if (names.length === 1) {
            return names[0];
        } else {
            return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
        }
    }

    private endOfGameText(names: string[], result: 'win' | 'loss' | 'tie', map?: string, mode?: string, score?: string): string {
        const emoji = result === 'win' ? '🏆' : result === 'loss' ? '☠️' : '🤝';
        const verb = result === 'win' ? 'won' : result === 'loss' ? 'lost' : 'tied';
        const nameList = this.formatNameList(names.map(n => escapeMarkdown(n)));
        let text = `${emoji} *${nameList}* ${verb} a game`;
        if (map) {
            text += ` on ${escapeMarkdown(map)}`;
        }
        if (mode) {
            text += ` (${escapeMarkdown(mode)})`;
        }
        if (score) {
            text += `: ${this.formatScore(score)}`;
        }
        return text;
    }

    // Announce a finished match as a single per-match message that names every participating
    // player. Players in the same chat finish the same match at different (often widely spaced)
    // times, so the first finaliser posts the message and each later one edits it to add names.
    //
    // Same-match candidates are the recently-finalised game_history rows in this chat with the same
    // map + mode, the same win/loss/tie result, and a round total within RESET_TOLERANCE. Signature
    // alone can't distinguish "another player in the same match" from "the same player in a *later*
    // match on the same map", so we only join an existing announcement that this player does not
    // already OWN a row in — a player is in any given match instance exactly once, so an existing
    // group already owned by them is a different match and must get its own message.
    private async announceFinishedMatch(chatId: number, historyId: number, match: GameHistoryEntry): Promise<void> {
        const playerName = match.player_name || String(match.user_id);
        const result = this.matchResult(match.score);
        if (!result) {
            return;
        }
        const total = this.parseRawScore(match.score)?.total;

        const since = new Date(Date.now() - EOG_GROUP_WINDOW_MS);
        const candidates = await this.gameHistoryDao.getRecentSiblingMatches(chatId, match.map, match.mode, since);
        const sameSig = candidates.filter(c => {
            if (c.id === historyId) {
                return false;
            }
            if (this.matchResult(c.score) !== result) {
                return false;
            }
            const t = this.parseRawScore(c.score)?.total;
            if (total != null && t != null && Math.abs(total - t) > RESET_TOLERANCE) {
                return false;
            }
            return true;
        });

        // Group the existing announcements (rows sharing a message_id) and pick the most recent one
        // this player doesn't already own a row in.
        const groups = new Map<number, { ownerIds: Set<number>; rows: SiblingMatch[]; maxId: number }>();
        for (const row of sameSig) {
            if (row.message_id == null) {
                continue;
            }
            let g = groups.get(row.message_id);
            if (!g) {
                g = { ownerIds: new Set<number>(), rows: [], maxId: 0 };
                groups.set(row.message_id, g);
            }
            g.ownerIds.add(row.user_id);
            g.rows.push(row);
            g.maxId = Math.max(g.maxId, row.id);
        }
        let target: { messageId: number; rows: SiblingMatch[]; maxId: number } | null = null;
        for (const [messageId, g] of groups) {
            if (g.ownerIds.has(match.user_id)) {
                continue; // a previous match of this player
            }
            if (!target || g.maxId > target.maxId) {
                target = { messageId, rows: g.rows, maxId: g.maxId };
            }
        }

        // Participants: this player (+ their co-players) unioned with the chosen group's rows. For a
        // fresh announcement only this player's match contributes — never the earlier match's rows.
        const namesByUser = new Map<number, string>();
        namesByUser.set(match.user_id, playerName || String(match.user_id));
        for (const co of match.co_players || []) {
            if (!namesByUser.has(co.tg_user_id)) {
                namesByUser.set(co.tg_user_id, co.name);
            }
        }
        for (const row of target?.rows || []) {
            if (!namesByUser.has(row.user_id)) {
                namesByUser.set(row.user_id, row.player_name || String(row.user_id));
            }
            for (const co of row.co_players) {
                if (!namesByUser.has(co.tg_user_id)) {
                    namesByUser.set(co.tg_user_id, co.name);
                }
            }
        }
        const names = Array.from(namesByUser.values());
        const text = this.endOfGameText(names, result, match.map, match.mode, match.score);

        if (target) {
            try {
                await this.bot.editMessageText(text, {
                    chat_id: chatId,
                    message_id: target.messageId,
                    parse_mode: 'Markdown'
                });
            } catch (err: any) {
                if (!(err.message && err.message.includes('message is not modified'))) {
                    console.error(`Failed to edit end-of-game message ${target.messageId} in chat ${chatId}:`, err);
                }
            }
            // Carry the id onto our own row so any later sibling lookup finds it.
            await this.gameHistoryDao.setGameHistoryMessageId(historyId, target.messageId);
            return;
        }

        const sent = await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        if (sent && sent.message_id) {
            await this.gameHistoryDao.setGameHistoryMessageId(historyId, sent.message_id);
        }
    }

    // Time-driven pass over every stream with unfinalised events: finalises trailing matches
    // that have gone idle past the window and score resets whose confirmation window has passed
    // (both need time, not events, to resolve). Re-deriving under the stream lock means a resume
    // event that arrived a moment ago is always seen before a match is finalised. Also hosts the
    // throttled TTL prune of old, already-finalised events.
    private async sweepIdleMatches(): Promise<void> {
        try {
            const streams = await this.presenceEventDao.getStreamsWithUnfinalizedEvents();
            for (const steamId of streams) {
                await this.withStreamLock(steamId, () => this.deriveAndFinalize(steamId));
            }

            if (Date.now() - this.lastPresencePruneAt >= PRESENCE_PRUNE_INTERVAL_MS) {
                this.lastPresencePruneAt = Date.now();
                await this.presenceEventDao.prune(new Date(Date.now() - PRESENCE_EVENT_TTL_MS));
            }
        } catch (err) {
            console.error('Error during idle match sweep:', err);
        }
    }

    // Is ANY of the user's mapped Steam accounts currently playing CS2? A user may register
    // several Steam IDs, so a non-CS2 update from one doesn't mean they've stopped playing.
    async isAnyAccountPlayingCS2(tgUserId: number): Promise<boolean> {
        const settings = await this.userDao.getUserSettings(tgUserId);
        const steamIds = settings.steam_ids || [];
        return steamIds.some(sid => {
            const user = this.client.users[sid];
            // Check if playing CS2 (AppID 730)
            return user && user.gameid == this.appIdCS2;
        });
    }

    async maybeCloseSession(chatId: number, tgUserId: number): Promise<void> {
        try {
            if (await this.isAnyAccountPlayingCS2(tgUserId)) {
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

            // Check if already closed. The 🟢/🔴 marker sits on the current-state line, which is
            // no longer necessarily the first one (the session overview renders above it), so
            // look anywhere in the text rather than at the start.
            if (newText.includes('🔴')) {
                return;
            }

            if (newText.includes('🟢')) {
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

            // Update DAO with the red text, but drop the now-stale detail. A closed session
            // has no live map/score left to protect, so the next launch — often a bare
            // "playing" update before rich presence arrives — must not be suppressed by the
            // less-detailed-update guard in publishUpdate().
            await this.gameUpdateDao.updateGameUpdateText(chatId, tgUserId, newText, {});

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
