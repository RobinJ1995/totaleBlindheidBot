import { InlineKeyboardMarkup, User } from 'node-telegram-bot-api';
import { fmt, Formatted, link, Part } from './format.js';
import { Rsvp, RsvpEntry } from './dao/RsvpDAO.js';

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

const BUTTON_STYLE: Record<Rsvp, string> = {
    yes: 'success',
    maybe: 'primary',
    no: 'danger'
};

// Build the inline keyboard for a message. The callback data is the same regardless
// of the keyboard kind; only the visible labels differ.
const keyboard = (kind: RsvpKeyboardKind): InlineKeyboardMarkup => ({
    inline_keyboard: [
        (['yes', 'maybe', 'no'] as Rsvp[]).map(value => ({
            text: LABELS[kind][value],
            style: BUTTON_STYLE[value],
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
    } else if (mention.startsWith('@')) {
        return { username: mention.substring(1), display: mention };
    }

    return { display: mention };
};

// Render a name so that it shows up in the message without pinging the user
// (zero-width space breaks the @mention), matching command/admin/rollcall_get_players.ts.
const displayName = (name: string): string => name.replace('@', '@​');

// Build a pingable mention for the tag line from a stored rotation entry.
const mentionText = (mention: string): Part => {
    const match: RegExpMatchArray | null = mention.match(/^\[(.*)\]\(tg:\/\/user\?id=(\d+)\)$/);
    if (match) {
        return link(match[1], `tg://user?id=${match[2]}`);
    }
    return mention;
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
    tagged: string[];               // rotation mention strings whose rsvp != 'no'
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
    const tagged: string[] = [];
    people.forEach(person => {
        // Only people who have actually made a selection appear in the lists.
        if (person.rsvp) {
            groups[person.rsvp].push(displayName(person.name));
        }
        // Tag every rotation player except those who explicitly opted out.
        if (person.mention && person.rsvp !== 'no') {
            tagged.push(person.mention);
        }
    });

    return { groups, tagged };
};

// Build the 🙋‍♂️/🤷‍♂️/🙅‍♂️ block, omitting any group that has no members.
const renderLists = (groups: Record<Rsvp, string[]>): string =>
    (['yes', 'maybe', 'no'] as Rsvp[])
        .filter(value => groups[value].length > 0)
        .map(value => `${RSVP_EMOJI[value]} ${groups[value].join(' ')}`)
        .join('\n');

const renderMessage = (base: Formatted, groups: Record<Rsvp, string[]>): Formatted => {
    const lists: string = renderLists(groups);
    return lists ? fmt`${base}\n\n${lists}` : base;
};

// Build an RSVP entry from a Telegram user (used when seeding the initiator and when
// recording a button tap).
const entryFromUser = (user: User, rsvp: Rsvp): RsvpEntry => ({
    user_id: user.id,
    name: user.first_name || user.username || 'someone',
    username: user.username,
    rsvp
});

export {
    keyboard,
    parseMention,
    displayName,
    mentionText,
    resolve,
    renderLists,
    renderMessage,
    entryFromUser
};
