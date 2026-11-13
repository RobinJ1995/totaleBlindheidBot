import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as settle } from 'node:timers/promises';
import SteamUser from 'steam-user';
import { Bot } from 'node-telegram-bot-api';
import SteamService, { FriendRequests } from '../SteamService.js';
import UserDAO from '../dao/UserDAO.js';
import RollcallPlayerDAO from '../dao/RollcallPlayerDAO.js';
import { Command } from '../MessageRouter.js';
import steamUserId from '../command/steam_user_id.js';

const { None, Blocked, RequestRecipient, Friend, RequestInitiator, Ignored } = SteamUser.EFriendRelationship;
const PROFILE = 'https://steamcommunity.com/profiles/76561190000000000';

let service: SteamService | undefined;

afterEach(() => {
    service?.stop();
    service = undefined;
    SteamService.instance = null;
    mock.restoreAll();
    delete process.env.STEAM_USERNAME;
    delete process.env.STEAM_PASSWORD;
});

interface Session {
    steam: SteamService;
    client: any;
    requests: string[];
}

// A started service whose Steam account knows the given accounts; "refuses" names one Steam turns down.
const session = (relationships: Record<string, number>, rotation: string[] = [], refuses?: string): Session => {
    process.env.STEAM_USERNAME = 'bot';
    process.env.STEAM_PASSWORD = 'secret';
    const requests: string[] = [];
    mock.method(SteamUser.prototype, 'logOn', () => undefined);
    mock.method(SteamUser.prototype, 'logOff', () => undefined);
    mock.method(SteamUser.prototype, 'getPersonas', () => undefined);
    mock.method(SteamUser.prototype, 'addFriend', async (steamId: string) => {
        requests.push(steamId);
        if (steamId === refuses) {
            throw new Error('LimitExceeded');
        }
        return { personaName: steamId };
    });
    mock.method(UserDAO.prototype, 'getAllUserSettings', async () => ({ 5: { steam_ids: ['linked'] } }));
    mock.method(UserDAO.prototype, 'getUserSettings', async () => ({ steam_ids: ['linked'] }));
    mock.method(RollcallPlayerDAO.prototype, 'getRotationSteamIds', async () => rotation);
    mock.method(console, 'log', () => undefined);
    mock.method(console, 'warn', () => undefined);
    service = new SteamService({} as unknown as Bot);
    service.start();
    const client = (service as any).client;
    client.myFriends = relationships;
    return { steam: service, client, requests };
};

const logOn = async ({ client }: Session): Promise<void> => {
    client.steamID = { getSteamID64: () => '76561190000000000' };
    client.emit('friendsList');
    await settle();
};

test('nobody is sent a friend request before the friends list has loaded', async () => {
    const { steam, requests } = session({});
    assert.deepEqual(await steam.befriend(['stranger']), { requested: [], accepted: [], pending: [], failed: [] });
    assert.deepEqual(requests, []);
});

test('strangers are sent a request, incoming requests are accepted, and everyone else is left alone', async () => {
    const started = session({ friend: Friend, asked: RequestRecipient, waiting: RequestInitiator, blocked: Blocked, ignored: Ignored, nobody: None });
    await logOn(started);

    const outcome: FriendRequests = await started.steam.befriend(['friend', 'asked', 'waiting', 'blocked', 'ignored', 'nobody', 'unknown']);

    assert.deepEqual(outcome, { requested: ['nobody', 'unknown'], accepted: ['asked'], pending: ['waiting'], failed: [] });
    assert.deepEqual(started.requests, ['asked', 'nobody', 'unknown']);
});

test('a request Steam refuses is reported, and the others still go out', async () => {
    const started = session({}, [], 'full');
    await logOn(started);

    assert.deepEqual(await started.steam.befriend(['full', 'stranger']), { requested: ['stranger'], accepted: [], pending: [], failed: ['full'] });
});

test('on logging on, rollcall players who are not friends yet are sent a request', async () => {
    const started = session({ friend: Friend, waiting: RequestInitiator }, ['friend', 'waiting', 'stranger']);

    await logOn(started);

    assert.deepEqual(started.requests, ['stranger']);
});

test('a friend request arriving from a linked account is accepted, anyone else\'s is not', async () => {
    const started = session({});
    await logOn(started);
    const arrives = async (steamId: string, relationship: number): Promise<void> => {
        started.client.myFriends[steamId] = relationship;
        started.client.emit('friendRelationship', { getSteamID64: () => steamId }, relationship);
        await settle();
    };

    await arrives('unlinked', RequestRecipient);
    await arrives('linked', Friend);
    assert.deepEqual(started.requests, []);

    await arrives('linked', RequestRecipient);
    assert.deepEqual(started.requests, ['linked']);
});

