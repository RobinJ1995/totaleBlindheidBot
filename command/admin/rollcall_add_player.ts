import { Bot, MessageEntity } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../../MessageRouter.js';
import { formatError } from '../../utils.js';
import RollcallPlayerDAO from '../../dao/RollcallPlayerDAO.js';
import UserDAO from '../../dao/UserDAO.js';

const dao = new RollcallPlayerDAO();
const userDao = new UserDAO();

export default (bot: Bot, msg: ExtendedMessage): void => {
    const args: string[] = msg.command?.argumentTokens || [];
    const mentions: MessageEntity[] = (msg.entities || []).filter(entity => entity?.type === 'mention' || entity?.type === 'text_mention');

    if (args.length === 0) {
        msg.reply('Who would you like to add?');
        return;
    } else if (args.length !== mentions.length) {
        msg.reply(`${args.length} arguments contained ${mentions.length} user mentions.`);
        return;
    } else if (args.length !== new Set(args).size) {
        msg.reply('Seems you\'ve got some duplicate entries in there, bud!');
        return;
    }

    Promise.all(args.map(async (arg, i) => {
        const mention = mentions[i];
        if (mention?.type === 'text_mention' && mention.user) {
            const user = await userDao.fromTelegram(mention.user);
            return `[${arg}](user:${user.id})`;
        }
        return arg;
    }))
        .then((players: string[]) => dao.getRollcallPlayerUsernames(msg.chat.id)
            .then((existingPlayers: string[]) => {
                players.forEach(player => {
                    if (existingPlayers.includes(player)) {
                        throw new Error(`Player ${player} is already in the rollcall.`);
                    }
                });
            })
            .then(() => Promise.all(players.map(player => dao.addRollcallPlayer(msg.chat.id, player)))))
        .then(() => msg.reply(`Added ${args.length} players to rollcall.`))
        .catch((err: Error) => msg.reply(formatError(err)));
}
