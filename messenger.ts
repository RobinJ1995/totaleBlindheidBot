import { Bot, Message as TelegramMessage } from 'node-telegram-bot-api';
import ChatLinkDAO, { ChatLink } from './dao/ChatLinkDAO.js';
import DiscordService from './discord/DiscordService.js';
import { Formatted, messageText } from './format.js';
import { Command } from './MessageRouter.js';

const chatLinkDao = new ChatLinkDAO();

export type Target = Command | { chat_id: number };

export interface Broadcast {
    telegram?: TelegramMessage;
    discord: { link: ChatLink; message_id: string }[];
}

// A Telegram command gets its copy as the reply.
export const broadcast = async (bot: Bot, target: Target, telegram: Formatted, discord: string): Promise<Broadcast> => {
    const cmd: Command | undefined = 'platform' in target ? target : undefined;
    const result: Broadcast = { discord: [] };

    try {
        result.telegram = await bot.api.sendMessage({
            chat_id: target.chat_id,
            ...messageText(telegram),
            ...(cmd?.telegram ? { reply_parameters: { message_id: cmd.telegram.message_id } } : {})
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
            return { link, message_id };
        } catch (err) {
            console.error(`Could not post to Discord channel ${link.discord_channel_id}:`, err);
            return undefined;
        }
    }));
    result.discord.push(...copies.filter((copy): copy is Broadcast['discord'][number] => copy !== undefined));
    return result;
};
