import { GameHistoryEntry } from '../dao/GameHistoryDAO.js';
import { bold, fmt, Formatted } from '../format.js';
import { isCompetitive, Ratio, Tally, TallyGroups } from './Tally.js';

type MapTally = [string, Tally];

export class MapPick {
    private constructor(
        private readonly players: string[],
        private readonly best: MapTally | null,
        private readonly worst: MapTally | null,
        private readonly minGames: number
    ) {}

    static of(entries: GameHistoryEntry[], user_ids: number[], names: ReadonlyMap<number, string>, minGames: number): MapPick {
        const lobby = entries.filter(entry => user_ids.includes(entry.user_id) && isCompetitive(entry.mode));
        const maps = TallyGroups.of(lobby, entry => entry.map).filter((map, tally) => tally.games >= minGames);
        const best = maps.pick(tally => tally.wins);
        const worst = maps.filter(map => map !== best?.[0]).pick(tally => tally.losses);
        const players = user_ids.flatMap(user_id => names.get(user_id) ?? []).sort();
        return new MapPick(players, best, worst, minGames);
    }

    render(): Formatted {
        if (!this.best && !this.worst) {
            return fmt`No map has ${this.minGames} competitive games for this lobby yet.`;
        }
        const lines = [
            this.best && `Play: ${this.describe(this.best, tally => tally.wins, 'won')}`,
            this.worst && `Avoid: ${this.describe(this.worst, tally => tally.losses, 'lost')}`
        ].filter(Boolean);
        return fmt`${bold(`🗺️ Map pick for ${this.players.join(', ')}`)}\n${lines.join('\n')}`;
    }

    private describe([map, tally]: MapTally, metric: (tally: Tally) => number, verb: string): string {
        return `${map} (${new Ratio(metric(tally), tally.games).percent()} ${verb}, ${tally.games} game${tally.games === 1 ? '' : 's'})`;
    }
}
