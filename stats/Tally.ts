import { GameHistoryEntry } from '../dao/GameHistoryDAO.js';
import { GameResult, scoreResult } from '../command/game_history.js';

// The mode string comes from Steam rich presence (or its raw status fallback), so Premier can
// surface as "premier" or "Premier - Competitive" depending on client/localisation.
export const isCompetitive = (mode?: string): boolean =>
    !!mode && /competitive|premier/i.test(mode);

export class Tally {
    static readonly EMPTY = new Tally(0, 0, 0, 0);

    constructor(
        readonly games: number,
        readonly wins: number,
        readonly losses: number,
        readonly ties: number
    ) {}

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
}

export class TallyGroups<K> {
    private constructor(private readonly byKey: ReadonlyMap<K, Tally>) {}

    static of<K>(entries: GameHistoryEntry[], keyOf: (entry: GameHistoryEntry) => K | undefined): TallyGroups<K> {
        const byKey = new Map<K, Tally>();
        entries.forEach(entry => {
            const key = keyOf(entry);
            if (key !== undefined) {
                byKey.set(key, (byKey.get(key) ?? Tally.EMPTY).add(scoreResult(entry.score)));
            }
        });
        return new TallyGroups(byKey);
    }

    entries(): [K, Tally][] {
        return [...this.byKey.entries()];
    }

    mostPlayed(): [K, Tally] | null {
        return this.entries().reduce<[K, Tally] | null>(
            (best, current) => !best || current[1].games > best[1].games ? current : best,
            null
        );
    }

    // The key with the highest `metric(tally)` share of its games, ties broken by games played.
    pick(metric: (tally: Tally) => number): [K, Tally] | null {
        const share = ([, tally]: [K, Tally]): number => metric(tally) / tally.games;
        const best = this.entries()
            .filter(([, tally]) => tally.games > 0)
            .reduce<[K, Tally] | null>((best, current) => {
                if (!best || share(current) > share(best)) {
                    return current;
                }
                return share(current) === share(best) && current[1].games > best[1].games ? current : best;
            }, null);
        return best && metric(best[1]) > 0 ? best : null;
    }
}
