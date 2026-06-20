import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query, withTransaction } from './Database.js';
import { ensureTelegramUser } from './telegramUser.js';

export interface GameHistoryCoPlayer {
    tg_user_id: number;
    name: string;
}

export interface GameHistoryEntry {
    chat_id: number;
    user_id: number;
    mode?: string;
    map?: string;
    score?: string;        // raw final score, e.g. "16-14"
    co_players: GameHistoryCoPlayer[];
    started_at?: Date;
    ended_at: Date;
}

// The match a (chat,user) is currently playing. Persisted so it survives session closes,
// game relaunches mid-match, and bot restarts.
export interface CurrentMatch {
    chat_id: number;
    user_id: number;
    map?: string;
    mode?: string;
    max_score?: string;       // raw, highest score seen this match
    player_name?: string;     // Steam display name, fallback for the notification
    co_players: GameHistoryCoPlayer[];
    started_at: Date;
    last_progress_at: Date;
    playing: boolean;
}

class GameHistoryDAO {
    private _coPlayerFromRow(row: RowDataPacket): GameHistoryCoPlayer | null {
        if (row.co_user_id == null) {
            return null;
        }
        return { tg_user_id: Number(row.co_user_id), name: row.co_name ?? String(row.co_user_id) };
    }

    // The caller's finished matches for a chat, oldest first (newest at the bottom).
    async getGameHistory(chat_id: number, user_id: number): Promise<GameHistoryEntry[]> {
        const rows = await query<RowDataPacket[]>(
            'SELECT h.id, h.chat_id, h.user_id, h.mode, h.map, h.score, h.started_at, h.ended_at, ' +
            '       c.co_user_id, c.name AS co_name ' +
            'FROM game_history h ' +
            'LEFT JOIN game_history_coplayer c ON c.game_history_id = h.id ' +
            'WHERE h.chat_id = :chat_id AND h.user_id = :user_id ' +
            'ORDER BY h.id ASC',
            { chat_id, user_id }
        );

        const byId = new Map<number, GameHistoryEntry>();
        const order: number[] = [];
        for (const row of rows) {
            const id = Number(row.id);
            let entry = byId.get(id);
            if (!entry) {
                entry = {
                    chat_id: Number(row.chat_id),
                    user_id: Number(row.user_id),
                    mode: row.mode ?? undefined,
                    map: row.map ?? undefined,
                    score: row.score ?? undefined,
                    co_players: [],
                    started_at: row.started_at ?? undefined,
                    ended_at: row.ended_at
                };
                byId.set(id, entry);
                order.push(id);
            }
            const co = this._coPlayerFromRow(row);
            if (co) {
                entry.co_players.push(co);
            }
        }
        return order.map(id => byId.get(id)!);
    }

    addGameHistoryEntry(entry: GameHistoryEntry): Promise<void> {
        return withTransaction(async conn => {
            await ensureTelegramUser(conn, entry.user_id);
            const [res] = await conn.query<ResultSetHeader>(
                'INSERT INTO game_history (chat_id, user_id, mode, map, score, started_at, ended_at) ' +
                'VALUES (:chat_id, :user_id, :mode, :map, :score, :started_at, :ended_at)',
                {
                    chat_id: entry.chat_id,
                    user_id: entry.user_id,
                    mode: entry.mode ?? null,
                    map: entry.map ?? null,
                    score: entry.score ?? null,
                    started_at: entry.started_at ?? null,
                    ended_at: entry.ended_at
                }
            );
            const historyId = res.insertId;
            for (const co of entry.co_players) {
                await conn.query(
                    'INSERT INTO game_history_coplayer (game_history_id, co_user_id, name) ' +
                    'VALUES (:game_history_id, :co_user_id, :name)',
                    { game_history_id: historyId, co_user_id: co.tg_user_id, name: co.name ?? null }
                );
            }
        });
    }

