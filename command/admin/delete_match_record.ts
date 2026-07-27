import TelegramBot, { CallbackQuery, InlineKeyboardButton } from 'node-telegram-bot-api';
import { DateTime } from 'luxon';
import { ExtendedMessage } from '../../MessageRouter.js';
import GameHistoryDAO, { GameHistoryEntry } from '../../dao/GameHistoryDAO.js';
import { escapeMarkdown, formatError } from '../../utils.js';
import { resolvePlayerTarget } from '../playerArg.js';
import { resultEmoji } from '../game_history.js';

const dao = new GameHistoryDAO();

// How many of the player's most recent matches to offer for deletion. Telegram keyboards get
// unwieldy beyond this, and a mis-recorded match is virtually always a recent one.
const MAX_CHOICES = 10;

// The callback-data namespace for the deletion keyboard, dispatched to handleDeleteMatchCallback
// by the main callback_query listener.
export const CALLBACK_PREFIX = 'delmatch:';

// Only the configured Steam admin may delete match records.
const isAdmin = (userId?: number): boolean => {
    const admin = process.env.STEAM_ADMIN_TELEGRAM_USER_ID;
    return !!admin && userId != null && String(userId) === admin;
};

// Plain-text description of a match record for button labels and confirmations,
// e.g. "🏆 Vertigo · Competitive · 13-7".
const describeEntry = (entry: GameHistoryEntry): string => {
    const parts: string[] = [];
    if (entry.map) parts.push(entry.map);
    if (entry.mode) parts.push(entry.mode);
    if (entry.score) parts.push(entry.score);
    return `${resultEmoji(entry.score)} ${parts.join(' · ') || 'unknown match'}`;
};

// Button label: the match description plus when it ended, so look-alike matches can be told apart.
const buttonLabel = (entry: GameHistoryEntry): string => {
    const ended = DateTime.fromJSDate(new Date(entry.ended_at), { zone: 'utc' });
    return `${describeEntry(entry)} · ${ended.toFormat('d MMM HH:mm')} UTC`;
};

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    if (!isAdmin(msg.from?.id)) {
        msg.reply('Only the admin can delete match records.');
        return;
    }

    resolvePlayerTarget(dao, msg)
        .then(target => {
            if (!target) return;  // resolvePlayerTarget already replied with the reason.
            return dao.getGameHistory(msg.chat.id, target.user_id)
                .then((entries: GameHistoryEntry[]) => {
                    if (entries.length === 0) {
                        msg.reply(target.name
                            ? `No match records for ${escapeMarkdown(target.name)} in this chat.`
                            : 'No match records for you in this chat.');
                        return;
                    }

                    // Most recent first; entries come back oldest first.
                    const recent = entries.slice(-MAX_CHOICES).reverse();
                    const keyboard: InlineKeyboardButton[][] = recent.map(entry => ([{
                        text: buttonLabel(entry),
                        callback_data: `${CALLBACK_PREFIX}${entry.id}`
                    }]));
                    keyboard.push([{ text: '✖️ Cancel', callback_data: `${CALLBACK_PREFIX}cancel` }]);

                    const who = target.name ? ` for *${escapeMarkdown(target.name)}*` : '';
                    return bot.sendMessage(msg.chat.id,
                        `Select the match record to delete${who}:`,
                        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
                });
        })
        .catch((err: Error) => msg.reply(formatError(err)));
};

// Handle a tap on the deletion keyboard. Re-checks the admin gate (buttons are visible to the
// whole chat) and that the record still exists and belongs to the chat the button lives in,
// then deletes it and replaces the picker with a confirmation.
export const handleDeleteMatchCallback = (bot: TelegramBot, query: CallbackQuery): void => {
    const data = query.data;
    const message = query.message;
    if (!data || !data.startsWith(CALLBACK_PREFIX) || !message) {
        return;
    }

    const answer = (text?: string): Promise<unknown> =>
        bot.answerCallbackQuery(query.id, text ? { text } : {}).catch(() => undefined);
    const replacePicker = (text: string): Promise<unknown> =>
        bot.editMessageText(text, {
            chat_id: message.chat.id,
            message_id: message.message_id,
            parse_mode: 'Markdown'
        }).catch((err: Error) => console.error(`Failed to edit match-deletion message ${message.message_id}:`, err));

    if (!isAdmin(query.from?.id)) {
        answer('Only the admin can delete match records.');
        return;
    }

    const arg = data.substring(CALLBACK_PREFIX.length);
    if (arg === 'cancel') {
        replacePicker('Match record deletion cancelled.').then(() => answer());
        return;
    }

    const id = Number(arg);
    if (!Number.isInteger(id)) {
        answer();
        return;
    }

    dao.getGameHistoryEntryById(id)
        .then(entry => {
            if (!entry || entry.chat_id !== message.chat.id) {
                return replacePicker('That match record no longer exists.').then(() => answer());
            }
            return dao.deleteGameHistoryEntry(id).then(deleted => {
                if (!deleted) {
                    return replacePicker('That match record no longer exists.').then(() => answer());
                }
                const who = entry.player_name ? ` (${escapeMarkdown(entry.player_name)})` : '';
                return replacePicker(`🗑️ Deleted match record: ${escapeMarkdown(describeEntry(entry))}${who}`)
                    .then(() => answer('Match record deleted.'));
            });
        })
        .catch((err: Error) => {
            console.error(`Error deleting match record ${id}:`, err);
            answer('Something went wrong.');
        });
};
