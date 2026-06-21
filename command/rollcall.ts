import TelegramBot, { Message, User } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter.js';
import { pickRandom, escapeMarkdown } from '../utils.js';
import RollcallPlayerDAO from '../dao/RollcallPlayerDAO.js';
import RsvpDAO, { RsvpEntry } from '../dao/RsvpDAO.js';
import { keyboard, resolve, renderMessage, entryFromUser } from '../rsvp.js';

const rollcallPlayerDao = new RollcallPlayerDAO();
const rsvpDao = new RsvpDAO();

const QUOTES: string[] = [
    "Are we rushin' in, or are we going' sneaky-beaky like?",
    "Bingo, bango, bongo, bish, bash, bosh!",
    "Easy peasy, lemon squeezy!",
    "Grab your gear and let's go!",
    "RUSH B DON'T STOP"
];

interface ExecuteRollcallOptions {
    reply_to_message_id?: number;
    // The user who triggered the rollcall; seeded into the "yes" list for a fresh list.
    initiator?: User;
    // When set, the rollcall attaches to (shares) this existing RSVP list instead of
    // creating a fresh one. Used when a schedule triggers the rollcall.
    rsvp_id?: number;
}

const executeRollcall = (bot: TelegramBot, chat_id: number, opts: ExecuteRollcallOptions = {}): Promise<Message> => {
    return Promise.all([
        rollcallPlayerDao.getRollcallPlayerUsernames(chat_id),
        opts.rsvp_id ? rsvpDao.getRsvpList(opts.rsvp_id) : Promise.resolve(undefined)
    ]).then(([rotation, existing]) => {
        // Inherit the shared list's entries when triggered by a schedule; otherwise seed
        // a fresh list with the initiator marked as joining.
        const entries: Record<string, RsvpEntry> = existing ? existing.entries : {};
        if (!existing && opts.initiator) {
            entries[opts.initiator.id] = entryFromUser(opts.initiator, 'yes');
        }

        const { groups, mentions } = resolve(rotation, entries);
        // The ping line is baked in at send time: anyone who said "no" is dropped here.
        const baseText: string = `${pickRandom(QUOTES)}\n${mentions.join(' ')}`;

        return bot.sendMessage(chat_id, renderMessage(baseText, groups), {
            // reply_parameters is only set for user-triggered rollcalls; scheduled ones
            // (no originating message) omit it entirely.
            ...(opts.reply_to_message_id ? { reply_parameters: { message_id: opts.reply_to_message_id } } : {}),
            parse_mode: 'Markdown',
            reply_markup: keyboard('rollcall')
        }).then((sent: Message) => {
            const ref = { message_id: sent.message_id, base_text: baseText, keyboard: 'rollcall' as const };
            const attach: Promise<unknown> = (existing && opts.rsvp_id)
                ? rsvpDao.addRsvpMessage(opts.rsvp_id, ref)
                : rsvpDao.createRsvpList({ chat_id, entries, messages: [ref] });
            return attach.then(() => sent);
        });
    });
};

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    executeRollcall(bot, msg.chat.id, {
        reply_to_message_id: msg.message_id,
        initiator: msg.from
    }).catch((err: Error) => msg.reply(`*${escapeMarkdown(err.toString())}*`));
};

export { executeRollcall };
