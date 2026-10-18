import { Bot, CallbackQuery, InlineKeyboardButton, Message, MessageEntity } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter.js';
import UserDAO, { ChatUser } from '../dao/UserDAO.js';
import { formatError } from '../utils.js';
import { bold, fmt, messageText, Part } from '../format.js';

const dao = new UserDAO();

// The callback-data namespace for the admin's user picker, dispatched to handleSteamIdCallback by the
// main callback_query listener. Payloads: "pick:<user_id>" selects a user, "cancel" closes the picker.
export const CALLBACK_PREFIX = 'steamid:';

const ADMIN_ONLY = 'Only the admin can set Steam IDs for other users.';
const INVALID_IDS = 'Invalid Steam ID(s). Each must be a 17-digit number (SteamID64) starting with 7656.';

// Only the configured Steam admin may set Steam IDs for other users.
const isAdmin = (userId?: number): boolean => {
    const admin = process.env.STEAM_ADMIN_TELEGRAM_USER_ID;
    return !!admin && userId != null && String(userId) === admin;
};

const parseAndValidate = (arg: string): { ids: string[], valid: boolean } => {
    const ids: string[] = arg.split(',').map(s => s.trim()).filter(s => s.length > 0);
    const valid: boolean = ids.length > 0 && ids.every(id => /^\d{17}$/.test(id));
    return { ids, valid };
};

interface Target {
    user_id: number;
    name: string;
}

// Outstanding "send the Steam ID(s) for X" prompts from the picker, keyed by `<chat_id>:<prompt message_id>`.
// Kept in memory: after a restart a reply to an old prompt is simply not recognised, and the admin
// runs the command again.
const pendingPrompts: Map<string, Target> = new Map();
const promptKey = (chat_id: number, message_id: number): string => `${chat_id}:${message_id}`;

type TargetRef = { mention: MessageEntity & { user: NonNullable<MessageEntity['user']> }, rest: string }
    | { username: string, rest: string };

// The user reference leading the command's arguments, if any: a tapped mention (for users without a
// username) or an @username. `rest` is the text after it, i.e. the Steam ID(s).
const leadingTarget = (msg: Message): TargetRef | undefined => {
    const text: string = msg.text ?? '';
    const commandLength: number = text.split(/\s/, 1)[0].length;
    const gap: number = text.slice(commandLength).search(/\S/);
    if (gap < 0) {
        return undefined;
    }
    const offset: number = commandLength + gap;

    const mention = (msg.entities || []).find(e => e.type === 'text_mention' && e.offset === offset && e.user);
    if (mention?.user) {
        return { mention: { ...mention, user: mention.user }, rest: text.slice(offset + mention.length) };
    }

    const token: string = text.slice(offset).split(/\s/, 1)[0];
    if (token.startsWith('@') && token.length > 1) {
        return { username: token.slice(1), rest: text.slice(offset + token.length) };
    }
    return undefined;
};

const resolveTarget = async (msg: Message, ref: TargetRef): Promise<Target | undefined> => {
    if ('mention' in ref) {
        const name: string = (msg.text ?? '').slice(ref.mention.offset, ref.mention.offset + ref.mention.length) || ref.mention.user.first_name;
        return { user_id: ref.mention.user.id, name };
    }
    const user_id: number | undefined = await dao.getUserIdByUsername(ref.username);
    return user_id === undefined ? undefined : { user_id, name: `@${ref.username}` };
};

const setForTarget = (target: Target, idsArg: string, reply: (text: Part) => Promise<unknown>, adminId: number): Promise<boolean> => {
    const { ids, valid } = parseAndValidate(idsArg);
    if (!valid) {
        return reply(INVALID_IDS).then(() => false);
    }
    console.log(`Admin ${adminId} set Steam ID(s) for user ${target.user_id} to ${ids.join(', ')}`);
    return dao.setSteamUserId(target.user_id, ids)
        .then(() => reply(`Steam user ID(s) for ${target.name} has been set to ${ids.join(', ')}`))
        .then(() => true);
};

// One button per user the bot has seen in the chat, plus a Cancel row.
const pickerKeyboard = (users: ChatUser[]): InlineKeyboardButton[][] => [
    ...users.map(user => ([{
        text: user.username ? `${user.name} (@${user.username})` : user.name,
        callback_data: `${CALLBACK_PREFIX}pick:${user.user_id}`
    }])),
    [{ text: '✖️ Cancel', callback_data: `${CALLBACK_PREFIX}cancel` }]
];

const sendPicker = (bot: Bot, msg: ExtendedMessage): Promise<unknown> =>
    dao.getChatUsers(msg.chat.id).then(users => {
        if (users.length === 0) {
            return msg.reply('I haven\'t seen anyone in this chat yet.');
        }
        return bot.api.sendMessage({
            chat_id: msg.chat.id,
            text: 'Whose Steam ID(s) do you want to set?',
            reply_parameters: { message_id: msg.message_id },
            reply_markup: { inline_keyboard: pickerKeyboard(users) }
        });
    });

