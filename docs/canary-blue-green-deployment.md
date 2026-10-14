# Backend Canary and Blue-Green Deployment Strategy

## Purpose

This document defines the intended progressive-delivery strategy for the Stellar Bounty Board backend.

It combines:

- **blue-green deployment**, where the current stable backend remains available as the blue environment while a candidate release is deployed as green; and
- **canary rollout**, where a controlled percentage of production traffic is gradually directed to green.

The objective is to detect health, error-rate, latency, configuration, and data-store failures before all production traffic reaches a new backend release.

The accompanying workflow is:

```text
.github/workflows/canary-deployment.yml
```
