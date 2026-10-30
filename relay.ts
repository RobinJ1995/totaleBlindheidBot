import { Bot, Message as TelegramMessage } from 'node-telegram-bot-api';
import { Message as DiscordMessage } from 'discord.js';
import ChatLinkDAO, { ChatLink } from './dao/ChatLinkDAO.js';
import DiscordService from './discord/DiscordService.js';
import { toDiscordMarkdown } from './discord/markdown.js';
import { bold, fmt, messageText } from './format.js';

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

export const relayFromDiscord = async (bot: Bot, message: DiscordMessage, link: ChatLink): Promise<void> => {
    const discord: DiscordService | null = DiscordService.instance;
    if (!discord || !message.content) {
        return;
    }
    const author: string = message.member?.displayName ?? message.author.displayName;
    // cleanContent has user and channel mentions spelled out as names.
    await bot.api.sendMessage({
        chat_id: link.telegram_chat_id,
        ...messageText(fmt`${bold(`${author}:`)} ${message.cleanContent}`)
    }).catch((err: Error) => console.error(`Could not relay Discord message ${message.id} to Telegram chat ${link.telegram_chat_id}:`, err));

    const others: ChatLink[] = (await chatLinkDao.getLinks(link.telegram_chat_id))
        .filter(other => other.discord_channel_id !== link.discord_channel_id);
    await Promise.all(others.map(other => discord.relay(other, author, message.content).catch((err: Error) =>
        console.error(`Could not relay Discord message ${message.id} to Discord channel ${other.discord_channel_id}:`, err))));
};
