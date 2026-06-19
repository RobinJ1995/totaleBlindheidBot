import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter';
import { parseTime } from '../timeUtils';
import DAO, { RsvpEntry } from '../dao/DAO';
import { formatError, escapeMarkdown } from '../utils';
import { keyboard, resolve, renderMessage, entryFromUser, retireRsvpList } from '../rsvp';

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
            // Rescheduling replaces any existing schedule for this chat: retire the previous
            // RSVP list first so its stale confirmation buttons can't record responses against
            // a schedule that will never fire.
            return dao.getScheduledRollcalls()
                .then(schedules => {
                    const previous = schedules[chat_id];
                    return previous?.rsvp_id ? retireRsvpList(bot, dao, previous.rsvp_id) : undefined;
                })
                .then(() => dao.setScheduledRollcall(chat_id, scheduledTime))
                .then(() => dao.getRollcallPlayerUsernames(chat_id))
                .then((rotation: string[]) => {
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

                    // Seed the initiator into the "yes" list.
                    const entries: Record<string, RsvpEntry> = {};
                    if (msg.from) {
                        entries[msg.from.id] = entryFromUser(msg.from, 'yes');
                    }

                    const baseText: string = `Rollcall scheduled for ${escapeMarkdown(timeString)}`;
                    const { groups } = resolve(rotation, entries);

                    return bot.sendMessage(chat_id, renderMessage(baseText, groups), {
                        reply_to_message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: keyboard('schedule')
                    }).then((sent: TelegramBot.Message) => {
                        return dao.createRsvpList({
                            chat_id,
                            entries,
                            messages: [{ message_id: sent.message_id, base_text: baseText, keyboard: 'schedule' }]
                        }).then((rsvp_id: number) =>
                            // Store the rsvp_id + initiator on the schedule so the timer can
                            // find and share the same list when the rollcall fires.
                            dao.setScheduledRollcall(chat_id, scheduledTime, rsvp_id, user_id)
                        );
                    });
                });
        })
        .catch((err: Error) => msg.reply(formatError(err)));
};
