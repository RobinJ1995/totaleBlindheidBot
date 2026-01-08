const { formatError } = require('../../utils');
const DAO = require('../../dao/DAO');

const dao = new DAO();

module.exports = (api, message) => {
    const args = message.meta.command?.argumentTokens;
    const mentions = (message.message.entities || []).filter(entity => entity?.type === 'mention' || entity?.type === 'text_mention');

    if (args.length === 0) {
        message.reply('Who would you like to remove?');
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

    Promise.all(players.map(player => dao.removeRollcallPlayer(message.message.chat.id, player)))
        .then(results => {
            if (results.every(r => r === false)) {
                message.reply('Who are they?');
                return;
            }

            message.reply('Poof! They\'re gone!')
        })
        .catch(err => message.reply(formatError(err)));
}