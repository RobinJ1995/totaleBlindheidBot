import { readFileSync } from 'fs';
import { join } from 'path';
import mysql, { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

let pool: Pool | null = null;

export const getPool = (): Pool => {
    if (!pool) {
        pool = mysql.createPool({
            host: process.env.MARIADB_HOST || '127.0.0.1',
            port: Number(process.env.MARIADB_PORT) || 3306,
            user: process.env.MARIADB_USER,
            password: process.env.MARIADB_PASSWORD,
            database: process.env.MARIADB_DATABASE,
            connectionLimit: Number(process.env.MARIADB_POOL_SIZE) || 10,
            waitForConnections: true,
            namedPlaceholders: true,
            charset: 'utf8mb4',
            // Treat DATETIME columns as UTC so they round-trip with new Date().toISOString().
            timezone: 'Z',
            // Telegram ids and AUTO_INCREMENT ids fit in a JS number; keep them as numbers.
            supportBigNumbers: true,
            bigNumberStrings: false
        });
    }
    return pool;
};

// A single query against the pool. `params` may be an array (?) or an object (:named).
export const query = async <T extends RowDataPacket[] | ResultSetHeader = RowDataPacket[]>(
    sql: string,
    params?: any
): Promise<T> => {
    const [result] = await getPool().query<T>(sql, params);
    return result;
};

// Run `fn` inside a single transaction on a dedicated connection. Replaces the old
// per-file JS mutex: read-modify-write stays consistent via InnoDB row locks.
export const withTransaction = async <T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> => {
    const conn = await getPool().getConnection();
    try {
        await conn.beginTransaction();
        const result = await fn(conn);
        await conn.commit();
        return result;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
};

// Split a .sql file into individual statements: drop line comments, then split on ';'.
const splitStatements = (sql: string): string[] =>
    sql
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0);

// One-off, idempotent migration: current_match(+_coplayer) were originally keyed by
// (chat_id,user_id) and are now keyed by (chat_id,steam_id). They hold only transient
// in-flight match state, so when the old shape is detected (table exists without a steam_id
// column) we drop them and let the CREATE TABLE statements below rebuild them. Runs once —
// after the rebuild the steam_id column exists, so the guard is false on later startups.
const migrateLegacyCurrentMatch = async (conn: PoolConnection): Promise<void> => {
    const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT ' +
        "(SELECT COUNT(*) FROM information_schema.TABLES " +
        " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'current_match') AS tbl, " +
        "(SELECT COUNT(*) FROM information_schema.COLUMNS " +
        " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'current_match' AND COLUMN_NAME = 'steam_id') AS col"
    );
    const tableExists = Number(rows[0]?.tbl) > 0;
    const hasSteamId = Number(rows[0]?.col) > 0;
    if (tableExists && !hasSteamId) {
        console.log('Rebuilding legacy current_match tables for per-Steam-account match keying.');
        await conn.query('DROP TABLE IF EXISTS current_match_coplayer');
        await conn.query('DROP TABLE IF EXISTS current_match');
    }
};

// One-off, idempotent migration: add the columns that back grouped end-of-game announcements
// (game_history.player_name and .message_id) to databases created before they existed. CREATE
// TABLE IF NOT EXISTS won't alter an existing table, so add each column when it's missing.
// Portable across MariaDB/MySQL (no ADD COLUMN IF NOT EXISTS).
const migrateGameHistoryAnnouncementColumns = async (conn: PoolConnection): Promise<void> => {
    const columnExists = async (column: string): Promise<boolean> => {
        const [rows] = await conn.query<RowDataPacket[]>(
            'SELECT COUNT(*) AS col FROM information_schema.COLUMNS ' +
            ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column',
            { table: 'game_history', column }
        );
        return Number(rows[0]?.col) > 0;
    };
    const [tblRows] = await conn.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS tbl FROM information_schema.TABLES ' +
        " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'game_history'"
    );
    if (Number(tblRows[0]?.tbl) === 0) return;
    if (!(await columnExists('player_name'))) {
        console.log('Adding game_history.player_name for grouped end-of-game announcements.');
        await conn.query('ALTER TABLE game_history ADD COLUMN player_name VARCHAR(255) NULL');
    }
    if (!(await columnExists('message_id'))) {
        console.log('Adding game_history.message_id for grouped end-of-game announcements.');
        await conn.query('ALTER TABLE game_history ADD COLUMN message_id BIGINT NULL');
    }
};

// Create any missing tables. Idempotent (every statement is CREATE TABLE IF NOT EXISTS, plus
// guarded one-off migrations for shape changes the CREATE statements can't apply in place).
export const ensureSchema = async (): Promise<void> => {
    const ddl = readFileSync(join(import.meta.dirname, 'schema.sql'), 'utf-8');
    const conn = await getPool().getConnection();
    try {
        await migrateLegacyCurrentMatch(conn);
        await migrateGameHistoryAnnouncementColumns(conn);
        for (const statement of splitStatements(ddl)) {
            await conn.query(statement);
        }
    } finally {
        conn.release();
    }
};

// steam-user library persistence backend (STEAM_STORAGE_BACKEND=database).
export const saveSteamFile = async (filename: string, contents: Buffer): Promise<void> => {
    await query(
        'INSERT INTO steam_storage (filename, contents) VALUES (:filename, :contents) ' +
        'ON DUPLICATE KEY UPDATE contents = VALUES(contents)',
        { filename, contents }
    );
};

export const readSteamFile = async (filename: string): Promise<Buffer | undefined> => {
    const rows = await query<RowDataPacket[]>(
        'SELECT contents FROM steam_storage WHERE filename = :filename',
        { filename }
    );
    if (rows.length === 0) {
        // steam-user treats an ENOENT-coded error as "no saved session".
        const error: any = new Error(`File not found: ${filename}`);
        error.code = 'ENOENT';
        throw error;
    }
    return rows[0].contents as Buffer;
};
