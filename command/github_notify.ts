import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter';
import DAO from '../dao/DAO';
import { formatError } from '../utils';

const dao = new DAO();

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    const arg: string | undefined = msg.command?.argument?.toLowerCase();
    if (arg !== 'on' && arg !== 'off') {
        msg.reply('Please specify "on" or "off" to enable or disable GitHub notifications for this chat.');
        return;
    }

    const enabled: boolean = arg === 'on';
    dao.setGithubNotify(msg.chat.id, enabled)
        .then(() => {
            msg.reply(`GitHub notifications for this chat have been turned ${arg}.`);
        })
        .catch((err: Error) => msg.reply(formatError(err)));
};
