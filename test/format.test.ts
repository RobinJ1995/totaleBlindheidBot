import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bold, dateTime, fmt, join, link, messageText } from '../format.js';

test('fmt offsets entities by the UTF-16 length of what precedes them', () => {
    // 🟢 is a surrogate pair: two UTF-16 units, which is what Telegram counts.
    assert.deepEqual(fmt`🟢 ${bold('Foo_Bar')} is playing`, {
        text: '🟢 Foo_Bar is playing',
        entities: [{ type: 'bold', offset: 3, length: 7 }]
    });
});

test('fmt keeps nested entities and interpolates numbers', () => {
    assert.deepEqual(fmt`${bold(fmt`hi ${link('Al', 'tg://user?id=1')}`)} x${3}`, {
        text: 'hi Al x3',
        entities: [
            { type: 'bold', offset: 0, length: 5 },
            { type: 'text_link', offset: 3, length: 2, url: 'tg://user?id=1' }
        ]
    });
});

test('join shifts each part past the separators', () => {
    assert.deepEqual(join(['@a_b', link('Cee', 'tg://user?id=3')], ' '), {
        text: '@a_b Cee',
        entities: [{ type: 'text_link', offset: 5, length: 3, url: 'tg://user?id=3' }]
    });
});

test('an empty bold adds no entity', () => {
    assert.deepEqual(bold(''), { text: '', entities: [] });
});

test('messageText leaves out an empty entity list', () => {
    assert.deepEqual(messageText('plain'), { text: 'plain' });
    assert.deepEqual(messageText(bold('b')), { text: 'b', entities: [{ type: 'bold', offset: 0, length: 1 }] });
});

test('dateTime carries the unix time and format of its moment', () => {
    const at = new Date('2026-10-30T21:30:59.900Z');
    assert.deepEqual(fmt`at ${dateTime('21:30 UTC', at, 'wt')}`, {
        text: 'at 21:30 UTC',
        entities: [{ type: 'date_time', offset: 3, length: 9, unix_time: 1793395859, date_time_format: 'wt' }]
    });
});
