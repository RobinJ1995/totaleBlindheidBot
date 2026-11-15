import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RowDataPacket } from 'mysql2/promise';
import GameHistoryDAO from '../dao/GameHistoryDAO.js';

const endedAt = new Date('2026-01-01T12:00:00.000Z');

const row = (id: number, user_id: number, co_user_id: number | null, co_name: string | null = null): RowDataPacket => ({
    id, chat_id: 7, user_id, player_name: `P${user_id}`, mode: 'Competitive', map: 'Nuke', score: '13-7',
    started_at: null, ended_at: endedAt, co_user_id, co_name
}) as unknown as RowDataPacket;

test('joined rows fold into one entry per match carrying all its co-players', () => {
    const entries = GameHistoryDAO.entriesFromRows([row(1, 10, 11, 'Bob'), row(1, 10, 12), row(2, 11, null)]);
    assert.deepEqual(entries, [
        {
            id: 1, chat_id: 7, user_id: 10, player_name: 'P10', mode: 'Competitive', map: 'Nuke', score: '13-7',
            co_players: [{ tg_user_id: 11, name: 'Bob' }, { tg_user_id: 12, name: '12' }],
            started_at: undefined, ended_at: endedAt
        },
        {
            id: 2, chat_id: 7, user_id: 11, player_name: 'P11', mode: 'Competitive', map: 'Nuke', score: '13-7',
            co_players: [], started_at: undefined, ended_at: endedAt
        }
    ]);
});

test('no rows fold into no entries', () => {
    assert.deepEqual(GameHistoryDAO.entriesFromRows([]), []);
});
