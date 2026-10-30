import { Bot } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter.js';
import { pickRandom } from '../utils.js';
import { asFormatted, bold, Formatted } from '../format.js';
import RollcallPlayerDAO from '../dao/RollcallPlayerDAO.js';
import { mentionUsers, presenceMarkers, withTags } from '../presence.js';
import { trackTaggedMessage } from '../taggedMessages.js';

const dao = new RollcallPlayerDAO();

const QUOTES: string[] = [
    "Be my wingman!",
    "Be my wingman yo!",
    "Let's score some!",
    "I'm a single pringle and ready to mingle!"
];

export default (bot: Bot, msg: ExtendedMessage): void => {
    dao.getRollcallPlayerUsernames(msg.chat?.id || 0)
        .then((players: string[]) => Promise.all([mentionUsers(players), presenceMarkers(players)]).then(([users, markers]) => {
            // Prefix each tag with the player's 🟢/🟡/🔴/😶‍🌫️ presence, kept up to date for a while
            // like rollcalls and schedules.
            const head: Formatted = asFormatted(`${pickRandom(QUOTES)}\n`);
            return msg.reply(withTags(head, players, users, markers))
                .then(sent => trackTaggedMessage(sent, head, players, false));
        }))
        .catch((err: Error) => msg.reply(bold(err.toString())));
};
