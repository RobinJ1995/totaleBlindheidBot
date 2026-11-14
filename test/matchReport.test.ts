import { test } from 'node:test';
import assert from 'node:assert/strict';
import MatchReport from '../leetify/MatchReport.js';
import { playerStats } from './leetifyFixtures.js';

const player = (name: string, overrides = {}) => ({ name, stats: playerStats(name, overrides), streak: null });

test('the scoreboard lists the players by kills, each row in monospace', () => {
    const report = new MatchReport([
        player('Sam', { total_kills: 14, total_deaths: 11, total_assists: 6, dpr: 80.6 }),
        player('Kit', { total_kills: 22, total_deaths: 5, total_assists: 3, dpr: 95.4 })
    ], []).toFormatted();
    assert.equal(report.text, [
        'Player       K   D   A ADR',
        'Kit         22   5   3  95',
        'Sam         14  11   6  81'
    ].join('\n'));
    assert.deepEqual(report.entities, [
        { type: 'code', offset: 0, length: 26 },
        { type: 'code', offset: 27, length: 26 },
        { type: 'code', offset: 54, length: 26 }
    ]);
});

test('long names are cut to fit the scoreboard', () => {
    const report = new MatchReport([player('Bartholomew the Third')], []).toFormatted();
    assert.equal(report.text.split('\n')[1], 'Bartholome  10  10   2  70');
});

test('highlights come above the scoreboard, unformatted', () => {
    const report = new MatchReport([player('Kit', { multi5k: 1 })], []).toFormatted();
    assert.deepEqual(report.text.split('\n').slice(0, 2), ['💥 Kit: ace', 'Player       K   D   A ADR']);
    assert.equal(report.entities[0].offset, report.text.indexOf('Player '));
});