    private async _loadCurrentMatchCoPlayers(chat_id: number, user_id: number): Promise<GameHistoryCoPlayer[]> {
        const rows = await query<RowDataPacket[]>(
            'SELECT co_user_id, name FROM current_match_coplayer WHERE chat_id = :chat_id AND user_id = :user_id',
            { chat_id, user_id }
        );
        return rows.map(r => ({ tg_user_id: Number(r.co_user_id), name: r.name ?? String(r.co_user_id) }));
    }

    private _matchFromRow(row: RowDataPacket, coPlayers: GameHistoryCoPlayer[]): CurrentMatch {
        return {
            chat_id: Number(row.chat_id),
            user_id: Number(row.user_id),
            map: row.map ?? undefined,
            mode: row.mode ?? undefined,
            max_score: row.max_score ?? undefined,
            player_name: row.player_name ?? undefined,
            co_players: coPlayers,
            started_at: row.started_at,
            last_progress_at: row.last_progress_at,
            playing: !!row.playing
        };
    }

    async getCurrentMatch(chat_id: number, user_id: number): Promise<CurrentMatch | null> {
        const rows = await query<RowDataPacket[]>(
            'SELECT chat_id, user_id, map, mode, max_score, player_name, started_at, last_progress_at, playing ' +
            'FROM current_match WHERE chat_id = :chat_id AND user_id = :user_id',
            { chat_id, user_id }
        );
        if (rows.length === 0) {
            return null;
        }
        const coPlayers = await this._loadCurrentMatchCoPlayers(chat_id, user_id);
        return this._matchFromRow(rows[0], coPlayers);
    }

    setCurrentMatch(match: CurrentMatch): Promise<void> {
        return withTransaction(async conn => {
            await ensureTelegramUser(conn, match.user_id);
            // Replace the row (cascades co-players away), then re-insert it and the co-players.
            await conn.query('DELETE FROM current_match WHERE chat_id = :chat_id AND user_id = :user_id',
                { chat_id: match.chat_id, user_id: match.user_id });
            await conn.query(
                'INSERT INTO current_match (chat_id, user_id, map, mode, max_score, player_name, started_at, last_progress_at, playing) ' +
                'VALUES (:chat_id, :user_id, :map, :mode, :max_score, :player_name, :started_at, :last_progress_at, :playing)',
                {
                    chat_id: match.chat_id,
                    user_id: match.user_id,
                    map: match.map ?? null,
                    mode: match.mode ?? null,
                    max_score: match.max_score ?? null,
                    player_name: match.player_name ?? null,
                    started_at: match.started_at,
                    last_progress_at: match.last_progress_at,
                    playing: match.playing ? 1 : 0
                }
            );
            for (const co of match.co_players) {
                await conn.query(
                    'INSERT INTO current_match_coplayer (chat_id, user_id, co_user_id, name) ' +
                    'VALUES (:chat_id, :user_id, :co_user_id, :name)',
                    { chat_id: match.chat_id, user_id: match.user_id, co_user_id: co.tg_user_id, name: co.name ?? null }
                );
            }
        });
    }

    deleteCurrentMatch(chat_id: number, user_id: number): Promise<void> {
        return query<ResultSetHeader>(
            'DELETE FROM current_match WHERE chat_id = :chat_id AND user_id = :user_id',
            { chat_id, user_id }
        ).then(() => undefined);
    }

    // Matches that are no longer playing and have not progressed since the cutoff. Used by the
    // periodic sweep to finalise the trailing match of a play session (it has no following reset).
    async getIdleMatches(cutoff: Date): Promise<CurrentMatch[]> {
        const rows = await query<RowDataPacket[]>(
            'SELECT chat_id, user_id, map, mode, max_score, player_name, started_at, last_progress_at, playing ' +
            'FROM current_match WHERE playing = 0 AND last_progress_at < :cutoff',
            { cutoff }
        );
        const matches: CurrentMatch[] = [];
        for (const row of rows) {
            const coPlayers = await this._loadCurrentMatchCoPlayers(Number(row.chat_id), Number(row.user_id));
            matches.push(this._matchFromRow(row, coPlayers));
        }
        return matches;
    }
}

export default GameHistoryDAO;
