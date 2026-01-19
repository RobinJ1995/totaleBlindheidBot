import consoleStamp from 'console-stamp';
consoleStamp(console);

import TelegramBot from 'node-telegram-bot-api';
import DAO from './dao/DAO';
import SteamService from './SteamService';
import { executeRollcall } from './command/rollcall';
import MessageRouter, { ExtendedMessage } from './MessageRouter';
import { escapeMarkdown } from './utils';

// Command Handlers
import hiHandler from './command/hi';
import rollcallHandler from './command/rollcall';
import scheduleHandler from './command/schedule';
import cancelHandler from './command/cancel';
import timezoneHandler from './command/timezone';
import wingmanHandler from './command/wingman';
import steamUserIdHandler from './command/steam_user_id';
import steamUpdatesHandler from './command/steam_updates';
import steamGuardHandler from './command/steam_guard';
import rollcallAddPlayerHandler from './command/admin/rollcall_add_player';
import rollcallRemovePlayerHandler from './command/admin/rollcall_remove_player';
import rollcallGetPlayersHandler from './command/admin/rollcall_get_players';

if (!process.env.LOG_DEBUG) {
    (console as any).debug = () => {};
}

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
        .then((schedules: Record<string, string>) => {
            const now: Date = new Date();
            for (const [chat_id, timeIso] of Object.entries<string>(schedules)) {
                const scheduledTime: Date = new Date(timeIso);
                if (scheduledTime <= now) {
                    console.log(`Executing scheduled rollcall for chat ${chat_id}`);
                    executeRollcall(bot, parseInt(chat_id))
                        .catch((err: Error) => console.error(`Error executing scheduled rollcall for ${chat_id}:`, err))
                        .finally(() => dao.removeScheduledRollcall(Number(chat_id)));
                }
            }
        })
        .catch((err: Error) => console.error('Error checking schedules:', err));
}, 30000);

// Steam Service
let steamService: SteamService | null = null;
if (steamEnabled) {
    steamService = new SteamService(bot);
    steamService.start();
}

const router: MessageRouter = new MessageRouter(bot);

router.route('hi', hiHandler, {
    helpText: 'Craving that small talk, are you?'
});
router.route('rollcall', rollcallHandler, {
    helpText: 'Anyone wanna play?'
});
router.route('schedule', scheduleHandler, {
    helpText: 'Schedule a rollcall for a specific time.'
});
router.route('cancel', cancelHandler, {
    helpText: 'Cancel a scheduled rollcall.'
});
router.route('timezone', timezoneHandler, {
    helpText: 'Set or view your timezone for rollcall scheduling.'
});
router.route('wingman', wingmanHandler, {
    helpText: 'Looking for a wingman?'
});

if (steamEnabled) {
    router.route('steam_user_id', steamUserIdHandler, {
        helpText: 'Set your Steam user ID(s) for live game updates. Either single ID or comma-separated.'
    });
    router.route('steam_updates', steamUpdatesHandler, {
        helpText: 'Enable or disable Steam updates for this chat (on/off).'
    });
    router.route('steam_guard', steamGuardHandler, {
        helpText: 'Submit a Steam Guard code.'
    });
}

router.route('help', (bot: TelegramBot, msg: ExtendedMessage) => {
    const args = msg.command?.argumentTokens;
    const [prefix, separator] = ((): [string, string] => {
        if (args?.[0] === 'botfather') {
            return ['', ' - ']
        }

        return ['/', ': ']
    })();

    // Accessing private _routes specifically for help command, which is fine for internal use
    const routes = (router as any)._routes;
    return msg.reply(
        routes.map((r: any) => `${prefix}${r.command}${separator}${r.helpText}`).map(escapeMarkdown).join('\n')
    );
}, {
    helpText: 'I wonder...'
});

router.route('rollcall_add_player', rollcallAddPlayerHandler, {
    helpText: 'Add a player to the rollcall.'
});
router.route('rollcall_remove_player', rollcallRemovePlayerHandler, {
    helpText: 'Remove a player from the rollcall.'
});
router.route('rollcall_get_players', rollcallGetPlayersHandler, {
    helpText: 'Get all players in the rollcall.'
});

bot.on('message', (msg: TelegramBot.Message) => {
    if (steamEnabled && msg.from && msg.chat) {
        const userId: number = msg.from.id;
        dao.addUserChat(userId, msg.chat.id)
            .then((added: boolean) => {
                if (added) {
                    console.log(`Associated user ${userId} with chat ${msg.chat.id} for Steam updates.`);
                }
            })
            .catch((err: Error) => console.error('Error adding user chat:', err));
    }

    router.handle(msg);
});

bot.on('error', (error: Error) => {
    console.error('Telegram Bot Error:', error);
});

bot.on('polling_error', (error: Error) => {
    console.error('Telegram Polling Error:', error);
});

console.log('Bot is running...');
