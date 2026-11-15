import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStats } from '../command/stats.js';
import { GameHistoryEntry } from '../dao/GameHistoryDAO.js';
import { messageText } from '../format.js';

const game = (map: string, score: string, mode = 'Competitive', minutes = 30): GameHistoryEntry => ({
    chat_id: 1,
    user_id: 1,
    mode,
    map,
    score,
    co_players: [],
    started_at: new Date(Date.UTC(2026, 0, 1, 12, 0)),
    ended_at: new Date(Date.UTC(2026, 0, 1, 12, minutes))
});

test('stats are empty without competitive games', () => {
    assert.equal(renderStats([game('Nuke', '13-7', 'Wingman')]), null);
});

test('stats render the overview, streaks and maps of competitive games', () => {
    const rendered = renderStats([
        game('Nuke', '13-7'),
        game('Nuke', '13-10'),
        game('Inferno', '7-13'),
        game('Ancient', '13-13'),
        game('Inferno', '5-13'),
        game('Dust II', '13-0', 'Wingman')
    ]);
    assert.equal(messageText(rendered!).text, [
        '📊 Overview',
        'Competitive games: 5 (2 won, 2 lost, 1 tied)',
        'Win rate: ████░░░░░░ 40%',
        'Rounds: 51-56  (48%)',
        'Playtime: 2h 30m',
        '',
        '🔥 Streaks',
        'Longest win streak: 2',
        'Longest loss streak: 1',
        'Current streak: 1 loss',
        '',
        '🗺️ Maps',
        'Favourite map: Nuke (2 games)',
        'Best map: Nuke (100% won)',
        'Worst map: Inferno (100% lost)'
    ].join('\n'));
});
