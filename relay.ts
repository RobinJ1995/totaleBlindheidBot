import { Bot, Message as TelegramMessage } from 'node-telegram-bot-api';
import { cleanContent, Message as DiscordMessage, PartialMessage } from 'discord.js';
import ChatLinkDAO, { ChatLink } from './dao/ChatLinkDAO.js';
import UserDAO from './dao/UserDAO.js';
import DiscordService, { ReplyTo } from './discord/DiscordService.js';
import RelayedMessageDAO, { CopyKind, MessageRef, Platform, RelayedMessage } from './dao/RelayedMessageDAO.js';
import { asFormatted, bold, fmt, Formatted, join, messageText } from './format.js';
import RelayMentions from './RelayMentions.js';
import { discordMedia, downloadTelegramFile, downloadUrl, RelayFile, sendTelegramFile, telegramMedia, TelegramMedia, TelegramSendKind } from './media.js';

const chatLinkDao = new ChatLinkDAO();
const userDao = new UserDAO();
const relayedDao = new RelayedMessageDAO();
const relayMentions = new RelayMentions(userDao);

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

export const telegramName = (from: TelegramMessage['from']): string =>
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

    const content: string = await discordContent(msg, media);
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
    const replied: RelayedMessage[] = await telegramReply(msg);
    const copies = await Promise.all(links.map(link => discord.relay(link, author, content, files, replyIn(replied, 'discord', link.discord_channel_id))
        .then(sent => ({ platform: 'discord' as const, chat_id: link.discord_channel_id, ...sent }))
        .catch((err: Error) => {
            console.error(`Could not relay Telegram message ${msg.message_id} to Discord channel ${link.discord_channel_id}:`, err);
            return undefined;
        })));
    const sender = msg.sender_chat ?? msg.from;
    await relayedDao.record(telegramRef(msg), author, copies.filter(isDefined), sender && `telegram:${sender.id}`);
};

type Copy = MessageRef & { kind: CopyKind };
const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

const telegramRef = (msg: TelegramMessage): MessageRef => ({ platform: 'telegram', chat_id: String(msg.chat.id), message_id: String(msg.message_id) });

// The replied-to message with its copies, when it was relayed.
const repliedTo = async (ref: MessageRef | undefined): Promise<RelayedMessage[]> => {
    const replied: RelayedMessage | undefined = ref && await relayedDao.find(ref);
    return replied ? relayedDao.group(replied) : [];
};

const telegramReply = (msg: TelegramMessage): Promise<RelayedMessage[]> =>
    repliedTo(msg.reply_to_message && { platform: 'telegram', chat_id: String(msg.chat.id), message_id: String(msg.reply_to_message.message_id) });

// A thread message answers the message the thread was started on, which shares the thread's id.
export const discordReply = (message: DiscordMessage): Promise<RelayedMessage[]> => {
    const thread = message.channel.isThread() ? message.channel : undefined;
    return repliedTo(message.reference?.messageId
        ? { platform: 'discord', chat_id: message.reference.channelId, message_id: message.reference.messageId }
        : thread?.parentId ? { platform: 'discord', chat_id: thread.parentId, message_id: thread.id } : undefined);
};

// Where the replied-to message is in this chat or channel.
const replyIn = (group: RelayedMessage[], platform: Platform, chat_id: string): ReplyTo | undefined => {
    const target: RelayedMessage | undefined = group.find(m => m.platform === platform && m.chat_id === chat_id);
    return target && { author: group[0].author ?? '', message_id: target.message_id };
};

// The Telegram text or caption as Discord markdown, after any media placeholder.
const discordContent = async (msg: TelegramMessage, media: TelegramMedia | undefined): Promise<string> => {
    const formatted: Formatted = msg.text ? { text: msg.text, entities: msg.entities ?? [] } : media?.caption ?? { text: '', entities: [] };
    return [media?.placeholder, await relayMentions.toDiscord(formatted)].filter(Boolean).join(' ');
};

