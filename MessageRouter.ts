import { Bot, Message } from 'node-telegram-bot-api';
import { ChatInputCommandInteraction } from 'discord.js';
import { formatError } from './utils.js';
import { messageText, Part } from './format.js';
import { User } from './dao/UserDAO.js';
import { ChatLink } from './dao/ChatLinkDAO.js';

export interface CommandContext {
    name: string;
    argument: string;
    argumentTokens: string[];
}

// chat_id is the Telegram chat, also for a command typed in a linked Discord channel.
export interface Command {
    platform: 'telegram' | 'discord';
    chat_id: number;
    user: User;
    command: CommandContext;
    reply: (text: Part) => Promise<unknown>;
    telegram?: Message;
    discord?: { interaction: ChatInputCommandInteraction; link: ChatLink };
}

export interface ExtendedMessage extends Message, Command {
    platform: 'telegram';
    telegram: Message;
    reply: (text: Part) => Promise<Message>;
}

export type CommandHandler<T extends Command = Command> = (bot: Bot, cmd: T) => void | Promise<void> | Promise<any> | any;

// Returns true when it consumed the message.
export type ReplyHandler = (bot: Bot, msg: Message) => boolean;

export interface DiscordCommandOptions {
    argument?: { name: string; description: string };
}

export interface RouteOptions {
    helpText?: string;
    discord?: DiscordCommandOptions;
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

    route(command: string, handler: CommandHandler<ExtendedMessage>, etc?: RouteOptions & { discord?: undefined }): void;
    route(command: string, handler: CommandHandler<Command>, etc: RouteOptions & { discord: DiscordCommandOptions }): void;
    route(command: string, handler: CommandHandler<any>, etc: RouteOptions = {}): void {
        this._routes.push({
            command,
            handler,
            ...etc
        });
    }

    get discordRoutes(): readonly Route[] {
        return this._routes.filter(route => route.discord);
    }

    private _context(name: string, argument: string): CommandContext {
        return {
            name,
            argument: argument.trim(),
            argumentTokens: argument.split(/\s+/).filter(t => t.length > 0)
        };
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
        extendedMsg.command = this._context(name, msg.text.substring(commandWithPrefix.length));
        extendedMsg.user = user;

        try {
            route.handler(this._bot, extendedMsg);
        } catch (ex: any) {
            extendedMsg.reply(formatError(ex));
        }
    }

    async handleDiscord(interaction: ChatInputCommandInteraction, link: ChatLink, user: User, reply: (text: Part) => Promise<unknown>): Promise<void> {
        const route: Route | undefined = this.discordRoutes.find(r => r.command.toLowerCase() === interaction.commandName.toLowerCase());
        if (!route) {
            await reply('I don\'t know that command.');
            return;
        }
        const argument: string = route.discord?.argument ? (interaction.options.getString(route.discord.argument.name) ?? '') : '';
        const cmd: Command = {
            platform: 'discord',
            chat_id: link.telegram_chat_id,
            user,
            command: this._context(route.command, argument),
            reply,
            discord: { interaction, link }
        };
        try {
            await route.handler(this._bot, cmd);
        } catch (ex: any) {
            await reply(formatError(ex));
        }
    }
}

export default MessageRouter;
