const fetch = require('node-fetch');
const { checkNotEmpty, httpCheckParse, checkHttpStatus } = require('../utils');

const GIERIGDB_ENDPOINT = checkNotEmpty(process.env.GIERIGDB_ENDPOINT);

const COLL_ROLLCALL_PLAYERS = 'rollcall_players';

class DAO {
    _getRollcallPlayers(chat_id) {
        return fetch(`${GIERIGDB_ENDPOINT}/${COLL_ROLLCALL_PLAYERS}`)
            .then(httpCheckParse)
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
        return fetch(`${GIERIGDB_ENDPOINT}/${COLL_ROLLCALL_PLAYERS}`, {
            method: 'POST',
            body: JSON.stringify({
                username: checkNotEmpty(username),
                chat_id: checkNotEmpty(chat_id)
            })
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

                return fetch(`${GIERIGDB_ENDPOINT}/${COLL_ROLLCALL_PLAYERS}/${checkNotEmpty(key)}`, {
                    method: 'DELETE',
                })
                .then(checkHttpStatus);
            });
    }
}

module.exports = DAO;