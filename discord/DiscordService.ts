import {
    ActionRowBuilder,
    ApplicationCommandOptionType,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    Client,
    GatewayIntentBits,
    GuildTextBasedChannel,
    Interaction,
    Message,
    MessageFlags,
    PermissionFlagsBits,
    PermissionsBitField,
    RESTOptions,
    TextChannel,
    WebhookClient
} from 'discord.js';
import ChatLinkDAO, { ChatLink } from '../dao/ChatLinkDAO.js';
import { DiscordIdentity } from '../dao/UserDAO.js';
import { splitMessage } from './markdown.js';
import { Rsvp } from '../dao/RsvpDAO.js';
import { RsvpKeyboardKind, rsvpLabels } from '../rsvp.js';
import { RelayFile } from '../media.js';

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
export type DiscordCommandHandler = (interaction: ChatInputCommandInteraction, link: ChatLink) => Promise<void>;
export type DiscordButtonHandler = (interaction: ButtonInteraction, link: ChatLink) => Promise<void>;

export interface SlashCommand {
    name: string;
    description: string;
    argument?: { name: string; description: string };
}

export const rsvpComponents = (kind: RsvpKeyboardKind): ActionRowBuilder<ButtonBuilder>[] => [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
        (['yes', 'maybe', 'no'] as Rsvp[]).map(value => new ButtonBuilder()
            .setCustomId(`rsvp:${value}`)
            .setLabel(rsvpLabels(kind)[value])
            .setStyle(ButtonStyle.Secondary))
    )
];

class DiscordService {
    public static instance: DiscordService | null = null;

    private client: Client;
    private restOptions: Partial<RESTOptions>;
    private chatLinkDao: ChatLinkDAO = new ChatLinkDAO();
    private webhookClients: Map<string, WebhookClient> = new Map();
    private messageHandlers: DiscordMessageHandler[] = [];
    private commandHandlers: DiscordCommandHandler[] = [];
    private buttonHandlers: DiscordButtonHandler[] = [];
    private slashCommands: SlashCommand[] = [];

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
        this.client.on('interactionCreate', (interaction: Interaction) => {
            this.handleInteraction(interaction).catch((err: Error) => console.error('Error handling Discord interaction:', err));
        });
        DiscordService.instance = this;
    }

    // `onReady` also runs after a reconnect.
    start(onReady?: () => Promise<void>): void {
        if (onReady) {
            this.client.on('clientReady', () => {
                onReady().catch((err: Error) => console.error('Discord ready hook failed:', err));
            });
        }
        this.client.login(process.env.DISCORD_BOT_TOKEN).catch((err: Error) => console.error('Discord login failed:', err));
    }

    onMessage(handler: DiscordMessageHandler): void {
        this.messageHandlers.push(handler);
    }

    onCommand(handler: DiscordCommandHandler): void {
        this.commandHandlers.push(handler);
    }

    onButton(handler: DiscordButtonHandler): void {
        this.buttonHandlers.push(handler);
    }

    private async handleInteraction(interaction: Interaction): Promise<void> {
        if (!interaction.isChatInputCommand() && !interaction.isButton()) {
            return;
        }
        const link: ChatLink | undefined = interaction.channelId ? await this.chatLinkDao.getLinkByChannel(interaction.channelId) : undefined;
        if (!link) {
            await interaction.reply({ content: 'This channel is not linked to a Telegram group.', flags: MessageFlags.Ephemeral });
        } else if (interaction.isChatInputCommand()) {
            await Promise.all(this.commandHandlers.map(handler => handler(interaction, link)));
        } else {
            await Promise.all(this.buttonHandlers.map(handler => handler(interaction, link)));
        }
    }

    setSlashCommands(commands: SlashCommand[]): void {
        this.slashCommands = commands;
    }

    // Guild commands apply at once; global ones would take an hour.
    async registerCommands(guild_id: string): Promise<void> {
        if (!this.client.application) {
            throw new Error('Discord client is not ready.');
        }
        await this.client.application.commands.set(this.slashCommands.map(command => ({
            name: command.name,
            description: command.description.slice(0, 100),
            options: command.argument ? [{
                type: ApplicationCommandOptionType.String,
                name: command.argument.name,
                description: command.argument.description.slice(0, 100),
                required: false
            }] : []
        })), guild_id);
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

    // members.search matches on prefix, so filter down to the exact username.
    async findMember(guild_id: string, username: string): Promise<DiscordIdentity | undefined> {
        const guild = this.client.guilds.cache.get(guild_id) ?? await this.client.guilds.fetch(guild_id).catch(() => undefined);
        if (!guild) {
            return undefined;
        }
        const members = await guild.members.search({ query: username, limit: 25 });
        const member = members.find(m => m.user.username.toLowerCase() === username.toLowerCase());
        return member ? { id: member.user.id, username: member.user.username, global_name: member.user.globalName } : undefined;
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

    // Returns the id of the last message sent; buttons and files go on that one.
    async sendAsBot(channel_id: string, content: string, components?: ActionRowBuilder<ButtonBuilder>[], files: { attachment: Buffer; name: string }[] = []): Promise<string> {
        const channel = await this.fetchGuildTextChannel(channel_id);
        if (!channel) {
            throw new Error(`Discord channel ${channel_id} is not reachable.`);
        }
        const chunks: string[] = splitMessage(content);
        return chunks.reduce(
            (sending: Promise<string>, chunk: string, i: number) => sending
                .then(() => channel.send({
                    content: chunk,
                    allowedMentions: { parse: ['users'] },
                    ...(components && i === chunks.length - 1 ? { components } : {}),
                    ...(files.length > 0 && i === chunks.length - 1 ? { files } : {})
                }))
                .then(sent => sent.id),
            Promise.resolve('')
        );
    }

    // An empty components list takes any buttons away.
    async editMessage(channel_id: string, message_id: string, content: string, components?: ActionRowBuilder<ButtonBuilder>[]): Promise<void> {
        const channel = await this.fetchGuildTextChannel(channel_id);
        if (!channel) {
            throw new Error(`Discord channel ${channel_id} is not reachable.`);
        }
        await channel.messages.edit(message_id, {
            content: splitMessage(content)[0],
            allowedMentions: { parse: ['users'] },
            ...(components ? { components } : {})
        });
    }

    async relay(link: ChatLink, author: string, content: string, files: RelayFile[] = []): Promise<void> {
        const attachments = files.map(file => ({ attachment: file.data, name: file.name }));
        if (link.webhook_id && link.webhook_token) {
            const webhook = this.webhookClient({ id: link.webhook_id, token: link.webhook_token });
            const chunks: string[] = content ? splitMessage(content) : [''];
            await chunks.reduce<Promise<unknown>>((sending, chunk, i) => sending.then(() => webhook.send({
                content: chunk,
                username: sanitizeWebhookName(author),
                allowedMentions: { parse: ['users'] },
                ...(i === chunks.length - 1 ? { files: attachments } : {})
            })), Promise.resolve());
            return;
        }
        await this.sendAsBot(link.discord_channel_id, content ? `**${author}:** ${content}` : `**${author}:**`, undefined, attachments);
    }
}

export default DiscordService;
