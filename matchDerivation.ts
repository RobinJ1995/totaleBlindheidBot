// Pure derivation of CS2 matches from a per-Steam-account presence event log.
//
// The bot appends one row to the presence_event table per *transition* in a tracked account's
// presence (started/stopped playing, map/mode change, score change). This module turns such a
// stream back into matches: it segments the events at match boundaries, decides which segments
// are finished, and reconstructs co-players by comparing streams. It is deliberately free of
// I/O and clocks — `now` is a parameter — so the boundary rules are unit-testable and a stream
// can be re-derived at any time with identical results.

export interface PresenceEvent {
    id: number;
    steam_id: string;
    user_id: number;
    playing: boolean;
    map?: string;
    mode?: string;
    raw_score?: string;
    score_total?: number | null;
    player_name?: string;
    created_at: Date;
}

export interface DerivationConfig {
    // Score-total drop (beyond rounds lost to e.g. presence flakiness) that signals a new match.
    resetTolerance: number;
    // How long a stopped, progress-less trailing match waits before it is considered finished.
    matchIdleMs: number;
    // How long an uncontradicted score reset must stand before it becomes a boundary. A dip that
    // returns to the old range within this window (or before any further scored event) is folded
    // away as a flake instead of splitting the match.
    resetConfirmMs: number;
}

// One reconstructed match: a run of events between boundaries, projected to the fields the
// history/announcement layer consumes.
export interface MatchSegment {
    user_id: number;           // latest steam→telegram mapping seen in the segment
    map?: string;              // first non-null map seen
    mode?: string;             // first non-null mode seen
    max_score?: string;        // raw score of the highest-total event seen
    player_name?: string;      // latest non-null Steam display name
    started_at: Date;
    last_event_at: Date;
    playing: boolean;          // last event's flag
    lastEventId: number;       // cursor position once this segment is finalised
    events: PresenceEvent[];
}

export interface StreamDerivation {
    closed: MatchSegment[];    // finished matches, oldest first
    open: MatchSegment | null; // the still-live segment, if any
}

