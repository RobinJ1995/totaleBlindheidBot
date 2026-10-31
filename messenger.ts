import { Bot, Message as TelegramMessage } from 'node-telegram-bot-api';
import ChatLinkDAO, { ChatLink } from './dao/ChatLinkDAO.js';
import { RsvpMessageWhere } from './dao/RsvpDAO.js';
import DiscordService from './discord/DiscordService.js';
import { Formatted, messageText } from './format.js';
import { Command } from './MessageRouter.js';
import { keyboard, RsvpKeyboardKind } from './rsvp.js';

const chatLinkDao = new ChatLinkDAO();

export type Target = Command | { chat_id: number };

export interface BroadcastOptions {
    keyboard?: RsvpKeyboardKind;
}

export interface Broadcast {
    telegram?: TelegramMessage;
    discord: { link: ChatLink; where: RsvpMessageWhere & { platform: 'discord' } }[];
}

// A Telegram command gets its copy as the reply.
export const broadcast = async (bot: Bot, target: Target, telegram: Formatted, discord: string, opts: BroadcastOptions = {}): Promise<Broadcast> => {
    const cmd: Command | undefined = 'platform' in target ? target : undefined;
    const result: Broadcast = { discord: [] };

    try {
        result.telegram = await bot.api.sendMessage({
            chat_id: target.chat_id,
            ...messageText(telegram),
            ...(cmd?.telegram ? { reply_parameters: { message_id: cmd.telegram.message_id } } : {}),
            ...(opts.keyboard ? { reply_markup: keyboard(opts.keyboard) } : {})
        });
    } catch (err) {
        console.error(`Could not post to Telegram chat ${target.chat_id}:`, err);
    }

    const service: DiscordService | null = DiscordService.instance;
    if (!service) {
        return result;
    }
    const links: ChatLink[] = await chatLinkDao.getLinks(target.chat_id);
    const copies = await Promise.all(links.map(async link => {
        try {
            const message_id: string = await service.sendAsBot(link.discord_channel_id, discord);
            return { link, where: { platform: 'discord' as const, channel_id: link.discord_channel_id, message_id } };
        } catch (err) {
            console.error(`Could not post to Discord channel ${link.discord_channel_id}:`, err);
            return undefined;
        }
    }));
    result.discord.push(...copies.filter((copy): copy is Broadcast['discord'][number] => copy !== undefined));
    return result;
};
