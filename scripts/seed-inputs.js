'use strict';

/**
 * Deterministic seed inputs for local test data seeding.
 *
 * This module is the single source of truth for the fixtures used by the
 * local seed scripts. Everything here is fixed (no randomness, no clock
 * reads) so that a clean checkout produces identical IDs, timestamps and
 * status histories on every run.
 *
 * Status lifecycle:
 *   created -> reserved -> submitted -> disputed
 *                                     -> refunded
 *
 * Each fixture lists its exact status-transition sequence with offsets in
 * seconds relative to BASE_EPOCH. The first transition is always `created`
 * at offset 0.
 *
 * NOTE: These fixtures are for local development and tests only. They must
 * never be used with live funds.
 */

/** Fixed base epoch (2026-01-01T00:00:00.000Z) in seconds. */
const BASE_EPOCH = 1767225600;

/** Maintainer public key used by all fixtures. */
const MAINTAINER_PUBLIC_KEY =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/** Contributor public key used by all fixtures. */
const CONTRIBUTOR_PUBLIC_KEY =
  'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

/** Bounty ID prefixes, one per fixture. */
const BOUNTY_ID_PREFIXES = Object.freeze({
  open: 'OPEN',
  reserved: 'RSVD',
  submitted: 'SUBM',
  disputed: 'DSPT',
  refunded: 'RFND',
});

/**
 * Build a deterministic bounty ID from a prefix and a zero-padded index.
 * @param {string} prefix
 * @param {number} index
 * @returns {string}
 */
function makeBountyId(prefix, index) {
  return `${prefix}-${String(index).padStart(4, '0')}`;
}

/**
 * Fixture table. Each entry describes one bounty and its full, ordered
 * status history. Offsets are in seconds relative to BASE_EPOCH.
 *
 * Fields:
 *   key          - fixture identifier
 *   prefix       - bounty ID prefix (see BOUNTY_ID_PREFIXES)
 *   index        - numeric index used to build the bounty ID
 *   amount       - bounty amount in stroops (string, integer)
 *   asset        - asset code
 *   transitions  - ordered [{ status, offsetSeconds, actor, note }]
 */
const FIXTURES = Object.freeze([
  Object.freeze({
    key: 'open',
    prefix: BOUNTY_ID_PREFIXES.open,
    index: 1,
    amount: '1000000000',
    asset: 'XLM',
    transitions: Object.freeze([
      Object.freeze({
        status: 'created',
        offsetSeconds: 0,
        actor: MAINTAINER_PUBLIC_KEY,
        note: 'Bounty created and funded.',
      }),
    ]),
  }),
  Object.freeze({
    key: 'reserved',
    prefix: BOUNTY_ID_PREFIXES.reserved,
    index: 2,
    amount: '2000000000',
    asset: 'XLM',
    transitions: Object.freeze([
      Object.freeze({
        status: 'created',
        offsetSeconds: 0,
        actor: MAINTAINER_PUBLIC_KEY,
        note: 'Bounty created and funded.',
      }),
      Object.freeze({
        status: 'reserved',
        offsetSeconds: 3600,
        actor: CONTRIBUTOR_PUBLIC_KEY,
        note: 'Contributor reserved the bounty.',
      }),
    ]),
  }),
  Object.freeze({
    key: 'submitted',
    prefix: BOUNTY_ID_PREFIXES.submitted,
    index: 3,
    amount: '3000000000',
    asset: 'XLM',
    transitions: Object.freeze([
      Object.freeze({
        status: 'created',
        offsetSeconds: 0,
        actor: MAINTAINER_PUBLIC_KEY,
        note: 'Bounty created and funded.',
      }),
      Object.freeze({
        status: 'reserved',
        offsetSeconds: 3600,
        actor: CONTRIBUTOR_PUBLIC_KEY,
        note: 'Contributor reserved the bounty.',
      }),
      Object.freeze({
        status: 'submitted',
        offsetSeconds: 7200,
        actor: CONTRIBUTOR_PUBLIC_KEY,
        note: 'Contributor submitted work for review.',
      }),
    ]),
  }),
  Object.freeze({
    key: 'disputed',
    prefix: BOUNTY_ID_PREFIXES.disputed,
    index: 4,
    amount: '4000000000',
    asset: 'XLM',
    transitions: Object.freeze([
      Object.freeze({
        status: 'created',
        offsetSeconds: 0,
        actor: MAINTAINER_PUBLIC_KEY,
        note: 'Bounty created and funded.',
      }),
      Object.freeze({
        status: 'reserved',
        offsetSeconds: 3600,
        actor: CONTRIBUTOR_PUBLIC_KEY,
        note: 'Contributor reserved the bounty.',
      }),
      Object.freeze({
        status: 'submitted',
        offsetSeconds: 7200,
        actor: CONTRIBUTOR_PUBLIC_KEY,
        note: 'Contributor submitted work for review.',
      }),
      Object.freeze({
        status: 'disputed',
        offsetSeconds: 10800,
        actor: MAINTAINER_PUBLIC_KEY,
        note: 'Maintainer disputed the submission.',
      }),
    ]),
  }),
  Object.freeze({
    key: 'refunded',
    prefix: BOUNTY_ID_PREFIXES.refunded,
    index: 5,
    amount: '5000000000',
    asset: 'XLM',
    transitions: Object.freeze([
      Object.freeze({
        status: 'created',
        offsetSeconds: 0,
        actor: MAINTAINER_PUBLIC_KEY,
        note: 'Bounty created and funded.',
      }),
      Object.freeze({
        status: 'reserved',
        offsetSeconds: 3600,
        actor: CONTRIBUTOR_PUBLIC_KEY,
        note: 'Contributor reserved the bounty.',
      }),
      Object.freeze({
        status: 'submitted',
        offsetSeconds: 7200,
        actor: CONTRIBUTOR_PUBLIC_KEY,
        note: 'Contributor submitted work for review.',
      }),
      Object.freeze({
        status: 'refunded',
        offsetSeconds: 14400,
        actor: MAINTAINER_PUBLIC_KEY,
        note: 'Bounty refunded to maintainer.',
      }),
    ]),
  }),
]);

