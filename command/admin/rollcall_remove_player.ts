import TelegramBot from 'node-telegram-bot-api';
import { ExtendedMessage } from '../../MessageRouter';
import { formatError } from '../../utils';
import RollcallPlayerDAO from '../../dao/RollcallPlayerDAO';

const dao = new RollcallPlayerDAO();

export default (bot: TelegramBot, msg: ExtendedMessage): void => {
    const args: string[] = msg.command?.argumentTokens || [];
    const mentions: TelegramBot.MessageEntity[] = (msg.entities || []).filter(entity => entity?.type === 'mention' || entity?.type === 'text_mention');

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

    const players: string[] = args.map((arg, i) => {
        const mention = mentions[i];
        if (mention?.type === 'text_mention' && mention.user) {
            return `[${arg}](tg://user?id=${mention.user.id})`;
        }
        return arg;
    });

    Promise.all(players.map(player => dao.removeRollcallPlayer(msg.chat.id, player)))
        .then((results: boolean[]) => {
            if (results.every(r => r === false)) {
                msg.reply('Who are they?');
                return;
            }

            msg.reply('Poof! They\'re gone!')
        })
        .catch((err: Error) => msg.reply(formatError(err)));
}