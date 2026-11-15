import { test } from 'node:test';
import assert from 'node:assert/strict';
import WeeklyRecap from '../stats/WeeklyRecap.js';
import { GameHistoryEntry } from '../dao/GameHistoryDAO.js';

const names: Record<number, string> = { 1: 'Alpha', 2: 'Bravo', 3: 'Charlie' };

let nextId = 1;
const row = (user_id: number, map: string, score: string, message_id: number | null, co: number[] = []): GameHistoryEntry => ({
    id: nextId++, chat_id: 9, user_id, player_name: names[user_id], mode: 'Competitive', map, score, message_id,
    co_players: co.map(tg_user_id => ({ tg_user_id, name: names[tg_user_id] })), ended_at: new Date(0)
});

test('no matches make an empty recap', () => {
    assert.equal(WeeklyRecap.of([]).games, 0);
});

test('players announced together count as one game, others count on their own', () => {
    const recap = WeeklyRecap.of([row(1, 'Nuke', '13-5', 4, [2]), row(2, 'Nuke', '13-5', 4, [1]), row(1, 'Nuke', '13-5', null)]);
    assert.equal(recap.games, 2);
});

test('the recap shows the record, best map, most active player and best duo', () => {
    const recap = WeeklyRecap.of([
        row(1, 'Mirage', '13-5', 1, [2]), row(2, 'Mirage', '13-5', 1, [1]),
        row(1, 'Mirage', '13-9', 2, [2, 3]), row(2, 'Mirage', '13-9', 2), row(3, 'Mirage', '13-9', 2),
        row(1, 'Nuke', '5-13', 3, [3]), row(3, 'Nuke', '5-13', 3),
        row(1, 'Nuke', '12-12', 4, [3]),
        row(2, 'Inferno', '13-2', 5)
    ]);
    assert.equal(recap.render().text, [
        '📅 Weekly recap: 5 games, 3W 1L 1T',
        'Best map: Mirage (2/2 won)',
        'Most active: Alpha (4 games)',
        'Best duo: Alpha & Bravo (2/2 won)'
    ].join('\n'));
    assert.deepEqual(recap.render().entities, [{ type: 'bold', offset: 3, length: 12 }]);
});

test('a duo needs two games together, and a win, to be the best', () => {
    const recap = WeeklyRecap.of([
        row(1, 'Mirage', '13-5', 1, [2]),
        row(1, 'Nuke', '5-13', 2, [3]), row(1, 'Nuke', '5-13', 3, [3])
    ]);
    assert.doesNotMatch(recap.render().text, /Best duo/);
});

test('a pair is counted once per game whoever recorded it', () => {
    const recap = WeeklyRecap.of([
        row(1, 'Mirage', '13-5', 1, [2]), row(2, 'Mirage', '13-5', 1, [1]),
        row(2, 'Nuke', '13-5', 2, [1]),
        row(1, 'Ancient', '5-13', 3, [2])
    ]);
    assert.match(recap.render().text, /Best duo: Alpha & Bravo \(2\/3 won\)$/);
});

test('a week without a win shows no best map', () => {
    const recap = WeeklyRecap.of([row(1, 'Nuke', '5-13', 1), row(1, 'Nuke', '5-13', 2)]);
    assert.equal(recap.render().text, '📅 Weekly recap: 2 games, 0W 2L\nMost active: Alpha (2 games)');
});
