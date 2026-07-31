# API Authentication: SEP-10 and JWT

This guide describes the planned Stellar wallet authentication flow for the
Stellar Bounty Board API.

## Implementation status

> **Important:** The SEP-10 authentication endpoints and JWT session middleware
> are being implemented separately under issues
> [#778](https://github.com/ritik4ever/stellar-bounty-board/issues/778) and
> [#779](https://github.com/ritik4ever/stellar-bounty-board/issues/779).
>
> Until those backend changes are merged, the authentication endpoints described
> below are not available on the default branch. The examples document the
> intended API flow and must be verified against the final backend implementation
> before being used in production.

The authentication process has four stages:

1. Request a SEP-10 challenge transaction for a Stellar account.
2. Sign the challenge using the wallet that controls that account.
3. Submit the signed challenge to the API.
4. Use the returned JWT as a Bearer token on authenticated requests.

The private key is never sent to the API. Authentication proves account control
by verifying the wallet signature on the challenge transaction.

## Prerequisites

The examples assume:

- The backend is running at `http://localhost:3001`.
- `curl` is installed.
- `jq` is installed for reading JSON responses.
- A Stellar wallet controls the account being authenticated.
- The wallet or Stellar SDK can sign the returned SEP-10 transaction XDR.

Set the base URL and public account:

```bash
export API_BASE_URL="http://localhost:3001"
export STELLAR_ACCOUNT="GYOUR_STELLAR_PUBLIC_KEY"
```
