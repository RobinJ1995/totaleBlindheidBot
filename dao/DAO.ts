import { v4 as uuid } from 'uuid';
import { checkNotEmpty } from '../utils';
import { loadJSON, saveJSON } from './S3Client';

const FILE_ROLLCALL_PLAYERS = 'rollcall_players.json';
const FILE_ROLLCALL_SCHEDULES = 'rollcall_schedules.json';
const FILE_USER_SETTINGS = 'user_settings.json';

export interface UserSettings {
    steam_id?: string;
    steam_ids?: string[];
    timezone?: string;
}

export interface ChatSettings {
    steam_updates?: boolean;
}

export interface GameUpdate {
    message_id: number;
    text: string;
    info: any;
    timestamp: string;
}

export interface RollcallPlayer {
    username: string;
    chat_id: number;
    key?: string;
}

export type ScheduledRollcalls = Record<string, string>;

class DAO {
    private locks: Map<string, Promise<any>>;

    constructor() {
        this.locks = new Map();
    }

    async _withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
        if (!this.locks.has(key)) {
            this.locks.set(key, Promise.resolve());
        }
        const lock = this.locks.get(key)!;
        const nextLock = lock.then(async () => {
            try {
                return await fn();
            } catch (err) {
                // We want to return the error but ensure the lock continues
                throw err;
            }
        });
        // Ensure the next lock doesn't fail just because this one did
        this.locks.set(key, nextLock.catch(() => {}));
        return nextLock;
    }

    getUserSettings(user_id: number): Promise<UserSettings> {
        return loadJSON<Record<string, UserSettings>>(FILE_USER_SETTINGS)
            .then(settings => settings[user_id] || {});
    }

    getAllUserSettings(): Promise<Record<string, UserSettings>> {
        return loadJSON<Record<string, UserSettings>>(FILE_USER_SETTINGS);
    }

    setSteamUserId(user_id: number, steam_id: string | string[]): Promise<void> {
        return this._withLock(FILE_USER_SETTINGS, () => {
            return loadJSON<Record<string, UserSettings>>(FILE_USER_SETTINGS)
                .then(settings => {
                    if (!settings[user_id]) settings[user_id] = {};
                    const steamIds: string[] = Array.isArray(steam_id) ? steam_id : [steam_id];
                    settings[user_id].steam_id = steamIds[0];
                    settings[user_id].steam_ids = steamIds;
                    return saveJSON(FILE_USER_SETTINGS, settings);
                });
        });
    }

    getUserTimezone(user_id: number): Promise<string> {
        return this.getUserSettings(user_id)
            .then((settings: UserSettings) => settings.timezone || 'UTC');
    }

    setUserTimezone(user_id: number, timezone: string): Promise<void> {
        return this._withLock(FILE_USER_SETTINGS, () => {
            return loadJSON<Record<string, UserSettings>>(FILE_USER_SETTINGS)
                .then(settings => {
                    if (!settings[user_id]) settings[user_id] = {};
                    settings[user_id].timezone = timezone;
                    return saveJSON(FILE_USER_SETTINGS, settings);
                });
        });
    }

    addUserChat(user_id: number, chat_id: number): Promise<boolean> {
        const key = `user_chats/${user_id}.json`;
        return this._withLock(key, () => {
            return loadJSON<(string | number)[]>(key)
                .then((userChats: (string | number)[]) => {
                    const chats: (string | number)[] = Array.isArray(userChats) ? userChats : [];
                    if (!chats.includes(chat_id)) {
                        chats.push(chat_id);
                        return saveJSON(key, chats).then(() => true);
                    }
                    return false;
                });
        });
    }

    getUserChats(user_id: number): Promise<(number)[]> {
        const key = `user_chats/${user_id}.json`;
        return loadJSON<(string | number)[]>(key)
            .then((userChats: (string | number)[]) => Array.isArray(userChats) ? userChats.map(id => Number(id)) : []);
    }

    getChatSettings(chat_id: number): Promise<ChatSettings> {
        const key = `chat_settings/${chat_id}.json`;
        return loadJSON<ChatSettings>(key);
    }

    setChatSettings(chat_id: number, newSettings: ChatSettings): Promise<void> {
        const key = `chat_settings/${chat_id}.json`;
        return this._withLock(key, () => {
            return loadJSON<ChatSettings>(key)
                .then(settings => {
                    const updated: ChatSettings = {
                        ...settings,
                        ...newSettings
                    };
                    return saveJSON(key, updated);
                });
        });
    }

    getGameUpdate(chat_id: number, user_id: number): Promise<GameUpdate> {
        const key = `game_updates/${chat_id}_${user_id}.json`;
        return loadJSON<GameUpdate>(key);
    }

    setGameUpdate(chat_id: number, user_id: number, message_id: number, text: string, info: any = {}): Promise<void> {
        const key = `game_updates/${chat_id}_${user_id}.json`;
        return this._withLock(key, () => {
            const update: GameUpdate = {
                message_id,
                text,
                info,
                timestamp: new Date().toISOString()
            };
            return saveJSON(key, update);
        });
    }

    updateGameUpdateText(chat_id: number, user_id: number, text: string, info: any = {}): Promise<void> {
        const key = `game_updates/${chat_id}_${user_id}.json`;
        return this._withLock(key, () => {
            return loadJSON<GameUpdate>(key)
                .then(update => {
                    if (update && update.message_id) {
                        update.text = text;
                        update.info = info;
                        return saveJSON(key, update);
                    }
                });
        });
    }

    getScheduledRollcalls(): Promise<ScheduledRollcalls> {
        return loadJSON<ScheduledRollcalls>(FILE_ROLLCALL_SCHEDULES);
    }

    setScheduledRollcall(chat_id: number, time: Date): Promise<void> {
        return this._withLock(FILE_ROLLCALL_SCHEDULES, () => {
            return loadJSON<ScheduledRollcalls>(FILE_ROLLCALL_SCHEDULES)
                .then(schedules => {
                    schedules[chat_id] = time.toISOString();
                    return saveJSON(FILE_ROLLCALL_SCHEDULES, schedules);
                });
        });
    }

    removeScheduledRollcall(chat_id: number): Promise<void> {
        return this._withLock(FILE_ROLLCALL_SCHEDULES, () => {
            return loadJSON<ScheduledRollcalls>(FILE_ROLLCALL_SCHEDULES)
                .then(schedules => {
                    delete schedules[chat_id];
                    return saveJSON(FILE_ROLLCALL_SCHEDULES, schedules);
                });
        });
    }

    _getRollcallPlayers(chat_id: number): Promise<RollcallPlayer[]> {
        return loadJSON<Record<string, RollcallPlayer>>(FILE_ROLLCALL_PLAYERS)
            .then(players => Object.keys(players).reduce((acc: RollcallPlayer[], key) => ([
                ...acc,
                {
                    key,
                    ...players[key]
                }
            ]), []))
            .then((players: RollcallPlayer[]) => players.filter((player: RollcallPlayer) => String(player?.chat_id) === String(chat_id)));
    }

    getRollcallPlayerUsernames(chat_id: number): Promise<string[]> {
        return this._getRollcallPlayers(chat_id)
            .then(players => players.map(player => player.username));
    }

    addRollcallPlayer(chat_id: number, username: string): Promise<string> {
        return this._withLock(FILE_ROLLCALL_PLAYERS, () => {
            return loadJSON<Record<string, RollcallPlayer>>(FILE_ROLLCALL_PLAYERS)
                .then(players => {
                    const key = uuid();
                    players[key] = {
                        username: checkNotEmpty(username),
                        chat_id: Number(checkNotEmpty(chat_id))
                    };
                    return saveJSON(FILE_ROLLCALL_PLAYERS, players)
                        .then(() => key);
                });
        });
    }

    removeRollcallPlayer(chat_id: number, username: string): Promise<boolean> {
        return this._withLock(FILE_ROLLCALL_PLAYERS, () => {
            return this._getRollcallPlayers(Number(checkNotEmpty(chat_id)))
                .then(players => players.find(
                    player => {
                        if (String(player?.chat_id) !== String(chat_id)) {
                            return false;
                        }

                        const storedUsername = player?.username;
                        const inputUsername = checkNotEmpty(username);

                        if (storedUsername === inputUsername) {
                            return true;
                        }

                        // Handle case where stored is [Name](tg://user?id=123) and input is just Name
                        const match = storedUsername.match(/^\[(.*)\]\(tg:\/\/user\?id=\d+\)$/);
                        return match && match[1] === inputUsername;
                    })?.key)
                .then(key => {
                    if (!key) {
                        return false;
                    }

                    return loadJSON<Record<string, RollcallPlayer>>(FILE_ROLLCALL_PLAYERS)
                        .then(players => {
                            delete players[key];
                            return saveJSON(FILE_ROLLCALL_PLAYERS, players);
                        })
                        .then(() => true);
                });
        });
    }
}

export default DAO;