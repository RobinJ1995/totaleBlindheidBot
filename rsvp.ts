import TelegramBot from 'node-telegram-bot-api';
import { escapeMarkdown } from './utils';
import RsvpDAO, { Rsvp, RsvpEntry } from './dao/RsvpDAO';

export type RsvpKeyboardKind = 'schedule' | 'rollcall';

const LABELS: Record<RsvpKeyboardKind, Record<Rsvp, string>> = {
    schedule: { yes: "I'm in", maybe: 'Maybe', no: 'No' },
    rollcall: { yes: 'Joining', maybe: 'Maybe later', no: 'No' }
};

const RSVP_EMOJI: Record<Rsvp, string> = {
    yes: '🙋‍♂️',
    maybe: '🤷‍♂️',
    no: '🙅‍♂️'
};

// Build the inline keyboard for a message. The callback data is the same regardless
// of the keyboard kind; only the visible labels differ.
const keyboard = (kind: RsvpKeyboardKind): TelegramBot.InlineKeyboardMarkup => ({
    inline_keyboard: [
        (['yes', 'maybe', 'no'] as Rsvp[]).map(value => ({
            text: LABELS[kind][value],
            callback_data: `rsvp:${value}`
        }))
    ]
});

interface ParsedMention {
    id?: number;
    username?: string; // without leading @
    display: string;
}

// A rotation player is stored either as `[Name](tg://user?id=123)` (text mention, has an id)
// or as a plain `@username` string. Extract what we can to match against button tappers.
const parseMention = (mention: string): ParsedMention => {
    const match: RegExpMatchArray | null = mention.match(/^\[(.*)\]\(tg:\/\/user\?id=(\d+)\)$/);
    if (match) {
        return { id: Number(match[2]), display: match[1] };
    }

    if (mention.startsWith('@')) {
        return { username: mention.substring(1), display: mention };
    }

    return { display: mention };
};

// Render a name so that it shows up in the message without pinging the user
// (zero-width space breaks the @mention), matching command/admin/rollcall_get_players.ts.
const displayName = (name: string): string => escapeMarkdown(name).replace('@', '@​');

interface ResolvedPerson {
    rsvp: Rsvp;
    name: string;
    // The original rotation mention string, if this person is a rotation player.
    mention?: string;
}

export interface RsvpGroups {
    groups: Record<Rsvp, string[]>; // display names per rsvp value
    mentions: string[];             // rotation mention strings whose rsvp != 'no'
}

// Combine the live rotation roster with the explicit entries on the RSVP list.
// Rotation players default to 'maybe'; explicit entries (incl. the seeded initiator)
// override, and non-rotation tappers are appended as extra people.
const resolve = (rotation: string[], entries: Record<string, RsvpEntry>): RsvpGroups => {
    const people: ResolvedPerson[] = [];
    const byId: Map<number, ResolvedPerson> = new Map();
    const byUsername: Map<string, ResolvedPerson> = new Map();

    rotation.forEach(mention => {
        const parsed = parseMention(mention);
        const person: ResolvedPerson = { rsvp: 'maybe', name: parsed.display, mention };
        people.push(person);
        if (parsed.id !== undefined) {
            byId.set(parsed.id, person);
        }
        if (parsed.username) {
            byUsername.set(parsed.username.toLowerCase(), person);
        }
    });

    Object.values(entries).forEach(entry => {
        const matched: ResolvedPerson | undefined =
            byId.get(entry.user_id) ||
            (entry.username ? byUsername.get(entry.username.toLowerCase()) : undefined);

        if (matched) {
            matched.rsvp = entry.rsvp;
        } else {
            people.push({ rsvp: entry.rsvp, name: entry.name });
        }
    });

    const groups: Record<Rsvp, string[]> = { yes: [], maybe: [], no: [] };
    const mentions: string[] = [];
    people.forEach(person => {
        groups[person.rsvp].push(displayName(person.name));
        if (person.mention && person.rsvp !== 'no') {
            mentions.push(person.mention);
        }
    });

    return { groups, mentions };
};

// Build the 🙋‍♂️/🤷‍♂️/🙅‍♂️ block, omitting any group that has no members.
const renderLists = (groups: Record<Rsvp, string[]>): string =>
    (['yes', 'maybe', 'no'] as Rsvp[])
        .filter(value => groups[value].length > 0)
        .map(value => `${RSVP_EMOJI[value]} ${groups[value].join(' ')}`)
        .join('\n');

const renderMessage = (baseText: string, groups: Record<Rsvp, string[]>): string => {
    const lists: string = renderLists(groups);
    return lists ? `${baseText}\n\n${lists}` : baseText;
};

// Build an RSVP entry from a Telegram user (used when seeding the initiator and when
// recording a button tap).
const entryFromUser = (user: TelegramBot.User, rsvp: Rsvp): RsvpEntry => ({
    user_id: user.id,
    name: user.first_name || user.username || 'someone',
    username: user.username,
    rsvp
});

// Strip the buttons from every message attached to a list and delete it, so its now-stale
// confirmation can no longer record responses. Used when rescheduling or cancelling.
const retireRsvpList = (bot: TelegramBot, dao: RsvpDAO, rsvp_id: number): Promise<void> =>
    dao.getRsvpList(rsvp_id).then(list => {
        const strips: Promise<unknown>[] = list
            ? list.messages.map(ref => bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                { chat_id: list.chat_id, message_id: ref.message_id }
            ).catch(() => undefined))
            : [];
        return Promise.all(strips).then(() => dao.deleteRsvpList(rsvp_id));
    });

export {
    keyboard,
    parseMention,
    displayName,
    resolve,
    renderLists,
    renderMessage,
    entryFromUser,
    retireRsvpList
};
