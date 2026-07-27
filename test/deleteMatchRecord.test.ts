import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickerKeyboard, PAGE_SIZE, CALLBACK_PREFIX } from '../command/admin/delete_match_record.js';
import { GameHistoryEntry } from '../dao/GameHistoryDAO.js';

const entry = (id: number): GameHistoryEntry => ({
    id,
    chat_id: 1,
    user_id: 42,
    map: 'Vertigo',
    mode: 'Competitive',
    score: '13-7',
    co_players: [],
    ended_at: new Date('2026-01-01T12:00:00.000Z')
});

const entries = (n: number, from = 1): GameHistoryEntry[] =>
    Array.from({ length: n }, (_, i) => entry(from + i));

const callbacks = (keyboard: ReturnType<typeof pickerKeyboard>): string[][] =>
    keyboard.map(row => row.map(b => b.callback_data!));

test('picker: a single page has no navigation row, only records and Cancel', () => {
    const kb = pickerKeyboard(entries(3), 42, 3, 0);
    assert.equal(kb.length, 4);  // 3 records + Cancel
    assert.deepEqual(callbacks(kb), [
        [`${CALLBACK_PREFIX}1`],
        [`${CALLBACK_PREFIX}2`],
        [`${CALLBACK_PREFIX}3`],
        [`${CALLBACK_PREFIX}cancel`]
    ]);
});

test('picker: the first of several pages offers Older but not Newer', () => {
    const kb = pickerKeyboard(entries(PAGE_SIZE), 42, 25, 0);
    const nav = kb[kb.length - 2];
    assert.deepEqual(nav.map(b => b.callback_data), [
        `${CALLBACK_PREFIX}noop`,
        `${CALLBACK_PREFIX}page:42:${PAGE_SIZE}`
    ]);
    assert.equal(nav[0].text, '1/3');
    assert.equal(nav[1].text, 'Older ➡️');
});

test('picker: a middle page offers both directions with the right offsets', () => {
    const kb = pickerKeyboard(entries(PAGE_SIZE), 42, 25, PAGE_SIZE);
    const nav = kb[kb.length - 2];
    assert.deepEqual(nav.map(b => b.callback_data), [
        `${CALLBACK_PREFIX}page:42:0`,
        `${CALLBACK_PREFIX}noop`,
        `${CALLBACK_PREFIX}page:42:${2 * PAGE_SIZE}`
    ]);
    assert.equal(nav[1].text, '2/3');
});

test('picker: the last page offers Newer but not Older', () => {
    const kb = pickerKeyboard(entries(5), 42, 25, 2 * PAGE_SIZE);
    const nav = kb[kb.length - 2];
    assert.deepEqual(nav.map(b => b.callback_data), [
        `${CALLBACK_PREFIX}page:42:${PAGE_SIZE}`,
        `${CALLBACK_PREFIX}noop`
    ]);
    assert.equal(nav[1].text, '3/3');
});

test('picker: record buttons carry result, map, mode, score and an unambiguous date', () => {
    const kb = pickerKeyboard(entries(1), 42, 1, 0);
    assert.equal(kb[0][0].text, '🏆 Vertigo · Competitive · 13-7 · 1 Jan 2026 12:00 UTC');
});
