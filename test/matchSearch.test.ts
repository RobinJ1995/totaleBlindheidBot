import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import LeetifyClient from '../leetify/LeetifyClient.js';
import LeetifyDirectory from '../leetify/LeetifyDirectory.js';
import LeetifyMatch from '../leetify/LeetifyMatch.js';
import MatchSearch from '../leetify/MatchSearch.js';
import { leetifyMatch } from './leetifyFixtures.js';

afterEach(() => mock.restoreAll());

const logged = () => {
    const log = mock.method(console, 'log', () => undefined);
    return (): string[] => log.mock.calls.map(call => String(call.arguments[0]));
};

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

test('a found match is logged with the account it was found through', async () => {
    const lines = logged();
    const { search } = searching({ 1: [leetifyMatch({ id: 'played' })] });
    await search.attempt('7:12', ['1'], played);
    assert.deepEqual(lines(), ['Leetify lookup 1/2 for end-of-game message 7:12: found match played among the recent matches of Steam ID 1.']);
});

test('a match Leetify does not have is logged with what was looked for and the account\'s latest match', async () => {
    const lines = logged();
    const { search } = searching({ 1: [leetifyMatch({ finished_at: '2026-11-12T18:00:00.000Z' })] });
    await search.attempt('7:12', ['1'], played);
    await search.attempt('7:12', ['1'], played);
    assert.deepEqual(lines(), [
        'Leetify lookup 1/2 for end-of-game message 7:12: none of the 1 recent matches of Steam ID 1 ended around 2026-11-12T20:00:00.000Z at 13-7. Its latest ended 2026-11-12T18:00:00.000Z.',
        'Leetify lookup 2/2 for end-of-game message 7:12: none of the 1 recent matches of Steam ID 1 ended around 2026-11-12T20:00:00.000Z at 13-7. Its latest ended 2026-11-12T18:00:00.000Z.'
    ]);
});

test('an account without matches on Leetify is logged as never having played', async () => {
    const lines = logged();
    const { search } = searching({ 1: [] });
    await search.attempt('7:12', ['1'], played);
    assert.match(lines()[0], /none of the 0 recent matches of Steam ID 1 .* Its latest ended never\.$/);
});

test('a match nobody on Leetify played is logged, as is each account found not to be on it', async () => {
    const lines = logged();
    const { search } = searching({});
    await search.attempt('7:12', ['1', '2'], played);
    assert.deepEqual(lines(), [
        'Steam ID 1 is not on Leetify. Not asking about it again for 12h.',
        'Steam ID 2 is not on Leetify. Not asking about it again for 12h.',
        'Leetify lookup 1/2 for end-of-game message 7:12: none of the 2 Steam account(s) in the match is on Leetify.'
    ]);
});
