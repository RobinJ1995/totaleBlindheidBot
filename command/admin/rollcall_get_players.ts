import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../../MessageRouter.js';
import { formatError, escapeMarkdown } from '../../utils.js';
import RollcallPlayerDAO from '../../dao/RollcallPlayerDAO.js';

const dao = new RollcallPlayerDAO();

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    dao.getRollcallPlayerUsernames(msg.chat.id)
        .then((players: string[]) => {
            if (players.length === 0) {
                msg.reply('No players in the rollcall.');
            } else {
                msg.reply(`Players in rollcall:\n${players.map((p: string) => {
                    const match: RegExpMatchArray | null = p.match(/^\[(.*)\]\(tg:\/\/user\?id=\d+\)$/);
                    const displayName: string = match ? match[1] : p;
                    return escapeMarkdown(displayName).replace('@', '@\u200B');
                }).map(p => `- ${p}`).join('\n')}`);
            }
        })
        .catch((err: Error) => msg.reply(formatError(err)));
}
