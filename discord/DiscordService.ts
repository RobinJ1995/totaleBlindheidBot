import {
    ActionRowBuilder,
    AnyThreadChannel,
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
    MessageReaction,
    MessageFlags,
    PartialMessage,
    Partials,
    PermissionFlagsBits,
    PermissionsBitField,
    PartialMessageReaction,
    PartialUser,
    RESTOptions,
    Routes,
    TextChannel,
    User,
    WebhookClient
} from 'discord.js';
import { getVoiceConnection, joinVoiceChannel, VoiceConnectionStatus } from '@discordjs/voice';
import ChatLinkDAO, { ChatLink } from '../dao/ChatLinkDAO.js';
import { DiscordIdentity } from '../dao/UserDAO.js';
import { splitMessage, toDiscordMarkdown } from './markdown.js';
import { Rsvp } from '../dao/RsvpDAO.js';
import { RsvpKeyboardKind, rsvpLabels } from '../rsvp.js';
import { RelayFile } from '../media.js';
import { CopyKind } from '../dao/RelayedMessageDAO.js';

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
export const sanitizeWebhookName = (name: string): string =>
    name.replace(/discord/gi, 'didi').replace(/clyde/gi, 'dada').slice(0, 80) || 'someone';

// The message a relayed copy replies to, as its copy in the same channel. Webhooks can't post real
// replies, so a reply is a linked line above the message.
export interface ReplyTo {
    author: string;
    message_id: string;
}

const replyLine = (link: ChatLink, reply?: ReplyTo): string => reply
    ? `-# [↪ Replying to ${toDiscordMarkdown({ text: reply.author, entities: [] })}](https://discord.com/channels/${link.discord_guild_id}/${link.discord_channel_id}/${reply.message_id})\n`
    : '';

const botRelayText = (author: string, content: string): string => content ? `**${author}:** ${content}` : `**${author}:**`;

export type DiscordMessageHandler = (message: Message, link: ChatLink) => Promise<void>;
export type DiscordEditHandler = (message: Message | PartialMessage, link: ChatLink) => Promise<void>;
export type DiscordDeleteHandler = (channel_id: string, message_id: string, link: ChatLink) => Promise<void>;
export type DiscordReactionHandler = (channel_id: string, message_id: string, user_id: string, emoji: string, added: boolean) => Promise<void>;
export type DiscordCommandHandler = (interaction: ChatInputCommandInteraction, link: ChatLink) => Promise<void>;
export type DiscordButtonHandler = (interaction: ButtonInteraction, link: ChatLink) => Promise<void>;
export type DiscordVoiceHandler = (guild_id: string) => Promise<void>;

