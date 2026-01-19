const { v4: uuid } = require('uuid');
const { checkNotEmpty } = require('../utils');
const { loadJSON, saveJSON } = require('./S3Client');

const FILE_ROLLCALL_PLAYERS = 'rollcall_players.json';
const FILE_ROLLCALL_SCHEDULES = 'rollcall_schedules.json';
const FILE_USER_SETTINGS = 'user_settings.json';

class DAO {
    constructor() {
        this.locks = new Map();
    }

    async _withLock(key, fn) {
        if (!this.locks.has(key)) {
            this.locks.set(key, Promise.resolve());
        }
        const lock = this.locks.get(key);
        const nextLock = lock.then(async () => {
            try {
                return await fn();
            } catch (err) {
                // We want to return the error but ensure the lock continues
                throw err;
            }
        });
        // Ensure the next lock doesn't fail just because this one did
        this.locks.set(key, nextLock.catch(() => {}));
        return nextLock;
    }

    getUserSettings(user_id) {
        return loadJSON(FILE_USER_SETTINGS)
            .then(settings => settings[user_id] || {});
    }

    getAllUserSettings() {
        return loadJSON(FILE_USER_SETTINGS);
    }

    setSteamUserId(user_id, steam_id) {
        return this._withLock(FILE_USER_SETTINGS, () => {
            return loadJSON(FILE_USER_SETTINGS)
                .then(settings => {
                    if (!settings[user_id]) settings[user_id] = {};
                    const steamIds = Array.isArray(steam_id) ? steam_id : [steam_id];
                    settings[user_id].steam_id = steamIds[0];
                    settings[user_id].steam_ids = steamIds;
                    return saveJSON(FILE_USER_SETTINGS, settings);
                });
        });
    }

    getUserTimezone(user_id) {
        return this.getUserSettings(user_id)
            .then(settings => settings.timezone || 'UTC');
    }

    setUserTimezone(user_id, timezone) {
        return this._withLock(FILE_USER_SETTINGS, () => {
            return loadJSON(FILE_USER_SETTINGS)
                .then(settings => {
                    if (!settings[user_id]) settings[user_id] = {};
                    settings[user_id].timezone = timezone;
                    return saveJSON(FILE_USER_SETTINGS, settings);
                });
        });
    }

    addUserChat(user_id, chat_id) {
        const key = `user_chats/${user_id}.json`;
        return this._withLock(key, () => {
            return loadJSON(key)
                .then(userChats => {
                    const chats = Array.isArray(userChats) ? userChats : [];
                    if (!chats.includes(chat_id)) {
                        chats.push(chat_id);
                        return saveJSON(key, chats).then(() => true);
                    }
                    return false;
                });
        });
    }

    getUserChats(user_id) {
        const key = `user_chats/${user_id}.json`;
        return loadJSON(key)
            .then(userChats => Array.isArray(userChats) ? userChats : []);
    }

    getChatSettings(chat_id) {
        const key = `chat_settings/${chat_id}.json`;
        return loadJSON(key);
    }

    setChatSettings(chat_id, newSettings) {
        const key = `chat_settings/${chat_id}.json`;
        return this._withLock(key, () => {
            return loadJSON(key)
                .then(settings => {
                    const updated = {
                        ...settings,
                        ...newSettings
                    };
                    return saveJSON(key, updated);
                });
        });
    }

    getGameUpdate(chat_id, user_id) {
        const key = `game_updates/${chat_id}_${user_id}.json`;
        return loadJSON(key);
    }

    setGameUpdate(chat_id, user_id, message_id, text, info = {}) {
        const key = `game_updates/${chat_id}_${user_id}.json`;
        return this._withLock(key, () => {
            const update = {
                message_id,
                text,
                info,
                timestamp: new Date().toISOString()
            };
            return saveJSON(key, update);
        });
    }

    updateGameUpdateText(chat_id, user_id, text, info = {}) {
        const key = `game_updates/${chat_id}_${user_id}.json`;
        return this._withLock(key, () => {
            return loadJSON(key)
                .then(update => {
                    if (update && update.message_id) {
                        update.text = text;
                        update.info = info;
                        return saveJSON(key, update);
                    }
                });
        });
    }

    getScheduledRollcalls() {
        return loadJSON(FILE_ROLLCALL_SCHEDULES);
    }

    setScheduledRollcall(chat_id, time) {
        return this._withLock(FILE_ROLLCALL_SCHEDULES, () => {
            return loadJSON(FILE_ROLLCALL_SCHEDULES)
                .then(schedules => {
                    schedules[chat_id] = time.toISOString();
                    return saveJSON(FILE_ROLLCALL_SCHEDULES, schedules);
                });
        });
    }

    removeScheduledRollcall(chat_id) {
        return this._withLock(FILE_ROLLCALL_SCHEDULES, () => {
            return loadJSON(FILE_ROLLCALL_SCHEDULES)
                .then(schedules => {
                    delete schedules[chat_id];
                    return saveJSON(FILE_ROLLCALL_SCHEDULES, schedules);
                });
        });
    }

    _getRollcallPlayers(chat_id) {
        return loadJSON(FILE_ROLLCALL_PLAYERS)
            .then(players => Object.keys(players).reduce((acc, key) => ([
                ...acc,
                {
                    key,
                    ...players[key]
                }
            ]), []))
            .then(players => players.filter(player => String(player?.chat_id) === String(chat_id)));
    }

    getRollcallPlayerUsernames(chat_id) {
        return this._getRollcallPlayers(chat_id)
            .then(players => players.map(player => player.username));
    }

    addRollcallPlayer(chat_id, username) {
        return this._withLock(FILE_ROLLCALL_PLAYERS, () => {
            return loadJSON(FILE_ROLLCALL_PLAYERS)
                .then(players => {
                    const key = uuid();
                    players[key] = {
                        username: checkNotEmpty(username),
                        chat_id: checkNotEmpty(chat_id)
                    };
                    return saveJSON(FILE_ROLLCALL_PLAYERS, players)
                        .then(() => key);
                });
        });
    }

    removeRollcallPlayer(chat_id, username) {
        return this._withLock(FILE_ROLLCALL_PLAYERS, () => {
            return this._getRollcallPlayers(checkNotEmpty(chat_id))
                .then(players => players.find(
                    player => {
                        if (String(player?.chat_id) !== String(chat_id)) {
                            return false;
                        }

                        const storedUsername = player?.username;
                        const inputUsername = checkNotEmpty(username);

                        if (storedUsername === inputUsername) {
                            return true;
                        }

                        // Handle case where stored is [Name](tg://user?id=123) and input is just Name
                        const match = storedUsername.match(/^\[(.*)\]\(tg:\/\/user\?id=\d+\)$/);
                        return match && match[1] === inputUsername;
                    })?.key)
                .then(key => {
                    if (!key) {
                        return false;
                    }

                    return loadJSON(FILE_ROLLCALL_PLAYERS)
                        .then(players => {
                            delete players[key];
                            return saveJSON(FILE_ROLLCALL_PLAYERS, players);
                        })
                        .then(() => true);
                });
        });
    }
}

module.exports = DAO;