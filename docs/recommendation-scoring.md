# Recommendation Engine Scoring

## Overview

The recommendation engine (`frontend/src/recommendations.ts`) suggests bounties
to contributors based on their skill tags and past activity.

## Scoring Algorithm

Each bounty is scored against the contributor's profile:

| Factor      | Weight | Description                                      |
| ----------- | ------ | ------------------------------------------------ |
| Skill match | 40%    | Bounty tags overlap with contributor skills      |
| Amount fit  | 25%    | Bounty amount within contributor's typical range |
| Recency     | 20%    | Bounties posted recently score higher            |
| Status      | 15%    | Open bounties preferred over reserved/submitted  |

## Score calculation

```
score = (skill_overlap / total_tags) * 0.4
      + (1 - |amount - median_amount| / median_amount) * 0.25
      + (1 / (1 + age_in_days / 7)) * 0.2
      + (status === 'open' ? 1 : 0.5) * 0.15
```

## Skill matching

- Tags are matched case-insensitively
- Partial tag matches count (e.g., "react" matches "react-native")
- Match count is normalized by total tags on the bounty

## Tuning

The weights above are defaults. To adjust:

1. Edit `frontend/src/recommendations.ts`
2. Update the weights in the `scoreBounty` function
3. Run `npm --prefix frontend test` to verify recommendation tests pass

<!-- Documented: 2026-10-01 — per issue #1171 -->
