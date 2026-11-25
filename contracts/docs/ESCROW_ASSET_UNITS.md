# Escrow asset accounting boundaries (#1910)

## Defined result

A bounty is denominated by its stored `(token, amount)` pair. `amount` is an
integer in that token contract's smallest units, not a display amount or a
universal seven-decimal quantity. The board does not rescale amounts using
`decimals()`. Asset identity is the token contract address, not its name/symbol.

For example, `12_345_671` units of a 7-decimal token represent `1.2345671`,
while `1_234_567` units of a 6-decimal token represent `1.234567`. Funding stores
and transfers those exact integers. Clients must convert display amounts to
base units before submitting them; the configured minimum and hard maximum
also apply in raw units, not equivalent economic value across assets.

## Conservation and isolation

- Funding debits the maintainer and credits the board by exactly `amount` in
  the selected allowlisted token. Another token's balance cannot fund it.
- Reserve/submit move no units. Open, reserved, submitted, disputed and expired
  bounties retain their full per-bounty obligation until settlement.
- Release transfers `floor(amount * fee_bps / 10_000)` units to the fee recipient
  and the remainder to the contributor, both in the stored token. The fee is
  deducted from the escrow, not added to it; no fractional base units exist.
- A valid expiry refund transfers the full amount back to the maintainer in
  the stored token, with no fee. Duplicate settlement is rejected.
- Settling one bounty leaves other assets and other bounties in the same asset
  intact. A token's aggregate vault balance may cover many bounties and is not
  the balance of a single bounty. Unsolicited transfers or arbitration bonds
  must not be treated as additional bounty funding.
- Failed funding leaves all balances and the next bounty ID unchanged.

The [escrow accounting event](ESCROW_ACCOUNTING_EVENTS.md) uses the same token
address and base-unit integers. Funding is `delta = amount`, `previous = 0`,
`remaining = amount`; settlement is `delta = -amount`, `previous = amount`,
`remaining = 0`. Neither decimal conversion nor an extra fee debit belongs in
an indexer's reconstruction.

## Verification and existing work

PRs #1996 and #2009 already cover multi-asset accounting and authorization;
#1997 added committed escrow events. Their fixtures use Stellar Asset Contracts,
which report seven decimals even when comments describe a six-decimal asset.
The focused `escrow_asset_units` suite uses test-only token contracts exposing
actual 7- and 6-decimal metadata and asserts that metadata before testing
non-round funding, fee rounding, refunds, and insufficient-balance rollback.
It checks stored bounty amounts, token balances, and committed accounting events.
Authorization is mocked for these accounting tests; the existing authority tests
remain responsible for signer boundaries. No live network or funds are used.

```sh
cd contracts
cargo test --locked --test escrow_asset_units
```

This specifies and tests existing contract behavior; it changes no public ABI,
storage layout, token support policy, or transfer implementation. The token
fixture is deliberately minimal and is not a deployable production token.
