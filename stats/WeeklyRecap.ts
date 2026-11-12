import { GameHistoryEntry } from '../dao/GameHistoryDAO.js';
import { scoreResult } from '../command/game_history.js';
import { bold, fmt, Formatted } from '../format.js';
import { Tally, TallyGroups } from './Tally.js';

const MIN_DUO_GAMES = 2;

interface Match {
    entry: GameHistoryEntry;
    players: number[];
}

const games = (count: number): string => `${count} game${count === 1 ? '' : 's'}`;

const won = (tally: Tally): string => `${tally.wins}/${tally.games} won`;

export default class WeeklyRecap {
    private constructor(private readonly matches: Match[], private readonly names: ReadonlyMap<number, string>) {}

    // Rows announced in one message are the same match seen by several players.
    static of(entries: GameHistoryEntry[]): WeeklyRecap {
        const byMatch = entries.reduce((groups, entry) => {
            const key = entry.message_id == null ? `row${entry.id}` : `msg${entry.message_id}`;
            return groups.set(key, [...(groups.get(key) || []), entry]);
        }, new Map<string, GameHistoryEntry[]>());
        const matches = [...byMatch.values()].map(rows => ({
            entry: rows[0],
            players: [...new Set(rows.flatMap(row => [row.user_id, ...row.co_players.map(co => co.tg_user_id)]))].sort((a, b) => a - b)
        }));
        const names = new Map<number, string>([
            ...entries.flatMap(entry => entry.co_players.map((co): [number, string] => [co.tg_user_id, co.name])),
            ...entries.map((entry): [number, string] => [entry.user_id, entry.player_name || String(entry.user_id)])
        ]);
        return new WeeklyRecap(matches, names);
    }

    get games(): number {
        return this.matches.length;
    }

    render(): Formatted {
        const total = this.matches.reduce((tally, match) => tally.add(scoreResult(match.entry.score)), Tally.EMPTY);
        const ties = total.ties > 0 ? ` ${total.ties}T` : '';
        const map = TallyGroups.of(this.matches.map(match => match.entry), entry => entry.map).pick(tally => tally.wins);
        const active = this.groupedBy(match => match.players).mostPlayed();
        const duo = this.groupedBy(match => this.pairs(match.players)).pick(tally => tally.games >= MIN_DUO_GAMES ? tally.wins : 0);
        const lines = [
            map ? `\nBest map: ${map[0]} (${won(map[1])})` : '',
            active ? `\nMost active: ${this.names.get(active[0])} (${games(active[1].games)})` : '',
            duo ? `\nBest duo: ${duo[0]} (${won(duo[1])})` : ''
        ].join('');
        return fmt`📅 ${bold('Weekly recap')}: ${games(this.games)}, ${total.wins}W ${total.losses}L${ties}${lines}`;
    }

    private pairs(players: number[]): string[] {
        return players.flatMap((a, i) => players.slice(i + 1).map(b => `${this.names.get(a)} & ${this.names.get(b)}`));
    }

    // A match counts once towards each of its keys.
    private groupedBy<K>(keysOf: (match: Match) => K[]): TallyGroups<K> {
        const keyed = this.matches.flatMap(match => keysOf(match).map(key => ({ key, entry: { ...match.entry } })));
        const keyOf = new Map<GameHistoryEntry, K>(keyed.map(({ key, entry }) => [entry, key]));
        return TallyGroups.of(keyed.map(({ entry }) => entry), entry => keyOf.get(entry));
    }
}
