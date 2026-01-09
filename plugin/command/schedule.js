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

    const scheduledTime = parseTime(argument);
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
    dao.setScheduledRollcall(chat_id, scheduledTime)
        .then(() => {
            message.reply(`Rollcall scheduled for ${escapeMarkdown(scheduledTime.toString())}`);
        })
        .catch(err => message.reply(formatError(err)));
};
