import { Bot, Message } from 'node-telegram-bot-api';
import { formatError } from './utils.js';
import { messageText, Part } from './format.js';
import { User } from './dao/UserDAO.js';

export interface CommandContext {
    name: string;
    argument: string;
    argumentTokens: string[];
}

// What a command handler gets, whichever platform the command came from.
export interface Command {
    platform: 'telegram';
    chat_id: number;
    // The sender's user row (the bot's own id, not a platform id).
    user: User;
    command: CommandContext;
    reply: (text: Part) => Promise<unknown>;
    telegram?: Message;
}

export interface ExtendedMessage extends Message, Command {
    telegram: Message;
    reply: (text: Part) => Promise<Message>;
}

export type CommandHandler<T extends Command = Command> = (bot: Bot, cmd: T) => void | Promise<void> | Promise<any> | any;

// Returns true when it consumed the message.
export type ReplyHandler = (bot: Bot, msg: Message) => boolean;

export interface RouteOptions {
    helpText?: string;
}

interface Route extends RouteOptions {
    command: string;
    handler: CommandHandler<any>;
}

class MessageRouter {
    private _bot: Bot;
    private _routes: Route[];
    private _replyHandlers: ReplyHandler[];

    constructor(bot: Bot) {
        this._bot = bot;
        this._routes = [];
        this._replyHandlers = [];
    }

    onReply(handler: ReplyHandler): void {
        this._replyHandlers.push(handler);
    }

    route(command: string, handler: CommandHandler<any>, etc: RouteOptions = {}): void {
        this._routes.push({
            command,
            handler,
            ...etc
        });
    }

    handle(msg: Message, user: User): void {
        if (msg.reply_to_message && this._replyHandlers.some(handler => handler(this._bot, msg))) {
            return;
        } else if (!msg.text || !msg.text.startsWith('/')) {
            return;
        }

        const parts: string[] = msg.text.split(/\s+/);
        const commandWithPrefix: string = parts[0];
        const nameWithTarget: string = commandWithPrefix.substring(1).toLowerCase();
        const [name] = nameWithTarget.split('@');

        const route: Route | undefined = this._routes.find(r => r.command.toLowerCase() === name);
        if (!route) {
            return;
        }

        const extendedMsg = msg as ExtendedMessage;
        extendedMsg.platform = 'telegram';
        extendedMsg.chat_id = msg.chat.id;
        extendedMsg.telegram = msg;
        extendedMsg.reply = (text: Part) => this._bot.api.sendMessage({
            chat_id: msg.chat.id,
            ...messageText(text),
            reply_parameters: { message_id: msg.message_id }
        });

        extendedMsg.command = {
            name,
            argument: msg.text.substring(commandWithPrefix.length).trim(),
            argumentTokens: parts.slice(1).filter(t => t.length > 0)
        };
        extendedMsg.user = user;

        try {
            route.handler(this._bot, extendedMsg);
        } catch (ex: any) {
            extendedMsg.reply(formatError(ex));
        }
    }
}

export default MessageRouter;
