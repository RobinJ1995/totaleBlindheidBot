const { formatError } = require('./utils');

class MessageRouter {
    constructor(bot) {
        this._bot = bot;
        this._routes = [];
    }

    route(command, handler, etc) {
        this._routes.push({
            command,
            handler,
            ...etc
        });
    }

    handle(msg) {
        if (!msg.text || !msg.text.startsWith('/')) return;

        const parts = msg.text.split(/\s+/);
        const commandWithPrefix = parts[0];
        const nameWithTarget = commandWithPrefix.substring(1).toLowerCase();
        const [name] = nameWithTarget.split('@');

        const route = this._routes.find(r => r.command.toLowerCase() === name);
        if (!route) return;

        msg.reply = (text) => this._bot.sendMessage(msg.chat.id, text, {
            reply_to_message_id: msg.message_id,
            parse_mode: 'Markdown'
        });

        msg.command = {
            name,
            argument: msg.text.substring(commandWithPrefix.length).trim(),
            argumentTokens: parts.slice(1).filter(t => t.length > 0)
        };

        try {
            route.handler(this._bot, msg);
        } catch (ex) {
            msg.reply(formatError(ex));
        }
    }
}

module.exports = MessageRouter;