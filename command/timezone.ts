import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter.js';
import UserDAO from '../dao/UserDAO.js';
import { formatError } from '../utils.js';
import { normaliseTimezone } from '../timeUtils.js';

const dao = new UserDAO();

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    const argument: string | undefined = msg.command?.argument;
    const user_id: number = msg.from?.id || 0;

    if (!argument) {
        dao.getUserTimezone(user_id)
            .then((timezone: string) => msg.reply(`Your current timezone is ${timezone}`))
            .catch((err: Error) => msg.reply(formatError(err)));
        return;
    }

    const normalisedTz: string | null = normaliseTimezone(argument);
    if (!normalisedTz) {
        msg.reply(`Invalid timezone: ${argument}`);
        return;
    }

    dao.setUserTimezone(user_id, normalisedTz)
        .then(() => msg.reply(`Your timezone has been set to ${normalisedTz}`))
        .catch((err: Error) => msg.reply(formatError(err)));
};
