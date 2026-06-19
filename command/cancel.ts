import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter';
import DAO, { ScheduledRollcalls } from '../dao/DAO';
import { formatError } from '../utils';
import { retireRsvpList } from '../rsvp';

const dao = new DAO();

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    const chat_id: number = msg.chat.id;
    dao.getScheduledRollcalls()
        .then((schedules: ScheduledRollcalls) => {
            if (schedules[chat_id]) {
                const schedule = schedules[chat_id];
                return dao.removeScheduledRollcall(chat_id)
                    .then(() => schedule.rsvp_id ? retireRsvpList(bot, dao, schedule.rsvp_id) : undefined)
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
