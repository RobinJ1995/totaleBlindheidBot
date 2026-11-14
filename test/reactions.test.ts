import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { Bot, MessageReactionUpdated } from 'node-telegram-bot-api';
import RelayedMessageDAO, { RelayedMessage } from '../dao/RelayedMessageDAO.js';
import RelayedReactionDAO, { RelayedReaction } from '../dao/RelayedReactionDAO.js';
import UserDAO, { User } from '../dao/UserDAO.js';
import DiscordService from '../discord/DiscordService.js';
import ReactionMirror, { discordEmoji, People, PersonReaction, ReactionChange, ReactionTally, telegramEmoji, telegramReactionChange } from '../reactions.js';

const update = (fields: Partial<MessageReactionUpdated>): MessageReactionUpdated => ({
    chat: { id: -100, type: 'supergroup' },
    message_id: 7,
    user: { id: 5, is_bot: false, first_name: 'Ann' },
    date: 0,
    old_reaction: [],
    new_reaction: [],
    ...fields
} as MessageReactionUpdated);

test('Telegram emoji Discord only accepts fully qualified get their presentation selector', () => {
    assert.equal(discordEmoji('❤'), '❤️');
    assert.equal(discordEmoji('❤‍🔥'), '❤️‍🔥');
    assert.equal(discordEmoji('🤷‍♀'), '🤷‍♀️');
    assert.equal(discordEmoji('👍'), '👍');
});

test('only emoji Telegram offers bots can go to Telegram, without the presentation selector', () => {
    assert.equal(telegramEmoji('❤️'), '❤');
    assert.equal(telegramEmoji('❤️‍🔥'), '❤‍🔥');
    assert.equal(telegramEmoji('🔥'), '🔥');
    assert.equal(telegramEmoji('🦀'), undefined);
});

test('a Telegram reaction update becomes what was added and taken back', () => {
    assert.deepEqual(telegramReactionChange(update({
        old_reaction: [{ type: 'emoji', emoji: '👍' }, { type: 'emoji', emoji: '🔥' }],
        new_reaction: [{ type: 'emoji', emoji: '🔥' }, { type: 'emoji', emoji: '❤' }]
    })), {
        ref: { platform: 'telegram', chat_id: '-100', message_id: '7' },
        user_ref: 'telegram:5',
        added: ['❤️'],
        removed: ['👍']
    });
});

test('custom and paid reactions are left out', () => {
    assert.deepEqual(telegramReactionChange(update({
        new_reaction: [{ type: 'custom_emoji', custom_emoji_id: '1' }, { type: 'paid' }]
    }))?.added, []);
});

test('anonymous admins react as their chat, and bots are ignored', () => {
    assert.equal(telegramReactionChange(update({ user: undefined, actor_chat: { id: -100, type: 'supergroup' } }))?.user_ref, 'telegram:-100');
    assert.equal(telegramReactionChange(update({ user: { id: 9, is_bot: true, first_name: 'Bot' } })), undefined);
    assert.equal(telegramReactionChange(update({ user: undefined })), undefined);
});

const reaction = (relayed_id: number, person: string, emoji: string): PersonReaction => ({ relayed_id, person, emoji });

test('a copy shows the reactions on the other copies, most used first', () => {
    const tally = new ReactionTally([reaction(1, 'a', '🔥'), reaction(2, 'b', '👍'), reaction(2, 'c', '👍'), reaction(3, 'd', '🔥'), reaction(3, 'e', '🎉')]);
    assert.deepEqual(tally.shownOn(3), ['👍', '🔥']);
    assert.deepEqual(tally.shownOn(4), ['👍', '🔥', '🎉']);
});

test('a person reacting alike on several copies counts once', () => {
    const tally = new ReactionTally([reaction(1, 'a', '🔥'), reaction(2, 'a', '🔥'), reaction(2, 'b', '👍'), reaction(1, 'c', '👍')]);
    assert.deepEqual(tally.shownOn(3), ['👍', '🔥']);
});

test('the sender\'s own reactions are not shown', () => {
    const tally = new ReactionTally([reaction(1, 'author', '🔥'), reaction(2, 'author', '👍'), reaction(1, 'b', '🎉')], 'author');
    assert.deepEqual(tally.shownOn(2), ['🎉']);
    assert.deepEqual(tally.shownOn(3), ['🎉']);
});

test('a reaction is not repeated on a copy where the same person placed it', () => {
    const tally = new ReactionTally([reaction(1, 'a', '🔥'), reaction(2, 'a', '🔥'), reaction(1, 'a', '👍')]);
    assert.deepEqual(tally.shownOn(2), ['👍']);
    assert.deepEqual(tally.shownOn(1), []);
});

const linked: User = { id: 7, telegram_id: 5, discord_id: '900' };

const knownUsers = (): void => {
    mock.method(UserDAO.prototype, 'getUsersByTelegramIds', async (ids: number[]) => ids.includes(5) ? { 5: linked } : {});
    mock.method(UserDAO.prototype, 'getUsersByDiscordIds', async (ids: string[]) => ids.includes('900') ? { 900: linked } : {});
};

afterEach(() => {
    mock.restoreAll();
    DiscordService.instance = null;
});

test('linked accounts resolve to the same person, others keep their own ref', async () => {
    knownUsers();
    const person = await new People().resolver(['telegram:5', 'discord:900', 'telegram:6', 'discord:901']);
    assert.equal(person('telegram:5'), 'user:7');
    assert.equal(person('discord:900'), 'user:7');
    assert.equal(person('telegram:6'), 'telegram:6');
    assert.equal(person('discord:901'), 'discord:901');
});

