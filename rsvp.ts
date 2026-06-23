import TelegramBot, { InlineKeyboardMarkup, User } from 'node-telegram-bot-api';
import { escapeMarkdown } from './utils.js';
import RsvpDAO, { Rsvp, RsvpEntry } from './dao/RsvpDAO.js';

export type RsvpKeyboardKind = 'schedule' | 'rollcall';

const LABELS: Record<RsvpKeyboardKind, Record<Rsvp, string>> = {
    schedule: { yes: "I'm in", maybe: 'Maybe', no: 'No' },
    rollcall: { yes: 'Joining', maybe: 'Maybe/Later', no: 'No' }
};

const RSVP_EMOJI: Record<Rsvp, string> = {
    yes: '🙋‍♂️',
    maybe: '🤷‍♂️',
    no: '🙅‍♂️'
};

// Build the inline keyboard for a message. The callback data is the same regardless
// of the keyboard kind; only the visible labels differ.
const keyboard = (kind: RsvpKeyboardKind): InlineKeyboardMarkup => ({
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

// Build a Markdown-safe pingable mention for the tag line. A rotation entry is stored
// either as a `[name](tg://user?id=ID)` text-mention link or a plain `@username`. The line
// is baked into a `parse_mode: 'Markdown'` message, so escape the visible text — otherwise a
// name with a Markdown metacharacter (e.g. `Foo_Bar`) makes Telegram reject the message.
const mentionMarkdown = (mention: string): string => {
    const match: RegExpMatchArray | null = mention.match(/^\[(.*)\]\(tg:\/\/user\?id=(\d+)\)$/);
    if (match) {
        return `[${escapeMarkdown(match[1])}](tg://user?id=${match[2]})`;
    }
    return escapeMarkdown(mention);
};

interface ResolvedPerson {
    // Undefined until the person makes a selection: players are uncategorised by default.
    rsvp?: Rsvp;
    name: string;
    // The original rotation mention string, if this person is a rotation player.
    mention?: string;
}

export interface RsvpGroups {
    groups: Record<Rsvp, string[]>; // display names per rsvp value (only those who chose)
    mentions: string[];             // rotation mention strings whose rsvp != 'no'
}

// Combine the live rotation roster with the explicit entries on the RSVP list.
// Players are uncategorised until they tap a button; explicit entries (incl. the seeded
// initiator) place them into yes/maybe/no, and non-rotation tappers are appended as extra
// people. Every rotation player is still tagged in the mention line unless they opted out.
const resolve = (rotation: string[], entries: Record<string, RsvpEntry>): RsvpGroups => {
    const people: ResolvedPerson[] = [];
    const byId: Map<number, ResolvedPerson> = new Map();
    const byUsername: Map<string, ResolvedPerson> = new Map();

    rotation.forEach(mention => {
        const parsed = parseMention(mention);
        const person: ResolvedPerson = { name: parsed.display, mention };
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
        // Only people who have actually made a selection appear in the lists.
        if (person.rsvp) {
            groups[person.rsvp].push(displayName(person.name));
        }
        // Tag every rotation player except those who explicitly opted out.
        if (person.mention && person.rsvp !== 'no') {
            mentions.push(mentionMarkdown(person.mention));
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
const entryFromUser = (user: User, rsvp: Rsvp): RsvpEntry => ({
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
