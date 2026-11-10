import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from 'node-telegram-bot-api';
import ChatLinkDAO from '../dao/ChatLinkDAO.js';
import GameHistoryDAO, { GameHistoryEntry, SiblingMatch } from '../dao/GameHistoryDAO.js';
import RelayedMessageDAO from '../dao/RelayedMessageDAO.js';
import SteamService, { MatchResult } from '../SteamService.js';

const CHAT_ID = -7;

const bot = {
    api: {
        sendMessage: async () => ({ message_id: 50 }),
        editMessageText: async () => true
    }
} as unknown as Bot;

const match = (score: string): GameHistoryEntry => ({
    chat_id: CHAT_ID,
    user_id: 42,
    player_name: 'Sammy',
    map: 'Ancient',
    mode: 'Competitive',
    score,
    co_players: [],
    ended_at: new Date()
});

const announce = async (score: string, siblings: SiblingMatch[] = []): Promise<[number, MatchResult][]> => {
    mock.method(GameHistoryDAO.prototype, 'getRecentSiblingMatches', async () => siblings);
    mock.method(GameHistoryDAO.prototype, 'setGameHistoryMessageId', async () => undefined);
    mock.method(ChatLinkDAO.prototype, 'getLinks', async () => []);
    mock.method(RelayedMessageDAO.prototype, 'record', async () => undefined);
    mock.method(RelayedMessageDAO.prototype, 'find', async () => undefined);
    const service = new SteamService(bot);
    const finished: [number, MatchResult][] = [];
    service.onMatchFinished((chatId, result) => finished.push([chatId, result]));
    await (service as any).announceFinishedMatch(CHAT_ID, 2, match(score));
    return finished;
};

afterEach(() => {
    mock.restoreAll();
    SteamService.instance = null;
});

test('a won match is reported to the listeners', async () => {
    assert.deepEqual(await announce('13-4'), [[CHAT_ID, 'win']]);
});

test('a lost match is reported to the listeners', async () => {
    assert.deepEqual(await announce('4-13'), [[CHAT_ID, 'loss']]);
});

test('a tied match is reported to the listeners', async () => {
    assert.deepEqual(await announce('12-12'), [[CHAT_ID, 'tie']]);
});

test('a match without a usable score is not reported', async () => {
    assert.deepEqual(await announce('garbage'), []);
});

test('a co-player joining an already announced match is not reported again', async () => {
    const sibling: SiblingMatch = { id: 1, user_id: 43, player_name: 'Ann', score: '13-4', message_id: 50, co_players: [] };
    assert.deepEqual(await announce('13-4', [sibling]), []);
});
