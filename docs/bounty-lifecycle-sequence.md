# Bounty Lifecycle — Sequence Diagram

\`\`\`mermaid
sequenceDiagram
    participant C as Creator
    participant BB as Bounty Board
    participant S as Stellar
    participant SC as Soroban Contract
    participant Sub as Submitter

    C->>BB: Create Bounty
    BB->>S: Lock funds in escrow
    S-->>BB: Confirmed
    BB->>C: Bounty published

    Sub->>BB: Submit work
    BB->>C: Notify: submission received
    C->>BB: Approve submission
    BB->>SC: Release payment
    SC->>S: Transfer funds to Submitter
    S-->>SC: Confirmed
    SC-->>BB: Payment released
    BB->>Sub: Bounty completed

    alt Dispute raised
        Sub->>BB: Raise dispute
        BB->>C: Notify dispute
        C->>BB: Respond to dispute
        BB->>SC: Escalate to contract
        SC-->>BB: Resolution
        BB->>Sub: Dispute resolved
    end
\`\`\`

## States

- **Open**: Bounty created, awaiting submissions
- **In Review**: Submission received, under review
- **Approved**: Creator approved the submission
- **Completed**: Payment released, bounty closed
- **Disputed**: Dispute raised by either party
- **Cancelled**: Bounty cancelled, funds returned
