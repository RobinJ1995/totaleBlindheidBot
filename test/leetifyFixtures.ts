import LeetifyMatch, { MatchData, PlayerStats } from '../leetify/LeetifyMatch.js';

export const playerStats = (steam64_id: string, overrides: Partial<PlayerStats> = {}): PlayerStats => ({
    steam64_id,
    initial_team_number: 2,
    total_kills: 10,
    total_deaths: 10,
    total_assists: 2,
    dpr: 70,
    kd_ratio: 1,
    total_hs_kills: 3,
    mvps: 2,
    multi4k: 0,
    multi5k: 0,
    rounds_count: 20,
    rounds_survived: 10,
    flashbang_hit_friend: 0,
    flash_assist: 0,
    shots_hit_friend: 0,
    he_friends_damage_avg: 0,
    utility_on_death_avg: 100,
    reaction_time: 0.5,
    ...overrides
});

export const leetifyMatch = (overrides: Partial<MatchData> = {}): LeetifyMatch => new LeetifyMatch({
    id: 'match-1',
    finished_at: '2026-11-12T20:00:00.000Z',
    data_source: 'matchmaking',
    team_scores: [{ team_number: 2, score: 13 }, { team_number: 3, score: 7 }],
    stats: [playerStats('1')],
    ...overrides
});

// A ranked match `minutesAgo` before 20:00 that player `steamId` won or lost.
export const playedMatch = (steamId: string, minutesAgo: number, won: boolean, overrides: Partial<MatchData> = {}): LeetifyMatch => leetifyMatch({
    id: `played-${minutesAgo}`,
    finished_at: new Date(Date.parse('2026-11-12T20:00:00.000Z') - minutesAgo * 60_000).toISOString(),
    team_scores: [{ team_number: 2, score: won ? 13 : 5 }, { team_number: 3, score: won ? 5 : 13 }],
    stats: [playerStats(steamId)],
    ...overrides
});
