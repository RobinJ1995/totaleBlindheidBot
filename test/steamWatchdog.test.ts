import { test } from 'node:test';
import assert from 'node:assert/strict';
import SteamWatchdog from '../SteamWatchdog.js';

const SILENCE_MS = 1000;

interface Watched {
    watchdog: SteamWatchdog;
    alarms: () => number;
    wait: (ms: number) => void;
}

const watched = (): Watched => {
    let now = 0;
    let alarms = 0;
    return {
        watchdog: new SteamWatchdog(SILENCE_MS, () => alarms++, () => now),
        alarms: () => alarms,
        wait: (ms: number) => {
            now += ms;
        }
    };
};

test('a question Steam has had no time to answer raises no alarm', () => {
    const { watchdog, alarms, wait } = watched();
    watchdog.asked();
    wait(SILENCE_MS - 1);
    watchdog.asked();
    assert.equal(alarms(), 0);
});

test('questions that stay unanswered for the silence window raise the alarm', () => {
    const { watchdog, alarms, wait } = watched();
    watchdog.asked();
    wait(SILENCE_MS);
    watchdog.asked();
    assert.equal(alarms(), 1);
});

test('the silence is counted from the first unanswered question', () => {
    const { watchdog, alarms, wait } = watched();
    watchdog.asked();
    wait(SILENCE_MS / 2);
    watchdog.asked();
    wait(SILENCE_MS / 2);
    watchdog.asked();
    assert.equal(alarms(), 1);
});

test('an answer ends the silence', () => {
    const { watchdog, alarms, wait } = watched();
    watchdog.asked();
    wait(SILENCE_MS);
    watchdog.heard();
    watchdog.asked();
    wait(SILENCE_MS - 1);
    watchdog.asked();
    assert.equal(alarms(), 0);
});

test('nothing is expected of Steam while it is not asked anything', () => {
    const { watchdog, alarms, wait } = watched();
    wait(SILENCE_MS * 10);
    watchdog.heard();
    assert.equal(alarms(), 0);
});

test('after an alarm the silence is counted afresh', () => {
    const { watchdog, alarms, wait } = watched();
    watchdog.asked();
    wait(SILENCE_MS);
    watchdog.asked();
    watchdog.asked();
    wait(SILENCE_MS - 1);
    watchdog.asked();
    assert.equal(alarms(), 1);
    wait(1);
    watchdog.asked();
    assert.equal(alarms(), 2);
});
