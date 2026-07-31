#!/usr/bin/env node
/**
 * hash-admin-key.js
 *
 * CLI utility for operators to generate a bcrypt hash of an admin API key.
 * Store the resulting hash in the ADMIN_API_KEY_HASH environment variable.
 *
 * Usage (from the repo root):
 *   node scripts/hash-admin-key.js <your-admin-key>
 *
 * Example:
 *   node scripts/hash-admin-key.js "s3cr3t-k3y-here"
 *
 * Then add the output to your .env file:
 *   ADMIN_API_KEY_HASH=$2b$12$...
 *
 * The plaintext key is never stored — only the hash goes into the environment.
 */

"use strict";

const path = require("path");
const Module = require("module");

// bcryptjs lives in backend/node_modules; resolve it from there so this
// script can be run from the repo root without a separate install step.
const backendDir = path.join(__dirname, "..", "backend");
const resolve = Module.createRequire(path.join(backendDir, "package.json"));
const bcrypt = resolve("bcryptjs");

const SALT_ROUNDS = 12;

async function main() {
  const key = process.argv[2];

  if (!key || key.trim() === "") {
    console.error("Error: No admin key provided.");
    console.error("");
    console.error("Usage: node scripts/hash-admin-key.js <your-admin-key>");
    process.exit(1);
  }

  if (key.length < 16) {
    console.warn(
      "Warning: The provided key is shorter than 16 characters. " +
        "Consider using a longer, randomly generated key for better security.",
    );
  }

  console.log(`Hashing key with bcrypt (saltRounds=${SALT_ROUNDS}) — this may take a moment...`);

  const hash = await bcrypt.hash(key.trim(), SALT_ROUNDS);

  console.log("");
  console.log("Add the following line to your .env file:");
  console.log("");
  console.log(`ADMIN_API_KEY_HASH=${hash}`);
  console.log("");
  console.log("Keep the original key secret — only the hash should be stored in the environment.");
}

main().catch((err) => {
  console.error("Unexpected error:", err.message);
  process.exit(1);
});
