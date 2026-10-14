# Bounty Status State Machine

```mermaid
stateDiagram-v2
    [*] --> Open
    Open --> Assigned: /attempt
    Assigned --> InProgress: Work started
    InProgress --> Submitted: PR created
    Submitted --> InReview: /approve
    InReview --> Approved: Review passed
    InReview --> ChangesRequested: Review failed
    ChangesRequested --> Submitted: Updated
    Approved --> Completed: Payment released
    Approved --> Disputed: Dispute raised
    Disputed --> Resolved: Resolution
    Completed --> [*]
    Open --> Cancelled: Cancelled
    Assigned --> Open: Unassigned
    Resolved --> [*]
```

## Status Descriptions

| Status | Description |
|--------|-------------|
| Open | Bounty available for claiming |
| Assigned | Contributor claimed via /attempt |
| InProgress | Work in progress |
| Submitted | PR submitted for review |
| InReview | Maintainer is reviewing |
| Approved | Submission approved |
| Completed | Payment sent, done |
| Disputed | Conflict raised |
| Resolved | Dispute resolved |
| Cancelled | Bounty cancelled |
