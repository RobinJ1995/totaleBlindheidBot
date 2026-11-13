import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from 'node-telegram-bot-api';
import SteamService from '../SteamService.js';

afterEach(() => {
    SteamService.instance = null;
});

const serviceWith = (steamIds: string[] | undefined, users: Record<string, object>): SteamService => {
    const service = new SteamService({} as unknown as Bot);
    (service as any).userDao = { getUserSettings: async () => ({ steam_ids: steamIds }) };
    (service as any).client.users = users;
    return service;
};

test('reads the rich presence of the user\'s account that is in CS2', async () => {
    const service = serviceWith(['1', '2'], {
        1: { gameid: '440', rich_presence: { 'game:map': 'ctf_2fort' } },
        2: { gameid: '730', rich_presence: { 'game:map': 'de_dust2', 'game:score': '[ 3 : 1 ]' } }
    });
    const presence = await service.getRichPresence(9);
    assert.equal(presence?.map, 'de_dust2');
    assert.equal(presence?.rawScore, '3 : 1');
});

test('has no rich presence when no account is in CS2', async () => {
    assert.equal(await serviceWith(['1'], { 1: { gameid: '440' } }).getRichPresence(9), undefined);
    assert.equal(await serviceWith(['1'], {}).getRichPresence(9), undefined);
    assert.equal(await serviceWith(undefined, {}).getRichPresence(9), undefined);
});
