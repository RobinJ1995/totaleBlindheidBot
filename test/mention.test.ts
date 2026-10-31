import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayName, mentionText, parseMention, resolve } from '../rsvp.js';
import { User } from '../dao/UserDAO.js';

test('a user mention parses to its user id', () => {
    assert.deepEqual(parseMention('[Alice](user:42)'), { id: 42, display: 'Alice' });
});

test('an @username and a bare name parse without an id', () => {
    assert.deepEqual(parseMention('@alice_cs'), { username: 'alice_cs', display: '@alice_cs' });
    assert.deepEqual(parseMention('Alice'), { display: 'Alice' });
});

test('the legacy Telegram link form is no longer a user mention', () => {
    assert.deepEqual(parseMention('[Alice](tg://user?id=777)'), { display: '[Alice](tg://user?id=777)' });
});

test('displayName breaks the @ so Telegram does not ping', () => {
    assert.equal(displayName('@alice'), '@​alice');
    assert.equal(displayName('Alice'), 'Alice');
});

const users: Record<number, User> = {
    1: { id: 1, telegram_id: 777, name: 'Alice' },
    2: { id: 2, discord_id: '123456789012345678', discord_username: 'bob' }
};

test('mentionText links a Telegram user by their Telegram id', () => {
    assert.deepEqual(mentionText('[Alice](user:1)', users), {
        text: 'Alice',
        entities: [{ type: 'text_link', offset: 0, length: 5, url: 'tg://user?id=777' }]
    });
});

test('mentionText names a user who cannot be reached on Telegram', () => {
    assert.equal(mentionText('[Bob](user:2)', users), 'Bob');
    assert.equal(mentionText('[Nobody](user:99)', users), 'Nobody');
});

test('mentionText passes @usernames and names through', () => {
    assert.equal(mentionText('@carol', users), '@carol');
    assert.equal(mentionText('Dave', users), 'Dave');
});

test('resolve matches RSVP entries to rotation players by user id or username', () => {
    const rotation = ['[Alice](user:1)', '@carol', 'Dave'];
    const entries = {
        1: { user_id: 1, name: 'Alice', rsvp: 'yes' as const },
        3: { user_id: 3, name: 'Carol', username: 'carol', rsvp: 'no' as const },
        4: { user_id: 4, name: 'Eve', rsvp: 'maybe' as const }
    };
    assert.deepEqual(resolve(rotation, entries), {
        groups: { yes: ['Alice'], maybe: ['Eve'], no: ['@​carol'] },
        tagged: ['[Alice](user:1)', 'Dave']
    });
});
