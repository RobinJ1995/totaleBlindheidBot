import { fmt, Formatted, join, pre } from '../format.js';
import Streak from '../stats/Streak.js';
import { PlayerStats } from './LeetifyMatch.js';

export interface ReportedPlayer {
    name: string;
    stats: PlayerStats;
    streak: Streak | null;
}

const NOTABLE_TEAM_FLASHES = 8;
const MAX_HIGHLIGHTS = 4;
const NAME_WIDTH = 10;
const COLUMN_WIDTH = 4;

const times = (count: number, once: string, many: string): string => count === 1 ? once : `${count} ${many}`;

// What a finished match's announcement says about its players: a few highlights and a scoreboard.
export default class MatchReport {
    constructor(private readonly players: ReportedPlayer[]) {}

    toFormatted(): Formatted {
        return join([...this.highlights().slice(0, MAX_HIGHLIGHTS), pre(this.scoreboard())], '\n');
    }

    private highlights(): string[] {
        const multiKills: string[] = this.players
            .map(({ name, stats }) => ({
                name,
                feats: [
                    ...(stats.multi5k > 0 ? [times(stats.multi5k, 'ace', 'aces')] : []),
                    ...(stats.multi4k > 0 ? [times(stats.multi4k, '4k', '4ks')] : [])
                ]
            }))
            .filter(({ feats }) => feats.length > 0)
            .map(({ name, feats }) => `💥 ${name}: ${feats.join(', ')}`);
        const teamFlashes: string[] = this.players
            .filter(({ stats }) => stats.flashbang_hit_friend >= NOTABLE_TEAM_FLASHES)
            .map(({ name, stats }) => `😵 ${name} flashed teammates ${stats.flashbang_hit_friend} times`);
        const streaks: string[] = this.players
            .filter(({ streak }) => streak?.isNotable())
            .map(({ name, streak }) => streak!.describe(name));
        return [...multiKills, ...teamFlashes, ...streaks];
    }

    private scoreboard(): string {
        const row = (name: string, cells: (string | number)[]): string =>
            [...name].slice(0, NAME_WIDTH).join('').padEnd(NAME_WIDTH) + cells.map(cell => String(cell).padStart(COLUMN_WIDTH)).join('');
        return [
            row('Player', ['K', 'D', 'A', 'ADR']),
            ...[...this.players]
                .sort((a, b) => b.stats.total_kills - a.stats.total_kills)
                .map(({ name, stats }) => row(name, [stats.total_kills, stats.total_deaths, stats.total_assists, Math.round(stats.dpr)]))
        ].join('\n');
    }
}
