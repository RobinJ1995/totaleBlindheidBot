import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query, withTransaction } from './Database';
import { ensureTelegramUser } from './telegramUser';

// RSVP lists older than this are pruned on write.
const RSVP_LIST_TTL_MS = 24 * 60 * 60 * 1000;

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

class RsvpDAO {
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
                await ensureTelegramUser(conn, entry.user_id, entry.name, entry.username);
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
            // Lock the list row so concurrent RSVP taps serialise on it. Without the lock,
            // each transaction's snapshot is fixed before the other commits, and the reload
            // below can miss the other entry — rendering a stale list over the Telegram message.
            const [listRows] = await conn.query<RowDataPacket[]>('SELECT id FROM rsvp_list WHERE id = :id FOR UPDATE', { id: rsvp_id });
            if (listRows.length === 0) {
                return undefined;
            }
            await ensureTelegramUser(conn, entry.user_id, entry.name, entry.username);
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
}

export default RsvpDAO;
