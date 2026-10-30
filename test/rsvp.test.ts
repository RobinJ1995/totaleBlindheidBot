import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyboard, resolve } from '../rsvp.js';
import { Rsvp, RsvpEntry } from '../dao/RsvpDAO.js';

const noGroups: Record<Rsvp, string[]> = { yes: [], maybe: [], no: [] };

const buttons = (markup: ReturnType<typeof keyboard>) => markup.inline_keyboard[0];

test('the RSVP buttons are green, blue and red', () => {
    assert.deepEqual(buttons(keyboard('rollcall', noGroups)).map(b => b.style), ['success', 'primary', 'danger']);
});

test('the RSVP buttons leave out the count while nobody has picked them', () => {
    assert.deepEqual(buttons(keyboard('schedule', noGroups)).map(b => b.text), ["✅ I'm in", 'Maybe', 'No']);
});

test('the RSVP buttons show how many people picked each option', () => {
    const groups: Record<Rsvp, string[]> = { yes: ['A', 'B', 'C'], maybe: ['D'], no: [] };
    assert.deepEqual(buttons(keyboard('rollcall', groups)).map(b => b.text), ['✅ Joining · 3', 'Maybe/Later · 1', 'No']);
});

test('the counts on the buttons cover rotation players and other tappers alike', () => {
    const entries: Record<string, RsvpEntry> = {
        '777': { user_id: 777, name: 'Alice', rsvp: 'yes' },
        '888': { user_id: 888, name: 'Outsider', rsvp: 'yes' },
        '999': { user_id: 999, name: 'Bob', username: 'bob', rsvp: 'no' }
    };
    const { groups } = resolve(['[Alice](tg://user?id=777)', '@bob', '@carol'], entries);
    assert.deepEqual(buttons(keyboard('schedule', groups)).map(b => b.text), ["✅ I'm in · 2", 'Maybe', 'No · 1']);
});

test('the callback data does not depend on the labels', () => {
    const groups: Record<Rsvp, string[]> = { yes: ['A'], maybe: ['B'], no: ['C'] };
    assert.deepEqual(buttons(keyboard('schedule', groups)).map(b => b.callback_data), ['rsvp:yes', 'rsvp:maybe', 'rsvp:no']);
});
