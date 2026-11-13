import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import LeetifyClient from '../leetify/LeetifyClient.js';
import LeetifyDirectory from '../leetify/LeetifyDirectory.js';
import LeetifyMatch from '../leetify/LeetifyMatch.js';
import MatchSearch from '../leetify/MatchSearch.js';
import { leetifyMatch } from './leetifyFixtures.js';

const MINUTE_MS = 60_000;
const endedAt = new Date('2026-11-12T20:00:00.000Z');
const played = { score: '13-7', endedAt };

const searching = (histories: Record<string, LeetifyMatch[] | null>, minutesAfterEnd = 0) => {
    const clock = { now: endedAt.getTime() + minutesAfterEnd * MINUTE_MS };
    const client = new LeetifyClient('http://leetify.test', undefined);
    const asked: string[] = [];
    mock.method(client, 'recentMatches', async (steamId: string) => {
        asked.push(steamId);
        return histories[steamId] ?? null;
    });
    mock.method(client, 'match', async (id: string) => leetifyMatch({ id }));
    const search = new MatchSearch(new LeetifyDirectory(client, () => clock.now), [3 * MINUTE_MS, 6 * MINUTE_MS], () => clock.now);
    return { search, asked, clock };
};

test('a search is due at each scheduled time after the match ended, then never again', async () => {
    const { search, clock } = searching({ 1: [] });
    assert.equal(search.isDue('a', endedAt), false);

    clock.now += 3 * MINUTE_MS;
    assert.equal(search.isDue('a', endedAt), true);
    await search.attempt('a', ['1'], played);
    assert.equal(search.isDue('a', endedAt), false);

    clock.now += 3 * MINUTE_MS;
    assert.equal(search.isDue('a', endedAt), true);
    await search.attempt('a', ['1'], played);

    clock.now += 60 * MINUTE_MS;
    assert.equal(search.isDue('a', endedAt), false);
});

test('matches are looked for until the last scheduled time and a little after', () => {
    assert.equal(searching({}).search.windowMs, 16 * MINUTE_MS);
});

test('the played match is fetched in full once an account\'s recent matches hold it', async () => {
    const { search } = searching({ 1: [leetifyMatch({ id: 'other', finished_at: '2026-11-12T18:00:00.000Z' }), leetifyMatch({ id: 'played' })] });
    assert.equal((await search.attempt('a', ['1'], played))?.id, 'played');
});

test('of several matching matches the one that ended closest is the played one', async () => {
    const { search } = searching({ 1: [leetifyMatch({ id: 'earlier', finished_at: '2026-11-12T19:50:00.000Z' }), leetifyMatch({ id: 'closest', finished_at: '2026-11-12T20:01:00.000Z' })] });
    assert.equal((await search.attempt('a', ['1'], played))?.id, 'closest');
});

test('nothing is found while Leetify does not have the match', async () => {
    const { search } = searching({ 1: [] });
    assert.equal(await search.attempt('a', ['1'], played), null);
});

test('accounts that are not on Leetify are skipped, and asked only once', async () => {
    const { search, asked } = searching({ 2: [] });
    await search.attempt('a', ['1', '2'], played);
    assert.deepEqual(asked, ['1', '2']);

    await search.attempt('b', ['1', '2'], played);
    assert.deepEqual(asked, ['1', '2', '2']);
});

test('nobody being on Leetify costs one lookup per account, however many matches follow', async () => {
    const { search, asked } = searching({});
    assert.equal(await search.attempt('a', ['1', '2'], played), null);
    await search.attempt('a', ['1', '2'], played);
    await search.attempt('b', ['1', '2'], played);
    assert.deepEqual(asked, ['1', '2']);
});

test('each attempt asks another account that is on Leetify', async () => {
    const { search, asked } = searching({ 1: [], 2: [] });
    await search.attempt('a', ['1', '2'], played);
    await search.attempt('a', ['1', '2'], played);
    assert.deepEqual(asked, ['1', '2']);
});

test('a search without accounts finds nothing', async () => {
    assert.equal(await searching({}).search.attempt('a', [], played), null);
});

test('attempts on matches that are no longer looked for are forgotten', async () => {
    const { search, clock } = searching({ 1: [] }, 3);
    await search.attempt('old', ['1'], played);
    assert.equal(search.isDue('old', endedAt), false);

    clock.now += 60 * MINUTE_MS;
    await search.attempt('new', ['1'], { score: '13-7', endedAt: new Date(clock.now) });
    assert.equal(search.isDue('old', endedAt), true);
});

test('a match Leetify times at its start is found for a match that ended long after', async () => {
    const { search } = searching({ 1: [leetifyMatch({ id: 'played', finished_at: '2026-11-12T19:22:00.000Z' })] });
    const found = await search.attempt('a', ['1'], { score: '13-7', startedAt: new Date('2026-11-12T19:20:00.000Z'), endedAt });
    assert.equal(found?.id, 'played');
});

test('of two matches within the played one\'s span, the one nearest its start or end is the played one', async () => {
    const { search } = searching({ 1: [
        leetifyMatch({ id: 'next', finished_at: '2026-11-12T20:06:00.000Z' }),
        leetifyMatch({ id: 'played', finished_at: '2026-11-12T19:22:00.000Z' })
    ] });
    const found = await search.attempt('a', ['1'], { score: '13-7', startedAt: new Date('2026-11-12T19:20:00.000Z'), endedAt });
    assert.equal(found?.id, 'played');
});
