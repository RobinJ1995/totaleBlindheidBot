import { code, Formatted, join } from '../format.js';
import Highlights, { ReportedPlayer } from './Highlights.js';
import { PlayerStats } from './LeetifyMatch.js';

const NAME_WIDTH = 10;
const COLUMN_WIDTH = 4;

// What a finished match's announcement says about its players: a few highlights and a scoreboard.
export default class MatchReport {
    // `lobby` is everyone in the match, whom the players are measured against.
    constructor(private readonly players: ReportedPlayer[], private readonly lobby: PlayerStats[]) {}

    toFormatted(): Formatted {
        return join([...new Highlights(this.players, this.lobby).lines(), ...this.scoreboard().map(code)], '\n');
    }

    private scoreboard(): string[] {
        const row = (name: string, cells: (string | number)[]): string =>
            [...name].slice(0, NAME_WIDTH).join('').padEnd(NAME_WIDTH) + cells.map(cell => String(cell).padStart(COLUMN_WIDTH)).join('');
        return [
            row('Player', ['K', 'D', 'A', 'ADR']),
            ...[...this.players]
                .sort((a, b) => b.stats.total_kills - a.stats.total_kills)
                .map(({ name, stats }) => row(name, [stats.total_kills, stats.total_deaths, stats.total_assists, Math.round(stats.dpr)]))
        ];
    }
}
