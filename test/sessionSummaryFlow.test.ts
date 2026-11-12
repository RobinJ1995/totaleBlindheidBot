import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from 'node-telegram-bot-api';
import SteamService from '../SteamService.js';
import { ChatMatch } from '../dao/GameHistoryDAO.js';

const HOUR = 60 * 60 * 1000;

afterEach(() => {
    SteamService.instance = null;
    mock.restoreAll();
});

const match = (id: number, score: string): ChatMatch =>
    ({ id, message_id: null, map: 'Inferno', mode: 'Competitive', score, started_at: new Date(Date.now() - HOUR), ended_at: new Date() });

interface Setup {
    playing?: boolean;
    steamUpdates?: boolean;
    lastSentAt?: Date | null;
    matches?: ChatMatch[];
}

const service = (setup: Setup = {}) => {
    const sent: string[] = [];
    const steam: any = new SteamService({ api: { sendMessage: async ({ text }) => sent.push(text) } } as unknown as Bot);
    const sinces: Date[] = [];
    const marked: Date[] = [];
    steam.userDao = {
        getChatUsers: async () => [{ user_id: 1 }, { user_id: 2 }],
        getUserSettings: async (userId: number) => ({ steam_ids: [`steam${userId}`] })
    };
    steam.isAnyAccountPlayingCS2 = async (userId: number) => !!setup.playing && userId === 2;
    steam.chatDao = { getChatSettings: async () => (setup.steamUpdates === false ? { steam_updates: false } : {}) };
    steam.sessionSummaryDao = {
        getLastSentAt: async () => setup.lastSentAt ?? null,
        setLastSentAt: async (_chatId: number, at: Date) => marked.push(at)
    };
    steam.gameHistoryDao = {
        getChatMatchesSince: async (_chatId: number, since: Date) => {
            sinces.push(since);
            return setup.matches ?? [match(1, '13-5'), match(2, '5-13')];
        }
    };
    steam.summaryPendingChats.add(10);
    return { steam, sent, sinces, marked };
};

test('a finished session is summarised once', async () => {
    const { steam, sent, marked } = service();
    await steam.maybeSummarizeSession(10, new Set());
    assert.equal(sent.length, 1);
    assert.match(sent[0], /^📊 Session summary: 2 games, 1W 1L/);
    assert.equal(marked.length, 1);
    assert.equal(steam.summaryPendingChats.has(10), false);
});

test('no summary while someone in the chat still plays, until they stop again', async () => {
    const { steam, sent, marked } = service({ playing: true });
    await steam.maybeSummarizeSession(10, new Set());
    assert.deepEqual(sent, []);
    assert.deepEqual(marked, []);
    assert.equal(steam.summaryPendingChats.has(10), false);
});

test('the summary waits for every match of the chat to be recorded', async () => {
    const { steam, sent } = service();
    await steam.maybeSummarizeSession(10, new Set(['steam2']));
    assert.deepEqual(sent, []);
    assert.equal(steam.summaryPendingChats.has(10), true);

    await steam.maybeSummarizeSession(10, new Set(['steam3']));
    assert.equal(sent.length, 1);
});

test('a chat with Steam updates off gets no summary', async () => {
    const { steam, sent } = service({ steamUpdates: false });
    await steam.maybeSummarizeSession(10, new Set());
    assert.deepEqual(sent, []);
    assert.equal(steam.summaryPendingChats.has(10), false);
});

test('a one-match session is not summarised, but still ends the window', async () => {
    const { steam, sent, marked } = service({ matches: [match(1, '13-5')] });
    await steam.maybeSummarizeSession(10, new Set());
    assert.deepEqual(sent, []);
    assert.equal(marked.length, 1);
});

test('matches are counted since the last summary, but at most 12 hours back', async () => {
    const recent = new Date(Date.now() - 2 * HOUR);
    const { steam: afterRecent, sinces: recentSince } = service({ lastSentAt: recent });
    await afterRecent.maybeSummarizeSession(10, new Set());
    assert.equal(recentSince[0].getTime(), recent.getTime());

    const { steam: afterOld, sinces: oldSince } = service({ lastSentAt: new Date(Date.now() - 48 * HOUR) });
    await afterOld.maybeSummarizeSession(10, new Set());
    assert.ok(Math.abs(oldSince[0].getTime() - (Date.now() - 12 * HOUR)) < 1000);
});
