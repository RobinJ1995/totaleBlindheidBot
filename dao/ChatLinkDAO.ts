import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query } from './Database.js';

export interface ChatLink {
    telegram_chat_id: number;
    discord_guild_id: string;
    discord_channel_id: string;
    webhook_id?: string;
    webhook_token?: string;
}

const COLUMNS = 'discord_channel_id, discord_guild_id, telegram_chat_id, webhook_id, webhook_token';

const fromRow = (row: RowDataPacket): ChatLink => ({
    telegram_chat_id: Number(row.telegram_chat_id),
    discord_guild_id: String(row.discord_guild_id),
    discord_channel_id: String(row.discord_channel_id),
    webhook_id: row.webhook_id ?? undefined,
    webhook_token: row.webhook_token ?? undefined
});

class ChatLinkDAO {
    async getLinks(telegram_chat_id: number): Promise<ChatLink[]> {
        const rows = await query<RowDataPacket[]>(
            `SELECT ${COLUMNS} FROM chat_link WHERE telegram_chat_id = :telegram_chat_id ORDER BY linked_at, discord_channel_id`,
            { telegram_chat_id }
        );
        return rows.map(fromRow);
    }

    async getAllLinks(): Promise<ChatLink[]> {
        const rows = await query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM chat_link ORDER BY linked_at, discord_channel_id`);
        return rows.map(fromRow);
    }

    async getLinkByChannel(discord_channel_id: string): Promise<ChatLink | undefined> {
        const rows = await query<RowDataPacket[]>(
            `SELECT ${COLUMNS} FROM chat_link WHERE discord_channel_id = :discord_channel_id`,
            { discord_channel_id }
        );
        return rows.length > 0 ? fromRow(rows[0]) : undefined;
    }

    addLink(link: ChatLink): Promise<void> {
        return query<ResultSetHeader>(
            'INSERT INTO chat_link (discord_channel_id, discord_guild_id, telegram_chat_id, webhook_id, webhook_token, linked_at) ' +
            'VALUES (:discord_channel_id, :discord_guild_id, :telegram_chat_id, :webhook_id, :webhook_token, :linked_at)',
            { ...link, webhook_id: link.webhook_id ?? null, webhook_token: link.webhook_token ?? null, linked_at: new Date() }
        ).then(() => undefined);
    }

    async removeLink(telegram_chat_id: number, discord_channel_id: string): Promise<boolean> {
        const res = await query<ResultSetHeader>(
            'DELETE FROM chat_link WHERE telegram_chat_id = :telegram_chat_id AND discord_channel_id = :discord_channel_id',
            { telegram_chat_id, discord_channel_id }
        );
        return res.affectedRows > 0;
    }
}

export default ChatLinkDAO;