const links = (steamIds: string[]): void => {
    (UserDAO.prototype.getUserSettings as any).mock.mockImplementation(async () => ({ steam_ids: steamIds }));
};

test('a user whose linked accounts are not the bot\'s friends is unbefriended, whatever Steam says about them', async () => {
    const started = session({ waiting: RequestInitiator });
    links(['waiting', 'stranger']);
    started.client.users = { waiting: { gameid: '730' }, stranger: { persona_state: SteamUser.EPersonaState.Online } };
    await logOn(started);

    assert.equal(await started.steam.getPresence(5), 'unbefriended');
});

test('the presence of a user with a befriended account comes from that account alone', async () => {
    const started = session({ friend: Friend });
    links(['friend', 'stranger']);
    started.client.users = { friend: { persona_state: SteamUser.EPersonaState.Offline }, stranger: { gameid: '730' } };
    await logOn(started);

    assert.equal(await started.steam.getPresence(5), 'offline');
});

test('nobody is unbefriended before the friends list has loaded, nor without a linked account', async () => {
    const { steam } = session({});
    assert.equal(await steam.getPresence(5), undefined);

    links([]);
    assert.equal(await steam.getPresence(5), 'unlinked');
});

test('a linked account becoming or ceasing to be a friend is a presence change, an unlinked one\'s is not', async () => {
    const started = session({});
    await logOn(started);
    const changed: number[] = [];
    started.steam.onPresenceChange(userId => changed.push(userId));
    // Like steam-user, which only updates myFriends after emitting.
    const becomes = async (steamId: string, relationship: number): Promise<void> => {
        started.client.emit('friendRelationship', { getSteamID64: () => steamId }, relationship);
        started.client.myFriends[steamId] = relationship;
        await settle();
        await settle();
    };

    await becomes('unlinked', Friend);
    assert.deepEqual(changed, []);

    await becomes('linked', Friend);
    assert.deepEqual(changed, [5]);
    assert.equal(await started.steam.getPresence(5), undefined);

    await becomes('linked', None);
    assert.deepEqual(changed, [5, 5]);
    assert.equal(await started.steam.getPresence(5), 'unbefriended');
});

test('the profile to befriend is the bot\'s own, once it is logged on', () => {
    const { steam, client } = session({});
    assert.equal(steam.profileUrl(), undefined);
    client.steamID = { getSteamID64: () => '76561190000000000' };
    assert.equal(steam.profileUrl(), PROFILE);
});

const linkOwnIds = async (ids: string, outcome: Partial<FriendRequests>): Promise<unknown[]> => {
    const replies: unknown[] = [];
    mock.method(UserDAO.prototype, 'setSteamUserId', async () => undefined);
    SteamService.instance = {
        befriend: async () => ({ requested: [], accepted: [], pending: [], failed: [], ...outcome }),
        profileUrl: () => PROFILE
    } as unknown as SteamService;
    const cmd: Command = {
        platform: 'discord',
        chat_id: 1,
        user: { id: 7 },
        command: { name: 'steam_user_id', argument: ids, argumentTokens: ids.split(' ') },
        reply: async text => replies.push(text),
        replyPrivately: async () => undefined
    };
    await steamUserId({} as Bot, cmd);
    return replies;
};

test('linking Steam accounts says which were sent a friend request, new or still pending', async () => {
    assert.deepEqual(await linkOwnIds('76561198000000001, 76561198000000002', { requested: ['76561198000000001'], pending: ['76561198000000002'] }), [
        'Your Steam user ID(s) has been set to 76561198000000001, 76561198000000002\n\n'
        + 'I\'ve sent a Steam friend request to 76561198000000001, 76561198000000002. I can see their games once it is accepted.'
    ]);
});

test('linking a Steam account that had asked the bot says its request was accepted', async () => {
    assert.deepEqual(await linkOwnIds('76561198000000001', { accepted: ['76561198000000001'] }), [
        'Your Steam user ID(s) has been set to 76561198000000001\n\nI\'ve accepted the Steam friend request from 76561198000000001.'
    ]);
});

test('linking a Steam account the bot could not befriend says how to add the bot', async () => {
    assert.deepEqual(await linkOwnIds('76561198000000001', { failed: ['76561198000000001'] }), [
        'Your Steam user ID(s) has been set to 76561198000000001\n\n'
        + `I couldn't send a Steam friend request to 76561198000000001. Add me on Steam instead: ${PROFILE}`
    ]);
});

test('linking friends\' Steam accounts needs no note', async () => {
    assert.deepEqual(await linkOwnIds('76561198000000001', {}), ['Your Steam user ID(s) has been set to 76561198000000001']);
});
