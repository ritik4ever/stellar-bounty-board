'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  startRotation, readState, windowStatus, checkDelivery, DEFAULT_GRACE_MS,
} = require('./webhook-secret-rotation.cjs');

const oldSecret = 'previous-test-key-aaaaaaaaaaaaaaaaaaaa';
const newSecret = 'replacement-test-key-bbbbbbbbbbbbbbbbb';
const bytes = Buffer.from('{"event":"release","id":1}', 'utf8');
const sign = (secret) => `sha256=${crypto.createHmac('sha256', secret).update(bytes).digest('hex')}`;
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbb-webhook-rotation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'rotation.json');
}

test('first run records bounded window and reruns cannot extend it', (t) => {
  const file = fixture(t);
  const first = startRotation(file, { oldSecret, newSecret, now: 1_000_000 });
  const repeated = startRotation(file, { oldSecret, newSecret, now: 1_100_000 });
  const late = startRotation(file, { oldSecret, newSecret, now: 2_000_000 });
  assert.equal(first.created, true);
  assert.equal(repeated.created, false);
  assert.equal(late.created, false);
  assert.deepEqual(first.state, repeated.state);
  assert.deepEqual(first.state, late.state);
  assert.equal(first.state.expiresAt, first.state.startedAt + DEFAULT_GRACE_MS);
  assert.ok(!fs.readFileSync(file, 'utf8').includes(oldSecret));
  assert.ok(!fs.readFileSync(file, 'utf8').includes(newSecret));
});

test('new secret remains valid; previous secret expires exactly on deadline', (t) => {
  const file = fixture(t);
  const { state } = startRotation(file, { oldSecret, newSecret, now: 1_000_000 });
  const check = (secret, now) => checkDelivery(state, {
    oldSecret, newSecret, payload: bytes, signature: sign(secret), now,
  });
  assert.deepEqual(check(oldSecret, state.expiresAt - 1), {
    accepted: true, reason: 'grace_period_previous_secret',
  });
  assert.deepEqual(check(oldSecret, state.expiresAt), {
    accepted: false, reason: 'revoked_secret',
  });
  assert.deepEqual(check(newSecret, state.expiresAt + 1), {
    accepted: true, reason: 'active_secret',
  });
  assert.equal(windowStatus(state, state.expiresAt), 'expired');
});

test('changing parameters or secrets on a rerun fails closed', (t) => {
  const file = fixture(t);
  const { state } = startRotation(file, { oldSecret, newSecret, now: 1_000_000 });
  assert.throws(() => startRotation(file, {
    oldSecret, newSecret: 'another-key', now: 1_100_000,
  }), /different rotation/);
  assert.throws(() => startRotation(file, {
    oldSecret, newSecret, now: 1_100_000, graceMs: 60_000,
  }), /different rotation/);
  assert.deepEqual(readState(file), state);
});

test('invalid clock, grace period and malformed state do not reset window', (t) => {
  const file = fixture(t);
  assert.throws(() => startRotation(file, { oldSecret, newSecret, graceMs: 300_001 }), /Grace period/);
  const { state } = startRotation(file, { oldSecret, newSecret, now: 1_000_000 });
  assert.throws(() => startRotation(file, { oldSecret, newSecret, now: 999_999 }), /Clock moved backward/);
  assert.throws(() => windowStatus(state, 999_999), /Clock moved backward/);
  fs.writeFileSync(file, '{ invalid');
  assert.throws(() => readState(file), /not valid JSON/);
  assert.throws(() => startRotation(file, { oldSecret, newSecret, now: 1_000_001 }), /not valid JSON/);
});

test('tampered signatures and body fail verification', (t) => {
  const file = fixture(t);
  const { state } = startRotation(file, { oldSecret, newSecret, now: 1_000_000 });
  assert.deepEqual(checkDelivery(state, {
    oldSecret, newSecret, payload: bytes, signature: 'sha256=deadbeef', now: 1_000_001,
  }), { accepted: false, reason: 'invalid_signature' });
  assert.deepEqual(checkDelivery(state, {
    oldSecret, newSecret, payload: Buffer.from('different'),
    signature: sign(newSecret), now: 1_000_001,
  }), { accepted: false, reason: 'invalid_signature' });
  assert.throws(() => checkDelivery(state, {
    oldSecret, newSecret: 'wrong', payload: bytes,
    signature: sign(newSecret), now: 1_000_001,
  }), /Active secret does not match/);
});

test('zero or same secret is invalid', (t) => {
  const file = fixture(t);
  assert.throws(() => startRotation(file, { oldSecret: '', newSecret }), /non-empty/);
  assert.throws(() => startRotation(file, { oldSecret, newSecret: oldSecret }), /different/);
});
