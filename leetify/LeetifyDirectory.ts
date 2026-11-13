import LeetifyClient from './LeetifyClient.js';
import LeetifyMatch from './LeetifyMatch.js';

// How long an account found not to be on Leetify is left alone before it is looked up again.
const UNREGISTERED_TTL_MS = 12 * 60 * 60 * 1000;
const CACHED_MATCHES = 50;

export default class LeetifyDirectory {
    private readonly unregisteredUntil: Map<string, number> = new Map();
    private readonly matches: Map<string, LeetifyMatch> = new Map();

    constructor(
        private readonly client: LeetifyClient = new LeetifyClient(),
        private readonly now: () => number = Date.now
    ) {}

    // Newest first; null, without asking Leetify again, for an account known not to be on it.
    async recentMatches(steamId: string): Promise<LeetifyMatch[] | null> {
        if ((this.unregisteredUntil.get(steamId) ?? 0) > this.now()) {
            return null;
        }
        const matches: LeetifyMatch[] | null = await this.client.recentMatches(steamId);
        if (matches === null) {
            console.log(`Steam ID ${steamId} is not on Leetify. Not asking about it again for ${UNREGISTERED_TTL_MS / 3_600_000}h.`);
            this.unregisteredUntil.set(steamId, this.now() + UNREGISTERED_TTL_MS);
        } else {
            this.unregisteredUntil.delete(steamId);
        }
        return matches;
    }

    async match(id: string): Promise<LeetifyMatch> {
        const cached: LeetifyMatch | undefined = this.matches.get(id);
        if (cached) {
            return cached;
        }
        const match: LeetifyMatch = await this.client.match(id);
        this.matches.set(id, match);
        [...this.matches.keys()].slice(0, -CACHED_MATCHES).forEach(stale => this.matches.delete(stale));
        return match;
    }
}