// For Telegram, linked users are tagged and other mentions spelled out as names.
const discordTexts = async (message: DiscordMessage): Promise<{ telegram: Formatted; discord: string }> => {
    const placeholders: string[] = discordMedia(message).placeholders;
    const content: Formatted = await relayMentions.toTelegram(message.content, text => cleanContent(text, message.channel));
    const text: Formatted = join([...placeholders, content].filter(part => asFormatted(part).text), ' ');
    return {
        telegram: text.text ? fmt`${bold(`${message.author.username}:`)} ${text}` : bold(`${message.author.username}:`),
        discord: [...placeholders, message.content].filter(Boolean).join(' ')
    };
};

// The original's copies, for an edit or deletion of a message that was relayed from here.
const copiesOf = async (ref: MessageRef): Promise<{ original: RelayedMessage; copies: RelayedMessage[] } | undefined> => {
    const original: RelayedMessage | undefined = await relayedDao.find(ref);
    return original?.kind === 'origin' ? { original, copies: (await relayedDao.group(original)).slice(1) } : undefined;
};

const editDiscordCopies = async (discord: DiscordService, telegram_chat_id: number, author: string, copies: RelayedMessage[], content: string, replied: RelayedMessage[]): Promise<void> => {
    const links: ChatLink[] = await chatLinkDao.getLinks(telegram_chat_id);
    await Promise.all(copies.filter(copy => copy.platform === 'discord').map(copy => {
        const link: ChatLink | undefined = links.find(l => l.discord_channel_id === copy.chat_id);
        return link && discord.editRelayed(link, copy.message_id, copy.kind as CopyKind, author, content, replyIn(replied, 'discord', copy.chat_id))
            .catch((err: Error) => console.error(`Could not edit relayed message ${copy.message_id} in Discord channel ${copy.chat_id}:`, err));
    }));
};

// Deleting the original deletes its copies everywhere. Deleting a copy only forgets it: the bot
// does not delete people's messages for them. Telegram tells bots nothing about deletions.
export const relayDiscordDeletion = async (bot: Bot, channel_id: string, message_id: string, link: ChatLink): Promise<void> => {
    const discord: DiscordService | null = DiscordService.instance;
    const deleted: RelayedMessage | undefined = await relayedDao.find({ platform: 'discord', chat_id: channel_id, message_id });
    if (!discord || !deleted) {
        return;
    } else if (deleted.kind !== 'origin') {
        await relayedDao.forget([deleted.id]);
        return;
    }
    const group: RelayedMessage[] = await relayedDao.group(deleted);
    const links: ChatLink[] = await chatLinkDao.getLinks(link.telegram_chat_id);
    await Promise.all(group.slice(1).map(copy => {
        const other: ChatLink | undefined = links.find(l => l.discord_channel_id === copy.chat_id);
        const removal: Promise<unknown> = copy.platform === 'telegram'
            ? bot.api.deleteMessage({ chat_id: Number(copy.chat_id), message_id: Number(copy.message_id) })
            : other ? discord.deleteRelayed(other, copy.message_id, copy.kind as CopyKind) : Promise.resolve();
        return removal.catch((err: Error) => console.error(`Could not delete relayed message ${copy.message_id} in ${copy.platform} ${copy.chat_id}:`, err));
    }));
    await relayedDao.forget(group.map(message => message.id));
};

export const relayTelegramEdit = async (msg: TelegramMessage): Promise<void> => {
    const discord: DiscordService | null = DiscordService.instance;
    const relayed = discord ? await copiesOf(telegramRef(msg)) : undefined;
    if (!discord || !relayed) {
        return;
    }
    await editDiscordCopies(discord, msg.chat.id, relayed.original.author ?? telegramName(msg.from), relayed.copies, await discordContent(msg, telegramMedia(msg)), await telegramReply(msg));
};

