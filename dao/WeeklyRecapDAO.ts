import { ResultSetHeader } from 'mysql2/promise';
import { query } from './Database.js';

class WeeklyRecapDAO {
    // Whether this call took the chat's slot for the week; only one caller ever does.
    async claim(chat_id: number, iso_week: string): Promise<boolean> {
        const result = await query<ResultSetHeader>(
            'INSERT IGNORE INTO weekly_recap (chat_id, iso_week) VALUES (:chat_id, :iso_week)',
            { chat_id, iso_week }
        );
        return result.affectedRows === 1;
    }
}

export default WeeklyRecapDAO;
