/**
 * Once-off, offline migration of application data from the S3 JSON-blob store into MariaDB.
 *
 *   MARIADB_HOST=... MARIADB_USER=... MARIADB_PASSWORD=... MARIADB_DATABASE=... \
 *   S3_ENDPOINT=... S3_BUCKET=... S3_ACCESS_KEY=... S3_SECRET_KEY=... \
 *   npm run migrate
 *
 * Run once against a fresh database. It reconstructs every shape losslessly and applies the
 * same normalisation/prune rules the app uses (legacy bare-ISO schedules, 24h RSVP TTL,
 * flattened game-update info). steam-user library blobs are migrated only when the target
 * STEAM_STORAGE_BACKEND=database.
 */
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { s3, bucket, loadJSON, readFile } from '../dao/S3Client';
import { getPool, ensureSchema, saveSteamFile } from '../dao/Database';

const RSVP_LIST_TTL_MS = 24 * 60 * 60 * 1000;

const counts: Record<string, number> = {};
const bump = (table: string, n = 1) => { counts[table] = (counts[table] || 0) + n; };

const pool = getPool();

// List every object key under a prefix (paginated).
const listKeys = async (prefix: string): Promise<string[]> => {
    const keys: string[] = [];
    let token: string | undefined;
    do {
        const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        for (const obj of res.Contents || []) {
            if (obj.Key) keys.push(obj.Key);
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return keys;
};

// Ensure a telegram_user row exists (FK target), enriching name/username when known.
const ensureUser = async (user_id: number, name?: string, username?: string): Promise<void> => {
    await pool.query(
        'INSERT INTO telegram_user (user_id, name, username) VALUES (?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE name = COALESCE(VALUES(name), name), username = COALESCE(VALUES(username), username)',
        [user_id, name ?? null, username ?? null]
    );
};

const parsePlayer = (input: string): { user_id: number | null; username: string | null; display_name: string | null } => {
    const match = input.match(/^\[(.*)\]\(tg:\/\/user\?id=(\d+)\)$/);
    if (match) return { user_id: Number(match[2]), username: null, display_name: match[1] };
    if (input.startsWith('@')) return { user_id: null, username: input.substring(1), display_name: null };
    return { user_id: null, username: null, display_name: input };
};

const migrateUserSettings = async (): Promise<void> => {
    const settings = await loadJSON<Record<string, { steam_id?: string; steam_ids?: string[]; timezone?: string }>>('user_settings.json');
    for (const [userIdStr, data] of Object.entries(settings)) {
        const user_id = Number(userIdStr);
        await ensureUser(user_id);
        if (data.timezone != null) {
            await pool.query(
                'INSERT INTO user_settings (user_id, timezone) VALUES (?, ?) ON DUPLICATE KEY UPDATE timezone = VALUES(timezone)',
                [user_id, data.timezone]
            );
            bump('user_settings');
        }
        const steamIds = data.steam_ids || (data.steam_id ? [data.steam_id] : []);
        for (const steam_id of steamIds) {
            await pool.query('INSERT IGNORE INTO user_steam_id (user_id, steam_id) VALUES (?, ?)', [user_id, steam_id]);
            bump('user_steam_id');
        }
    }
};

const migrateUserChats = async (): Promise<void> => {
    for (const key of await listKeys('user_chats/')) {
        const user_id = Number(key.replace('user_chats/', '').replace('.json', ''));
        const chats = await loadJSON<(string | number)[]>(key);
        if (!Array.isArray(chats)) continue;
        await ensureUser(user_id);
        for (const chat_id of chats) {
            await pool.query('INSERT IGNORE INTO user_chat (user_id, chat_id) VALUES (?, ?)', [user_id, Number(chat_id)]);
            bump('user_chat');
        }
    }
};

const migrateChatSettings = async (): Promise<void> => {
    for (const key of await listKeys('chat_settings/')) {
        const chat_id = Number(key.replace('chat_settings/', '').replace('.json', ''));
        const data = await loadJSON<{ steam_updates?: boolean }>(key);
        await pool.query(
            'INSERT INTO chat_settings (chat_id, steam_updates) VALUES (?, ?) ON DUPLICATE KEY UPDATE steam_updates = VALUES(steam_updates)',
            [chat_id, data.steam_updates == null ? null : (data.steam_updates ? 1 : 0)]
        );
        bump('chat_settings');
    }
};

const migrateGithubNotify = async (): Promise<void> => {
    const chats = await loadJSON<(string | number)[]>('github_notify_chats.json');
    if (!Array.isArray(chats)) return;
    for (const chat_id of chats) {
        await pool.query(
            'INSERT INTO chat_settings (chat_id, github_notify) VALUES (?, 1) ON DUPLICATE KEY UPDATE github_notify = 1',
            [Number(chat_id)]
        );
        bump('github_notify');
    }
};

const migrateRollcallPlayers = async (): Promise<void> => {
    const players = await loadJSON<Record<string, { username: string; chat_id: number }>>('rollcall_players.json');
    for (const player of Object.values(players)) {
        const parsed = parsePlayer(player.username);
        if (parsed.user_id !== null) await ensureUser(parsed.user_id);
        await pool.query(
            'INSERT INTO rollcall_player (chat_id, user_id, username, display_name) VALUES (?, ?, ?, ?)',
            [Number(player.chat_id), parsed.user_id, parsed.username, parsed.display_name]
        );
        bump('rollcall_player');
    }
};

interface OldRsvpEntry { user_id: number; name: string; username?: string; rsvp: 'yes' | 'maybe' | 'no'; }
interface OldRsvpMessage { message_id: number; base_text: string; keyboard: 'schedule' | 'rollcall'; }
interface OldRsvpList { rsvp_id: string; chat_id: number; entries: Record<string, OldRsvpEntry>; messages: OldRsvpMessage[]; created_at: string; }

// Returns a map from the old UUID rsvp_id to the new rsvp_list.id.
const migrateRsvpLists = async (): Promise<Map<string, number>> => {
    const map = new Map<string, number>();
    const lists = await loadJSON<Record<string, OldRsvpList>>('rsvp_lists.json');
    const cutoff = Date.now() - RSVP_LIST_TTL_MS;
    for (const [oldId, list] of Object.entries(lists)) {
        if (new Date(list.created_at).getTime() < cutoff) continue; // TTL prune
        const [res]: any = await pool.query(
            'INSERT INTO rsvp_list (chat_id, created_at) VALUES (?, ?)',
            [Number(list.chat_id), new Date(list.created_at)]
        );
        const newId = res.insertId;
        map.set(oldId, newId);
        bump('rsvp_list');
        for (const entry of Object.values(list.entries || {})) {
            await ensureUser(entry.user_id, entry.name, entry.username);
            await pool.query(
                'INSERT INTO rsvp_entry (rsvp_list_id, user_id, rsvp) VALUES (?, ?, ?)',
                [newId, entry.user_id, entry.rsvp]
            );
            bump('rsvp_entry');
        }
        for (const ref of list.messages || []) {
            await pool.query(
                'INSERT INTO rsvp_message (rsvp_list_id, message_id, base_text, keyboard) VALUES (?, ?, ?, ?)',
                [newId, ref.message_id, ref.base_text, ref.keyboard]
            );
            bump('rsvp_message');
        }
    }
    return map;
};

const migrateRollcallSchedules = async (rsvpMap: Map<string, number>): Promise<void> => {
    const schedules = await loadJSON<Record<string, { time: string; rsvp_id?: string; initiator_id?: number } | string>>('rollcall_schedules.json');
    for (const [chatIdStr, value] of Object.entries(schedules)) {
        const schedule = typeof value === 'string' ? { time: value } as { time: string; rsvp_id?: string; initiator_id?: number } : value;
        if (schedule.initiator_id != null) await ensureUser(schedule.initiator_id);
        const rsvp_list_id = schedule.rsvp_id != null ? (rsvpMap.get(schedule.rsvp_id) ?? null) : null;
        await pool.query(
            'INSERT INTO rollcall_schedule (chat_id, trigger_at, rsvp_list_id, initiator_id) VALUES (?, ?, ?, ?)',
            [Number(chatIdStr), new Date(schedule.time), rsvp_list_id, schedule.initiator_id ?? null]
        );
        bump('rollcall_schedule');
    }
};

const migrateGithubState = async (): Promise<void> => {
    const state = await loadJSON<{ last_sha?: string }>('github_state.json');
    if (state.last_sha == null) return;
    await pool.query(
        'INSERT INTO github_state (id, last_sha) VALUES (1, ?) ON DUPLICATE KEY UPDATE last_sha = VALUES(last_sha)',
        [state.last_sha]
    );
    bump('github_state');
};

const migrateGameUpdates = async (): Promise<void> => {
    for (const key of await listKeys('game_updates/')) {
        const name = key.replace('game_updates/', '').replace('.json', '');
        const sep = name.lastIndexOf('_');
        if (sep < 0) continue;
        const chat_id = Number(name.substring(0, sep));
        const user_id = Number(name.substring(sep + 1));
        const update = await loadJSON<{ message_id: number; text: string; info: any; timestamp: string }>(key);
        if (!update || !update.message_id) continue;
        const info = update.info || {};
        await ensureUser(user_id);
        await pool.query(
            'INSERT INTO game_update (chat_id, user_id, message_id, text, game_id, map, status, score, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                chat_id, user_id, update.message_id, update.text,
                info.gameId == null ? null : String(info.gameId),
                info.map ?? null, info.status ?? null, info.score ?? null,
                update.timestamp ? new Date(update.timestamp) : new Date()
            ]
        );
        bump('game_update');
    }
};

const migrateSteamStorage = async (): Promise<void> => {
    if ((process.env.STEAM_STORAGE_BACKEND || 'filesystem').toLowerCase() !== 'database') {
        console.log('STEAM_STORAGE_BACKEND is not "database"; skipping steam-user blobs.');
        return;
    }
    for (const key of await listKeys('steam-user/')) {
        const contents = await readFile(key);
        if (!contents) continue;
        await saveSteamFile(key, contents); // key already includes the steam-user/ prefix
        bump('steam_storage');
    }
};

const main = async (): Promise<void> => {
    console.log('Ensuring schema...');
    await ensureSchema();

    console.log('Migrating user settings + steam ids...'); await migrateUserSettings();
    console.log('Migrating user chats...');                 await migrateUserChats();
    console.log('Migrating chat settings...');              await migrateChatSettings();
    console.log('Migrating github notify chats...');        await migrateGithubNotify();
    console.log('Migrating rollcall players...');           await migrateRollcallPlayers();
    console.log('Migrating RSVP lists...');                 const rsvpMap = await migrateRsvpLists();
    console.log('Migrating rollcall schedules...');         await migrateRollcallSchedules(rsvpMap);
    console.log('Migrating github state...');               await migrateGithubState();
    console.log('Migrating game updates...');               await migrateGameUpdates();
    console.log('Migrating steam-user storage...');         await migrateSteamStorage();

    console.log('\nMigration complete. Rows written per table:');
    for (const [table, n] of Object.entries(counts).sort()) {
        console.log(`  ${table.padEnd(20)} ${n}`);
    }
};

main()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(async (err) => {
        console.error('Migration failed:', err);
        await pool.end().catch(() => {});
        process.exit(1);
    });
