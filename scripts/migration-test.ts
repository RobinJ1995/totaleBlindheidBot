/**
 * Integration test for the S3 -> MariaDB migration and the steam-user database backend.
 *
 * Requires a running S3 (rustfs/MinIO) and MariaDB, configured via the usual S3_* and
 * MARIADB_* env vars, plus STEAM_STORAGE_BACKEND=database. Seeds representative legacy
 * blobs, runs the real migration script as a subprocess, then asserts the DB contents
 * through the DAO. Exits non-zero on the first failed assertion.
 *
 *   docker run ... rustfs ...   # S3
 *   (with MARIADB and S3 env set, plus STEAM_STORAGE_BACKEND=database)
 *   npx ts-node scripts/migration-test.ts
 */
import { execSync } from 'child_process';
import { CreateBucketCommand } from '@aws-sdk/client-s3';
import { s3, bucket, saveJSON, save } from '../dao/S3Client';
import UserDAO from '../dao/UserDAO';
import ChatDAO from '../dao/ChatDAO';
import GithubDAO from '../dao/GithubDAO';
import GameUpdateDAO from '../dao/GameUpdateDAO';
import ScheduleDAO from '../dao/ScheduleDAO';
import RsvpDAO from '../dao/RsvpDAO';
import RollcallPlayerDAO from '../dao/RollcallPlayerDAO';
import { getPool, query, saveSteamFile, readSteamFile } from '../dao/Database';
import { RowDataPacket } from 'mysql2/promise';

let failures = 0;
const assert = (cond: any, msg: string) => {
    if (cond) { console.log('  ok:', msg); }
    else { console.error('  FAIL:', msg); failures++; }
};

const ISO = (d: Date) => d.toISOString();
const STEAM_FILE = 'steam-user/sentry.bin';
const STEAM_BYTES = Buffer.from([1, 2, 3, 4, 250, 0, 99]);

const seed = async (): Promise<void> => {
    try { await s3.send(new CreateBucketCommand({ Bucket: bucket })); } catch { /* exists */ }

    const future = new Date(Date.now() + 3 * 3600_000);
    const now = new Date();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600_000);

    await saveJSON('user_settings.json', {
        '100': { steam_id: '76561198000000001', steam_ids: ['76561198000000001', '76561198000000002'], timezone: 'Europe/Dublin' },
        '200': { steam_ids: ['76561198000000003'] }
    });
    await saveJSON('user_chats/100.json', [-1001, -1002]);
    await saveJSON('chat_settings/-1001.json', { steam_updates: false });
    await saveJSON('github_notify_chats.json', [-1001]);
    await saveJSON('rollcall_players.json', {
        'uuid-a': { username: '[Alice](tg://user?id=42)', chat_id: -1001 },
        'uuid-b': { username: '@bob', chat_id: -1001 },
        'uuid-c': { username: 'Charlie', chat_id: -1001 }
    });
    await saveJSON('rollcall_schedules.json', {
        '-1001': { time: ISO(future), rsvp_id: 'list-fresh', initiator_id: 100 },
        '-1002': ISO(future)   // legacy bare-ISO string form
    });
    await saveJSON('rsvp_lists.json', {
        'list-fresh': {
            rsvp_id: 'list-fresh', chat_id: -1001,
            entries: { '100': { user_id: 100, name: 'Tester', username: 'tester', rsvp: 'yes' } },
            messages: [{ message_id: 7001, base_text: 'Rollcall!', keyboard: 'schedule' }],
            created_at: ISO(now)
        },
        'list-expired': {
            rsvp_id: 'list-expired', chat_id: -1001, entries: {}, messages: [], created_at: ISO(twoDaysAgo)
        }
    });
    await saveJSON('github_state.json', { last_sha: 'abc123' });
    await saveJSON('game_updates/-1001_100.json', {
        message_id: 555, text: 'playing', info: { gameId: 730, map: 'de_dust2', status: 'Competitive', score: '5-3' }, timestamp: ISO(now)
    });
    await save(STEAM_FILE, STEAM_BYTES);
    console.log('seeded S3 blobs');
};

const runMigration = (): void => {
    console.log('--- running migration subprocess ---');
    execSync('npx ts-node scripts/migrate-s3-to-mariadb.ts', { stdio: 'inherit', env: process.env });
    console.log('--- migration subprocess done ---');
};

