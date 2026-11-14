import { Bot, MessageReactionUpdated, ReactionType } from 'node-telegram-bot-api';
import DiscordService from './discord/DiscordService.js';
import RelayedMessageDAO, { MessageRef, RelayedMessage } from './dao/RelayedMessageDAO.js';
import RelayedReactionDAO, { RelayedReaction } from './dao/RelayedReactionDAO.js';
import UserDAO, { User } from './dao/UserDAO.js';

// The emoji bots may react with on Telegram (https://core.telegram.org/bots/api#reactiontypeemoji).
const TELEGRAM_REACTIONS: Set<string> = new Set([
    '❤', '👍', '👎', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱', '🤬', '😢', '🎉', '🤩', '🤮', '💩', '🙏', '👌', '🕊',
    '🤡', '🥱', '🥴', '😍', '🐳', '❤‍🔥', '🌚', '🌭', '💯', '🤣', '⚡', '🍌', '🏆', '💔', '🤨', '😐', '🍓', '🍾', '💋',
    '🖕', '😈', '😴', '😭', '🤓', '👻', '👨‍💻', '👀', '🎃', '🙈', '😇', '😨', '🤝', '✍', '🤗', '🫡', '🎅', '🎄', '☃',
    '💅', '🤪', '🗿', '🆒', '💘', '🙉', '🦄', '😘', '💊', '🙊', '😎', '👾', '🤷‍♂', '🤷', '🤷‍♀', '😡'
]);

// Discord only accepts these with the emoji presentation selector, which Telegram leaves out.
const DISCORD_FORMS: Record<string, string> = {
    '❤': '❤️', '❤‍🔥': '❤️‍🔥', '🕊': '🕊️', '✍': '✍️', '☃': '☃️', '🤷‍♂': '🤷‍♂️', '🤷‍♀': '🤷‍♀️'
};

// Reactions are stored in their Discord form.
export const discordEmoji = (telegram: string): string => DISCORD_FORMS[telegram] ?? telegram;

export const telegramEmoji = (discord: string): string | undefined => {
    const emoji = discord.replace(/️/g, '');
    return TELEGRAM_REACTIONS.has(emoji) ? emoji : undefined;
};

export interface ReactionChange {
    ref: MessageRef;
    user_ref: string;
    added: string[];
    removed: string[];
}

// Custom and paid reactions have no counterpart on Discord.
const emojiOf = (reactions: ReactionType[]): string[] =>
    reactions.flatMap(reaction => 'emoji' in reaction ? [discordEmoji(reaction.emoji)] : []);

export const telegramReactionChange = (update: MessageReactionUpdated): ReactionChange | undefined => {
    const reactor = update.user ?? update.actor_chat;
    if (!reactor || update.user?.is_bot) {
        return undefined;
    }
    const before = emojiOf(update.old_reaction);
    const after = emojiOf(update.new_reaction);
    return {
        ref: { platform: 'telegram', chat_id: String(update.chat.id), message_id: String(update.message_id) },
        user_ref: `telegram:${reactor.id}`,
        added: after.filter(e => !before.includes(e)),
        removed: before.filter(e => !after.includes(e))
    };
};

export interface PersonReaction {
    relayed_id: number;
    person: string;
    emoji: string;
}

// The reactions each copy of a relayed message shows from the others, counting a person once. The
// sender's reactions are left out, as is an emoji a person already placed on that copy themselves.
export class ReactionTally {
    constructor(private reactions: PersonReaction[], private author?: string) {}

    // Most used first.
    shownOn(relayed_id: number): string[] {
        const own = new Set(this.reactions.filter(r => r.relayed_id === relayed_id).map(r => `${r.person} ${r.emoji}`));
        const people = this.reactions
            .filter(r => r.relayed_id !== relayed_id && r.person !== this.author && !own.has(`${r.person} ${r.emoji}`))
            .reduce((acc, r) => acc.set(r.emoji, (acc.get(r.emoji) ?? new Set<string>()).add(r.person)), new Map<string, Set<string>>());
        return [...people.entries()]
            .sort(([a, x], [b, y]) => y.size - x.size || (a < b ? -1 : a > b ? 1 : 0))
            .map(([emoji]) => emoji);
    }
}

