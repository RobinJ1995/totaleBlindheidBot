import { Bot } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../../MessageRouter.js';
import { formatError } from '../../utils.js';
import RollcallPlayerDAO from '../../dao/RollcallPlayerDAO.js';
import { displayName, parseMention } from '../../mention.js';

const dao = new RollcallPlayerDAO();

export default (bot: Bot, msg: ExtendedMessage): void => {
    dao.getRollcallPlayerUsernames(msg.chat.id)
        .then((players: string[]) => {
            if (players.length === 0) {
                msg.reply('No players in the rollcall.');
            } else {
                msg.reply(`Players in rollcall:\n${players.map((p: string) => `- ${displayName(parseMention(p).display)}`).join('\n')}`);
            }
        })
        .catch((err: Error) => msg.reply(formatError(err)));
}
