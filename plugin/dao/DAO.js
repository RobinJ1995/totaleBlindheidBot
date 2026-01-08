const { v4: uuid } = require('uuid');
const { checkNotEmpty } = require('../utils');
const { loadJSON, saveJSON } = require('./S3Client');

const FILE_ROLLCALL_PLAYERS = 'rollcall_players.json';

class DAO {
    _getRollcallPlayers(chat_id) {
        return loadJSON(FILE_ROLLCALL_PLAYERS)
            .then(players => Object.keys(players).reduce((acc, key) => ([
                ...acc,
                {
                    key,
                    ...players[key]
                }
            ]), []))
            .then(players => players.filter(player => player?.chat_id === chat_id));
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
                player => player?.chat_id === chat_id && player?.username === checkNotEmpty(username))?.key)
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