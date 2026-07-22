import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter.js';
import GameHistoryDAO, { GameHistoryEntry } from '../dao/GameHistoryDAO.js';
import { escapeMarkdown, formatError } from '../utils.js';

const dao = new GameHistoryDAO();

// Keep the rendered reply comfortably under Telegram's 4096-character message cap.
const MAX_MESSAGE_CHARS = 3900;

// Parse a raw "16-14" score into rounds (first part = player, second = opponents).
export const parseScore = (score?: string): { us: number, them: number } | null => {
    const m = score ? score.replace(/[\[\]]/g, '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/) : null;
    if (!m) return null;
    return { us: parseInt(m[1], 10), them: parseInt(m[2], 10) };
};

export type GameResult = 'win' | 'loss' | 'tie';

export const scoreResult = (score?: string): GameResult | null => {
    const parsed = parseScore(score);
    if (!parsed) return null;
    if (parsed.us > parsed.them) return 'win';
    if (parsed.us < parsed.them) return 'loss';
    return 'tie';
};

const resultEmoji = (score?: string): string => {
    switch (scoreResult(score)) {
        case 'win': return '🏆';
        case 'loss': return '☠️';
        case 'tie': return '🤝';
        default: return '•';
    }
};

// Render a name without pinging the user (zero-width space breaks the @mention).
const safeName = (name: string): string => escapeMarkdown(name).replace('@', '@​');

const renderLine = (entry: GameHistoryEntry): string => {
    const parts: string[] = [];
    if (entry.map) parts.push(escapeMarkdown(entry.map));
    if (entry.mode) parts.push(escapeMarkdown(entry.mode));
    if (entry.score) parts.push(escapeMarkdown(entry.score));
    if (entry.co_players && entry.co_players.length > 0) {
        parts.push(`with ${entry.co_players.map(p => safeName(p.name)).join(', ')}`);
    }
    return `${resultEmoji(entry.score)} ${parts.join(' · ')}`;
};

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    dao.getGameHistory(msg.chat.id, msg.from!.id)
        .then((entries: GameHistoryEntry[]) => {
            if (entries.length === 0) {
                msg.reply('No game history yet.');
                return;
            }

            // Oldest → newest (newest at the bottom). Entries come back chronologically.
            const lines = entries.map(renderLine);

            // If the full list is too long, keep the most recent games that fit (drop the
            // oldest) and note how many were omitted — newest still ends up at the bottom.
            let kept = lines;
            let omitted = 0;
            while (kept.join('\n').length > MAX_MESSAGE_CHARS && kept.length > 1) {
                kept = kept.slice(1);
                omitted += 1;
            }

            const body = kept.join('\n');
            const text = omitted > 0 ? `…${omitted} older games omitted\n${body}` : body;
            msg.reply(text);
        })
        .catch((err: Error) => msg.reply(formatError(err)));
};