// A Telegram original with one copy on each of two Discord channels.
const group: RelayedMessage[] = [
    { id: 1, origin_id: null, kind: 'origin', author: 'Ann', author_ref: 'telegram:1', platform: 'telegram', chat_id: '-100', message_id: '10' },
    { id: 2, origin_id: 1, kind: 'webhook', author: null, platform: 'discord', chat_id: 'a', message_id: '20' },
    { id: 3, origin_id: 1, kind: 'webhook', author: null, platform: 'discord', chat_id: 'b', message_id: '30' }
];

const mirror = (stored: RelayedReaction[] = []) => {
    const calls: unknown[] = [];
    let reactions: RelayedReaction[] = [...stored];
    knownUsers();
    mock.method(RelayedMessageDAO.prototype, 'find', async (ref: { platform: string; message_id: string }) =>
        group.find(m => m.platform === ref.platform && m.message_id === ref.message_id));
    mock.method(RelayedMessageDAO.prototype, 'group', async () => group);
    mock.method(RelayedReactionDAO.prototype, 'ofGroup', async () => reactions);
    mock.method(RelayedReactionDAO.prototype, 'add', async (relayed_id: number, user_ref: string, emoji: string[]) => {
        reactions = [...reactions, ...emoji.map(e => ({ relayed_id, user_ref, emoji: e }))];
    });
    mock.method(RelayedReactionDAO.prototype, 'remove', async (relayed_id: number, user_ref: string, emoji: string[]) => {
        reactions = reactions.filter(r => !(r.relayed_id === relayed_id && r.user_ref === user_ref && emoji.includes(r.emoji)));
    });
    DiscordService.instance = {
        setOwnReaction: async (channel_id: string, message_id: string, emoji: string, on: boolean) => calls.push(['discord', message_id, emoji, on])
    } as unknown as DiscordService;
    const bot = { api: { setMessageReaction: async (params: { message_id: number; reaction: unknown[] }) => calls.push(['telegram', params.message_id, params.reaction]) } } as unknown as Bot;
    return { calls, mirror: new ReactionMirror(bot) };
};

const change = (platform: 'telegram' | 'discord', message_id: string, user_ref: string, added: string[], removed: string[] = []): ReactionChange =>
    ({ ref: { platform, chat_id: platform === 'telegram' ? '-100' : 'a', message_id }, user_ref, added, removed });

test('a reaction shows on every other copy', async () => {
    const { calls, mirror: m } = mirror();
    await m.apply(change('discord', '20', 'discord:800', ['🔥']));
    assert.deepEqual(calls, [['telegram', 10, [{ type: 'emoji', emoji: '🔥' }]], ['discord', '30', '🔥', true]]);
});

test('the sender reacting to their own message is not mirrored', async () => {
    const { calls, mirror: m } = mirror();
    await m.apply(change('telegram', '10', 'telegram:1', ['🔥']));
    assert.deepEqual(calls, []);
});

test('the sender reacting from their linked account on the other platform is not mirrored', async () => {
    group[0].author_ref = 'telegram:5';
    try {
        const { calls, mirror: m } = mirror();
        await m.apply(change('discord', '20', 'discord:900', ['🔥']));
        assert.deepEqual(calls, []);
    } finally {
        group[0].author_ref = 'telegram:1';
    }
});

test('a message without a known sender mirrors every reaction', async () => {
    group[0].author_ref = undefined;
    try {
        const { calls, mirror: m } = mirror();
        await m.apply(change('discord', '20', 'discord:800', ['🔥']));
        assert.deepEqual(calls, [['telegram', 10, [{ type: 'emoji', emoji: '🔥' }]], ['discord', '30', '🔥', true]]);
    } finally {
        group[0].author_ref = 'telegram:1';
    }
});

test('placing the bridged reaction yourself on another platform takes the bot\'s copy of it back there', async () => {
    const { calls, mirror: m } = mirror([{ relayed_id: 1, user_ref: 'telegram:5', emoji: '🔥' }]);
    await m.apply(change('discord', '20', 'discord:900', ['🔥']));
    assert.deepEqual(calls, [['discord', '20', '🔥', false]]);
});

test('taking back one of a person\'s duplicate reactions bridges the other one', async () => {
    const { calls, mirror: m } = mirror([{ relayed_id: 1, user_ref: 'telegram:5', emoji: '🔥' }, { relayed_id: 2, user_ref: 'discord:900', emoji: '🔥' }]);
    await m.apply(change('telegram', '10', 'telegram:5', [], ['🔥']));
    assert.deepEqual(calls, [['telegram', 10, [{ type: 'emoji', emoji: '🔥' }]]]);
});

test('the same emoji from different people is shown for each', async () => {
    const { calls, mirror: m } = mirror([{ relayed_id: 1, user_ref: 'telegram:6', emoji: '🔥' }]);
    await m.apply(change('discord', '20', 'discord:900', ['🔥']));
    assert.deepEqual(calls, [['telegram', 10, [{ type: 'emoji', emoji: '🔥' }]]]);
});

test('reactions on an unknown message or without a change are ignored', async () => {
    const { calls, mirror: m } = mirror();
    await m.apply(change('discord', '99', 'discord:800', ['🔥']));
    await m.apply(change('discord', '20', 'discord:800', []));
    assert.deepEqual(calls, []);
});
