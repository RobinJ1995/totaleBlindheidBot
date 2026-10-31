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
        msg.reply('Who would you like to remove?');
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
        .then((players: string[]) => Promise.all(players.map(player => dao.removeRollcallPlayer(msg.chat.id, player))))
        .then((results: boolean[]) => {
            if (results.every(r => r === false)) {
                msg.reply('Who are they?');
                return;
            }

            msg.reply('Poof! They\'re gone!')
        })
        .catch((err: Error) => msg.reply(formatError(err)));
}
