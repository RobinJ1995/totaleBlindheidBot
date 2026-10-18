import { Bot } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter.js';
import { pickRandom, escapeMarkdown } from '../utils.js';
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
            // Prefix each tag with the player's 🟢/🟡/🔴 presence, like rollcalls and schedules.
            const tags: string[] = players.map(player => markers[player] ? `${markers[player]}${player}` : player);
            return msg.reply(`${pickRandom(QUOTES)}\n${tags.join(' ')}`);
        }))
        .catch((err: Error) => msg.reply(`*${escapeMarkdown(err.toString())}*`));
};
