const SteamUser = require('steam-user');
const DAO = require('./dao/DAO');

class SteamService {
    constructor(bot) {
        this.bot = bot;
        this.client = new SteamUser();
        this.dao = new DAO();
        this.steamToTelegram = {};
        this.appIdCS2 = 730;
        this.steamGuardCallback = null;
        this.adminUserId = process.env.STEAM_ADMIN_TELEGRAM_USER_ID;
        SteamService.instance = this;
    }

    start() {
        const username = process.env.STEAM_USERNAME;
        const password = process.env.STEAM_PASSWORD;
        const sharedSecret = process.env.STEAM_SHARED_SECRET;

        console.log(`Starting SteamService for user: ${username}`);

        if (!username || !password) {
            console.warn('STEAM_USERNAME or STEAM_PASSWORD not set. SteamService will not start.');
            return;
        }

        const logOnOptions = {
            accountName: username,
            password: password
        };

        if (sharedSecret) {
            const SteamTotp = require('steam-totp');
            logOnOptions.twoFactorCode = SteamTotp.generateAuthCode(sharedSecret);
        }

        this.client.logOn(logOnOptions);

        this.client.on('loggedOn', () => {
            console.log(`Logged on to Steam as ${this.client.steamID.getSteamID64()}`);
            this.client.setPersona(SteamUser.EPersonaState.Online);
            this.updateUserMappings();
        });

        this.client.on('friendsList', () => {
            console.log(`Friends list loaded. Bot has ${Object.keys(this.client.myFriends).length} friends.`);
            this.updateUserMappings();
        });

        this.client.on('steamGuard', (domain, callback, lastCodeWrong) => {
            if (lastCodeWrong) {
                console.error('Last Steam Guard code was wrong.');
                if (this.adminUserId) {
                    this.bot.sendMessage(this.adminUserId, 'Last Steam Guard code was wrong. Please try again with /steam_guard <code>')
                        .catch(err => console.error('Failed to send error to admin:', err));
                }
            }
            if (sharedSecret) {
                const SteamTotp = require('steam-totp');
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

        this.client.on('error', (err) => {
            console.error('Steam error:', err);
        });

        this.client.on('user', (sid, user) => {
            this.handleUserUpdate(sid.getSteamID64(), user);
        });

        // Periodically update mappings in case new users register
        this.updateInterval = setInterval(() => this.updateUserMappings(), 60000);
    }

    stop() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        this.client.logOff();
    }

    async updateUserMappings() {
        try {
            const settings = await this.dao.getAllUserSettings();
            const newMappings = {};
            const steamIds = [];
            for (const [tgId, data] of Object.entries(settings)) {
                if (data.steam_id) {
                    newMappings[data.steam_id] = tgId;
                    steamIds.push(data.steam_id);

                    if (this.client.myFriends && this.client.myFriends[data.steam_id] !== SteamUser.EFriendRelationship.Friend) {
                        console.warn(`Tracked user ${tgId} (Steam ID: ${data.steam_id}) is NOT a friend of the bot account. Updates might not work.`);
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

    async handleUserUpdate(steamId, user) {
        /* Example user update format for CS2:
{
  rich_presence: [
    { key: 'status', value: 'Offline Competitive Vertigo' },
    { key: 'version', value: '14129' },
    { key: 'game:xptrail', value: '0' },
    { key: 'game:state', value: 'game' },
    { key: 'game:mode', value: 'competitive' },
    { key: 'game:act', value: 'offline' },
    { key: 'steam_display', value: '#display_GameKnownMap' },
    { key: 'game:map', value: 'de_vertigo' },
    { key: 'game:server', value: 'offline' }
  ],
  persona_state: 1,
  game_played_app_id: 730,
  game_server_ip: null,
  game_server_port: null,
  persona_state_flags: 1,
  online_session_instances: 1,
  persona_set_by_user: null,
  player_name: 'Robin',
  query_port: null,
  steamid_source: '0',
  avatar_hash: <Buffer>,
  last_logoff: 2026-01-12T22:13:07.000Z,
  last_logon: 2026-01-12T22:15:04.000Z,
  last_seen_online: 2026-01-12T22:13:07.000Z,
  clan_rank: null,
  game_name: '',
  gameid: '730',
  game_data_blob: <Buffer>,
  clan_data: null,
  clan_tag: null,
  broadcast_id: '0',
  game_lobby_id: '0',
  watching_broadcast_accountid: null,
  watching_broadcast_appid: null,
  watching_broadcast_viewers: null,
  watching_broadcast_title: null,
  is_community_banned: null,
  player_name_pending_review: false,
  avatar_pending_review: false,
  avatar_url_icon: '*',
  avatar_url_medium: '*',
  avatar_url_full: '*',
  rich_presence_string: 'Competitive - Vertigo'
}
         */
        const playerName = user.player_name || user.persona_name || 'Unknown';
        const gameId = user.gameid;
        
        const tgUserId = this.steamToTelegram[steamId];
        if (!tgUserId) {
            console.log(`Received Steam update for non-tracked user: ${playerName} (${steamId})`);
            return;
        }

        console.log(`Received Steam update for tracked user: ${playerName} (${steamId}). Playing game ID: ${gameId}`, user);

        // Check if playing CS2
        const isPlayingCS2 = gameId == this.appIdCS2;
        if (!isPlayingCS2) {
            if (gameId) {
                console.log(`User ${playerName} (${steamId}) is playing something else (ID: ${gameId}), ignoring.`);
            } else {
                console.log(`User ${playerName} (${steamId}) is not playing anything, ignoring.`);
            }
            return;
        }

        console.log(`User update: ${playerName} (${steamId}) is playing CS2`);

        // Extract game info from rich presence
        let map, status, score;
        const rp = user.rich_presence;
        if (Array.isArray(rp)) {
            map = rp.find(i => i.key === 'game:map' || i.key === 'map')?.value;
            status = rp.find(i => i.key === 'status')?.value;
            score = rp.find(i => i.key === 'game:score' || i.key === 'score')?.value;
        } else if (rp && typeof rp === 'object') {
            map = rp['game:map'] || rp['map'];
            status = rp['status'];
            score = rp['game:score'] || rp['score'];
        }

        if (user.rich_presence_string) {
            // If we have a rich_presence_string, it's usually the most user-friendly summary
            status = user.rich_presence_string;
        }

        if (map || status || score) {
            console.log(`Rich presence for ${playerName}: map=${map}, status=${status}, score=${score}`);
        }

        // If no map/status yet, maybe it's just starting
        let text = `*${playerName}* is playing Counter-Strike`;
        if (map) text += `\nMap: ${map}`;
        if (status) text += `\nStatus: ${status}`;
        if (score) text += `\nScore: ${score}`;

        const chats = await this.dao.getUserChats(tgUserId);
        if (chats.length === 0) {
            console.log(`No chats found for user ${tgUserId} (Steam ID: ${steamId}). Cannot publish update.`);
        }
        for (const chatId of chats) {
            console.log(`Publishing update for user ${tgUserId} to chat ${chatId}`);
            await this.publishUpdate(chatId, tgUserId, text);
        }
    }

    async publishUpdate(chatId, tgUserId, text) {
        try {
            const lastUpdate = await this.dao.getGameUpdate(chatId, tgUserId);
            
            // Avoid redundant updates
            if (lastUpdate && lastUpdate.text === text) {
                console.log(`Update for user ${tgUserId} in chat ${chatId} is redundant (text hasn't changed), skipping.`);
                return;
            }

            const now = new Date();
            const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

            if (lastUpdate && new Date(lastUpdate.timestamp) > sixHoursAgo) {
                console.log(`Last update for user ${tgUserId} in chat ${chatId} was at ${lastUpdate.timestamp} (less than 6h ago). Attempting to edit message ${lastUpdate.message_id}.`);
                // Update existing message
                try {
                    console.log(`Editing message ${lastUpdate.message_id} in chat ${chatId} for user ${tgUserId}`);
                    await this.bot.editMessageText(text, {
                        chat_id: chatId,
                        message_id: lastUpdate.message_id,
                        parse_mode: 'Markdown'
                    });
                    // Keep original timestamp, but update text
                    await this.dao.updateGameUpdateText(chatId, tgUserId, text);
                    return;
                } catch (err) {
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
                await this.dao.setGameUpdate(chatId, tgUserId, sentMessage.message_id, text);
            }
        } catch (err) {
            console.error(`Error publishing update to chat ${chatId}:`, err);
        }
    }

    submitSteamGuardCode(code) {
        if (this.steamGuardCallback) {
            this.steamGuardCallback(code);
            this.steamGuardCallback = null;
            return true;
        }
        return false;
    }
}

SteamService.instance = null;

module.exports = SteamService;
