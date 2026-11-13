import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import LeetifyClient from '../leetify/LeetifyClient.js';

afterEach(() => mock.restoreAll());

const answer = (status: number, body: unknown = {}) =>
    mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status }));

const matchData = { id: 'm1', finished_at: '2026-11-12T20:00:00.000Z', data_source: 'matchmaking', team_scores: [], stats: [] };

test('an account\'s recent matches are fetched by Steam ID', async () => {
    const fetched = answer(200, [matchData]);
    const matches = await new LeetifyClient('http://leetify.test', undefined).recentMatches('7656');
    assert.deepEqual(matches?.map(match => match.id), ['m1']);
    assert.equal(fetched.mock.calls[0].arguments[0], 'http://leetify.test/v3/profile/matches?steam64_id=7656');
    assert.deepEqual((fetched.mock.calls[0].arguments[1] as RequestInit).headers, {});
});

test('an account that is not on Leetify has no recent matches', async () => {
    answer(404);
    assert.equal(await new LeetifyClient('http://leetify.test', undefined).recentMatches('7656'), null);
});

test('a match is fetched by id, signed with the API key', async () => {
    const fetched = answer(200, matchData);
    const match = await new LeetifyClient('http://leetify.test', 'secret').match('m1');
    assert.equal(match.id, 'm1');
    assert.equal(fetched.mock.calls[0].arguments[0], 'http://leetify.test/v2/matches/m1');
    assert.deepEqual((fetched.mock.calls[0].arguments[1] as RequestInit).headers, { _leetify_key: 'secret' });
});

test('any other failure is an error', async () => {
    answer(500);
    await assert.rejects(new LeetifyClient('http://leetify.test', undefined).recentMatches('7656'), /Leetify answered 500/);
    answer(404);
    await assert.rejects(new LeetifyClient('http://leetify.test', undefined).match('m1'), /Leetify answered 404/);
});
