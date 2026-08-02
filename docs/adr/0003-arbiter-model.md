---
title: 0003 - Arbiter model (single vs committee)
date: 2026-07-25
status: accepted
---

# ADR 0003: Single-arbiter model for dispute resolution

## Context / Problem

The Soroban bounty contract needs an authority to resolve disputes when a
maintainer and contributor cannot agree on whether submitted work satisfies the
bounty requirements. The initial implementation uses a single address
(`DataKey::Arbiter`) that is set once during `initialize` and is immutable for
the lifetime of the contract.

As the project matures, the team must consider whether a single arbiter is
sufficient or whether a multi-arbiter committee is more appropriate for
fairness, liveness, and decentralisation goals.

## Options considered

### 1. Single arbiter (current)

A single Stellar address is designated as the arbiter during contract
initialization. This address is the sole entity authorised to call
`resolve_dispute` on-chain.

**Advantages:**

- **Simplicity** — no quorum logic, no vote aggregation, no leader election.
- **Gas efficiency** — a single call resolves the dispute; no multi-sig or
  threshold-signature overhead.
- **Fast finality** — resolution is as fast as a single Soroban transaction.
- **Immutable by design** — the arbiter address cannot be changed after
  `initialize`, which avoids governance attacks on the arbiter set.

**Disadvantages:**

- **Single point of failure** — if the arbiter key is lost or compromised, no
  dispute can ever be resolved (and a compromised key can resolve every dispute
  unfairly).
- **No redundancy** — if the arbiter is unavailable (offline, unresponsive),
  disputes stall indefinitely.
- **No checks or balances** — the arbiter acts alone with no oversight or
  appeal mechanism; a malicious or mistaken arbiter decision is final.
- **Key rotation requires redeployment** — rotating the arbiter address
  requires deploying a new contract and migrating state.

### 2. Multi-arbiter committee (future proposal)

A fixed set of N arbiters, where resolution requires a threshold signature or
an on-chain vote reaching quorum (e.g., M-of-N). Referred to in this document
as the _multi-arbiter committee feature_.

**Advantages:**

- **Fault tolerance** — the committee can tolerate M−1 unavailable or
  compromised members.
- **Fairness through diversity** — multiple perspectives reduce the risk of
  biased or erroneous resolutions.
- **Key rotation without redeployment** — individual committee members can be
  replaced by updating the committee set via contract governance.

**Disadvantages:**

- **Contract complexity** — quorum logic, vote tallying, and member-set
  management increase the attack surface and audit burden.
- **Higher gas cost** — each dispute requires N signed submissions and an
  on-chain aggregation round, increasing fees.
- **Slower resolution** — the committee must coordinate off-chain to reach
  consensus before the on-chain transaction can be submitted.
- **Coordination overhead** — committee members need a secure off-chain channel
  to discuss evidence and form consensus.

### 3. Single arbiter with appeal window (current + existing feature)

The current contract already implements a _dispute window_ — a mandatory
cooldown (`DisputeWindow`) between when a dispute is raised and when the
arbiter can resolve it. This is a lightweight check that gives both parties
time to present evidence but does **not** create a second level of review
(appeal).

A future _appeal-window feature_ could extend this by allowing either party to
flag a resolution for committee review within a fixed window after the arbiter
rules. This would combine the speed of a single arbiter with a safety valve
against bad decisions.

**Advantages:**

- Preserves single-arbiter speed for the common case.
- Adds a safety net for contested resolutions without on-chain complexity in
  the hot path.
- The existing `DisputeWindow` infrastructure (timestamp-based cooldown) can be
  repurposed as the trigger for the appeal window.

**Disadvantages:**

- Still requires a committee (or human operator) to review appeals — shifts
  complexity off-chain rather than removing it.
- Adds state tracking for appeal status (is the resolution under appeal? has
  the appeal window expired?).
- The finality of a resolution is delayed until the appeal window closes.

## Decision

Adopt the **single-arbiter model** for the MVP and near-term production use.

The multi-arbiter committee and appeal-window features are explicitly deferred
— they are captured as design probes that should be revisited when specific
conditions are met (see _When to revisit_ below).

## Rationale

- **MVP velocity** — the single-arbiter model required the least contract
  changes and keeps the dispute flow simple enough to reason about and test.
  Contracts are small and auditable.
- **Operational pragmatism** — in the near term, the arbiter is operated by the
  project team. A single well-guarded key is acceptable while trust is
  centralized.
- **Existing dispute window mitigates rush** — the configurable
  `DisputeWindow` (default 10 minutes in tests) prevents the arbiter from
  resolving instantly, giving the contributor time to ensure their evidence is
  on-chain before a decision is made.
- **Gas cost sensitivity** — Soroban transaction fees are paid by the contract
  caller. Keeping resolution as a single `require_auth` call minimizes the cost
  to resolve disputes, which encourages timely resolutions.
- **Later iterations can layer on complexity** — the contract can be replaced
  (via redeployment) when a committee or appeal mechanism is needed, without
  breaking the interface for maintainers and contributors.

## Consequences

- **Key security is critical** — loss or compromise of the arbiter private key
  is unrecoverable without contract redeployment. The team MUST follow the
  key-management practices in SECURITY.md.
- **No on-chain accountability** — a single arbiter resolution carries no
  multi-party audit trail. Off-chain logging in the backend (`bountyStore`
  audit log) provides the only record of the decision.
- **Redeployment for arbiter change** — rotating the arbiter address or
  migrating to a committee model requires a new contract and a state migration
  plan.
- **Future compatibility** — the `dispute_raised_at` timestamp and
  `DisputeWindow` fields are already on the `Bounty` struct, which is
  compatible with an appeal-window extension since the same fields can anchor
  appeal timing.

## Related

- **Implementation:** `contracts/src/lib.rs` — `DataKey::Arbiter`,
  `dispute_bounty()`, `resolve_dispute()`
- **Backend dispute route:** `backend/src/app.ts` — `POST
/api/bounties/:id/dispute`
- **Environment configuration:** `.env.example` — `ARBITER_ADDRESS`
- **Multi-arbiter committee feature proposal** — tracked for future
  consideration when the conditions below are met
- **Appeal-window feature** — a natural extension of the existing
  `DisputeWindow` mechanism; see the _When to revisit_ section for triggers

## Known limitations

- Single-arbiter mode is inappropriate for a fully trustless, permissionless
  marketplace. It assumes the arbiter is honest and available.
- There is no mechanism to challenge or reverse a resolution once the
  `resolve_dispute` transaction is confirmed on-chain.
- The backend emits a notification on dispute but does not have a dedicated
  endpoint for the arbiter to view pending disputes or evidence — that is
  handled off-chain.

## When to revisit

The team should revisit the multi-arbiter committee or appeal-window model when
any of the following conditions are met:

1. **Arbiter key incident** — a lost, compromised, or leaked arbiter key
   triggers an emergency redeployment. At that point a committee model should
   be evaluated as part of the recovery.
2. **Uncontested unfair ruling** — a dispute resolution produces credible
   external complaints of unfairness that the single arbiter cannot address.
3. **Scaling to untrusted operators** — the project is adopted by a third party
   that does not have a direct relationship with the current arbiter operator.
   A committee distributes trust across multiple independent entities.
4. **User demand for appeal** — maintainers or contributors consistently
   request a right to appeal arbiter decisions. The appeal-window feature is
   the lighter-weight path and should be evaluated before a full committee.
5. **Regulatory or compliance requirement** — a jurisdiction or partner
   requires multi-party dispute resolution as a condition of use.

---

This ADR is referenced from the ADR index in `docs/adr/`.
