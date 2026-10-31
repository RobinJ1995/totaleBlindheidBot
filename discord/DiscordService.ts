import {
    Client,
    GatewayIntentBits,
    GuildTextBasedChannel,
    PermissionFlagsBits,
    PermissionsBitField,
    RESTOptions,
    TextChannel,
    WebhookClient
} from 'discord.js';

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

class DiscordService {
    public static instance: DiscordService | null = null;

    private client: Client;
    private restOptions: Partial<RESTOptions>;

    constructor() {
        this.restOptions = {
            ...(process.env.DISCORD_API_BASE_URL ? { api: process.env.DISCORD_API_BASE_URL } : {})
        };
        this.client = new Client({
            intents: [GatewayIntentBits.Guilds],
            rest: this.restOptions
        });
        this.client.on('clientReady', () => console.log(`Logged on to Discord as ${this.client.user?.tag}`));
        this.client.on('error', (err: Error) => console.error('Discord client error:', err));
        DiscordService.instance = this;
    }

    start(): void {
        this.client.login(process.env.DISCORD_BOT_TOKEN).catch((err: Error) => console.error('Discord login failed:', err));
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
        await new WebhookClient({ id: webhook.id, token: webhook.token }, { rest: this.restOptions }).delete();
    }

    async sendAsBot(channel_id: string, content: string): Promise<string> {
        const channel = await this.fetchGuildTextChannel(channel_id);
        if (!channel) {
            throw new Error(`Discord channel ${channel_id} is not reachable.`);
        }
        const sent = await channel.send({ content, allowedMentions: { parse: ['users'] } });
        return sent.id;
    }
}

export default DiscordService;
