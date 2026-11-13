import { test } from 'node:test';
import assert from 'node:assert/strict';
import RichPresence from '../RichPresence.js';

test('reads map, mode, score, status and party from a key/value list', () => {
    const presence = new RichPresence({
        rich_presence: [
            { key: 'game:map', value: 'de_dust2' },
            { key: 'game:mode', value: 'Premier' },
            { key: 'game:score', value: '[ 10 : 5 ]' },
            { key: 'status', value: 'Competitive' },
            { key: 'steam_player_group', value: '42' }
        ]
    });
    assert.equal(presence.map, 'de_dust2');
    assert.equal(presence.mode, 'Premier');
    assert.equal(presence.rawScore, '10 : 5');
    assert.equal(presence.status, 'Competitive');
    assert.equal(presence.party, '42');
});

test('reads the same fields from an object', () => {
    const presence = new RichPresence({
        rich_presence: { 'game:map': 'de_inferno', 'game:mode': 'Wingman', 'game:score': '3-2', status: 'x', steam_player_group: '7' }
    });
    assert.equal(presence.map, 'de_inferno');
    assert.equal(presence.mode, 'Wingman');
    assert.equal(presence.rawScore, '3-2');
    assert.equal(presence.party, '7');
});

test('falls back to the unprefixed keys', () => {
    const list = new RichPresence({ rich_presence: [{ key: 'map', value: 'a' }, { key: 'mode', value: 'b' }, { key: 'score', value: '1-0' }] });
    const object = new RichPresence({ rich_presence: { map: 'a', mode: 'b', score: '1-0' } });
    [list, object].forEach(presence => {
        assert.equal(presence.map, 'a');
        assert.equal(presence.mode, 'b');
        assert.equal(presence.rawScore, '1-0');
    });
});

test('the summary string overrides the status for display, but not the mode', () => {
    const presence = new RichPresence({
        rich_presence: { 'game:map': 'de_nuke', status: 'Competitive' },
        rich_presence_string: 'Competitive - Nuke [ 1 : 0 ]'
    });
    assert.equal(presence.status, 'Competitive - Nuke [ 1 : 0 ]');
    assert.equal(presence.mode, 'Competitive');
});

test('the status is only taken as the mode while on a map', () => {
    const presence = new RichPresence({ rich_presence: { status: 'In the main menu' } });
    assert.equal(presence.mode, undefined);
    assert.equal(presence.status, 'In the main menu');
});

test('an empty party is no party', () => {
    assert.equal(new RichPresence({ rich_presence: { steam_player_group: '' } }).party, undefined);
});

test('no rich presence leaves everything undefined', () => {
    const presence = new RichPresence({});
    assert.deepEqual(
        [presence.map, presence.mode, presence.rawScore, presence.status, presence.party],
        [undefined, undefined, undefined, undefined, undefined]
    );
});
