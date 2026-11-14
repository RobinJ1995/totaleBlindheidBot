import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query } from './Database.js';

export interface RelayedReaction {
    relayed_id: number;
    user_ref: string;
    emoji: string;
}

class RelayedReactionDAO {
    async add(relayed_id: number, user_ref: string, emoji: string[]): Promise<void> {
        await Promise.all(emoji.map(e => query<ResultSetHeader>(
            'INSERT IGNORE INTO relayed_reaction (relayed_id, user_ref, emoji) VALUES (:relayed_id, :user_ref, :emoji)',
            { relayed_id, user_ref, emoji: e }
        )));
    }

    async remove(relayed_id: number, user_ref: string, emoji: string[]): Promise<void> {
        if (emoji.length > 0) {
            await query<ResultSetHeader>(
                'DELETE FROM relayed_reaction WHERE relayed_id = :relayed_id AND user_ref = :user_ref AND emoji IN (:emoji)',
                { relayed_id, user_ref, emoji }
            );
        }
    }

    // Every reaction on a message and its copies.
    async ofGroup(origin_id: number): Promise<RelayedReaction[]> {
        const rows = await query<RowDataPacket[]>(
            'SELECT r.relayed_id, r.user_ref, r.emoji FROM relayed_reaction r JOIN relayed_message m ON m.id = r.relayed_id ' +
            'WHERE m.id = :origin_id OR m.origin_id = :origin_id',
            { origin_id }
        );
        return rows.map(row => ({ relayed_id: Number(row.relayed_id), user_ref: String(row.user_ref), emoji: String(row.emoji) }));
    }
}

export default RelayedReactionDAO;
