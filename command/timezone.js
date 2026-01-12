const tzSoft = require('timezone-soft');
const DAO = require('../dao/DAO');
const { formatError } = require('../utils');

const dao = new DAO();

module.exports = (bot, msg) => {
    const argument = msg.command?.argument;
    const user_id = msg.from.id;

    if (!argument) {
        dao.getUserTimezone(user_id)
            .then(timezone => msg.reply(`Your current timezone is ${timezone}`))
            .catch(err => msg.reply(formatError(err)));
        return;
    }

    const results = tzSoft(argument);
    if (!results || results.length === 0) {
        msg.reply(`Invalid timezone: ${argument}`);
        return;
    }

    // Prefer a result where the IANA name contains our input (e.g. "Dublin" -> "Europe/Dublin")
    const bestMatch = results.find(r => r.iana.toLowerCase().includes(argument.toLowerCase())) || results[0];
    const normalizedTz = bestMatch.iana;

    dao.setUserTimezone(user_id, normalizedTz)
        .then(() => msg.reply(`Your timezone has been set to ${normalizedTz}`))
        .catch(err => msg.reply(formatError(err)));
};
