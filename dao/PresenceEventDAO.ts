import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query } from './Database.js';
import { PresenceEvent } from '../matchDerivation.js';

// Data access for the append-only presence_event log and the per-stream finalisation cursor.
// The log is the source of truth for match detection (see matchDerivation.ts); the cursor
// records how far each stream has been folded into game_history so re-derivation is
// idempotent. All match semantics live in the derivation module — this class only stores
// and retrieves events.
class PresenceEventDAO {
    private _eventFromRow(row: RowDataPacket): PresenceEvent {
        return {
            id: Number(row.id),
            steam_id: String(row.steam_id),
            user_id: Number(row.user_id),
            playing: !!row.playing,
            map: row.map ?? undefined,
            mode: row.mode ?? undefined,
            raw_score: row.raw_score ?? undefined,
            score_total: row.score_total ?? null,
            player_name: row.player_name ?? undefined,
            created_at: row.created_at
        };
    }

    async appendEvent(event: Omit<PresenceEvent, 'id'>): Promise<number> {
        const res = await query<ResultSetHeader>(
            'INSERT INTO presence_event (steam_id, user_id, playing, map, mode, raw_score, score_total, player_name, created_at) ' +
            'VALUES (:steam_id, :user_id, :playing, :map, :mode, :raw_score, :score_total, :player_name, :created_at)',
            {
                steam_id: event.steam_id,
                user_id: event.user_id,
                playing: event.playing ? 1 : 0,
                map: event.map ?? null,
                mode: event.mode ?? null,
                raw_score: event.raw_score ?? null,
                score_total: event.score_total ?? null,
                player_name: event.player_name ?? null,
                created_at: event.created_at
            }
        );
        return res.insertId;
    }

    // The stream's newest event, used to detect whether an incoming snapshot is a transition
    // worth recording or a repeat to drop.
    async getLastEvent(steam_id: string): Promise<PresenceEvent | null> {
        const rows = await query<RowDataPacket[]>(
            'SELECT id, steam_id, user_id, playing, map, mode, raw_score, score_total, player_name, created_at ' +
            'FROM presence_event WHERE steam_id = :steam_id ORDER BY id DESC LIMIT 1',
            { steam_id }
        );
        return rows.length ? this._eventFromRow(rows[0]) : null;
    }

    // The unfinalised tail of a stream: everything past the cursor, in order. This is the
    // window match derivation replays.
    async getEventsAfter(steam_id: string, afterId: number): Promise<PresenceEvent[]> {
        const rows = await query<RowDataPacket[]>(
            'SELECT id, steam_id, user_id, playing, map, mode, raw_score, score_total, player_name, created_at ' +
            'FROM presence_event WHERE steam_id = :steam_id AND id > :afterId ORDER BY id ASC',
            { steam_id, afterId }
        );
        return rows.map(r => this._eventFromRow(r));
    }

    // For reconstructing another account's state across a match's time range: its last event
    // before the range (its state as the match began) plus its events within the range.
    async getStreamAround(steam_id: string, from: Date, to: Date): Promise<PresenceEvent[]> {
        const rows = await query<RowDataPacket[]>(
            '(SELECT id, steam_id, user_id, playing, map, mode, raw_score, score_total, player_name, created_at ' +
            ' FROM presence_event WHERE steam_id = :steam_id AND created_at < :from ORDER BY id DESC LIMIT 1) ' +
            'UNION ALL ' +
            '(SELECT id, steam_id, user_id, playing, map, mode, raw_score, score_total, player_name, created_at ' +
            ' FROM presence_event WHERE steam_id = :steam_id AND created_at >= :from AND created_at <= :to) ' +
            'ORDER BY id ASC',
            { steam_id, from, to }
        );
        return rows.map(r => this._eventFromRow(r));
    }

    async getTrackedSteamIds(): Promise<string[]> {
        const rows = await query<RowDataPacket[]>('SELECT DISTINCT steam_id FROM presence_event');
        return rows.map(r => String(r.steam_id));
    }

    async getCursor(steam_id: string): Promise<number> {
        const rows = await query<RowDataPacket[]>(
            'SELECT finalized_event_id FROM match_stream_cursor WHERE steam_id = :steam_id',
            { steam_id }
        );
        return rows.length ? Number(rows[0].finalized_event_id) : 0;
    }

    // Advance the cursor past a finalised segment. Runs on the caller's transaction so it
    // commits (or rolls back) together with the game_history insert — that atomicity is what
    // guarantees a match is announced exactly once.
    async advanceCursor(conn: PoolConnection, steam_id: string, eventId: number): Promise<void> {
        await conn.query(
            'INSERT INTO match_stream_cursor (steam_id, finalized_event_id) VALUES (:steam_id, :eventId) ' +
            'ON DUPLICATE KEY UPDATE finalized_event_id = GREATEST(finalized_event_id, VALUES(finalized_event_id))',
            { steam_id, eventId }
        );
    }

    // Streams with events past their cursor — the sweep's candidates for idle finalisation
    // and reset time-confirmation.
    async getStreamsWithUnfinalizedEvents(): Promise<string[]> {
        const rows = await query<RowDataPacket[]>(
            'SELECT e.steam_id FROM presence_event e ' +
            'LEFT JOIN match_stream_cursor c ON c.steam_id = e.steam_id ' +
            'GROUP BY e.steam_id, c.finalized_event_id ' +
            'HAVING MAX(e.id) > COALESCE(c.finalized_event_id, 0)'
        );
        return rows.map(r => String(r.steam_id));
    }

    // Drop old, already-finalised events. Never touches events past a stream's cursor, so a
    // long-idle unfinalised tail survives any TTL.
    async prune(cutoff: Date): Promise<void> {
        await query<ResultSetHeader>(
            'DELETE e FROM presence_event e ' +
            'LEFT JOIN match_stream_cursor c ON c.steam_id = e.steam_id ' +
            'WHERE e.created_at < :cutoff AND e.id <= COALESCE(c.finalized_event_id, 0)',
            { cutoff }
        );
    }
}

export default PresenceEventDAO;
