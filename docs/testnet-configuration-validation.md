# Testnet deployment configuration preflight (issues #1962, #1964)

This is an **offline, read-only gate** for commands that must not begin with a
malformed Stellar Testnet configuration. It does not require private keys,
fund an account, sign transactions, or call Stellar RPC. No dependencies are
added. It uses built-in Node.js APIs and deterministic public-address fixtures.

## Requirements

Provide these explicit environment variables in the shell or deployment
system before invoking the preflight:

| Variable | Meaning |
|---|---|
| `STELLAR_NETWORK` | Must be `testnet` |
| `SOROBAN_NETWORK_PASSPHRASE` | Must be `Test SDF Network ; September 2015` |
| `SOROBAN_CONTRACT_ID` | Valid checksummed `C...` Stellar contract address |
| `ARBITER_ADDRESS` | Valid checksummed `G...` Stellar account public key |
| `SOROBAN_RPC_URL` | HTTPS RPC URL (known Futurenet/Mainnet hosts are rejected) |

If `CONTRACT_ID` is also supplied, it must match `SOROBAN_CONTRACT_ID`.
Nothing silently defaults to a different network or a placeholder address.
The provided variables are read from `process.env`; this tool does not parse
`.env` itself. Set them through your shell, deployment platform, or your
existing env loader before running it. Never commit actual private keys.

## Usage

From the repository root:

```sh
node scripts/validate-testnet-config.cjs
node --test scripts/validate-testnet-config.test.cjs
```

For a fail-closed startup, use the optional npm script after building the
backend:

```sh
npm run start:testnet:safe
```

Or guard any CLI command by placing it **after `--`**. The preflight must
succeed before the child process starts:

```sh
node scripts/validate-testnet-config.cjs -- node backend/dist/index.js
```

Do not interpret this wrapper as an automatic guard on *other* entrypoints
(such as plain `npm start` or direct contract invocations). Those entrypoints
must explicitly use this preflight to obtain the same protection. The safe
startup command doesn't independently verify deployed contract state.

## Expected results

- Valid local configuration: exit 0, concise success message; command after
  `--` starts if supplied.
- Missing/invalid contract address, arbiter, network, RPC URL or passphrase:
  exit nonzero; child command is never started.
- Mainnet passphrase combined with a nominal Testnet fixture contract ID:
  rejected before any signing or fund movement.
- No HTTP request or secret material is used during tests.

### Reproducing startup failures from a clean checkout (#1960)

From a clean repository checkout (no `.env`, no live funds, no network calls):

```sh
# 1. Missing contract ID -> fails before any child command or signing
STELLAR_NETWORK=testnet \
SOROBAN_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
ARBITER_ADDRESS="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" \
SOROBAN_RPC_URL="https://soroban-testnet.stellar.org" \
node scripts/validate-testnet-config.cjs -- node -e "console.log('should not run')"
# Expected: exit 1, stderr: [testnet-preflight] SOROBAN_CONTRACT_ID is required for Testnet deployment

# 2. Wrong network passphrase (Mainnet passphrase on Testnet) -> fails before signing
STELLAR_NETWORK=testnet \
SOROBAN_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015" \
SOROBAN_CONTRACT_ID="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM" \
ARBITER_ADDRESS="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" \
SOROBAN_RPC_URL="https://soroban-testnet.stellar.org" \
node scripts/validate-testnet-config.cjs -- node -e "console.log('should not run')"
# Expected: exit 1, stderr: [testnet-preflight] SOROBAN_NETWORK_PASSPHRASE does not match Stellar Testnet; stop before signing

# 3. Invalid arbiter address (e.g. C... contract ID or S... secret key instead of G... public key) -> fails
STELLAR_NETWORK=testnet \
SOROBAN_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
SOROBAN_CONTRACT_ID="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM" \
ARBITER_ADDRESS="G..." \
SOROBAN_RPC_URL="https://soroban-testnet.stellar.org" \
node scripts/validate-testnet-config.cjs -- node -e "console.log('should not run')"
# Expected: exit 1, stderr: [testnet-preflight] ARBITER_ADDRESS must be a valid 56-character Stellar G address
```

## Important network limitation

A Stellar `C...` contract address **does not encode a network name**. A valid
checksum proves only address formatting; it does **not** establish that the
contract exists on Testnet. An arbitrary custom HTTPS RPC endpoint could also
point to the wrong network. To verify an actual deployment, use trusted
Testnet RPC and compare its network passphrase and contract instance against
the expected deployment record. This offline preflight deliberately does not
claim to perform that network-side verification.

This utility is intentionally limited to Testnet configuration validation;
mainnet deployments and signing workflows are not changed.
