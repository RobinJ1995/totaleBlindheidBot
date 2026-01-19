import tzSoft from 'timezone-soft';
import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter';
import DAO from '../dao/DAO';
import { formatError } from '../utils';

const dao = new DAO();

// Define a minimal interface for timezone-soft results since @types might not exist
interface TimezoneResult {
    iana: string;
    [key: string]: any;
}

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    const argument: string | undefined = msg.command?.argument;
    const user_id: number = msg.from?.id || 0;

    if (!argument) {
        dao.getUserTimezone(user_id)
            .then((timezone: string) => msg.reply(`Your current timezone is ${timezone}`))
            .catch((err: Error) => msg.reply(formatError(err)));
        return;
    }

    const results: TimezoneResult[] = tzSoft(argument);
    if (!results || results.length === 0) {
        msg.reply(`Invalid timezone: ${argument}`);
        return;
    }

    // Prefer a result where the IANA name contains our input (e.g. "Dublin" -> "Europe/Dublin")
    const bestMatch: TimezoneResult = results.find(r => r.iana.toLowerCase().includes(argument.toLowerCase())) || results[0];
    const normalizedTz: string = bestMatch.iana;

    dao.setUserTimezone(user_id, normalizedTz)
        .then(() => msg.reply(`Your timezone has been set to ${normalizedTz}`))
        .catch((err: Error) => msg.reply(formatError(err)));
};
