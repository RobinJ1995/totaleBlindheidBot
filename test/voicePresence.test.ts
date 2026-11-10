import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import ChatLinkDAO, { ChatLink } from '../dao/ChatLinkDAO.js';
import RollcallPlayerDAO from '../dao/RollcallPlayerDAO.js';
import UserDAO, { User } from '../dao/UserDAO.js';
import DiscordService, { VoiceMember } from '../discord/DiscordService.js';
import VoicePresence, { VoiceGateway } from '../discord/VoicePresence.js';
import { userMention } from '../mention.js';

const GUILD = 'g1';
const USERS: Record<number, User> = {
    1: { id: 1, discord_id: 'ann' },
    2: { id: 2, discord_id: 'bob' },
    3: { id: 3, discord_id: 'cat' },
    4: { id: 4 }
};
const ROTATIONS: Record<number, string[]> = {
    [-5]: [userMention(1, 'Ann'), userMention(2, 'Bob'), userMention(4, 'Telegram only')],
    [-6]: [userMention(3, 'Cat')],
    [-9]: [userMention(1, 'Ann')]
};
const LINKS = [
    { telegram_chat_id: -5, discord_guild_id: GUILD, discord_channel_id: 'text1' },
    { telegram_chat_id: -5, discord_guild_id: GUILD, discord_channel_id: 'text2' },
    { telegram_chat_id: -6, discord_guild_id: GUILD, discord_channel_id: 'text3' },
    { telegram_chat_id: -9, discord_guild_id: 'other', discord_channel_id: 'text4' }
] as ChatLink[];

const member = (user_id: string, channel_id: string): VoiceMember => ({ user_id, channel_id });

const sync = async (members: VoiceMember[], current?: string, guild_id: string = GUILD): Promise<unknown[]> => {
    mock.method(ChatLinkDAO.prototype, 'getAllLinks', async () => LINKS);
    mock.method(RollcallPlayerDAO.prototype, 'getRollcallPlayerUsernames', async (chat_id: number) => ROTATIONS[chat_id]);
    mock.method(UserDAO.prototype, 'getUsers', async (ids: number[]) => Object.fromEntries(ids.map(id => [id, USERS[id]])));
    const calls: unknown[] = [];
    const gateway: VoiceGateway = {
        voiceMembers: () => members,
        voiceChannel: () => current,
        joinVoice: (guild, channel_id) => calls.push(['join', guild, channel_id]),
        leaveVoice: guild => calls.push(['leave', guild])
    };
    await new VoicePresence(gateway).sync(guild_id);
    return calls;
};

afterEach(() => {
    mock.restoreAll();
    DiscordService.instance = null;
});

test('the bot joins the voice channel a rotation player is in', async () => {
    assert.deepEqual(await sync([member('ann', 'v1')]), [['join', GUILD, 'v1']]);
});

test('rotation players of every chat linked to the guild count', async () => {
    assert.deepEqual(await sync([member('cat', 'v2')]), [['join', GUILD, 'v2']]);
});

test('people outside the rotation do not bring the bot in', async () => {
    assert.deepEqual(await sync([member('stranger', 'v1')]), []);
});

test('a guild without linked chats is left alone', async () => {
    assert.deepEqual(await sync([member('ann', 'v1')], undefined, 'unlinked'), []);
});

test('the rotation of a chat linked to another guild does not count', async () => {
    assert.deepEqual(await sync([member('cat', 'v1')], undefined, 'other'), []);
});

test('the bot joins the channel with the most rotation players', async () => {
    assert.deepEqual(await sync([member('cat', 'v1'), member('ann', 'v2'), member('bob', 'v2'), member('stranger', 'v1'), member('other', 'v1')]), [['join', GUILD, 'v2']]);
});

test('the bot stays where it is while its channel still has a rotation player', async () => {
    assert.deepEqual(await sync([member('ann', 'v1')], 'v1'), []);
});

test('the bot stays where it is on a draw', async () => {
    assert.deepEqual(await sync([member('ann', 'v1'), member('bob', 'v2')], 'v2'), []);
});

test('the bot moves when another channel has more rotation players', async () => {
    assert.deepEqual(await sync([member('cat', 'v1'), member('ann', 'v2'), member('bob', 'v2')], 'v1'), [['join', GUILD, 'v2']]);
});

test('the bot follows the last rotation player to another channel', async () => {
    assert.deepEqual(await sync([member('ann', 'v2'), member('stranger', 'v1')], 'v1'), [['join', GUILD, 'v2']]);
});

test('the bot leaves when no rotation player is left in voice', async () => {
    assert.deepEqual(await sync([member('stranger', 'v1')], 'v1'), [['leave', GUILD]]);
});

const serviceWithVoiceStates = (): DiscordService => {
    const service = new DiscordService();
    const states = new Map([
        ['ann', { id: 'ann', channelId: 'v1' }],
        ['left', { id: 'left', channelId: null }],
        ['bot', { id: 'bot', channelId: 'v1' }]
    ]);
    (service as any).client.user = { id: 'bot' };
    (service as any).client.guilds.cache.set(GUILD, { id: GUILD, voiceStates: { cache: states } });
    return service;
};

test('voice members are everyone in a voice channel except the bot', () => {
    const service = serviceWithVoiceStates();
    assert.deepEqual(service.voiceMembers(GUILD), [member('ann', 'v1')]);
    assert.deepEqual(service.voiceMembers('unknown'), []);
});

test('the bot is in no voice channel until it joins one', () => {
    const service = serviceWithVoiceStates();
    assert.equal(service.voiceChannel(GUILD), undefined);
    service.joinVoice('unknown', 'v1');
    assert.equal(service.voiceChannel('unknown'), undefined);
});

test('a voice state update reaches the voice handlers with its guild', async () => {
    const service = serviceWithVoiceStates();
    const guilds: string[] = [];
    service.onVoiceChange(async guild_id => {
        guilds.push(guild_id);
    });
    (service as any).client.emit('voiceStateUpdate', {}, { guild: { id: GUILD } });
    assert.deepEqual(guilds, [GUILD]);
});
