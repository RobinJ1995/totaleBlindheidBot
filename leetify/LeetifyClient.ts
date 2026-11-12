import LeetifyMatch, { MatchData } from './LeetifyMatch.js';

const BASE_URL: string = process.env.LEETIFY_API_BASE_URL || 'https://api-public.cs-prod.leetify.com';
const TIMEOUT_MS = 15_000;

export default class LeetifyClient {
    constructor(
        private readonly baseUrl: string = BASE_URL,
        private readonly apiKey: string | undefined = process.env.LEETIFY_API_KEY
    ) {}

    // Newest first; null when the account is not on Leetify.
    async recentMatches(steamId: string): Promise<LeetifyMatch[] | null> {
        const response: Response = await this.get(`/v3/profile/matches?steam64_id=${encodeURIComponent(steamId)}`);
        if (response.status === 404) {
            return null;
        }
        const matches: MatchData[] = await this.body(response);
        return matches.map(data => new LeetifyMatch(data));
    }

    // Unlike recentMatches, with the stats of every player in the match.
    async match(id: string): Promise<LeetifyMatch> {
        return new LeetifyMatch(await this.body(await this.get(`/v2/matches/${encodeURIComponent(id)}`)));
    }

    private get(path: string): Promise<Response> {
        return fetch(`${this.baseUrl}${path}`, {
            headers: this.apiKey ? { _leetify_key: this.apiKey } : {},
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
    }

    private async body<T>(response: Response): Promise<T> {
        if (!response.ok) {
            throw new Error(`Leetify answered ${response.status} to ${response.url}`);
        }
        return await response.json() as T;
    }
}