// Maps `<platform>:<id>` refs to one key per person, so linked Telegram and Discord accounts match.
export class People {
    private users: UserDAO = new UserDAO();

    async resolver(refs: string[]): Promise<(ref: string) => string> {
        const idsOn = (platform: string): string[] =>
            refs.filter(ref => ref.startsWith(`${platform}:`)).map(ref => ref.slice(platform.length + 1));
        const [telegram, discord] = await Promise.all([
            this.users.getUsersByTelegramIds(idsOn('telegram').map(Number)),
            this.users.getUsersByDiscordIds(idsOn('discord'))
        ]);
        return ref => {
            const [platform, id] = ref.split(':');
            const user: User | undefined = platform === 'telegram' ? telegram[Number(id)] : discord[id];
            return user ? `user:${user.id}` : ref;
        };
    }
}

// Each copy of a relayed message shows the reactions from the others: every emoji on Discord, where
// the bot adds its own reaction, and only the most used one on Telegram, where a bot gets one.
class ReactionMirror {
    private messages: RelayedMessageDAO = new RelayedMessageDAO();
    private reactions: RelayedReactionDAO = new RelayedReactionDAO();
    private people: People = new People();

    constructor(private bot: Bot) {}

    async apply(change: ReactionChange): Promise<void> {
        const message: RelayedMessage | undefined = await this.messages.find(change.ref);
        if (!message || (change.added.length === 0 && change.removed.length === 0)) {
            return;
        }
        const group: RelayedMessage[] = await this.messages.group(message);
        const before: RelayedReaction[] = await this.reactions.ofGroup(group[0].id);
        await this.reactions.add(message.id, change.user_ref, change.added);
        await this.reactions.remove(message.id, change.user_ref, change.removed);
        const after: RelayedReaction[] = await this.reactions.ofGroup(group[0].id);

        const author: string | undefined = group[0].author_ref;
        const person = await this.people.resolver([...before, ...after].map(r => r.user_ref).concat(author ?? []));
        const tally = (reactions: RelayedReaction[]): ReactionTally =>
            new ReactionTally(reactions.map(r => ({ relayed_id: r.relayed_id, person: person(r.user_ref), emoji: r.emoji })), author && person(author));
        const [was, is] = [tally(before), tally(after)];
        await Promise.all(group
            .filter(target => target.kind !== 'extra')
            .map(target => this.reflect(target, was.shownOn(target.id), is.shownOn(target.id))
                .catch((err: Error) => console.error(`Could not mirror reactions onto ${target.platform} message ${target.message_id}:`, err))));
    }

    private async reflect(target: RelayedMessage, before: string[], after: string[]): Promise<void> {
        if (target.platform === 'telegram') {
            const top = (shown: string[]): string | undefined => shown.map(telegramEmoji).find(e => e !== undefined);
            const emoji: string | undefined = top(after);
            if (emoji !== top(before)) {
                await this.bot.api.setMessageReaction({
                    chat_id: Number(target.chat_id),
                    message_id: Number(target.message_id),
                    reaction: emoji ? [{ type: 'emoji', emoji }] : []
                });
            }
            return;
        }
        const discord: DiscordService | null = DiscordService.instance;
        await Promise.all([
            ...after.filter(e => !before.includes(e)).map(e => discord?.setOwnReaction(target.chat_id, target.message_id, e, true)),
            ...before.filter(e => !after.includes(e)).map(e => discord?.setOwnReaction(target.chat_id, target.message_id, e, false))
        ]);
    }
}

export default ReactionMirror;
