import { Bot, InputFile, Message as TelegramMessage, MessageEntity } from 'node-telegram-bot-api';
import { Attachment, Message as DiscordMessage, Sticker, StickerFormatType } from 'discord.js';
import { Formatted } from './format.js';

export interface RelayFile {
    name: string;
    data: Buffer;
    contentType?: string;
}

export interface TelegramMedia {
    file?: { file_id: string; name: string; size?: number };
    placeholder?: string;
    caption: Formatted;
}

export const TELEGRAM_DOWNLOAD_LIMIT = 20 * 1024 * 1024;  // bots can download files up to 20 MB
export const TELEGRAM_PHOTO_LIMIT = 10 * 1024 * 1024;     // sendPhoto upload limit
export const TELEGRAM_UPLOAD_LIMIT = 50 * 1024 * 1024;    // other uploads

const megabytes = (bytes: number): string => `${Math.round(bytes / 1024 / 1024)} MB`;

const tooBig = (name: string, size: number): string => `[${name}, ${megabytes(size)}]`;

export const telegramMedia = (msg: TelegramMessage): TelegramMedia | undefined => {
    const caption: Formatted = { text: msg.caption ?? '', entities: msg.caption_entities ?? [] };
    const file = (file_id: string, name: string, size?: number): TelegramMedia =>
        size !== undefined && size > TELEGRAM_DOWNLOAD_LIMIT
            ? { placeholder: tooBig(name, size), caption }
            : { file: { file_id, name, size }, caption };

    if (msg.photo && msg.photo.length > 0) {
        const largest = msg.photo[msg.photo.length - 1];
        return file(largest.file_id, 'photo.jpg', largest.file_size);
    } else if (msg.video) {
        return file(msg.video.file_id, msg.video.file_name ?? 'video.mp4', msg.video.file_size);
    } else if (msg.animation) {
        return file(msg.animation.file_id, msg.animation.file_name ?? 'animation.mp4', msg.animation.file_size);
    } else if (msg.document) {
        return file(msg.document.file_id, msg.document.file_name ?? 'file', msg.document.file_size);
    } else if (msg.audio) {
        return file(msg.audio.file_id, msg.audio.file_name ?? 'audio.mp3', msg.audio.file_size);
    } else if (msg.sticker) {
        if (msg.sticker.is_animated) {
            // Lottie; Discord can't play it.
            return { placeholder: `${msg.sticker.emoji ?? ''} (animated sticker)`.trim(), caption };
        }
        return file(msg.sticker.file_id, msg.sticker.is_video ? 'sticker.webm' : 'sticker.webp', msg.sticker.file_size);
    } else if (msg.voice) {
        return { placeholder: '[voice message]', caption };
    } else if (msg.video_note) {
        return { placeholder: '[video message]', caption };
    } else if (msg.poll) {
        return { placeholder: `[poll: ${msg.poll.question}]`, caption };
    }
    return undefined;
};

export const downloadTelegramFile = async (bot: Bot, file_id: string, name: string): Promise<RelayFile> => {
    const file = await bot.api.getFile({ file_id });
    if (!file.file_path) {
        throw new Error(`Telegram gave no path for file ${file_id}`);
    }
    const root: string = (process.env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org').replace(/\/+$/, '');
    const response = await fetch(`${root}/file/bot${process.env.TELEGRAM_BOT_API_TOKEN}/${file.file_path}`);
    if (!response.ok) {
        throw new Error(`Downloading Telegram file ${file_id} failed: ${response.status} ${response.statusText}`);
    }
    return { name, data: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? undefined };
};

export const downloadUrl = async (url: string, name: string, contentType?: string): Promise<RelayFile> => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Downloading ${url} failed: ${response.status} ${response.statusText}`);
    }
    return { name, data: Buffer.from(await response.arrayBuffer()), contentType: contentType ?? response.headers.get('content-type') ?? undefined };
};

export type TelegramSendKind = 'photo' | 'video' | 'animation' | 'document';

export interface DiscordMedia {
    name: string;
    url: string;
    size: number;
    contentType?: string;
    kind: TelegramSendKind;
}

export const classifyAttachment = (name: string, size: number, contentType: string | null | undefined): TelegramSendKind => {
    const type: string = contentType ?? '';
    if (type === 'image/gif' || name.toLowerCase().endsWith('.gif')) {
        return 'animation';
    } else if (type.startsWith('image/')) {
        return size <= TELEGRAM_PHOTO_LIMIT ? 'photo' : 'document';
    } else if (type.startsWith('video/')) {
        return 'video';
    }
    return 'document';
};

export const discordMedia = (message: DiscordMessage): { files: DiscordMedia[]; placeholders: string[] } => {
    const files: DiscordMedia[] = [];
    const placeholders: string[] = [];
    message.attachments.forEach((attachment: Attachment) => {
        if (attachment.size > TELEGRAM_UPLOAD_LIMIT) {
            placeholders.push(`${tooBig(attachment.name, attachment.size)} ${attachment.url}`);
        } else {
            files.push({
                name: attachment.name,
                url: attachment.url,
                size: attachment.size,
                contentType: attachment.contentType ?? undefined,
                kind: classifyAttachment(attachment.name, attachment.size, attachment.contentType)
            });
        }
    });
    message.stickers.forEach((sticker: Sticker) => {
        if (sticker.format === StickerFormatType.Lottie) {
            placeholders.push(`(sticker: ${sticker.name})`);
        } else if (sticker.format === StickerFormatType.GIF) {
            files.push({ name: `${sticker.name}.gif`, url: sticker.url, size: 0, contentType: 'image/gif', kind: 'animation' });
        } else {
            files.push({ name: `${sticker.name}.png`, url: sticker.url, size: 0, contentType: 'image/png', kind: 'photo' });
        }
    });
    return { files, placeholders };
};

export const sendTelegramFile = async (bot: Bot, chat_id: number, kind: TelegramSendKind, file: RelayFile, caption?: Formatted): Promise<void> => {
    const input = new InputFile(new Uint8Array(file.data), { filename: file.name, contentType: file.contentType });
    const text: { caption?: string; caption_entities?: MessageEntity[] } = caption && caption.text
        ? { caption: caption.text, ...(caption.entities.length > 0 ? { caption_entities: caption.entities } : {}) }
        : {};
    switch (kind) {
        case 'photo':
            await bot.api.sendPhoto({ chat_id, photo: input, ...text });
            break;
        case 'video':
            await bot.api.sendVideo({ chat_id, video: input, ...text });
            break;
        case 'animation':
            await bot.api.sendAnimation({ chat_id, animation: input, ...text });
            break;
        default:
            await bot.api.sendDocument({ chat_id, document: input, ...text });
    }
};
