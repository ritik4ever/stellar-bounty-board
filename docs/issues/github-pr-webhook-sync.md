# Sync Bounty Submissions From GitHub Pull Requests

Labels: `integration`, `github`, `help wanted`

## Summary

Add a webhook endpoint that listens for pull request events and updates reserved bounties into submitted state when a linked PR opens.

## Why It Matters

- Removes manual submission steps
- Makes the app feel native to contributor workflows
- Builds a stronger bridge between GitHub and Stellar payout rails

## Acceptance Criteria

- Backend accepts signed GitHub webhook requests
- PR URLs map to repo and issue metadata
- Matching reserved bounty becomes `submitted`
- Duplicate delivery handling is safe

