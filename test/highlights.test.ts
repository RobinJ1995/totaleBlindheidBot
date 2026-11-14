import { test } from 'node:test';
import assert from 'node:assert/strict';
import Highlights from '../leetify/Highlights.js';
import { PlayerStats } from '../leetify/LeetifyMatch.js';
import Streak from '../stats/Streak.js';
import { playerStats } from './leetifyFixtures.js';

const player = (name: string, overrides: Partial<PlayerStats> = {}, streak: Streak | null = null) =>
    ({ name, stats: playerStats(name, overrides), streak });

const lines = (players: ReturnType<typeof player>[], lobby: PlayerStats[] = []): string[] => new Highlights(players, lobby).lines();

// The players themselves plus enough unremarkable others to make a full server.
const server = (...players: ReturnType<typeof player>[]): PlayerStats[] =>
    [...players.map(({ stats }) => stats), playerStats('a'), playerStats('b'), playerStats('c'), playerStats('d')];

test('an unremarkable match has no highlights', () => {
    const kit = player('Kit');
    assert.deepEqual(lines([kit], server(kit)), []);
});

test('aces and 4ks are highlighted, aces first', () => {
    assert.deepEqual(lines([player('Jo', { multi4k: 1 }), player('Kit', { multi5k: 1, multi4k: 2 }), player('Sam', { multi5k: 2 })]), [
        '💥 Kit: ace, 2 4ks',
        '💥 Sam: 2 aces',
        '💥 Jo: 4k'
    ]);
});

test('flashing teammates is highlighted from eight times', () => {
    assert.deepEqual(lines([player('Kit', { flashbang_hit_friend: 7 }), player('Jo', { flashbang_hit_friend: 8 })]), ['😵 Jo flashed teammates 8 times']);
});

test('notable streaks are highlighted, shorter ones are not', () => {
    assert.deepEqual(lines([
        player('Kit', {}, Streak.ending(['win', 'win', 'win'])),
        player('Jo', {}, Streak.ending(['loss', 'loss']))
    ]), ['🔥 Kit: 3 wins in a row']);
});

test('the most kills and the most deaths of the whole server are highlighted', () => {
    const kit = player('Kit', { total_kills: 24 });
    const jo = player('Jo', { total_deaths: 21 });
    assert.deepEqual(lines([kit, jo], server(kit, jo)), [
        '🏅 Kit top-fragged the server with 24 kills',
        '⚰️ Jo died the most in the server: 21 deaths'
    ]);
});

test('someone else in the server having as many kills or deaths takes the highlight away', () => {
    const kit = player('Kit', { total_kills: 24, total_deaths: 21 });
    assert.deepEqual(lines([kit], [...server(kit), playerStats('e', { total_kills: 24, total_deaths: 21 })]), []);
});

test('nothing is measured against a server of fewer than four players', () => {
    const kit = player('Kit', { total_kills: 24, total_deaths: 21, reaction_time: 0.9 });
    assert.deepEqual(lines([kit], [kit.stats, playerStats('a')]), []);
});

test('dying in nine of ten rounds or more is highlighted', () => {
    assert.deepEqual(lines([
        player('Kit', { rounds_count: 20, rounds_survived: 3 }),
        player('Jo', { rounds_count: 23, rounds_survived: 2 }),
        player('Sam', { rounds_count: 5, rounds_survived: 0 })
    ]), ['🪦 Jo died in 21 of 23 rounds']);
});

test('seven in ten kills by headshot is highlighted from ten kills', () => {
    assert.deepEqual(lines([
        player('Kit', { total_kills: 20, total_hs_kills: 15 }),
        player('Jo', { total_kills: 20, total_hs_kills: 13 }),
        player('Sam', { total_kills: 4, total_hs_kills: 4 })
    ]), ['🎯 Kit: 75% headshots']);
});

test('an ADR of a hundred is highlighted', () => {
    assert.deepEqual(lines([player('Kit', { dpr: 125.71 }), player('Jo', { dpr: 99 })]), ['💪 Kit: 126 ADR']);
});

test('a K/D of two or more, or of half or less over ten deaths, is highlighted', () => {
    assert.deepEqual(lines([
        player('Kit', { kd_ratio: 2.44 }),
        player('Jo', { kd_ratio: 0.4, total_deaths: 20 }),
        player('Sam', { kd_ratio: 0.4, total_deaths: 5 }),
        player('Max', { kd_ratio: 1.9 })
    ]), ['📉 Jo: 0.4 K/D', '📈 Kit: 2.4 K/D']);
});

test('a K/D of zero is highlighted without dividing by it', () => {
    assert.deepEqual(lines([player('Jo', { kd_ratio: 0, total_deaths: 15 })]), ['📉 Jo: 0.0 K/D']);
});

test('shooting teammates ten times and heavy HE damage to them are highlighted', () => {
    assert.deepEqual(lines([
        player('Kit', { shots_hit_friend: 14 }),
        player('Jo', { he_friends_damage_avg: 8.4 }),
        player('Sam', { shots_hit_friend: 9, he_friends_damage_avg: 7 })
    ]), ['🔫 Kit shot teammates 14 times', '💣 Jo: 8 average HE damage to teammates']);
});

test('dying with four hundred dollars of utility on average is highlighted', () => {
    assert.deepEqual(lines([player('Kit', { utility_on_death_avg: 451.2 }), player('Jo', { utility_on_death_avg: 399 })]), ['🎒 Kit died with $451 of utility on average']);
});

test('three flash assists are highlighted', () => {
    assert.deepEqual(lines([player('Kit', { flash_assist: 4 }), player('Jo', { flash_assist: 2 })]), ['✨ Kit: 4 flash assists']);
});

test('a reaction time well above the server\'s usual one is highlighted', () => {
    const kit = player('Kit', { reaction_time: 0.72 });
    const jo = player('Jo', { reaction_time: 0.6 });
    assert.deepEqual(lines([kit, jo], server(kit, jo)), ['🐌 Kit: 720 ms reaction time']);
});

test('players without a reaction time do not count towards the server\'s usual one', () => {
    const kit = player('Kit', { reaction_time: 0.72 });
    assert.deepEqual(lines([kit], [kit.stats, ...['a', 'b', 'c', 'd'].map(id => playerStats(id, { reaction_time: 0 }))]), []);
});

test('six MVPs are highlighted', () => {
    assert.deepEqual(lines([player('Kit', { mvps: 7 }), player('Jo', { mvps: 5 })]), ['⭐ Kit: 7 MVPs']);
});

test('only the four most remarkable highlights are shown, most remarkable first', () => {
    assert.deepEqual(lines([
        player('Kit', { multi5k: 1, flashbang_hit_friend: 12, dpr: 110 }, Streak.ending(['win', 'win', 'win'])),
        player('Jo', { multi4k: 1, flashbang_hit_friend: 11, mvps: 6 }, Streak.ending(['win', 'win', 'win']))
    ]), [
        '💥 Kit: ace',
        '💥 Jo: 4k',
        '😵 Kit flashed teammates 12 times',
        '😵 Jo flashed teammates 11 times'
    ]);
});
