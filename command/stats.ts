import { Bot } from 'node-telegram-bot-api';
import { Command } from '../MessageRouter.js';
import GameHistoryDAO, { GameHistoryEntry } from '../dao/GameHistoryDAO.js';
import { formatError } from '../utils.js';
import { bold, fmt, Formatted, join } from '../format.js';
import { GameResult, parseScore, scoreResult } from './game_history.js';
import { resolvePlayerTarget } from './playerArg.js';
import { isCompetitive, Ratio, Tally, TallyGroups } from '../stats/Tally.js';

const dao = new GameHistoryDAO();

const formatDuration = (ms: number): string => {
    const minutes = Math.round(ms / 60000);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) {
        return `${m}m`;
    }
    return `${h}h ${m}m`;
};

export const renderStats = (entries: GameHistoryEntry[]): Formatted | null => {
    const competitive = entries.filter(e => isCompetitive(e.mode));
    if (competitive.length === 0) {
        return null;
    }

    const total = competitive.reduce((tally, entry) => tally.add(scoreResult(entry.score)), Tally.EMPTY);
    const byMap = TallyGroups.of(competitive, entry => entry.map);
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

    const decisive = total.decisive;

    // Grouped into sections so the reply reads top-to-bottom: the headline record, then how
    // those results clustered, then per-map breakdown. Each section only appears if it has rows.
    const overview: [string, string][] = [];
    overview.push(['Competitive games', `${total.games} (${total.wins} won, ${total.losses} lost, ${total.ties} tied)`]);
    if (decisive > 0) {
        overview.push(['Win rate', new Ratio(total.wins, decisive).bar()]);
    }
    if (roundsWon + roundsLost > 0) {
        overview.push(['Rounds', `${roundsWon}-${roundsLost}  (${new Ratio(roundsWon, roundsWon + roundsLost).percent()})`]);
    }
    if (playtimeMs > 0) {
        overview.push(['Playtime', formatDuration(playtimeMs)]);
    }

    const streaks: [string, string][] = [];
    if (longestWinStreak > 0) {
        streaks.push(['Longest win streak', String(longestWinStreak)]);
    }
    if (longestLossStreak > 0) {
        streaks.push(['Longest loss streak', String(longestLossStreak)]);
    }
    if (currentRun) {
        const label = { win: 'win', loss: 'loss', tie: 'tie' }[currentRun.result];
        streaks.push(['Current streak', `${currentRun.length} ${label}${currentRun.length === 1 ? '' : currentRun.result === 'loss' ? 'es' : 's'}`]);
    }

    const maps: [string, string][] = [];
    const favourite = byMap.mostPlayed();
    if (favourite) {
        maps.push(['Favourite map', `${favourite[0]} (${favourite[1].games} games)`]);
    }
    const bestMap = byMap.pick(t => t.wins);
    if (bestMap) {
        maps.push(['Best map', `${bestMap[0]} (${new Ratio(bestMap[1].wins, bestMap[1].games).percent()} won)`]);
    }
    const worstMap = byMap.pick(t => t.losses);
    if (worstMap) {
        maps.push(['Worst map', `${worstMap[0]} (${new Ratio(worstMap[1].losses, worstMap[1].games).percent()} lost)`]);
    }

    const sections: [string, [string, string][]][] = [
        ['📊 Overview', overview],
        ['🔥 Streaks', streaks],
        ['🗺️ Maps', maps],
    ];

    // A bold section header followed by one "label: value" line per row.
    const blocks = sections
        .filter(([, rows]) => rows.length > 0)
        .map(([title, rows]) => {
            const body = rows.map(([label, value]) => `${label}: ${value}`).join('\n');
            return fmt`${bold(title)}\n${body}`;
        });
    return join(blocks, '\n\n');
};

export default (bot: Bot, msg: Command): Promise<unknown> =>
    resolvePlayerTarget(dao, msg)
        .then(target => {
            if (!target) {
                return;  // resolvePlayerTarget already replied with the reason.
            }
            return dao.getGameHistory(msg.chat_id, target.user_id)
                .then((entries: GameHistoryEntry[]) => {
                    const text = renderStats(entries);
                    if (!text) {
                        return msg.reply(target.name
                            ? `No competitive games for ${target.name} in this chat yet.`
                            : 'No competitive games in your history yet.');
                    }
                    const header = target.name ? fmt`Competitive stats for ${bold(target.name)}\n` : '';
                    return msg.reply(fmt`${header}${text}`);
                });
        })
        .catch((err: Error) => msg.reply(formatError(err)));
