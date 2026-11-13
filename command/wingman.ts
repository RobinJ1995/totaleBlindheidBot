import { Bot } from 'node-telegram-bot-api';
import { Command } from '../MessageRouter.js';
import { pickRandom } from '../utils.js';
import { asFormatted, bold, Formatted } from '../format.js';
import RollcallPlayerDAO from '../dao/RollcallPlayerDAO.js';
import { mentionUsers, presenceMarkers, withTags } from '../presence.js';
import { trackTaggedMessage } from '../taggedMessages.js';
import { broadcast, rememberCopies } from '../messenger.js';
import { withDiscordTags } from '../discord/render.js';
import { userDisplayName } from '../dao/UserDAO.js';

const dao = new RollcallPlayerDAO();

const QUOTES: string[] = [
    "Be my wingman!",
    "Be my wingman yo!",
    "Let's score some!",
    "I'm a single pringle and ready to mingle!"
];

export default (bot: Bot, cmd: Command): Promise<unknown> =>
    dao.getRollcallPlayerUsernames(cmd.chat_id)
        .then((players: string[]) => Promise.all([mentionUsers(players), presenceMarkers(players)]).then(([users, markers]) => {
            // Prefix each tag with the player's 🟢/🟡/🔴/💔/😶‍🌫️ presence, kept up to date for a while
            // like rollcalls and schedules.
            const head: Formatted = asFormatted(`${pickRandom(QUOTES)}\n`);
            return broadcast(bot, cmd, withTags(head, players, users, markers), withDiscordTags(head, players, users, markers))
                .then(sent => rememberCopies(cmd.chat_id, sent, userDisplayName(cmd.user))
                    .catch((err: Error) => console.error('Could not remember the Discord copies of a wingman call:', err))
                    .then(() => sent.telegram ? trackTaggedMessage(sent.telegram, head, players, false) : undefined));
        }))
        .catch((err: Error) => cmd.reply(bold(err.toString())));
