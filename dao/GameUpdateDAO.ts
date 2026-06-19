import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query, withTransaction } from './Database';
import { ensureTelegramUser } from './telegramUser';

export interface GameUpdate {
    message_id: number;
    text: string;
    info: any;
    timestamp: Date;
}

class GameUpdateDAO {
    // gameId is the only info field that may be numeric; reconstruct it as a number
    // when it parses as one so the publishUpdate diff logic keeps comparing like for like.
    private _reconstructInfo(row: RowDataPacket): any {
        const gameId = row.game_id == null ? undefined : (/^\d+$/.test(row.game_id) ? Number(row.game_id) : row.game_id);
        return { gameId, map: row.map ?? undefined, status: row.status ?? undefined, score: row.score ?? undefined };
    }

    async getGameUpdate(chat_id: number, user_id: number): Promise<GameUpdate> {
        const rows = await query<RowDataPacket[]>(
            'SELECT message_id, text, game_id, map, status, score, timestamp FROM game_update ' +
            'WHERE chat_id = :chat_id AND user_id = :user_id ORDER BY id DESC LIMIT 1',
            { chat_id, user_id }
        );
        if (rows.length === 0) {
            return {} as GameUpdate;
        }
        const row = rows[0];
        return {
            message_id: Number(row.message_id),
            text: row.text,
            info: this._reconstructInfo(row),
            timestamp: row.timestamp
        };
    }

    setGameUpdate(chat_id: number, user_id: number, message_id: number, text: string, info: any = {}): Promise<void> {
        return withTransaction(async conn => {
            await ensureTelegramUser(conn, user_id);
            await conn.query('DELETE FROM game_update WHERE chat_id = :chat_id AND user_id = :user_id', { chat_id, user_id });
            await conn.query(
                'INSERT INTO game_update (chat_id, user_id, message_id, text, game_id, map, status, score, timestamp) ' +
                'VALUES (:chat_id, :user_id, :message_id, :text, :game_id, :map, :status, :score, :timestamp)',
                {
                    chat_id, user_id, message_id, text,
                    game_id: info.gameId == null ? null : String(info.gameId),
                    map: info.map ?? null,
                    status: info.status ?? null,
                    score: info.score ?? null,
                    timestamp: new Date()
                }
            );
        });
    }

    updateGameUpdateText(chat_id: number, user_id: number, text: string, info: any = {}): Promise<void> {
        // Update the current row's text/info, keeping its original timestamp. No-op if none.
        return query<ResultSetHeader>(
            'UPDATE game_update SET text = :text, game_id = :game_id, map = :map, status = :status, score = :score ' +
            'WHERE chat_id = :chat_id AND user_id = :user_id',
            {
                chat_id, user_id, text,
                game_id: info.gameId == null ? null : String(info.gameId),
                map: info.map ?? null,
                status: info.status ?? null,
                score: info.score ?? null
            }
        ).then(() => undefined);
    }
}

export default GameUpdateDAO;
