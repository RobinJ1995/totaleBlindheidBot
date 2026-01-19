const SteamUser = require('steam-user');
const DAO = require('./dao/DAO');
const { escapeMarkdown } = require('./utils');

class SteamService {
    constructor(bot) {
        this.bot = bot;

        const steamOptions = {};
        if (process.env.S3_BUCKET) {
            console.log(`Using S3 storage for Steam data in bucket: ${process.env.S3_BUCKET}`);
            const { save, readFile } = require('./dao/S3Client');
            steamOptions.dataDirectory = 'data';
            this.client = new SteamUser(steamOptions);
            
            this.client.storage.on('save', (filename, contents, callback) => {
                save(`steam-user/${filename}`, contents)
                    .then(() => callback(null))
                    .catch(callback);
            });

            this.client.storage.on('read', (filename, callback) => {
                readFile(`steam-user/${filename}`)
                    .then(contents => callback(null, contents))
                    .catch(callback);
            });
        } else {
            this.client = new SteamUser();
        }

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
                const sids = data.steam_ids || (data.steam_id ? [data.steam_id] : []);
                for (const steamId of sids) {
                    newMappings[steamId] = tgId;
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
            console.debug(`Received Steam update for non-tracked user: ${playerName} (${steamId})`);
            return;
        }

        console.debug(`Received Steam update for tracked user: ${playerName} (${steamId}). Playing game ID: ${gameId}`, user);

        // Check if playing CS2
        const isPlayingCS2 = gameId == this.appIdCS2;
        
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

        if (score) {
            score = this.formatScore(score);
        }

        const info = { playerName, gameId, map, status, score, isPlaying: isPlayingCS2 };

        const chats = await this.dao.getUserChats(tgUserId);
        for (const chatId of chats) {
            const chatSettings = await this.dao.getChatSettings(chatId);
            if (chatSettings.steam_updates === false) {
                continue;
            }
            await this.updateGroupUpdate(chatId, tgUserId, info);
        }
    }

    async updateGroupUpdate(chatId, tgUserId, info) {
        let session = await this.dao.getGroupGameUpdate(chatId);
        
        if (!session) {
            session = {
                message_id: null,
                active: false,
                users: {}
            };
        }

        const userInSession = session.users[tgUserId];
        
        if (!info.isPlaying) {
            if (!userInSession || !userInSession.isPlaying) {
                // User was not playing and is still not playing, nothing to do
                return;
            }
            // User stopped playing
            session.users[tgUserId].isPlaying = false;
        } else {
            // User is playing
            if (!session.active) {
                // New session starts
                console.log(`Starting new Steam session for chat ${chatId}`);
                session.active = true;
                session.users = {};
                session.message_id = null;
            }

            // PROTECTION LOGIC: Check if new update is less detailed than what we already have
            if (userInSession && userInSession.isPlaying) {
                const oldInfo = userInSession;
                const gameChanged = info.gameId !== oldInfo.gameId;
                const mapChanged = info.map && info.map !== oldInfo.map;
                const meaningfulStatusChanged = info.status && info.status !== oldInfo.status && !this.isGenericStatus(info.status);

                if (!gameChanged && !mapChanged && !meaningfulStatusChanged) {
                    // Critical info is the same. Now check if we are losing detail.
                    const lostScore = oldInfo.score && !info.score;
                    const lostMap = oldInfo.map && !info.map;
                    const lostStatus = oldInfo.status && !this.isGenericStatus(oldInfo.status) && this.isGenericStatus(info.status);

                    if (lostScore || lostMap || lostStatus) {
                        console.log(`New update for user ${tgUserId} is less detailed than existing info for ${info.playerName}. Skipping update.`);
                        return;
                    }
                }
            }

            session.users[tgUserId] = {
                ...info,
                lastUpdate: new Date().toISOString()
            };
        }

        // Check if session is still active
        const activeUsers = Object.values(session.users).filter(u => u.isPlaying);
        const sessionStillActive = activeUsers.length > 0;
        const sessionJustEnded = !sessionStillActive && session.active;
        
        if (sessionJustEnded) {
            session.active = false;
        }

        const text = this.formatGroupMessage(session);

        // Avoid redundant updates if message hasn't changed
        if (session.message_id && session.last_text === text) {
             if (!sessionJustEnded) {
                 return;
             }
        }

        if (session.message_id) {
            // Update existing message
            try {
                console.log(`Editing group message ${session.message_id} in chat ${chatId}`);
                await this.bot.editMessageText(text, {
                    chat_id: chatId,
                    message_id: session.message_id,
                    parse_mode: 'Markdown'
                });
                session.last_text = text;
            } catch (err) {
                if (err.message && err.message.includes('message is not modified')) {
                    // Ignore
                } else if (err.message && (err.message.includes('message to edit not found') || err.message.includes('message can\'t be edited'))) {
                    console.warn(`Group message ${session.message_id} in chat ${chatId} not found or not editable, sending new one.`);
                    session.message_id = null;
                } else {
                    console.error(`Failed to edit group message in ${chatId}:`, err);
                }
            }
        }

        if (!session.message_id && sessionStillActive) {
            // Send new message
            try {
                console.log(`Sending new group message to chat ${chatId}`);
                const sentMessage = await this.bot.sendMessage(chatId, text, {
                    parse_mode: 'Markdown'
                });
                session.message_id = sentMessage.message_id;
                session.last_text = text;
                
                // Pin message
                try {
                    console.log(`Pinning message ${session.message_id} in chat ${chatId}`);
                    await this.bot.pinChatMessage(chatId, session.message_id, {
                        disable_notification: true
                    });
                } catch (pinErr) {
                    console.error(`Failed to pin message in ${chatId}:`, pinErr);
                }
            } catch (err) {
                console.error(`Failed to send group message in ${chatId}:`, err);
            }
        }

        if (sessionJustEnded && session.message_id) {
            // Session just ended
            console.log(`Session ended in chat ${chatId}`);
            try {
                console.log(`Unpinning message ${session.message_id} in chat ${chatId}`);
                await this.bot.unpinChatMessage(chatId, {
                    message_id: session.message_id
                });
            } catch (unpinErr) {
                console.error(`Failed to unpin message in ${chatId}:`, unpinErr);
            }
        }

        await this.dao.setGroupGameUpdate(chatId, session);
    }

