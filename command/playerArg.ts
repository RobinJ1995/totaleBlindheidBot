import { ExtendedMessage } from '../MessageRouter.js';
import GameHistoryDAO, { ChatPlayer } from '../dao/GameHistoryDAO.js';
import { escapeMarkdown } from '../utils.js';

// The user whose history a command should look at.
export interface PlayerTarget {
    user_id: number;
    // Set when a specific player was named; left undefined for the sender themselves, so callers
    // can phrase their replies in the second person ("your stats") versus naming the player.
    name?: string;
}

// A tapped Telegram mention (text_mention), which carries the target user id directly.
export interface MentionRef {
    user_id: number;
    name: string;
}

export type PlayerMatch =
    | { kind: 'self' }
    | { kind: 'player'; user_id: number; name: string }
    | { kind: 'none'; needle: string }
    | { kind: 'ambiguous'; needle: string; names: string[] };

// Match a free-text player argument against an already-fetched chat roster. Kept pure (no IO) so
// the matching rules can be unit-tested without a database. A tapped mention wins outright; an
// empty argument means the sender; otherwise the argument (with an optional leading @) is matched
// case-insensitively against each player's recorded display name and stored username.
export const matchPlayerArgument = (
    players: ChatPlayer[],
    argument: string,
    mention?: MentionRef
): PlayerMatch => {
    if (mention) {
        return { kind: 'player', user_id: mention.user_id, name: mention.name };
    }

    const trimmed = argument.trim();
    if (trimmed === '') {
        return { kind: 'self' };
    }

    const needle = trimmed.replace(/^@/, '').toLowerCase();
    const byUser = new Map<number, ChatPlayer>();
    for (const p of players) {
        if (p.name.toLowerCase() === needle || (p.username != null && p.username.toLowerCase() === needle)) {
            byUser.set(p.user_id, p);
        }
    }

    const matches = [...byUser.values()];
    if (matches.length === 0) {
        return { kind: 'none', needle: trimmed };
    }
    if (matches.length > 1) {
        // Append the username (when known) so two players sharing a display name can be told apart.
        const names = matches.map(m => m.username ? `${m.name} (@${m.username})` : m.name);
        return { kind: 'ambiguous', needle: trimmed, names };
    }
    return { kind: 'player', user_id: matches[0].user_id, name: matches[0].name };
};

// The tapped mention (if any) attached to the command, with its display text as the name.
export const textMention = (msg: ExtendedMessage): MentionRef | undefined => {
    const entity = (msg.entities || []).find(e => e.type === 'text_mention' && e.user);
    if (!entity?.user) return undefined;
    const argument = msg.command?.argument?.trim();
    return {
        user_id: entity.user.id,
        name: argument || entity.user.first_name || String(entity.user.id)
    };
};

// Resolve a command's optional player argument to the user whose history to show. Returns null and
// replies with the reason itself when the reference matches nothing or is ambiguous, so callers can
// simply bail out on null.
export const resolvePlayerTarget = async (dao: GameHistoryDAO, msg: ExtendedMessage): Promise<PlayerTarget | null> => {
    const mention = textMention(msg);
    const argument = msg.command?.argument ?? '';

    // No player named at all: the common case, so skip the roster lookup entirely.
    if (!mention && argument.trim() === '') {
        return { user_id: msg.from!.id };
    }

    const players = mention ? [] : await dao.getChatPlayers(msg.chat.id);
    const match = matchPlayerArgument(players, argument, mention);
    switch (match.kind) {
        case 'self':
            return { user_id: msg.from!.id };
        case 'player':
            return { user_id: match.user_id, name: match.name };
        case 'none':
            // needle and names are user/external input, rendered under Markdown parse mode.
            msg.reply(`I don't have any recorded games for "${escapeMarkdown(match.needle)}" in this chat.`);
            return null;
        case 'ambiguous':
            msg.reply(`"${escapeMarkdown(match.needle)}" matches multiple players: ${match.names.map(escapeMarkdown).join(', ')}. Please be more specific.`);
            return null;
    }
};
