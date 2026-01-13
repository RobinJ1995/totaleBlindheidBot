const DAO = require('../dao/DAO');
const { formatError } = require('../utils');

const dao = new DAO();

module.exports = (bot, msg) => {
    const arg = msg.command?.argument?.toLowerCase();
    if (arg !== 'on' && arg !== 'off') {
        msg.reply('Please specify "on" or "off" to enable or disable Steam updates for this chat.');
        return;
    }

    const enabled = arg === 'on';
    dao.setChatSettings(msg.chat.id, { steam_updates: enabled })
        .then(() => msg.reply(`Steam updates for this chat have been turned ${arg}.`))
        .catch(err => msg.reply(formatError(err)));
};
