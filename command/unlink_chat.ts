import { Bot } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter.js';
import { isChatAdmin } from '../admin.js';
import ChatLinkDAO, { ChatLink } from '../dao/ChatLinkDAO.js';
import DiscordService from '../discord/DiscordService.js';
import { formatError } from '../utils.js';
import { ADMIN_ONLY, NOT_CONFIGURED, isSnowflake } from './link_chat.js';

const chatLinkDao = new ChatLinkDAO();

export const UNLINKED_NOTICE = 'This channel is no longer linked to Telegram.';

// Discord-side failures (kicked, lost permissions) don't stop the unlink.
const tearDown = async (discord: DiscordService, link: ChatLink): Promise<void> => {
    await chatLinkDao.removeLink(link.telegram_chat_id, link.discord_channel_id);
    if (link.webhook_id && link.webhook_token) {
        await discord.deleteWebhook({ id: link.webhook_id, token: link.webhook_token })
            .catch((err: Error) => console.error(`Could not delete webhook ${link.webhook_id}:`, err));
    }
    await discord.sendAsBot(link.discord_channel_id, UNLINKED_NOTICE)
        .catch((err: Error) => console.error(`Could not announce unlink in Discord channel ${link.discord_channel_id}:`, err));
};

export default async (bot: Bot, msg: ExtendedMessage): Promise<void> => {
    try {
        const discord: DiscordService | null = DiscordService.instance;
        if (!discord) {
            await msg.reply(NOT_CONFIGURED);
            return;
        } else if (!(await isChatAdmin(bot, msg.chat.id, msg.from?.id))) {
            await msg.reply(ADMIN_ONLY);
            return;
        }

        const channel_id: string | undefined = msg.command.argumentTokens[0];
        if (channel_id !== undefined) {
            if (!isSnowflake(channel_id)) {
                await msg.reply('Usage: /unlink_chat [Discord channel id]. Without an id, every linked channel is unlinked.');
                return;
            }
            const link: ChatLink | undefined = await chatLinkDao.getLinkByChannel(channel_id);
            if (!link || link.telegram_chat_id !== msg.chat.id) {
                await msg.reply('That channel is not linked to this group.');
                return;
            }
            await tearDown(discord, link);
            await msg.reply(`Unlinked Discord channel ${channel_id}.`);
            return;
        }

        const links: ChatLink[] = await chatLinkDao.getLinks(msg.chat.id);
        if (links.length === 0) {
            await msg.reply('No Discord channels are linked to this group.');
            return;
        }
        await Promise.all(links.map(link => tearDown(discord, link)));
        await msg.reply(`Unlinked ${links.length} Discord channel${links.length === 1 ? '' : 's'}.`);
    } catch (err: any) {
        await msg.reply(formatError(err));
    }
};
