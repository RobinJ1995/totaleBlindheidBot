import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter';

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    const who: string = msg.from?.first_name || msg.from?.username || 'stranger';

    msg.reply(`Hello to you too, ${who}!`);
};