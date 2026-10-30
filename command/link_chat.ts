import { Bot } from 'node-telegram-bot-api';
import { ExtendedMessage } from '../MessageRouter.js';
import { isChatAdmin } from '../admin.js';
import ChatLinkDAO, { ChatLink } from '../dao/ChatLinkDAO.js';
import DiscordService, { ChannelInspection, Webhook } from '../discord/DiscordService.js';
import { formatError } from '../utils.js';

const chatLinkDao = new ChatLinkDAO();

export const NOT_CONFIGURED = 'Discord is not configured for this bot.';
export const ADMIN_ONLY = 'Only a group admin can link or unlink Discord channels.';
export const USAGE = 'Usage: /link_chat <Discord channel id>. In Discord, turn on Developer Mode (User Settings → Advanced), then right-click the channel and choose Copy Channel ID.';

export const isSnowflake = (value: string): boolean => /^\d+$/.test(value);

const notFound = (channel_id: string): string =>
    `I can't see a Discord channel with id ${channel_id}. A server admin (Manage Server permission) needs to add me to that server, and I need to be able to view the channel.`;

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
        if (!channel_id || !isSnowflake(channel_id) || msg.command.argumentTokens.length !== 1) {
            await msg.reply(USAGE);
            return;
        }

        const existing: ChatLink | undefined = await chatLinkDao.getLinkByChannel(channel_id);
        if (existing) {
            await msg.reply(existing.telegram_chat_id === msg.chat.id
                ? 'That channel is already linked to this group.'
                : 'That channel is already linked to another Telegram group.');
            return;
        }

        const inspection: ChannelInspection = await discord.inspectChannel(channel_id);
        switch (inspection.kind) {
            case 'not_found':
                await msg.reply(notFound(channel_id));
                return;
            case 'wrong_type':
                await msg.reply('That Discord channel is not a text channel.');
                return;
            case 'missing_permissions':
                await msg.reply(`I can see #${inspection.channel_name} on ${inspection.guild_name}, but I'm missing permissions there: ${inspection.missing.join(', ')}.`);
                return;
        }

        const webhook: Webhook | undefined = inspection.can_manage_webhooks ? await discord.createWebhook(channel_id) : undefined;
        await chatLinkDao.addLink({
            telegram_chat_id: msg.chat.id,
            discord_guild_id: inspection.guild_id,
            discord_channel_id: channel_id,
            webhook_id: webhook?.id,
            webhook_token: webhook?.token
        });

        const group: string = msg.chat.title ? `the Telegram group “${msg.chat.title}”` : 'a Telegram group';
        await discord.sendAsBot(channel_id, `This channel is now linked to ${group}. Messages here and there are relayed both ways.`);
        await msg.reply(`Linked to #${inspection.channel_name} on ${inspection.guild_name}.` + (webhook
            ? ''
            : " I can't manage webhooks there, so relayed messages will be posted by me with the sender's name in front."));
    } catch (err: any) {
        await msg.reply(formatError(err));
    }
};
