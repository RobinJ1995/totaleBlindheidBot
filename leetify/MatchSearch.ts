import LeetifyDirectory from './LeetifyDirectory.js';
import LeetifyMatch, { PlayedMatch } from './LeetifyMatch.js';

// When, counted from the end of a match, Leetify is asked for it. Overridable for tests.
const SCHEDULE_MS: number[] = (process.env.LEETIFY_POLL_SCHEDULE_MS || '180000,360000,600000,900000,1500000,2400000')
    .split(',').map(Number);
const WINDOW_SLACK_MS = 10 * 60 * 1000;

// Looks for a finished match on Leetify a fixed number of times, then gives up on it.
export default class MatchSearch {
    private readonly attempts: Map<string, { made: number; endedAt: number }> = new Map();

    constructor(
        private readonly directory: LeetifyDirectory,
        private readonly scheduleMs: number[] = SCHEDULE_MS,
        private readonly now: () => number = Date.now
    ) {}

    // Matches that ended longer ago than this are no longer looked for.
    get windowMs(): number {
        return this.scheduleMs.at(-1)! + WINDOW_SLACK_MS;
    }

    isDue(key: string, endedAt: Date): boolean {
        const due: number | undefined = this.scheduleMs[this.attempts.get(key)?.made ?? 0];
        return due !== undefined && this.now() - endedAt.getTime() >= due;
    }

    // Asks one account that is on Leetify, another one each attempt: a match only shows up for
    // accounts that have shared their match history with Leetify.
    async attempt(key: string, steamIds: string[], played: PlayedMatch): Promise<LeetifyMatch | null> {
        const made: number = this.attempts.get(key)?.made ?? 0;
        this.attempts.set(key, { made: made + 1, endedAt: played.endedAt.getTime() });
        this.forgetExpired();

        const attempt = `Leetify lookup ${made + 1}/${this.scheduleMs.length} for end-of-game message ${key}`;
        const turn: number = steamIds.length === 0 ? 0 : made % steamIds.length;
        for (const steamId of [...steamIds.slice(turn), ...steamIds.slice(0, turn)]) {
            const history: LeetifyMatch[] | null = await this.directory.recentMatches(steamId);
            if (history === null) {
                continue;
            }
            const [found] = history
                .filter(match => match.isSameAs(played))
                .sort((a, b) => a.timeDistanceMs(played) - b.timeDistanceMs(played));
            if (!found) {
                const latest: string = history[0]?.finishedAt.toISOString() ?? 'never';
                console.log(`${attempt}: none of the ${history.length} recent matches of Steam ID ${steamId} was played between ${(played.startedAt ?? played.endedAt).toISOString()} and ${played.endedAt.toISOString()} at ${played.score}. Its latest ended ${latest}.`);
                return null;
            }
            console.log(`${attempt}: found match ${found.id} among the recent matches of Steam ID ${steamId}.`);
            return this.directory.match(found.id);
        }
        console.log(`${attempt}: none of the ${steamIds.length} Steam account(s) in the match is on Leetify.`);
        return null;
    }

    private forgetExpired(): void {
        [...this.attempts.entries()]
            .filter(([, attempt]) => this.now() - attempt.endedAt > this.windowMs)
            .forEach(([key]) => this.attempts.delete(key));
    }
}
