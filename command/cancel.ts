import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter';
import ScheduleDAO, { ScheduledRollcalls } from '../dao/ScheduleDAO';
import RsvpDAO from '../dao/RsvpDAO';
import { formatError } from '../utils';
import { retireRsvpList } from '../rsvp';

const scheduleDao = new ScheduleDAO();
const rsvpDao = new RsvpDAO();

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    const chat_id: number = msg.chat.id;
    scheduleDao.getScheduledRollcalls()
        .then((schedules: ScheduledRollcalls) => {
            if (schedules[chat_id]) {
                const schedule = schedules[chat_id];
                return scheduleDao.removeScheduledRollcall(chat_id)
                    .then(() => schedule.rsvp_id ? retireRsvpList(bot, rsvpDao, schedule.rsvp_id) : undefined)
                    .then(() => {
                        msg.reply('Scheduled rollcall cancelled.');
                    });
            } else {
                msg.reply('No rollcall scheduled for this group.');
                return;
            }
        })
        .catch((err: Error) => msg.reply(formatError(err)));
};
