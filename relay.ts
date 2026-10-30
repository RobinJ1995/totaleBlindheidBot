import { Bot, Message as TelegramMessage } from 'node-telegram-bot-api';
import { Message as DiscordMessage } from 'discord.js';
import ChatLinkDAO, { ChatLink } from './dao/ChatLinkDAO.js';
import UserDAO from './dao/UserDAO.js';
import DiscordService from './discord/DiscordService.js';
import { toDiscordMarkdown } from './discord/markdown.js';
import { bold, fmt, Formatted, messageText } from './format.js';
import { discordMedia, downloadTelegramFile, downloadUrl, RelayFile, sendTelegramFile, telegramMedia, TelegramMedia, TelegramSendKind } from './media.js';

const chatLinkDao = new ChatLinkDAO();
const userDao = new UserDAO();

const TELEGRAM_CAPTION_LIMIT = 1024;

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
    if (!discord) {
        return;
    }
    const media = discordMedia(message);
    if (!message.content && media.files.length === 0 && media.placeholders.length === 0) {
        return;
    }
    const author: string = message.member?.displayName ?? message.author.displayName;
    // cleanContent has user and channel mentions spelled out as names.
    const text: string = [...media.placeholders, message.cleanContent].filter(Boolean).join(' ');

    const downloads = await Promise.all(media.files.map(async file => {
        try {
            return { file: await downloadUrl(file.url, file.name, file.contentType), kind: file.kind };
        } catch (err) {
            console.error(`Could not download Discord attachment ${file.url}:`, err);
            return undefined;
        }
    }));
    const downloaded: { file: RelayFile; kind: TelegramSendKind }[] = downloads.filter((d): d is { file: RelayFile; kind: TelegramSendKind } => d !== undefined);
    const files: RelayFile[] = downloaded.map(d => d.file);

    try {
        const telegramText: Formatted = text ? fmt`${bold(`${author}:`)} ${text}` : bold(`${author}:`);
        // The text rides as the first file's caption when it fits.
        let caption: Formatted | undefined = telegramText;
        if (files.length === 0 || telegramText.text.length > TELEGRAM_CAPTION_LIMIT) {
            await bot.api.sendMessage({ chat_id: link.telegram_chat_id, ...messageText(telegramText) });
            caption = files.length > 0 ? bold(`${author}:`) : undefined;
        }
        await downloaded.reduce<Promise<unknown>>((sending, { file, kind }, i) =>
            sending.then(() => sendTelegramFile(bot, link.telegram_chat_id, kind, file, i === 0 ? caption : bold(`${author}:`))), Promise.resolve());
    } catch (err) {
        console.error(`Could not relay Discord message ${message.id} to Telegram chat ${link.telegram_chat_id}:`, err);
    }

    const content: string = [...media.placeholders, message.content].filter(Boolean).join(' ');
    const others: ChatLink[] = (await chatLinkDao.getLinks(link.telegram_chat_id))
        .filter(other => other.discord_channel_id !== link.discord_channel_id);
    await Promise.all(others.map(other => discord.relay(other, author, content, files).catch((err: Error) =>
        console.error(`Could not relay Discord message ${message.id} to Discord channel ${other.discord_channel_id}:`, err))));
};
