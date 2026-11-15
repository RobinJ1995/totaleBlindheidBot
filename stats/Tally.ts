import { GameHistoryEntry } from '../dao/GameHistoryDAO.js';
import { GameResult, scoreResult } from '../command/game_history.js';

// The mode string comes from Steam rich presence (or its raw status fallback), so Premier can
// surface as "premier" or "Premier - Competitive" depending on client/localisation.
export const isCompetitive = (mode?: string): boolean =>
    !!mode && /competitive|premier/i.test(mode);

export class Ratio {
    constructor(private readonly part: number, private readonly whole: number) {}

    percent(): string {
        return this.whole === 0 ? '0%' : `${Math.round((this.part / this.whole) * 100)}%`;
    }

    // Renders inside the monospace block so the filled/empty cells line up.
    bar(): string {
        const filled = this.whole === 0 ? 0 : Math.round((this.part / this.whole) * 10);
        return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${this.percent()}`;
    }
}

export class Tally {
    static readonly EMPTY = new Tally(0, 0, 0, 0);

    constructor(
        readonly games: number,
        readonly wins: number,
        readonly losses: number,
        readonly ties: number
    ) {}

    static of(entries: GameHistoryEntry[]): Tally {
        return entries.reduce((tally, entry) => tally.add(scoreResult(entry.score)), Tally.EMPTY);
    }

    get decisive(): number {
        return this.wins + this.losses + this.ties;
    }

    add(result: GameResult | null): Tally {
        return new Tally(
            this.games + 1,
            this.wins + (result === 'win' ? 1 : 0),
            this.losses + (result === 'loss' ? 1 : 0),
            this.ties + (result === 'tie' ? 1 : 0)
        );
    }

    summary(): string {
        return `${new Ratio(this.wins, this.decisive).bar()} (${this.games} game${this.games === 1 ? '' : 's'})`;
    }
}
