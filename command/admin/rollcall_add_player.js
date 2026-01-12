const { formatError } = require('../../utils');
const DAO = require('../../dao/DAO');

const dao = new DAO();

module.exports = (bot, msg) => {
    const args = msg.command?.argumentTokens;
    const mentions = (msg.entities || []).filter(entity => entity?.type === 'mention' || entity?.type === 'text_mention');

    if (args.length === 0) {
        msg.reply('Who would you like to add?');
        return;
    } else if (args.length !== mentions.length) {
        msg.reply(`${args.length} arguments contained ${mentions.length} user mentions.`);
        return;
    } else if (args.length !== new Set(args).size) {
        msg.reply('Seems you\'ve got some duplicate entries in there, bud!');
        return;
    }

    const players = args.map((arg, i) => {
        const mention = mentions[i];
        if (mention?.type === 'text_mention') {
            return `[${arg}](tg://user?id=${mention.user.id})`;
        }
        return arg;
    });

    dao.getRollcallPlayerUsernames(msg.chat.id)
        .then(existingPlayers => players.forEach(player => {
            if (existingPlayers.includes(player)) {
                throw new Error(`Player ${player} is already in the rollcall.`);
            }
        }))
        .then(() => Promise.all(players.map(player => dao.addRollcallPlayer(msg.chat.id, player))))
        .then(() => msg.reply(`Added ${args.length} players to rollcall.`))
        .catch(err => msg.reply(formatError(err)));
}