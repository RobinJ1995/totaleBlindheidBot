const MessageEntity = require('./entity/MessageEntity');
const { checkInstanceOf, formatError } = require('./utils');

class MessageRouter {
    constructor(api) {
        this._api = api;
        this._routes = [];
    }

    route(command, handler, etc) {
        this._routes.push({
            command,
            handler,
            ...etc
        });
    }

    handle(message) {
        checkInstanceOf(message, MessageEntity);

        const handler = this._routes.find(route => route.command === message?.meta?.command?.name)?.handler;
        if (!handler) {
            console.warn('No handler found.', message);
            return;
        }

        message.reply = text => this._api.sendMessage({
            chat_id: message.message.chat.id,
            reply_to_message_id: message.message?.message_id,
            parse_mode: 'Markdown',
            text
        });

        try {
            handler(this._api, message);
        } catch (ex) {
            message.reply(formatError(ex));
        }
    }
}

module.exports = MessageRouter;