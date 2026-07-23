import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPlayerArgument } from '../command/playerArg.js';
import { ChatPlayer } from '../dao/GameHistoryDAO.js';

const roster: ChatPlayer[] = [
    { user_id: 1, name: 'Alice', username: 'alice_cs' },
    { user_id: 2, name: 'Bob' },
    { user_id: 3, name: 'Bob', username: 'bobby' },  // shares a display name with user 2
];

test('an empty argument targets the sender', () => {
    assert.deepEqual(matchPlayerArgument(roster, ''), { kind: 'self' });
    assert.deepEqual(matchPlayerArgument(roster, '   '), { kind: 'self' });
});

test('a tapped mention wins regardless of the roster', () => {
    const match = matchPlayerArgument([], 'Whoever', { user_id: 99, name: 'Whoever' });
    assert.deepEqual(match, { kind: 'player', user_id: 99, name: 'Whoever' });
});

test('a display name matches case-insensitively', () => {
    assert.deepEqual(matchPlayerArgument(roster, 'alice'), { kind: 'player', user_id: 1, name: 'Alice' });
});

test('a @username matches with or without the leading @', () => {
    assert.deepEqual(matchPlayerArgument(roster, '@alice_cs'), { kind: 'player', user_id: 1, name: 'Alice' });
    assert.deepEqual(matchPlayerArgument(roster, 'alice_cs'), { kind: 'player', user_id: 1, name: 'Alice' });
});

test('an unknown player yields none with the original needle', () => {
    assert.deepEqual(matchPlayerArgument(roster, 'Nobody'), { kind: 'none', needle: 'Nobody' });
});

test('a name shared by two players is ambiguous', () => {
    const match = matchPlayerArgument(roster, 'Bob');
    assert.equal(match.kind, 'ambiguous');
    if (match.kind === 'ambiguous') {
        assert.equal(match.needle, 'Bob');
        assert.deepEqual(match.names, ['Bob', 'Bob (@bobby)']);
    }
});

test('the same player matched by both name and username is not double-counted', () => {
    // user 3 matches "bobby" only by username; user 2 does not match, so this is unambiguous.
    assert.deepEqual(matchPlayerArgument(roster, 'bobby'), { kind: 'player', user_id: 3, name: 'Bob' });
});
