import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter';
import DAO from '../dao/DAO';
import { formatError } from '../utils';

const dao = new DAO();

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    const args: string[] = msg.command?.argumentTokens || [];
    const adminId: string | undefined = process.env.STEAM_ADMIN_TELEGRAM_USER_ID;
    const isAdmin: boolean = !!(adminId && String(msg.from?.id) === String(adminId));

    const parseAndValidate = (arg: string): { ids: string[], valid: boolean } => {
        const ids: string[] = arg.split(',').map(s => s.trim()).filter(s => s.length > 0);
        const valid: boolean = ids.length > 0 && ids.every(id => /^\d{17}$/.test(id));
        return { ids, valid };
    };

    if (isAdmin && args.length === 2 && msg.from) {
        const [tgUserId, steamIdArg] = args;
        if (!/^\d+$/.test(tgUserId)) {
            msg.reply('Invalid Telegram user ID.');
            return;
        }

        const { ids, valid } = parseAndValidate(steamIdArg);
        if (!valid) {
            msg.reply('Invalid Steam ID(s). Each must be a 17-digit number (SteamID64) starting with 7656.');
            return;
        }

        console.log(`Admin ${msg.from.id} set Steam ID(s) for user ${tgUserId} to ${ids.join(', ')}`);
        dao.setSteamUserId(tgUserId, ids)
            .then(() => msg.reply(`Steam user ID(s) for user ${tgUserId} has been set to ${ids.join(', ')}`))
            .catch((err: Error) => msg.reply(formatError(err)));
        return;
    }

    const { ids, valid } = parseAndValidate(msg.command?.argument || '');
    if (!valid) {
        msg.reply('Please specify your Steam user ID(s) as SteamID64 (the 17-digit number starting with 7656), separated by commas if multiple.');
        return;
    }

    const user_id: number = msg.from?.id || 0;
    console.log(`User ${user_id} set Steam ID(s) to ${ids.join(', ')}`);
    dao.setSteamUserId(user_id, ids)
        .then(() => msg.reply(`Your Steam user ID(s) has been set to ${ids.join(', ')}`))
        .catch((err: Error) => msg.reply(formatError(err)));
};
