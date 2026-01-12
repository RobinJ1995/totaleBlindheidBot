const { parseTime } = require('../timeUtils');
const DAO = require('../dao/DAO');
const { formatError, escapeMarkdown } = require('../utils');

const dao = new DAO();

module.exports = (bot, msg) => {
    const argument = msg.command?.argument;
    if (!argument) {
        msg.reply('Please specify a time to schedule the rollcall.');
        return;
    }

    const user_id = msg.from.id;
    dao.getUserTimezone(user_id)
        .then(timezone => {
            const scheduledTime = parseTime(argument, new Date(), timezone);
            if (!scheduledTime) {
                msg.reply('Invalid time format.');
                return;
            }

            const now = new Date();
            const diffMs = scheduledTime.getTime() - now.getTime();
            const diffMinutes = diffMs / 60000;

            if (diffMinutes < 2) {
                msg.reply('Rollcall must be scheduled at least 2 minutes in advance.');
                return;
            }

            if (diffMinutes > 12 * 60) {
                msg.reply('Rollcall cannot be scheduled more than 12 hours in advance.');
                return;
            }

            const chat_id = msg.chat.id;
            return dao.setScheduledRollcall(chat_id, scheduledTime)
                .then(() => {
                    const timeString = scheduledTime.toLocaleString('en-GB', {
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
        .catch(err => msg.reply(formatError(err)));
};
