import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from 'node-telegram-bot-api';
import { Command } from '../MessageRouter.js';
import GameHistoryDAO, { GameHistoryEntry } from '../dao/GameHistoryDAO.js';
import { messageText, Part } from '../format.js';
import stats from '../command/stats.js';

const command = (argument: string, replies: Part[]): Command => ({
    platform: 'discord',
    chat_id: -9,
    user: { id: 1, name: 'Sender' },
    command: { name: 'stats', argument, argumentTokens: argument.split(' ') },
    reply: async (text: Part) => replies.push(text),
    replyPrivately: async () => undefined
});

const game = (score: string, partner?: number): GameHistoryEntry => ({
    chat_id: -9, user_id: 2, mode: 'Competitive', map: 'Nuke', score,
    co_players: partner ? [{ tg_user_id: partner, name: 'x' }] : [], ended_at: new Date()
});

const players = [{ user_id: 2, name: 'Alice' }, { user_id: 3, name: 'Bob' }];

afterEach(() => mock.restoreAll());

test('/stats a b reads the first player\'s history and compares it with the games together', async () => {
    mock.method(GameHistoryDAO.prototype, 'getChatPlayers', async () => players);
    const history = mock.method(GameHistoryDAO.prototype, 'getGameHistory', async () => [game('13-7', 3), game('7-13')]);
    const replies: Part[] = [];
    await stats({} as Bot, command('Alice Bob', replies));
    assert.deepEqual(history.mock.calls[0].arguments, [-9, 2]);
    assert.equal(messageText(replies[0]).text, '🤝 Alice with Bob\nTogether: ██████████ 100% (1 game)\nOverall: █████░░░░░ 50% (2 games)');
});

test('/stats a shows a\'s own stats when the whole argument names one player', async () => {
    mock.method(GameHistoryDAO.prototype, 'getChatPlayers', async () => [...players, { user_id: 4, name: 'Alice Bob' }]);
    const history = mock.method(GameHistoryDAO.prototype, 'getGameHistory', async () => [game('13-7')]);
    const replies: Part[] = [];
    await stats({} as Bot, command('Alice Bob', replies));
    assert.deepEqual(history.mock.calls[0].arguments, [-9, 4]);
    assert.match(messageText(replies[0]).text, /^Competitive stats for Alice Bob\n/);
});

test('/stats with two readings of the pair asks to be more specific', async () => {
    mock.method(GameHistoryDAO.prototype, 'getChatPlayers', async () => [...players, { user_id: 4, name: 'Bob Cy' }, { user_id: 5, name: 'Cy' }, { user_id: 6, name: 'Alice Bob' }]);
    const history = mock.method(GameHistoryDAO.prototype, 'getGameHistory', async () => []);
    const replies: Part[] = [];
    await stats({} as Bot, command('Alice Bob Cy', replies));
    assert.equal(history.mock.callCount(), 0);
    assert.deepEqual(replies, ['"Alice Bob Cy" matches multiple players: Alice and Bob Cy, Alice Bob and Cy. Please be more specific.']);
});

test('/stats a b that is no player nor pair says so for the whole argument', async () => {
    mock.method(GameHistoryDAO.prototype, 'getChatPlayers', async () => players);
    const history = mock.method(GameHistoryDAO.prototype, 'getGameHistory', async () => []);
    const replies: Part[] = [];
    await stats({} as Bot, command('Alice Nobody', replies));
    assert.equal(history.mock.callCount(), 0);
    assert.deepEqual(replies, ['I don\'t have any recorded games for "Alice Nobody" in this chat.']);
});
