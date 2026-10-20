import { Bot } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter.js';
import ScheduleDAO, { ScheduledRollcalls } from '../dao/ScheduleDAO.js';
import { formatError } from '../utils.js';
import { retireRsvpList } from '../taggedMessages.js';

const scheduleDao = new ScheduleDAO();

export default (bot: Bot, msg: ExtendedMessage): void => {
    const chat_id: number = msg.chat.id;
    scheduleDao.getScheduledRollcalls()
        .then((schedules: ScheduledRollcalls) => {
            if (schedules[chat_id]) {
                const schedule = schedules[chat_id];
                return scheduleDao.removeScheduledRollcall(chat_id)
                    .then(() => schedule.rsvp_id ? retireRsvpList(bot, schedule.rsvp_id) : undefined)
                    .then(() => {
                        msg.reply('Scheduled rollcall cancelled.');
                    });
            }

            msg.reply('No rollcall scheduled for this group.');
            return;
        })
        .catch((err: Error) => msg.reply(formatError(err)));
};
