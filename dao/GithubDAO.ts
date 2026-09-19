import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { query } from './Database.js';

class GithubDAO {
    async getGithubNotifyChats(): Promise<number[]> {
        const rows = await query<RowDataPacket[]>('SELECT chat_id FROM chat_settings WHERE github_notify = 1');
        return rows.map(r => Number(r.chat_id));
    }

    setGithubNotify(chat_id: number, enabled: boolean): Promise<void> {
        return query<ResultSetHeader>(
            'INSERT INTO chat_settings (chat_id, github_notify) VALUES (:chat_id, :github_notify) ' +
            'ON DUPLICATE KEY UPDATE github_notify = VALUES(github_notify)',
            { chat_id, github_notify: enabled ? 1 : 0 }
        ).then(() => undefined);
    }

    async getGithubLastSha(): Promise<string | undefined> {
        const rows = await query<RowDataPacket[]>('SELECT last_sha FROM github_state WHERE id = 1');
        return rows[0]?.last_sha ?? undefined;
    }

    setGithubLastSha(sha: string): Promise<void> {
        return query<ResultSetHeader>(
            'INSERT INTO github_state (id, last_sha) VALUES (1, :sha) ON DUPLICATE KEY UPDATE last_sha = VALUES(last_sha)',
            { sha }
        ).then(() => undefined);
    }

    // The ETag of the last commits response, replayed as If-None-Match so unchanged
    // polls come back 304 — free against GitHub's primary rate limit.
    async getGithubEtag(): Promise<string | undefined> {
        const rows = await query<RowDataPacket[]>('SELECT etag FROM github_state WHERE id = 1');
        return rows[0]?.etag ?? undefined;
    }

    setGithubEtag(etag: string): Promise<void> {
        return query<ResultSetHeader>(
            'INSERT INTO github_state (id, etag) VALUES (1, :etag) ON DUPLICATE KEY UPDATE etag = VALUES(etag)',
            { etag }
        ).then(() => undefined);
    }
}

export default GithubDAO;
