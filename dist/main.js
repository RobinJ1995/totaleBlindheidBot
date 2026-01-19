"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const console_stamp_1 = __importDefault(require("console-stamp"));
(0, console_stamp_1.default)(console);
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const DAO_1 = __importDefault(require("./dao/DAO"));
const SteamService_1 = __importDefault(require("./SteamService"));
const rollcall_1 = require("./command/rollcall");
const MessageRouter_1 = __importDefault(require("./MessageRouter"));
const utils_1 = require("./utils");
// Command Handlers
const hi_1 = __importDefault(require("./command/hi"));
const rollcall_2 = __importDefault(require("./command/rollcall"));
const schedule_1 = __importDefault(require("./command/schedule"));
const cancel_1 = __importDefault(require("./command/cancel"));
const timezone_1 = __importDefault(require("./command/timezone"));
const wingman_1 = __importDefault(require("./command/wingman"));
const steam_user_id_1 = __importDefault(require("./command/steam_user_id"));
const steam_updates_1 = __importDefault(require("./command/steam_updates"));
const steam_guard_1 = __importDefault(require("./command/steam_guard"));
const rollcall_add_player_1 = __importDefault(require("./command/admin/rollcall_add_player"));
const rollcall_remove_player_1 = __importDefault(require("./command/admin/rollcall_remove_player"));
const rollcall_get_players_1 = __importDefault(require("./command/admin/rollcall_get_players"));
if (!process.env.LOG_DEBUG) {
    console.debug = () => { };
}
const token = process.env.TELEGRAM_BOT_API_TOKEN;
if (!token) {
    console.error('TELEGRAM_BOT_API_TOKEN is not set');
    process.exit(1);
}
const bot = new node_telegram_bot_api_1.default(token, { polling: true });
const dao = new DAO_1.default();
const steamEnabled = !!(process.env.STEAM_USERNAME && process.env.STEAM_PASSWORD);
// Scheduler
setInterval(() => {
    dao.getScheduledRollcalls()
        .then((schedules) => {
        const now = new Date();
        for (const [chat_id, timeIso] of Object.entries(schedules)) {
            const scheduledTime = new Date(timeIso);
            if (scheduledTime <= now) {
                console.log(`Executing scheduled rollcall for chat ${chat_id}`);
                (0, rollcall_1.executeRollcall)(bot, parseInt(chat_id))
                    .catch((err) => console.error(`Error executing scheduled rollcall for ${chat_id}:`, err))
                    .finally(() => dao.removeScheduledRollcall(chat_id));
            }
        }
    })
        .catch((err) => console.error('Error checking schedules:', err));
}, 30000);
// Steam Service
let steamService = null;
if (steamEnabled) {
    steamService = new SteamService_1.default(bot);
    steamService.start();
}
const router = new MessageRouter_1.default(bot);
router.route('hi', hi_1.default, {
    helpText: 'Craving that small talk, are you?'
});
router.route('rollcall', rollcall_2.default, {
    helpText: 'Anyone wanna play?'
});
router.route('schedule', schedule_1.default, {
    helpText: 'Schedule a rollcall for a specific time.'
});
router.route('cancel', cancel_1.default, {
    helpText: 'Cancel a scheduled rollcall.'
});
router.route('timezone', timezone_1.default, {
    helpText: 'Set or view your timezone for rollcall scheduling.'
});
router.route('wingman', wingman_1.default, {
    helpText: 'Looking for a wingman?'
});
if (steamEnabled) {
    router.route('steam_user_id', steam_user_id_1.default, {
        helpText: 'Set your Steam user ID(s) for live game updates. Either single ID or comma-separated.'
    });
    router.route('steam_updates', steam_updates_1.default, {
        helpText: 'Enable or disable Steam updates for this chat (on/off).'
    });
    router.route('steam_guard', steam_guard_1.default, {
        helpText: 'Submit a Steam Guard code.'
    });
}
router.route('help', (bot, msg) => {
    const args = msg.command?.argumentTokens;
    const [prefix, separator] = (() => {
        if (args?.[0] === 'botfather') {
            return ['', ' - '];
        }
        return ['/', ': '];
    })();
    // Accessing private _routes specifically for help command, which is fine for internal use
    const routes = router._routes;
    return msg.reply(routes.map((r) => `${prefix}${r.command}${separator}${r.helpText}`).map(utils_1.escapeMarkdown).join('\n'));
}, {
    helpText: 'I wonder...'
});
router.route('rollcall_add_player', rollcall_add_player_1.default, {
    helpText: 'Add a player to the rollcall.'
});
router.route('rollcall_remove_player', rollcall_remove_player_1.default, {
    helpText: 'Remove a player from the rollcall.'
});
router.route('rollcall_get_players', rollcall_get_players_1.default, {
    helpText: 'Get all players in the rollcall.'
});
bot.on('message', (msg) => {
    if (steamEnabled && msg.from && msg.chat) {
        const userId = msg.from.id;
        dao.addUserChat(userId, msg.chat.id)
            .then((added) => {
            if (added) {
                console.log(`Associated user ${userId} with chat ${msg.chat.id} for Steam updates.`);
            }
        })
            .catch((err) => console.error('Error adding user chat:', err));
    }
    router.handle(msg);
});
bot.on('error', (error) => {
    console.error('Telegram Bot Error:', error);
});
bot.on('polling_error', (error) => {
    console.error('Telegram Polling Error:', error);
});
console.log('Bot is running...');
