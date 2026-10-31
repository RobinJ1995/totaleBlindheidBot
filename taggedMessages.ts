import { Bot, InlineKeyboardMarkup, Message } from 'node-telegram-bot-api';
import SteamService from './SteamService.js';
import RsvpDAO, { Rsvp, RsvpList, RsvpMessageRef } from './dao/RsvpDAO.js';
import DiscordService from './discord/DiscordService.js';
import { renderDiscordMessage } from './discord/render.js';
import RollcallPlayerDAO from './dao/RollcallPlayerDAO.js';
import TaggedMessageDAO, { TaggedMessage } from './dao/TaggedMessageDAO.js';
import { Formatted, messageText } from './format.js';
import { keyboard, renderMessage, resolve } from './rsvp.js';
import { mentionUserId, mentionUsers, presenceMarkers, withTags } from './presence.js';

// How long after a message is sent its presence markers are kept up to date. Once it passes,
// the markers are stripped rather than left stale. Overridable for tests.
const TAGGED_MESSAGE_LIVE_MS = Number(process.env.TAGGED_MESSAGE_LIVE_MS) || 6 * 60 * 60 * 1000;

// How often messages past their live window are swept to strip their markers. Overridable.
const TAGGED_MESSAGE_SWEEP_MS = Number(process.env.TAGGED_MESSAGE_SWEEP_MS) || 60 * 1000;

const rsvpDao = new RsvpDAO();
const rollcallPlayerDao = new RollcallPlayerDAO();
const taggedMessageDao = new TaggedMessageDAO();

// Serialises edits per RSVP list (or per plain message) so a presence refresh, a button tap and
// the expiry sweep can't land an older render over a newer one.
const locks: Record<string, Promise<unknown>> = {};
const withLock = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks[key] || Promise.resolve();
    const run = prev.then(fn, fn);
    const settled = run.then(() => undefined, () => undefined);
    locks[key] = settled;
    settled.then(() => {
        if (locks[key] === settled) {
            delete locks[key];
        }
    });
    return run;
};

const rsvpLockKey = (rsvp_id: number): string => `rsvp_${rsvp_id}`;
const messageLockKey = (chat_id: number, message_id: number): string => `message_${chat_id}_${message_id}`;

const isLive = (message: TaggedMessage): boolean =>
    Date.now() - message.sent_at.getTime() < TAGGED_MESSAGE_LIVE_MS;

const editText = (bot: Bot, chat_id: number, message_id: number, content: Formatted, reply_markup?: InlineKeyboardMarkup): Promise<void> =>
    bot.api.editMessageText({
        ...messageText(content),
        chat_id,
        message_id,
        ...(reply_markup ? { reply_markup } : {})
    }).then(() => undefined).catch((err: Error) => {
        // Telegram throws when the text is unchanged; that's harmless here.
        if (!err.message?.includes('message is not modified')) {
            console.error(`Error updating message ${message_id} in chat ${chat_id}:`, err);
        }
    });

const rsvpGroups = (list: RsvpList): Promise<Record<Rsvp, string[]>> =>
    rollcallPlayerDao.getRollcallPlayerUsernames(list.chat_id).then(rotation => resolve(rotation, list.entries).groups);

const editDiscordCopy = async (ref: RsvpMessageRef & { platform: 'discord' }, groups: Record<Rsvp, string[]>): Promise<void> => {
    const discord: DiscordService | null = DiscordService.instance;
    if (!discord) {
        return;
    }
    await discord.editMessage(ref.channel_id, ref.message_id, renderDiscordMessage(ref.base.text, groups))
        .catch((err: Error) => console.error(`Error updating Discord message ${ref.message_id} in channel ${ref.channel_id}:`, err));
};

// Start keeping the presence markers of a just-sent message up to date. `head` is everything
// above the tag line. Without Steam there are no markers to maintain. Presence is decoration
// only, so a failure here is logged rather than failing the command that sent the message.
const trackTaggedMessage = (sent: Message, head: Formatted, tags: string[], rsvp: boolean): Promise<void> => {
    if (!SteamService.instance || tags.length === 0) {
        return Promise.resolve();
    }
    return taggedMessageDao.addTaggedMessage({
        chat_id: sent.chat.id,
        message_id: sent.message_id,
        head,
        tags,
        rsvp,
        sent_at: new Date()
    }).catch((err: Error) => console.error(`Could not track presence markers of message ${sent.message_id}:`, err));
};

// Re-render every message attached to an RSVP list against the current rotation. Messages still
// within their live window get fresh presence markers; the rest render their stored base, which
// has none.
const renderRsvpList = (bot: Bot, rsvp_id: number): Promise<void> => withLock(rsvpLockKey(rsvp_id), async () => {
    const list: RsvpList | undefined = await rsvpDao.getRsvpList(rsvp_id);
    if (!list) {
        return;
    }
    const groups = await rsvpGroups(list);
    await Promise.all(list.messages.map(async ref => {
        if (ref.platform === 'discord') {
            return editDiscordCopy(ref, groups);
        }
        const tagged: TaggedMessage | undefined = await taggedMessageDao.getTaggedMessage(list.chat_id, ref.message_id);
        const base: Formatted = tagged && isLive(tagged)
            ? withTags(tagged.head, tagged.tags, await mentionUsers(tagged.tags), await presenceMarkers(tagged.tags))
            : ref.base;
        await editText(bot, list.chat_id, ref.message_id, renderMessage(base, groups), keyboard(ref.keyboard));
    }));
});

