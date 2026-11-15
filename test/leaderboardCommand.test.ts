import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from 'node-telegram-bot-api';
import { Command } from '../MessageRouter.js';
import GameHistoryDAO, { GameHistoryEntry } from '../dao/GameHistoryDAO.js';
import { messageText, Part } from '../format.js';
import leaderboard from '../command/leaderboard.js';

const command = (argument: string, replies: Part[]): Command => ({
    platform: 'telegram',
    chat_id: -9,
    user: { id: 1 },
    command: { name: 'leaderboard', argument, argumentTokens: argument ? argument.split(' ') : [] },
    reply: async (text: Part) => replies.push(text),
    replyPrivately: async () => undefined
});

const win = (user_id: number): GameHistoryEntry =>
    ({ chat_id: -9, user_id, mode: 'Competitive', map: 'Nuke', score: '13-7', co_players: [], ended_at: new Date() });

afterEach(() => mock.restoreAll());

test('/leaderboard ranks the chat players by name, asking only for the filtered window', async () => {
    const history = mock.method(GameHistoryDAO.prototype, 'getChatHistory', async () => Array.from({ length: 5 }, () => win(3)));
    mock.method(GameHistoryDAO.prototype, 'getChatPlayers', async () => [{ user_id: 3, name: 'Carl' }]);
    const replies: Part[] = [];
    await leaderboard({} as Bot, command('week', replies));
    assert.equal(history.mock.calls[0].arguments[0], -9);
    assert.ok(history.mock.calls[0].arguments[1] instanceof Date);
    assert.equal(messageText(replies[0]).text, '🏆 Leaderboard (past week)\n1. Carl: ██████████ 100% (5 games)');
});

test('/leaderboard reports a failing lookup', async () => {
    mock.method(GameHistoryDAO.prototype, 'getChatHistory', async () => {
        throw new Error('db down');
    });
    mock.method(GameHistoryDAO.prototype, 'getChatPlayers', async () => []);
    const replies: Part[] = [];
    await leaderboard({} as Bot, command('', replies));
    assert.match(messageText(replies[0]).text, /db down/);
});
