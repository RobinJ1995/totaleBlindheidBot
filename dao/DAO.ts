import { v4 as uuid } from 'uuid';
import { checkNotEmpty } from '../utils';
import { loadJSON, saveJSON } from './S3Client';

const FILE_ROLLCALL_PLAYERS = 'rollcall_players.json';
const FILE_ROLLCALL_SCHEDULES = 'rollcall_schedules.json';
const FILE_RSVP_LISTS = 'rsvp_lists.json';
const FILE_USER_SETTINGS = 'user_settings.json';
const FILE_GITHUB_NOTIFY_CHATS = 'github_notify_chats.json';
const FILE_GITHUB_STATE = 'github_state.json';

// RSVP lists older than this are pruned on write.
const RSVP_LIST_TTL_MS = 24 * 60 * 60 * 1000;

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

export interface ScheduledRollcall {
    time: string;
    rsvp_id?: string;
    initiator_id?: number;
}

// Stored value may be a legacy bare ISO string (time only) or the richer object above.
export type ScheduledRollcalls = Record<string, ScheduledRollcall | string>;

export const normalizeSchedule = (value: ScheduledRollcall | string): ScheduledRollcall =>
    typeof value === 'string' ? { time: value } : value;

export type Rsvp = 'yes' | 'maybe' | 'no';

export interface RsvpEntry {
    user_id: number;
    name: string;        // non-pinging display name
    username?: string;   // telegram @username (no @) for rotation matching
    rsvp: Rsvp;
}

export interface RsvpMessageRef {
    message_id: number;
    base_text: string;                 // text above the lists (differs per message)
    keyboard: 'schedule' | 'rollcall'; // which button labels to show on this message
}

export interface RsvpList {
    rsvp_id: string;
    chat_id: number;
    entries: Record<string, RsvpEntry>; // keyed by user_id (incl. seeded initiator)
    messages: RsvpMessageRef[];         // every message currently displaying this list
    created_at: string;                 // for pruning
}

export interface GithubState {
    last_sha?: string;
}

class DAO {
    // Static so that all DAO instances (one per module) serialize writes to the same files
    private static locks: Map<string, Promise<any>> = new Map();

    async _withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
        if (!DAO.locks.has(key)) {
            DAO.locks.set(key, Promise.resolve());
        }
        const lock = DAO.locks.get(key)!;
        const nextLock = lock.then(async () => {
            try {
                return await fn();
            } catch (err) {
                // We want to return the error but ensure the lock continues
                throw err;
            }
        });
        // Ensure the next lock doesn't fail just because this one did
        DAO.locks.set(key, nextLock.catch(() => {}));
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

    getGithubNotifyChats(): Promise<number[]> {
        return loadJSON<(string | number)[]>(FILE_GITHUB_NOTIFY_CHATS)
            .then((chats: (string | number)[]) => Array.isArray(chats) ? chats.map(id => Number(id)) : []);
    }

    setGithubNotify(chat_id: number, enabled: boolean): Promise<void> {
        return this._withLock(FILE_GITHUB_NOTIFY_CHATS, () => {
            return loadJSON<(string | number)[]>(FILE_GITHUB_NOTIFY_CHATS)
                .then((stored: (string | number)[]) => {
                    const chats: number[] = Array.isArray(stored) ? stored.map(id => Number(id)) : [];
                    const has: boolean = chats.includes(Number(chat_id));
                    if (enabled && !has) {
                        chats.push(Number(chat_id));
                    } else if (!enabled && has) {
                        return saveJSON(FILE_GITHUB_NOTIFY_CHATS, chats.filter(id => id !== Number(chat_id)));
                    } else if (!enabled) {
                        return; // not present, nothing to remove
                    } else {
                        return; // already present, nothing to add
                    }
                    return saveJSON(FILE_GITHUB_NOTIFY_CHATS, chats);
                });
        });
    }

    getGithubLastSha(): Promise<string | undefined> {
        return loadJSON<GithubState>(FILE_GITHUB_STATE)
            .then((state: GithubState) => state.last_sha);
    }

