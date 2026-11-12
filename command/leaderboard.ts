import { Bot } from 'node-telegram-bot-api';
import { Command } from '../MessageRouter.js';
import GameHistoryDAO from '../dao/GameHistoryDAO.js';
import { formatError } from '../utils.js';
import { Leaderboard, LeaderboardFilter } from '../stats/Leaderboard.js';

const dao = new GameHistoryDAO();

const MIN_GAMES = Number(process.env.LEADERBOARD_MIN_GAMES) || 5;

export default (bot: Bot, msg: Command): Promise<unknown> => {
    const filter = LeaderboardFilter.parse(msg.command.argumentTokens, new Date());
    return Promise.all([dao.getChatHistory(msg.chat_id, filter.since), dao.getChatPlayers(msg.chat_id)])
        .then(([entries, players]) => {
            const names = new Map(players.map(player => [player.user_id, player.name]));
            return msg.reply(Leaderboard.of(entries, filter, names, MIN_GAMES).render());
        })
        .catch((err: Error) => msg.reply(formatError(err)));
};
