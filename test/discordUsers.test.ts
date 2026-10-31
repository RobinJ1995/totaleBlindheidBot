import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscordRef } from '../discord/users.js';

test('discord: references name a Discord username, with or without @', () => {
    assert.equal(parseDiscordRef('discord:alice'), 'alice');
    assert.equal(parseDiscordRef('discord:@Alice_CS'), 'alice_cs');
    assert.equal(parseDiscordRef('Discord:bob'), 'bob');
});

test('anything else is not a Discord reference', () => {
    assert.equal(parseDiscordRef('@alice'), undefined);
    assert.equal(parseDiscordRef('alice'), undefined);
    assert.equal(parseDiscordRef('discord:'), undefined);
});
