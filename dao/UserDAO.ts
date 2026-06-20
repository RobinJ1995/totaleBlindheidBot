import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query, withTransaction } from './Database.js';
import { ensureTelegramUser } from './telegramUser.js';

export interface UserSettings {
    steam_ids?: string[];
    timezone?: string;
}

class UserDAO {
    async getUserSettings(user_id: number): Promise<UserSettings> {
        const [settingsRows, steamRows] = await Promise.all([
            query<RowDataPacket[]>('SELECT timezone FROM user_settings WHERE user_id = :user_id', { user_id }),
            query<RowDataPacket[]>('SELECT steam_id FROM user_steam_id WHERE user_id = :user_id', { user_id })
        ]);
        const result: UserSettings = {};
        if (steamRows.length > 0) {
            result.steam_ids = steamRows.map(r => String(r.steam_id));
        }
        const timezone = settingsRows[0]?.timezone;
        if (timezone != null) {
            result.timezone = timezone;
        }
        return result;
    }

    async getAllUserSettings(): Promise<Record<string, UserSettings>> {
        const [settingsRows, steamRows] = await Promise.all([
            query<RowDataPacket[]>('SELECT user_id, timezone FROM user_settings'),
            query<RowDataPacket[]>('SELECT user_id, steam_id FROM user_steam_id')
        ]);
        const result: Record<string, UserSettings> = {};
        for (const row of settingsRows) {
            const key = String(row.user_id);
            result[key] = result[key] || {};
            if (row.timezone != null) {
                result[key].timezone = row.timezone;
            }
        }
        for (const row of steamRows) {
            const key = String(row.user_id);
            result[key] = result[key] || {};
            (result[key].steam_ids = result[key].steam_ids || []).push(String(row.steam_id));
        }
        return result;
    }

    setSteamUserId(user_id: number, steam_id: string | string[]): Promise<void> {
        const steamIds: string[] = Array.isArray(steam_id) ? steam_id : [steam_id];
        return withTransaction(async conn => {
            await ensureTelegramUser(conn, user_id);
            await conn.query('DELETE FROM user_steam_id WHERE user_id = :user_id', { user_id });
            for (const sid of steamIds) {
                await conn.query(
                    'INSERT IGNORE INTO user_steam_id (user_id, steam_id) VALUES (:user_id, :steam_id)',
                    { user_id, steam_id: sid }
                );
            }
        });
    }

    async getUserTimezone(user_id: number): Promise<string> {
        const rows = await query<RowDataPacket[]>('SELECT timezone FROM user_settings WHERE user_id = :user_id', { user_id });
        return rows[0]?.timezone || 'UTC';
    }

    setUserTimezone(user_id: number, timezone: string): Promise<void> {
        return withTransaction(async conn => {
            await ensureTelegramUser(conn, user_id);
            await conn.query(
                'INSERT INTO user_settings (user_id, timezone) VALUES (:user_id, :timezone) ' +
                'ON DUPLICATE KEY UPDATE timezone = VALUES(timezone)',
                { user_id, timezone }
            );
        });
    }

    addUserChat(user_id: number, chat_id: number): Promise<boolean> {
        return withTransaction(async conn => {
            await ensureTelegramUser(conn, user_id);
            const [res] = await conn.query<ResultSetHeader>(
                'INSERT IGNORE INTO user_chat (user_id, chat_id) VALUES (:user_id, :chat_id)',
                { user_id, chat_id }
            );
            return res.affectedRows === 1;
        });
    }

    async getUserChats(user_id: number): Promise<number[]> {
        const rows = await query<RowDataPacket[]>('SELECT chat_id FROM user_chat WHERE user_id = :user_id', { user_id });
        return rows.map(r => Number(r.chat_id));
    }
}

export default UserDAO;
