const DAO = require('../dao/DAO');
const { formatError } = require('../utils');

const dao = new DAO();

module.exports = (bot, msg) => {
    const args = msg.command?.argumentTokens || [];
    const adminId = process.env.STEAM_ADMIN_TELEGRAM_USER_ID;
    const isAdmin = adminId && String(msg.from.id) === String(adminId);

    const parseAndValidate = (arg) => {
        const ids = arg.split(',').map(s => s.trim()).filter(s => s.length > 0);
        const valid = ids.length > 0 && ids.every(id => /^\d{17}$/.test(id));
        return { ids, valid };
    };

    if (isAdmin && args.length === 2) {
        const [tgUserId, steamIdArg] = args;
        if (!/^\d+$/.test(tgUserId)) {
            msg.reply('Invalid Telegram user ID.');
            return;
        }

        const { ids, valid } = parseAndValidate(steamIdArg);
        if (!valid) {
            msg.reply('Invalid Steam ID(s). Each must be a 17-digit number (SteamID64) starting with 7656.');
            return;
        }

        console.log(`Admin ${msg.from.id} set Steam ID(s) for user ${tgUserId} to ${ids.join(', ')}`);
        dao.setSteamUserId(tgUserId, ids)
            .then(() => msg.reply(`Steam user ID(s) for user ${tgUserId} has been set to ${ids.join(', ')}`))
            .catch(err => msg.reply(formatError(err)));
        return;
    }

    const { ids, valid } = parseAndValidate(msg.command?.argument);
    if (!valid) {
        msg.reply('Please specify your Steam user ID(s) as SteamID64 (the 17-digit number starting with 7656), separated by commas if multiple.');
        return;
    }

    const user_id = msg.from.id;
    console.log(`User ${user_id} set Steam ID(s) to ${ids.join(', ')}`);
    dao.setSteamUserId(user_id, ids)
        .then(() => msg.reply(`Your Steam user ID(s) has been set to ${ids.join(', ')}`))
        .catch(err => msg.reply(formatError(err)));
};
