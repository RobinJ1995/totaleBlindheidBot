import TelegramBot, { CallbackQuery, InlineKeyboardButton } from 'node-telegram-bot-api';
import { DateTime } from 'luxon';
import { ExtendedMessage } from '../../MessageRouter.js';
import GameHistoryDAO, { GameHistoryEntry } from '../../dao/GameHistoryDAO.js';
import { escapeMarkdown, formatError } from '../../utils.js';
import { resolvePlayerTarget } from '../playerArg.js';
import { resultEmoji } from '../game_history.js';

const dao = new GameHistoryDAO();

// Match records offered per picker page. The keyboard paginates through the player's entire
// history (newest first), so a mis-recorded match from weeks back is still reachable.
export const PAGE_SIZE = 10;

// The callback-data namespace for the deletion keyboard, dispatched to handleDeleteMatchCallback
// by the main callback_query listener. Payloads: "<id>" deletes a record, "page:<uid>:<offset>"
// re-renders the keyboard at another offset, "noop" is the inert page indicator, "cancel" closes.
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
    return `${describeEntry(entry)} · ${ended.toFormat('d MMM yyyy HH:mm')} UTC`;
};

// Build the picker keyboard for one page of records (newest first). Pure so the pagination
// shape is unit-testable: one row per record, a navigation row when the history spans more
// than one page ("Newer" towards offset 0, "Older" towards the end), and a Cancel row.
export const pickerKeyboard = (
    entries: GameHistoryEntry[],
    targetUserId: number,
    total: number,
    offset: number
): InlineKeyboardButton[][] => {
    const keyboard: InlineKeyboardButton[][] = entries.map(entry => ([{
        text: buttonLabel(entry),
        callback_data: `${CALLBACK_PREFIX}${entry.id}`
    }]));

    if (total > PAGE_SIZE) {
        const nav: InlineKeyboardButton[] = [];
        if (offset > 0) {
            nav.push({
                text: '⬅️ Newer',
                callback_data: `${CALLBACK_PREFIX}page:${targetUserId}:${Math.max(0, offset - PAGE_SIZE)}`
            });
        }
        nav.push({
            text: `${Math.floor(offset / PAGE_SIZE) + 1}/${Math.ceil(total / PAGE_SIZE)}`,
            callback_data: `${CALLBACK_PREFIX}noop`
        });
        if (offset + PAGE_SIZE < total) {
            nav.push({
                text: 'Older ➡️',
                callback_data: `${CALLBACK_PREFIX}page:${targetUserId}:${offset + PAGE_SIZE}`
            });
        }
        keyboard.push(nav);
    }

    keyboard.push([{ text: '✖️ Cancel', callback_data: `${CALLBACK_PREFIX}cancel` }]);
    return keyboard;
};

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    if (!isAdmin(msg.from?.id)) {
        msg.reply('Only the admin can delete match records.');
        return;
    }

    resolvePlayerTarget(dao, msg)
        .then(target => {
            if (!target) return;  // resolvePlayerTarget already replied with the reason.
            return dao.getGameHistoryPage(msg.chat.id, target.user_id, 0, PAGE_SIZE)
                .then(({ total, entries }) => {
                    if (total === 0) {
                        msg.reply(target.name
                            ? `No match records for ${escapeMarkdown(target.name)} in this chat.`
                            : 'No match records for you in this chat.');
                        return;
                    }

                    const who = target.name ? ` for *${escapeMarkdown(target.name)}*` : '';
                    return bot.sendMessage(msg.chat.id,
                        `Select the match record to delete${who} (${total} recorded):`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: { inline_keyboard: pickerKeyboard(entries, target.user_id, total, 0) }
                        });
                });
        })
        .catch((err: Error) => msg.reply(formatError(err)));
};

// Handle a tap on the deletion keyboard. Re-checks the admin gate (buttons are visible to the
// whole chat); page taps re-render the keyboard at the requested offset, record taps verify the
// record still exists and belongs to the chat the button lives in, then delete it and replace
// the picker with a confirmation.
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

    const arg = data.substring(CALLBACK_PREFIX.length);

    if (arg === 'noop') {
        answer();
        return;
    }

    if (!isAdmin(query.from?.id)) {
        answer('Only the admin can delete match records.');
        return;
    }

    if (arg === 'cancel') {
        replacePicker('Match record deletion cancelled.').then(() => answer());
        return;
    }

    const pageMatch = arg.match(/^page:(-?\d+):(\d+)$/);
    if (pageMatch) {
        const targetUserId = Number(pageMatch[1]);
        const offset = Number(pageMatch[2]);
        // A tap that lands on an unchanged keyboard (e.g. a double-tap) is not an error.
        const updateKeyboard = (entries: GameHistoryEntry[], total: number, at: number): Promise<unknown> =>
            bot.editMessageReplyMarkup(
                { inline_keyboard: pickerKeyboard(entries, targetUserId, total, at) },
                { chat_id: message.chat.id, message_id: message.message_id }
            ).catch((err: Error) => {
                if (!err.message?.includes('message is not modified')) throw err;
            });
        dao.getGameHistoryPage(message.chat.id, targetUserId, offset, PAGE_SIZE)
            .then(({ total, entries }) => {
                if (entries.length === 0) {
                    // The last record of this page was deleted meanwhile; fall back to page 1.
                    return dao.getGameHistoryPage(message.chat.id, targetUserId, 0, PAGE_SIZE)
                        .then(first => first.total === 0
                            ? replacePicker('No match records left.').then(() => answer())
                            : updateKeyboard(first.entries, first.total, 0).then(() => answer()));
                }
                return updateKeyboard(entries, total, offset).then(() => answer());
            })
            .catch((err: Error) => {
                console.error(`Error paging match records for user ${targetUserId}:`, err);
                answer('Something went wrong.');
            });
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
