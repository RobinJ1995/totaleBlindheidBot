const DAO = require('../dao/DAO');
const { formatError } = require('../utils');

const dao = new DAO();

module.exports = (api, message) => {
    const chat_id = message.message.chat.id;
    dao.getScheduledRollcalls()
        .then(schedules => {
            if (schedules[chat_id]) {
                return dao.removeScheduledRollcall(chat_id)
                    .then(() => message.reply('Scheduled rollcall cancelled.'));
            } else {
                message.reply('No rollcall scheduled for this group.');
            }
        })
        .catch(err => message.reply(formatError(err)));
};
