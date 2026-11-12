import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import LeetifyClient from '../leetify/LeetifyClient.js';
import LeetifyDirectory from '../leetify/LeetifyDirectory.js';
import LeetifyMatch from '../leetify/LeetifyMatch.js';
import { leetifyMatch } from './leetifyFixtures.js';

const HOUR_MS = 60 * 60 * 1000;

const clientAnswering = (recentMatches: () => LeetifyMatch[] | null) => {
    const client = new LeetifyClient('http://leetify.test', undefined);
    return {
        client,
        recentMatches: mock.method(client, 'recentMatches', async () => recentMatches()),
        match: mock.method(client, 'match', async (id: string) => leetifyMatch({ id }))
    };
};

test('an account that is not on Leetify is not looked up again for twelve hours', async () => {
    let now = 0;
    const { client, recentMatches } = clientAnswering(() => null);
    const directory = new LeetifyDirectory(client, () => now);

    assert.equal(await directory.recentMatches('1'), null);
    now = 11 * HOUR_MS;
    assert.equal(await directory.recentMatches('1'), null);
    assert.equal(recentMatches.mock.callCount(), 1);

    now = 13 * HOUR_MS;
    await directory.recentMatches('1');
    assert.equal(recentMatches.mock.callCount(), 2);
});

test('an account that is on Leetify is looked up every time', async () => {
    const { client, recentMatches } = clientAnswering(() => [leetifyMatch()]);
    const directory = new LeetifyDirectory(client);

    assert.equal((await directory.recentMatches('1'))?.length, 1);
    await directory.recentMatches('1');
    assert.equal(recentMatches.mock.callCount(), 2);
});

test('an account is looked up again once it has joined Leetify', async () => {
    let now = 0;
    let registered = false;
    const { client } = clientAnswering(() => registered ? [] : null);
    const directory = new LeetifyDirectory(client, () => now);

    await directory.recentMatches('1');
    registered = true;
    now = 13 * HOUR_MS;
    assert.deepEqual(await directory.recentMatches('1'), []);
});

test('a match is fetched once', async () => {
    const { client, match } = clientAnswering(() => []);
    const directory = new LeetifyDirectory(client);

    assert.equal((await directory.match('m1')).id, 'm1');
    await directory.match('m1');
    assert.equal(match.mock.callCount(), 1);
});

test('only the latest fifty matches are remembered', async () => {
    const { client, match } = clientAnswering(() => []);
    const directory = new LeetifyDirectory(client);
    for (let i = 0; i <= 50; i++) {
        await directory.match(`m${i}`);
    }

    await directory.match('m50');
    assert.equal(match.mock.callCount(), 51);
    await directory.match('m0');
    assert.equal(match.mock.callCount(), 52);
});
