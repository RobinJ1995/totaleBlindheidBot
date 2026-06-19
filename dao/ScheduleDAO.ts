import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query, withTransaction } from './Database';
import { ensureTelegramUser } from './telegramUser';

export interface ScheduledRollcall {
    time: Date;
    rsvp_id?: number;
    initiator_id?: number;
}

export type ScheduledRollcalls = Record<string, ScheduledRollcall>;

class ScheduleDAO {
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
                await ensureTelegramUser(conn, initiator_id);
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
}

export default ScheduleDAO;
