import TelegramBot from 'node-telegram-bot-api';
import GithubDAO from './dao/GithubDAO.js';
import { escapeHtml } from './utils.js';
import { isRateLimitRejection, lowQuotaWarning, rateLimitBackoffMs } from './githubRateLimit.js';

interface GitHubCommit {
    sha: string;
    html_url: string;
    commit: {
        message: string;
        author?: {
            name?: string;
            date?: string;
        };
    };
    author?: {
        login?: string;
    } | null;
}

interface CommitsResponse {
    commits: GitHubCommit[];
    // The response's ETag, replayed on the next poll so an unchanged repo answers
    // 304 — which GitHub does not charge against the primary rate limit.
    etag: string | null;
}

const DEFAULT_REPO = 'RobinJ1995/totaleBlindheidBot';
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_API_BASE = 'https://api.github.com';

class GitHubService {
    private bot: TelegramBot;
    private dao: GithubDAO;
    private repo: string;
    private apiBase: string;
    private intervalMs: number;
    private pollInterval: NodeJS.Timeout | null;
    private etag: string | null;
    private etagLoaded: boolean;
    // Epoch ms before which GitHub asked us not to come back. 0 = free to poll.
    private rateLimitedUntil: number;

    constructor(bot: TelegramBot) {
        this.bot = bot;
        this.dao = new GithubDAO();
        this.repo = process.env.GITHUB_REPO || DEFAULT_REPO;
        // Configurable so acceptance tests can point the poller at a mock API.
        this.apiBase = (process.env.GITHUB_API_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, '');
        const configured = Number(process.env.GITHUB_POLL_INTERVAL_MS);
        this.intervalMs = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_INTERVAL_MS;
        this.pollInterval = null;
        this.etag = null;
        this.etagLoaded = false;
        this.rateLimitedUntil = 0;
    }

    start(): void {
        console.log(`Starting GitHubService for repo ${this.repo} (polling every ${this.intervalMs / 1000}s)`);

        // Kick off an immediate poll so the baseline SHA is established promptly.
        this.pollAndNotify().catch((err: Error) => console.error('Error in initial GitHub poll:', err));

        this.pollInterval = setInterval(() => {
            this.pollAndNotify().catch((err: Error) => console.error('Error in GitHub poll:', err));
        }, this.intervalMs);
    }

    stop(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    private async fetchCommits(): Promise<CommitsResponse | null> {
        const now = Date.now();
        if (now < this.rateLimitedUntil) {
            // Still inside the window GitHub told us to sit out. Requests made now
            // would be rejected and still count as used, keeping the bucket pinned.
            return null;
        }

        const headers: Record<string, string> = {
            'User-Agent': 'totaleBlindheidBot',
            'Accept': 'application/vnd.github+json'
        };
        if (process.env.GITHUB_TOKEN) {
            headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
        }
        if (this.etag) {
            headers['If-None-Match'] = this.etag;
        }

        const url = `${this.apiBase}/repos/${this.repo}/commits?per_page=20`;
        const res = await fetch(url, { headers });

        const warning = lowQuotaWarning(res.headers);
        if (warning) {
            console.warn(warning);
        }

        // Nothing changed since the last poll. Checked before res.ok, which is false
        // for 304.
        if (res.status === 304) {
            return null;
        }

        if (!res.ok) {
            if (isRateLimitRejection(res.status, res.headers)) {
                const backoffMs = rateLimitBackoffMs(res.headers, Date.now());
                this.rateLimitedUntil = Date.now() + backoffMs;
                console.error(
                    `GitHub API rate limit hit (${res.status}); pausing polls for ${Math.ceil(backoffMs / 1000)}s.`
                );
            } else {
                console.error(`GitHub API request failed: ${res.status} ${res.statusText}`);
            }
            return null;
        }

        // A successful response means we're inside the budget again.
        this.rateLimitedUntil = 0;

        const body = await res.json();
        if (!Array.isArray(body)) {
            return null;
        }

        return { commits: body as GitHubCommit[], etag: res.headers.get('etag') };
    }

    /**
     * Store the ETag only once the response it belongs to has been fully accounted
     * for. Saving it earlier would mean a failure part-way through processing leaves
     * us replaying an ETag for commits we never announced — and 304ing forever after.
     */
    private async rememberEtag(etag: string | null): Promise<void> {
        if (!etag || etag === this.etag) {
            return;
        }
        this.etag = etag;
        await this.dao.setGithubEtag(etag);
    }

    private async pollAndNotify(): Promise<void> {
        if (!this.etagLoaded) {
            // Persisted so a restart resumes conditional requests instead of spending
            // a full request to relearn what it already knew.
            this.etag = (await this.dao.getGithubEtag()) ?? null;
            this.etagLoaded = true;
        }

        const response = await this.fetchCommits();
        if (!response || response.commits.length === 0) {
            return;
        }
        const { commits, etag } = response;

        // GitHub returns newest first.
        const newestSha = commits[0].sha;
        const lastSha = await this.dao.getGithubLastSha();

        // First ever run: record the baseline without announcing historical commits.
        if (!lastSha) {
            await this.dao.setGithubLastSha(newestSha);
            await this.rememberEtag(etag);
            console.log(`GitHub baseline established at ${newestSha}`);
            return;
        }

        if (newestSha === lastSha) {
            // Nothing new, but this response is now the baseline the next conditional
            // request compares against.
            await this.rememberEtag(etag);
            return;
        }

        // Collect commits newer than lastSha (newest-first slice up to the known SHA).
        const lastIndex = commits.findIndex(c => c.sha === lastSha);
        // If lastSha isn't on this page (>20 new commits, or history rewritten),
        // only announce the newest commit to avoid flooding chats.
        const newCommits = lastIndex === -1 ? [commits[0]] : commits.slice(0, lastIndex);

        // Announce oldest-first so chats read them in chronological order.
        const ordered = [...newCommits].reverse();

        const chats = await this.dao.getGithubNotifyChats();
        if (chats.length > 0) {
            for (const commit of ordered) {
                const text = this.formatCommit(commit);
                for (const chatId of chats) {
                    try {
                        await this.bot.sendMessage(chatId, text, {
                            parse_mode: 'HTML',
                            link_preview_options: { is_disabled: true }
                        });
                    } catch (err) {
                        console.error(`Failed to send GitHub notification to chat ${chatId}:`, err);
                    }
                }
            }
        }

        await this.dao.setGithubLastSha(newestSha);
        await this.rememberEtag(etag);
    }

    private formatCommit(commit: GitHubCommit): string {
        const message = commit.commit.message || '';

        return `New commit: ${escapeHtml(commit.html_url)}\n` +
            `<blockquote expandable>${escapeHtml(message)}</blockquote>`;
    }
}

export default GitHubService;
