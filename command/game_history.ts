import { Bot } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter.js';
import GameHistoryDAO, { GameHistoryEntry } from '../dao/GameHistoryDAO.js';
import { formatError } from '../utils.js';
import { asFormatted, bold, fmt } from '../format.js';
import { parseRawScore } from '../matchDerivation.js';
import { resolvePlayerTarget } from './playerArg.js';

const dao = new GameHistoryDAO();

// Keep the rendered reply comfortably under Telegram's 4096-character message cap.
const MAX_MESSAGE_CHARS = 3900;

// A raw "16-14" score as rounds (first part = player, second = opponents).
export const parseScore = (score?: string): { us: number, them: number } | null => {
    const parsed = parseRawScore(score);
    return parsed ? { us: parsed.a, them: parsed.b } : null;
};

export type GameResult = 'win' | 'loss' | 'tie';

export const scoreResult = (score?: string): GameResult | null => {
    const parsed = parseScore(score);
    if (!parsed) {
        return null;
    } else if (parsed.us > parsed.them) {
        return 'win';
    } else if (parsed.us < parsed.them) {
        return 'loss';
    }
    return 'tie';
};

export const resultEmoji = (score?: string): string => {
    switch (scoreResult(score)) {
        case 'win': return '🏆';
        case 'loss': return '☠️';
        case 'tie': return '🤝';
        default: return '•';
    }
};

// Render a name without pinging the user (zero-width space breaks the @mention).
const safeName = (name: string): string => name.replace('@', '@​');

const renderLine = (entry: GameHistoryEntry): string => {
    const parts: string[] = [];
    if (entry.map) {
        parts.push(entry.map);
    }
    if (entry.mode) {
        parts.push(entry.mode);
    }
    if (entry.score) {
        parts.push(entry.score);
    }
    if (entry.co_players && entry.co_players.length > 0) {
        parts.push(`with ${entry.co_players.map(p => safeName(p.name)).join(', ')}`);
    }
    return `${resultEmoji(entry.score)} ${parts.join(' · ')}`;
};

export default (bot: Bot, msg: ExtendedMessage): void => {
    resolvePlayerTarget(dao, msg)
        .then(target => {
            if (!target) {
                return;  // resolvePlayerTarget already replied with the reason.
            }
            return dao.getGameHistory(msg.chat.id, target.user_id)
                .then((entries: GameHistoryEntry[]) => {
                    if (entries.length === 0) {
                        msg.reply(target.name
                            ? `No game history for ${target.name} in this chat yet.`
                            : 'No game history yet.');
                        return;
                    }

                    const header = target.name ? fmt`Game history for ${bold(target.name)}\n` : asFormatted('');

                    // Oldest → newest (newest at the bottom). Entries come back chronologically.
                    const lines = entries.map(renderLine);

                    // If the full list is too long, keep the most recent games that fit (drop the
                    // oldest) and note how many were omitted — newest still ends up at the bottom.
                    // The header counts against the budget so the whole reply stays under the cap.
                    let kept = lines;
                    let omitted = 0;
                    while (header.text.length + kept.join('\n').length > MAX_MESSAGE_CHARS && kept.length > 1) {
                        kept = kept.slice(1);
                        omitted += 1;
                    }

                    const body = kept.join('\n');
                    const text = omitted > 0 ? `…${omitted} older games omitted\n${body}` : body;
                    msg.reply(fmt`${header}${text}`);
                });
        })
        .catch((err: Error) => msg.reply(formatError(err)));
};
