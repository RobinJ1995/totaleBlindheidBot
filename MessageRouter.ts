import TelegramBot from 'node-telegram-bot-api';
import { formatError } from './utils';

export interface CommandContext {
    name: string;
    argument: string;
    argumentTokens: string[];
}

export interface ExtendedMessage extends TelegramBot.Message {
    reply: (text: string) => Promise<TelegramBot.Message>;
    command: CommandContext;
}

export type CommandHandler = (bot: TelegramBot, msg: ExtendedMessage) => void | Promise<void> | Promise<any> | any;

interface Route {
    command: string;
    handler: CommandHandler;
    [key: string]: any;
}

class MessageRouter {
    private _bot: TelegramBot;
    private _routes: Route[];

    constructor(bot: TelegramBot) {
        this._bot = bot;
        this._routes = [];
    }

    route(command: string, handler: CommandHandler, etc: any = {}): void {
        this._routes.push({
            command,
            handler,
            ...etc
        });
    }

    handle(msg: TelegramBot.Message): void {
        if (!msg.text || !msg.text.startsWith('/')) return;

        const parts: string[] = msg.text.split(/\s+/);
        const commandWithPrefix: string = parts[0];
        const nameWithTarget: string = commandWithPrefix.substring(1).toLowerCase();
        const [name] = nameWithTarget.split('@');

        const route: Route | undefined = this._routes.find(r => r.command.toLowerCase() === name);
        if (!route) return;

        const extendedMsg = msg as ExtendedMessage;

        extendedMsg.reply = (text: string) => this._bot.sendMessage(msg.chat.id, text, {
            reply_to_message_id: msg.message_id,
            parse_mode: 'Markdown'
        });

        extendedMsg.command = {
            name,
            argument: msg.text.substring(commandWithPrefix.length).trim(),
            argumentTokens: parts.slice(1).filter(t => t.length > 0)
        };

        try {
            route.handler(this._bot, extendedMsg);
        } catch (ex: any) {
            extendedMsg.reply(formatError(ex));
        }
    }
}

export default MessageRouter;