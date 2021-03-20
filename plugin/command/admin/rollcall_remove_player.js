const { formatError } = require('../../utils');
const DAO = require('../../dao/DAO');

const dao = new DAO();

module.exports = (api, message) => {
    const args = message.meta.command?.argumentTokens;

    if (args.length === 0) {
        message.reply('Who would you like to remove?');
        return;
    } else if (args.length !== new Set(args).size) {
        message.reply('Seems you\'ve got some duplicate entries in there, bud!');
        return;
    }

    Promise.all(args.map(player => dao.removeRollcallPlayer(message.message.chat.id, player)))
        .then(results => {
            if (results.every(r => r === false)) {
                message.reply('Who are they?');
                return;
            }

            message.reply('Poof! They\'re gone!')
        })
        .catch(err => message.reply(formatError(err)));
}