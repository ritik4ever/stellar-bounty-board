#!/usr/bin/env node
"use strict";

/**
 * Fail-closed, offline Testnet preflight for optional deployment/startup commands.
 * Uses only Node built-ins; does not load .env, contact RPC, sign, or submit.
 */
const { spawnSync } = require("node:child_process");

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

class TestnetConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "TestnetConfigError";
  }
}

function crc16Xmodem(data) {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function decodeStrKey(value, prefix, field) {
  if (typeof value !== "string" || value.length !== 56 || !/^[A-Z2-7]{56}$/.test(value)) {
    throw new TestnetConfigError(`${field} must be a valid 56-character Stellar ${prefix} address`);
  }
  let bits = 0;
  let accumulator = 0;
  const output = [];
  for (const letter of value) {
    accumulator = (accumulator << 5) | ALPHABET.indexOf(letter);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >>> bits) & 255);
      accumulator &= (1 << bits) - 1;
    }
  }
  const data = Buffer.from(output);
  const expectedVersion = prefix === "G" ? 6 << 3 : 2 << 3;
  if (data.length !== 35 || data[0] !== expectedVersion ||
      data.readUInt16LE(33) !== crc16Xmodem(data.subarray(0, 33))) {
    throw new TestnetConfigError(`${field} has an invalid Stellar version or checksum`);
  }
  return value;
}

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TestnetConfigError(`${name} is required for Testnet deployment`);
  }
  return value.trim();
}

function validateTestnetConfig(env = process.env) {
  const network = required(env, "STELLAR_NETWORK").toLowerCase();
  if (network !== "testnet") {
    throw new TestnetConfigError("STELLAR_NETWORK must be 'testnet' for this startup path");
  }
  const passphrase = required(env, "SOROBAN_NETWORK_PASSPHRASE");
  if (passphrase !== TESTNET_PASSPHRASE) {
    throw new TestnetConfigError("SOROBAN_NETWORK_PASSPHRASE does not match Stellar Testnet; stop before signing");
  }
  const contractId = decodeStrKey(required(env, "SOROBAN_CONTRACT_ID"), "C", "SOROBAN_CONTRACT_ID");
  const arbiterAddress = decodeStrKey(required(env, "ARBITER_ADDRESS"), "G", "ARBITER_ADDRESS");
  if (env.CONTRACT_ID && env.CONTRACT_ID.trim() !== contractId) {
    throw new TestnetConfigError("CONTRACT_ID conflicts with SOROBAN_CONTRACT_ID");
  }
  const rpc = required(env, "SOROBAN_RPC_URL");
  let parsed;
  try {
    parsed = new URL(rpc);
  } catch {
    throw new TestnetConfigError("SOROBAN_RPC_URL must be a valid HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new TestnetConfigError("SOROBAN_RPC_URL must be HTTPS without credentials or a fragment");
  }
  if (/(^|[.-])(mainnet|futurenet|pubnet)([.-]|$)/i.test(parsed.hostname)) {
    throw new TestnetConfigError("SOROBAN_RPC_URL appears to target a non-Testnet network");
  }
  // StrKey addresses do NOT contain network information. Offline validation
  // cannot prove this contract is deployed on Testnet; verify via Testnet RPC.
  return Object.freeze({
    network,
    passphrase,
    contractId,
    arbiterAddress,
    rpcUrl: parsed.toString(),
    deploymentNetworkVerified: false,
  });
}

function main(argv = process.argv.slice(2), env = process.env) {
  let config;
  try {
    config = validateTestnetConfig(env);
  } catch (error) {
    console.error(`[testnet-preflight] ${error.message}`);
    return 1;
  }
  const separator = argv.indexOf("--");
  if (argv.length && separator !== 0) {
    console.error("[testnet-preflight] Usage: node scripts/validate-testnet-config.cjs [-- command args...]");
    return 2;
  }
  console.log(`[testnet-preflight] Local validation passed (${config.network}). Contract deployment must be verified separately on Testnet RPC.`);
  if (separator === -1) return 0;
  const command = argv.slice(1);
  if (!command.length) {
    console.error("[testnet-preflight] Missing command after --");
    return 2;
  }
  const result = spawnSync(command[0], command.slice(1), {
    stdio: "inherit",
    env,
    shell: false,
  });
  if (result.error) {
    console.error(`[testnet-preflight] Unable to start command: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (require.main === module) process.exitCode = main();
module.exports = { TESTNET_PASSPHRASE, TestnetConfigError, crc16Xmodem, decodeStrKey, validateTestnetConfig, main };
