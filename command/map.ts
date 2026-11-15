import { Bot } from 'node-telegram-bot-api';
import { Command } from '../MessageRouter.js';
import GameHistoryDAO from '../dao/GameHistoryDAO.js';
import RsvpDAO from '../dao/RsvpDAO.js';
import RollcallPlayerDAO from '../dao/RollcallPlayerDAO.js';
import { formatError } from '../utils.js';
import { MapPick } from '../stats/MapPick.js';

const historyDao = new GameHistoryDAO();
const rsvpDao = new RsvpDAO();
const rollcallDao = new RollcallPlayerDAO();

const MIN_GAMES = 3;

const lobby = async (chat_id: number): Promise<number[]> => {
    const voters = await rsvpDao.getLatestYesVoters(chat_id);
    return voters.length > 0 ? voters : rollcallDao.getRotationUserIds(chat_id);
};

export default (bot: Bot, msg: Command): Promise<unknown> =>
    lobby(msg.chat_id)
        .then(async user_ids => {
            if (user_ids.length === 0) {
                return msg.reply('Nobody said yes to the latest rollcall and the rotation is empty.');
            }
            const [entries, players] = await Promise.all([historyDao.getChatHistory(msg.chat_id), historyDao.getChatPlayers(msg.chat_id)]);
            const names = new Map(players.map(player => [player.user_id, player.name]));
            return msg.reply(MapPick.of(entries, user_ids, names, MIN_GAMES).render());
        })
        .catch((err: Error) => msg.reply(formatError(err)));
