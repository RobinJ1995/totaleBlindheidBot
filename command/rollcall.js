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

const executeRollcall = (bot, chat_id, reply_to_message_id) => {
    return dao.getRollcallPlayerUsernames(chat_id)
        .then(players => bot.sendMessage(chat_id, `${pickRandom(QUOTES)}\n${players.join(' ')}`, {
            reply_to_message_id,
            parse_mode: 'Markdown'
        }));
};

module.exports = (bot, msg) => {
    executeRollcall(bot, msg.chat?.id, msg.message_id)
        .catch(err => msg.reply(`*${err.toString()}*`));
};

module.exports.executeRollcall = executeRollcall;