import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as settle } from 'node:timers/promises';
import SteamUser from 'steam-user';
import { Bot } from 'node-telegram-bot-api';
import SteamService from '../SteamService.js';
import UserDAO from '../dao/UserDAO.js';
import RollcallPlayerDAO from '../dao/RollcallPlayerDAO.js';

const SILENCE_MS = 3 * 60 * 1000;
const RECONNECT_MS = 30 * 1000;

let service: SteamService | undefined;

afterEach(() => {
    service?.stop();
    service = undefined;
    SteamService.instance = null;
    mock.timers.reset();
    mock.restoreAll();
    delete process.env.STEAM_USERNAME;
    delete process.env.STEAM_PASSWORD;
});

interface Session {
    steam: SteamService;
    client: any;
    logOns: () => number;
    logOffs: () => number;
}

// A logged-on service tracking one Steam account, on a clock the test moves.
const session = (linked: string[] = ['linked']): Session => {
    process.env.STEAM_USERNAME = 'bot';
    process.env.STEAM_PASSWORD = 'secret';
    mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] });
    const logOn = mock.method(SteamUser.prototype, 'logOn', () => undefined);
    const logOff = mock.method(SteamUser.prototype, 'logOff', () => undefined);
    mock.method(SteamUser.prototype, 'getPersonas', () => undefined);
    mock.method(SteamUser.prototype, 'setPersona', () => undefined);
    mock.method(UserDAO.prototype, 'getAllUserSettings', async () => ({ 5: { steam_ids: linked } }));
    mock.method(RollcallPlayerDAO.prototype, 'getRotationSteamIds', async () => []);
    mock.method(console, 'log', () => undefined);
    mock.method(console, 'warn', () => undefined);
    service = new SteamService({} as unknown as Bot);
    service.start();
    const client = (service as any).client;
    client.steamID = { getSteamID64: () => '76561190000000000' };
    return { steam: service, client, logOns: () => logOn.mock.callCount(), logOffs: () => logOff.mock.callCount() };
};

const pass = async (ms: number): Promise<void> => {
    mock.timers.tick(ms);
    await settle();
};

test('a session Steam stopped answering is logged off and logged on again', async () => {
    const { steam, logOns, logOffs } = session();
    await steam.updateUserMappings();
    await pass(SILENCE_MS - 1);
    await steam.updateUserMappings();
    assert.equal(logOffs(), 0);

    await pass(1);
    await steam.updateUserMappings();
    assert.equal(logOffs(), 1);
    assert.equal(logOns(), 1);

    await pass(RECONNECT_MS);
    assert.equal(logOns(), 2);
});

test('a session that hears of any account is kept', async () => {
    const { steam, client, logOffs } = session();
    await steam.updateUserMappings();
    await pass(SILENCE_MS - 1);
    client.emit('user', { getSteamID64: () => 'stranger' }, {});
    await pass(1);
    await steam.updateUserMappings();
    assert.equal(logOffs(), 0);
});

test('logging on ends the silence of the session before it', async () => {
    const { steam, client, logOffs } = session();
    await steam.updateUserMappings();
    await pass(SILENCE_MS - 1);
    client.emit('loggedOn');
    await settle();
    await pass(1);
    await steam.updateUserMappings();
    assert.equal(logOffs(), 0);
});

test('a session with no accounts to ask about is kept', async () => {
    const { steam, logOffs } = session([]);
    await steam.updateUserMappings();
    await pass(SILENCE_MS);
    await steam.updateUserMappings();
    assert.equal(logOffs(), 0);
});

test('nothing is asked of Steam, or held against it, while logged off', async () => {
    const { steam, client, logOffs } = session();
    client.steamID = null;
    await steam.updateUserMappings();
    await pass(SILENCE_MS);
    await steam.updateUserMappings();
    assert.equal(logOffs(), 0);
});
