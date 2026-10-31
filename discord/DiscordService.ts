import {
    Client,
    GatewayIntentBits,
    GuildTextBasedChannel,
    Message,
    PermissionFlagsBits,
    PermissionsBitField,
    RESTOptions,
    TextChannel,
    WebhookClient
} from 'discord.js';
import ChatLinkDAO, { ChatLink } from '../dao/ChatLinkDAO.js';
import { splitMessage } from './markdown.js';

// Names as Discord shows them, for telling an admin what is missing.
const REQUIRED_PERMISSIONS: { flag: bigint; name: string }[] = [
    { flag: PermissionFlagsBits.ViewChannel, name: 'View Channel' },
    { flag: PermissionFlagsBits.SendMessages, name: 'Send Messages' },
    { flag: PermissionFlagsBits.ReadMessageHistory, name: 'Read Message History' },
    { flag: PermissionFlagsBits.AttachFiles, name: 'Attach Files' },
    { flag: PermissionFlagsBits.EmbedLinks, name: 'Embed Links' }
];

export type ChannelInspection =
    | { kind: 'not_found' }
    | { kind: 'wrong_type' }
    | { kind: 'missing_permissions'; guild_name: string; channel_name: string; missing: string[] }
    | { kind: 'ok'; guild_id: string; guild_name: string; channel_name: string; can_manage_webhooks: boolean };

export interface Webhook {
    id: string;
    token: string;
}

// Discord webhook names (and the per-message username override) may not contain these.
const sanitizeWebhookName = (name: string): string =>
    name.replace(/discord/gi, 'disc0rd').replace(/clyde/gi, 'c1yde').slice(0, 80) || 'someone';

export type DiscordMessageHandler = (message: Message, link: ChatLink) => Promise<void>;

class DiscordService {
    public static instance: DiscordService | null = null;

    private client: Client;
    private restOptions: Partial<RESTOptions>;
    private chatLinkDao: ChatLinkDAO = new ChatLinkDAO();
    private webhookClients: Map<string, WebhookClient> = new Map();
    private messageHandlers: DiscordMessageHandler[] = [];

    constructor() {
        this.restOptions = {
            ...(process.env.DISCORD_API_BASE_URL ? { api: process.env.DISCORD_API_BASE_URL } : {})
        };
        this.client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
            rest: this.restOptions
        });
        this.client.on('clientReady', () => console.log(`Logged on to Discord as ${this.client.user?.tag}`));
        this.client.on('error', (err: Error) => console.error('Discord client error:', err));
        this.client.on('messageCreate', (message: Message) => {
            this.handleMessage(message).catch((err: Error) => console.error('Error handling Discord message:', err));
        });
        DiscordService.instance = this;
    }

    start(): void {
        this.client.login(process.env.DISCORD_BOT_TOKEN).catch((err: Error) => console.error('Discord login failed:', err));
    }

    onMessage(handler: DiscordMessageHandler): void {
        this.messageHandlers.push(handler);
    }

    private async handleMessage(message: Message): Promise<void> {
        if (!message.inGuild() || message.author.id === this.client.user?.id) {
            return;
        }
        const link: ChatLink | undefined = await this.chatLinkDao.getLinkByChannel(message.channelId);
        if (!link || (message.webhookId && message.webhookId === link.webhook_id)) {
            return;
        }
        await Promise.all(this.messageHandlers.map(handler => handler(message, link)));
    }

    private async fetchGuildTextChannel(channel_id: string): Promise<GuildTextBasedChannel | null | undefined> {
        try {
            const channel = await this.client.channels.fetch(channel_id);
            if (!channel) {
                return undefined;
            }
            return channel.isTextBased() && !channel.isDMBased() ? channel : null;
        } catch (err: any) {
            // Unknown Channel / Missing Access.
            if (err?.code === 10003 || err?.code === 50001 || err?.status === 404 || err?.status === 403) {
                return undefined;
            }
            throw err;
        }
    }

    async inspectChannel(channel_id: string): Promise<ChannelInspection> {
        const channel = await this.fetchGuildTextChannel(channel_id);
        if (channel === undefined) {
            return { kind: 'not_found' };
        } else if (channel === null) {
            return { kind: 'wrong_type' };
        }
        const me = channel.guild.members.me ?? await channel.guild.members.fetchMe();
        const permissions: PermissionsBitField | null = channel.permissionsFor(me);
        const missing: string[] = REQUIRED_PERMISSIONS
            .filter(p => !permissions?.has(p.flag))
            .map(p => p.name);
        if (missing.length > 0) {
            return { kind: 'missing_permissions', guild_name: channel.guild.name, channel_name: channel.name, missing };
        }
        return {
            kind: 'ok',
            guild_id: channel.guildId,
            guild_name: channel.guild.name,
            channel_name: channel.name,
            can_manage_webhooks: !!permissions?.has(PermissionFlagsBits.ManageWebhooks)
        };
    }

    async createWebhook(channel_id: string): Promise<Webhook | undefined> {
        const channel = await this.fetchGuildTextChannel(channel_id);
        if (!channel || !(channel instanceof TextChannel)) {
            return undefined;
        }
        const webhook = await channel.createWebhook({ name: 'Telegram relay' });
        return webhook.token ? { id: webhook.id, token: webhook.token } : undefined;
    }

    async deleteWebhook(webhook: Webhook): Promise<void> {
        this.webhookClients.delete(webhook.id);
        await new WebhookClient({ id: webhook.id, token: webhook.token }, { rest: this.restOptions }).delete();
    }

    private webhookClient(webhook: Webhook): WebhookClient {
        let client = this.webhookClients.get(webhook.id);
        if (!client) {
            client = new WebhookClient({ id: webhook.id, token: webhook.token }, { rest: this.restOptions });
            this.webhookClients.set(webhook.id, client);
        }
        return client;
    }

    // Returns the id of the last message sent.
    async sendAsBot(channel_id: string, content: string): Promise<string> {
        const channel = await this.fetchGuildTextChannel(channel_id);
        if (!channel) {
            throw new Error(`Discord channel ${channel_id} is not reachable.`);
        }
        return splitMessage(content).reduce(
            (sending: Promise<string>, chunk: string) => sending
                .then(() => channel.send({ content: chunk, allowedMentions: { parse: ['users'] } }))
                .then(sent => sent.id),
            Promise.resolve('')
        );
    }

    async relay(link: ChatLink, author: string, content: string): Promise<void> {
        if (link.webhook_id && link.webhook_token) {
            const webhook = this.webhookClient({ id: link.webhook_id, token: link.webhook_token });
            await splitMessage(content).reduce<Promise<unknown>>(
                (sending, chunk) => sending.then(() => webhook.send({ content: chunk, username: sanitizeWebhookName(author), allowedMentions: { parse: ['users'] } })),
                Promise.resolve()
            );
            return;
        }
        await this.sendAsBot(link.discord_channel_id, `**${author}:** ${content}`);
    }
}

export default DiscordService;
