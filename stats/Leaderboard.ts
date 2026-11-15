import { GameHistoryEntry } from '../dao/GameHistoryDAO.js';
import { bold, fmt, Formatted } from '../format.js';
import { isCompetitive, Ratio, Tally, TallyGroups } from './Tally.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const PERIODS: Record<string, { days: number; label: string }> = {
    week: { days: 7, label: 'past week' },
    month: { days: 30, label: 'past month' }
};

const MODES: Record<string, { label: string; matches: (mode: string) => boolean }> = {
    premier: { label: 'Premier', matches: mode => /premier/i.test(mode) },
    competitive: { label: 'Competitive', matches: mode => !/premier/i.test(mode) }
};

export class LeaderboardFilter {
    private constructor(
        private readonly map: string | undefined,
        private readonly mode: string | undefined,
        private readonly period: string | undefined,
        readonly since: Date | undefined
    ) {}

    static parse(tokens: string[], now: Date): LeaderboardFilter {
        const lower = tokens.map(token => token.toLowerCase());
        const period = lower.find(token => token in PERIODS);
        const mode = lower.find(token => token in MODES);
        const map = lower.filter(token => token !== period && token !== mode).join(' ');
        const since = period ? new Date(now.getTime() - PERIODS[period].days * DAY_MS) : undefined;
        return new LeaderboardFilter(map || undefined, mode, period, since);
    }

    readonly matches = (entry: GameHistoryEntry): boolean =>
        isCompetitive(entry.mode)
        && (!this.mode || MODES[this.mode].matches(entry.mode!))
        && (!this.map || entry.map?.toLowerCase() === this.map)
        && (!this.since || entry.ended_at >= this.since);

    private mapName(entries: GameHistoryEntry[]): string | undefined {
        return this.map && (entries.find(entry => entry.map?.toLowerCase() === this.map)?.map ?? this.map);
    }

    title(entries: GameHistoryEntry[]): string {
        const parts = [
            this.mapName(entries),
            this.mode && MODES[this.mode].label,
            this.period && PERIODS[this.period].label
        ].filter(Boolean);
        return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
    }

    description(entries: GameHistoryEntry[]): string {
        return [
            this.map && ` on ${this.mapName(entries)}`,
            this.mode && ` in ${MODES[this.mode].label}`,
            this.period && ` in the ${PERIODS[this.period].label}`
        ].filter(Boolean).join('');
    }
}

const winRate = (tally: Tally): number => tally.decisive === 0 ? 0 : tally.wins / tally.decisive;

export class Leaderboard {
    private constructor(
        private readonly rows: { name: string; tally: Tally }[],
        private readonly filter: LeaderboardFilter,
        private readonly entries: GameHistoryEntry[],
        private readonly minGames: number
    ) {}

    static of(entries: GameHistoryEntry[], filter: LeaderboardFilter, names: ReadonlyMap<number, string>, minGames: number): Leaderboard {
        const matching = entries.filter(filter.matches);
        const rows = TallyGroups.of(matching, entry => entry.user_id).entries()
            .filter(([, tally]) => tally.games >= minGames)
            .map(([user_id, tally]) => ({ name: names.get(user_id) ?? String(user_id), tally }))
            .sort((a, b) => winRate(b.tally) - winRate(a.tally) || b.tally.games - a.tally.games || a.name.localeCompare(b.name));
        return new Leaderboard(rows, filter, entries, minGames);
    }

    render(): Formatted {
        if (this.rows.length === 0) {
            return fmt`Nobody has played ${this.minGames} competitive games${this.filter.description(this.entries)} yet.`;
        }
        const lines = this.rows.map(({ name, tally }, i) =>
            `${i + 1}. ${name}: ${new Ratio(tally.wins, tally.decisive).bar()} (${tally.games} game${tally.games === 1 ? '' : 's'})`);
        return fmt`${bold(`🏆 Leaderboard${this.filter.title(this.entries)}`)}\n${lines.join('\n')}`;
    }
}
