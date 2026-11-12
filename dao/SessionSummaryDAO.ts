import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query } from './Database.js';

class SessionSummaryDAO {
    async getLastSentAt(chat_id: number): Promise<Date | null> {
        const rows = await query<RowDataPacket[]>('SELECT last_sent_at FROM session_summary WHERE chat_id = :chat_id', { chat_id });
        return rows[0]?.last_sent_at ?? null;
    }

    setLastSentAt(chat_id: number, last_sent_at: Date): Promise<void> {
        return query<ResultSetHeader>(
            'INSERT INTO session_summary (chat_id, last_sent_at) VALUES (:chat_id, :last_sent_at) ' +
            'ON DUPLICATE KEY UPDATE last_sent_at = VALUES(last_sent_at)',
            { chat_id, last_sent_at }
        ).then(() => undefined);
    }
}

export default SessionSummaryDAO;
