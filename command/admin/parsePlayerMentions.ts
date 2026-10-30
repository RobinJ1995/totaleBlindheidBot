import { MessageEntity } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../../MessageRouter.js';
import UserDAO, { userDisplayName } from '../../dao/UserDAO.js';
import { userMention } from '../../mention.js';
import { notFoundMessage, parseDiscordRef, resolveDiscordUser } from '../../discord/users.js';

const userDao = new UserDAO();

export const parsePlayerMentions = async (msg: ExtendedMessage): Promise<{ players: string[] } | { error: string }> => {
    const args: string[] = msg.command?.argumentTokens || [];
    const telegramArgs: string[] = args.filter(arg => parseDiscordRef(arg) === undefined);
    // Telegram marks the @username inside `discord:@username` as a mention too.
    const insideDiscordRef = (entity: MessageEntity): boolean =>
        (msg.text ?? '').slice(Math.max(0, entity.offset - 'discord:'.length), entity.offset).toLowerCase() === 'discord:';
    const mentions: MessageEntity[] = (msg.entities || [])
        .filter(entity => entity?.type === 'mention' || entity?.type === 'text_mention')
        .filter(entity => !insideDiscordRef(entity));

    if (telegramArgs.length !== mentions.length) {
        return { error: `${telegramArgs.length} arguments contained ${mentions.length} user mentions.` };
    } else if (args.length !== new Set(args).size) {
        return { error: 'Seems you\'ve got some duplicate entries in there, bud!' };
    }

    const resolved = await Promise.all(args.map(async (arg): Promise<string | { error: string }> => {
        const discord_username: string | undefined = parseDiscordRef(arg);
        if (discord_username !== undefined) {
            const user = await resolveDiscordUser(msg.chat.id, discord_username);
            return user ? userMention(user.id, userDisplayName(user)) : { error: notFoundMessage(discord_username) };
        }
        const mention = mentions[telegramArgs.indexOf(arg)];
        if (mention?.type === 'text_mention' && mention.user) {
            const user = await userDao.fromTelegram(mention.user);
            return userMention(user.id, arg);
        }
        return arg;
    }));
    const error = resolved.find((r): r is { error: string } => typeof r !== 'string');
    return error ?? { players: resolved.filter((r): r is string => typeof r === 'string') };
};
