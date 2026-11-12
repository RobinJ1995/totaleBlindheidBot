import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Leaderboard, LeaderboardFilter } from '../stats/Leaderboard.js';
import { GameHistoryEntry } from '../dao/GameHistoryDAO.js';
import { messageText } from '../format.js';

const now = new Date('2026-06-15T12:00:00.000Z');
const daysAgo = (days: number): Date => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

const game = (user_id: number, score: string, map = 'Nuke', mode = 'Competitive'): GameHistoryEntry => ({
    chat_id: 1, user_id, mode, map, score, co_players: [], ended_at: now
});

const names = new Map([[1, 'Alice'], [2, 'Bob'], [3, 'Carl']]);
const text = (board: Leaderboard): string => messageText(board.render()).text;

test('a filter without tokens keeps every competitive game and has no window', () => {
    const filter = LeaderboardFilter.parse([], now);
    assert.equal(filter.since, undefined);
    assert.equal(filter.matches(game(1, '13-7')), true);
    assert.equal(filter.matches(game(1, '13-7', 'Nuke', 'Premier')), true);
    assert.equal(filter.matches(game(1, '13-7', 'Nuke', 'Wingman')), false);
});

test('week and month set the window to the past 7 or 30 days', () => {
    assert.deepEqual(LeaderboardFilter.parse(['week'], now).since, daysAgo(7));
    assert.deepEqual(LeaderboardFilter.parse(['MONTH'], now).since, daysAgo(30));
});

test('premier and competitive pick that mode only', () => {
    const premier = LeaderboardFilter.parse(['premier'], now);
    assert.equal(premier.matches(game(1, '13-7', 'Nuke', 'Premier - Competitive')), true);
    assert.equal(premier.matches(game(1, '13-7', 'Nuke', 'Competitive')), false);
    const competitive = LeaderboardFilter.parse(['competitive'], now);
    assert.equal(competitive.matches(game(1, '13-7', 'Nuke', 'Competitive')), true);
    assert.equal(competitive.matches(game(1, '13-7', 'Nuke', 'Premier')), false);
});

test('the remaining tokens name a map, matched case-insensitively', () => {
    const filter = LeaderboardFilter.parse(['dust', 'ii', 'week'], now);
    assert.equal(filter.matches(game(1, '13-7', 'Dust II')), true);
    assert.equal(filter.matches(game(1, '13-7', 'Nuke')), false);
    assert.equal(filter.since?.getTime(), daysAgo(7).getTime());
});

test('players are ranked by win rate, then games, then name, leaving out those below the minimum', () => {
    const entries = [
        ...[1, 1, 1, 0].map(win => game(1, win ? '13-7' : '7-13')),
        ...[1, 1, 1, 0, 1, 1, 1, 0].map(win => game(2, win ? '13-7' : '7-13')),
        ...[1, 1, 1, 0].map(win => game(3, win ? '13-7' : '7-13')),
        game(3, '13-0', 'Nuke', 'Wingman'),
        game(4, '13-0')
    ];
    assert.equal(text(Leaderboard.of(entries, LeaderboardFilter.parse([], now), names, 2)), [
        '🏆 Leaderboard',
        '1. Bob: ████████░░ 75% (8 games)',
        '2. Alice: ████████░░ 75% (4 games)',
        '3. Carl: ████████░░ 75% (4 games)'
    ].join('\n'));
});

test('ties count as games but not as wins', () => {
    const entries = [game(1, '13-7'), game(1, '13-13')];
    assert.equal(text(Leaderboard.of(entries, LeaderboardFilter.parse([], now), names, 2)),
        '🏆 Leaderboard\n1. Alice: █████░░░░░ 50% (2 games)');
});

test('a player without a known name is listed by id', () => {
    const board = Leaderboard.of([game(9, '13-7')], LeaderboardFilter.parse([], now), names, 1);
    assert.equal(text(board), '🏆 Leaderboard\n1. 9: ██████████ 100% (1 game)');
});

test('the title names the filter, using the map name as recorded', () => {
    const board = Leaderboard.of([game(1, '13-7', 'Nuke', 'Premier')], LeaderboardFilter.parse(['nuke', 'premier', 'month'], now), names, 1);
    assert.equal(text(board).split('\n')[0], '🏆 Leaderboard (Nuke, Premier, past month)');
});

test('an empty board says how many games it takes', () => {
    assert.equal(text(Leaderboard.of([game(1, '13-7')], LeaderboardFilter.parse([], now), names, 5)),
        'Nobody has played 5 competitive games yet.');
    assert.equal(text(Leaderboard.of([], LeaderboardFilter.parse(['nuke', 'premier', 'week'], now), names, 5)),
        'Nobody has played 5 competitive games on nuke in Premier in the past week yet.');
});

test('an empty board names the map as recorded', () => {
    assert.equal(text(Leaderboard.of([game(1, '13-7', 'Dust II')], LeaderboardFilter.parse(['dust', 'ii'], now), names, 5)),
        'Nobody has played 5 competitive games on Dust II yet.');
});
