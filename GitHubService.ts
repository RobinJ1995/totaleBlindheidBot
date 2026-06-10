import TelegramBot from 'node-telegram-bot-api';
import DAO from './dao/DAO';
import { escapeHtml } from './utils';

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

const DEFAULT_REPO = 'RobinJ1995/totaleBlindheidBot';
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

class GitHubService {
    private bot: TelegramBot;
    private dao: DAO;
    private repo: string;
    private intervalMs: number;
    private pollInterval: NodeJS.Timeout | null;

    constructor(bot: TelegramBot) {
        this.bot = bot;
        this.dao = new DAO();
        this.repo = process.env.GITHUB_REPO || DEFAULT_REPO;
        const configured = Number(process.env.GITHUB_POLL_INTERVAL_MS);
        this.intervalMs = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_INTERVAL_MS;
        this.pollInterval = null;
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

    private async fetchCommits(): Promise<GitHubCommit[] | null> {
        const headers: Record<string, string> = {
            'User-Agent': 'totaleBlindheidBot',
            'Accept': 'application/vnd.github+json'
        };
        if (process.env.GITHUB_TOKEN) {
            headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
        }

        const url = `https://api.github.com/repos/${this.repo}/commits?per_page=20`;
        const res = await fetch(url, { headers });
        if (!res.ok) {
            console.error(`GitHub API request failed: ${res.status} ${res.statusText}`);
            return null;
        }

        const body = await res.json();
        return Array.isArray(body) ? body as GitHubCommit[] : null;
    }

    private async pollAndNotify(): Promise<void> {
        const commits = await this.fetchCommits();
        if (!commits || commits.length === 0) {
            return;
        }

        // GitHub returns newest first.
        const newestSha = commits[0].sha;
        const lastSha = await this.dao.getGithubLastSha();

        // First ever run: record the baseline without announcing historical commits.
        if (!lastSha) {
            await this.dao.setGithubLastSha(newestSha);
            console.log(`GitHub baseline established at ${newestSha}`);
            return;
        }

        if (newestSha === lastSha) {
            return; // Nothing new.
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
                            disable_web_page_preview: true
                        });
                    } catch (err) {
                        console.error(`Failed to send GitHub notification to chat ${chatId}:`, err);
                    }
                }
            }
        }

        await this.dao.setGithubLastSha(newestSha);
    }

    private formatCommit(commit: GitHubCommit): string {
        const message = commit.commit.message || '';

        return `New commit: ${escapeHtml(commit.html_url)}\n` +
            `<blockquote expandable>${escapeHtml(message)}</blockquote>`;
    }
}

export default GitHubService;
