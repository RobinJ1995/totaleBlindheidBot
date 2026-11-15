import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCommandPlayer, matchPlayerArgument, matchPlayerPairs, mismatchReply, targetOrReply } from '../command/playerArg.js';
import GameHistoryDAO, { ChatPlayer } from '../dao/GameHistoryDAO.js';
import { Command } from '../MessageRouter.js';
import { Part } from '../format.js';

const roster: ChatPlayer[] = [
    { user_id: 1, name: 'Alice', username: 'alice_cs' },
    { user_id: 2, name: 'Bob' },
    { user_id: 3, name: 'Bob', username: 'bobby' },  // shares a display name with user 2
    { user_id: 4, name: 'eve', username: 'mallory' },  // one player's name…
    { user_id: 5, name: 'zed', username: 'eve' },       // …equals another's username
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

test('a leading @ matches usernames only, never display names', () => {
    // "Bob" is a display name but nobody's username, so an explicit @Bob finds nothing.
    assert.deepEqual(matchPlayerArgument(roster, '@Bob'), { kind: 'none', needle: '@Bob' });
});

test('a bare name goes to the Telegram username holder before anyone called that', () => {
    // "eve" is user 4's display name and user 5's Telegram username.
    assert.deepEqual(matchPlayerArgument(roster, 'eve'), { kind: 'player', user_id: 5, name: 'zed' });
    assert.deepEqual(matchPlayerArgument(roster, '@eve'), { kind: 'player', user_id: 5, name: 'zed' });
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

const withDiscord: ChatPlayer[] = [
    { user_id: 6, name: 'Kit', discord_username: 'kit_cs' },
    { user_id: 7, name: 'Lee', username: 'kit_cs' },  // a Telegram username equal to another's Discord username
];

test('a bare word matches a Discord username too', () => {
    assert.deepEqual(matchPlayerArgument([withDiscord[0]], 'KIT_CS'), { kind: 'player', user_id: 6, name: 'Kit' });
});

test('a bare name goes to the Telegram username holder before the Discord one', () => {
    assert.deepEqual(matchPlayerArgument(withDiscord, 'kit_cs'), { kind: 'player', user_id: 7, name: 'Lee' });
});

test('discord:<username> matches Discord usernames only', () => {
    assert.deepEqual(matchPlayerArgument(withDiscord, 'discord:kit_cs'), { kind: 'player', user_id: 6, name: 'Kit' });
    assert.deepEqual(matchPlayerArgument(withDiscord, 'discord:lee'), { kind: 'none', needle: 'discord:lee' });
});

test('@username still matches Telegram usernames only', () => {
    assert.deepEqual(matchPlayerArgument(withDiscord, '@kit_cs'), { kind: 'player', user_id: 7, name: 'Lee' });
});

test('a mismatch is explained, a resolved argument is not', () => {
    assert.equal(mismatchReply({ kind: 'none', needle: 'x' }), 'I don\'t have any recorded games for "x" in this chat.');
    assert.equal(mismatchReply({ kind: 'ambiguous', needle: 'Bob', names: ['Bob', 'Bob (@bobby)'] }),
        '"Bob" matches multiple players: Bob, Bob (@bobby). Please be more specific.');
    assert.equal(mismatchReply({ kind: 'self' }), null);
    assert.equal(mismatchReply({ kind: 'player', user_id: 1, name: 'Alice' }), null);
});

const spaced: ChatPlayer[] = [
    { user_id: 8, name: 'Al' },
    { user_id: 9, name: 'Al Bo' },
    { user_id: 10, name: 'Bo Cy' },
    { user_id: 11, name: 'Cy' },
    { user_id: 12, name: 'Bob' },
    { user_id: 13, name: 'Bob' },
];

test('a pair splits between any two words', () => {
    assert.deepEqual(matchPlayerPairs(spaced, ' Al  Bo Cy  ').map(pair => pair.map(p => p.user_id)), [[8, 10], [9, 11]]);
    assert.deepEqual(matchPlayerPairs(spaced, 'cy al'), [
        [{ kind: 'player', user_id: 11, name: 'Cy' }, { kind: 'player', user_id: 8, name: 'Al' }]
    ]);
});

test('a split with a side that matches nobody or several players is not a pair', () => {
    assert.deepEqual(matchPlayerPairs(spaced, 'Al Nobody'), []);
    assert.deepEqual(matchPlayerPairs(spaced, 'Al Bob'), []);
    assert.deepEqual(matchPlayerPairs(spaced, 'Al'), []);
    assert.deepEqual(matchPlayerPairs(spaced, ''), []);
});

const discordCommand = (argument: string, replies: Part[] = []): Command => ({
    platform: 'discord',
    chat_id: -9,
    user: { id: 1, name: 'Sender' },
    command: { name: 'stats', argument, argumentTokens: argument.split(' ') },
    reply: async (text: Part) => replies.push(text),
    replyPrivately: async () => undefined
});

const daoWith = (players: ChatPlayer[]): GameHistoryDAO => ({ getChatPlayers: async () => players }) as unknown as GameHistoryDAO;

test('a command without an argument matches the sender without reading the roster', async () => {
    const dao = { getChatPlayers: async () => assert.fail('roster read') } as unknown as GameHistoryDAO;
    assert.deepEqual(await matchCommandPlayer(dao, discordCommand(' ')), { match: { kind: 'self' }, players: [] });
});

test('a command argument is matched against the chat roster, which comes along', async () => {
    assert.deepEqual(await matchCommandPlayer(daoWith(spaced), discordCommand('al bo')),
        { match: { kind: 'player', user_id: 9, name: 'Al Bo' }, players: spaced });
});

test('a resolved match becomes a target without a reply', async () => {
    const replies: Part[] = [];
    assert.deepEqual(await targetOrReply(discordCommand('', replies), { kind: 'self' }), { user_id: 1 });
    assert.deepEqual(await targetOrReply(discordCommand('', replies), { kind: 'player', user_id: 8, name: 'Al' }), { user_id: 8, name: 'Al' });
    assert.deepEqual(replies, []);
});

test('a mismatch is replied to and yields no target', async () => {
    const replies: Part[] = [];
    assert.equal(await targetOrReply(discordCommand('', replies), { kind: 'none', needle: 'x' }), null);
    assert.deepEqual(replies, ['I don\'t have any recorded games for "x" in this chat.']);
});
