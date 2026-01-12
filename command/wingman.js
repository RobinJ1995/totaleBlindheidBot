const { pickRandom } = require('../utils');
const DAO = require('../dao/DAO');

const dao = new DAO();

const QUOTES = [
    "Be my wingman!",
    "Be my wingman yo!",
    "Let's score some!",
    "I'm a single pringle and ready to mingle!"
];

module.exports = (bot, msg) => {
    dao.getRollcallPlayerUsernames(msg.chat?.id)
        .then(players => msg.reply(`${pickRandom(QUOTES)}\n${players.join(' ')}`))
        .catch(err => msg.reply(`*${err.toString()}*`));
};