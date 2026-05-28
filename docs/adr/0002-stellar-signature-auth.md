# ADR 0002: Stellar Signature Authentication for Maintainer Actions

## Status

Accepted

## Context

Maintainer actions such as releasing or refunding a bounty are tied to a Stellar
public key. The application needs a way to prove that the request was approved by
the maintainer who controls that key without asking the server to store private
wallet material.

Common web authentication options such as JWTs or server sessions prove that a
browser previously authenticated with the application, but they do not prove
control of the Stellar account that is recorded on the bounty. They also add
server-side token issuance, revocation, and session lifetime concerns that are
not needed for a wallet-owned action.

The backend therefore uses Stellar public-key signatures for protected
maintainer operations. The current middleware lives in
`backend/src/middleware/auth.ts`.

## Decision

Use Stellar signature authentication for maintainer-authorized actions instead
of JWTs or cookie-backed sessions.

Clients send:

- `x-stellar-public-key`: the Stellar public key of the signer.
- `x-stellar-signature`: a signature over the request payload.

The backend verifies that the signer is one of the configured maintainer public
keys and that the signature matches the request payload. The request body
`maintainer` value, when present, must also match the signer public key.

## Verification Flow

1. The route attaches `createStellarSignatureAuthMiddleware()`.
2. The middleware loads allowed maintainer keys from configuration.
3. The request must include both `x-stellar-public-key` and
   `x-stellar-signature`.
4. The public key must be present in the configured maintainer allow-list.
5. The signed payload is taken from the captured raw request body when
   available, then falls back to the JSON request body, then to
   `<METHOD> <URL>` for requests without a body.
6. The signature is normalized from `0x`, `sig=`, or `signature=` prefixes and
   decoded as either hex or base64.
7. `Keypair.fromPublicKey(publicKey).verify(payload, signature)` must succeed.
8. If `req.body.maintainer` is provided, it must equal the signing public key.

Requests that fail configuration, header, allow-list, signature, or maintainer
matching checks are rejected before the protected action executes.

## Replay Attack Mitigation

Signature authentication proves key control, but a signature can be replayed if
the exact same payload remains valid forever. The current implementation reduces
risk by signing the full request payload instead of only the route name, so a
signature for one maintainer or action cannot be reused for a different payload.

Routes that perform money-moving or state-changing actions should include
freshness data in the signed payload, such as:

- `timestamp`: request creation time.
- `nonce` or operation id: unique per attempted action.
- `bountyId` and `action`: bind the signature to a single transition.

The backend should reject timestamps outside a short clock-skew window and store
recent nonces per signer when replay resistance is required for production
payout flows.

## Maintainer Key Configuration

Two environment variables are supported:

- `MAINTAINER_PUBLIC_KEYS`: comma-separated list of allowed Stellar public keys.
- `MAINTAINER_PUBLIC_KEY`: legacy single-key fallback.

`MAINTAINER_PUBLIC_KEYS` takes precedence. This allows key rotation and
multi-maintainer deployments without changing route code:

```env
MAINTAINER_PUBLIC_KEYS=GAAAA...,GBBBB...,GCCCC...
```

During rotation, deploy the new key alongside the old key, confirm signed
requests work with the new key, then remove the old key in a follow-up deploy.

## Consequences

Benefits:

- The server never needs a Stellar private key or seed phrase.
- Authorization is bound to the Stellar account recorded for the maintainer.
- Multi-key operation and rotation are handled through configuration.
- The same approach can later align with Freighter or Soroban transaction
  signing flows.

Trade-offs:

- Clients must be able to sign exact request payloads.
- Replay protection must be designed into each protected action payload.
- JWTs or sessions may still be useful for non-wallet user preferences, but they
  should not replace signature checks for maintainer payout authority.
