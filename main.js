const TelegramBot = require('node-telegram-bot-api');
const DAO = require('./dao/DAO');
const SteamService = require('./SteamService');
const { executeRollcall } = require('./command/rollcall');
const MessageRouter = require('./MessageRouter');
const { escapeMarkdown } = require('./utils');

const token = process.env.TELEGRAM_BOT_API_TOKEN;
if (!token) {
    console.error('TELEGRAM_BOT_API_TOKEN is not set');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const dao = new DAO();
const steamEnabled = !!(process.env.STEAM_USERNAME && process.env.STEAM_PASSWORD);

// Scheduler
setInterval(() => {
    dao.getScheduledRollcalls()
        .then(schedules => {
            const now = new Date();
            for (const [chat_id, timeIso] of Object.entries(schedules)) {
                const scheduledTime = new Date(timeIso);
                if (scheduledTime <= now) {
                    console.log(`Executing scheduled rollcall for chat ${chat_id}`);
                    executeRollcall(bot, chat_id)
                        .catch(err => console.error(`Error executing scheduled rollcall for ${chat_id}:`, err))
                        .finally(() => dao.removeScheduledRollcall(chat_id));
                }
            }
        })
        .catch(err => console.error('Error checking schedules:', err));
}, 30000);

// Steam Service
let steamService = null;
if (steamEnabled) {
    steamService = new SteamService(bot);
    steamService.start();
}

const router = new MessageRouter(bot);

router.route('hi', require('./command/hi'), {
    helpText: 'Craving that small talk, are you?'
});
router.route('rollcall', require('./command/rollcall'), {
    helpText: 'Anyone wanna play?'
});
router.route('schedule', require('./command/schedule'), {
    helpText: 'Schedule a rollcall for a specific time.'
});
router.route('cancel', require('./command/cancel'), {
    helpText: 'Cancel a scheduled rollcall.'
});
router.route('timezone', require('./command/timezone'), {
    helpText: 'Set or view your timezone for rollcall scheduling.'
});
router.route('wingman', require('./command/wingman'), {
    helpText: 'Looking for a wingman?'
});

if (steamEnabled) {
    router.route('steam_user_id', require('./command/steam_user_id'), {
        helpText: 'Set your Steam user id for live game updates.'
    });
    router.route('steam_guard', require('./command/steam_guard'), {
        helpText: 'Submit a Steam Guard code.'
    });
}

router.route('help', (bot, msg) => {
    const args = msg.command?.argumentTokens;
    const [prefix, separator] = (() => {
        if (args?.[0] === 'botfather') {
            return ['', ' - ']
        }

        return ['/', ': ']
    })();

    return msg.reply(
        router._routes.map(r => `${prefix}${r.command}${separator}${r.helpText}`).map(escapeMarkdown).join('\n')
    );
}, {
    helpText: 'I wonder...'
});

router.route('rollcall_add_player', require('./command/admin/rollcall_add_player'), {
    helpText: 'Add a player to the rollcall.'
});
router.route('rollcall_remove_player', require('./command/admin/rollcall_remove_player'), {
    helpText: 'Remove a player from the rollcall.'
});
router.route('rollcall_get_players', require('./command/admin/rollcall_get_players'), {
    helpText: 'Get all players in the rollcall.'
});

bot.on('message', (msg) => {
    if (steamEnabled && msg.from && msg.chat) {
        dao.addUserChat(msg.from.id, msg.chat.id)
            .then(added => {
                if (added) {
                    console.log(`Associated user ${msg.from.id} with chat ${msg.chat.id} for Steam updates.`);
                }
            })
            .catch(err => console.error('Error adding user chat:', err));
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
