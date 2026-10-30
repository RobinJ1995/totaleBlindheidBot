import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitMessage, toDiscordMarkdown } from '../discord/markdown.js';
import { bold, fmt, link } from '../format.js';

test('plain text is escaped so Discord does not format it', () => {
    assert.equal(toDiscordMarkdown({ text: 'a*b _c_ ~d~ |e| `f` \\g', entities: [] }), 'a\\*b \\_c\\_ \\~d\\~ \\|e\\| \\`f\\` \\\\g');
    assert.equal(toDiscordMarkdown({ text: '# not a heading\n> not a quote\n- not a list', entities: [] }), '\\# not a heading\n\\> not a quote\n\\- not a list');
});

test('Telegram entities become Discord markdown', () => {
    assert.equal(toDiscordMarkdown(fmt`Hello ${bold('world')}!`), 'Hello **world**!');
    assert.equal(toDiscordMarkdown(fmt`See ${link('this', 'https://example.com/a_b')}`), 'See [this](https://example.com/a_b)');
    assert.equal(toDiscordMarkdown({ text: 'x code y', entities: [{ type: 'code', offset: 2, length: 4 }] }), 'x `code` y');
    assert.equal(toDiscordMarkdown({ text: 'quote\nme', entities: [{ type: 'blockquote', offset: 0, length: 8 }] }), '> quote\n> me');
    assert.equal(toDiscordMarkdown({ text: 'a_b', entities: [{ type: 'spoiler', offset: 0, length: 3 }] }), '||a\\_b||');
});

test('URLs stay as they are', () => {
    assert.equal(toDiscordMarkdown({ text: 'go https://x.io/a_b now', entities: [{ type: 'url', offset: 3, length: 16 }] }), 'go https://x.io/a_b now');
});

test('nested entities render inside out', () => {
    assert.equal(toDiscordMarkdown(fmt`${bold(fmt`a ${link('b', 'https://b')} c`)} d`), '**a [b](https://b) c** d');
});

test('entity offsets are UTF-16 based', () => {
    // 😀 is two UTF-16 code units; the bold entity starts after it.
    assert.equal(toDiscordMarkdown({ text: '😀 hi', entities: [{ type: 'bold', offset: 3, length: 2 }] }), '😀 **hi**');
});

test('long content splits on line breaks under the limit', () => {
    assert.deepEqual(splitMessage('abc\ndef\nghi', 7), ['abc\ndef', 'ghi']);
    assert.deepEqual(splitMessage('abc\ndef\nghi', 5), ['abc', 'def', 'ghi']);
    assert.deepEqual(splitMessage('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
    assert.deepEqual(splitMessage('short'), ['short']);
});
