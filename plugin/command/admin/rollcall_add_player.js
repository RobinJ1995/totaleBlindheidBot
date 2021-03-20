const { formatError } = require('../../utils');
const DAO = require('../../dao/DAO');

const dao = new DAO();

module.exports = (api, message) => {
    const args = message.meta.command?.argumentTokens;
    const mentions = message.message.entities.filter(entity => entity?.type === 'mention');

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

    dao.getRollcallPlayerUsernames(message.message.chat.id)
        .then(existingPlayers => existingPlayers.forEach(existingPlayer => {
            if (args.includes(existingPlayer)) {
                throw new Error(`Player ${existingPlayer} is already in the rollcall.`);
            }
        }))
        .then(() => Promise.all(args.map(player => dao.addRollcallPlayer(message.message.chat.id, player))))
        .then(() => message.reply(`Added ${args.length} players to rollcall.`))
        .catch(err => message.reply(formatError(err)));
}