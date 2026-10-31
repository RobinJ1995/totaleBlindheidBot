import SteamService, { Presence, PRESENCE_EMOJI } from './SteamService.js';
import UserDAO, { User } from './dao/UserDAO.js';
import { fmt, Formatted, join } from './format.js';
import { mentionText } from './rsvp.js';
import { parseMention } from './mention.js';

const userDao = new UserDAO();

// The user id behind a rotation mention, if it can be resolved.
const mentionUserId = async (mention: string): Promise<number | undefined> => {
    const parsed = parseMention(mention);
    return parsed.id ?? (parsed.username ? await userDao.getUserIdByUsername(parsed.username) : undefined);
};

const mentionUsers = (rotation: string[]): Promise<Record<number, User>> =>
    userDao.getUsers(rotation.map(mention => parseMention(mention).id).filter((id): id is number => id !== undefined));

// Map each rotation mention to its Steam presence marker, for prefixing the tag line of rollcalls
// and schedules. Players without a resolvable Telegram id get no marker, and the map is empty when
// Steam is disabled. Presence is decoration only, so lookup failures are logged and skipped rather
// than failing the rollcall.
const presenceMarkers = async (rotation: string[]): Promise<Record<string, string>> => {
    const steam: SteamService | null = SteamService.instance;
    const markers: Record<string, string> = {};
    if (!steam) {
        return markers;
    }

    await Promise.all(rotation.map(async mention => {
        try {
            const user_id: number | undefined = await mentionUserId(mention);
            if (user_id === undefined) {
                return;
            }
            const presence: Presence | undefined = await steam.getPresence(user_id);
            if (presence) {
                markers[mention] = PRESENCE_EMOJI[presence];
            }
        } catch (err) {
            console.error(`Could not determine presence for rollcall player ${mention}:`, err);
        }
    }));

    return markers;
};

// Append the tag line to `head`, prefixing each tag with its presence marker (keyed by rotation
// mention string) when one is given. `head` carries whatever separates it from the tag line.
const withTags = (head: Formatted, tags: string[], users: Record<number, User>, markers: Record<string, string> = {}): Formatted =>
    fmt`${head}${join(tags.map(tag => markers[tag] ? fmt`${markers[tag]}${mentionText(tag, users)}` : mentionText(tag, users)), ' ')}`;

export { mentionUserId, mentionUsers, presenceMarkers, withTags };
