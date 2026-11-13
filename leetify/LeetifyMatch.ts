import { GameResult } from '../command/game_history.js';
import { parseRawScore } from '../matchDerivation.js';

export interface PlayerStats {
    steam64_id: string;
    initial_team_number: number;
    total_kills: number;
    total_deaths: number;
    total_assists: number;
    // Average damage per round.
    dpr: number;
    multi4k: number;
    multi5k: number;
    flashbang_hit_friend: number;
}

export interface MatchData {
    id: string;
    finished_at: string;
    data_source: string;
    team_scores: { team_number: number; score: number }[];
    stats: PlayerStats[];
}

// A match as the bot saw it end on Steam.
export interface PlayedMatch {
    score?: string;
    endedAt: Date;
}

const RANKED_SOURCES: string[] = ['matchmaking', 'matchmaking_competitive'];
const END_TOLERANCE_MS = 15 * 60 * 1000;
// Steam presence can miss the last rounds of a match.
const ROUND_TOLERANCE = 2;

export default class LeetifyMatch {
    constructor(private readonly data: MatchData) {}

    get id(): string {
        return this.data.id;
    }

    get finishedAt(): Date {
        return new Date(this.data.finished_at);
    }

    isRanked(): boolean {
        return RANKED_SOURCES.includes(this.data.data_source);
    }

    endDistanceMs(played: PlayedMatch): number {
        return Math.abs(this.finishedAt.getTime() - played.endedAt.getTime());
    }

    isSameAs(played: PlayedMatch): boolean {
        const score = parseRawScore(played.score);
        const rounds: number = this.data.team_scores.reduce((total, team) => total + team.score, 0);
        return !!score
            && Math.abs(rounds - score.total) <= ROUND_TOLERANCE
            && this.endDistanceMs(played) <= END_TOLERANCE_MS;
    }

    statsOf(steamIds: string[]): PlayerStats | undefined {
        return this.data.stats.find(stats => steamIds.includes(stats.steam64_id));
    }

    resultFor(steamId: string): GameResult | null {
        const team: number | undefined = this.statsOf([steamId])?.initial_team_number;
        const own = this.data.team_scores.find(score => score.team_number === team);
        const other = this.data.team_scores.find(score => score.team_number !== team);
        if (!own || !other) {
            return null;
        } else if (own.score === other.score) {
            return 'tie';
        }
        return own.score > other.score ? 'win' : 'loss';
    }
}
