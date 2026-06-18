import consoleStamp from 'console-stamp';
consoleStamp(console);

import TelegramBot from 'node-telegram-bot-api';
import DAO from './dao/DAO';
import SteamService from './SteamService';
import GitHubService from './GitHubService';
import { executeRollcall } from './command/rollcall';
import MessageRouter, { ExtendedMessage } from './MessageRouter';
import { escapeMarkdown } from './utils';
import { normalizeSchedule, Rsvp, RsvpList } from './dao/DAO';
import { keyboard, resolve, renderMessage } from './rsvp';

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
import githubNotifyHandler from './command/github_notify';
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

const baseApiUrl = process.env.TELEGRAM_API_BASE_URL;
const bot = new TelegramBot(token, {
    polling: true,
    ...(baseApiUrl ? { baseApiUrl } : {})
});
const dao = new DAO();
const steamEnabled = !!(process.env.STEAM_USERNAME && process.env.STEAM_PASSWORD);

// Scheduler
setInterval(() => {
    dao.getScheduledRollcalls()
        .then(schedules => {
            const now: Date = new Date();
            for (const [chat_id, value] of Object.entries(schedules)) {
                const schedule = normalizeSchedule(value);
                const scheduledTime: Date = new Date(schedule.time);
                if (scheduledTime <= now) {
                    console.log(`Executing scheduled rollcall for chat ${chat_id}`);
                    executeRollcall(bot, parseInt(chat_id), { rsvp_id: schedule.rsvp_id })
                        .then(() => closeScheduleConfirmation(parseInt(chat_id), schedule.rsvp_id))
                        .catch((err: Error) => console.error(`Error executing scheduled rollcall for ${chat_id}:`, err))
                        .finally(() => dao.removeScheduledRollcall(Number(chat_id)));
                }
            }
        })
        .catch((err: Error) => console.error('Error checking schedules:', err));
}, 30000);

// When a schedule fires, the rollcall message takes over the shared RSVP list. Strip the
// buttons from the now-stale confirmation message and detach it so only the rollcall stays live.
const closeScheduleConfirmation = (chat_id: number, rsvp_id?: string): Promise<void> => {
    if (!rsvp_id) {
        return Promise.resolve();
    }
    return dao.getRsvpList(rsvp_id).then(list => {
        if (!list) {
            return;
        }
        const confirmation = list.messages.find(m => m.keyboard === 'schedule');
        if (!confirmation) {
            return;
        }
        return Promise.resolve()
            .then(() => bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id,
                message_id: confirmation.message_id
            }).catch(() => undefined))
            .then(() => dao.removeRsvpMessage(rsvp_id, confirmation.message_id));
    });
};

// Re-render every message attached to an RSVP list against the current rotation.
const renderRsvpMessages = (list: RsvpList): Promise<unknown> => {
    return dao.getRollcallPlayerUsernames(list.chat_id).then(rotation => {
        const { groups } = resolve(rotation, list.entries);
        return Promise.all(list.messages.map(ref =>
            bot.editMessageText(renderMessage(ref.base_text, groups), {
                chat_id: list.chat_id,
                message_id: ref.message_id,
                parse_mode: 'Markdown',
                reply_markup: keyboard(ref.keyboard)
            }).catch((err: Error) => {
                // Telegram throws when the text is unchanged; that's harmless here.
                if (!err.message?.includes('message is not modified')) {
                    console.error(`Error updating RSVP message ${ref.message_id}:`, err);
                }
            })
        ));
    });
};

const handleRsvpCallback = (query: TelegramBot.CallbackQuery): void => {
    const data: string | undefined = query.data;
    const message: TelegramBot.Message | undefined = query.message;
    if (!data || !data.startsWith('rsvp:') || !message) {
        return;
    }

    const rsvp = data.substring('rsvp:'.length) as Rsvp;
    if (!['yes', 'maybe', 'no'].includes(rsvp)) {
        return;
    }

    const chat_id: number = message.chat.id;
    const message_id: number = message.message_id;

    dao.getRsvpListByMessage(chat_id, message_id)
        .then(list => {
            if (!list) {
                return bot.answerCallbackQuery(query.id, { text: 'This RSVP has expired.' });
            }

            return dao.setRsvpEntry(list.rsvp_id, {
                user_id: query.from.id,
                name: query.from.first_name || query.from.username || 'someone',
                username: query.from.username,
                rsvp
            })
                .then(updated => updated ? renderRsvpMessages(updated) : undefined)
                .then(() => bot.answerCallbackQuery(query.id));
        })
        .catch((err: Error) => {
            console.error('Error handling RSVP callback:', err);
            bot.answerCallbackQuery(query.id, { text: 'Something went wrong.' }).catch(() => undefined);
        });
};

// Steam Service
let steamService: SteamService | null = null;
if (steamEnabled) {
    steamService = new SteamService(bot);
    steamService.start();
}

// GitHub Service (public repo, no auth required)
const githubService: GitHubService = new GitHubService(bot);
githubService.start();

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
router.route('github_notify', githubNotifyHandler, {
    helpText: 'Enable or disable GitHub commit notifications for this chat (on/off).'
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

bot.on('callback_query', (query: TelegramBot.CallbackQuery) => {
    handleRsvpCallback(query);
});

bot.on('error', (error: Error) => {
    console.error('Telegram Bot Error:', error);
});

bot.on('polling_error', (error: Error) => {
    console.error('Telegram Polling Error:', error);
});

console.log('Bot is running...');
