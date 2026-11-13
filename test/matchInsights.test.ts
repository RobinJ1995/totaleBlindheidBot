import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import LeetifyClient from '../leetify/LeetifyClient.js';
import LeetifyDirectory from '../leetify/LeetifyDirectory.js';
import LeetifyMatch from '../leetify/LeetifyMatch.js';
import Streak from '../stats/Streak.js';
import MatchInsights from '../leetify/MatchInsights.js';
import { leetifyMatch, playedMatch, playerStats } from './leetifyFixtures.js';

afterEach(() => mock.restoreAll());

const insightsInto = (match: LeetifyMatch, histories: Record<string, LeetifyMatch[] | null | Error> = {}) => {
    const client = new LeetifyClient('http://leetify.test', undefined);
    mock.method(client, 'match', async () => match);
    mock.method(client, 'recentMatches', async (steamId: string) => {
        const history = histories[steamId] ?? null;
        if (history instanceof Error) {
            throw history;
        }
        return history;
    });
    return new MatchInsights(new LeetifyDirectory(client));
};

const kit = { name: 'Kit', steamIds: ['1'] };
const sam = { name: 'Sam', steamIds: ['2'] };

test('the report covers the participants Leetify has in the match, under their chat names', async () => {
    const match = leetifyMatch({ stats: [playerStats('1', { total_kills: 22 }), playerStats('7')] });
    const report = await insightsInto(match).report('match-1', [kit, sam]);
    assert.deepEqual(report?.text.split('\n'), ['Player       K   D   A ADR', 'Kit         22  10   2  70']);
});

test('there is no report when Leetify has none of the participants in the match', async () => {
    assert.equal(await insightsInto(leetifyMatch({ stats: [playerStats('7')] })).report('match-1', [kit, sam]), null);
});

test('a player\'s streak runs over their ranked matches up to the reported one', async () => {
    const match = playedMatch('1', 0, true, { id: 'match-1' });
    const report = await insightsInto(match, {
        1: [
            playedMatch('1', -30, false),
            match,
            playedMatch('1', 60, false, { data_source: 'faceit' }),
            playedMatch('1', 120, true),
            playedMatch('1', 180, true),
            playedMatch('1', 240, false)
        ]
    }).report('match-1', [kit]);
    assert.equal(report?.text.split('\n')[0], '🔥 Kit: 3 wins in a row');
});

test('a match that is not ranked shows no streak', async () => {
    const match = playedMatch('1', 0, true, { id: 'match-1', data_source: 'faceit' });
    const report = await insightsInto(match, { 1: [match, playedMatch('1', 60, true), playedMatch('1', 120, true)] }).report('match-1', [kit]);
    assert.equal(report?.text.includes('in a row'), false);
});

test('a player who is not on Leetify is reported without a streak', async () => {
    const match = leetifyMatch({ stats: [playerStats('2')] });
    const report = await insightsInto(match, { 2: null }).report('match-1', [sam]);
    assert.deepEqual(report?.text.split('\n'), ['Player       K   D   A ADR', 'Sam         10  10   2  70']);
});

test('a player whose matches cannot be loaded is reported without a streak', async () => {
    mock.method(console, 'error', () => undefined);
    const report = await insightsInto(leetifyMatch(), { 1: new Error('boom') }).report('match-1', [kit]);
    assert.deepEqual(report?.text.split('\n'), ['Player       K   D   A ADR', 'Kit         10  10   2  70']);
});

const losing = Streak.ending(['loss', 'loss', 'loss']);

test('a player who is not on Leetify keeps the streak they came with', async () => {
    const match = leetifyMatch({ stats: [playerStats('2')] });
    const report = await insightsInto(match, { 2: null }).report('match-1', [{ ...sam, streak: losing }]);
    assert.equal(report?.text.split('\n')[0], '💀 Sam: 3 losses in a row');
});

test('a player whose matches cannot be loaded keeps the streak they came with', async () => {
    mock.method(console, 'error', () => undefined);
    const report = await insightsInto(leetifyMatch(), { 1: new Error('boom') }).report('match-1', [{ ...kit, streak: losing }]);
    assert.equal(report?.text.split('\n')[0], '💀 Kit: 3 losses in a row');
});

test('a player who is on Leetify gets the streak Leetify shows, not the one they came with', async () => {
    const match = playedMatch('1', 0, true, { id: 'match-1' });
    const report = await insightsInto(match, { 1: [match, playedMatch('1', 60, true), playedMatch('1', 120, true)] })
        .report('match-1', [{ ...kit, streak: losing }]);
    assert.equal(report?.text.split('\n')[0], '🔥 Kit: 3 wins in a row');
});
