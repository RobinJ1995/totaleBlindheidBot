const { parseTime } = require('../timeUtils');
const DAO = require('../dao/DAO');
const { formatError, escapeMarkdown } = require('../utils');

const dao = new DAO();

module.exports = (api, message) => {
    const argument = message.meta.command?.argument;
    if (!argument) {
        message.reply('Please specify a time to schedule the rollcall.');
        return;
    }

    const user_id = message.message.from.id;
    dao.getUserTimezone(user_id)
        .then(timezone => {
            const scheduledTime = parseTime(argument, new Date(), timezone);
            if (!scheduledTime) {
                message.reply('Invalid time format.');
                return;
            }

            const now = new Date();
            const diffMs = scheduledTime.getTime() - now.getTime();
            const diffMinutes = diffMs / 60000;

            if (diffMinutes < 2) {
                message.reply('Rollcall must be scheduled at least 2 minutes in advance.');
                return;
            }

            if (diffMinutes > 12 * 60) {
                message.reply('Rollcall cannot be scheduled more than 12 hours in advance.');
                return;
            }

            const chat_id = message.message.chat.id;
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
                    message.reply(`Rollcall scheduled for ${escapeMarkdown(timeString)}`);
                });
        })
        .catch(err => message.reply(formatError(err)));
};
