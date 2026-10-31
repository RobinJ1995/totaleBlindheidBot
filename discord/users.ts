import { ExtendedMessage } from '../MessageRouter.js';
import ChatLinkDAO from '../dao/ChatLinkDAO.js';
import UserDAO, { DiscordIdentity, User } from '../dao/UserDAO.js';
import DiscordService from './DiscordService.js';

const chatLinkDao = new ChatLinkDAO();
const userDao = new UserDAO();

export const parseDiscordRef = (argument: string): string | undefined => {
    const match: RegExpMatchArray | null = argument.match(/^discord:@?(.+)$/i);
    return match ? match[1].toLowerCase() : undefined;
};

export const notFoundMessage = (username: string): string =>
    `I can't find Discord user "${username}" on any server linked to this group.`;

// Linked servers are asked before the database, since a username can change hands.
export const resolveDiscordUser = async (telegram_chat_id: number, username: string): Promise<User | undefined> => {
    const discord: DiscordService | null = DiscordService.instance;
    if (discord) {
        const guilds: string[] = [...new Set((await chatLinkDao.getLinks(telegram_chat_id)).map(link => link.discord_guild_id))];
        const member: DiscordIdentity | undefined = (await Promise.all(guilds.map(guild_id => discord.findMember(guild_id, username)))).find(Boolean);
        if (member) {
            return userDao.fromDiscord(member);
        }
    }
    return userDao.getUserByDiscordUsername(username);
};

export const resolveTelegramUser = async (msg: ExtendedMessage, argument: string | undefined): Promise<User | undefined> => {
    const mention = msg.entities?.find(e => e.type === 'text_mention' && e.user);
    if (mention?.user) {
        return userDao.fromTelegram(mention.user);
    } else if (argument?.startsWith('@') && argument.length > 1) {
        const user_id: number | undefined = await userDao.getUserIdByUsername(argument.slice(1));
        return user_id === undefined ? undefined : userDao.getUser(user_id);
    }
    return undefined;
};
