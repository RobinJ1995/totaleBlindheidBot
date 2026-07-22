import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query, withTransaction } from './Database.js';
import { ensureTelegramUser } from './telegramUser.js';

export interface GameHistoryCoPlayer {
    tg_user_id: number;
    name: string;
}

export interface GameHistoryEntry {
    chat_id: number;
    user_id: number;
    player_name?: string;  // owner's resolved display name at match end, for grouped announcements
    mode?: string;
    map?: string;
    score?: string;        // raw final score, e.g. "16-14"
    co_players: GameHistoryCoPlayer[];
    started_at?: Date;
    ended_at: Date;
}

// A recently-finished match used for grouping a per-match end-of-game announcement: the owner (with
// the display name resolved at match end), the match's raw score, its co-players, and the Telegram
// id of the shared announcement (if one has been posted).
export interface SiblingMatch {
    id: number;
    user_id: number;
    player_name?: string;
    score?: string;
    message_id: number | null;
    co_players: GameHistoryCoPlayer[];
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

    // Insert a finished match (and its co-players); returns the new game_history id so the caller
    // can later attach the id of the grouped end-of-game announcement. When a connection is
    // passed, the insert joins that caller-managed transaction (used to commit history rows and
    // the stream's finalisation cursor together); otherwise it runs in its own.
    addGameHistoryEntry(entry: GameHistoryEntry, existingConn?: PoolConnection): Promise<number> {
        const insert = async (conn: PoolConnection): Promise<number> => {
            await ensureTelegramUser(conn, entry.user_id);
            const [res] = await conn.query<ResultSetHeader>(
                'INSERT INTO game_history (chat_id, user_id, player_name, mode, map, score, started_at, ended_at) ' +
                'VALUES (:chat_id, :user_id, :player_name, :mode, :map, :score, :started_at, :ended_at)',
                {
                    chat_id: entry.chat_id,
                    user_id: entry.user_id,
                    player_name: entry.player_name ?? null,
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
            return historyId;
        };
        return existingConn ? insert(existingConn) : withTransaction(insert);
    }

    // Recently-finished matches in a chat on a given map+mode, each with its co-players and the id
    // of the grouped end-of-game message (if one has been posted). Used to group a just-finalised
    // match with sibling finalisations of the same match and to edit their shared announcement.
    async getRecentSiblingMatches(chat_id: number, map: string | undefined, mode: string | undefined, since: Date): Promise<SiblingMatch[]> {
        const rows = await query<RowDataPacket[]>(
            'SELECT h.id, h.user_id, h.player_name, h.score, h.message_id, c.co_user_id, c.name AS co_name ' +
            'FROM game_history h ' +
            'LEFT JOIN game_history_coplayer c ON c.game_history_id = h.id ' +
            'WHERE h.chat_id = :chat_id AND h.ended_at >= :since ' +
            '  AND ((:map IS NULL AND h.map IS NULL) OR h.map = :map) ' +
            '  AND ((:mode IS NULL AND h.mode IS NULL) OR h.mode = :mode) ' +
            'ORDER BY h.id ASC',
            { chat_id, map: map ?? null, mode: mode ?? null, since }
        );

        const byId = new Map<number, SiblingMatch>();
        const order: number[] = [];
        for (const row of rows) {
            const id = Number(row.id);
            let sib = byId.get(id);
            if (!sib) {
                sib = {
                    id,
                    user_id: Number(row.user_id),
                    player_name: row.player_name ?? undefined,
                    score: row.score ?? undefined,
                    message_id: row.message_id == null ? null : Number(row.message_id),
                    co_players: []
                };
                byId.set(id, sib);
                order.push(id);
            }
            const co = this._coPlayerFromRow(row);
            if (co) {
                sib.co_players.push(co);
            }
        }
        return order.map(id => byId.get(id)!);
    }

    setGameHistoryMessageId(id: number, message_id: number): Promise<void> {
        return query<ResultSetHeader>(
            'UPDATE game_history SET message_id = :message_id WHERE id = :id',
            { id, message_id }
        ).then(() => undefined);
    }

}

export default GameHistoryDAO;
