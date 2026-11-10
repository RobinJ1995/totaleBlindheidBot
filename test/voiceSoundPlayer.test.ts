import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream, existsSync } from 'node:fs';
import { once } from 'node:events';
import { AudioPlayer, AudioPlayerStatus, createAudioResource, StreamType, VoiceConnectionStatus } from '@discordjs/voice';
import ChatLinkDAO, { ChatLink } from '../dao/ChatLinkDAO.js';
import VoiceSoundPlayer, { Sound, soundFile, VoiceConnectionLookup } from '../discord/VoiceSoundPlayer.js';

const LINKS: Record<number, ChatLink[]> = {
    [-5]: [
        { telegram_chat_id: -5, discord_guild_id: 'g1', discord_channel_id: 'a' },
        { telegram_chat_id: -5, discord_guild_id: 'g1', discord_channel_id: 'b' },
        { telegram_chat_id: -5, discord_guild_id: 'g2', discord_channel_id: 'c' },
        { telegram_chat_id: -5, discord_guild_id: 'idle', discord_channel_id: 'd' }
    ]
};

const players: AudioPlayer[] = [];

// The bot is in voice in g1 and g2, still connecting in "connecting", and absent elsewhere.
const subscribed: [string, AudioPlayer][] = [];
const connectionOf: VoiceConnectionLookup = guild_id => {
    if (!['g1', 'g2', 'connecting'].includes(guild_id)) {
        return undefined;
    }
    return {
        state: { status: guild_id === 'connecting' ? VoiceConnectionStatus.Signalling : VoiceConnectionStatus.Ready },
        subscribe: (player: AudioPlayer) => {
            subscribed.push([guild_id, player]);
            return undefined;
        }
    } as unknown as ReturnType<VoiceConnectionLookup>;
};

const playing = (player: AudioPlayer): unknown => (player.state as any).resource?.metadata;

const announce = async (chat_id: number, result: 'win' | 'loss' | 'tie'): Promise<[string, unknown][]> => {
    mock.method(ChatLinkDAO.prototype, 'getLinks', async (id: number) => LINKS[id] ?? []);
    players.push(...await new VoiceSoundPlayer(connectionOf).announce(chat_id, result));
    return subscribed.map(([guild_id, player]) => [guild_id, playing(player)]);
};

afterEach(() => {
    mock.restoreAll();
    players.splice(0).forEach(player => player.stop(true));
    subscribed.splice(0);
});

test('a win plays the win sound once in every linked server the bot is in voice in', async () => {
    assert.deepEqual(await announce(-5, 'win'), [['g1', 'win'], ['g2', 'win']]);
});

test('a loss plays the loss sound', async () => {
    assert.deepEqual(await announce(-5, 'loss'), [['g1', 'loss'], ['g2', 'loss']]);
});

test('a tie plays nothing', async () => {
    assert.deepEqual(await announce(-5, 'tie'), []);
});

test('a chat without linked servers plays nothing', async () => {
    assert.deepEqual(await announce(-6, 'win'), []);
});

test('nothing is played where the bot is not connected to voice', () => {
    const player = new VoiceSoundPlayer(connectionOf);
    assert.equal(player.play('idle', 'win'), undefined);
    assert.equal(player.play('connecting', 'win'), undefined);
    assert.deepEqual(subscribed, []);
});

test('a player lets go of the connection once its sound has finished', async () => {
    let unsubscribed = false;
    const lookup: VoiceConnectionLookup = () => ({
        state: { status: VoiceConnectionStatus.Ready },
        subscribe: () => ({ unsubscribe: () => { unsubscribed = true; } })
    } as unknown as ReturnType<VoiceConnectionLookup>);
    const player = new VoiceSoundPlayer(lookup).play('g1', 'win') as AudioPlayer;
    player.stop(true);
    assert.equal(player.state.status, AudioPlayerStatus.Idle);
    assert.equal(unsubscribed, true);
});

(['win', 'loss'] as Sound[]).forEach(sound => {
    test(`the ${sound} sound ships as Ogg Opus that plays without transcoding`, async () => {
        assert.equal(existsSync(soundFile(sound)), true);
        const resource = createAudioResource(createReadStream(soundFile(sound)), { inputType: StreamType.OggOpus });
        await once(resource.playStream, 'readable');
        const packet: Buffer | null = resource.read();
        resource.playStream.destroy();
        assert.ok(packet && packet.length > 0);
    });
});
