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

// Create any missing tables. Idempotent (every statement is CREATE TABLE IF NOT EXISTS).
export const ensureSchema = async (): Promise<void> => {
    const ddl = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    const conn = await getPool().getConnection();
    try {
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
        // Mirror S3Client.readFile: steam-user treats ENOENT as "no saved session".
        const error: any = new Error(`File not found: ${filename}`);
        error.code = 'ENOENT';
        throw error;
    }
    return rows[0].contents as Buffer;
};
