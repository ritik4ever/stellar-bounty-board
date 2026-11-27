import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSeedInputs,
  buildOpenFixture,
  buildReservedFixture,
  buildSubmittedFixture,
  buildDisputedFixture,
  buildRefundedFixture,
  ALLOWED_TRANSITIONS,
  FIXTURE_STATUSES,
} from './seed-inputs.mjs';

const BUILDERS = {
  open: buildOpenFixture,
  reserved: buildReservedFixture,
  submitted: buildSubmittedFixture,
  disputed: buildDisputedFixture,
  refunded: buildRefundedFixture,
};

function stableStringify(value) {
  return JSON.stringify(value, (key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce((acc, k) => {
          acc[k] = val[k];
          return acc;
        }, {});
    }
    return val;
  });
}

function collectIds(fixture) {
  const ids = [];
  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object') {
      for (const [key, val] of Object.entries(node)) {
        if (key === 'id' || key.endsWith('Id')) {
          ids.push(val);
        }
        walk(val);
      }
    }
  };
  walk(fixture);
  return ids;
}

function collectTimestamps(fixture) {
  const timestamps = [];
  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object') {
      for (const [key, val] of Object.entries(node)) {
        if (key === 'timestamp' || key === 'at' || key === 'createdAt' || key === 'updatedAt') {
          timestamps.push(val);
        }
        walk(val);
      }
    }
  };
  walk(fixture);
  return timestamps;
}

test('builders are deterministic across repeated runs', () => {
  const first = stableStringify(buildSeedInputs());
  const second = stableStringify(buildSeedInputs());
  assert.equal(first, second, 'buildSeedInputs must be byte-identical across runs');

  for (const [status, builder] of Object.entries(BUILDERS)) {
    const a = stableStringify(builder());
    const b = stableStringify(builder());
    assert.equal(a, b, `${status} fixture must be byte-identical across runs`);
  }
});

test('deterministic IDs are stable and unique per fixture', () => {
  for (const [status, builder] of Object.entries(BUILDERS)) {
    const idsA = collectIds(builder());
    const idsB = collectIds(builder());
    assert.deepEqual(idsA, idsB, `${status} fixture IDs must be stable`);
    assert.equal(
      new Set(idsA).size,
      idsA.length,
      `${status} fixture IDs must be unique`,
    );
  }
});

test('every fixture produces a valid status history', () => {
  for (const status of FIXTURE_STATUSES) {
    const builder = BUILDERS[status];
    assert.ok(builder, `missing builder for ${status}`);
    const fixture = builder();

    assert.ok(Array.isArray(fixture.history), `${status} fixture must have a history array`);
    assert.ok(fixture.history.length > 0, `${status} fixture history must not be empty`);

    let previous = -Infinity;
    let previousStatus = null;
    for (const event of fixture.history) {
      const ts = Date.parse(event.timestamp);
      assert.ok(!Number.isNaN(ts), `${status} event timestamp must be parseable`);
      assert.ok(ts >= previous, `${status} event timestamps must be monotonically increasing`);
      previous = ts;

      if (previousStatus !== null) {
        const allowed = ALLOWED_TRANSITIONS[previousStatus] ?? [];
        assert.ok(
          allowed.includes(event.status),
          `${status} fixture has invalid transition ${previousStatus} -> ${event.status}`,
        );
      }
      previousStatus = event.status;
    }

    assert.equal(
      fixture.history[fixture.history.length - 1].status,
      status,
      `${status} fixture must end in its declared status`,
    );
  }
});

test('disputed fixture exists with expected event sequence', () => {
  const fixture = buildDisputedFixture();
  assert.ok(fixture, 'disputed fixture must exist');
  assert.equal(fixture.status, 'disputed');

  const sequence = fixture.history.map((event) => event.status);
  assert.deepEqual(sequence, ['open', 'reserved', 'submitted', 'disputed']);

  const timestamps = collectTimestamps(fixture);
  for (let i = 1; i < timestamps.length; i += 1) {
    assert.ok(
      Date.parse(timestamps[i]) >= Date.parse(timestamps[i - 1]),
      'disputed fixture timestamps must be non-decreasing',
    );
  }
});