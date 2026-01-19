import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter';
import { pickRandom } from '../utils';
import DAO from '../dao/DAO';

const dao = new DAO();

const QUOTES: string[] = [
    "Are we rushin' in, or are we going' sneaky-beaky like?",
    "Bingo, bango, bongo, bish, bash, bosh!",
    "Easy peasy, lemon squeezy!",
    "Grab your gear and let's go!",
    "RUSH B DON'T STOP"
];

const executeRollcall = (bot: TelegramBot, chat_id: number, reply_to_message_id?: number): Promise<TelegramBot.Message> => {
    return dao.getRollcallPlayerUsernames(chat_id)
        .then((players: string[]) => bot.sendMessage(chat_id, `${pickRandom(QUOTES)}\n${players.join(' ')}`, {
            reply_to_message_id,
            parse_mode: 'Markdown'
        }));
};

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    executeRollcall(bot, msg.chat.id, msg.message_id)
        .catch((err: Error) => msg.reply(`*${err.toString()}*`));
};

export { executeRollcall };