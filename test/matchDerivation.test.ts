import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    segmentStream, findCoPlayers, deriveRounds, parseRawScore,
    PresenceEvent, DerivationConfig
} from '../matchDerivation.js';

const T0 = new Date('2026-01-01T12:00:00.000Z').getTime();
const at = (seconds: number): Date => new Date(T0 + seconds * 1000);

const config: DerivationConfig = {
    resetTolerance: 2,
    matchIdleMs: 10 * 60 * 1000,
    resetConfirmMs: 30 * 1000,
    coPlayerStaleMs: 15 * 60 * 1000
};

let nextId = 1;
const ev = (
    seconds: number,
    opts: { playing?: boolean; map?: string; mode?: string; score?: string; user?: number; name?: string } = {}
): PresenceEvent => ({
    id: nextId++,
    steam_id: 'A',
    user_id: opts.user ?? 100,
    playing: opts.playing ?? true,
    map: opts.map,
    mode: opts.mode,
    raw_score: opts.score,
    score_total: parseRawScore(opts.score)?.total ?? null,
    player_name: opts.name,
    created_at: at(seconds)
});

test('a single progressing match stays one open segment while playing', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', mode: 'Competitive', score: '1-0' }),
        ev(60, { map: 'Inferno', mode: 'Competitive', score: '5-3' }),
        ev(120, { map: 'Inferno', mode: 'Competitive', score: '10-5' })
    ];
    const { closed, open } = segmentStream(events, at(180), config);
    assert.equal(closed.length, 0);
    assert.ok(open);
    assert.equal(open!.map, 'Inferno');
    assert.equal(open!.max_score, '10-5');
    assert.equal(open!.playing, true);
});

test('a stopped match closes after the idle window, not before', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', score: '16-14' }),
        ev(60, { playing: false })
    ];
    const before = segmentStream(events, at(9 * 60), config);
    assert.equal(before.closed.length, 0);
    assert.ok(before.open);

    const after = segmentStream(events, at(11 * 60), config);
    assert.equal(after.closed.length, 1);
    assert.equal(after.open, null);
    assert.equal(after.closed[0].max_score, '16-14');
});

test('idle countdown runs from the last playing observation, not the stop event', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Nuke', score: '13-7' }),
        ev(300, { playing: false })
    ];
    // 10 minutes after the last playing observation: closed, even though the stop was only
    // 5 minutes ago — stopping is not progress (matches the old last_progress_at semantics).
    const idle = segmentStream(events, at(600), config);
    assert.equal(idle.closed.length, 1);

    // A stream still marked playing never idle-closes, no matter how stale.
    nextId = 1;
    const stillPlaying = segmentStream([ev(0, { map: 'Nuke', score: '13-7' })], at(3600), config);
    assert.equal(stillPlaying.closed.length, 0);
    assert.ok(stillPlaying.open);
});

test('a relaunch mid-match resumes the same match', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', score: '10-5' }),
        ev(30, { playing: false }),
        ev(90, { map: 'Inferno', score: '12-5' })
    ];
    const { closed, open } = segmentStream(events, at(120), config);
    assert.equal(closed.length, 0);
    assert.ok(open);
    assert.equal(open!.max_score, '12-5');
    assert.equal(open!.playing, true);
});

test('a score reset while still playing becomes a boundary once the confirm window passes', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Mirage', score: '14-16' }),
        ev(60, { map: 'Mirage', score: '1-0' })
    ];
    // Within the confirm window: nothing closed yet.
    const soon = segmentStream(events, at(70), config);
    assert.equal(soon.closed.length, 0);

    // After the window the old match is over and the dip started the new one.
    const later = segmentStream(events, at(60 + 31), config);
    assert.equal(later.closed.length, 1);
    assert.equal(later.closed[0].max_score, '14-16');
    assert.ok(later.open);
    assert.equal(later.open!.max_score, '1-0');
});

test('a second event in the new low range confirms a reset immediately', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Mirage', score: '14-16' }),
        ev(60, { map: 'Mirage', score: '1-0' }),
        ev(90, { map: 'Mirage', score: '2-0' })
    ];
    const { closed, open } = segmentStream(events, at(91), config);
    assert.equal(closed.length, 1);
    assert.equal(closed[0].max_score, '14-16');
    assert.ok(open);
    assert.equal(open!.max_score, '2-0');
});

