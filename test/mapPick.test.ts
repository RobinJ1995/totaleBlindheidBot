import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MapPick } from '../stats/MapPick.js';
import { GameHistoryEntry } from '../dao/GameHistoryDAO.js';
import { messageText } from '../format.js';

const game = (user_id: number, map: string, score: string, mode = 'Competitive'): GameHistoryEntry => ({
    chat_id: 1, user_id, mode, map, score, co_players: [], ended_at: new Date('2026-01-01T12:00:00.000Z')
});

const names = new Map([[1, 'Bob'], [2, 'Alice'], [3, 'Carl']]);
const text = (pick: MapPick): string => messageText(pick.render()).text;

const history = [
    game(1, 'Nuke', '13-7'), game(2, 'Nuke', '13-7'), game(2, 'Nuke', '7-13'),
    game(1, 'Inferno', '7-13'), game(2, 'Inferno', '7-13'), game(2, 'Inferno', '13-7'),
    game(1, 'Ancient', '13-0'), game(2, 'Ancient', '13-0'),
    game(3, 'Vertigo', '13-0'), game(3, 'Vertigo', '13-0'), game(3, 'Vertigo', '13-0'),
    game(1, 'Mirage', '13-0', 'Wingman'), game(1, 'Mirage', '13-0', 'Wingman'), game(1, 'Mirage', '13-0', 'Wingman')
];

test('the lobby\'s combined competitive record picks the map to play and the one to avoid', () => {
    assert.equal(text(MapPick.of(history, [1, 2], names, 3)), [
        '🗺️ Map pick for Alice, Bob',
        'Play: Nuke (67% won, 3 games)',
        'Avoid: Inferno (67% lost, 3 games)'
    ].join('\n'));
});

test('maps with fewer games than the minimum are left out', () => {
    assert.equal(text(MapPick.of(history, [1, 2], names, 4)), 'No map has 4 competitive games for this lobby yet.');
});

test('the map to play is never also the one to avoid', () => {
    const pick = MapPick.of([game(1, 'Nuke', '13-7'), game(1, 'Nuke', '7-13')], [1], names, 2);
    assert.equal(text(pick), '🗺️ Map pick for Bob\nPlay: Nuke (50% won, 2 games)');
});

test('a lobby that only loses gets just a map to avoid', () => {
    const pick = MapPick.of([game(3, 'Nuke', '7-13'), game(3, 'Nuke', '7-13')], [3], names, 2);
    assert.equal(text(pick), '🗺️ Map pick for Carl\nAvoid: Nuke (100% lost, 2 games)');
});
