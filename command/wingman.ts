import { Bot } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter.js';
import { pickRandom } from '../utils.js';
import { bold, fmt, join, Part } from '../format.js';
import { mentionText } from '../rsvp.js';
import RollcallPlayerDAO from '../dao/RollcallPlayerDAO.js';
import { presenceMarkers } from '../presence.js';

const dao = new RollcallPlayerDAO();

const QUOTES: string[] = [
    "Be my wingman!",
    "Be my wingman yo!",
    "Let's score some!",
    "I'm a single pringle and ready to mingle!"
];

export default (bot: Bot, msg: ExtendedMessage): void => {
    dao.getRollcallPlayerUsernames(msg.chat?.id || 0)
        .then((players: string[]) => presenceMarkers(players).then(markers => {
            // Prefix each tag with the player's 🟢/🟡/🔴/😶‍🌫️ presence, like rollcalls and schedules.
            const tags: Part[] = players.map(player => markers[player] ? fmt`${markers[player]}${mentionText(player)}` : mentionText(player));
            return msg.reply(fmt`${pickRandom(QUOTES)}\n${join(tags, ' ')}`);
        }))
        .catch((err: Error) => msg.reply(bold(err.toString())));
};
