import { Bot, CallbackQuery, Message } from 'node-telegram-bot-api';
import { Command, ExtendedMessage } from '../MessageRouter.js';
import UserDAO, { userDisplayName } from '../dao/UserDAO.js';
import { formatError } from '../utils.js';
import { asFormatted, Formatted, Part } from '../format.js';
import { broadcast } from '../messenger.js';
import { toDiscordMarkdown } from '../discord/markdown.js';
import UserReferenceResolver from '../UserReferenceResolver.js';
import UserPicker from '../UserPicker.js';
import SteamService, { FriendRequests } from '../SteamService.js';
import { isBotAdmin } from '../admin.js';

const dao = new UserDAO();
const resolver = new UserReferenceResolver(dao);

export const CALLBACK_PREFIX = 'steamid:';
const picker = new UserPicker(CALLBACK_PREFIX);

const ADMIN_ONLY = 'Only the admin can set Steam IDs for other users.';
const SPECIFY_IDS = 'Please specify your Steam user ID(s) as SteamID64 (the 17-digit number starting with 7656), separated by commas if multiple.';

// "<chat_id>:<picker message_id>" -> the user the admin's reply to that message sets Steam IDs for.
const prompts: Map<string, { user_id: number, name: string }> = new Map();

const parseIds = (arg: string): string[] | null => {
    const ids: string[] = arg.split(',').map(s => s.trim()).filter(s => s.length > 0);
    return ids.length > 0 && ids.every(id => /^\d{17}$/.test(id)) ? ids : null;
};

// Befriends the accounts on Steam and says what came of it; nothing when they are friends already.
const friendNote = async (ids: string[]): Promise<string> => {
    const steam: SteamService | null = SteamService.instance;
    if (!steam) {
        return '';
    }
    const { requested, accepted, pending, failed }: FriendRequests = await steam.befriend(ids);
    const asked: string[] = [...requested, ...pending];
    const notes: string[] = [
        asked.length > 0 ? `I've sent a Steam friend request to ${asked.join(', ')}. I can see their games once it is accepted.` : '',
        accepted.length > 0 ? `I've accepted the Steam friend request from ${accepted.join(', ')}.` : '',
        failed.length > 0 ? `I couldn't send a Steam friend request to ${failed.join(', ')}. Add me on Steam instead: ${steam.profileUrl()}` : ''
    ].filter(note => note !== '');
    return notes.length > 0 ? `\n\n${notes.join('\n')}` : '';
};

const setForUser = (user_id: number, name: string, idsArg: string, reply: (text: Part) => Promise<unknown>): Promise<boolean> => {
    const ids = parseIds(idsArg);
    if (!ids) {
        return reply('Invalid Steam ID(s). Each must be a 17-digit number (SteamID64) starting with 7656.').then(() => false);
    }
    return dao.setSteamUserId(user_id, ids)
        .then(() => friendNote(ids))
        .then(note => reply(`Steam user ID(s) for ${name} has been set to ${ids.join(', ')}${note}`))
        .then(() => true);
};

// On Discord, people set their own IDs; setting them for someone else stays a Telegram admin command.
export default (bot: Bot, cmd: Command): void | Promise<unknown> => {
    if (cmd.platform === 'telegram') {
        return handleTelegram(bot, cmd as ExtendedMessage);
    }
    const ids = parseIds(cmd.command.argument);
    if (!ids) {
        return cmd.reply(SPECIFY_IDS);
    }
    return dao.setSteamUserId(cmd.user.id, ids)
        .then(() => friendNote(ids))
        .then(note => cmd.reply(`Your Steam user ID(s) has been set to ${ids.join(', ')}${note}`))
        .catch((err: Error) => cmd.reply(formatError(err)));
};

const handleTelegram = (bot: Bot, msg: ExtendedMessage): void => {
    const [first = '', ...rest] = msg.command.argumentTokens;
    const mention = msg.entities?.find(e => e.type === 'text_mention' && e.user);
    const admin: boolean = isBotAdmin(msg.from?.id);
    // Anything but Steam IDs in front of more arguments names whose IDs those are.
    const namesSomeone: boolean = rest.length > 0 && !/^[\d,]+$/.test(first);

    if (mention?.user || namesSomeone) {
        if (!admin) {
            msg.reply(ADMIN_ONLY);
            return;
        }
        const reply = (text: Part) => msg.reply(text);
        const done: Promise<unknown> = mention?.user
            ? dao.fromTelegram(mention.user).then(user => setForUser(user.id, mention.user!.first_name, msg.text!.slice(mention.offset + mention.length), reply))
            : resolver.resolve(msg.chat.id, first).then((user): Promise<unknown> => user === undefined
                ? msg.reply(UserReferenceResolver.unknown(first))
                : setForUser(user.id, first.startsWith('@') ? first : userDisplayName(user), rest.join(' '), reply));
        done.catch((err: Error) => msg.reply(formatError(err)));
        return;
    } else if (admin && msg.command.argument === '') {
        dao.getChatUsers(msg.chat.id)
            .then(users => picker.ask(bot, msg, 'Whose Steam ID(s) do you want to set?', UserPicker.options(users)))
            .catch((err: Error) => msg.reply(formatError(err)));
        return;
    }

    const ids = parseIds(msg.command.argument);
    if (!ids) {
        msg.reply(SPECIFY_IDS);
        return;
    }

    const user_id: number = msg.user.id;
    console.log(`User ${user_id} set Steam ID(s) to ${ids.join(', ')}`);
    dao.setSteamUserId(user_id, ids)
        .then(() => friendNote(ids))
        .then(note => msg.reply(`Your Steam user ID(s) has been set to ${ids.join(', ')}${note}`))
        .catch((err: Error) => msg.reply(formatError(err)));
};

export const handleSteamIdCallback = (bot: Bot, query: CallbackQuery): void => {
    const message = query.message;
    if (!message || !query.data) {
        return;
    } else if (!isBotAdmin(query.from.id)) {
        bot.api.answerCallbackQuery({ callback_query_id: query.id, text: ADMIN_ONLY }).catch(() => undefined);
        return;
    }

    const user_id = picker.picked(query);
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
    if (!target || !msg.text || !isBotAdmin(msg.from?.id)) {
        return false;
    }

    const reply = (text: Part) => {
        const formatted: Formatted = asFormatted(text);
        return broadcast(bot, { chat_id: msg.chat.id }, formatted, toDiscordMarkdown(formatted), { replyTo: msg.message_id });
    };
    setForUser(target.user_id, target.name, msg.text, reply)
        .then(done => done && prompts.delete(key))
        .catch((err: Error) => reply(formatError(err)));
    return true;
};
