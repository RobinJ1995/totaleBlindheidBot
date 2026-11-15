import { test } from 'node:test';
import assert from 'node:assert/strict';
import SessionSummary from '../stats/SessionSummary.js';
import { ChatMatch } from '../dao/GameHistoryDAO.js';

const at = (minutes: number): Date => new Date(Date.UTC(2026, 0, 1, 20, minutes));

let nextId = 1;
const row = (score: string, map: string, startedMinute: number, endedMinute: number, message_id: number | null = null): ChatMatch =>
    ({ id: nextId++, message_id, map, mode: 'Competitive', score, started_at: at(startedMinute), ended_at: at(endedMinute) });

test('a session of fewer than two matches is not worth a summary', () => {
    assert.equal(SessionSummary.of([]).isWorthSending(), false);
    assert.equal(SessionSummary.of([row('13-5', 'Inferno', 0, 30)]).isWorthSending(), false);
});

test('players announced together count as one match', () => {
    const summary = SessionSummary.of([row('13-5', 'Inferno', 0, 30, 7), row('13-5', 'Inferno', 1, 31, 7)]);
    assert.equal(summary.games, 1);
    assert.equal(summary.isWorthSending(), false);
});

test('matches without an announcement count on their own', () => {
    assert.equal(SessionSummary.of([row('13-5', 'Inferno', 0, 30), row('13-5', 'Inferno', 1, 31)]).games, 2);
});

test('the summary lists results, maps by how often they were played, and time in matches', () => {
    const summary = SessionSummary.of([
        row('13-5', 'Inferno', 0, 30, 1),
        row('13-5', 'Inferno', 1, 31, 1),
        row('9-13', 'Mirage', 35, 70),
        row('13-11', 'Mirage', 75, 120),
        row('12-12', 'Nuke', 125, 140)
    ]);
    assert.equal(summary.render().text, [
        '📊 Session summary: 4 games, 2W 1L 1T',
        'Maps: Mirage ×2, Inferno, Nuke',
        'Time in matches: 2h 6m'
    ].join('\n'));
    assert.deepEqual(summary.render().entities, [{ type: 'bold', offset: 3, length: 15 }]);
});

test('ties are left out when there were none, and so are matches without a map', () => {
    const summary = SessionSummary.of([row('13-5', 'Inferno', 0, 20), { ...row('5-13', 'Inferno', 25, 45), map: undefined }]);
    assert.equal(summary.render().text, [
        '📊 Session summary: 2 games, 1W 1L',
        'Maps: Inferno',
        'Time in matches: 40m'
    ].join('\n'));
});

test('a match without a start time adds no time', () => {
    const summary = SessionSummary.of([row('13-5', 'Inferno', 0, 20), { ...row('13-5', 'Nuke', 25, 45), started_at: undefined }]);
    assert.match(summary.render().text, /Time in matches: 20m$/);
});
