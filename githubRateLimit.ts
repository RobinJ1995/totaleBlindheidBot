/**
 * Helpers for reading GitHub's rate-limit signalling off a response.
 *
 * Kept separate from GitHubService so the header arithmetic — the part that is easy
 * to get subtly wrong — can be unit tested without a bot, a database or a network.
 *
 * See https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
 */

// Just enough of the Headers interface to cover what we read, so tests can pass a
// plain object instead of constructing a whole Response.
export interface HeaderBag {
    get(name: string): string | null;
}

// GitHub's primary rate-limit window is hourly, so never pause longer than that even
// if a bogus reset timestamp claims we should.
const MAX_BACKOFF_MS = 60 * 60 * 1000;
// Used when GitHub rejects us without saying when to come back.
const FALLBACK_BACKOFF_MS = 60 * 1000;

// Warn once the hourly budget is nearly spent, so an impending 403 shows up in the
// logs before polls actually start failing.
export const LOW_QUOTA_THRESHOLD = 10;

const numericHeader = (headers: HeaderBag, name: string): number | null => {
    const raw = headers.get(name);
    // Number('') is 0, so an empty header would otherwise read as a real value.
    if (raw === null || raw.trim() === '') {
        return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
};

/**
 * Whether a failed response is GitHub turning us away for exceeding a rate limit,
 * as opposed to any other 403 (missing token, private repo, blocked user agent).
 *
 * Primary limits zero out the remaining counter; secondary limits answer with a
 * retry-after — or, per GitHub's docs, with neither header and only a message body
 * saying so. Both kinds arrive as 403 or 429.
 */
export const isRateLimitRejection = (status: number, headers: HeaderBag, body?: string): boolean => {
    // 429 has no other meaning in GitHub's API: it is always "too many requests".
    if (status === 429) {
        return true;
    }
    if (status !== 403) {
        return false;
    }
    if (headers.get('retry-after') !== null || headers.get('x-ratelimit-remaining') === '0') {
        return true;
    }
    // A bare 403 is rate limiting only when it says so. Other 403s (bad credentials,
    // private repo) must keep failing loudly rather than putting the poller to sleep.
    return body !== undefined && /\brate limit\b/i.test(body);
};

/**
 * How long to hold off before the next request, honouring retry-after first (GitHub
 * documents it as authoritative), then the reset timestamp.
 *
 * `consecutiveRateLimits` only matters when a rejection carries neither header: GitHub
 * asks for at least a minute in that case, growing while the failures continue, and
 * warns that hammering a limit risks the integration being banned.
 */
export const rateLimitBackoffMs = (
    headers: HeaderBag,
    now: number,
    consecutiveRateLimits: number = 1
): number => {
    const clamp = (ms: number): number => Math.min(Math.max(ms, 0), MAX_BACKOFF_MS);

    const retryAfter = numericHeader(headers, 'retry-after');
    if (retryAfter !== null && retryAfter > 0) {
        return clamp(retryAfter * 1000);
    }

    const reset = numericHeader(headers, 'x-ratelimit-reset');
    if (reset !== null && reset > 0) {
        const untilReset = reset * 1000 - now;
        // A reset in the past means the window already rolled over; fall through to
        // the fallback rather than retrying instantly against a limit we just hit.
        if (untilReset > 0) {
            return clamp(untilReset);
        }
    }

    // 2 ** large is Infinity, which clamp folds back to the cap.
    return clamp(FALLBACK_BACKOFF_MS * 2 ** Math.max(0, consecutiveRateLimits - 1));
};

/**
 * A log line when the remaining quota is low enough to be worth flagging, or null
 * when there is nothing to say. Also returns null when the headers are absent, which
 * is the case for mocks and non-GitHub proxies.
 */
export const lowQuotaWarning = (headers: HeaderBag): string | null => {
    const remaining = numericHeader(headers, 'x-ratelimit-remaining');
    if (remaining === null || remaining > LOW_QUOTA_THRESHOLD) {
        return null;
    }

    const limit = headers.get('x-ratelimit-limit') ?? '?';
    const reset = numericHeader(headers, 'x-ratelimit-reset');
    const resetText = reset !== null && reset > 0
        ? `, resets at ${new Date(reset * 1000).toISOString()}`
        : '';

    return `GitHub API quota nearly exhausted: ${remaining}/${limit} requests remaining${resetText}.`;
};