export default (bot: Bot, msg: ExtendedMessage): void => {
    const admin: boolean = isAdmin(msg.from?.id);
    const ref: TargetRef | undefined = leadingTarget(msg);

    if (ref) {
        if (!admin || !msg.from) {
            msg.reply(ADMIN_ONLY);
            return;
        }
        const adminId: number = msg.from.id;
        resolveTarget(msg, ref)
            .then((target): Promise<unknown> => {
                if (!target) {
                    // Only an @username can fail to resolve; a tapped mention carries the user itself.
                    const who: string = 'username' in ref ? `@${ref.username}` : 'that user';
                    return msg.reply(`I can't tell who ${who} is. They need to have sent a message where I can see it.`);
                }
                return setForTarget(target, ref.rest, text => msg.reply(text), adminId);
            })
            .catch((err: Error) => msg.reply(formatError(err)));
        return;
    }

    const argument: string = msg.command?.argument || '';
    if (admin && argument === '') {
        sendPicker(bot, msg).catch((err: Error) => msg.reply(formatError(err)));
        return;
    }

    const { ids, valid } = parseAndValidate(argument);
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

// Handle a tap on the user picker. Re-checks the admin gate (buttons are visible to the whole chat).
// Picking a user closes the picker and sends a force-reply prompt; the admin's reply to that prompt
// is picked up by handleSteamIdReply.
export const handleSteamIdCallback = (bot: Bot, query: CallbackQuery): void => {
    const data = query.data;
    const message = query.message;
    if (!data || !data.startsWith(CALLBACK_PREFIX) || !message) {
        return;
    }

    const answer = (text?: string): Promise<unknown> =>
        bot.api.answerCallbackQuery({ callback_query_id: query.id, ...(text ? { text } : {}) }).catch(() => undefined);
    const closePicker = (text: string): Promise<unknown> =>
        bot.api.editMessageText({ text, chat_id: message.chat.id, message_id: message.message_id })
            .catch((err: Error) => console.error(`Failed to edit Steam ID picker ${message.message_id}:`, err));

    const arg = data.substring(CALLBACK_PREFIX.length);
    if (!isAdmin(query.from?.id)) {
        answer(ADMIN_ONLY);
        return;
    } else if (arg === 'cancel') {
        closePicker('Cancelled.').then(() => answer());
        return;
    }

    const pick = arg.match(/^pick:(-?\d+)$/);
    if (!pick) {
        answer();
        return;
    }
    const user_id = Number(pick[1]);

    dao.getChatUsers(message.chat.id)
        .then(users => {
            const name: string = users.find(u => u.user_id === user_id)?.name ?? String(user_id);
            // Reply to the admin's command so the selective force-reply only pops up for them.
            const commandMessageId: number | undefined = 'reply_to_message' in message ? message.reply_to_message?.message_id : undefined;
            return closePicker(`Setting Steam ID(s) for ${name}.`)
                .then(() => bot.api.sendMessage({
                    chat_id: message.chat.id,
                    ...messageText(fmt`Reply to this message with the Steam ID(s) for ${bold(name)} (SteamID64, comma-separated if multiple).`),
                    ...(commandMessageId ? { reply_parameters: { message_id: commandMessageId, allow_sending_without_reply: true } } : {}),
                    reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'SteamID64' }
                }))
                .then(prompt => {
                    pendingPrompts.set(promptKey(message.chat.id, prompt.message_id), { user_id, name });
                    return answer();
                });
        })
        .catch((err: Error) => {
            console.error(`Error handling Steam ID picker tap for user ${user_id}:`, err);
            answer('Something went wrong.');
        });
};

// Handle the admin's reply to a picker prompt. Returns whether the message was consumed, so the caller
// can skip normal command routing. Invalid IDs leave the prompt open for another try.
export const handleSteamIdReply = (bot: Bot, msg: Message): boolean => {
    const replyTo: Message | undefined = msg.reply_to_message;
    if (!replyTo || !msg.text || msg.text.startsWith('/') || !isAdmin(msg.from?.id)) {
        return false;
    }
    const key: string = promptKey(msg.chat.id, replyTo.message_id);
    const target: Target | undefined = pendingPrompts.get(key);
    if (!target) {
        return false;
    }

    const reply = (text: Part): Promise<Message> => bot.api.sendMessage({
        chat_id: msg.chat.id,
        ...messageText(text),
        reply_parameters: { message_id: msg.message_id }
    });
    setForTarget(target, msg.text, reply, msg.from!.id)
        .then(done => {
            if (done) {
                pendingPrompts.delete(key);
            }
        })
        .catch((err: Error) => reply(formatError(err)).catch(() => undefined));
    return true;
};
