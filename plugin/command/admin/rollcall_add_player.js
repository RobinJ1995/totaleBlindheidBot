const { formatError } = require('../../utils');
const DAO = require('../../dao/DAO');

const dao = new DAO();

module.exports = (api, message) => {
    const args = message.meta.command?.argumentTokens;
    const mentions = (message.message.entities || []).filter(entity => entity?.type === 'mention' || entity?.type === 'text_mention');

    if (args.length === 0) {
        message.reply('Who would you like to add?');
        return;
    } else if (args.length !== mentions.length) {
        message.reply(`${args.length} arguments contained ${mentions.length} user mentions.`);
        return;
    } else if (args.length !== new Set(args).size) {
        message.reply('Seems you\'ve got some duplicate entries in there, bud!');
        return;
    }

    const players = args.map((arg, i) => {
        const mention = mentions[i];
        if (mention?.type === 'text_mention') {
            return `[${arg}](tg://user?id=${mention.user.id})`;
        }
        return arg;
    });

    dao.getRollcallPlayerUsernames(message.message.chat.id)
        .then(existingPlayers => players.forEach(player => {
            if (existingPlayers.includes(player)) {
                throw new Error(`Player ${player} is already in the rollcall.`);
            }
        }))
        .then(() => Promise.all(players.map(player => dao.addRollcallPlayer(message.message.chat.id, player))))
        .then(() => message.reply(`Added ${args.length} players to rollcall.`))
        .catch(err => message.reply(formatError(err)));
}