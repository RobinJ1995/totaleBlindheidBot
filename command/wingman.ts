import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter';
import { pickRandom, escapeMarkdown } from '../utils';
import RollcallPlayerDAO from '../dao/RollcallPlayerDAO';

const dao = new RollcallPlayerDAO();

const QUOTES: string[] = [
    "Be my wingman!",
    "Be my wingman yo!",
    "Let's score some!",
    "I'm a single pringle and ready to mingle!"
];

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    dao.getRollcallPlayerUsernames(msg.chat?.id || 0)
        .then((players: string[]) => msg.reply(`${pickRandom(QUOTES)}\n${players.join(' ')}`))
        .catch((err: Error) => msg.reply(`*${escapeMarkdown(err.toString())}*`));
};