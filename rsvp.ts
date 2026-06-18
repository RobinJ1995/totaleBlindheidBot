import TelegramBot from 'node-telegram-bot-api';
import { escapeMarkdown } from './utils';
import { Rsvp, RsvpEntry } from './dao/DAO';

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

export {
    keyboard,
    parseMention,
    displayName,
    resolve,
    renderLists,
    renderMessage
};
