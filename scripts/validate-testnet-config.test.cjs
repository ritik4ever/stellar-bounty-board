"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, existsSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const {
  TESTNET_PASSPHRASE,
  crc16Xmodem,
  decodeStrKey,
  validateTestnetConfig,
} = require("./validate-testnet-config.cjs");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function encodeAddress(version, seed) {
  const bytes = Buffer.alloc(33, seed);
  bytes[0] = version;
  const checksum = crc16Xmodem(bytes);
  const binary = Buffer.concat([bytes, Buffer.from([checksum & 255, checksum >>> 8])]);
  let bits = 0, accumulator = 0, encoded = "";
  for (const byte of binary) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += ALPHABET[(accumulator >>> bits) & 31];
      accumulator &= (1 << bits) - 1;
    }
  }
  assert.equal(encoded.length, 56);
  return encoded;
}
const CONTRACT_ID = encodeAddress(2 << 3, 0x21);
const ARBITER_ADDRESS = encodeAddress(6 << 3, 0x32);
const valid = Object.freeze({
  STELLAR_NETWORK: "testnet",
  SOROBAN_NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
  SOROBAN_CONTRACT_ID: CONTRACT_ID,
  ARBITER_ADDRESS,
  SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
});

function invoke(env, command = []) {
  return spawnSync(process.execPath, [path.join(__dirname, "validate-testnet-config.cjs"), ...command], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
    encoding: "utf8",
  });
}

test("deterministic Testnet addresses have valid versions and checksums", () => {
  assert.match(CONTRACT_ID, /^C[A-Z2-7]{55}$/);
  assert.match(ARBITER_ADDRESS, /^G[A-Z2-7]{55}$/);
  assert.equal(decodeStrKey("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "G", "known account"), "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
  assert.equal(validateTestnetConfig(valid).deploymentNetworkVerified, false);
});

test("clean environment missing required deployment variables fails closed", () => {
  for (const field of Object.keys(valid)) {
    const env = { ...valid }; delete env[field];
    assert.throws(() => validateTestnetConfig(env), new RegExp(field));
  }
});

test("mainnet passphrase combined with a Testnet fixture contract ID is rejected", () => {
  assert.throws(() => validateTestnetConfig({
    ...valid,
    SOROBAN_NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015",
  }), /SOROBAN_NETWORK_PASSPHRASE/);
});

test("non-Testnet network and RPC endpoints are rejected", () => {
  assert.throws(() => validateTestnetConfig({ ...valid, STELLAR_NETWORK: "public" }), /STELLAR_NETWORK/);
  assert.throws(() => validateTestnetConfig({ ...valid, SOROBAN_RPC_URL: "https://rpc-futurenet.stellar.org" }), /SOROBAN_RPC_URL/);
});

test("invalid contract IDs and arbiter public keys fail checksum and type validation", () => {
  assert.throws(() => validateTestnetConfig({ ...valid, SOROBAN_CONTRACT_ID: CONTRACT_ID.slice(0, -1) + (CONTRACT_ID.endsWith("A") ? "B" : "A") }), /SOROBAN_CONTRACT_ID/);
  assert.throws(() => validateTestnetConfig({ ...valid, ARBITER_ADDRESS: CONTRACT_ID }), /ARBITER_ADDRESS/);
  assert.throws(() => validateTestnetConfig({ ...valid, SOROBAN_CONTRACT_ID: ARBITER_ADDRESS }), /SOROBAN_CONTRACT_ID/);
  assert.throws(() => validateTestnetConfig({ ...valid, ARBITER_ADDRESS: "G..." }), /ARBITER_ADDRESS/);
});

test("a conflicting legacy contract ID is rejected", () => {
  assert.throws(() => validateTestnetConfig({ ...valid, CONTRACT_ID: encodeAddress(2 << 3, 0x44) }), /CONTRACT_ID/);
});

test("invalid setup exits before running any command that could sign or move funds", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "sbb-testnet-") );
  const marker = path.join(folder, "would-have-signed");
  try {
    const command = ["--", process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'signed')`];
    const result = invoke({ ...valid, SOROBAN_NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015" }, command);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /SOROBAN_NETWORK_PASSPHRASE/);
    assert.equal(existsSync(marker), false);
    const success = invoke(valid, command);
    assert.equal(success.status, 0, success.stderr);
    assert.equal(existsSync(marker), true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("standalone validation makes no network requests or transaction submissions", () => {
  const result = invoke(valid);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Local validation passed/);
  assert.match(result.stdout, /must be verified separately/);
});

test("rejects secret key as ARBITER_ADDRESS and pubnet RPC URL before running child command (#1960)", () => {
  const secretKeyAsArbiter = encodeAddress(18 << 3, 0x55);
  assert.throws(
    () => validateTestnetConfig({ ...valid, ARBITER_ADDRESS: secretKeyAsArbiter }),
    /ARBITER_ADDRESS has an invalid Stellar version or checksum/,
  );
  assert.throws(
    () => validateTestnetConfig({ ...valid, SOROBAN_RPC_URL: "https://soroban-pubnet.example.org" }),
    /SOROBAN_RPC_URL appears to target a non-Testnet network/,
  );

  // Clean-checkout reproduction: missing SOROBAN_CONTRACT_ID exits 1 without running command
  const missingContract = invoke({ ...valid, SOROBAN_CONTRACT_ID: "" }, ["--", process.execPath, "-e", "process.exit(99)"]);
  assert.equal(missingContract.status, 1);
  assert.match(missingContract.stderr, /SOROBAN_CONTRACT_ID is required/);
});
