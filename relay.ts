import { Bot, Message as TelegramMessage } from 'node-telegram-bot-api';
import { Message as DiscordMessage } from 'discord.js';
import ChatLinkDAO, { ChatLink } from './dao/ChatLinkDAO.js';
import UserDAO from './dao/UserDAO.js';
import DiscordService from './discord/DiscordService.js';
import { toDiscordMarkdown } from './discord/markdown.js';
import { bold, fmt, Formatted, messageText } from './format.js';
import { downloadTelegramFile, RelayFile, telegramMedia, TelegramMedia } from './media.js';

const chatLinkDao = new ChatLinkDAO();
const userDao = new UserDAO();

export const recordDiscordSender = async (message: DiscordMessage, link: ChatLink): Promise<void> => {
    if (message.author.bot) {
        return;
    }
    const user = await userDao.fromDiscord({
        id: message.author.id,
        username: message.author.username,
        global_name: message.author.globalName
    });
    await userDao.addUserChat(user.id, link.telegram_chat_id);
};

const telegramName = (from: TelegramMessage['from']): string =>
    [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || 'someone';

export const relayFromTelegram = async (bot: Bot, msg: TelegramMessage): Promise<void> => {
    const discord: DiscordService | null = DiscordService.instance;
    if (!discord) {
        return;
    }
    const media: TelegramMedia | undefined = telegramMedia(msg);
    if (!msg.text && !media) {
        return;
    }
    const links: ChatLink[] = await chatLinkDao.getLinks(msg.chat.id);
    if (links.length === 0) {
        return;
    }

    const formatted: Formatted = msg.text ? { text: msg.text, entities: msg.entities ?? [] } : media!.caption;
    const content: string = [media?.placeholder, toDiscordMarkdown(formatted)].filter(Boolean).join(' ');
    let files: RelayFile[] = [];
    if (media?.file) {
        try {
            files = [await downloadTelegramFile(bot, media.file.file_id, media.file.name)];
        } catch (err) {
            console.error(`Could not download Telegram file ${media.file.file_id}:`, err);
            return;
        }
    }

    const author: string = telegramName(msg.from);
    await Promise.all(links.map(link => discord.relay(link, author, content, files).catch((err: Error) =>
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
