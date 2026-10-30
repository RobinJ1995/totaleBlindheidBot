import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyboard } from '../rsvp.js';

test('the RSVP buttons are green, blue and red', () => {
    assert.deepEqual(keyboard('rollcall').inline_keyboard[0].map(b => b.style), ['success', 'primary', 'danger']);
});
