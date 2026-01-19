import SteamUser from 'steam-user';
import SteamTotp from 'steam-totp';
import TelegramBot from 'node-telegram-bot-api';
import DAO, { UserSettings, ChatSettings, GameUpdate } from './dao/DAO';
import { escapeMarkdown } from './utils';
import { save, readFile } from './dao/S3Client';

interface SteamOptions {
    dataDirectory?: string;
    [key: string]: any;
}

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
}

class SteamService {
    private bot: TelegramBot;
    private client: SteamUser; // Initialize in constructor
    private dao: DAO;
    private steamToTelegram: Record<string, number>;
    private appIdCS2: number;
    private steamGuardCallback: ((code: string) => void) | null;
    private adminUserId: string | undefined;
    private updateInterval: NodeJS.Timeout | null;
    public static instance: SteamService | null = null;

    constructor(bot: TelegramBot) {
        this.bot = bot;

        const steamOptions: SteamOptions = {};
        if (process.env.S3_BUCKET) {
            console.log(`Using S3 storage for Steam data in bucket: ${process.env.S3_BUCKET}`);
            steamOptions.dataDirectory = 'data'; // Set generic data directory if needed, or rely on handlers
            // In original code, it sets dataDirectory to 'data' then overrides storage.
            // SteamUser constructor takes options
            
            // We need to initialize client before attaching listeners, but we need to know if we are using S3
            this.client = new SteamUser(steamOptions);
            
            this.client.storage.on('save', (filename: string, contents: Buffer, callback: (err: Error | null) => void) => {
                save(`steam-user/${filename}`, contents)
                    .then(() => callback(null))
                    .catch(err => callback(err));
            });

            this.client.storage.on('read', (filename: string, callback: (err: Error | null, content?: any) => void) => {
                readFile(`steam-user/${filename}`)
                    .then(contents => callback(null, contents))
                    .catch(err => callback(err));
            });
        } else {
            this.client = new SteamUser();
        }

        this.dao = new DAO();
        this.steamToTelegram = {};
        this.appIdCS2 = 730;
        this.steamGuardCallback = null;
        this.adminUserId = process.env.STEAM_ADMIN_TELEGRAM_USER_ID;
        this.updateInterval = null;
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

        const logOnOptions: any = {
            accountName: username,
            password: password
        };

        if (sharedSecret) {
            logOnOptions.twoFactorCode = SteamTotp.generateAuthCode(sharedSecret);
        }

        this.client.logOn(logOnOptions);

        this.client.on('loggedOn', () => {
            console.log(`Logged on to Steam as ${this.client.steamID?.getSteamID64()}`);
            this.client.setPersona(SteamUser.EPersonaState.Online);
            this.updateUserMappings();
        });

        this.client.on('friendsList', () => {
            console.log(`Friends list loaded. Bot has ${Object.keys(this.client.myFriends).length} friends.`);
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
            if (sharedSecret) {
                callback(SteamTotp.generateAuthCode(sharedSecret));
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
            console.error('Steam error:', err);
        });

        this.client.on('user', (sid: any, user: any) => {
            this.handleUserUpdate(sid.getSteamID64(), user);
        });

        // Periodically update mappings in case new users register
        this.updateInterval = setInterval(() => this.updateUserMappings(), 60000);
    }

    stop(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        this.client.logOff();
    }

    async updateUserMappings(): Promise<void> {
        try {
            const settings = await this.dao.getAllUserSettings();
            const newMappings: Record<string, number> = {};
            const steamIds: string[] = [];
            for (const [tgId, data] of Object.entries<UserSettings>(settings)) {
                const sids = data.steam_ids || (data.steam_id ? [data.steam_id] : []);
                for (const steamId of sids) {
                    newMappings[steamId] = Number(tgId);
                    steamIds.push(steamId);

                    if (this.client.myFriends && this.client.myFriends[steamId] !== SteamUser.EFriendRelationship.Friend) {
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

        console.debug(`Received Steam update for tracked user: ${playerName} (${steamId}). Playing game ID: ${gameId}`, user);

        // Check if playing CS2
        const isPlayingCS2 = gameId == this.appIdCS2;
        if (!isPlayingCS2) {
            if (gameId) {
                console.debug(`User ${playerName} (${steamId}) is playing something else (ID: ${gameId}), ignoring.`);
            } else {
                console.debug(`User ${playerName} (${steamId}) is not playing anything, ignoring.`);
            }
            return;
        }

        console.debug(`User update: ${playerName} (${steamId}) is playing CS2`);

        // Extract game info from rich presence
        let map: string | undefined, status: string | undefined, score: string | undefined;
        const rp = user.rich_presence;
        if (Array.isArray(rp)) {
            map = rp.find((i: SteamRichPresenceItem) => i.key === 'game:map' || i.key === 'map')?.value;
            status = rp.find((i: SteamRichPresenceItem) => i.key === 'status')?.value;
            score = rp.find((i: SteamRichPresenceItem) => i.key === 'game:score' || i.key === 'score')?.value;
        } else if (rp && typeof rp === 'object') {
            map = rp['game:map'] || rp['map'];
            status = rp['status'];
            score = rp['game:score'] || rp['score'];
        }

        if (user.rich_presence_string) {
            // If we have a rich_presence_string, it's usually the most user-friendly summary
            status = user.rich_presence_string;
        }

        if (score) {
            score = this.formatScore(score);
        }

        if (map || status || score) {
            console.debug(`Rich presence for ${playerName}: map=${map}, status=${status}, score=${score}`);
        }

        const info: GameUpdateInfo = { gameId, map, status, score };

        // If no map/status yet, maybe it's just starting
        let text = `*${escapeMarkdown(playerName)}* is playing Counter-Strike`;
        if (map || status || score) text += `\n`;
        if (map) text += `\nMap: ${escapeMarkdown(map)}`;
        if (status) text += `\nStatus: ${escapeMarkdown(status)}`;
        if (score) text += `\nScore: ${escapeMarkdown(score)}`;

        const chats = await this.dao.getUserChats(tgUserId);
        if (chats.length === 0) {
            console.debug(`No chats found for user ${tgUserId} (Steam ID: ${steamId}). Cannot publish update.`);
        }
        for (const chatId of chats) {
            const chatSettings: ChatSettings = await this.dao.getChatSettings(chatId);
            if (chatSettings.steam_updates === false) {
                console.debug(`Steam updates are disabled for chat ${chatId}. Skipping update for user ${tgUserId}.`);
                continue;
            }
            console.debug(`Publishing update for user ${tgUserId} to chat ${chatId}`);
            await this.publishUpdate(chatId, tgUserId, text, info);
        }
    }

    async publishUpdate(chatId: number, tgUserId: number, text: string, info: GameUpdateInfo): Promise<void> {
        try {
            const lastUpdate: GameUpdate = await this.dao.getGameUpdate(chatId, tgUserId);
            
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
                    await this.dao.updateGameUpdateText(chatId, tgUserId, text, info);
                    return;
                } catch (err: any) {
                    if (err.message && err.message.includes('message is not modified')) {
                        console.log(`Message ${lastUpdate.message_id} in chat ${chatId} was already up to date according to Telegram.`);
                        // Still update our DAO to match what Telegram has (or what we think it should have)
                        await this.dao.updateGameUpdateText(chatId, tgUserId, text, info);
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
                await this.dao.setGameUpdate(chatId, tgUserId, sentMessage.message_id, text, info);
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
}

export default SteamService;
