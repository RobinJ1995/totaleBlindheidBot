const { formatError, escapeMarkdown } = require('../../utils');
const DAO = require('../../dao/DAO');

const dao = new DAO();

module.exports = (bot, msg) => {
    dao.getRollcallPlayerUsernames(msg.chat.id)
        .then(players => {
            if (players.length === 0) {
                msg.reply('No players in the rollcall.');
            } else {
                msg.reply(`Players in rollcall:\n${players.map(p => {
                    const match = p.match(/^\[(.*)\]\(tg:\/\/user\?id=\d+\)$/);
                    const displayName = match ? match[1] : p;
                    return escapeMarkdown(displayName).replace('@', '@\u200B');
                }).map(p => `- ${p}`).join('\n')}`);
            }
        })
        .catch(err => msg.reply(formatError(err)));
}