/**
 * Look up a fixture by key.
 * @param {string} key
 * @returns {object}
 */
function getFixture(key) {
  const fixture = FIXTURES.find((f) => f.key === key);
  if (!fixture) {
    throw new Error(`Unknown seed fixture: ${key}`);
  }
  return fixture;
}

/**
 * Convert a fixture offset (seconds) to an ISO timestamp.
 * @param {number} offsetSeconds
 * @returns {string}
 */
function offsetToIso(offsetSeconds) {
  return new Date((BASE_EPOCH + offsetSeconds) * 1000).toISOString();
}

/**
 * Build a deterministic bounty record from a fixture.
 * @param {object|string} fixtureOrKey
 * @returns {object}
 */
function buildBounty(fixtureOrKey) {
  const fixture =
    typeof fixtureOrKey === 'string' ? getFixture(fixtureOrKey) : fixtureOrKey;
  const first = fixture.transitions[0];
  const last = fixture.transitions[fixture.transitions.length - 1];

  return {
    id: makeBountyId(fixture.prefix, fixture.index),
    fixtureKey: fixture.key,
    maintainer: MAINTAINER_PUBLIC_KEY,
    contributor: CONTRIBUTOR_PUBLIC_KEY,
    amount: fixture.amount,
    asset: fixture.asset,
    status: last.status,
    createdAt: offsetToIso(first.offsetSeconds),
    updatedAt: offsetToIso(last.offsetSeconds),
  };
}

/**
 * Build the ordered audit events for a fixture's bounty.
 * @param {object|string} fixtureOrKey
 * @returns {Array<object>}
 */
function buildAuditEvents(fixtureOrKey) {
  const fixture =
    typeof fixtureOrKey === 'string' ? getFixture(fixtureOrKey) : fixtureOrKey;
  const bountyId = makeBountyId(fixture.prefix, fixture.index);

  return fixture.transitions.map((transition, i) => ({
    id: `${bountyId}-EVT-${String(i + 1).padStart(4, '0')}`,
    bountyId,
    sequence: i + 1,
    status: transition.status,
    actor: transition.actor,
    note: transition.note,
    offsetSeconds: transition.offsetSeconds,
    timestamp: offsetToIso(transition.offsetSeconds),
  }));
}

/**
 * Build the full seed set (bounties + audit events) for all fixtures.
 * @returns {{ bounties: Array<object>, auditEvents: Array<object> }}
 */
function buildSeedSet() {
  const bounties = [];
  const auditEvents = [];

  for (const fixture of FIXTURES) {
    bounties.push(buildBounty(fixture));
    auditEvents.push(...buildAuditEvents(fixture));
  }

  return { bounties, auditEvents };
}

module.exports = {
  BASE_EPOCH,
  MAINTAINER_PUBLIC_KEY,
  CONTRIBUTOR_PUBLIC_KEY,
  BOUNTY_ID_PREFIXES,
  FIXTURES,
  makeBountyId,
  getFixture,
  offsetToIso,
  buildBounty,
  buildAuditEvents,
  buildSeedSet,
};