import { GameResult } from '../command/game_history.js';
import { Formatted } from '../format.js';
import Streak from '../stats/Streak.js';
import LeetifyDirectory from './LeetifyDirectory.js';
import LeetifyMatch from './LeetifyMatch.js';
import MatchReport, { ReportedPlayer } from './MatchReport.js';

export interface Participant {
    name: string;
    steamIds: string[];
    // Shown for a participant whose matches Leetify does not have.
    streak?: Streak | null;
}

export default class MatchInsights {
    constructor(private readonly directory: LeetifyDirectory) {}

    // Null when Leetify has none of the participants in the match.
    async report(matchId: string, participants: Participant[]): Promise<Formatted | null> {
        const match: LeetifyMatch = await this.directory.match(matchId);
        const players: (ReportedPlayer | null)[] = await Promise.all(participants.map(async ({ name, steamIds, streak }) => {
            const stats = match.statsOf(steamIds);
            return stats ? { name, stats, streak: await this.streak(stats.steam64_id, match, streak ?? null) } : null;
        }));
        const reported: ReportedPlayer[] = players.filter((player): player is ReportedPlayer => player !== null);
        return reported.length > 0 ? new MatchReport(reported).toFormatted() : null;
    }

    // The player's run of ranked matches as of `match`, or `fallback` when Leetify does not have their matches.
    private async streak(steamId: string, match: LeetifyMatch, fallback: Streak | null): Promise<Streak | null> {
        const history: LeetifyMatch[] | null = await this.directory.recentMatches(steamId)
            .catch((err: Error) => {
                console.error(`Could not load the Leetify matches of Steam ID ${steamId}:`, err);
                return null;
            });
        if (history === null) {
            return fallback;
        } else if (!match.isRanked()) {
            return null;
        }
        const results: GameResult[] = history
            .filter(played => played.isRanked() && played.finishedAt.getTime() <= match.finishedAt.getTime())
            .sort((a, b) => a.finishedAt.getTime() - b.finishedAt.getTime())
            .map(played => played.resultFor(steamId))
            .filter((result): result is GameResult => result !== null);
        return Streak.ending(results);
    }
}
