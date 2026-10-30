import { Bot } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../../MessageRouter.js';
import { formatError } from '../../utils.js';
import RollcallPlayerDAO from '../../dao/RollcallPlayerDAO.js';
import { parsePlayerMentions } from './parsePlayerMentions.js';

const dao = new RollcallPlayerDAO();

export default (bot: Bot, msg: ExtendedMessage): void => {
    if ((msg.command?.argumentTokens || []).length === 0) {
        msg.reply('Who would you like to remove?');
        return;
    }

    parsePlayerMentions(msg)
        .then(parsed => {
            if ('error' in parsed) {
                msg.reply(parsed.error);
                return;
            }
            return Promise.all(parsed.players.map(player => dao.removeRollcallPlayer(msg.chat.id, player)))
                .then((results: boolean[]) => {
                    if (results.every(r => r === false)) {
                        msg.reply('Who are they?');
                        return;
                    }

                    msg.reply('Poof! They\'re gone!')
                });
        })
        .catch((err: Error) => msg.reply(formatError(err)));
}