const assertMigrated = async (): Promise<void> => {
    const userDao = new UserDAO();
    const chatDao = new ChatDAO();
    const githubDao = new GithubDAO();
    const gameUpdateDao = new GameUpdateDAO();
    const scheduleDao = new ScheduleDAO();
    const rsvpDao = new RsvpDAO();
    const rollcallPlayerDao = new RollcallPlayerDAO();

    const all = await userDao.getAllUserSettings();
    assert(all['100']?.steam_ids?.length === 2 && all['100']?.timezone === 'Europe/Dublin', 'user 100 settings migrated');
    assert(all['200']?.steam_ids?.length === 1, 'user 200 steam id migrated');

    const chats = (await userDao.getUserChats(100)).slice().sort((a, b) => a - b);
    assert(JSON.stringify(chats) === JSON.stringify([-1002, -1001]), 'user_chats migrated (order-independent)');
    assert((await chatDao.getChatSettings(-1001)).steam_updates === false, 'chat_settings migrated');
    assert((await githubDao.getGithubNotifyChats()).includes(-1001), 'github_notify migrated into chat_settings');
    assert((await githubDao.getGithubLastSha()) === 'abc123', 'github_state migrated');

    const players = await rollcallPlayerDao.getRollcallPlayerUsernames(-1001);
    assert(players.includes('[Alice](tg://user?id=42)') && players.includes('@bob') && players.includes('Charlie'),
        'rollcall players migrated + reconstructed (all three forms)');

    const gu = await gameUpdateDao.getGameUpdate(-1001, 100);
    assert(gu.message_id === 555 && gu.info.map === 'de_dust2' && gu.info.score === '5-3', 'game_update migrated + info flattened');

    const scheds = await scheduleDao.getScheduledRollcalls();
    assert(scheds['-1001'] && scheds['-1001'].time instanceof Date, 'schedule -1001 migrated as Date');
    assert(typeof scheds['-1001'].rsvp_id === 'number', 'schedule rsvp_id remapped to numeric list id');
    assert(scheds['-1002'] && scheds['-1002'].time instanceof Date && scheds['-1002'].rsvp_id === undefined,
        'legacy bare-ISO schedule -1002 normalised');

    const list = await rsvpDao.getRsvpList(scheds['-1001'].rsvp_id!);
    assert(!!list && list.chat_id === -1001, 'remapped rsvp list resolves');
    assert(list!.entries['100']?.name === 'Tester' && list!.entries['100']?.rsvp === 'yes', 'rsvp entry name from telegram_user');
    assert(list!.messages.length === 1 && list!.messages[0].message_id === 7001, 'rsvp message migrated');

    const listCount = await query<RowDataPacket[]>('SELECT COUNT(*) AS c FROM rsvp_list');
    assert(Number(listCount[0].c) === 1, 'expired rsvp list pruned (only the fresh one migrated)');

    const steamRows = await query<RowDataPacket[]>('SELECT contents FROM steam_storage WHERE filename = :f', { f: STEAM_FILE });
    assert(steamRows.length === 1 && Buffer.compare(steamRows[0].contents as Buffer, STEAM_BYTES) === 0,
        'steam-user blob migrated to steam_storage (database backend)');
};

const assertSteamBackend = async (): Promise<void> => {
    // Direct round-trip of the steam-user database storage backend.
    const buf = Buffer.from([9, 8, 7, 0, 255]);
    await saveSteamFile('steam-user/roundtrip.bin', buf);
    const read = await readSteamFile('steam-user/roundtrip.bin');
    assert(read !== undefined && Buffer.compare(read, buf) === 0, 'saveSteamFile/readSteamFile round-trip');
    await saveSteamFile('steam-user/roundtrip.bin', Buffer.from([1]));
    const read2 = await readSteamFile('steam-user/roundtrip.bin');
    assert(read2 !== undefined && read2.length === 1, 'saveSteamFile overwrites');
    let enoent = false;
    try { await readSteamFile('steam-user/missing.bin'); } catch (e: any) { enoent = e.code === 'ENOENT'; }
    assert(enoent, 'readSteamFile throws ENOENT for missing file');
};

const main = async (): Promise<void> => {
    await seed();
    runMigration();
    console.log('--- asserting migrated data ---');
    await assertMigrated();
    console.log('--- asserting steam database backend ---');
    await assertSteamBackend();

    await getPool().end();
    if (failures > 0) {
        console.error(`\n${failures} ASSERTION(S) FAILED`);
        process.exit(1);
    }
    console.log('\nALL MIGRATION + STEAM-BACKEND TESTS PASSED');
};

main().catch(async (err) => { console.error(err); await getPool().end().catch(() => {}); process.exit(1); });
