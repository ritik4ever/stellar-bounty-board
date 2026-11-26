# Testnet deployment configuration preflight (issues #1962, #1964)

This is an **offline, read-only gate** for commands that must not begin with a
malformed Stellar Testnet configuration. It does not require private keys,
fund an account, sign transactions, or call Stellar RPC. No dependencies are
added. It uses built-in Node.js APIs and deterministic public-address fixtures.

## Requirements

Provide these explicit environment variables in the shell or deployment
system before invoking the preflight:

| Variable                     | Meaning                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| `STELLAR_NETWORK`            | Must be `testnet`                                          |
| `SOROBAN_NETWORK_PASSPHRASE` | Must be `Test SDF Network ; September 2015`                |
| `SOROBAN_CONTRACT_ID`        | Valid checksummed `C...` Stellar contract address          |
| `ARBITER_ADDRESS`            | Valid checksummed `G...` Stellar account public key        |
| `SOROBAN_RPC_URL`            | HTTPS RPC URL (known Futurenet/Mainnet hosts are rejected) |

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

Do not interpret this wrapper as an automatic guard on _other_ entrypoints
(such as `npm --prefix backend start` or direct contract invocations). Those entrypoints
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

## Mainnet passphrase with a Testnet contract: incident runbook

### Inspect the effective inputs

Run the standalone gate from the repository root, in the same shell, container,
or deployment environment that will start the backend:

```sh
npm run testnet:preflight
```

Inspect only the relevant public configuration, rather than dumping the whole
environment (which may contain signing keys or RPC credentials):

```sh
node -e "for (const key of ['STELLAR_NETWORK', 'SOROBAN_NETWORK_PASSPHRASE', 'SOROBAN_CONTRACT_ID', 'CONTRACT_ID']) console.log(key + '=' + (process.env[key] || '<unset>'))"
```

For this startup path, the network must be `testnet` and the public network
passphrase must be exactly `Test SDF Network ; September 2015`. The Mainnet
passphrase `Public Global Stellar Network ; September 2015` is always rejected,
even when the contract address has a valid checksum. This check happens before
the contract-address check; it does not discover a contract's deployment network.
Confirm that the contract ID is the one in the intended Testnet deployment
record, and that the legacy `CONTRACT_ID`, if set, agrees with it.

Changing a `.env` file alone does not update the environment already supplied
to this gate. Load the corrected values through the deployment platform or
existing environment loader, or export them in the shell before retrying.

### Recognize the failure boundary

Both standalone validation and a guarded startup report this exact diagnostic
on stderr and exit with status **1**:

```text
[testnet-preflight] SOROBAN_NETWORK_PASSPHRASE does not match Stellar Testnet; stop before signing
```

The guard prints no `Local validation passed` banner on this path and never
starts the command after `--`. A guarded backend therefore has not started a
new process or loaded signing keys, built/signed a transaction, or submitted
funds through that child command. The validator itself uses no RPC or signing
APIs. Repeating this rejected preflight has the same outcome; no deployment
rollback is needed for this failure alone. This says nothing about commands
previously run outside the wrapper or an already-running backend.

| Signal                                                                    | Meaning                                                                | Operator action                                                     |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Exit 1 and the mismatch diagnostic above                                  | Local validation rejected the configuration; the child did not start   | Correct the effective Testnet inputs below                          |
| Exit 0 and `Local validation passed (testnet)` from standalone validation | Local checks passed; no deployment or contract lookup occurred         | Verify the actual Testnet deployment separately                     |
| Success banner followed by a child error/nonzero exit                     | Validation passed and the child started; its exit status is propagated | Inspect the child logs and any transaction state before retrying it |

An unrelated `[devops-configs] BLOCKED:` message comes from
`npm run validate:configs`, the repository configuration checker. Its contract
prefix classification is heuristic, not proof of deployment: neither `CA...`
nor any other `C...` prefix identifies a network. Resolve its configuration or
hook errors separately; use the strict startup gate and trusted deployment
records for this runbook.

### Correct and retry safely

1. Keep this startup path on Testnet. In a POSIX shell, set:

   ```sh
   export STELLAR_NETWORK=testnet
   export SOROBAN_NETWORK_PASSPHRASE='Test SDF Network ; September 2015'
   ```

2. Retain or restore the operator-confirmed Testnet `SOROBAN_CONTRACT_ID` and
   matching legacy alias. Check the `ARBITER_ADDRESS` and trusted HTTPS
   `SOROBAN_RPC_URL` against the requirements above. Do not substitute a
   Mainnet contract to make a Testnet startup pass; this gate does not support
   Mainnet. The public addresses in the offline examples below are fixtures,
   not evidence of a deployed contract.
3. Rerun `npm run testnet:preflight`. A local success still cannot prove the
   RPC's network or the contract's presence. Use a trusted Testnet RPC's
   read-only network/contract queries and the deployment record to verify
   those separately before allowing an operational command to run.
4. After that verification, build with `npm --prefix backend run build`, then
   start through `npm run start:testnet:safe`. Direct backend or signing commands bypass
   this optional guard. If the success banner appears before a later failure,
   investigate that child command rather than treating it as a safe preflight
   rejection to retry blindly.

To reproduce the failure without any deployed contract, keys, RPC access, or
funds, use example 2 below. The focused regression suite also runs a harmless
marker-writing child with a valid configuration as a positive control and
asserts that the mismatched configuration never starts it:

```sh
npm run test:testnet-config
```

### Reproducing startup failures from a clean checkout (#1960)

From a clean repository checkout and shell environment (no exported deployment
variables, `.env`, live funds, or network calls):

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
