import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { Bot } from 'node-telegram-bot-api';
import RecapService from '../RecapService.js';
import { GameHistoryEntry } from '../dao/GameHistoryDAO.js';

afterEach(() => {
    mock.restoreAll();
    delete process.env.RECAP_TIMEZONE;
});

let nextId = 1;
const match = (mode: string, score: string = '13-5'): GameHistoryEntry => {
    const id = nextId++;
    return { id, chat_id: 5, user_id: 1, player_name: 'Kit', mode, map: 'Nuke', score, message_id: id, co_players: [], ended_at: new Date('2026-11-14T12:00:00Z') };
};

interface Setup {
    now: string;
    history?: GameHistoryEntry[];
    steamUpdates?: boolean;
    claimed?: boolean;
}

const recapAt = (setup: Setup) => {
    const sent: string[] = [];
    const claims: [number, string][] = [];
    const sinces: Date[] = [];
    const bot = { api: { sendMessage: async ({ text }) => sent.push(text) } } as unknown as Bot;
    const historyDao: any = {
        getChatsWithHistoryBetween: async (since: Date, until: Date) => {
            sinces.push(since, until);
            return [5];
        },
        getChatHistory: async () => setup.history ?? [match('Competitive'), match('Premier')]
    };
    const chatDao: any = { getChatSettings: async () => (setup.steamUpdates === false ? { steam_updates: false } : {}) };
    const recapDao: any = {
        claim: async (chatId: number, week: string) => {
            claims.push([chatId, week]);
            return !setup.claimed;
        }
    };
    const service = new RecapService(bot, () => DateTime.fromISO(setup.now, { setZone: true }), historyDao, chatDao, recapDao);
    return { service, sent, claims, sinces };
};

test('a recap is posted on Sunday from 20:00 Amsterdam time, for the ISO week', async () => {
    const { service, sent, claims, sinces } = recapAt({ now: '2026-11-15T19:00:00Z' });
    await service.postDueRecaps();
    assert.equal(sent.length, 1);
    assert.match(sent[0], /^📅 Weekly recap: 2 games, 2W 0L/);
    assert.deepEqual(claims, [[5, '2026-W46']]);
    assert.deepEqual(sinces.map(date => date.toISOString()), ['2026-11-08T19:00:00.000Z', '2026-11-15T19:00:00.000Z']);
});

test('nothing is posted before Sunday 20:00 Amsterdam time', async () => {
    const before = recapAt({ now: '2026-11-15T18:59:00Z' });
    await before.service.postDueRecaps();
    const saturday = recapAt({ now: '2026-11-14T21:00:00Z' });
    await saturday.service.postDueRecaps();
    assert.deepEqual([...before.sent, ...saturday.sent], []);
    assert.deepEqual([...before.sinces, ...saturday.sinces], []);
});

test('the time zone comes from RECAP_TIMEZONE', async () => {
    process.env.RECAP_TIMEZONE = 'America/New_York';
    const early = recapAt({ now: '2026-11-15T19:00:00Z' });
    await early.service.postDueRecaps();
    assert.deepEqual(early.sent, []);

    const due = recapAt({ now: '2026-11-16T01:00:00Z' });
    await due.service.postDueRecaps();
    assert.equal(due.sent.length, 1);
    assert.deepEqual(due.claims, [[5, '2026-W46']]);
});

test('a week already recapped is not posted again', async () => {
    const { service, sent } = recapAt({ now: '2026-11-15T20:00:00Z', claimed: true });
    await service.postDueRecaps();
    assert.deepEqual(sent, []);
});

test('a chat with Steam updates off gets no recap', async () => {
    const { service, sent, claims } = recapAt({ now: '2026-11-15T20:00:00Z', steamUpdates: false });
    await service.postDueRecaps();
    assert.deepEqual(sent, []);
    assert.deepEqual(claims, []);
});

test('only competitive and premier games count, and a week without them gets no recap', async () => {
    const { service, sent, claims } = recapAt({ now: '2026-11-15T20:00:00Z', history: [match('Casual'), match('Wingman')] });
    await service.postDueRecaps();
    assert.deepEqual(sent, []);
    assert.deepEqual(claims, []);

    const mixed = recapAt({ now: '2026-11-15T20:00:00Z', history: [match('Casual'), match('Competitive', '5-13')] });
    await mixed.service.postDueRecaps();
    assert.match(mixed.sent[0], /^📅 Weekly recap: 1 game, 0W 1L/);
});

test('games after the recap\'s moment are left out', async () => {
    const later = { ...match('Competitive'), ended_at: new Date('2026-11-15T19:30:00Z') };
    const { service, sent } = recapAt({ now: '2026-11-15T19:00:00Z', history: [match('Competitive', '5-13'), later] });
    await service.postDueRecaps();
    assert.match(sent[0], /^📅 Weekly recap: 1 game, 0W 1L/);
});
