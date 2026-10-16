import SteamService, { Presence } from './SteamService.js';
import UserDAO from './dao/UserDAO.js';
import { parseMention } from './rsvp.js';

const userDao = new UserDAO();

const PRESENCE_EMOJI: Record<Presence, string> = {
    playing: '🟢',
    online: '🟡',
    offline: '🔴'
};

// Map each rotation mention to its Steam presence marker, for prefixing the tag line of rollcalls
// and schedules. Players without a resolvable Telegram id or linked Steam account get no marker, and
// the map is empty when Steam is disabled. Presence is decoration only, so lookup failures are
// logged and skipped rather than failing the rollcall.
const presenceMarkers = async (rotation: string[]): Promise<Record<string, string>> => {
    const steam: SteamService | null = SteamService.instance;
    const markers: Record<string, string> = {};
    if (!steam) {
        return markers;
    }

    await Promise.all(rotation.map(async mention => {
        try {
            const parsed = parseMention(mention);
            const user_id: number | undefined = parsed.id
                ?? (parsed.username ? await userDao.getUserIdByUsername(parsed.username) : undefined);
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

export { presenceMarkers };