export interface VoiceMember {
    user_id: string;
    channel_id: string;
}

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
    private editHandlers: DiscordEditHandler[] = [];
    private deleteHandlers: DiscordDeleteHandler[] = [];
    private reactionHandlers: DiscordReactionHandler[] = [];
    private commandHandlers: DiscordCommandHandler[] = [];
    private buttonHandlers: DiscordButtonHandler[] = [];
    private voiceHandlers: DiscordVoiceHandler[] = [];
    private slashCommands: SlashCommand[] = [];

    constructor() {
        this.restOptions = {
            ...(process.env.DISCORD_API_BASE_URL ? { api: process.env.DISCORD_API_BASE_URL } : {}),
            // The media proxy serves animated stickers.
            ...(process.env.DISCORD_CDN_BASE_URL ? { cdn: process.env.DISCORD_CDN_BASE_URL, mediaProxy: process.env.DISCORD_CDN_BASE_URL } : {})
        };
        this.client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildVoiceStates],
            // Edits to messages from before a restart arrive uncached.
            partials: [Partials.Message, Partials.Reaction, Partials.User],
            rest: this.restOptions
        });
        this.client.on('clientReady', () => console.log(`Logged on to Discord as ${this.client.user?.tag}`));
        this.client.on('error', (err: Error) => console.error('Discord client error:', err));
        this.client.on('messageCreate', (message: Message) => {
            this.handleMessage(message).catch((err: Error) => console.error('Error handling Discord message:', err));
        });
        this.client.on('messageUpdate', (_old, message) => {
            this.handleEdit(message).catch((err: Error) => console.error('Error handling Discord edit:', err));
        });
        this.client.on('threadCreate', thread => {
            this.joinThread(thread).catch((err: Error) => console.error(`Could not join Discord thread ${thread.id}:`, err));
        });
        this.client.on('messageDelete', message => {
            this.handleDelete(message.channelId, message.id).catch((err: Error) => console.error('Error handling Discord deletion:', err));
        });
        this.client.on('messageReactionAdd', (reaction, user) => {
            this.handleReaction(reaction, user, true).catch((err: Error) => console.error('Error handling Discord reaction:', err));
        });
        this.client.on('messageReactionRemove', (reaction, user) => {
            this.handleReaction(reaction, user, false).catch((err: Error) => console.error('Error handling Discord reaction:', err));
        });
        this.client.on('interactionCreate', (interaction: Interaction) => {
            this.handleInteraction(interaction).catch((err: Error) => console.error('Error handling Discord interaction:', err));
        });
        this.client.on('voiceStateUpdate', (_old, state) => this.handleVoiceChange(state.guild.id));
        this.client.on('clientReady', () => this.client.guilds.cache.forEach(guild => this.handleVoiceChange(guild.id)));
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

    onEdit(handler: DiscordEditHandler): void {
        this.editHandlers.push(handler);
    }

    onDelete(handler: DiscordDeleteHandler): void {
        this.deleteHandlers.push(handler);
    }

    onReaction(handler: DiscordReactionHandler): void {
        this.reactionHandlers.push(handler);
    }

    onCommand(handler: DiscordCommandHandler): void {
        this.commandHandlers.push(handler);
    }

    onButton(handler: DiscordButtonHandler): void {
        this.buttonHandlers.push(handler);
    }

    // Called with a guild whenever who is in which of its voice channels may have changed.
    onVoiceChange(handler: DiscordVoiceHandler): void {
        this.voiceHandlers.push(handler);
    }

    private handleVoiceChange(guild_id: string): void {
        this.voiceHandlers.forEach(handler => handler(guild_id)
            .catch((err: Error) => console.error(`Error handling Discord voice change in guild ${guild_id}:`, err)));
    }

    // Everyone but the bot who is in a voice channel of the guild.
    voiceMembers(guild_id: string): VoiceMember[] {
        const states = this.client.guilds.cache.get(guild_id)?.voiceStates.cache;
        return Array.from(states?.values() ?? [])
            .filter(state => state.channelId && state.id !== this.client.user?.id)
            .map(state => ({ user_id: state.id, channel_id: state.channelId as string }));
    }

    // The voice channel the bot is connected to in the guild.
    voiceChannel(guild_id: string): string | undefined {
        const connection = getVoiceConnection(guild_id);
        if (!connection || connection.state.status === VoiceConnectionStatus.Disconnected) {
            return undefined;
        }
        return connection.joinConfig.channelId ?? undefined;
    }

    joinVoice(guild_id: string, channel_id: string): void {
        const guild = this.client.guilds.cache.get(guild_id);
        if (!guild) {
            return;
        }
        const connection = getVoiceConnection(guild_id);
        if (connection) {
            connection.rejoin({ channelId: channel_id, selfDeaf: true, selfMute: false });
            return;
        }
        joinVoiceChannel({ guildId: guild_id, channelId: channel_id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true });
    }

    leaveVoice(guild_id: string): void {
        getVoiceConnection(guild_id)?.destroy();
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

    async unregisterCommands(guild_id: string): Promise<void> {
        await this.client.application?.commands.set([], guild_id);
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

    // A thread's messages belong to the channel it was started in.
    private linkOf(channel_id: string): Promise<ChatLink | undefined> {
        const channel = this.client.channels.cache.get(channel_id);
        return this.chatLinkDao.getLinkByChannel(channel?.isThread() && channel.parentId ? channel.parentId : channel_id);
    }

    // The bot only hears a thread once it has joined it.
    private async joinThread(thread: AnyThreadChannel): Promise<void> {
        if (thread.joinable && await this.linkOf(thread.id)) {
            await thread.join();
        }
    }

    // System messages, such as Discord announcing a new thread, aren't relayed.
    private async handleMessage(message: Message): Promise<void> {
        if (!message.inGuild() || message.system || message.author.id === this.client.user?.id) {
            return;
        }
        const link: ChatLink | undefined = await this.linkOf(message.channelId);
        if (!link || (message.webhookId && message.webhookId === link.webhook_id)) {
            return;
        }
        await Promise.all(this.messageHandlers.map(handler => handler(message, link)));
    }

    // Embeds resolving also update a message; only a real edit carries an edit time.
    private async handleEdit(message: Message | PartialMessage): Promise<void> {
        if (!message.editedTimestamp || message.author?.id === this.client.user?.id) {
            return;
        }
        const link: ChatLink | undefined = await this.linkOf(message.channelId);
        if (!link || (message.webhookId && message.webhookId === link.webhook_id)) {
            return;
        }
        await Promise.all(this.editHandlers.map(handler => handler(message, link)));
    }

    private async handleDelete(channel_id: string, message_id: string): Promise<void> {
        const link: ChatLink | undefined = await this.linkOf(channel_id);
        if (link) {
            await Promise.all(this.deleteHandlers.map(handler => handler(channel_id, message_id, link)));
        }
    }

    // Custom emoji (those with an id) can't be shown elsewhere.
    private async handleReaction(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, added: boolean): Promise<void> {
        const emoji: string | null = reaction.emoji.id ? null : reaction.emoji.name;
        if (!emoji || user.id === this.client.user?.id || !await this.linkOf(reaction.message.channelId)) {
            return;
        }
        await Promise.all(this.reactionHandlers.map(handler => handler(reaction.message.channelId, reaction.message.id, user.id, emoji, added)));
    }

    async setOwnReaction(channel_id: string, message_id: string, emoji: string, on: boolean): Promise<void> {
        const route = Routes.channelMessageOwnReaction(channel_id, message_id, encodeURIComponent(emoji));
        await (on ? this.client.rest.put(route) : this.client.rest.delete(route));
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

    // Returns the (last) message sent and how, so it can be edited later.
    async relay(link: ChatLink, author: string, content: string, files: RelayFile[] = [], reply?: ReplyTo): Promise<{ message_id: string; kind: CopyKind }> {
        const attachments = files.map(file => ({ attachment: file.data, name: file.name }));
        if (link.webhook_id && link.webhook_token) {
            const webhook = this.webhookClient({ id: link.webhook_id, token: link.webhook_token });
            const text: string = replyLine(link, reply) + content;
            const chunks: string[] = text ? splitMessage(text) : [''];
            const message_id: string = await chunks.reduce((sending: Promise<string>, chunk: string, i: number) => sending.then(() => webhook.send({
                content: chunk,
                username: sanitizeWebhookName(author),
                allowedMentions: { parse: ['users'] },
                ...(i === chunks.length - 1 ? { files: attachments } : {})
            })).then(sent => sent.id), Promise.resolve(''));
            return { message_id, kind: 'webhook' };
        }
        return { message_id: await this.sendAsBot(link.discord_channel_id, replyLine(link, reply) + botRelayText(author, content), undefined, attachments), kind: 'bot' };
    }

    async deleteRelayed(link: ChatLink, message_id: string, kind: CopyKind): Promise<void> {
        if (kind === 'webhook' && link.webhook_id && link.webhook_token) {
            await this.webhookClient({ id: link.webhook_id, token: link.webhook_token }).deleteMessage(message_id);
            return;
        }
        const channel = await this.fetchGuildTextChannel(link.discord_channel_id);
        await channel?.messages.delete(message_id);
    }

    async editRelayed(link: ChatLink, message_id: string, kind: CopyKind, author: string, content: string, reply?: ReplyTo): Promise<void> {
        if (kind === 'webhook' && link.webhook_id && link.webhook_token) {
            await this.webhookClient({ id: link.webhook_id, token: link.webhook_token }).editMessage(message_id, { content: splitMessage(replyLine(link, reply) + content)[0] });
        } else if (kind === 'bot') {
            await this.editMessage(link.discord_channel_id, message_id, replyLine(link, reply) + botRelayText(author, content));
        }
    }
}

export default DiscordService;
