import { Bot } from 'node-telegram-bot-api';
import { Command } from '../MessageRouter.js';
import { pickRandom } from '../utils.js';
import { asFormatted, bold, Formatted } from '../format.js';
import RollcallPlayerDAO from '../dao/RollcallPlayerDAO.js';
import RsvpDAO, { RsvpEntry, RsvpMessageRef } from '../dao/RsvpDAO.js';
import { resolve, renderMessage, entryFromUser } from '../rsvp.js';
import { mentionUsers, presenceMarkers, withTags } from '../presence.js';
import { trackTaggedMessage } from '../taggedMessages.js';
import { User } from '../dao/UserDAO.js';
import { broadcast, Broadcast, Target } from '../messenger.js';
import { renderDiscordMessage, withDiscordTags } from '../discord/render.js';

const rollcallPlayerDao = new RollcallPlayerDAO();
const rsvpDao = new RsvpDAO();

const QUOTES: string[] = [
    "Are we rushin' in, or are we going' sneaky-beaky like?",
    "Bingo, bango, bongo, bish, bash, bosh!",
    "Easy peasy, lemon squeezy!",
    "Grab your gear and let's go!",
    "RUSH B DON'T STOP"
];

interface ExecuteRollcallOptions {
    // The user who triggered the rollcall; seeded into the "yes" list for a fresh list.
    initiator?: User;
    // When set, the rollcall attaches to (shares) this existing RSVP list instead of
    // creating a fresh one. Used when a schedule triggers the rollcall.
    rsvp_id?: number;
}

const executeRollcall = (bot: Bot, target: Target, opts: ExecuteRollcallOptions = {}): Promise<Broadcast> => {
    const chat_id: number = target.chat_id;
    return Promise.all([
        rollcallPlayerDao.getRollcallPlayerUsernames(chat_id)
            .then(rotation => Promise.all([mentionUsers(rotation), presenceMarkers(rotation)])
                .then(([users, markers]) => ({ rotation, users, markers }))),
        opts.rsvp_id ? rsvpDao.getRsvpList(opts.rsvp_id) : Promise.resolve(undefined)
    ]).then(([{ rotation, users, markers }, existing]) => {
        // Inherit the shared list's entries when triggered by a schedule; otherwise seed
        // a fresh list with the initiator marked as joining.
        const entries: Record<string, RsvpEntry> = existing ? existing.entries : {};
        if (!existing && opts.initiator) {
            entries[opts.initiator.id] = entryFromUser(opts.initiator, 'yes');
        }

        const { groups, tagged } = resolve(rotation, entries);
        // The ping line is baked in at send time: anyone who said "no" is dropped here. Its
        // 🟢/🟡/🔴/😶‍🌫️ presence markers (in CS2 / online / offline / unlinked) are kept up to date
        // for a while and then stripped, so the stored base leaves them out.
        const head: Formatted = asFormatted(`${pickRandom(QUOTES)}\n`);
        const base: Formatted = withTags(head, tagged, users);
        const discordBase: string = withDiscordTags(head, tagged, users);

        return broadcast(bot, target,
            renderMessage(withTags(head, tagged, users, markers), groups),
            renderDiscordMessage(discordBase, groups),
            { keyboard: 'rollcall' }
        ).then((sent: Broadcast) => {
            const refs: RsvpMessageRef[] = [
                ...(sent.telegram ? [{ platform: 'telegram' as const, message_id: sent.telegram.message_id, base, keyboard: 'rollcall' as const }] : []),
                ...sent.discord.map(copy => ({ ...copy.where, base: asFormatted(discordBase), keyboard: 'rollcall' as const }))
            ];
            const attach = (): Promise<unknown> => (existing && opts.rsvp_id)
                ? Promise.all(refs.map(ref => rsvpDao.addRsvpMessage(opts.rsvp_id!, ref)))
                : rsvpDao.createRsvpList({ chat_id, entries, messages: refs });
            const tracked: Promise<unknown> = sent.telegram ? trackTaggedMessage(sent.telegram, head, tagged, true) : Promise.resolve();
            return tracked.then(attach).then(() => sent);
        });
    });
};

export default (bot: Bot, cmd: Command): Promise<unknown> =>
    executeRollcall(bot, cmd, { initiator: cmd.user })
        .catch((err: Error) => cmd.reply(bold(err.toString())));

export { executeRollcall };
