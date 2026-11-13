import { test } from 'node:test';
import assert from 'node:assert/strict';
import MatchReport from '../leetify/MatchReport.js';
import Streak from '../stats/Streak.js';
import { playerStats } from './leetifyFixtures.js';

const player = (name: string, overrides = {}, streak: Streak | null = null) => ({ name, stats: playerStats(name, overrides), streak });

test('the scoreboard lists the players by kills in a monospace block', () => {
    const report = new MatchReport([
        player('Sam', { total_kills: 14, total_deaths: 11, total_assists: 6, dpr: 80.6 }),
        player('Kit', { total_kills: 22, total_deaths: 5, total_assists: 3, dpr: 125.71 })
    ]).toFormatted();
    const scoreboard = [
        'Player       K   D   A ADR',
        'Kit         22   5   3 126',
        'Sam         14  11   6  81'
    ].join('\n');
    assert.equal(report.text, scoreboard);
    assert.deepEqual(report.entities, [{ type: 'pre', offset: 0, length: scoreboard.length }]);
});

test('long names are cut to fit the scoreboard', () => {
    const report = new MatchReport([player('Bartholomew the Third')]).toFormatted();
    assert.equal(report.text.split('\n')[1], 'Bartholome  10  10   2  70');
});

test('aces and 4ks are highlighted above the scoreboard', () => {
    const report = new MatchReport([
        player('Kit', { multi5k: 1, multi4k: 2 }),
        player('Sam', { multi5k: 2 }),
        player('Jo', { multi4k: 1 }),
        player('Max')
    ]).toFormatted();
    assert.deepEqual(report.text.split('\n').slice(0, 4), ['💥 Kit: ace, 2 4ks', '💥 Sam: 2 aces', '💥 Jo: 4k', 'Player       K   D   A ADR']);
    assert.equal(report.entities[0].offset, report.text.indexOf('Player '));
});

test('flashing teammates is highlighted from eight times', () => {
    const report = new MatchReport([player('Kit', { flashbang_hit_friend: 7 }), player('Jo', { flashbang_hit_friend: 8 })]).toFormatted();
    assert.equal(report.text.split('\n')[0], '😵 Jo flashed teammates 8 times');
    assert.equal(report.text.includes('Kit flashed'), false);
});

test('notable streaks are highlighted, shorter ones are not', () => {
    const report = new MatchReport([
        player('Kit', {}, Streak.ending(['win', 'win', 'win'])),
        player('Jo', {}, Streak.ending(['loss', 'loss']))
    ]).toFormatted();
    assert.equal(report.text.split('\n')[0], '🔥 Kit: 3 wins in a row');
    assert.equal(report.text.includes('Jo:'), false);
});

test('at most four highlights are shown: multi-kills, then team flashes, then streaks', () => {
    const report = new MatchReport([
        player('Kit', { multi5k: 1, flashbang_hit_friend: 12 }, Streak.ending(['win', 'win', 'win'])),
        player('Jo', { multi4k: 1, flashbang_hit_friend: 11 }, Streak.ending(['win', 'win', 'win']))
    ]).toFormatted();
    assert.deepEqual(report.text.split('\n').slice(0, 5), [
        '💥 Kit: ace',
        '💥 Jo: 4k',
        '😵 Kit flashed teammates 12 times',
        '😵 Jo flashed teammates 11 times',
        'Player       K   D   A ADR'
    ]);
});