test('a flaky dip that returns to the old range does not split the match', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', score: '5-3' }),
        ev(60, { map: 'Inferno', score: '1-0' }),   // flake
        ev(90, { map: 'Inferno', score: '8-3' })
    ];
    const { closed, open } = segmentStream(events, at(120), config);
    assert.equal(closed.length, 0);
    assert.ok(open);
    assert.equal(open!.max_score, '8-3');

    // ...and the whole thing still finalises as ONE match when idle.
    nextId = 1;
    const withStop = [
        ev(0, { map: 'Inferno', score: '5-3' }),
        ev(60, { map: 'Inferno', score: '1-0' }),
        ev(90, { map: 'Inferno', score: '8-3' }),
        ev(120, { playing: false })
    ];
    const idle = segmentStream(withStop, at(120 + 11 * 60), config);
    assert.equal(idle.closed.length, 1);
    assert.equal(idle.closed[0].max_score, '8-3');
});

test('a small drop within tolerance is not a reset signal', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', score: '5-5' }),   // total 10
        ev(60, { map: 'Inferno', score: '5-4' })   // total 9, within tolerance 2
    ];
    const { closed, open } = segmentStream(events, at(600), config);
    assert.equal(closed.length, 0);
    assert.ok(open);
    assert.equal(open!.max_score, '5-5');
});

test('a map change is an immediate boundary', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', mode: 'Competitive', score: '16-14' }),
        ev(60, { map: 'Mirage', mode: 'Competitive', score: '1-0' })
    ];
    const { closed, open } = segmentStream(events, at(61), config);
    assert.equal(closed.length, 1);
    assert.equal(closed[0].map, 'Inferno');
    assert.ok(open);
    assert.equal(open!.map, 'Mirage');
});

test('a mode change is an immediate boundary', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', mode: 'Competitive', score: '16-14' }),
        ev(60, { map: 'Inferno', mode: 'Wingman', score: '1-0' })
    ];
    const { closed, open } = segmentStream(events, at(61), config);
    assert.equal(closed.length, 1);
    assert.equal(closed[0].mode, 'Competitive');
    assert.ok(open);
    assert.equal(open!.mode, 'Wingman');
});

test('missing map/mode on an event never causes a boundary; first non-null fills in', () => {
    nextId = 1;
    const events = [
        ev(0, { score: '1-0' }),                                   // no map yet
        ev(60, { map: 'Inferno', mode: 'Competitive', score: '3-1' }),
        ev(120, { score: '5-1' })                                  // map/mode dropped from presence
    ];
    const { closed, open } = segmentStream(events, at(121), config);
    assert.equal(closed.length, 0);
    assert.ok(open);
    assert.equal(open!.map, 'Inferno');
    assert.equal(open!.mode, 'Competitive');
    assert.equal(open!.max_score, '5-1');
});

test('two boundaries produce two closed matches and one open', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', score: '13-7' }),
        ev(60, { map: 'Mirage', score: '13-5' }),
        ev(120, { map: 'Nuke', score: '1-0' })
    ];
    const { closed, open } = segmentStream(events, at(121), config);
    assert.equal(closed.length, 2);
    assert.equal(closed[0].map, 'Inferno');
    assert.equal(closed[1].map, 'Mirage');
    assert.ok(open);
    assert.equal(open!.map, 'Nuke');
});

test('latest player name and user mapping win; started_at is the first event', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', score: '1-0', name: 'OldNick', user: 100 }),
        ev(60, { map: 'Inferno', score: '5-0', name: 'NewNick', user: 101 })
    ];
    const { open } = segmentStream(events, at(61), config);
    assert.ok(open);
    assert.equal(open!.player_name, 'NewNick');
    assert.equal(open!.user_id, 101);
    assert.equal(open!.started_at.getTime(), at(0).getTime());
    assert.equal(open!.lastEventId, 2);
});

test('co-player: same map, mode and score at the same time is found with their name', () => {
    nextId = 1;
    const seg = segmentStream([
        ev(0, { map: 'Inferno', mode: 'Competitive', score: '5-3' }),
        ev(60, { map: 'Inferno', mode: 'Competitive', score: '6-3' })
    ], at(61), config).open!;

    nextId = 100;
    const other: PresenceEvent[] = [
        { ...ev(-30, { map: 'Inferno', mode: 'Competitive', score: '5-3', user: 200, name: 'Bravo' }), steam_id: 'B' }
    ];
    const cos = findCoPlayers(seg, new Map([['B', other]]), config);
    assert.equal(cos.length, 1);
    assert.equal(cos[0].user_id, 200);
    assert.equal(cos[0].player_name, 'Bravo');
});

