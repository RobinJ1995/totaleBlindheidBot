import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDiscordTags } from '../discord/render.js';
import { asFormatted } from '../format.js';
import { User } from '../dao/UserDAO.js';

const users: Record<number, User> = {
    1: { id: 1, telegram_id: 777, name: 'Alice' },
    2: { id: 2, telegram_id: 778, discord_id: '123456789012345678', name: 'Bob', discord_username: 'bob' },
    3: { id: 3, discord_id: '223456789012345678', discord_name: 'Carol' }
};

test('the tag line pings people on Discord and names the rest', () => {
    const line = withDiscordTags(asFormatted('Go!\n'), ['[Alice](user:1)', '[Bob](user:2)', '[Carol](user:3)', '@dave', 'Eve_H'], users);
    assert.equal(line, 'Go!\nAlice <@123456789012345678> <@223456789012345678> @dave Eve\\_H');
});
