import { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { checkNotEmpty } from '../utils';
import { query, withTransaction } from './Database';

// RSVP lists older than this are pruned on write.
const RSVP_LIST_TTL_MS = 24 * 60 * 60 * 1000;

export interface UserSettings {
    steam_id?: string;
    steam_ids?: string[];
    timezone?: string;
}

export interface ChatSettings {
    steam_updates?: boolean;
}

export interface GameUpdate {
    message_id: number;
    text: string;
    info: any;
    timestamp: Date;
}

export interface ScheduledRollcall {
    time: Date;
    rsvp_id?: number;
    initiator_id?: number;
}

export type ScheduledRollcalls = Record<string, ScheduledRollcall>;

export type Rsvp = 'yes' | 'maybe' | 'no';

export interface RsvpEntry {
    user_id: number;
    name: string;        // non-pinging display name
    username?: string;   // telegram @username (no @) for rotation matching
    rsvp: Rsvp;
}

export interface RsvpMessageRef {
    message_id: number;
    base_text: string;                 // text above the lists (differs per message)
    keyboard: 'schedule' | 'rollcall'; // which button labels to show on this message
}

export interface RsvpList {
    rsvp_id: number;
    chat_id: number;
    entries: Record<string, RsvpEntry>; // keyed by user_id (incl. seeded initiator)
    messages: RsvpMessageRef[];         // every message currently displaying this list
    created_at: Date;                   // for pruning
}

// A rollcall roster row. A player is identified by a Telegram user id (text mention),
// an @username, or just a display name, depending on how the admin added them.
interface RollcallPlayerRow extends RowDataPacket {
    id: number;
    chat_id: number;
    user_id: number | null;
    username: string | null;
    display_name: string | null;
}

class DAO {
    // Ensure a telegram_user row exists so FK-bearing child rows can reference it.
    // name/username are only overwritten when a non-empty value is supplied.
    private async _ensureTelegramUser(conn: PoolConnection, user_id: number, name?: string, username?: string): Promise<void> {
        await conn.query(
            'INSERT INTO telegram_user (user_id, name, username) VALUES (:user_id, :name, :username) ' +
            'ON DUPLICATE KEY UPDATE name = COALESCE(VALUES(name), name), username = COALESCE(VALUES(username), username)',
            { user_id, name: name ?? null, username: username ?? null }
        );
    }

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
            await this._ensureTelegramUser(conn, user_id);
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
            await this._ensureTelegramUser(conn, user_id);
            await conn.query(
                'INSERT INTO user_settings (user_id, timezone) VALUES (:user_id, :timezone) ' +
                'ON DUPLICATE KEY UPDATE timezone = VALUES(timezone)',
                { user_id, timezone }
            );
        });
    }

    addUserChat(user_id: number, chat_id: number): Promise<boolean> {
        return withTransaction(async conn => {
            await this._ensureTelegramUser(conn, user_id);
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

    async getChatSettings(chat_id: number): Promise<ChatSettings> {
        const rows = await query<RowDataPacket[]>('SELECT steam_updates FROM chat_settings WHERE chat_id = :chat_id', { chat_id });
        const result: ChatSettings = {};
        if (rows.length > 0 && rows[0].steam_updates != null) {
            result.steam_updates = !!rows[0].steam_updates;
        }
        return result;
    }

    setChatSettings(chat_id: number, newSettings: ChatSettings): Promise<void> {
        // ChatSettings only carries steam_updates; upsert just that column so other
        // columns (github_notify) are preserved.
        return query<ResultSetHeader>(
            'INSERT INTO chat_settings (chat_id, steam_updates) VALUES (:chat_id, :steam_updates) ' +
            'ON DUPLICATE KEY UPDATE steam_updates = VALUES(steam_updates)',
            { chat_id, steam_updates: newSettings.steam_updates == null ? null : (newSettings.steam_updates ? 1 : 0) }
        ).then(() => undefined);
    }

    async getGithubNotifyChats(): Promise<number[]> {
        const rows = await query<RowDataPacket[]>('SELECT chat_id FROM chat_settings WHERE github_notify = 1');
        return rows.map(r => Number(r.chat_id));
    }

    setGithubNotify(chat_id: number, enabled: boolean): Promise<void> {
        return query<ResultSetHeader>(
            'INSERT INTO chat_settings (chat_id, github_notify) VALUES (:chat_id, :github_notify) ' +
            'ON DUPLICATE KEY UPDATE github_notify = VALUES(github_notify)',
            { chat_id, github_notify: enabled ? 1 : 0 }
        ).then(() => undefined);
    }

    async getGithubLastSha(): Promise<string | undefined> {
        const rows = await query<RowDataPacket[]>('SELECT last_sha FROM github_state WHERE id = 1');
        return rows[0]?.last_sha ?? undefined;
    }

    setGithubLastSha(sha: string): Promise<void> {
        return query<ResultSetHeader>(
            'INSERT INTO github_state (id, last_sha) VALUES (1, :sha) ON DUPLICATE KEY UPDATE last_sha = VALUES(last_sha)',
            { sha }
        ).then(() => undefined);
    }

    // gameId is the only info field that may be numeric; reconstruct it as a number
    // when it parses as one so the publishUpdate diff logic keeps comparing like for like.
    private _reconstructInfo(row: RowDataPacket): any {
        const gameId = row.game_id == null ? undefined : (/^\d+$/.test(row.game_id) ? Number(row.game_id) : row.game_id);
        return { gameId, map: row.map ?? undefined, status: row.status ?? undefined, score: row.score ?? undefined };
    }

    async getGameUpdate(chat_id: number, user_id: number): Promise<GameUpdate> {
        const rows = await query<RowDataPacket[]>(
            'SELECT message_id, text, game_id, map, status, score, timestamp FROM game_update ' +
            'WHERE chat_id = :chat_id AND user_id = :user_id ORDER BY id DESC LIMIT 1',
            { chat_id, user_id }
        );
        if (rows.length === 0) {
            return {} as GameUpdate;
        }
        const row = rows[0];
        return {
            message_id: Number(row.message_id),
            text: row.text,
            info: this._reconstructInfo(row),
            timestamp: row.timestamp
        };
    }

    setGameUpdate(chat_id: number, user_id: number, message_id: number, text: string, info: any = {}): Promise<void> {
        return withTransaction(async conn => {
            await this._ensureTelegramUser(conn, user_id);
            await conn.query('DELETE FROM game_update WHERE chat_id = :chat_id AND user_id = :user_id', { chat_id, user_id });
            await conn.query(
                'INSERT INTO game_update (chat_id, user_id, message_id, text, game_id, map, status, score, timestamp) ' +
                'VALUES (:chat_id, :user_id, :message_id, :text, :game_id, :map, :status, :score, :timestamp)',
                {
                    chat_id, user_id, message_id, text,
                    game_id: info.gameId == null ? null : String(info.gameId),
                    map: info.map ?? null,
                    status: info.status ?? null,
                    score: info.score ?? null,
                    timestamp: new Date()
                }
            );
        });
    }

    updateGameUpdateText(chat_id: number, user_id: number, text: string, info: any = {}): Promise<void> {
        // Update the current row's text/info, keeping its original timestamp. No-op if none.
        return query<ResultSetHeader>(
            'UPDATE game_update SET text = :text, game_id = :game_id, map = :map, status = :status, score = :score ' +
            'WHERE chat_id = :chat_id AND user_id = :user_id',
            {
                chat_id, user_id, text,
                game_id: info.gameId == null ? null : String(info.gameId),
                map: info.map ?? null,
                status: info.status ?? null,
                score: info.score ?? null
            }
        ).then(() => undefined);
    }

    async getScheduledRollcalls(): Promise<ScheduledRollcalls> {
        const rows = await query<RowDataPacket[]>('SELECT chat_id, trigger_at, rsvp_list_id, initiator_id FROM rollcall_schedule');
        const result: ScheduledRollcalls = {};
        for (const row of rows) {
            const schedule: ScheduledRollcall = { time: row.trigger_at };
            if (row.rsvp_list_id != null) {
                schedule.rsvp_id = Number(row.rsvp_list_id);
            }
            if (row.initiator_id != null) {
                schedule.initiator_id = Number(row.initiator_id);
            }
            result[String(row.chat_id)] = schedule;
        }
        return result;
    }

    setScheduledRollcall(chat_id: number, time: Date, rsvp_id?: number, initiator_id?: number): Promise<void> {
        return withTransaction(async conn => {
            if (initiator_id !== undefined) {
                await this._ensureTelegramUser(conn, initiator_id);
            }
            // Replace any existing schedule for this chat (keeps one-per-chat behaviour).
            await conn.query('DELETE FROM rollcall_schedule WHERE chat_id = :chat_id', { chat_id });
            await conn.query(
                'INSERT INTO rollcall_schedule (chat_id, trigger_at, rsvp_list_id, initiator_id) ' +
                'VALUES (:chat_id, :trigger_at, :rsvp_list_id, :initiator_id)',
                { chat_id, trigger_at: time, rsvp_list_id: rsvp_id ?? null, initiator_id: initiator_id ?? null }
            );
        });
    }

    removeScheduledRollcall(chat_id: number): Promise<void> {
        return query<ResultSetHeader>('DELETE FROM rollcall_schedule WHERE chat_id = :chat_id', { chat_id }).then(() => undefined);
    }

    private async _loadRsvpList(conn: PoolConnection, rsvp_id: number): Promise<RsvpList | undefined> {
        const [listRows] = await conn.query<RowDataPacket[]>('SELECT id, chat_id, created_at FROM rsvp_list WHERE id = :id', { id: rsvp_id });
        if (listRows.length === 0) {
            return undefined;
        }
        const [entryRows] = await conn.query<RowDataPacket[]>(
            'SELECT e.user_id, e.rsvp, u.name, u.username FROM rsvp_entry e ' +
            'JOIN telegram_user u ON u.user_id = e.user_id WHERE e.rsvp_list_id = :id',
            { id: rsvp_id }
        );
        const [messageRows] = await conn.query<RowDataPacket[]>(
            'SELECT message_id, base_text, keyboard FROM rsvp_message WHERE rsvp_list_id = :id',
            { id: rsvp_id }
        );
        const entries: Record<string, RsvpEntry> = {};
        for (const row of entryRows) {
            entries[String(row.user_id)] = {
                user_id: Number(row.user_id),
                name: row.name ?? '',
                username: row.username ?? undefined,
                rsvp: row.rsvp
            };
        }
        return {
            rsvp_id: Number(listRows[0].id),
            chat_id: Number(listRows[0].chat_id),
            entries,
            messages: messageRows.map(row => ({
                message_id: Number(row.message_id),
                base_text: row.base_text,
                keyboard: row.keyboard
            })),
            created_at: listRows[0].created_at
        };
    }

    createRsvpList(list: Omit<RsvpList, 'rsvp_id' | 'created_at'>): Promise<number> {
        return withTransaction(async conn => {
            // Prune expired lists so the table doesn't grow unbounded.
            await conn.query('DELETE FROM rsvp_list WHERE created_at < :cutoff', { cutoff: new Date(Date.now() - RSVP_LIST_TTL_MS) });
            const [res] = await conn.query<ResultSetHeader>(
                'INSERT INTO rsvp_list (chat_id, created_at) VALUES (:chat_id, :created_at)',
                { chat_id: list.chat_id, created_at: new Date() }
            );
            const rsvp_id = res.insertId;
            for (const entry of Object.values(list.entries)) {
                await this._ensureTelegramUser(conn, entry.user_id, entry.name, entry.username);
                await conn.query(
                    'INSERT INTO rsvp_entry (rsvp_list_id, user_id, rsvp) VALUES (:rsvp_id, :user_id, :rsvp)',
                    { rsvp_id, user_id: entry.user_id, rsvp: entry.rsvp }
                );
            }
            for (const ref of list.messages) {
                await conn.query(
                    'INSERT INTO rsvp_message (rsvp_list_id, message_id, base_text, keyboard) VALUES (:rsvp_id, :message_id, :base_text, :keyboard)',
                    { rsvp_id, message_id: ref.message_id, base_text: ref.base_text, keyboard: ref.keyboard }
                );
            }
            return rsvp_id;
        });
    }

    getRsvpList(rsvp_id: number): Promise<RsvpList | undefined> {
        return withTransaction(conn => this._loadRsvpList(conn, rsvp_id));
    }

    async getRsvpListByMessage(chat_id: number, message_id: number): Promise<RsvpList | undefined> {
        const rows = await query<RowDataPacket[]>(
            'SELECT l.id FROM rsvp_list l JOIN rsvp_message m ON m.rsvp_list_id = l.id ' +
            'WHERE l.chat_id = :chat_id AND m.message_id = :message_id LIMIT 1',
            { chat_id, message_id }
        );
        if (rows.length === 0) {
            return undefined;
        }
        return this.getRsvpList(Number(rows[0].id));
    }

    setRsvpEntry(rsvp_id: number, entry: RsvpEntry): Promise<RsvpList | undefined> {
        return withTransaction(async conn => {
            const [listRows] = await conn.query<RowDataPacket[]>('SELECT id FROM rsvp_list WHERE id = :id', { id: rsvp_id });
            if (listRows.length === 0) {
                return undefined;
            }
            await this._ensureTelegramUser(conn, entry.user_id, entry.name, entry.username);
            await conn.query(
                'INSERT INTO rsvp_entry (rsvp_list_id, user_id, rsvp) VALUES (:rsvp_id, :user_id, :rsvp) ' +
                'ON DUPLICATE KEY UPDATE rsvp = VALUES(rsvp)',
                { rsvp_id, user_id: entry.user_id, rsvp: entry.rsvp }
            );
            return this._loadRsvpList(conn, rsvp_id);
        });
    }

    addRsvpMessage(rsvp_id: number, ref: RsvpMessageRef): Promise<void> {
        return withTransaction(async conn => {
            const [listRows] = await conn.query<RowDataPacket[]>('SELECT id FROM rsvp_list WHERE id = :id', { id: rsvp_id });
            if (listRows.length === 0) {
                return;
            }
            await conn.query(
                'INSERT INTO rsvp_message (rsvp_list_id, message_id, base_text, keyboard) VALUES (:rsvp_id, :message_id, :base_text, :keyboard) ' +
                'ON DUPLICATE KEY UPDATE base_text = VALUES(base_text), keyboard = VALUES(keyboard)',
                { rsvp_id, message_id: ref.message_id, base_text: ref.base_text, keyboard: ref.keyboard }
            );
        });
    }

    removeRsvpMessage(rsvp_id: number, message_id: number): Promise<void> {
        return query<ResultSetHeader>(
            'DELETE FROM rsvp_message WHERE rsvp_list_id = :rsvp_id AND message_id = :message_id',
            { rsvp_id, message_id }
        ).then(() => undefined);
    }

    deleteRsvpList(rsvp_id: number): Promise<void> {
        return query<ResultSetHeader>('DELETE FROM rsvp_list WHERE id = :id', { id: rsvp_id }).then(() => undefined);
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
                await this._ensureTelegramUser(conn, parsed.user_id);
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

export default DAO;
