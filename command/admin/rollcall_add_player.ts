import { Bot, MessageEntity } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../../MessageRouter.js';
import { formatError } from '../../utils.js';
import RollcallPlayerDAO from '../../dao/RollcallPlayerDAO.js';
import UserDAO, { userDisplayName } from '../../dao/UserDAO.js';
import { notFoundMessage, parseDiscordRef, resolveDiscordUser } from '../../discord/users.js';

const dao = new RollcallPlayerDAO();
const userDao = new UserDAO();

export default (bot: Bot, msg: ExtendedMessage): void => {
    const args: string[] = msg.command?.argumentTokens || [];
    const telegramArgs: string[] = args.filter(arg => parseDiscordRef(arg) === undefined);
    // Telegram marks the @username inside `discord:@username` as a mention too.
    const insideDiscordRef = (entity: MessageEntity): boolean =>
        (msg.text ?? '').slice(Math.max(0, entity.offset - 'discord:'.length), entity.offset).toLowerCase() === 'discord:';
    const mentions: MessageEntity[] = (msg.entities || [])
        .filter(entity => entity?.type === 'mention' || entity?.type === 'text_mention')
        .filter(entity => !insideDiscordRef(entity));

    if (args.length === 0) {
        msg.reply('Who would you like to add?');
        return;
    } else if (telegramArgs.length !== mentions.length) {
        msg.reply(`${telegramArgs.length} arguments contained ${mentions.length} user mentions.`);
        return;
    } else if (args.length !== new Set(args).size) {
        msg.reply('Seems you\'ve got some duplicate entries in there, bud!');
        return;
    }

    const missing: string[] = [];
    Promise.all(args.map(async (arg) => {
        const discord_username: string | undefined = parseDiscordRef(arg);
        if (discord_username !== undefined) {
            const user = await resolveDiscordUser(msg.chat.id, discord_username);
            if (!user) {
                missing.push(discord_username);
                return arg;
            }
            return `[${userDisplayName(user)}](user:${user.id})`;
        }
        const mention = mentions[telegramArgs.indexOf(arg)];
        if (mention?.type === 'text_mention' && mention.user) {
            const user = await userDao.fromTelegram(mention.user);
            return `[${arg}](user:${user.id})`;
        }
        return arg;
    }))
        .then((players: string[]) => {
            if (missing.length > 0) {
                msg.reply(notFoundMessage(missing[0]));
                return;
            }
            return dao.getRollcallPlayerUsernames(msg.chat.id)
                .then((existingPlayers: string[]) => {
                    players.forEach(player => {
                        if (existingPlayers.includes(player)) {
                            throw new Error(`Player ${player} is already in the rollcall.`);
                        }
                    });
                })
                .then(() => Promise.all(players.map(player => dao.addRollcallPlayer(msg.chat.id, player))))
                .then(() => msg.reply(`Added ${args.length} players to rollcall.`));
        })
        .catch((err: Error) => msg.reply(formatError(err)));
}
