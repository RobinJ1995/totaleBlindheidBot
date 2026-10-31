import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query, withTransaction } from './Database.js';

export interface User {
    id: number;
    telegram_id?: number;
    discord_id?: string;  // a snowflake, beyond JS number precision
    name?: string;             // Telegram display name (first name)
    username?: string;         // Telegram @username, without the @
    discord_name?: string;     // Discord display name
    discord_username?: string; // Discord's unique username
}

export interface TelegramIdentity {
    id: number;
    first_name?: string;
    username?: string;
}

export interface DiscordIdentity {
    id: string;
    username: string;
    global_name?: string | null;
}

export interface UserSettings {
    steam_ids?: string[];
    timezone?: string;
    username?: string;
}

export interface ChatUser {
    user_id: number;
    name: string;
    username?: string;
}

const USER_COLUMNS = 'id, telegram_id, discord_id, name, username, discord_name, discord_username';

const userFromRow = (row: RowDataPacket): User => ({
    id: Number(row.id),
    telegram_id: row.telegram_id == null ? undefined : Number(row.telegram_id),
    discord_id: row.discord_id == null ? undefined : String(row.discord_id),
    name: row.name ?? undefined,
    username: row.username ?? undefined,
    discord_name: row.discord_name ?? undefined,
    discord_username: row.discord_username ?? undefined
});

export const userDisplayName = (user: User): string =>
    user.name || user.username || user.discord_name || user.discord_username || String(user.id);

class UserDAO {
    fromTelegram(from: TelegramIdentity): Promise<User> {
        return withTransaction(conn => this.fromTelegramWith(conn, from));
    }

    async fromTelegramWith(conn: PoolConnection, from: TelegramIdentity): Promise<User> {
        // LAST_INSERT_ID(id) makes insertId carry the existing row's id on the duplicate path.
        await conn.query<ResultSetHeader>(
            'INSERT INTO user (telegram_id, name, username) VALUES (:telegram_id, :name, :username) ' +
            'ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), ' +
            'name = COALESCE(VALUES(name), name), username = COALESCE(VALUES(username), username)',
            { telegram_id: from.id, name: from.first_name || null, username: from.username || null }
        );
        const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT ${USER_COLUMNS} FROM user WHERE telegram_id = :telegram_id`,
            { telegram_id: from.id }
        );
        return userFromRow(rows[0]);
    }

    fromDiscord(from: DiscordIdentity): Promise<User> {
        return withTransaction(conn => this.fromDiscordWith(conn, from));
    }

    async fromDiscordWith(conn: PoolConnection, from: DiscordIdentity): Promise<User> {
        // A username that changed hands no longer names its old owner.
        await conn.query(
            'UPDATE user SET discord_username = NULL WHERE discord_username = :discord_username AND discord_id <> :discord_id',
            { discord_username: from.username, discord_id: from.id }
        );
        await conn.query<ResultSetHeader>(
            'INSERT INTO user (discord_id, discord_name, discord_username) VALUES (:discord_id, :discord_name, :discord_username) ' +
            'ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), ' +
            'discord_name = COALESCE(VALUES(discord_name), discord_name), discord_username = VALUES(discord_username)',
            { discord_id: from.id, discord_name: from.global_name || null, discord_username: from.username }
        );
        const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT ${USER_COLUMNS} FROM user WHERE discord_id = :discord_id`,
            { discord_id: from.id }
        );
        return userFromRow(rows[0]);
    }

    async getUserByDiscordUsername(discord_username: string): Promise<User | undefined> {
        const rows = await query<RowDataPacket[]>(
            `SELECT ${USER_COLUMNS} FROM user WHERE discord_username = :discord_username`,
            { discord_username }
        );
        return rows.length > 0 ? userFromRow(rows[0]) : undefined;
    }

    async getUser(id: number): Promise<User | undefined> {
        const rows = await query<RowDataPacket[]>(`SELECT ${USER_COLUMNS} FROM user WHERE id = :id`, { id });
        return rows.length > 0 ? userFromRow(rows[0]) : undefined;
    }

    async getUsers(ids: number[]): Promise<Record<number, User>> {
        const result: Record<number, User> = {};
        const distinct = [...new Set(ids)];
        if (distinct.length === 0) {
            return result;
        }
        const rows = await query<RowDataPacket[]>(`SELECT ${USER_COLUMNS} FROM user WHERE id IN (?)`, [distinct]);
        rows.map(userFromRow).forEach(user => {
            result[user.id] = user;
        });
        return result;
    }

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
            query<RowDataPacket[]>(
                'SELECT s.user_id, s.steam_id, u.username FROM user_steam_id s ' +
                'LEFT JOIN user u ON u.id = s.user_id'
            )
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
            if (row.username) {
                result[key].username = row.username;
            }
        }
        return result;
    }

    setSteamUserId(user_id: number, steam_id: string | string[]): Promise<void> {
        const steamIds: string[] = Array.isArray(steam_id) ? steam_id : [steam_id];
        return withTransaction(async conn => {
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
        return query<ResultSetHeader>(
            'INSERT INTO user_settings (user_id, timezone) VALUES (:user_id, :timezone) ' +
            'ON DUPLICATE KEY UPDATE timezone = VALUES(timezone)',
            { user_id, timezone }
        ).then(() => undefined);
    }

    async addUserChat(user_id: number, chat_id: number): Promise<boolean> {
        const res = await query<ResultSetHeader>(
            'INSERT IGNORE INTO user_chat (user_id, chat_id) VALUES (:user_id, :chat_id)',
            { user_id, chat_id }
        );
        return res.affectedRows === 1;
    }

    // Resolve an @username (without the @) to a user id via the recorded user rows.
    // Usernames aren't unique there (a stale handle survives until its old owner sets a new one, and
    // may since have been taken by someone else), so an ambiguous handle resolves to nobody.
    async getUserIdByUsername(username: string): Promise<number | undefined> {
        const rows = await query<RowDataPacket[]>('SELECT id FROM user WHERE username = :username LIMIT 2', { username });
        return rows.length === 1 ? Number(rows[0].id) : undefined;
    }

    async getChatUsers(chat_id: number): Promise<ChatUser[]> {
        const rows = await query<RowDataPacket[]>(
            `SELECT uc.user_id, ${USER_COLUMNS} FROM user_chat uc ` +
            'LEFT JOIN user u ON u.id = uc.user_id ' +
            'WHERE uc.chat_id = :chat_id',
            { chat_id }
        );
        return rows
            .map(row => ({
                user_id: Number(row.user_id),
                name: row.id == null ? String(row.user_id) : userDisplayName(userFromRow(row)),
                username: row.username ?? undefined
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    async getUserChats(user_id: number): Promise<number[]> {
        const rows = await query<RowDataPacket[]>('SELECT chat_id FROM user_chat WHERE user_id = :user_id', { user_id });
        return rows.map(r => Number(r.chat_id));
    }
}

export default UserDAO;
