import { test } from 'node:test';
import assert from 'node:assert/strict';
import Streak from '../stats/Streak.js';

test('a run of wins is counted back to the last other result', () => {
    const streak = Streak.ending(['win', 'loss', 'win', 'win', 'win']);
    assert.equal(streak?.result, 'win');
    assert.equal(streak?.length, 3);
    assert.equal(streak?.describe('Kit'), '🔥 Kit: 3 wins in a row');
});

test('a run of losses stops at a tie', () => {
    const streak = Streak.ending(['loss', 'tie', 'loss', 'loss', 'loss', 'loss']);
    assert.equal(streak?.length, 4);
    assert.equal(streak?.describe('Kit'), '💀 Kit: 4 losses in a row');
});

test('a run covering every result is as long as the results', () => {
    assert.equal(Streak.ending(['win', 'win'])?.length, 2);
});

test('there is no run after a tie or without results', () => {
    assert.equal(Streak.ending(['win', 'win', 'tie']), null);
    assert.equal(Streak.ending([]), null);
});

test('a run is notable from three matches', () => {
    assert.equal(Streak.ending(['win', 'win'])?.isNotable(), false);
    assert.equal(Streak.ending(['win', 'win', 'win'])?.isNotable(), true);
});

test('only competitive and premier matches count towards a run', () => {
    assert.equal(Streak.counts('Competitive'), true);
    assert.equal(Streak.counts('Premier'), true);
    assert.equal(Streak.counts('Casual'), false);
    assert.equal(Streak.counts(undefined), false);
});
