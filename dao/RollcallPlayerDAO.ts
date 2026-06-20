import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { checkNotEmpty } from '../utils.js';
import { query, withTransaction } from './Database.js';
import { ensureTelegramUser } from './telegramUser.js';

// A rollcall roster row. A player is identified by a Telegram user id (text mention),
// an @username, or just a display name, depending on how the admin added them.
interface RollcallPlayerRow extends RowDataPacket {
    id: number;
    chat_id: number;
    user_id: number | null;
    username: string | null;
    display_name: string | null;
}

class RollcallPlayerDAO {
    // Reconstruct the legacy rotation mention string from a normalised player row.
    private _playerMention(row: RollcallPlayerRow): string {
        if (row.user_id !== null) {
            return `[${row.display_name ?? ''}](tg://user?id=${row.user_id})`;
        }
        if (row.username !== null) {
            return `@${row.username}`;
        }
        return row.display_name ?? '';
    }

    // Parse a rotation mention string into its normalised columns.
    private _parsePlayer(input: string): { user_id: number | null; username: string | null; display_name: string | null } {
        const match = input.match(/^\[(.*)\]\(tg:\/\/user\?id=(\d+)\)$/);
        if (match) {
            return { user_id: Number(match[2]), username: null, display_name: match[1] };
        }
        if (input.startsWith('@')) {
            return { user_id: null, username: input.substring(1), display_name: null };
        }
        return { user_id: null, username: null, display_name: input };
    }

    private _getRollcallPlayerRows(chat_id: number): Promise<RollcallPlayerRow[]> {
        return query<RollcallPlayerRow[]>(
            'SELECT id, chat_id, user_id, username, display_name FROM rollcall_player WHERE chat_id = :chat_id',
            { chat_id }
        );
    }

    getRollcallPlayerUsernames(chat_id: number): Promise<string[]> {
        return this._getRollcallPlayerRows(chat_id).then(rows => rows.map(row => this._playerMention(row)));
    }

    addRollcallPlayer(chat_id: number, username: string): Promise<number> {
        const parsed = this._parsePlayer(checkNotEmpty(username));
        return withTransaction(async conn => {
            if (parsed.user_id !== null) {
                await ensureTelegramUser(conn, parsed.user_id);
            }
            const [res] = await conn.query<ResultSetHeader>(
                'INSERT INTO rollcall_player (chat_id, user_id, username, display_name) VALUES (:chat_id, :user_id, :username, :display_name)',
                { chat_id: Number(checkNotEmpty(chat_id)), user_id: parsed.user_id, username: parsed.username, display_name: parsed.display_name }
            );
            return res.insertId;
        });
    }

    removeRollcallPlayer(chat_id: number, username: string): Promise<boolean> {
        const inputUsername = checkNotEmpty(username);
        return this._getRollcallPlayerRows(Number(checkNotEmpty(chat_id)))
            .then(rows => rows.find(row => {
                if (this._playerMention(row) === inputUsername) {
                    return true;
                }
                // Match the case where the stored player is a text mention and the input is just the name.
                return row.user_id !== null && row.display_name === inputUsername;
            }))
            .then(row => {
                if (!row) {
                    return false;
                }
                return query<ResultSetHeader>('DELETE FROM rollcall_player WHERE id = :id', { id: row.id }).then(() => true);
            });
    }
}

export default RollcallPlayerDAO;
