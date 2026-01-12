const tzSoft = require('timezone-soft');
const DAO = require('../dao/DAO');
const { formatError } = require('../utils');

const dao = new DAO();

module.exports = (api, message) => {
    const argument = message.meta.command?.argument;
    const user_id = message.message.from.id;

    if (!argument) {
        dao.getUserTimezone(user_id)
            .then(timezone => message.reply(`Your current timezone is ${timezone}`))
            .catch(err => message.reply(formatError(err)));
        return;
    }

    const results = tzSoft(argument);
    if (!results || results.length === 0) {
        message.reply(`Invalid timezone: ${argument}`);
        return;
    }

    // Prefer a result where the IANA name contains our input (e.g. "Dublin" -> "Europe/Dublin")
    const bestMatch = results.find(r => r.iana.toLowerCase().includes(argument.toLowerCase())) || results[0];
    const normalizedTz = bestMatch.iana;

    dao.setUserTimezone(user_id, normalizedTz)
        .then(() => message.reply(`Your timezone has been set to ${normalizedTz}`))
        .catch(err => message.reply(formatError(err)));
};
