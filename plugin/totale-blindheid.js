const MessageEntity = require('./entity/MessageEntity');
const MessageRouter = require('./MessageRouter');
const { escapeMarkdown } = require('./utils');
const { executeRollcall } = require('./command/rollcall');
const DAO = require('./dao/DAO');
const SteamService = require('./SteamService');

const dao = new DAO();
let schedulerInterval = null;
let steamService = null;

const checkSchedules = (api) => {
    dao.getScheduledRollcalls()
        .then(schedules => {
            const now = new Date();
            for (const [chat_id, timeIso] of Object.entries(schedules)) {
                const scheduledTime = new Date(timeIso);
                if (scheduledTime <= now) {
                    console.log(`Executing scheduled rollcall for chat ${chat_id}`);
                    executeRollcall(api, chat_id)
                        .catch(err => console.error(`Error executing scheduled rollcall for ${chat_id}:`, err))
                        .finally(() => dao.removeScheduledRollcall(chat_id));
                }
            }
        })
        .catch(err => console.error('Error checking schedules:', err));
};

module.exports = loadPlugin = (resources, service) => {
    const api = resources.api;
    const steamEnabled = !!(process.env.STEAM_USERNAME && process.env.STEAM_PASSWORD);

    const router = new MessageRouter(api);
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

    router.route('help', (api, message) => message.reply(
        router._routes.map(r => `/${r.command}: ${r.helpText}`).map(escapeMarkdown).join('\n')), {
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

    return {
        enable: cb => {
            if (!schedulerInterval) {
                schedulerInterval = setInterval(() => checkSchedules(api), 30000);
            }
            if (steamEnabled && !steamService) {
                steamService = new SteamService(api);
                steamService.start();
            }
            process.nextTick(() => cb(null, true));
        },
        disable: cb => {
            if (schedulerInterval) {
                clearInterval(schedulerInterval);
                schedulerInterval = null;
            }
            if (steamService) {
                steamService.stop();
                steamService = null;
            }
            process.nextTick(() => cb(null, true));
        },
        handleMessage: (message, meta) => {
            if (!meta.fresh) {
                return;
            }

            if (steamEnabled && message.from && message.chat) {
                dao.addUserChat(message.from.id, message.chat.id)
                    .then(added => {
                        if (added) {
                            console.log(`Associated user ${message.from.id} with chat ${message.chat.id} for Steam updates.`);
                        }
                    })
                    .catch(err => console.error('Error adding user chat:', err));
            }

            router.handle(new MessageEntity(message, meta));

            console.log(JSON.stringify(new MessageEntity(message, meta), undefined, 4))
/*
{
    "message": {
        "message_id": 3,
        "from": {
            "id": 10215052,
            "is_bot": false,
            "first_name": "Robin",
            "last_name": "Jacobs",
            "username": "RobinJ1995",
            "language_code": "en"
        },
        "chat": {
            "id": 10215052,
            "first_name": "Robin",
            "last_name": "Jacobs",
            "username": "RobinJ1995",
            "type": "private"
        },
        "date": 1616245064,
        "text": "/hallo een twee drie",
        "entities": [
            {
                "offset": 0,
                "length": 6,
                "type": "bot_command"
            }
        ]
    },
    "meta": {
        "receiveDate": "2021-03-20T12:57:44.883Z",
        "private": true,
        "command": {
            "name": "hallo",
            "prefix": "/",
            "target": null,
            "argument": "een twee drie",
            "argumentTokens": [
                "een",
                "twee",
                "drie"
            ]
        },
        "sendDate": "2021-03-20T12:57:44.000Z",
        "fresh": true,
        "authority": {
            "_level": "1"
        }
    }
}
*/
        }
    };
};