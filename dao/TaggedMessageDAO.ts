import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query } from './Database.js';
import { Formatted } from '../format.js';

// A sent message whose tag line carries live presence markers.
export interface TaggedMessage {
    chat_id: number;
    message_id: number;
    head: Formatted;  // everything above the tag line, including the separator before it
    tags: string[];   // the rotation mention strings tagged when the message was sent
    rsvp: boolean;    // attached to an RSVP list (rendered with its lists and buttons)
    sent_at: Date;
}

const COLUMNS = 'chat_id, message_id, head_text, head_entities, tags, rsvp, sent_at';

class TaggedMessageDAO {
    private _fromRow(row: RowDataPacket): TaggedMessage {
        return {
            chat_id: Number(row.chat_id),
            message_id: Number(row.message_id),
            head: { text: row.head_text, entities: JSON.parse(row.head_entities ?? '[]') },
            tags: JSON.parse(row.tags),
            rsvp: !!row.rsvp,
            sent_at: row.sent_at
        };
    }

    addTaggedMessage(message: TaggedMessage): Promise<void> {
        return query<ResultSetHeader>(
            `INSERT INTO tagged_message (${COLUMNS}) ` +
            'VALUES (:chat_id, :message_id, :head_text, :head_entities, :tags, :rsvp, :sent_at)',
            {
                chat_id: message.chat_id,
                message_id: message.message_id,
                head_text: message.head.text,
                head_entities: JSON.stringify(message.head.entities),
                tags: JSON.stringify(message.tags),
                rsvp: message.rsvp ? 1 : 0,
                sent_at: message.sent_at
            }
        ).then(() => undefined);
    }

    async getTaggedMessage(chat_id: number, message_id: number): Promise<TaggedMessage | undefined> {
        const rows = await query<RowDataPacket[]>(
            `SELECT ${COLUMNS} FROM tagged_message WHERE chat_id = :chat_id AND message_id = :message_id`,
            { chat_id, message_id }
        );
        return rows.length > 0 ? this._fromRow(rows[0]) : undefined;
    }

    async getTaggedMessagesSince(since: Date): Promise<TaggedMessage[]> {
        const rows = await query<RowDataPacket[]>(
            `SELECT ${COLUMNS} FROM tagged_message WHERE sent_at >= :since`,
            { since }
        );
        return rows.map(row => this._fromRow(row));
    }

    async getTaggedMessagesBefore(before: Date): Promise<TaggedMessage[]> {
        const rows = await query<RowDataPacket[]>(
            `SELECT ${COLUMNS} FROM tagged_message WHERE sent_at < :before`,
            { before }
        );
        return rows.map(row => this._fromRow(row));
    }

    // True when this call removed the row, so concurrent strippers only edit once.
    async deleteTaggedMessage(chat_id: number, message_id: number): Promise<boolean> {
        const res = await query<ResultSetHeader>(
            'DELETE FROM tagged_message WHERE chat_id = :chat_id AND message_id = :message_id',
            { chat_id, message_id }
        );
        return res.affectedRows > 0;
    }
}

export default TaggedMessageDAO;
