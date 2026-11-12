import { ChatMatch } from '../dao/GameHistoryDAO.js';
import { GameResult, scoreResult } from '../command/game_history.js';
import { bold, fmt, Formatted } from '../format.js';

const MIN_GAMES = 2;

interface Match {
    result: GameResult | null;
    map?: string;
    durationMs: number;
}

const formatDuration = (ms: number): string => {
    const minutes = Math.round(ms / 60000);
    const hours = Math.floor(minutes / 60);
    return hours === 0 ? `${minutes}m` : `${hours}h ${minutes % 60}m`;
};

export default class SessionSummary {
    private constructor(private readonly matches: Match[]) {}

    // Rows announced in one message are the same match seen by several players.
    static of(rows: ChatMatch[]): SessionSummary {
        const byMatch = rows.reduce((groups, row) => {
            const key = row.message_id == null ? `row${row.id}` : `msg${row.message_id}`;
            return groups.set(key, [...(groups.get(key) || []), row]);
        }, new Map<string, ChatMatch[]>());
        return new SessionSummary([...byMatch.values()].map(group => {
            const starts = group.flatMap(row => row.started_at ? [row.started_at.getTime()] : []);
            const end = Math.max(...group.map(row => row.ended_at.getTime()));
            return {
                result: scoreResult(group[0].score),
                map: group[0].map,
                durationMs: starts.length === 0 ? 0 : end - Math.min(...starts)
            };
        }));
    }

    get games(): number {
        return this.matches.length;
    }

    isWorthSending(): boolean {
        return this.games >= MIN_GAMES;
    }

    render(): Formatted {
        const count = (result: GameResult): number => this.matches.filter(match => match.result === result).length;
        const ties = count('tie');
        const record = `${count('win')}W ${count('loss')}L${ties > 0 ? ` ${ties}T` : ''}`;
        const durationMs = this.matches.reduce((total, match) => total + match.durationMs, 0);
        return fmt`📊 ${bold('Session summary')}: ${this.games} games, ${record}\nMaps: ${this.mapList()}\nTime in matches: ${formatDuration(durationMs)}`;
    }

    private mapList(): string {
        const counts = this.matches
            .flatMap(match => match.map ? [match.map] : [])
            .reduce((acc, map) => acc.set(map, (acc.get(map) || 0) + 1), new Map<string, number>());
        return [...counts.entries()]
            .sort(([, a], [, b]) => b - a)
            .map(([map, times]) => times > 1 ? `${map} ×${times}` : map)
            .join(', ');
    }
}
