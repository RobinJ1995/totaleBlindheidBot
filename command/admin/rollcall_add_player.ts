import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../../MessageRouter';
import { formatError } from '../../utils';
import DAO from '../../dao/DAO';

const dao = new DAO();

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    const args: string[] = msg.command?.argumentTokens || [];
    const mentions: TelegramBot.MessageEntity[] = (msg.entities || []).filter(entity => entity?.type === 'mention' || entity?.type === 'text_mention');

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

    const players: string[] = args.map((arg, i) => {
        const mention = mentions[i];
        if (mention?.type === 'text_mention' && mention.user) {
            return `[${arg}](tg://user?id=${mention.user.id})`;
        }
        return arg;
    });

    dao.getRollcallPlayerUsernames(msg.chat.id)
        .then((existingPlayers: string[]) => {
            players.forEach(player => {
                if (existingPlayers.includes(player)) {
                    throw new Error(`Player ${player} is already in the rollcall.`);
                }
            });
        })
        .then(() => Promise.all(players.map(player => dao.addRollcallPlayer(msg.chat.id, player))))
        .then(() => msg.reply(`Added ${args.length} players to rollcall.`))
        .catch((err: Error) => msg.reply(formatError(err)));
}