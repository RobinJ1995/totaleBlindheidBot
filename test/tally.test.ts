import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCompetitive, Ratio, Tally } from '../stats/Tally.js';
import { GameHistoryEntry } from '../dao/GameHistoryDAO.js';

const game = (map: string | undefined, score: string | undefined): GameHistoryEntry => ({
    chat_id: 1,
    user_id: 1,
    mode: 'Competitive',
    map,
    score,
    co_players: [],
    ended_at: new Date('2026-01-01T12:00:00.000Z')
});

test('competitive and premier modes count as competitive, others do not', () => {
    assert.equal(isCompetitive('Competitive'), true);
    assert.equal(isCompetitive('Premier - Competitive'), true);
    assert.equal(isCompetitive('premier'), true);
    assert.equal(isCompetitive('Wingman'), false);
    assert.equal(isCompetitive(undefined), false);
});

test('a ratio renders as a rounded percentage, and 0% for an empty whole', () => {
    assert.equal(new Ratio(2, 3).percent(), '67%');
    assert.equal(new Ratio(0, 0).percent(), '0%');
});

test('a ratio renders as a ten-cell bar', () => {
    assert.equal(new Ratio(6, 10).bar(), '██████░░░░ 60%');
    assert.equal(new Ratio(0, 0).bar(), '░░░░░░░░░░ 0%');
});

test('adding results returns a new tally and leaves the original alone', () => {
    const tally = Tally.EMPTY.add('win').add('loss').add('tie').add(null);
    assert.deepEqual(
        { games: tally.games, wins: tally.wins, losses: tally.losses, ties: tally.ties, decisive: tally.decisive },
        { games: 4, wins: 1, losses: 1, ties: 1, decisive: 3 }
    );
    assert.equal(Tally.EMPTY.games, 0);
});

test('a tally of entries counts each result', () => {
    const tally = Tally.of([game('Nuke', '13-7'), game('Nuke', '7-13'), game('Nuke', '13-7')]);
    assert.deepEqual([tally.games, tally.wins, tally.losses], [3, 2, 1]);
});

test('a tally summarises as its win-rate bar and game count', () => {
    assert.equal(Tally.of([game('Nuke', '13-7'), game('Nuke', '7-13')]).summary(), '█████░░░░░ 50% (2 games)');
    assert.equal(Tally.of([game('Nuke', '13-7')]).summary(), '██████████ 100% (1 game)');
});
