import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter';
import DAO from '../dao/DAO';
import { formatError } from '../utils';

const dao = new DAO();

import { ScheduledRollcalls } from '../dao/DAO';

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    const chat_id: number = msg.chat.id;
    dao.getScheduledRollcalls()
        .then((schedules: ScheduledRollcalls) => {
            if (schedules[chat_id]) {
                return dao.removeScheduledRollcall(chat_id)
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
