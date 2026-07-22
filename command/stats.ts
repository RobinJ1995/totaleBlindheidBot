import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter.js';
import GameHistoryDAO, { GameHistoryEntry } from '../dao/GameHistoryDAO.js';
import { formatError } from '../utils.js';
import { GameResult, parseScore, scoreResult } from './game_history.js';

const dao = new GameHistoryDAO();

// The mode string comes from Steam rich presence (or its raw status fallback), so Premier can
// surface as "premier" or "Premier - Competitive" depending on client/localisation.
const isCompetitive = (mode?: string): boolean =>
    !!mode && /competitive|premier/i.test(mode);

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

const percent = (part: number, whole: number): string =>
    whole === 0 ? '0%' : `${Math.round((part / whole) * 100)}%`;

const formatDuration = (ms: number): string => {
    const minutes = Math.round(ms / 60000);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
};

// The map with the highest `metric(tally)` share of its games, ties broken by games played.
const pickMap = (byMap: Map<string, Tally>, metric: (t: Tally) => number): [string, Tally] | null => {
    let best: [string, Tally] | null = null;
    for (const [map, t] of byMap.entries()) {
        if (t.games === 0) continue;
        if (!best
            || metric(t) / t.games > metric(best[1]) / best[1].games
            || (metric(t) / t.games === metric(best[1]) / best[1].games && t.games > best[1].games)) {
            best = [map, t];
        }
    }
    return best && metric(best[1]) > 0 ? best : null;
};

export const renderStats = (entries: GameHistoryEntry[]): string | null => {
    const competitive = entries.filter(e => isCompetitive(e.mode));
    if (competitive.length === 0) return null;

    const total = emptyTally();
    const byMap = new Map<string, Tally>();
    let roundsWon = 0;
    let roundsLost = 0;
    let playtimeMs = 0;
    let longestWinStreak = 0;
    let longestLossStreak = 0;
    let winStreak = 0;
    let lossStreak = 0;
    let currentRun: { result: GameResult, length: number } | null = null;

    // Entries come back chronologically (oldest first), which the streaks rely on.
    for (const entry of competitive) {
        const result = scoreResult(entry.score);
        addResult(total, result);
        if (entry.map) {
            let tally = byMap.get(entry.map);
            if (!tally) {
                tally = emptyTally();
                byMap.set(entry.map, tally);
            }
            addResult(tally, result);
        }

        const parsed = parseScore(entry.score);
        if (parsed) {
            roundsWon += parsed.us;
            roundsLost += parsed.them;
        }

        if (entry.started_at && entry.ended_at > entry.started_at) {
            playtimeMs += entry.ended_at.getTime() - entry.started_at.getTime();
        }

        if (result) {
            winStreak = result === 'win' ? winStreak + 1 : 0;
            lossStreak = result === 'loss' ? lossStreak + 1 : 0;
            longestWinStreak = Math.max(longestWinStreak, winStreak);
            longestLossStreak = Math.max(longestLossStreak, lossStreak);
            if (currentRun && currentRun.result === result) {
                currentRun.length += 1;
            } else {
                currentRun = { result, length: 1 };
            }
        }
    }

    const rows: [string, string][] = [];
    const decisive = total.wins + total.losses + total.ties;

    rows.push(['Competitive games', `${total.games} (${total.wins}W-${total.losses}L-${total.ties}T)`]);
    if (decisive > 0) {
        rows.push(['Win rate', percent(total.wins, decisive)]);
    }
    if (roundsWon + roundsLost > 0) {
        rows.push(['Rounds', `${roundsWon}-${roundsLost} (${percent(roundsWon, roundsWon + roundsLost)})`]);
    }
    if (longestWinStreak > 0) {
        rows.push(['Longest win streak', String(longestWinStreak)]);
    }
    if (longestLossStreak > 0) {
        rows.push(['Longest loss streak', String(longestLossStreak)]);
    }
    if (currentRun) {
        const label = { win: 'win', loss: 'loss', tie: 'tie' }[currentRun.result];
        rows.push(['Current streak', `${currentRun.length} ${label}${currentRun.length === 1 ? '' : currentRun.result === 'loss' ? 'es' : 's'}`]);
    }
    if (playtimeMs > 0) {
        rows.push(['Playtime', formatDuration(playtimeMs)]);
    }

    let favourite: [string, Tally] | null = null;
    for (const [map, t] of byMap.entries()) {
        if (!favourite || t.games > favourite[1].games) {
            favourite = [map, t];
        }
    }
    if (favourite) {
        rows.push(['Favourite map', `${favourite[0]} (${favourite[1].games} games)`]);
    }
    const bestMap = pickMap(byMap, t => t.wins);
    if (bestMap) {
        rows.push(['Best map', `${bestMap[0]} (${percent(bestMap[1].wins, bestMap[1].games)} won)`]);
    }
    const worstMap = pickMap(byMap, t => t.losses);
    if (worstMap) {
        rows.push(['Worst map', `${worstMap[0]} (${percent(worstMap[1].losses, worstMap[1].games)} lost)`]);
    }

    // Telegram has no real table markup; a monospace block with padded columns is the
    // conventional equivalent. No markdown escaping inside the code block.
    const labelWidth = Math.max(...rows.map(([label]) => label.length));
    const table = rows.map(([label, value]) => `${label.padEnd(labelWidth)}  ${value}`).join('\n');
    return '```\n' + table + '\n```';
};

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    dao.getGameHistory(msg.chat.id, msg.from!.id)
        .then((entries: GameHistoryEntry[]) => {
            const text = renderStats(entries);
            msg.reply(text ?? 'No competitive games in your history yet.');
        })
        .catch((err: Error) => msg.reply(formatError(err)));
};
