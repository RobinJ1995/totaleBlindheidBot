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

module.exports = (api, message) => {
    dao.getRollcallPlayerUsernames(message.message?.chat?.id)
        .then(players => message.reply(`${pickRandom(QUOTES)}\n${players.join(' ')}`))
        .catch(err => message.reply(`*${err.toString()}*`));
};