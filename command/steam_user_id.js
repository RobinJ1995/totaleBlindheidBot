const DAO = require('../dao/DAO');
const { formatError } = require('../utils');

const dao = new DAO();

module.exports = (bot, msg) => {
    const argument = msg.command?.argument;
    if (!argument || !/^\d{17}$/.test(argument)) {
        msg.reply('Please specify your Steam user id as a SteamID64 (the 17-digit number starting with 7656).');
        return;
    }

    const user_id = msg.from.id;
    console.log(`User ${user_id} set Steam ID to ${argument}`);
    dao.setSteamUserId(user_id, argument)
        .then(() => msg.reply(`Your Steam user id has been set to ${argument}`))
        .catch(err => msg.reply(formatError(err)));
};