export const relayDiscordEdit = async (bot: Bot, edited: DiscordMessage | PartialMessage, link: ChatLink): Promise<void> => {
    const discord: DiscordService | null = DiscordService.instance;
    const relayed = discord ? await copiesOf({ platform: 'discord', chat_id: edited.channelId, message_id: edited.id }) : undefined;
    if (!discord || !relayed) {
        return;
    }
    const message: DiscordMessage = edited.partial ? await edited.fetch() : edited;
    const texts = await discordTexts(message);
    await Promise.all(relayed.copies.filter(copy => copy.platform === 'telegram').map(copy => {
        const target = { chat_id: Number(copy.chat_id), message_id: Number(copy.message_id) };
        const edit: Promise<unknown> = copy.kind === 'text'
            ? bot.api.editMessageText({ ...target, ...messageText(texts.telegram) })
            : copy.kind === 'caption'
                ? bot.api.editMessageCaption({ ...target, caption: texts.telegram.text, caption_entities: texts.telegram.entities })
                : Promise.resolve();
        return edit.catch((err: Error) => console.error(`Could not edit relayed message ${copy.message_id} in Telegram chat ${copy.chat_id}:`, err));
    }));
    await editDiscordCopies(discord, link.telegram_chat_id, message.author.username, relayed.copies, texts.discord, await discordReply(message));
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
    const author: string = message.author.username;
    const texts = await discordTexts(message);

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

    const replied: RelayedMessage[] = await discordReply(message);
    // The first message sent on Telegram is the reply.
    const reply: ReplyTo | undefined = replyIn(replied, 'telegram', String(link.telegram_chat_id));
    const replyTo: number | undefined = reply && Number(reply.message_id);
    const copies: Copy[] = [];
    const telegramCopy = (message_id: number, kind: CopyKind): Copy =>
        ({ platform: 'telegram', chat_id: String(link.telegram_chat_id), message_id: String(message_id), kind });
    try {
        // The text rides as the first file's caption when it fits.
        let caption: Formatted | undefined = texts.telegram;
        if (files.length === 0 || texts.telegram.text.length > TELEGRAM_CAPTION_LIMIT) {
            const sent = await bot.api.sendMessage({ chat_id: link.telegram_chat_id, ...messageText(texts.telegram),
                ...(replyTo !== undefined ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}) });
            copies.push(telegramCopy(sent.message_id, 'text'));
            caption = files.length > 0 ? bold(`${author}:`) : undefined;
        }
        await downloaded.reduce<Promise<unknown>>((sending, { file, kind }, i) => sending
            .then(() => sendTelegramFile(bot, link.telegram_chat_id, kind, file, i === 0 ? caption : bold(`${author}:`),
                i === 0 && copies.length === 0 ? replyTo : undefined))
            .then(message_id => copies.push(telegramCopy(message_id, i === 0 && caption === texts.telegram ? 'caption' : 'extra'))), Promise.resolve());
    } catch (err) {
        console.error(`Could not relay Discord message ${message.id} to Telegram chat ${link.telegram_chat_id}:`, err);
    }

    const others: ChatLink[] = (await chatLinkDao.getLinks(link.telegram_chat_id))
        .filter(other => other.discord_channel_id !== link.discord_channel_id);
    const discordCopies = await Promise.all(others.map(other => discord.relay(other, author, texts.discord, files, replyIn(replied, 'discord', other.discord_channel_id))
        .then(sent => ({ platform: 'discord' as const, chat_id: other.discord_channel_id, ...sent }))
        .catch((err: Error) => {
            console.error(`Could not relay Discord message ${message.id} to Discord channel ${other.discord_channel_id}:`, err);
            return undefined;
        })));
    await relayedDao.record({ platform: 'discord', chat_id: message.channelId, message_id: message.id }, author, [...copies, ...discordCopies.filter(isDefined)],
        `discord:${message.author.id}`);
};
