import { GameResult } from '../command/game_history.js';

const NOTABLE_LENGTH = 3;

export default class Streak {
    private constructor(readonly result: 'win' | 'loss', readonly length: number) {}

    static counts(mode?: string): boolean {
        return !!mode && /competitive|premier/i.test(mode);
    }

    // The run that `results`, oldest first, end on.
    static ending(results: GameResult[]): Streak | null {
        const latest = results.at(-1);
        if (latest === undefined || latest === 'tie') {
            return null;
        }
        const broken = [...results].reverse().findIndex(result => result !== latest);
        return new Streak(latest, broken === -1 ? results.length : broken);
    }

    isNotable(): boolean {
        return this.length >= NOTABLE_LENGTH;
    }

    describe(name: string): string {
        return this.result === 'win'
            ? `🔥 ${name}: ${this.length} wins in a row`
            : `💀 ${name}: ${this.length} losses in a row`;
    }
}
