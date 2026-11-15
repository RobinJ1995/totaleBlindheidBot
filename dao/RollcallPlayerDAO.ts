import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { checkNotEmpty } from '../utils.js';
import { query } from './Database.js';
import { parseMention, userMention } from '../mention.js';

// A rollcall roster row. A player is identified by a user id (text mention),
// an @username, or just a display name, depending on how the admin added them.
interface RollcallPlayerRow extends RowDataPacket {
    id: number;
    chat_id: number;
    user_id: number | null;
    username: string | null;
    display_name: string | null;
}

export interface RollcallPlayer {
    id: number;
    mention: string;
}

class RollcallPlayerDAO {
    // Reconstruct the legacy rotation mention string from a normalised player row.
    private _playerMention(row: RollcallPlayerRow): string {
        if (row.user_id !== null) {
            return userMention(Number(row.user_id), row.display_name ?? '');
        } else if (row.username !== null) {
            return `@${row.username}`;
        }
        return row.display_name ?? '';
    }

    // Parse a rotation mention string into its normalised columns.
    private _parsePlayer(input: string): { user_id: number | null; username: string | null; display_name: string | null } {
        const parsed = parseMention(input);
        if (parsed.id !== undefined) {
            return { user_id: parsed.id, username: null, display_name: parsed.display };
        } else if (parsed.username !== undefined) {
            return { user_id: null, username: parsed.username, display_name: null };
        }
        return { user_id: null, username: null, display_name: parsed.display };
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

    // The Steam accounts of everyone in any chat's rotation, whether listed as a user or by @username.
    async getRotationSteamIds(): Promise<string[]> {
        const rows = await query<RowDataPacket[]>(
            'SELECT DISTINCT s.steam_id FROM rollcall_player p ' +
            'JOIN user u ON u.id = p.user_id OR (p.user_id IS NULL AND u.username = p.username) ' +
            'JOIN user_steam_id s ON s.user_id = u.id'
        );
        return rows.map(row => String(row.steam_id));
    }

    // The user ids of a chat's rotation, whether listed as a user or by @username.
    async getRotationUserIds(chat_id: number): Promise<number[]> {
        const rows = await query<RowDataPacket[]>(
            'SELECT DISTINCT u.id FROM rollcall_player p ' +
            'JOIN user u ON u.id = p.user_id OR (p.user_id IS NULL AND u.username = p.username) ' +
            'WHERE p.chat_id = :chat_id',
            { chat_id }
        );
        return rows.map(row => Number(row.id));
    }

    getRollcallPlayers(chat_id: number): Promise<RollcallPlayer[]> {
        return this._getRollcallPlayerRows(chat_id).then(rows => rows.map(row => ({ id: Number(row.id), mention: this._playerMention(row) })));
    }

    async removeRollcallPlayerById(chat_id: number, id: number): Promise<RollcallPlayer | undefined> {
        const player: RollcallPlayer | undefined = (await this.getRollcallPlayers(chat_id)).find(candidate => candidate.id === id);
        if (player) {
            await query<ResultSetHeader>('DELETE FROM rollcall_player WHERE id = :id', { id });
        }
        return player;
    }

    addRollcallPlayer(chat_id: number, username: string): Promise<number> {
        const parsed = this._parsePlayer(checkNotEmpty(username));
        return query<ResultSetHeader>(
            'INSERT INTO rollcall_player (chat_id, user_id, username, display_name) VALUES (:chat_id, :user_id, :username, :display_name)',
            { chat_id: Number(checkNotEmpty(chat_id)), user_id: parsed.user_id, username: parsed.username, display_name: parsed.display_name }
        ).then(res => res.insertId);
    }

    removeRollcallPlayer(chat_id: number, username: string): Promise<boolean> {
        const inputUsername = checkNotEmpty(username);
        const user_id: number | undefined = parseMention(inputUsername).id;
        return this._getRollcallPlayerRows(Number(checkNotEmpty(chat_id)))
            .then(rows => rows.find(row => {
                if (this._playerMention(row) === inputUsername || (user_id !== undefined && Number(row.user_id) === user_id)) {
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
