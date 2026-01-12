const SteamUser = require('steam-user');
const DAO = require('./dao/DAO');

class SteamService {
    constructor(api) {
        this.api = api;
        this.client = new SteamUser();
        this.dao = new DAO();
        this.steamToTelegram = {};
        this.appIdCS2 = 730;
    }

    start() {
        const username = process.env.STEAM_USERNAME;
        const password = process.env.STEAM_PASSWORD;
        const sharedSecret = process.env.STEAM_SHARED_SECRET;

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
            console.log('Logged on to Steam');
            this.client.setPersona(SteamUser.EPersonaState.Online);
            this.updateUserMappings();
        });

        this.client.on('steamGuard', (domain, callback, lastCodeWrong) => {
            if (lastCodeWrong) {
                console.error('Last Steam Guard code was wrong.');
            }
            if (sharedSecret) {
                const SteamTotp = require('steam-totp');
                callback(SteamTotp.generateAuthCode(sharedSecret));
            } else {
                console.warn(`Steam Guard code needed${domain ? ' (email to ' + domain + ')' : ' (mobile)'}. Please set STEAM_SHARED_SECRET.`);
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
                }
            }
            this.steamToTelegram = newMappings;
            console.log(`Updated user mappings. Tracking ${steamIds.length} Steam users.`);
            if (steamIds.length > 0 && this.client.steamID) {
                this.client.getPersonas(steamIds);
            }
        } catch (err) {
            console.error('Error updating user mappings:', err);
        }
    }

    async handleUserUpdate(steamId, user) {
        const tgUserId = this.steamToTelegram[steamId];
        if (!tgUserId) return;

        // Check if playing CS2
        const isPlayingCS2 = user.game_id == this.appIdCS2;
        if (!isPlayingCS2) return;

        const playerName = user.player_name || user.persona_name || 'A user';
        console.log(`User update: ${playerName} (${steamId}) is playing CS2`);

        // Extract game info from rich presence
        const rp = user.rich_presence || [];
        const map = rp.find(i => i.key === 'map')?.value;
        const status = rp.find(i => i.key === 'status')?.value;

        if (map || status) {
            console.log(`Rich presence for ${playerName}: map=${map}, status=${status}`);
        }

        // If no map/status yet, maybe it's just starting
        let text = `*${playerName}* is playing Counter-Strike`;
        if (map) text += `\nMap: ${map}`;
        if (status) text += `\nStatus: ${status}`;

        const chats = await this.dao.getUserChats(tgUserId);
        for (const chatId of chats) {
            await this.publishUpdate(chatId, tgUserId, text);
        }
    }

    async publishUpdate(chatId, tgUserId, text) {
        try {
            const lastUpdate = await this.dao.getGameUpdate(chatId, tgUserId);
            
            // Avoid redundant updates
            if (lastUpdate && lastUpdate.text === text) {
                return;
            }

            const now = new Date();
            const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

            if (lastUpdate && new Date(lastUpdate.timestamp) > sixHoursAgo) {
                // Update existing message
                try {
                    console.log(`Editing message ${lastUpdate.message_id} in chat ${chatId} for user ${tgUserId}`);
                    await this.api.editMessageText({
                        chat_id: chatId,
                        message_id: lastUpdate.message_id,
                        parse_mode: 'Markdown',
                        text: text
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
            const sentMessage = await this.api.sendMessage({
                chat_id: chatId,
                parse_mode: 'Markdown',
                text: text
            });
            if (sentMessage && sentMessage.message_id) {
                await this.dao.setGameUpdate(chatId, tgUserId, sentMessage.message_id, text);
            }
        } catch (err) {
            console.error(`Error publishing update to chat ${chatId}:`, err);
        }
    }
}

module.exports = SteamService;
