import { Bot } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../../MessageRouter.js';
import { formatError } from '../../utils.js';
import RollcallPlayerDAO from '../../dao/RollcallPlayerDAO.js';
import { parsePlayerMentions } from './parsePlayerMentions.js';

const dao = new RollcallPlayerDAO();

export default (bot: Bot, msg: ExtendedMessage): void => {
    if ((msg.command?.argumentTokens || []).length === 0) {
        msg.reply('Who would you like to add?');
        return;
    }

    parsePlayerMentions(msg)
        .then(parsed => {
            if ('error' in parsed) {
                msg.reply(parsed.error);
                return;
            }
            const { players } = parsed;
            return dao.getRollcallPlayerUsernames(msg.chat.id)
                .then((existingPlayers: string[]) => {
                    players.forEach(player => {
                        if (existingPlayers.includes(player)) {
                            throw new Error(`Player ${player} is already in the rollcall.`);
                        }
                    });
                })
                .then(() => Promise.all(players.map(player => dao.addRollcallPlayer(msg.chat.id, player))))
                .then(() => msg.reply(`Added ${players.length} players to rollcall.`));
        })
        .catch((err: Error) => msg.reply(formatError(err)));
}
