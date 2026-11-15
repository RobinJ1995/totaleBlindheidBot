import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from 'node-telegram-bot-api';
import { Command } from '../MessageRouter.js';
import GameHistoryDAO, { GameHistoryEntry } from '../dao/GameHistoryDAO.js';
import RsvpDAO from '../dao/RsvpDAO.js';
import RollcallPlayerDAO from '../dao/RollcallPlayerDAO.js';
import { messageText, Part } from '../format.js';
import mapCommand from '../command/map.js';

const command = (replies: Part[]): Command => ({
    platform: 'telegram',
    chat_id: -9,
    user: { id: 1 },
    command: { name: 'map', argument: '', argumentTokens: [] },
    reply: async (text: Part) => replies.push(text),
    replyPrivately: async () => undefined
});

const win = (user_id: number): GameHistoryEntry =>
    ({ chat_id: -9, user_id, mode: 'Competitive', map: 'Nuke', score: '13-7', co_players: [], ended_at: new Date() });

const history = (): void => {
    mock.method(GameHistoryDAO.prototype, 'getChatHistory', async () => [win(2), win(2), win(2), win(3), win(3), win(3)]);
    mock.method(GameHistoryDAO.prototype, 'getChatPlayers', async () => [{ user_id: 2, name: 'Alice' }, { user_id: 3, name: 'Bob' }]);
};

afterEach(() => mock.restoreAll());

test('/map picks for the latest rollcall\'s yes-voters', async () => {
    history();
    mock.method(RsvpDAO.prototype, 'getLatestYesVoters', async () => [2]);
    const rotation = mock.method(RollcallPlayerDAO.prototype, 'getRotationUserIds', async () => [3]);
    const replies: Part[] = [];
    await mapCommand({} as Bot, command(replies));
    assert.equal(rotation.mock.callCount(), 0);
    assert.equal(messageText(replies[0]).text, '🗺️ Map pick for Alice\nPlay: Nuke (100% won, 3 games)');
});

test('/map falls back to the rotation without yes-voters', async () => {
    history();
    mock.method(RsvpDAO.prototype, 'getLatestYesVoters', async () => []);
    mock.method(RollcallPlayerDAO.prototype, 'getRotationUserIds', async () => [3]);
    const replies: Part[] = [];
    await mapCommand({} as Bot, command(replies));
    assert.equal(messageText(replies[0]).text, '🗺️ Map pick for Bob\nPlay: Nuke (100% won, 3 games)');
});

test('/map says when there is nobody to pick for', async () => {
    mock.method(RsvpDAO.prototype, 'getLatestYesVoters', async () => []);
    mock.method(RollcallPlayerDAO.prototype, 'getRotationUserIds', async () => []);
    const replies: Part[] = [];
    await mapCommand({} as Bot, command(replies));
    assert.deepEqual(replies, ['Nobody said yes to the latest rollcall and the rotation is empty.']);
});
