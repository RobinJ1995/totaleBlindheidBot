import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query, withTransaction } from './Database.js';

export type Platform = 'telegram' | 'discord';

// How a copy was sent, which decides how it is edited: 'text' and 'caption' on Telegram,
// 'webhook' and 'bot' on Discord. 'extra' copies (further files) are never edited.
export type CopyKind = 'text' | 'caption' | 'webhook' | 'bot' | 'extra';

export interface MessageRef {
    platform: Platform;
    chat_id: string;
    message_id: string;
}

export interface RelayedMessage extends MessageRef {
    id: number;
    origin_id: number | null;
    kind: CopyKind | 'origin';
    author: string | null;
    // Who sent it, as `<platform>:<user id>`; unset for the bot's own messages.
    author_ref?: string;
}

const fromRow = (row: RowDataPacket): RelayedMessage => ({
    id: Number(row.id),
    origin_id: row.origin_id === null ? null : Number(row.origin_id),
    platform: row.platform,
    chat_id: String(row.chat_id),
    message_id: String(row.message_id),
    kind: row.kind,
    author: row.author,
    author_ref: row.author_ref ?? undefined
});

class RelayedMessageDAO {
    async record(origin: MessageRef, author: string, copies: (MessageRef & { kind: CopyKind })[], author_ref?: string): Promise<void> {
        if (copies.length === 0) {
            return;
        }
        await withTransaction(async conn => {
            const [result] = await conn.query<ResultSetHeader>(
                'INSERT INTO relayed_message (platform, chat_id, message_id, kind, author, author_ref, created_at) ' +
                'VALUES (:platform, :chat_id, :message_id, \'origin\', :author, :author_ref, NOW(3))',
                { ...origin, author, author_ref: author_ref ?? null }
            );
            await Promise.all(copies.map(copy => conn.query(
                'INSERT INTO relayed_message (origin_id, platform, chat_id, message_id, kind, created_at) ' +
                'VALUES (:origin_id, :platform, :chat_id, :message_id, :kind, NOW(3))',
                { ...copy, origin_id: result.insertId }
            )));
        });
    }

    async find(ref: MessageRef): Promise<RelayedMessage | undefined> {
        const rows = await query<RowDataPacket[]>(
            'SELECT * FROM relayed_message WHERE platform = :platform AND chat_id = :chat_id AND message_id = :message_id',
            ref
        );
        return rows.length > 0 ? fromRow(rows[0]) : undefined;
    }

    // The original first, then its copies in the order they were sent.
    async group(message: RelayedMessage): Promise<RelayedMessage[]> {
        const origin_id: number = message.origin_id ?? message.id;
        const rows = await query<RowDataPacket[]>(
            'SELECT * FROM relayed_message WHERE id = :origin_id OR origin_id = :origin_id ORDER BY id',
            { origin_id }
        );
        return rows.map(fromRow);
    }

    async forget(ids: number[]): Promise<void> {
        if (ids.length > 0) {
            await query<ResultSetHeader>('DELETE FROM relayed_message WHERE id IN (:ids)', { ids });
        }
    }
}

export default RelayedMessageDAO;
