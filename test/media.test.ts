import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Message } from 'node-telegram-bot-api';
import { classifyAttachment, telegramMedia, TELEGRAM_PHOTO_LIMIT } from '../media.js';

const message = (fields: Partial<Message>): Message => ({
    message_id: 1, date: 0, chat: { id: 1, type: 'group' }, ...fields
} as Message);

test('the largest photo size is relayed with its caption', () => {
    const msg = message({
        photo: [{ file_id: 'small', file_unique_id: 'a', width: 1, height: 1 }, { file_id: 'big', file_unique_id: 'b', width: 9, height: 9 }],
        caption: 'hi', caption_entities: [{ type: 'bold', offset: 0, length: 2 }]
    });
    assert.deepEqual(telegramMedia(msg), {
        file: { file_id: 'big', name: 'photo.jpg', size: undefined },
        caption: { text: 'hi', entities: [{ type: 'bold', offset: 0, length: 2 }] }
    });
});

test('documents keep their file name and oversize ones become placeholders', () => {
    assert.deepEqual(telegramMedia(message({ document: { file_id: 'd', file_unique_id: 'x', file_name: 'notes.pdf', file_size: 10 } }))?.file,
        { file_id: 'd', name: 'notes.pdf', size: 10 });
    assert.equal(telegramMedia(message({ document: { file_id: 'd', file_unique_id: 'x', file_name: 'big.zip', file_size: 25 * 1024 * 1024 } }))?.placeholder,
        '[big.zip, 25 MB]');
});

test('stickers: static and video travel, animated become their emoji', () => {
    const sticker = (extra: object) => ({ file_id: 's', file_unique_id: 'x', type: 'regular' as const, width: 1, height: 1, is_animated: false, is_video: false, ...extra });
    assert.equal(telegramMedia(message({ sticker: sticker({}) }))?.file?.name, 'sticker.webp');
    assert.equal(telegramMedia(message({ sticker: sticker({ is_video: true }) }))?.file?.name, 'sticker.webm');
    assert.equal(telegramMedia(message({ sticker: sticker({ is_animated: true, emoji: '😀' }) }))?.placeholder, '😀 (animated sticker)');
});

test('voice and video notes are only noted', () => {
    assert.equal(telegramMedia(message({ voice: { file_id: 'v', file_unique_id: 'x', duration: 1 } }))?.placeholder, '[voice message]');
    assert.equal(telegramMedia(message({ video_note: { file_id: 'v', file_unique_id: 'x', duration: 1, length: 1 } }))?.placeholder, '[video message]');
    assert.equal(telegramMedia(message({ text: 'plain' })), undefined);
});

test('Discord attachments are sent with the Telegram method that shows them best', () => {
    assert.equal(classifyAttachment('a.gif', 10, 'image/gif'), 'animation');
    assert.equal(classifyAttachment('a.GIF', 10, null), 'animation');
    assert.equal(classifyAttachment('a.png', 10, 'image/png'), 'photo');
    assert.equal(classifyAttachment('a.png', TELEGRAM_PHOTO_LIMIT + 1, 'image/png'), 'document');
    assert.equal(classifyAttachment('a.mp4', 10, 'video/mp4'), 'video');
    assert.equal(classifyAttachment('a.pdf', 10, 'application/pdf'), 'document');
});
