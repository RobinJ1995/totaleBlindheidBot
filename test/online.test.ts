import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OnlineList, OnlineSteam, OnlineUsers, NOBODY_ONLINE } from '../command/online.js';
import { Presence } from '../SteamService.js';
import RichPresence from '../RichPresence.js';
import { ChatUser } from '../dao/UserDAO.js';
import { Formatted } from '../format.js';

const chatUser = (user_id: number, name: string): ChatUser => ({ user_id, name, discord_only: false });

const list = (presences: Record<number, Presence | undefined>, games: Record<number, RichPresence> = {}, users?: ChatUser[]): OnlineList => {
    const steam: OnlineSteam = {
        getPresence: async (id: number) => presences[id],
        getRichPresence: async (id: number) => games[id],
        formatScore: (score: string) => `<${score}>`
    };
    const dao: OnlineUsers = {
        getChatUsers: async () => users ?? Object.keys(presences).map(id => chatUser(Number(id), `P${id}`))
    };
    return new OnlineList(steam, dao);
};

const text = async (online: OnlineList): Promise<string> => {
    const rendered: Formatted | string = await online.render(1);
    return typeof rendered === 'string' ? rendered : rendered.text;
};

test('lists the players in CS2 first, then those online, leaving out the rest', async () => {
    const online = list(
        { 1: 'online', 2: 'playing', 3: 'offline', 4: 'unlinked', 5: undefined },
        { 2: new RichPresence({ rich_presence: { 'game:map': 'de_dust2', 'game:mode': 'Premier', 'game:score': '10-5' } }) }
    );
    assert.equal(await text(online), '🟢 P2 is playing de_dust2 (Premier): <10-5>\n🟡 P1 is online');
});

test('a player in CS2 without a map is just playing Counter-Strike', async () => {
    assert.equal(await text(list({ 1: 'playing' }, { 1: new RichPresence({ rich_presence: { status: 'In the main menu' } }) })), '🟢 P1 is playing Counter-Strike');
    assert.equal(await text(list({ 1: 'playing' })), '🟢 P1 is playing Counter-Strike');
});

test('mode and score are left out when unknown', async () => {
    const online = list({ 1: 'playing' }, { 1: new RichPresence({ rich_presence: { map: 'de_nuke' } }) });
    assert.equal(await text(online), '🟢 P1 is playing de_nuke');
});

test('names are bold and do not ping', async () => {
    const rendered = await list({ 1: 'online' }, {}, [chatUser(1, '@alice')]).render(1) as Formatted;
    assert.equal(rendered.text, '🟡 @​alice is online');
    assert.deepEqual(rendered.entities, [{ type: 'bold', offset: 3, length: 7 }]);
});

test('says so when nobody is online', async () => {
    assert.equal(await list({ 1: 'offline', 2: 'unlinked' }).render(1), NOBODY_ONLINE);
    assert.equal(await list({}).render(1), NOBODY_ONLINE);
});
