const { formatError, escapeMarkdown } = require('../../utils');
const DAO = require('../../dao/DAO');

const dao = new DAO();

module.exports = (api, message) => {
    dao.getRollcallPlayerUsernames(message.message.chat.id)
        .then(players => {
            if (players.length === 0) {
                message.reply('No players in the rollcall.');
            } else {
                message.reply(`Players in rollcall:\n${players.map(p => {
                    const match = p.match(/^\[(.*)\]\(tg:\/\/user\?id=\d+\)$/);
                    const displayName = match ? match[1] : p;
                    return escapeMarkdown(displayName).replace('@', '@\u200B');
                }).map(p => `- ${p}`).join('\n')}`);
            }
        })
        .catch(err => message.reply(formatError(err)));
}
