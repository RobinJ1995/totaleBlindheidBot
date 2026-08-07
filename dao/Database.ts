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

// One-off, idempotent migration: match detection used to keep mutable in-flight state in
// current_match(+_coplayer); matches are now derived from the append-only presence_event log,
// so those tables are gone entirely. They held only transient state, so dropping them loses
// nothing durable — at worst a match in flight during the upgrade starts tracking from its
// next presence tick.
const migrateDropCurrentMatch = async (conn: PoolConnection): Promise<void> => {
    const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS tbl FROM information_schema.TABLES ' +
        " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'current_match'"
    );
    if (Number(rows[0]?.tbl) > 0) {
        console.log('Dropping legacy current_match tables (match state now derives from presence_event).');
        await conn.query('DROP TABLE IF EXISTS current_match_coplayer');
        await conn.query('DROP TABLE IF EXISTS current_match');
    }
};

const tableExists = async (conn: PoolConnection, table: string): Promise<boolean> => {
    const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS tbl FROM information_schema.TABLES ' +
        ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table',
        { table }
    );
    return Number(rows[0]?.tbl) > 0;
};

const columnExists = async (conn: PoolConnection, table: string, column: string): Promise<boolean> => {
    const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS col FROM information_schema.COLUMNS ' +
        ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column',
        { table, column }
    );
    return Number(rows[0]?.col) > 0;
};

// One-off, idempotent migration: add the columns that back grouped end-of-game announcements
// (game_history.player_name and .message_id) to databases created before they existed. CREATE
// TABLE IF NOT EXISTS won't alter an existing table, so add each column when it's missing.
// Portable across MariaDB/MySQL (no ADD COLUMN IF NOT EXISTS).
const migrateGameHistoryAnnouncementColumns = async (conn: PoolConnection): Promise<void> => {
    if (!(await tableExists(conn, 'game_history'))) {
        return;
    }
    if (!(await columnExists(conn, 'game_history', 'player_name'))) {
        console.log('Adding game_history.player_name for grouped end-of-game announcements.');
        await conn.query('ALTER TABLE game_history ADD COLUMN player_name VARCHAR(255) NULL');
    }
    if (!(await columnExists(conn, 'game_history', 'message_id'))) {
        console.log('Adding game_history.message_id for grouped end-of-game announcements.');
        await conn.query('ALTER TABLE game_history ADD COLUMN message_id BIGINT NULL');
    }
};

// One-off, idempotent migration: github_state.etag backs conditional polling (If-None-Match),
// so databases created before it existed need the column added in place.
const migrateGithubStateEtagColumn = async (conn: PoolConnection): Promise<void> => {
    if (!(await tableExists(conn, 'github_state'))) {
        return;
    }
    if (!(await columnExists(conn, 'github_state', 'etag'))) {
        console.log('Adding github_state.etag for conditional GitHub API requests.');
        await conn.query('ALTER TABLE github_state ADD COLUMN etag VARCHAR(255) NULL');
    }
};

// Create any missing tables. Idempotent (every statement is CREATE TABLE IF NOT EXISTS, plus
// guarded one-off migrations for shape changes the CREATE statements can't apply in place).
export const ensureSchema = async (): Promise<void> => {
    const ddl = readFileSync(join(import.meta.dirname, 'schema.sql'), 'utf-8');
    const conn = await getPool().getConnection();
    try {
        await migrateDropCurrentMatch(conn);
        await migrateGameHistoryAnnouncementColumns(conn);
        await migrateGithubStateEtagColumn(conn);
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