// Strip the buttons from a message leaving its RSVP list so it can no longer record responses,
// along with its presence markers if they were still being kept up to date.
const retireRsvpMessage = async (bot: Bot, list: RsvpList, ref: RsvpMessageRef, groups: Record<Rsvp, string[]>): Promise<void> => {
    if (ref.platform === 'discord') {
        await editDiscordCopy(ref, groups);
    } else if (await taggedMessageDao.deleteTaggedMessage(list.chat_id, ref.message_id)) {
        await editText(bot, list.chat_id, ref.message_id, renderMessage(ref.base, groups), { inline_keyboard: [] });
    } else {
        await bot.api.editMessageReplyMarkup({
            chat_id: list.chat_id,
            message_id: ref.message_id,
            reply_markup: { inline_keyboard: [] }
        }).catch(() => undefined);
    }
};

// Retire every message attached to a list and delete it, so its now-stale confirmation can no
// longer record responses. Used when rescheduling or cancelling.
const retireRsvpList = (bot: Bot, rsvp_id: number): Promise<void> => withLock(rsvpLockKey(rsvp_id), async () => {
    const list: RsvpList | undefined = await rsvpDao.getRsvpList(rsvp_id);
    if (list) {
        const groups = await rsvpGroups(list);
        await Promise.all(list.messages.map(ref => retireRsvpMessage(bot, list, ref, groups)));
    }
    await rsvpDao.deleteRsvpList(rsvp_id);
});

// When a schedule fires, the rollcall message takes over the shared RSVP list. Retire the
// now-stale confirmation message and detach it so only the rollcall stays live.
const closeScheduleConfirmation = (bot: Bot, rsvp_id?: number): Promise<void> => {
    if (!rsvp_id) {
        return Promise.resolve();
    }
    return withLock(rsvpLockKey(rsvp_id), async () => {
        const list: RsvpList | undefined = await rsvpDao.getRsvpList(rsvp_id);
        const confirmation: RsvpMessageRef | undefined = list?.messages.find(m => m.keyboard === 'schedule');
        if (!list || !confirmation) {
            return;
        }
        await retireRsvpMessage(bot, list, confirmation, await rsvpGroups(list));
        await rsvpDao.removeRsvpMessage(rsvp_id, confirmation);
    });
};

// Re-render a message that isn't attached to an RSVP list (e.g. a wingman call) with fresh
// presence markers, if it's still within its live window.
const refreshPlainMessage = (bot: Bot, chat_id: number, message_id: number): Promise<void> =>
    withLock(messageLockKey(chat_id, message_id), async () => {
        const tagged: TaggedMessage | undefined = await taggedMessageDao.getTaggedMessage(chat_id, message_id);
        if (tagged && isLive(tagged)) {
            await editText(bot, chat_id, message_id, withTags(tagged.head, tagged.tags, await mentionUsers(tagged.tags), await presenceMarkers(tagged.tags)));
        }
    });

// Re-render the live messages tagging a user whose Steam presence just changed.
const refreshTaggedMessagesFor = async (bot: Bot, user_id: number): Promise<void> => {
    const live: TaggedMessage[] = await taggedMessageDao.getTaggedMessagesSince(new Date(Date.now() - TAGGED_MESSAGE_LIVE_MS));
    // A schedule confirmation and its rollcall share a list; render each list once.
    const rendered: Set<number> = new Set();
    for (const message of live) {
        const tagged: (number | undefined)[] = await Promise.all(message.tags.map(mentionUserId));
        if (!tagged.includes(user_id)) {
            continue;
        } else if (!message.rsvp) {
            await refreshPlainMessage(bot, message.chat_id, message.message_id);
            continue;
        }
        const list: RsvpList | undefined = await rsvpDao.getRsvpListByMessage(message.chat_id, message.message_id);
        if (list && !rendered.has(list.rsvp_id)) {
            rendered.add(list.rsvp_id);
            await renderRsvpList(bot, list.rsvp_id);
        }
    }
};

// Final edit of a message past its live window: strip its presence markers and stop tracking it.
const stripTaggedMessage = async (bot: Bot, message: TaggedMessage): Promise<void> => {
    if (!message.rsvp) {
        return withLock(messageLockKey(message.chat_id, message.message_id), async () => {
            if (await taggedMessageDao.deleteTaggedMessage(message.chat_id, message.message_id)) {
                await editText(bot, message.chat_id, message.message_id, withTags(message.head, message.tags, await mentionUsers(message.tags)));
            }
        });
    }
    // Once the row is gone the list renders this message from its marker-free stored base.
    const list: RsvpList | undefined = await rsvpDao.getRsvpListByMessage(message.chat_id, message.message_id);
    if (await taggedMessageDao.deleteTaggedMessage(message.chat_id, message.message_id) && list) {
        await renderRsvpList(bot, list.rsvp_id);
    }
};

const stripExpiredTaggedMessages = async (bot: Bot): Promise<void> => {
    const expired: TaggedMessage[] = await taggedMessageDao.getTaggedMessagesBefore(new Date(Date.now() - TAGGED_MESSAGE_LIVE_MS));
    for (const message of expired) {
        await stripTaggedMessage(bot, message);
    }
};

let sweeping: boolean = false;
const startTaggedMessageSweep = (bot: Bot): NodeJS.Timeout => setInterval(() => {
    // Skip a tick rather than overlap a sweep still working through a backlog.
    if (sweeping) {
        return;
    }
    sweeping = true;
    stripExpiredTaggedMessages(bot)
        .catch((err: Error) => console.error('Error stripping expired presence markers:', err))
        .finally(() => {
            sweeping = false;
        });
}, TAGGED_MESSAGE_SWEEP_MS);

export {
    trackTaggedMessage,
    renderRsvpList,
    retireRsvpList,
    closeScheduleConfirmation,
    refreshTaggedMessagesFor,
    startTaggedMessageSweep
};
