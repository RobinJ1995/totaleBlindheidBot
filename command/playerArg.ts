import { Command, ExtendedMessage } from '../MessageRouter.js';
import GameHistoryDAO, { ChatPlayer } from '../dao/GameHistoryDAO.js';
import UserDAO from '../dao/UserDAO.js';
import { parseDiscordRef } from '../discord/users.js';

const userDao = new UserDAO();

// The user whose history a command should look at.
export interface PlayerTarget {
    user_id: number;
    // Set when a specific player was named; left undefined for the sender themselves, so callers
    // can phrase their replies in the second person ("your stats") versus naming the player.
    name?: string;
}

// A tapped Telegram mention (text_mention), resolved to the target's user id.
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
// empty argument means the sender. A bare word is matched case-insensitively against Telegram
// usernames, then display names, then Discord usernames; the first of those with a match wins.
// A leading @ matches Telegram usernames only, discord:<username> Discord usernames only.
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

    const discordOnly: string | undefined = parseDiscordRef(trimmed);
    const usernameOnly = trimmed.startsWith('@');
    const needle = discordOnly ?? (usernameOnly ? trimmed.slice(1) : trimmed).toLowerCase();
    const byTelegram: ChatPlayer[] = players.filter(p => p.username?.toLowerCase() === needle);
    const byDiscord: ChatPlayer[] = players.filter(p => p.discord_username?.toLowerCase() === needle);
    const byName: ChatPlayer[] = players.filter(p => p.name.toLowerCase() === needle);
    const tiers: ChatPlayer[][] = discordOnly !== undefined ? [byDiscord] : usernameOnly ? [byTelegram] : [byTelegram, byName, byDiscord];
    const matches: ChatPlayer[] = tiers.find(tier => tier.length > 0) ?? [];

    if (matches.length === 0) {
        return { kind: 'none', needle: trimmed };
    } else if (matches.length > 1) {
        // Append the username (when known) so two players sharing a display name can be told apart.
        const names = matches.map(m => m.username ? `${m.name} (@${m.username})` : m.name);
        return { kind: 'ambiguous', needle: trimmed, names };
    }
    return { kind: 'player', user_id: matches[0].user_id, name: matches[0].name };
};

// The tapped mention (if any) attached to the command, with its display text as the name.
export const textMention = async (msg: ExtendedMessage): Promise<MentionRef | undefined> => {
    const entity = (msg.entities || []).find(e => e.type === 'text_mention' && e.user);
    if (!entity?.user) {
        return undefined;
    }
    const argument = msg.command?.argument?.trim();
    const user = await userDao.fromTelegram(entity.user);
    return {
        user_id: user.id,
        name: argument || entity.user.first_name || String(entity.user.id)
    };
};

export type MatchedPlayer = Extract<PlayerMatch, { kind: 'player' }>;

// Every reading of `argument` as two players, split between words.
export const matchPlayerPairs = (players: ChatPlayer[], argument: string): [MatchedPlayer, MatchedPlayer][] => {
    const words = argument.trim().split(/\s+/);
    return words.slice(1)
        .map((_, i) => [words.slice(0, i + 1), words.slice(i + 1)].map(side => matchPlayerArgument(players, side.join(' '))))
        .filter((pair): pair is [MatchedPlayer, MatchedPlayer] => pair.every(match => match.kind === 'player'));
};

// A command's optional player argument matched against the chat roster, along with that roster.
export const matchCommandPlayer = async (dao: GameHistoryDAO, msg: Command): Promise<{ match: PlayerMatch; players: ChatPlayer[] }> => {
    const mention = msg.platform === 'telegram' ? await textMention(msg as ExtendedMessage) : undefined;
    const argument = msg.command?.argument ?? '';

    // No player named at all: the common case, so skip the roster lookup entirely.
    if (!mention && argument.trim() === '') {
        return { match: { kind: 'self' }, players: [] };
    }

    const players = mention ? [] : await dao.getChatPlayers(msg.chat_id);
    return { match: matchPlayerArgument(players, argument, mention), players };
};

// The user a match points at. Returns null and replies with the reason itself when it matches
// nothing or is ambiguous, so callers can simply bail out on null.
export const targetOrReply = async (msg: Command, match: PlayerMatch): Promise<PlayerTarget | null> => {
    const mismatch = mismatchReply(match);
    if (mismatch) {
        await msg.reply(mismatch);
        return null;
    }
    return match.kind === 'player' ? { user_id: match.user_id, name: match.name } : { user_id: msg.user.id };
};

export const resolvePlayerTarget = async (dao: GameHistoryDAO, msg: Command): Promise<PlayerTarget | null> =>
    targetOrReply(msg, (await matchCommandPlayer(dao, msg)).match);

// Why a player argument resolved to nobody, or null when it did resolve.
export const mismatchReply = (match: PlayerMatch): string | null => {
    switch (match.kind) {
        case 'none':
            return `I don't have any recorded games for "${match.needle}" in this chat.`;
        case 'ambiguous':
            return `"${match.needle}" matches multiple players: ${match.names.join(', ')}. Please be more specific.`;
        default:
            return null;
    }
};
