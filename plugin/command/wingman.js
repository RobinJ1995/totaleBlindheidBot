const { pickRandom } = require('../utils');
const DAO = require('../dao/DAO');

const dao = new DAO();

const QUOTES = [
    "Be my wingman!",
    "Be my wingman yo!",
    "Let's score some!",
    "I'm a single pringle and ready to mingle!"
];

module.exports = (api, message) => {
    dao.getRollcallPlayerUsernames(message.message?.chat?.id)
        .then(players => message.reply(`${pickRandom(QUOTES)}\n${players.join(' ')}`))
        .catch(err => message.reply(`*${err.toString()}*`));
};