    formatGroupMessage(session) {
        const users = Object.values(session.users);
        const activeOnly = session.active;
        
        const playersToShow = activeOnly 
            ? users.filter(u => u.isPlaying) 
            : users;

        if (playersToShow.length === 0) {
            return "No one is playing.";
        }

        // Group users by (map + score + status)
        const groups = [];
        for (const user of playersToShow) {
            const existingGroup = groups.find(g => 
                g.map === user.map && 
                g.score === user.score && 
                g.status === user.status
            );
            if (existingGroup) {
                existingGroup.userNames.push(user.playerName);
            } else {
                groups.push({
                    map: user.map,
                    score: user.score,
                    status: user.status,
                    userNames: [user.playerName]
                });
            }
        }

        const blocks = groups.map(group => {
            let names;
            const escapedNames = group.userNames.map(escapeMarkdown);
            if (escapedNames.length === 1) {
                names = `*${escapedNames[0]}*`;
            } else if (escapedNames.length === 2) {
                names = `*${escapedNames[0]}* and *${escapedNames[1]}*`;
            } else {
                const last = escapedNames.pop();
                names = escapedNames.map(n => `*${n}*`).join(', ') + ` and *${last}*`;
            }

            let text = `${names} ${group.userNames.length > 1 ? 'are' : 'is'} playing Counter-Strike`;
            if (group.map) text += `\nMap: ${escapeMarkdown(group.map)}`;
            if (group.status) text += `\nStatus: ${escapeMarkdown(group.status)}`;
            if (group.score) text += `\nScore: ${escapeMarkdown(group.score)}`;
            return text;
        });

        let finalMessage = blocks.join('\n\n');
        if (!session.active) {
            finalMessage = "🏁 *Session Ended*\n\n" + finalMessage;
        }

        return finalMessage;
    }

    submitSteamGuardCode(code) {
        if (this.steamGuardCallback) {
            this.steamGuardCallback(code);
            this.steamGuardCallback = null;
            return true;
        }
        return false;
    }

    isGenericStatus(status) {
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

    formatScore(score) {
        if (!score) return score;
        // Strip surrounding brackets and whitespace
        const cleanScore = score.replace(/[\[\]]/g, '').trim();
        const numberEmojis = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
        return cleanScore.replace(/\d/g, (match) => numberEmojis[parseInt(match)]);
    }
}

SteamService.instance = null;

module.exports = SteamService;