    setGithubLastSha(sha: string): Promise<void> {
        return this._withLock(FILE_GITHUB_STATE, () => {
            return saveJSON(FILE_GITHUB_STATE, { last_sha: sha });
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

    setScheduledRollcall(chat_id: number, time: Date, rsvp_id?: string, initiator_id?: number): Promise<void> {
        return this._withLock(FILE_ROLLCALL_SCHEDULES, () => {
            return loadJSON<ScheduledRollcalls>(FILE_ROLLCALL_SCHEDULES)
                .then(schedules => {
                    const schedule: ScheduledRollcall = { time: time.toISOString() };
                    if (rsvp_id !== undefined) {
                        schedule.rsvp_id = rsvp_id;
                    }
                    if (initiator_id !== undefined) {
                        schedule.initiator_id = initiator_id;
                    }
                    schedules[chat_id] = schedule;
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

    // Drop RSVP lists older than the TTL so the file doesn't grow unbounded.
    private _pruneRsvpLists(lists: Record<string, RsvpList>): void {
        const cutoff: number = Date.now() - RSVP_LIST_TTL_MS;
        for (const [id, list] of Object.entries(lists)) {
            if (new Date(list.created_at).getTime() < cutoff) {
                delete lists[id];
            }
        }
    }

    createRsvpList(list: Omit<RsvpList, 'rsvp_id' | 'created_at'>): Promise<string> {
        return this._withLock(FILE_RSVP_LISTS, () => {
            return loadJSON<Record<string, RsvpList>>(FILE_RSVP_LISTS)
                .then(lists => {
                    this._pruneRsvpLists(lists);
                    const rsvp_id: string = uuid();
                    lists[rsvp_id] = {
                        ...list,
                        rsvp_id,
                        created_at: new Date().toISOString()
                    };
                    return saveJSON(FILE_RSVP_LISTS, lists).then(() => rsvp_id);
                });
        });
    }

    getRsvpList(rsvp_id: string): Promise<RsvpList | undefined> {
        return loadJSON<Record<string, RsvpList>>(FILE_RSVP_LISTS)
            .then(lists => lists[rsvp_id]);
    }

    getRsvpListByMessage(chat_id: number, message_id: number): Promise<RsvpList | undefined> {
        return loadJSON<Record<string, RsvpList>>(FILE_RSVP_LISTS)
            .then(lists => Object.values(lists).find(list =>
                String(list.chat_id) === String(chat_id) &&
                list.messages.some(ref => ref.message_id === message_id)
            ));
    }

    setRsvpEntry(rsvp_id: string, entry: RsvpEntry): Promise<RsvpList | undefined> {
        return this._withLock(FILE_RSVP_LISTS, () => {
            return loadJSON<Record<string, RsvpList>>(FILE_RSVP_LISTS)
                .then(lists => {
                    const list: RsvpList | undefined = lists[rsvp_id];
                    if (!list) {
                        return undefined;
                    }
                    list.entries[entry.user_id] = entry;
                    return saveJSON(FILE_RSVP_LISTS, lists).then(() => list);
                });
        });
    }

    addRsvpMessage(rsvp_id: string, ref: RsvpMessageRef): Promise<void> {
        return this._withLock(FILE_RSVP_LISTS, () => {
            return loadJSON<Record<string, RsvpList>>(FILE_RSVP_LISTS)
                .then(lists => {
                    const list: RsvpList | undefined = lists[rsvp_id];
                    if (!list) {
                        return;
                    }
                    list.messages = list.messages.filter(m => m.message_id !== ref.message_id);
                    list.messages.push(ref);
                    return saveJSON(FILE_RSVP_LISTS, lists);
                });
        });
    }

    removeRsvpMessage(rsvp_id: string, message_id: number): Promise<void> {
        return this._withLock(FILE_RSVP_LISTS, () => {
            return loadJSON<Record<string, RsvpList>>(FILE_RSVP_LISTS)
                .then(lists => {
                    const list: RsvpList | undefined = lists[rsvp_id];
                    if (!list) {
                        return;
                    }
                    list.messages = list.messages.filter(m => m.message_id !== message_id);
                    return saveJSON(FILE_RSVP_LISTS, lists);
                });
        });
    }

    deleteRsvpList(rsvp_id: string): Promise<void> {
        return this._withLock(FILE_RSVP_LISTS, () => {
            return loadJSON<Record<string, RsvpList>>(FILE_RSVP_LISTS)
                .then(lists => {
                    delete lists[rsvp_id];
                    return saveJSON(FILE_RSVP_LISTS, lists);
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