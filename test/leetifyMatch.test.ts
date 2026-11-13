import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leetifyMatch, playerStats } from './leetifyFixtures.js';

const endedAt = new Date('2026-11-12T20:02:00.000Z');

test('a match is the one played when it ended around the same time on about the same score', () => {
    assert.equal(leetifyMatch().isSameAs({ score: '13-7', endedAt }), true);
    assert.equal(leetifyMatch().isSameAs({ score: '7-13', endedAt }), true);
    assert.equal(leetifyMatch().isSameAs({ score: '12-6', endedAt }), true);
});

test('a match on another score, at another time or without a known score is not the one played', () => {
    assert.equal(leetifyMatch().isSameAs({ score: '13-3', endedAt }), false);
    assert.equal(leetifyMatch().isSameAs({ score: '13-7', endedAt: new Date('2026-11-12T20:16:00.000Z') }), false);
    assert.equal(leetifyMatch().isSameAs({ endedAt }), false);
});

test('a match Leetify times at its start is the one played when that falls within the played match', () => {
    const startedAt = new Date('2026-11-12T19:58:00.000Z');
    const played = { score: '13-7', startedAt, endedAt: new Date('2026-11-12T20:40:00.000Z') };
    assert.equal(leetifyMatch().isSameAs(played), true);
    assert.equal(leetifyMatch({ finished_at: '2026-11-12T19:44:00.000Z' }).isSameAs(played), true);
    assert.equal(leetifyMatch({ finished_at: '2026-11-12T19:42:00.000Z' }).isSameAs(played), false);
    assert.equal(leetifyMatch({ finished_at: '2026-11-12T20:56:00.000Z' }).isSameAs(played), false);
});

test('the distance to the played match is to the nearer of its start and end', () => {
    const startedAt = new Date('2026-11-12T19:57:00.000Z');
    assert.equal(leetifyMatch().timeDistanceMs({ endedAt }), 120_000);
    assert.equal(leetifyMatch().timeDistanceMs({ startedAt, endedAt: new Date('2026-11-12T20:40:00.000Z') }), 180_000);
    assert.equal(leetifyMatch().timeDistanceMs({ startedAt: new Date('2026-11-12T19:20:00.000Z'), endedAt }), 120_000);
});

test('premier and competitive matches are ranked, others are not', () => {
    assert.equal(leetifyMatch({ data_source: 'matchmaking' }).isRanked(), true);
    assert.equal(leetifyMatch({ data_source: 'matchmaking_competitive' }).isRanked(), true);
    assert.equal(leetifyMatch({ data_source: 'faceit' }).isRanked(), false);
});

test('a player\'s stats are found by any of their Steam accounts', () => {
    const match = leetifyMatch({ stats: [playerStats('1'), playerStats('2', { total_kills: 22 })] });
    assert.equal(match.statsOf(['9', '2'])?.total_kills, 22);
    assert.equal(match.statsOf(['9']), undefined);
});

test('a player\'s result follows the score of the team they started on', () => {
    const match = leetifyMatch({ stats: [playerStats('1'), playerStats('2', { initial_team_number: 3 })] });
    assert.equal(match.resultFor('1'), 'win');
    assert.equal(match.resultFor('2'), 'loss');
    assert.equal(match.resultFor('9'), null);
    const tied = leetifyMatch({ team_scores: [{ team_number: 2, score: 12 }, { team_number: 3, score: 12 }] });
    assert.equal(tied.resultFor('1'), 'tie');
});

test('a match exposes its id and end', () => {
    assert.equal(leetifyMatch().id, 'match-1');
    assert.deepEqual(leetifyMatch().finishedAt, new Date('2026-11-12T20:00:00.000Z'));
});
