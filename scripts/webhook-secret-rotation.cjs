'use strict';

/**
 * GitHub webhook secret rotation planning / signature verification utility.
 * No network calls, no credential storage, and no production configuration changes.
 * Run from the repository root: node scripts/webhook-secret-rotation.cjs start|status|check
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_GRACE_MS = 300_000;
const MAX_GRACE_MS = 300_000;
const DEFAULT_STATE = path.join(os.homedir(), '.stellar-bounty-board', 'webhook-rotation.json');
const HEX_64 = /^[0-9a-f]{64}$/;
const SIGNATURE = /^sha256=([0-9a-fA-F]{64})$/;

function fingerprint(secret) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('Both webhook secrets must be non-empty strings supplied through the environment.');
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}

function validateTimestamp(now) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('Invalid millisecond timestamp.');
  }
}

function validateGrace(graceMs) {
  if (!Number.isSafeInteger(graceMs) || graceMs < 1 || graceMs > MAX_GRACE_MS) {
    throw new Error(`Grace period must be an integer between 1 and ${MAX_GRACE_MS} milliseconds.`);
  }
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || state.version !== 1 ||
      !HEX_64.test(state.oldFingerprint || '') || !HEX_64.test(state.newFingerprint || '') ||
      state.oldFingerprint === state.newFingerprint ||
      !Number.isSafeInteger(state.startedAt) || state.startedAt < 0 ||
      !Number.isSafeInteger(state.expiresAt) ||
      state.expiresAt <= state.startedAt ||
      state.expiresAt - state.startedAt > MAX_GRACE_MS) {
    throw new Error('Rotation state is malformed: stop and recover from a trusted backup; do not restart the grace window.');
  }
  return state;
}

function readState(statePath) {
  try {
    return validateState(JSON.parse(fs.readFileSync(statePath, 'utf8')));
  } catch (error) {
    if (error && error.code === 'ENOENT') return undefined;
    if (error instanceof SyntaxError) {
      throw new Error('Rotation state is not valid JSON: stop and recover from a trusted backup.');
    }
    throw error;
  }
}

function startRotation(statePath, { oldSecret, newSecret, graceMs = DEFAULT_GRACE_MS, now = Date.now() }) {
  validateTimestamp(now);
  validateGrace(graceMs);
  const oldFingerprint = fingerprint(oldSecret);
  const newFingerprint = fingerprint(newSecret);
  if (oldFingerprint === newFingerprint) throw new Error('Old and new secrets must be different.');
  const existing = readState(statePath);
  if (existing) {
    if (existing.oldFingerprint !== oldFingerprint || existing.newFingerprint !== newFingerprint ||
        existing.expiresAt - existing.startedAt !== graceMs) {
      throw new Error('A different rotation already occupies this state file. Stop; do not overwrite or restart it.');
    }
    if (now < existing.startedAt) throw new Error('Clock moved backward: stop and correct the system clock.');
    return { state: existing, created: false };
  }
  const state = validateState({
    version: 1,
    oldFingerprint,
    newFingerprint,
    startedAt: now,
    expiresAt: now + graceMs,
  });
  const dir = path.dirname(statePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Exclusive creation prevents concurrent reruns from overwriting the original deadline.
  let fd;
  try {
    fd = fs.openSync(statePath, 'wx', 0o600);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      return startRotation(statePath, { oldSecret, newSecret, graceMs, now });
    }
    throw error;
  }
  try {
    fs.writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return { state, created: true };
}

function windowStatus(state, now = Date.now()) {
  validateState(state);
  validateTimestamp(now);
  if (now < state.startedAt) throw new Error('Clock moved backward: stop and correct the system clock.');
  return now < state.expiresAt ? 'grace' : 'expired';
}

function checkDelivery(state, { newSecret, oldSecret, payload, signature, now = Date.now() }) {
  const phase = windowStatus(state, now);
  if (fingerprint(newSecret) !== state.newFingerprint) {
    throw new Error('Active secret does not match the recorded rotation; stop, check deployment configuration.');
  }
  if (oldSecret !== undefined && fingerprint(oldSecret) !== state.oldFingerprint) {
    throw new Error('Previous secret does not match the recorded rotation; stop, check deployment configuration.');
  }
  if (!Buffer.isBuffer(payload) && typeof payload !== 'string') {
    throw new Error('Delivery payload must be the unmodified raw bytes or a string.');
  }
  const match = typeof signature === 'string' && SIGNATURE.exec(signature);
  if (!match) return { accepted: false, reason: 'invalid_signature' };
  const provided = Buffer.from(match[1], 'hex');
  function signedWith(secret) {
    const expected = crypto.createHmac('sha256', secret).update(payload).digest();
    return crypto.timingSafeEqual(expected, provided);
  }
  if (signedWith(newSecret)) return { accepted: true, reason: 'active_secret' };
  if (oldSecret && signedWith(oldSecret)) {
    return phase === 'grace'
      ? { accepted: true, reason: 'grace_period_previous_secret' }
      : { accepted: false, reason: 'revoked_secret' };
  }
  return { accepted: false, reason: 'invalid_signature' };
}

function usage() {
  return [
    'Usage: node scripts/webhook-secret-rotation.cjs start|status|check [--state PATH] [--grace-ms N]',
    'start: WEBHOOK_ROTATION_OLD_SECRET and WEBHOOK_ROTATION_NEW_SECRET required',
    'check: WEBHOOK_ROTATION_NEW_SECRET, optional WEBHOOK_ROTATION_OLD_SECRET, --payload PATH and --signature sha256=<64 hex>',
    'status: no secrets required',
    'By default rotation metadata is stored outside the Git repository.',
  ].join('\n');
}

function cli(args = process.argv.slice(2), env = process.env) {
  const [command, ...rest] = args;
  if (!['start', 'status', 'check'].includes(command)) throw new Error(usage());
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--state', '--grace-ms', '--payload', '--signature'].includes(rest[i]) ||
        !rest[i + 1] || Object.hasOwn(options, rest[i])) throw new Error(usage());
    options[rest[i]] = rest[i + 1];
  }
  const statePath = path.resolve(options['--state'] || DEFAULT_STATE);
  if (command === 'start') {
    if (options['--payload'] || options['--signature']) throw new Error(usage());
    const graceMs = options['--grace-ms'] === undefined
      ? DEFAULT_GRACE_MS
      : Number(options['--grace-ms']);
    const { state, created } = startRotation(statePath, {
      oldSecret: env.WEBHOOK_ROTATION_OLD_SECRET,
      newSecret: env.WEBHOOK_ROTATION_NEW_SECRET,
      graceMs,
    });
    process.stdout.write(JSON.stringify({
      action: created ? 'rotation_recorded' : 'rotation_unchanged',
      startedAt: new Date(state.startedAt).toISOString(),
      expiresAt: new Date(state.expiresAt).toISOString(),
      status: windowStatus(state),
    }, null, 2) + '\n');
    return 0;
  }
  if (options['--grace-ms']) throw new Error('The grace window is immutable after start.');
  const state = readState(statePath);
  if (!state) throw new Error('No rotation record exists. Stop: do not start a new grace window to handle a failed delivery.');
  if (command === 'status') {
    if (options['--payload'] || options['--signature']) throw new Error(usage());
    process.stdout.write(JSON.stringify({
      status: windowStatus(state),
      startedAt: new Date(state.startedAt).toISOString(),
      expiresAt: new Date(state.expiresAt).toISOString(),
    }, null, 2) + '\n');
    return 0;
  }
  if (!options['--payload'] || !options['--signature']) throw new Error(usage());
  const result = checkDelivery(state, {
    newSecret: env.WEBHOOK_ROTATION_NEW_SECRET,
    oldSecret: env.WEBHOOK_ROTATION_OLD_SECRET,
    payload: fs.readFileSync(options['--payload']),
    signature: options['--signature'],
  });
  process.stdout.write(JSON.stringify(result) + '\n');
  return result.accepted ? 0 : result.reason === 'revoked_secret' ? 2 : 1;
}

module.exports = {
  DEFAULT_GRACE_MS,
  MAX_GRACE_MS,
  fingerprint,
  readState,
  startRotation,
  windowStatus,
  checkDelivery,
  cli,
};

if (require.main === module) {
  try {
    process.exitCode = cli();
  } catch (error) {
    // Do not print environment secrets, payloads, or signatures.
    process.stderr.write(`Rotation stopped: ${error instanceof Error ? error.message : 'unexpected error'}\n`);
    process.exitCode = 1;
  }
}
