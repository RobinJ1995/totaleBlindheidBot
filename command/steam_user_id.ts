import { Bot, CallbackQuery, Message } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter.js';
import UserDAO from '../dao/UserDAO.js';
import { formatError } from '../utils.js';
import { messageText, Part } from '../format.js';

const dao = new UserDAO();

export const CALLBACK_PREFIX = 'steamid:';

const ADMIN_ONLY = 'Only the admin can set Steam IDs for other users.';

// "<chat_id>:<picker message_id>" -> the user the admin's reply to that message sets Steam IDs for.
const prompts: Map<string, { user_id: number, name: string }> = new Map();

const isAdmin = (userId?: number): boolean => {
    const admin = process.env.STEAM_ADMIN_TELEGRAM_USER_ID;
    return !!admin && String(userId) === admin;
};

const parseIds = (arg: string): string[] | null => {
    const ids: string[] = arg.split(',').map(s => s.trim()).filter(s => s.length > 0);
    return ids.length > 0 && ids.every(id => /^\d{17}$/.test(id)) ? ids : null;
};

const setForUser = (user_id: number, name: string, idsArg: string, reply: (text: Part) => Promise<unknown>): Promise<boolean> => {
    const ids = parseIds(idsArg);
    if (!ids) {
        return reply('Invalid Steam ID(s). Each must be a 17-digit number (SteamID64) starting with 7656.').then(() => false);
    }
    return dao.setSteamUserId(user_id, ids)
        .then(() => reply(`Steam user ID(s) for ${name} has been set to ${ids.join(', ')}`))
        .then(() => true);
};

export default (bot: Bot, msg: ExtendedMessage): void => {
    const [first = '', ...rest] = msg.command.argumentTokens;
    const mention = msg.entities?.find(e => e.type === 'text_mention' && e.user);
    const admin: boolean = isAdmin(msg.from?.id);

    if (mention?.user || first.startsWith('@')) {
        if (!admin) {
            msg.reply(ADMIN_ONLY);
            return;
        }
        const reply = (text: Part) => msg.reply(text);
        const done: Promise<unknown> = mention?.user
            ? setForUser(mention.user.id, mention.user.first_name, msg.text!.slice(mention.offset + mention.length), reply)
            : dao.getUserIdByUsername(first.slice(1)).then((user_id): Promise<unknown> => user_id === undefined
                ? msg.reply(`I don't know ${first}.`)
                : setForUser(user_id, first, rest.join(' '), reply));
        done.catch((err: Error) => msg.reply(formatError(err)));
        return;
    } else if (admin && msg.command.argument === '') {
        dao.getChatUsers(msg.chat.id)
            .then(users => bot.api.sendMessage({
                chat_id: msg.chat.id,
                text: 'Whose Steam ID(s) do you want to set?',
                reply_parameters: { message_id: msg.message_id },
                reply_markup: {
                    inline_keyboard: users.map(user => [{
                        text: user.username ? `${user.name} (@${user.username})` : user.name,
                        callback_data: `${CALLBACK_PREFIX}${user.user_id}`
                    }])
                }
            }))
            .catch((err: Error) => msg.reply(formatError(err)));
        return;
    }

    const ids = parseIds(msg.command.argument);
    if (!ids) {
        msg.reply('Please specify your Steam user ID(s) as SteamID64 (the 17-digit number starting with 7656), separated by commas if multiple.');
        return;
    }

    const user_id: number = msg.from?.id || 0;
    console.log(`User ${user_id} set Steam ID(s) to ${ids.join(', ')}`);
    dao.setSteamUserId(user_id, ids)
        .then(() => msg.reply(`Your Steam user ID(s) has been set to ${ids.join(', ')}`))
        .catch((err: Error) => msg.reply(formatError(err)));
};

export const handleSteamIdCallback = (bot: Bot, query: CallbackQuery): void => {
    const message = query.message;
    if (!message || !query.data) {
        return;
    } else if (!isAdmin(query.from.id)) {
        bot.api.answerCallbackQuery({ callback_query_id: query.id, text: ADMIN_ONLY }).catch(() => undefined);
        return;
    }

    const user_id = Number(query.data.slice(CALLBACK_PREFIX.length));
    dao.getChatUsers(message.chat.id)
        .then(users => {
            const name: string = users.find(u => u.user_id === user_id)?.name ?? String(user_id);
            prompts.set(`${message.chat.id}:${message.message_id}`, { user_id, name });
            return bot.api.editMessageText({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: `Reply to this message with the Steam ID(s) for ${name}.`
            });
        })
        .then(() => bot.api.answerCallbackQuery({ callback_query_id: query.id }))
        .catch((err: Error) => console.error('Error handling Steam ID picker tap:', err));
};

export const handleSteamIdReply = (bot: Bot, msg: Message): boolean => {
    const key = `${msg.chat.id}:${msg.reply_to_message?.message_id}`;
    const target = prompts.get(key);
    if (!target || !msg.text || !isAdmin(msg.from?.id)) {
        return false;
    }

    const reply = (text: Part) => bot.api.sendMessage({
        chat_id: msg.chat.id,
        ...messageText(text),
        reply_parameters: { message_id: msg.message_id }
    });
    setForUser(target.user_id, target.name, msg.text, reply)
        .then(done => done && prompts.delete(key))
        .catch((err: Error) => reply(formatError(err)));
    return true;
};
