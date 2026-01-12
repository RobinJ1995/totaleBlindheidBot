const SteamService = require('../SteamService');

module.exports = (bot, msg) => {
    const adminId = process.env.STEAM_ADMIN_TELEGRAM_USER_ID;
    if (adminId && String(msg.from.id) !== String(adminId)) {
        console.warn(`Unauthorized attempt to use /steam_guard by user ${msg.from.id}`);
        return;
    }

    const code = msg.command?.argument;
    if (!code) {
        msg.reply('Please specify the Steam Guard code.');
        return;
    }

    const steamService = SteamService.instance;
    if (!steamService) {
        msg.reply('Steam service is not enabled.');
        return;
    }

    if (steamService.submitSteamGuardCode(code)) {
        msg.reply('Steam Guard code submitted. Checking...');
    } else {
        msg.reply('No Steam Guard code is currently requested, or it was already provided.');
    }
};
