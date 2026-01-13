const DAO = require('../dao/DAO');
const { formatError } = require('../utils');

const dao = new DAO();

module.exports = (bot, msg) => {
    const args = msg.command?.argumentTokens || [];
    const adminId = process.env.STEAM_ADMIN_TELEGRAM_USER_ID;
    const isAdmin = adminId && String(msg.from.id) === String(adminId);

    if (isAdmin && args.length === 2) {
        const [tgUserId, steamId] = args;
        if (!/^\d+$/.test(tgUserId)) {
            msg.reply('Invalid Telegram user ID.');
            return;
        }
        if (!/^\d{17}$/.test(steamId)) {
            msg.reply('Invalid Steam ID. Must be 17 digits.');
            return;
        }

        console.log(`Admin ${msg.from.id} set Steam ID for user ${tgUserId} to ${steamId}`);
        dao.setSteamUserId(tgUserId, steamId)
            .then(() => msg.reply(`Steam user id for user ${tgUserId} has been set to ${steamId}`))
            .catch(err => msg.reply(formatError(err)));
        return;
    }

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
