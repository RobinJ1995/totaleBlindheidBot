import { Bot } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter.js';
import { isChatAdmin } from '../admin.js';
import UserDAO, { User, userDisplayName } from '../dao/UserDAO.js';
import { resolveTelegramUser } from '../discord/users.js';
import { formatError } from '../utils.js';
import { ADMIN_ONLY } from './link_user.js';

const userDao = new UserDAO();

export default async (bot: Bot, msg: ExtendedMessage): Promise<void> => {
    try {
        if (!(await isChatAdmin(bot, msg.chat.id, msg.from?.id))) {
            await msg.reply(ADMIN_ONLY);
            return;
        }
        const [first] = msg.command.argumentTokens;
        if (msg.command.argumentTokens.length !== 1) {
            await msg.reply('Usage: /unlink_user @telegram_user');
            return;
        }
        const telegramUser: User | undefined = await resolveTelegramUser(msg, first);
        if (!telegramUser) {
            await msg.reply(`I don't know ${first}.`);
            return;
        } else if (!telegramUser.discord_id) {
            await msg.reply(`${userDisplayName(telegramUser)} is not linked to a Discord user.`);
            return;
        }
        await userDao.unlinkDiscord(telegramUser.id);
        await msg.reply(`Unlinked ${userDisplayName(telegramUser)} from Discord user ${telegramUser.discord_username}.`);
    } catch (err: any) {
        await msg.reply(formatError(err));
    }
};
