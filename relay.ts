import { Bot, Message as TelegramMessage } from 'node-telegram-bot-api';
import ChatLinkDAO, { ChatLink } from './dao/ChatLinkDAO.js';
import DiscordService from './discord/DiscordService.js';
import { toDiscordMarkdown } from './discord/markdown.js';

const chatLinkDao = new ChatLinkDAO();

const telegramName = (from: TelegramMessage['from']): string =>
    [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || 'someone';

export const relayFromTelegram = async (bot: Bot, msg: TelegramMessage): Promise<void> => {
    const discord: DiscordService | null = DiscordService.instance;
    if (!discord || !msg.text) {
        return;
    }
    const links: ChatLink[] = await chatLinkDao.getLinks(msg.chat.id);
    if (links.length === 0) {
        return;
    }

    const content: string = toDiscordMarkdown({ text: msg.text, entities: msg.entities ?? [] });
    const author: string = telegramName(msg.from);
    await Promise.all(links.map(link => discord.relay(link, author, content).catch((err: Error) =>
        console.error(`Could not relay Telegram message ${msg.message_id} to Discord channel ${link.discord_channel_id}:`, err))));
};
