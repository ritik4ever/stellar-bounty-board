# API Authentication: Wallet Signatures, Freighter & SEP-10

This guide describes the Stellar wallet authentication architecture for the
Stellar Bounty Board API, covering both the active Freighter/Ed25519 signature
verification and the planned SEP-10 challenge flow.

---

## 1. Wallet-Authenticated Maintainer Actions (Active)

Maintainer actions (`create`, `release`, `refund`, `cancel`, `notes`, `extend-deadline`)
require cryptographic proof of caller identity via Stellar wallet signatures. This prevents
unauthorized callers from manipulating bounties even if the backend is exposed directly.

### Required HTTP Headers

| Header                 | Description                                            | Example                        |
| ---------------------- | ------------------------------------------------------ | ------------------------------ |
| `x-stellar-public-key` | Maintainer's Stellar public key (`G...`)               | `GBPLA3T4I2WQ...`              |
| `x-stellar-signature`  | Cryptographic Ed25519 signature of the request payload | `AAAAAFake...` (Base64 or Hex) |

### Freighter Wallet Integration

When connected to a browser extension such as Freighter, the frontend signs the request
payload using `window.freighter.signMessage(payload)`:

```typescript
import { signMessage } from '@stellar/freighter-api';

const payload = JSON.stringify({
  action: 'release',
  bountyId: 'BNT-0001',
  timestamp: Math.floor(Date.now() / 1000),
  maintainer: userPublicKey,
});

const { signature } = await signMessage(payload);

const response = await fetch(`/api/bounties/${bountyId}/release`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-stellar-public-key': userPublicKey,
    'x-stellar-signature': signature,
  },
  body: payload,
});
```

### Verification Pipeline

Requests pass through `createStellarSignatureAuthMiddleware()` or `createBountyCreationSignatureMiddleware()`:

1. **Header Verification:** Both `x-stellar-public-key` and `x-stellar-signature` must be present (HTTP 401 if missing).
2. **Allowlist / Identity Verification:** The public key must be included in `MAINTAINER_PUBLIC_KEYS` or `MAINTAINER_PUBLIC_KEY` (HTTP 401 if unauthorized).
3. **Payload & Timestamp Freshness:** The body must include `action`, `bountyId`, and `timestamp` (Unix seconds). The timestamp must be within ±60 seconds of server time (HTTP 401 if expired).
4. **Replay Protection:** Nonce cache ensures identical signatures cannot be reused within the freshness window (HTTP 401 if replayed).
5. **Cryptographic Verification:** Signature is decoded (hex or base64, with optional `0x`, `sig=`, or `signature=` prefix) and verified using `@stellar/stellar-sdk` `Keypair.fromPublicKey().verify()`.
6. **Maintainer Matching:**
   - If `body.maintainer` is present, it must equal the signer's public key (HTTP 401).
   - If the bounty exists in the persistent store, the signer's proven public key must match the bounty's stored maintainer address (`bounty.maintainer === publicKeyHeader`). Signers attempting to modify bounties owned by other maintainers are rejected with **HTTP 403 Forbidden**.

### Test Mode Enforcement

In standard unit tests (`NODE_ENV === "test"`), signature checks can be bypassed for convenience.
To enforce signature validation during tests, set:

```bash
export STELLAR_AUTH_ENFORCED="true"
```

---

## 2. SEP-10 Challenge / Response Flow (Planned)

For session-based authentication across multiple web requests, the SEP-10 standard provides
a standardized challenge transaction flow:

1. **Challenge Request:** Client requests a SEP-10 challenge transaction for their Stellar account.
2. **Wallet Signing:** Wallet signs the challenge transaction XDR containing a server-generated nonce and timeout.
3. **Challenge Submission:** Client sends the signed challenge to `/api/auth/token`.
4. **JWT Issuance:** API verifies the transaction signatures and issues a signed JWT Bearer token for subsequent calls.

### Status

> **Note:** The SEP-10 endpoints and JWT session middleware are tracked under issues
> [#778](https://github.com/ritik4ever/stellar-bounty-board/issues/778) and
> [#779](https://github.com/ritik4ever/stellar-bounty-board/issues/779). Direct wallet
> signature verification is active for maintainer actions.
