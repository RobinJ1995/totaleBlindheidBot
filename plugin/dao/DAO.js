const { v4: uuid } = require('uuid');
const { checkNotEmpty } = require('../utils');
const { loadJSON, saveJSON } = require('./S3Client');

const FILE_ROLLCALL_PLAYERS = 'rollcall_players.json';
const FILE_ROLLCALL_SCHEDULES = 'rollcall_schedules.json';
const FILE_USER_SETTINGS = 'user_settings.json';

class DAO {
    getUserTimezone(user_id) {
        return loadJSON(FILE_USER_SETTINGS)
            .then(settings => settings[user_id]?.timezone || 'UTC');
    }

    setUserTimezone(user_id, timezone) {
        return loadJSON(FILE_USER_SETTINGS)
            .then(settings => {
                if (!settings[user_id]) settings[user_id] = {};
                settings[user_id].timezone = timezone;
                return saveJSON(FILE_USER_SETTINGS, settings);
            });
    }

    getScheduledRollcalls() {
        return loadJSON(FILE_ROLLCALL_SCHEDULES);
    }

    setScheduledRollcall(chat_id, time) {
        return loadJSON(FILE_ROLLCALL_SCHEDULES)
            .then(schedules => {
                schedules[chat_id] = time.toISOString();
                return saveJSON(FILE_ROLLCALL_SCHEDULES, schedules);
            });
    }

    removeScheduledRollcall(chat_id) {
        return loadJSON(FILE_ROLLCALL_SCHEDULES)
            .then(schedules => {
                delete schedules[chat_id];
                return saveJSON(FILE_ROLLCALL_SCHEDULES, schedules);
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
    }

    removeRollcallPlayer(chat_id, username) {
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
    }
}

module.exports = DAO;