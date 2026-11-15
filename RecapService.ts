import { Bot } from 'node-telegram-bot-api';
import { DateTime } from 'luxon';
import GameHistoryDAO from './dao/GameHistoryDAO.js';
import ChatDAO from './dao/ChatDAO.js';
import WeeklyRecapDAO from './dao/WeeklyRecapDAO.js';
import WeeklyRecap from './stats/WeeklyRecap.js';
import { isCompetitive } from './stats/Tally.js';
import { broadcast } from './messenger.js';
import { toDiscordMarkdown } from './discord/markdown.js';

const SUNDAY = 7;
const RECAP_HOUR = 20;
const CHECK_MS = Number(process.env.RECAP_CHECK_MS) || 60 * 60 * 1000;

// RECAP_NOW stops the clock for acceptance tests.
const systemClock = (): DateTime => process.env.RECAP_NOW ? DateTime.fromISO(process.env.RECAP_NOW) : DateTime.now();

class RecapService {
    private interval: NodeJS.Timeout | null = null;
    private readonly zone: string = process.env.RECAP_TIMEZONE || 'Europe/Amsterdam';

    constructor(
        private readonly bot: Bot,
        private readonly clock: () => DateTime = systemClock,
        private readonly historyDao: GameHistoryDAO = new GameHistoryDAO(),
        private readonly chatDao: ChatDAO = new ChatDAO(),
        private readonly recapDao: WeeklyRecapDAO = new WeeklyRecapDAO()
    ) {}

    start(): void {
        const check = (): void => {
            this.postDueRecaps().catch(err => console.error('Error posting weekly recaps:', err));
        };
        check();
        this.interval = setInterval(check, CHECK_MS);
    }

    stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    async postDueRecaps(): Promise<void> {
        const now = this.clock().setZone(this.zone);
        if (now.weekday !== SUNDAY || now.hour < RECAP_HOUR) {
            return;
        }
        const since = now.minus({ days: 7 }).toJSDate();
        const until = now.toJSDate();
        const week = now.toFormat("kkkk-'W'WW");
        for (const chatId of await this.historyDao.getChatsWithHistoryBetween(since, until)) {
            await this.postRecap(chatId, since, until, week)
                .catch(err => console.error(`Failed to post the weekly recap to chat ${chatId}:`, err));
        }
    }

    private async postRecap(chatId: number, since: Date, until: Date, week: string): Promise<void> {
        if ((await this.chatDao.getChatSettings(chatId)).steam_updates === false) {
            return;
        }
        const history = await this.historyDao.getChatHistory(chatId, since);
        const recap = WeeklyRecap.of(history.filter(entry => entry.ended_at < until && isCompetitive(entry.mode)));
        if (recap.games === 0 || !(await this.recapDao.claim(chatId, week))) {
            return;
        }
        const text = recap.render();
        await broadcast(this.bot, { chat_id: chatId }, text, toDiscordMarkdown(text));
    }
}

export default RecapService;