// Parse a raw "16-14" (or "16:14") score into its parts and round total.
export const parseRawScore = (score?: string): { a: number; b: number; total: number } | null => {
    if (!score) return null;
    const m = score.replace(/[\[\]]/g, '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
    if (!m) return null;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    return { a, b, total: a + b };
};

const maxTotal = (seg: MatchSegment): number | null => {
    const parsed = parseRawScore(seg.max_score);
    return parsed ? parsed.total : null;
};

const newSegment = (e: PresenceEvent): MatchSegment => ({
    user_id: e.user_id,
    map: e.map,
    mode: e.mode,
    max_score: e.raw_score,
    player_name: e.player_name,
    started_at: e.created_at,
    last_event_at: e.created_at,
    playing: e.playing,
    lastEventId: e.id,
    events: [e]
});

// Fold a continuation event into a segment: map/mode keep the first non-null value (matching the
// old cur.map || map precedence), the max score only ever moves up, names/attribution track the
// latest observation.
const absorb = (seg: MatchSegment, e: PresenceEvent, countScore: boolean = true): void => {
    if (e.map && !seg.map) seg.map = e.map;
    if (e.mode && !seg.mode) seg.mode = e.mode;
    if (countScore && e.score_total != null) {
        const cur = maxTotal(seg);
        if (cur == null || e.score_total > cur) {
            seg.max_score = e.raw_score;
        }
    }
    if (e.player_name) seg.player_name = e.player_name;
    seg.user_id = e.user_id;
    seg.playing = e.playing;
    seg.last_event_at = e.created_at;
    seg.lastEventId = e.id;
    seg.events.push(e);
};

const mapChanged = (segMap: string | undefined, eMap: string | undefined): boolean =>
    !!(eMap && segMap && eMap.toLowerCase() !== segMap.toLowerCase());

const modeChanged = (segMode: string | undefined, eMode: string | undefined): boolean =>
    !!(eMode && segMode && eMode !== segMode);

// Segment a single account's event stream (ordered by id ascending) into matches.
//
// Boundary rules, relative to the accumulated segment state:
//  - a different map or mode is a boundary immediately;
//  - a score whose total drops more than resetTolerance below the segment max is a *provisional*
//    boundary: it is confirmed by the next scored event staying in the new low range, or by
//    standing uncontradicted for resetConfirmMs; a scored event back in the old range refutes it
//    and the dip is absorbed as noise;
//  - stopping the game is never a boundary (a relaunch resumes the match); it only starts the
//    idle countdown. A stopped segment with no activity for matchIdleMs is closed.
export const segmentStream = (events: PresenceEvent[], now: Date, config: DerivationConfig): StreamDerivation => {
    const closed: MatchSegment[] = [];
    let seg: MatchSegment | null = null;
    // A provisional post-reset segment, kept aside until the reset is confirmed or refuted.
    let pending: MatchSegment | null = null;

    for (const e of events) {
        // Re-process the event against the segment state until it has been absorbed somewhere:
        // confirming a pending reset changes what "the current segment" is, and the event that
        // triggered the confirmation must then be re-evaluated against the new segment.
        let toProcess: PresenceEvent | null = e;
        while (toProcess) {
            const ev = toProcess;
            toProcess = null;

            if (!seg) {
                seg = newSegment(ev);
                continue;
            }

            if (pending) {
                if (ev.score_total != null) {
                    const oldMax = maxTotal(seg);
                    const backInOldRange = oldMax != null && ev.score_total >= oldMax - config.resetTolerance;
                    const vsSegMap = mapChanged(seg.map, ev.map);
                    const vsSegMode = modeChanged(seg.mode, ev.mode);
                    if (backInOldRange && !vsSegMap && !vsSegMode) {
                        // The dip was a flake: fold its events back without letting their scores
                        // drag the max around, and continue the original match.
                        for (const pe of pending.events) absorb(seg, pe, false);
                        pending = null;
                        absorb(seg, ev);
                    } else {
                        // Still in the new low range (or the map/mode moved on): the reset was
                        // real. The old match ends where it stood; the dip started the new one.
                        closed.push(seg);
                        seg = pending;
                        pending = null;
                        toProcess = ev;
                    }
                } else if (mapChanged(pending.map, ev.map) || modeChanged(pending.mode, ev.mode)) {
                    // The nascent segment itself hit a hard boundary: that settles the reset too.
                    closed.push(seg);
                    seg = pending;
                    pending = null;
                    toProcess = ev;
                } else {
                    absorb(pending, ev);
                }
                continue;
            }

            if (mapChanged(seg.map, ev.map) || modeChanged(seg.mode, ev.mode)) {
                closed.push(seg);
                seg = newSegment(ev);
                continue;
            }

            const segMax = maxTotal(seg);
            const reset = ev.score_total != null && segMax != null && ev.score_total < segMax - config.resetTolerance;
            if (reset) {
                pending = newSegment(ev);
                continue;
            }

            absorb(seg, ev);
        }
    }

    // A trailing unresolved reset is confirmed by time alone: if it has stood uncontradicted for
    // the confirmation window, the old match is over. Otherwise it stays provisional — the next
    // derivation (more events, or more time) settles it.
    if (seg && pending) {
        if (now.getTime() - pending.started_at.getTime() >= config.resetConfirmMs) {
            closed.push(seg);
            seg = pending;
            pending = null;
        }
    }

    // Idle: a stopped trailing segment with no activity for the idle window is finished.
    let open: MatchSegment | null = seg;
    if (open && !pending && !open.playing && now.getTime() - open.last_event_at.getTime() >= config.matchIdleMs) {
        closed.push(open);
        open = null;
    }

    return { closed, open };
};

export interface CoPlayer {
    user_id: number;
    player_name?: string;  // their latest Steam display name around the match, as a fallback
}

// Reconstruct who was in the same match as `segment` by replaying the other tracked accounts'
// streams: at each of the segment's observation points, another account is a co-player if its
// state at that moment was in CS2 on a compatible map and mode with a score total within
// tolerance — the same test the live version applied per tick, now answered retrospectively.
// `otherStreams` maps steam_id → that account's events (ordered by id), and may include events
// from before the segment so state-at-time is known; the segment's own account is skipped by
// the caller. Accounts belonging to the segment's own user are skipped here.
export const findCoPlayers = (
    segment: MatchSegment,
    otherStreams: Map<string, PresenceEvent[]>,
    config: DerivationConfig
): CoPlayer[] => {
    const byUser = new Map<number, CoPlayer>();

    for (const [, stream] of otherStreams) {
        if (stream.length === 0) continue;

        let idx = 0;
        // Running view of the segment as it accumulated, so each point-in-time check uses what
        // was known *then* (mirroring the old per-tick collection).
        let runMap: string | undefined;
        let runMode: string | undefined;
        let runMax: number | null = null;

        for (const e of segment.events) {
            if (e.map && !runMap) runMap = e.map;
            if (e.mode && !runMode) runMode = e.mode;
            if (e.score_total != null && (runMax == null || e.score_total > runMax)) {
                runMax = e.score_total;
            }

            // The other account's state at this moment = its last event at or before it.
            while (idx + 1 < stream.length && stream[idx + 1].created_at.getTime() <= e.created_at.getTime()) {
                idx++;
            }
            const o = stream[idx];
            if (o.created_at.getTime() > e.created_at.getTime()) continue; // no state yet
            if (o.user_id === segment.user_id) continue;                   // same user, other account
            if (!o.playing) continue;
            if (mapChanged(runMap, o.map)) continue;
            if (modeChanged(runMode, o.mode)) continue;
            if (runMax != null && o.score_total != null && Math.abs(runMax - o.score_total) > config.resetTolerance) continue;

            const existing = byUser.get(o.user_id);
            if (!existing) {
                byUser.set(o.user_id, { user_id: o.user_id, player_name: o.player_name });
            } else if (o.player_name) {
                existing.player_name = o.player_name;
            }
        }
    }

    return Array.from(byUser.values());
};
