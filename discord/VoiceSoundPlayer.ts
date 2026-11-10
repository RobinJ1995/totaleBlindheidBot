import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import {
    AudioPlayer,
    AudioPlayerStatus,
    createAudioPlayer,
    createAudioResource,
    getVoiceConnection,
    StreamType,
    VoiceConnection,
    VoiceConnectionStatus
} from '@discordjs/voice';
import ChatLinkDAO from '../dao/ChatLinkDAO.js';
import { MatchResult } from '../SteamService.js';

export type Sound = 'win' | 'loss';

export const soundFile = (sound: Sound): string => join(import.meta.dirname, '..', 'assets', 'sounds', `${sound}.ogg`);

export type VoiceConnectionLookup = (guild_id: string) => Pick<VoiceConnection, 'state' | 'subscribe'> | undefined;

// Plays the win or loss sound in the voice channels the bot is in.
class VoiceSoundPlayer {
    private chatLinkDao: ChatLinkDAO = new ChatLinkDAO();

    constructor(private readonly connectionOf: VoiceConnectionLookup = getVoiceConnection) {}

    // A finished match is heard in every Discord server linked to the chat; a tie is silent.
    async announce(chat_id: number, result: MatchResult): Promise<AudioPlayer[]> {
        if (result === 'tie') {
            return [];
        }
        const guild_ids: string[] = Array.from(new Set((await this.chatLinkDao.getLinks(chat_id)).map(link => link.discord_guild_id)));
        return guild_ids
            .map(guild_id => this.play(guild_id, result))
            .filter((player): player is AudioPlayer => !!player);
    }

    play(guild_id: string, sound: Sound): AudioPlayer | undefined {
        const connection = this.connectionOf(guild_id);
        if (!connection || connection.state.status !== VoiceConnectionStatus.Ready) {
            return undefined;
        }
        const player: AudioPlayer = createAudioPlayer();
        const subscription = connection.subscribe(player);
        player.on(AudioPlayerStatus.Idle, () => subscription?.unsubscribe());
        player.on('error', (err: Error) => console.error(`Could not play the ${sound} sound in guild ${guild_id}:`, err));
        player.play(createAudioResource(createReadStream(soundFile(sound)), { inputType: StreamType.OggOpus, metadata: sound }));
        return player;
    }
}

export default VoiceSoundPlayer;
