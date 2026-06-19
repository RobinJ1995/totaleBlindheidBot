import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query } from './Database';

export interface ChatSettings {
    steam_updates?: boolean;
}

class ChatDAO {
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
}

export default ChatDAO;
