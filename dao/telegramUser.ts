import { PoolConnection } from 'mysql2/promise';

// Ensure a telegram_user row exists so FK-bearing child rows can reference it.
// name/username are only overwritten when a non-empty value is supplied.
export const ensureTelegramUser = async (conn: PoolConnection, user_id: number, name?: string, username?: string): Promise<void> => {
    await conn.query(
        'INSERT INTO telegram_user (user_id, name, username) VALUES (:user_id, :name, :username) ' +
        'ON DUPLICATE KEY UPDATE name = COALESCE(VALUES(name), name), username = COALESCE(VALUES(username), username)',
        { user_id, name: name ?? null, username: username ?? null }
    );
};