test('co-player: different map, diverging score, stopped, or own alt account do not match', () => {
    nextId = 1;
    const seg = segmentStream([
        ev(0, { map: 'Inferno', mode: 'Competitive', score: '5-3' }),
        ev(60, { map: 'Inferno', mode: 'Competitive', score: '6-3' })
    ], at(61), config).open!;

    nextId = 100;
    const otherMap: PresenceEvent[] = [{ ...ev(-30, { map: 'Mirage', mode: 'Competitive', score: '5-3', user: 201 }), steam_id: 'C' }];
    const divergent: PresenceEvent[] = [{ ...ev(-30, { map: 'Inferno', mode: 'Competitive', score: '16-14', user: 202 }), steam_id: 'D' }];
    const stopped: PresenceEvent[] = [{ ...ev(-30, { playing: false, user: 203 }), steam_id: 'E' }];
    const ownAlt: PresenceEvent[] = [{ ...ev(-30, { map: 'Inferno', mode: 'Competitive', score: '5-3', user: 100 }), steam_id: 'F' }];

    const cos = findCoPlayers(seg, new Map([
        ['C', otherMap], ['D', divergent], ['E', stopped], ['F', ownAlt]
    ]), config);
    assert.equal(cos.length, 0);
});

test('co-player: someone who left mid-match is still recorded (point-in-time semantics)', () => {
    nextId = 1;
    const seg = segmentStream([
        ev(0, { map: 'Inferno', mode: 'Competitive', score: '5-3' }),
        ev(300, { map: 'Inferno', mode: 'Competitive', score: '20-10' })
    ], at(301), config).open!;

    nextId = 100;
    const other: PresenceEvent[] = [
        { ...ev(-10, { map: 'Inferno', mode: 'Competitive', score: '5-3', user: 210 }), steam_id: 'B' },
        { ...ev(120, { playing: false, user: 210 }), steam_id: 'B' }
    ];
    // At the segment's first observation the states matched; the later divergence doesn't erase it.
    const cos = findCoPlayers(seg, new Map([['B', other]]), config);
    assert.equal(cos.length, 1);
    assert.equal(cos[0].user_id, 210);
});

test('an unparseable score is still recorded and replaced by the first parseable one', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', score: 'warmup' }),
        ev(60, { map: 'Inferno', score: '2-1' })
    ];
    const { open } = segmentStream(events, at(61), config);
    assert.ok(open);
    assert.equal(open!.max_score, '2-1');
});

test('a scoreless match is derivable but carries no score', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno' }),
        ev(60, { playing: false })
    ];
    const { closed } = segmentStream(events, at(60 + 11 * 60), config);
    assert.equal(closed.length, 1);
    assert.equal(closed[0].max_score, undefined);
});

test('a multi-event dip (including a stop) folds back cleanly on refute', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', score: '9-3' }),
        ev(60, { map: 'Inferno', score: '1-0' }),  // flake dip → pending
        ev(70, { playing: false }),                // absorbed into pending
        ev(90, { map: 'Inferno', score: '10-3' })  // back in old range → refute
    ];
    const { closed, open } = segmentStream(events, at(120), config);
    assert.equal(closed.length, 0);
    assert.ok(open);
    assert.equal(open!.max_score, '10-3');
    assert.equal(open!.playing, true);
    assert.equal(open!.lastEventId, 4);
    // The folded events keep the segment's event list time-ordered.
    const times = open!.events.map(e => e.created_at.getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
    // last_playing_at reflects the refuting event, not the folded stop.
    assert.equal(open!.last_playing_at.getTime(), at(90).getTime());
});

test('a map change while a reset is pending opens a boundary even if the dip carried no map', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', mode: 'Competitive', score: '16-13' }),
        ev(60, { score: '1-0' }),                       // dip without map → pending
        ev(70, { map: 'Mirage', mode: 'Competitive' })  // scoreless but conflicting map
    ];
    const { closed, open } = segmentStream(events, at(71), config);
    // The conflicting map settles the reset: the old match closes. The mapless dip then reads
    // as the start of the new Mirage match whose map key simply lagged a tick.
    assert.equal(closed.length, 1);
    assert.equal(closed[0].map, 'Inferno');
    assert.equal(closed[0].max_score, '16-13');
    assert.ok(open);
    assert.equal(open!.map, 'Mirage');
    assert.equal(open!.max_score, '1-0');
});

