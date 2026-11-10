import ChatLinkDAO from '../dao/ChatLinkDAO.js';
import RollcallPlayerDAO from '../dao/RollcallPlayerDAO.js';
import { User } from '../dao/UserDAO.js';
import { mentionUsers } from '../presence.js';
import { VoiceMember } from './DiscordService.js';

export interface VoiceGateway {
    voiceMembers(guild_id: string): VoiceMember[];
    voiceChannel(guild_id: string): string | undefined;
    joinVoice(guild_id: string, channel_id: string): void;
    leaveVoice(guild_id: string): void;
}

// Keeps the bot in the voice channel where a guild's rollcall rotation players are.
class VoicePresence {
    private chatLinkDao: ChatLinkDAO = new ChatLinkDAO();
    private rollcallPlayerDao: RollcallPlayerDAO = new RollcallPlayerDAO();

    constructor(private readonly voice: VoiceGateway) {}

    async sync(guild_id: string): Promise<void> {
        const players: Set<string> = await this.rotationDiscordIds(guild_id);
        const current: string | undefined = this.voice.voiceChannel(guild_id);
        const target: string | undefined = this.targetChannel(guild_id, players, current);
        if (target === current) {
            return;
        } else if (!target) {
            this.voice.leaveVoice(guild_id);
            return;
        }
        this.voice.joinVoice(guild_id, target);
    }

    // The Discord ids of the rotation players of every chat linked to the guild.
    private async rotationDiscordIds(guild_id: string): Promise<Set<string>> {
        const chat_ids: number[] = Array.from(new Set((await this.chatLinkDao.getAllLinks())
            .filter(link => link.discord_guild_id === guild_id)
            .map(link => link.telegram_chat_id)));
        const rotations: string[][] = await Promise.all(chat_ids.map(chat_id => this.rollcallPlayerDao.getRollcallPlayerUsernames(chat_id)));
        const users: Record<number, User> = await mentionUsers(rotations.flat());
        return new Set(Object.values(users)
            .map(user => user.discord_id)
            .filter((id): id is string => !!id));
    }

    // The channel with the most rotation players; the current one wins a draw.
    private targetChannel(guild_id: string, players: Set<string>, current?: string): string | undefined {
        const counts = new Map<string, number>();
        this.voice.voiceMembers(guild_id)
            .filter(member => players.has(member.user_id))
            .forEach(member => counts.set(member.channel_id, (counts.get(member.channel_id) ?? 0) + 1));
        const most: number = Math.max(0, ...counts.values());
        if (current && most > 0 && counts.get(current) === most) {
            return current;
        }
        return Array.from(counts.keys()).find(channel_id => counts.get(channel_id) === most);
    }
}

export default VoicePresence;
