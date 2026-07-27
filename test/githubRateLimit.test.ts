import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    HeaderBag,
    isRateLimitRejection,
    lowQuotaWarning,
    rateLimitBackoffMs
} from '../githubRateLimit.js';

// Header names are matched case-insensitively by fetch's Headers, and lowercase
// everywhere in the module, so a plain lookup is a faithful stand-in.
const headers = (values: Record<string, string>): HeaderBag => ({
    get: (name: string): string | null => values[name.toLowerCase()] ?? null
});

const NOW = 1_700_000_000_000; // Fixed clock so backoff maths is deterministic.

test('a 403 with an exhausted quota is a rate-limit rejection', () => {
    assert.equal(isRateLimitRejection(403, headers({ 'x-ratelimit-remaining': '0' })), true);
});

test('a 429 with retry-after is a rate-limit rejection', () => {
    assert.equal(isRateLimitRejection(429, headers({ 'retry-after': '60' })), true);
});

test('a 403 with quota to spare is some other refusal, not a rate limit', () => {
    // e.g. a private repo or a bad token: backing off for an hour would be wrong.
    assert.equal(isRateLimitRejection(403, headers({ 'x-ratelimit-remaining': '4999' })), false);
    assert.equal(isRateLimitRejection(403, headers({})), false);
});

test('non-403/429 failures are never rate limits', () => {
    assert.equal(isRateLimitRejection(404, headers({ 'x-ratelimit-remaining': '0' })), false);
    assert.equal(isRateLimitRejection(500, headers({ 'retry-after': '30' })), false);
});

test('retry-after wins over the reset timestamp', () => {
    const backoff = rateLimitBackoffMs(headers({
        'retry-after': '45',
        'x-ratelimit-reset': String((NOW + 3000_000) / 1000)
    }), NOW);
    assert.equal(backoff, 45_000);
});

test('the reset timestamp is used when retry-after is absent', () => {
    const resetAt = NOW + 120_000;
    const backoff = rateLimitBackoffMs(headers({ 'x-ratelimit-reset': String(resetAt / 1000) }), NOW);
    assert.equal(backoff, 120_000);
});

test('a reset already in the past falls back rather than retrying instantly', () => {
    const backoff = rateLimitBackoffMs(headers({ 'x-ratelimit-reset': String((NOW - 60_000) / 1000) }), NOW);
    assert.equal(backoff, 60_000);
});

test('backoff is capped at the length of the rate-limit window', () => {
    // A bogus reset a year out must not stall the poller until next year.
    const backoff = rateLimitBackoffMs(headers({ 'x-ratelimit-reset': String((NOW / 1000) + 31_536_000) }), NOW);
    assert.equal(backoff, 60 * 60 * 1000);
});

test('unparseable or missing headers fall back to a fixed backoff', () => {
    assert.equal(rateLimitBackoffMs(headers({}), NOW), 60_000);
    assert.equal(rateLimitBackoffMs(headers({ 'retry-after': 'soon' }), NOW), 60_000);
    assert.equal(rateLimitBackoffMs(headers({ 'retry-after': '' }), NOW), 60_000);
    assert.equal(rateLimitBackoffMs(headers({ 'retry-after': '0' }), NOW), 60_000);
});

test('a healthy quota produces no warning', () => {
    assert.equal(lowQuotaWarning(headers({ 'x-ratelimit-remaining': '4999', 'x-ratelimit-limit': '5000' })), null);
});

test('a nearly exhausted quota warns with the remaining count and reset time', () => {
    const warning = lowQuotaWarning(headers({
        'x-ratelimit-remaining': '3',
        'x-ratelimit-limit': '60',
        'x-ratelimit-reset': String(NOW / 1000)
    }));
    assert.match(warning ?? '', /3\/60/);
    assert.match(warning ?? '', /2023-11-14T22:13:20\.000Z/);
});

test('absent quota headers produce no warning', () => {
    // Mocks and proxies don't send them; an empty header must not read as zero.
    assert.equal(lowQuotaWarning(headers({})), null);
    assert.equal(lowQuotaWarning(headers({ 'x-ratelimit-remaining': '' })), null);
});
