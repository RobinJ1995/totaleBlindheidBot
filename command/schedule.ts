import { Bot, Message } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter.js';
import { parseTime } from '../timeUtils.js';
import UserDAO from '../dao/UserDAO.js';
import ScheduleDAO from '../dao/ScheduleDAO.js';
import RollcallPlayerDAO from '../dao/RollcallPlayerDAO.js';
import RsvpDAO, { RsvpEntry } from '../dao/RsvpDAO.js';
import { formatError } from '../utils.js';
import { asFormatted, Formatted, messageText } from '../format.js';
import { keyboard, resolve, renderMessage, entryFromUser } from '../rsvp.js';
import { presenceMarkers, withTags } from '../presence.js';
import { retireRsvpList, trackTaggedMessage } from '../taggedMessages.js';

const userDao = new UserDAO();
const scheduleDao = new ScheduleDAO();
const rollcallPlayerDao = new RollcallPlayerDAO();
const rsvpDao = new RsvpDAO();

export default (bot: Bot, msg: ExtendedMessage): void => {
    const argument: string | undefined = msg.command?.argument;
    if (!argument) {
        msg.reply('Please specify a time to schedule the rollcall.');
        return;
    }

    const user_id: number = msg.from?.id || 0;
    userDao.getUserTimezone(user_id)
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
            } else if (diffMinutes > 12 * 60) {
                msg.reply('Rollcall cannot be scheduled more than 12 hours in advance.');
                return;
            }

            const chat_id: number = msg.chat.id;
            // Rescheduling replaces any existing schedule for this chat: retire the previous
            // RSVP list first so its stale confirmation buttons can't record responses against
            // a schedule that will never fire.
            return scheduleDao.getScheduledRollcalls()
                .then(schedules => {
                    const previous = schedules[chat_id];
                    return previous?.rsvp_id ? retireRsvpList(bot, previous.rsvp_id) : undefined;
                })
                .then(() => scheduleDao.setScheduledRollcall(chat_id, scheduledTime))
                .then(() => rollcallPlayerDao.getRollcallPlayerUsernames(chat_id))
                .then((rotation: string[]) => presenceMarkers(rotation).then(markers => ({ rotation, markers })))
                .then(({ rotation, markers }) => {
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

                    const { groups, tagged } = resolve(rotation, entries);
                    // Like a rollcall, the schedule tags the whole rotation up front. The
                    // mention line is baked in here so it records who was pinged when scheduled.
                    // Its 🟢/🟡/🔴/😶‍🌫️ presence markers are kept up to date for a while and then
                    // stripped, so the stored base leaves them out.
                    const heading: string = `Rollcall scheduled for ${timeString}`;
                    const head: Formatted = asFormatted(tagged.length ? `${heading}\n` : heading);
                    const base: Formatted = withTags(head, tagged);

                    return bot.api.sendMessage({
                        chat_id,
                        ...messageText(renderMessage(withTags(head, tagged, markers), groups)),
                        reply_parameters: { message_id: msg.message_id },
                        reply_markup: keyboard('schedule', groups)
                    }).then((sent: Message) => {
                        return trackTaggedMessage(sent, head, tagged, true).then(() => rsvpDao.createRsvpList({
                            chat_id,
                            entries,
                            messages: [{ message_id: sent.message_id, base, keyboard: 'schedule' }]
                        }).then((rsvp_id: number) =>
                            // Store the rsvp_id + initiator on the schedule so the timer can
                            // find and share the same list when the rollcall fires.
                            scheduleDao.setScheduledRollcall(chat_id, scheduledTime, rsvp_id, user_id)
                        ));
                    });
                });
        })
        .catch((err: Error) => msg.reply(formatError(err)));
};
