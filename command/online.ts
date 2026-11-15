import { Bot } from 'node-telegram-bot-api';
import { Command } from '../MessageRouter.js';
import UserDAO, { ChatUser } from '../dao/UserDAO.js';
import SteamService, { Presence, PRESENCE_EMOJI } from '../SteamService.js';
import RichPresence from '../RichPresence.js';
import { bold, fmt, Formatted, join } from '../format.js';
import { displayName } from '../mention.js';
import { formatError } from '../utils.js';

export type OnlineSteam = Pick<SteamService, 'getPresence' | 'getRichPresence' | 'formatScore'>;
export type OnlineUsers = Pick<UserDAO, 'getChatUsers'>;

interface OnlineUser {
    name: string;
    presence?: Presence;
    game?: RichPresence;
}

export const NOBODY_ONLINE = 'Nobody is on Steam right now.';

export class OnlineList {
    constructor(private readonly steam: OnlineSteam, private readonly users: OnlineUsers) {}

    async render(chatId: number): Promise<Formatted | string> {
        const users: OnlineUser[] = await Promise.all((await this.users.getChatUsers(chatId)).map(user => this.lookUp(user)));
        const lines: Formatted[] = [
            ...users.filter(user => user.presence === 'playing').map(user => this.playingLine(user)),
            ...users.filter(user => user.presence === 'online').map(user => fmt`${PRESENCE_EMOJI.online} ${bold(user.name)} is online`)
        ];
        return lines.length > 0 ? join(lines, '\n') : NOBODY_ONLINE;
    }

    private async lookUp(user: ChatUser): Promise<OnlineUser> {
        const presence: Presence | undefined = await this.steam.getPresence(user.user_id);
        const game: RichPresence | undefined = presence === 'playing' ? await this.steam.getRichPresence(user.user_id) : undefined;
        return { name: displayName(user.name), presence, game };
    }

    private playingLine({ name, game }: OnlineUser): Formatted {
        const head: Formatted = fmt`${PRESENCE_EMOJI.playing} ${bold(name)} is playing`;
        if (!game?.map) {
            return fmt`${head} Counter-Strike`;
        }
        const mode: string = game.mode ? ` (${game.mode})` : '';
        const score: string = game.rawScore ? `: ${this.steam.formatScore(game.rawScore)}` : '';
        return fmt`${head} ${game.map}${mode}${score}`;
    }
}

export default (bot: Bot, cmd: Command): Promise<unknown> => {
    const steam: SteamService | null = SteamService.instance;
    if (!steam) {
        return cmd.reply(NOBODY_ONLINE);
    }
    return new OnlineList(steam, new UserDAO()).render(cmd.chat_id)
        .then(text => cmd.reply(text))
        .catch((err: Error) => cmd.reply(formatError(err)));
};
