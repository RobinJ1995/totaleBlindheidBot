const MessageEntity = require('./entity/MessageEntity');
const MessageRouter = require('./MessageRouter');
const { escapeMarkdown } = require('./utils');

module.exports = loadPlugin = (resources, service) => {
    const api = resources.api;

    const router = new MessageRouter(api);
    router.route('hi', require('./command/hi'), {
        helpText: 'Craving that small talk, are you?'
    });
    router.route('rollcall', require('./command/rollcall'), {
        helpText: 'Anyone wanna play?'
    });
    router.route('wingman', require('./command/wingman'), {
        helpText: 'Looking for a wingman?'
    });
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
            process.nextTick(() => cb(null, true));
        },
        disable: cb => {
            process.nextTick(() => cb(null, true));
        },
        handleMessage: (message, meta) => {
            if (!meta.fresh) {
                return;
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