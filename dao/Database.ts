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
    if (Number(tblRows[0]?.tbl) === 0) {
        return;
    } else if (!(await columnExists('player_name'))) {
        console.log('Adding game_history.player_name for grouped end-of-game announcements.');
        await conn.query('ALTER TABLE game_history ADD COLUMN player_name VARCHAR(255) NULL');
    }
    if (!(await columnExists('message_id'))) {
        console.log('Adding game_history.message_id for grouped end-of-game announcements.');
        await conn.query('ALTER TABLE game_history ADD COLUMN message_id BIGINT NULL');
    }
};

// One-off, idempotent migration: add the columns holding stored messages' entities to databases
// created before they existed. Older rows keep their Markdown text until they age out.
const migrateEntitiesColumns = async (conn: PoolConnection): Promise<void> => {
    const targets = [
        { table: 'rsvp_message', text: 'base_text', entities: 'base_entities' },
        { table: 'game_update', text: 'text', entities: 'entities' }
    ];
    for (const { table, text, entities } of targets) {
        const [tblRows] = await conn.query<RowDataPacket[]>(
            'SELECT COUNT(*) AS tbl FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table',
            { table }
        );
        if (Number(tblRows[0]?.tbl) === 0) {
            continue;
        }
        const [colRows] = await conn.query<RowDataPacket[]>(
            'SELECT COUNT(*) AS col FROM information_schema.COLUMNS ' +
            ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column',
            { table, column: entities }
        );
        if (Number(colRows[0]?.col) === 0) {
            console.log(`Adding ${table}.${entities}.`);
            await conn.query(`ALTER TABLE ${table} ADD COLUMN ${entities} TEXT NULL AFTER ${text}`);
        }
    }
};

const tableExists = async (conn: PoolConnection, table: string): Promise<boolean> => {
    const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS tbl FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table',
        { table }
    );
    return Number(rows[0]?.tbl) > 0;
};

// One-off migration: telegram_user becomes user. Foreign keys are dropped around the rename
// because their target column is renamed.
const migrateTelegramUserToUser = async (conn: PoolConnection): Promise<void> => {
    if (await tableExists(conn, 'user') || !(await tableExists(conn, 'telegram_user'))) {
        return;
    }
    console.log('Migrating telegram_user to user (platform-neutral user ids).');

    const [fks] = await conn.query<RowDataPacket[]>(
        'SELECT k.TABLE_NAME AS tbl, k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS col, r.DELETE_RULE AS on_delete ' +
        'FROM information_schema.KEY_COLUMN_USAGE k ' +
        'JOIN information_schema.REFERENTIAL_CONSTRAINTS r ' +
        '  ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME ' +
        "WHERE k.CONSTRAINT_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME = 'telegram_user'"
    );
    await Promise.all(fks.map(fk => conn.query(`ALTER TABLE ${fk.tbl} DROP FOREIGN KEY ${fk.name}`)));

    await conn.query('RENAME TABLE telegram_user TO user');
    await conn.query(
        'ALTER TABLE user ' +
        'CHANGE COLUMN user_id id BIGINT NOT NULL AUTO_INCREMENT, ' +
        'ADD COLUMN telegram_id BIGINT NULL AFTER id, ' +
        'ADD COLUMN discord_id VARCHAR(32) NULL AFTER telegram_id, ' +
        'ADD COLUMN discord_username VARCHAR(255) NULL AFTER username, ' +
        'ADD UNIQUE KEY uq_user_telegram (telegram_id), ' +
        'ADD UNIQUE KEY uq_user_discord (discord_id)'
    );
    await conn.query('UPDATE user SET telegram_id = id');
    await conn.query('ALTER TABLE user ADD CONSTRAINT chk_user_platform CHECK (telegram_id IS NOT NULL OR discord_id IS NOT NULL)');

    await Promise.all(fks.map(fk => conn.query(
        `ALTER TABLE ${fk.tbl} ADD CONSTRAINT ${fk.name} FOREIGN KEY (${fk.col}) ` +
        `REFERENCES user (id) ON DELETE ${fk.on_delete}`
    )));
};

// One-off migration for user tables created before discord_name existed.
const migrateDiscordNameColumn = async (conn: PoolConnection): Promise<void> => {
    if (!(await tableExists(conn, 'user'))) {
        return;
    }
    const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS col FROM information_schema.COLUMNS ' +
        " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user' AND COLUMN_NAME = 'discord_name'"
    );
    if (Number(rows[0]?.col) === 0) {
        console.log('Adding user.discord_name.');
        await conn.query('ALTER TABLE user ADD COLUMN discord_name VARCHAR(255) NULL AFTER username');
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
        await migrateEntitiesColumns(conn);
        await migrateTelegramUserToUser(conn);
        await migrateDiscordNameColumn(conn);
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
