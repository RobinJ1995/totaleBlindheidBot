import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter';
import { parseTime } from '../timeUtils';
import DAO from '../dao/DAO';
import { formatError, escapeMarkdown } from '../utils';

const dao = new DAO();

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    const argument: string | undefined = msg.command?.argument;
    if (!argument) {
        msg.reply('Please specify a time to schedule the rollcall.');
        return;
    }

    const user_id: number = msg.from?.id || 0;
    dao.getUserTimezone(user_id)
        .then((timezone: string) => {
            const scheduledTime: Date | null = parseTime(argument, new Date(), timezone);
            if (!scheduledTime) {
                msg.reply('Invalid time format.');
                return;
            }

            const now: Date = new Date();
            const diffMs: number = scheduledTime.getTime() - now.getTime();
            const diffMinutes: number = diffMs / 60000;

            if (diffMinutes < 2) {
                msg.reply('Rollcall must be scheduled at least 2 minutes in advance.');
                return;
            }

            if (diffMinutes > 12 * 60) {
                msg.reply('Rollcall cannot be scheduled more than 12 hours in advance.');
                return;
            }

            const chat_id: number = msg.chat.id;
            return dao.setScheduledRollcall(chat_id, scheduledTime)
                .then(() => {
                    const timeString: string = scheduledTime.toLocaleString('en-GB', {
                        timeZone: timezone,
                        year: 'numeric',
                        month: 'numeric',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: 'numeric',
                        second: 'numeric',
                        timeZoneName: 'short'
                    });
                    msg.reply(`Rollcall scheduled for ${escapeMarkdown(timeString)}`);
                });
        })
        .catch((err: Error) => msg.reply(formatError(err)));
};
