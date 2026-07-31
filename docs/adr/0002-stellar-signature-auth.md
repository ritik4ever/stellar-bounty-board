# ADR 0002 — Stellar Signature Authentication

**Status:** Accepted  
**Date:** 2026-05-30

## Context

Maintainer-only API routes (release, refund, create) need to be protected so only the project maintainer(s) can call them. The common alternatives are:

- **JWT / session tokens** — require a login flow, a secret signing key stored server-side, and token issuance/refresh infrastructure.
- **API keys** — a shared secret that must be distributed and rotated out-of-band.
- **Stellar keypair signatures** — the maintainer already has a Stellar keypair for on-chain operations. Signing the request payload with that key proves identity without any additional credential management.

Because this project is built around Stellar wallets, using the maintainer's existing keypair avoids introducing a second identity system. There is no user database, no login endpoint, and no token storage — the keypair *is* the identity.

## Decision

Protected routes require two HTTP headers:

| Header | Value |
|---|---|
| `x-stellar-public-key` | The maintainer's Stellar public key (`G…`) |
| `x-stellar-signature` | The request payload signed with the corresponding private key, hex- or base64-encoded |

The server verifies the signature using `Keypair.verify()` from `stellar-sdk`. The allowed public keys are configured via the `MAINTAINER_PUBLIC_KEYS` environment variable (comma-separated list), with `MAINTAINER_PUBLIC_KEY` as a single-key fallback for backwards compatibility.

### Verification flow

1. Read `x-stellar-public-key` from the request and check it is in the `MAINTAINER_PUBLIC_KEYS` allowlist. Reject with 401 if not.
2. Determine the payload to verify:
   - Use `rawBody` if the request has a body (preserves exact bytes).
   - Fall back to `JSON.stringify(req.body)` for parsed JSON bodies.
   - Fall back to `"METHOD /path"` for bodyless requests (e.g. GET).
3. Decode the signature — try hex first, then base64.
4. Call `keypair.verify(payload, signature)`. Reject with 401 on failure.
5. If the request body includes a `maintainer` field, assert it matches the signing key. This prevents a valid maintainer from signing a request that names a different maintainer.

### Multi-key support

`MAINTAINER_PUBLIC_KEYS` accepts a comma-separated list of public keys, allowing key rotation and multiple maintainers without a code change:

```
MAINTAINER_PUBLIC_KEYS=GABC...123,GDEF...456
```

## Trade-offs

**Advantages**

- No credential management — the maintainer's wallet keypair doubles as the auth credential.
- Stateless — the server holds no session state; any instance can verify any request.
- Aligns with the on-chain model where Stellar signatures are the canonical proof of identity.
- Multi-key support enables key rotation and shared maintainership via config only.

**Disadvantages**

- No replay protection — a captured request with a valid signature can be replayed. Mitigated in practice because the payload includes the request body (which contains resource IDs and state), so replaying the same signed payload has no additional effect once the state transition has already occurred. A timestamp/nonce scheme should be added before this is exposed to untrusted networks.
- The private key must be available to whatever tooling calls the API (CI, scripts). It should never be committed or logged — see SECURITY.md for logging redaction rules.
- Signature verification is skipped in `NODE_ENV=test` to simplify test setup.

## Replay attack mitigation (current)

The signed payload is the full request body, which includes the bounty ID and the target state. A replayed release request for bounty `abc` will be rejected by the business logic layer because the bounty is already in `RELEASED` state. This is implicit idempotency, not cryptographic replay prevention.

A future improvement would be to include a short-lived timestamp or nonce in the signed payload and reject requests outside a ±5 minute window.

## Related

- Implementation: `backend/src/middleware/auth.ts`
- Security policy: [SECURITY.md](../../SECURITY.md)