test('a score exactly at the tolerance boundary refutes a pending reset', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', score: '5-3' }),   // total 8
        ev(60, { map: 'Inferno', score: '1-0' }),  // dip → pending
        ev(90, { map: 'Inferno', score: '4-2' })   // total 6 = 8 - tolerance → still old range
    ];
    const { closed, open } = segmentStream(events, at(600), config);
    assert.equal(closed.length, 0);
    assert.ok(open);
    assert.equal(open!.max_score, '5-3');
});

test('time confirmation and idle close resolve in the same derivation, with correct cursor ids', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Mirage', score: '14-16' }),  // id 1
        ev(60, { map: 'Mirage', score: '1-0' }),   // id 2: dip → pending
        ev(70, { playing: false })                 // id 3: absorbed into pending
    ];
    const { closed, open } = segmentStream(events, at(70 + 11 * 60), config);
    // The old match closes by time-confirmed reset; the dip stub then closes by idle.
    assert.equal(closed.length, 2);
    assert.equal(closed[0].max_score, '14-16');
    assert.equal(closed[0].lastEventId, 1);  // the dip events stay past the first cursor advance
    assert.equal(closed[1].max_score, '1-0');
    assert.equal(closed[1].lastEventId, 3);
    assert.equal(open, null);
});

test('two consecutive confirmed resets produce three matches', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', score: '13-5' }),
        ev(60, { map: 'Inferno', score: '1-0' }),
        ev(90, { map: 'Inferno', score: '13-2' }),   // confirms reset 1, continues match 2
        ev(150, { map: 'Inferno', score: '0-1' }),
        ev(180, { map: 'Inferno', score: '1-1' })    // confirms reset 2
    ];
    const { closed, open } = segmentStream(events, at(181), config);
    assert.equal(closed.length, 2);
    assert.equal(closed[0].max_score, '13-5');
    assert.equal(closed[1].max_score, '13-2');
    assert.ok(open);
    assert.equal(open!.max_score, '1-1');
});

test('co-player: an observation older than the staleness bound does not count', () => {
    nextId = 1;
    const seg = segmentStream([
        ev(0, { map: 'Inferno', mode: 'Competitive', score: '5-3' }),
        ev(60, { map: 'Inferno', mode: 'Competitive', score: '6-3' })
    ], at(61), config).open!;

    nextId = 100;
    const stale: PresenceEvent[] = [
        { ...ev(-16 * 60, { map: 'Inferno', mode: 'Competitive', score: '5-3', user: 220 }), steam_id: 'B' }
    ];
    const cos = findCoPlayers(seg, new Map([['B', stale]]), config);
    assert.equal(cos.length, 0);
});

test('deriveRounds: consecutive score observations become per-round outcomes', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', score: '1-0' }),
        ev(60, { map: 'Inferno', score: '1-1' }),
        ev(120, { map: 'Inferno', score: '2-1' }),
        ev(180, { map: 'Inferno', score: '3-1' })
    ];
    assert.deepEqual(deriveRounds(events), ['win', 'loss', 'win', 'win']);
});

test('deriveRounds: a gap between observations still yields the right totals, wins first', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', score: '1-0' }),
        ev(60, { map: 'Inferno', score: '3-2' })  // two wins and two losses were missed
    ];
    assert.deepEqual(deriveRounds(events), ['win', 'win', 'win', 'loss', 'loss']);
});

test('deriveRounds: a stream starting mid-match backfills the opening score', () => {
    nextId = 1;
    assert.deepEqual(
        deriveRounds([ev(0, { map: 'Inferno', score: '2-1' })]),
        ['win', 'win', 'loss']
    );
});

test('deriveRounds: a score dip is skipped as noise, not counted twice on recovery', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', score: '5-3' }),
        ev(60, { map: 'Inferno', score: '1-0' }),  // flaky dip
        ev(120, { map: 'Inferno', score: '6-3' })
    ];
    assert.deepEqual(
        deriveRounds(events),
        ['win', 'win', 'win', 'win', 'win', 'loss', 'loss', 'loss', 'win']
    );
});

test('deriveRounds: unscored events (relaunches, bare presence) are ignored', () => {
    nextId = 1;
    const events = [
        ev(0, { map: 'Inferno', score: '1-0' }),
        ev(30, { playing: false }),
        ev(60, { map: 'Inferno' }),
        ev(90, { map: 'Inferno', score: '1-1' })
    ];
    assert.deepEqual(deriveRounds(events), ['win', 'loss']);
});
