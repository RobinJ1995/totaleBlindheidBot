const { pickRandom } = require('../utils');
const DAO = require('../dao/DAO');

const dao = new DAO();

const QUOTES = [
    "Are we rushin' in, or are we going' sneaky-beaky like?",
    "Bingo, bango, bongo, bish, bash, bosh!",
    "Easy peasy, lemon squeezy!",
    "Grab your gear and let's go!",
    "RUSH B DON'T STOP"
];

const executeRollcall = (api, chat_id, reply_to_message_id) => {
    return dao.getRollcallPlayerUsernames(chat_id)
        .then(players => api.sendMessage({
            chat_id,
            reply_to_message_id,
            parse_mode: 'Markdown',
            text: `${pickRandom(QUOTES)}\n${players.join(' ')}`
        }));
};

module.exports = (api, message) => {
    executeRollcall(api, message.message?.chat?.id, message.message?.message_id)
        .catch(err => message.reply(`*${err.toString()}*`));
};

module.exports.executeRollcall = executeRollcall;