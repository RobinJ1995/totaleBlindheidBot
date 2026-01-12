const SteamService = require('../SteamService');

module.exports = (api, message) => {
    const adminId = process.env.STEAM_ADMIN_TELEGRAM_USER_ID;
    if (adminId && String(message.message.from.id) !== String(adminId)) {
        console.warn(`Unauthorized attempt to use /steam_guard by user ${message.message.from.id}`);
        return;
    }

    const code = message.meta.command?.argument;
    if (!code) {
        message.reply('Please specify the Steam Guard code.');
        return;
    }

    const steamService = SteamService.instance;
    if (!steamService) {
        message.reply('Steam service is not enabled.');
        return;
    }

    if (steamService.submitSteamGuardCode(code)) {
        message.reply('Steam Guard code submitted. Checking...');
    } else {
        message.reply('No Steam Guard code is currently requested, or it was already provided.');
    }
};
