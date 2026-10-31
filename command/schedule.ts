import { Bot } from 'node-telegram-bot-api';
import { DateTime } from 'luxon';
import { Command } from '../MessageRouter.js';
import { parseTime } from '../timeUtils.js';
import UserDAO from '../dao/UserDAO.js';
import ScheduleDAO from '../dao/ScheduleDAO.js';
import RollcallPlayerDAO from '../dao/RollcallPlayerDAO.js';
import RsvpDAO, { RsvpEntry, RsvpMessageRef } from '../dao/RsvpDAO.js';
import { formatError } from '../utils.js';
import { asFormatted, dateTime, fmt, Formatted } from '../format.js';
import { resolve, renderMessage, entryFromUser } from '../rsvp.js';
import { mentionUsers, presenceMarkers, withTags } from '../presence.js';
import { retireRsvpList, trackTaggedMessage } from '../taggedMessages.js';
import { broadcast, Broadcast } from '../messenger.js';
import { renderDiscordMessage, withDiscordTags } from '../discord/render.js';

const userDao = new UserDAO();
const scheduleDao = new ScheduleDAO();
const rollcallPlayerDao = new RollcallPlayerDAO();
const rsvpDao = new RsvpDAO();

export default (bot: Bot, cmd: Command): Promise<unknown> => {
    const argument: string | undefined = cmd.command?.argument;
    if (!argument) {
        return cmd.reply('Please specify a time to schedule the rollcall.');
    }

    const user_id: number = cmd.user.id;
    return userDao.getUserTimezone(user_id)
        .then((timezone: string) => {
            const scheduledTime: Date | null = parseTime(argument, new Date(), timezone);
            if (!scheduledTime) {
                return cmd.reply('Invalid time format.');
            }

            const now: Date = new Date();
            const diffMs: number = scheduledTime.getTime() - now.getTime();
            const diffMinutes: number = diffMs / 60000;

            if (diffMinutes < 2) {
                return cmd.reply('Rollcall must be scheduled at least 2 minutes in advance.');
            } else if (diffMinutes > 12 * 60) {
                return cmd.reply('Rollcall cannot be scheduled more than 12 hours in advance.');
            }

            const chat_id: number = cmd.chat_id;
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
                .then((rotation: string[]) => Promise.all([mentionUsers(rotation), presenceMarkers(rotation)])
                    .then(([users, markers]) => ({ rotation, users, markers })))
                .then(({ rotation, users, markers }) => {
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

                    // Measured from the rounded lead time so "3 hours" doesn't come out as "in 2 hours".
                    const scheduled: DateTime = DateTime.fromJSDate(scheduledTime);
                    const relative: string = scheduled.toRelative({ base: scheduled.minus({ minutes: Math.round(diffMinutes) }) })!;

                    // Seed the initiator into the "yes" list.
                    const entries: Record<string, RsvpEntry> = {};
                    entries[user_id] = entryFromUser(cmd.user, 'yes');

                    const { groups, tagged } = resolve(rotation, entries);
                    // Like a rollcall, the schedule tags the whole rotation up front. The
                    // mention line is baked in here so it records who was pinged when scheduled.
                    // Its 🟢/🟡/🔴/😶‍🌫️ presence markers are kept up to date for a while and then
                    // stripped, so the stored base leaves them out.
                    const heading: Formatted = fmt`Rollcall scheduled for ${dateTime(timeString, scheduledTime, 'wt')} (${dateTime(relative, scheduledTime, 'r')})`;
                    const head: Formatted = tagged.length ? fmt`${heading}\n` : heading;
                    const base: Formatted = withTags(head, tagged, users);
                    const discordBase: string = withDiscordTags(head, tagged, users);

                    return broadcast(bot, cmd,
                        renderMessage(withTags(head, tagged, users, markers), groups),
                        renderDiscordMessage(discordBase, groups),
                        { keyboard: 'schedule' }
                    ).then((sent: Broadcast) => {
                        const refs: RsvpMessageRef[] = [
                            ...(sent.telegram ? [{ platform: 'telegram' as const, message_id: sent.telegram.message_id, base, keyboard: 'schedule' as const }] : []),
                            ...sent.discord.map(copy => ({ ...copy.where, base: asFormatted(discordBase), keyboard: 'schedule' as const }))
                        ];
                        const tracked: Promise<unknown> = sent.telegram ? trackTaggedMessage(sent.telegram, head, tagged, true) : Promise.resolve();
                        return tracked.then(() => rsvpDao.createRsvpList({
                            chat_id,
                            entries,
                            messages: refs
                        }).then((rsvp_id: number) =>
                            // Store the rsvp_id + initiator on the schedule so the timer can
                            // find and share the same list when the rollcall fires.
                            scheduleDao.setScheduledRollcall(chat_id, scheduledTime, rsvp_id, user_id)
                        ));
                    });
                });
        })
        .catch((err: Error) => cmd.reply(formatError(err)));
};
