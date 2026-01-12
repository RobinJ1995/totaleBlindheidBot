const DAO = require('../dao/DAO');
const { formatError } = require('../utils');

const dao = new DAO();

module.exports = (bot, msg) => {
    const chat_id = msg.chat.id;
    dao.getScheduledRollcalls()
        .then(schedules => {
            if (schedules[chat_id]) {
                return dao.removeScheduledRollcall(chat_id)
                    .then(() => msg.reply('Scheduled rollcall cancelled.'));
            } else {
                msg.reply('No rollcall scheduled for this group.');
            }
        })
        .catch(err => msg.reply(formatError(err)));
};
