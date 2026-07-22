import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter.js';
import GameHistoryDAO, { GameHistoryEntry } from '../dao/GameHistoryDAO.js';
import { escapeMarkdown, formatError } from '../utils.js';
import { GameResult, parseScore, scoreResult } from './game_history.js';

const dao = new GameHistoryDAO();

const TOP_N = 3;

interface Tally {
    games: number;
    wins: number;
    losses: number;
    ties: number;
}

const emptyTally = (): Tally => ({ games: 0, wins: 0, losses: 0, ties: 0 });

const addResult = (tally: Tally, result: GameResult | null): void => {
    tally.games += 1;
    if (result === 'win') tally.wins += 1;
    else if (result === 'loss') tally.losses += 1;
    else if (result === 'tie') tally.ties += 1;
};

const tallyInto = <K>(map: Map<K, Tally>, key: K, result: GameResult | null): Tally => {
    let tally = map.get(key);
    if (!tally) {
        tally = emptyTally();
        map.set(key, tally);
    }
    addResult(tally, result);
    return tally;
};

const percent = (part: number, whole: number): string =>
    whole === 0 ? '0%' : `${Math.round((part / whole) * 100)}%`;

const record = (t: Tally): string => `${t.wins}W-${t.losses}L-${t.ties}T`;

const nGames = (n: number): string => n === 1 ? '1 game' : `${n} games`;

const formatDuration = (ms: number): string => {
    const minutes = Math.round(ms / 60000);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
};

// Render a name without pinging the user (zero-width space breaks the @mention).
const safeName = (name: string): string => escapeMarkdown(name).replace('@', '@​');

const topEntries = <K>(map: Map<K, Tally>): [K, Tally][] =>
    [...map.entries()].sort((a, b) => b[1].games - a[1].games).slice(0, TOP_N);

export const renderStats = (entries: GameHistoryEntry[]): string => {
    const total = emptyTally();
    const byMap = new Map<string, Tally>();
    const byMode = new Map<string, Tally>();
    const byTeammate = new Map<string, Tally>();
    let roundsWon = 0;
    let roundsLost = 0;
    let playtimeMs = 0;
    let timedGames = 0;
    let longestWinStreak = 0;
    let winStreak = 0;
    let currentRun: { result: GameResult, length: number } | null = null;

    // Entries come back chronologically (oldest first), which the streaks rely on.
    for (const entry of entries) {
        const result = scoreResult(entry.score);
        addResult(total, result);
        if (entry.map) tallyInto(byMap, entry.map, result);
        if (entry.mode) tallyInto(byMode, entry.mode, result);
        for (const co of entry.co_players) {
            tallyInto(byTeammate, co.name, result);
        }

        const parsed = parseScore(entry.score);
        if (parsed) {
            roundsWon += parsed.us;
            roundsLost += parsed.them;
        }

        if (entry.started_at && entry.ended_at > entry.started_at) {
            playtimeMs += entry.ended_at.getTime() - entry.started_at.getTime();
            timedGames += 1;
        }

        if (result) {
            winStreak = result === 'win' ? winStreak + 1 : 0;
            longestWinStreak = Math.max(longestWinStreak, winStreak);
            if (currentRun && currentRun.result === result) {
                currentRun.length += 1;
            } else {
                currentRun = { result, length: 1 };
            }
        }
    }

    const lines: string[] = [];
    const decisive = total.wins + total.losses + total.ties;

    lines.push(`🎮 *Games:* ${total.games} (${record(total)})`);
    if (decisive > 0) {
        lines.push(`🏆 *Win rate:* ${percent(total.wins, decisive)}`);
    }
    if (roundsWon + roundsLost > 0) {
        lines.push(`🔫 *Rounds:* ${roundsWon}-${roundsLost} (${percent(roundsWon, roundsWon + roundsLost)})`);
    }
    if (longestWinStreak > 1) {
        lines.push(`🔥 *Longest win streak:* ${longestWinStreak}`);
    }
    if (currentRun && currentRun.length > 1) {
        const label = { win: 'wins', loss: 'losses', tie: 'ties' }[currentRun.result];
        lines.push(`📈 *Current streak:* ${currentRun.length} ${label}`);
    }
    if (playtimeMs > 0) {
        lines.push(`⏱ *Playtime:* ${formatDuration(playtimeMs)} over ${nGames(timedGames)} ` +
            `(avg ${formatDuration(playtimeMs / timedGames)})`);
    }

    const mapLines = topEntries(byMap)
        .map(([map, t]) => `  ${escapeMarkdown(map)}: ${nGames(t.games)}, ${record(t)}`);
    if (mapLines.length > 0) {
        lines.push('🗺 *Maps:*', ...mapLines);
    }

    const modeLines = topEntries(byMode)
        .map(([mode, t]) => `  ${escapeMarkdown(mode)}: ${nGames(t.games)}, ${record(t)}`);
    if (modeLines.length > 0) {
        lines.push('🕹 *Modes:*', ...modeLines);
    }

    const teammateLines = topEntries(byTeammate)
        .map(([name, t]) => `  ${safeName(name)}: ${nGames(t.games)} together, ${record(t)}`);
    if (teammateLines.length > 0) {
        lines.push('👥 *Teammates:*', ...teammateLines);
    }

    return lines.join('\n');
};

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    dao.getGameHistory(msg.chat.id, msg.from!.id)
        .then((entries: GameHistoryEntry[]) => {
            if (entries.length === 0) {
                msg.reply('No game history yet.');
                return;
            }
            msg.reply(renderStats(entries));
        })
        .catch((err: Error) => msg.reply(formatError(err)));
};
