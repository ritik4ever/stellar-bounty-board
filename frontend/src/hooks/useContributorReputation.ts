import { useEffect, useState } from 'react';

import { getContributorReputation } from '../api';
import type { ContributorReputation } from '../types';

const STELLAR_PUBLIC_KEY = /^G[A-Z0-9]{55}$/;

/**
 * Fetch the reputation for a contributor address (#1459).
 *
 * Only well-formed Stellar public keys trigger a request, so a partially typed
 * address (or an empty field) never produces a spurious lookup. Failures are
 * swallowed and resolve to `null` — reputation is a nice-to-have hint and must
 * never block the reservation/submission flow.
 */
export function useContributorReputation(address?: string | null): {
  reputation: ContributorReputation | null;
  loading: boolean;
} {
  const [reputation, setReputation] = useState<ContributorReputation | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = (address ?? '').trim();

    if (!STELLAR_PUBLIC_KEY.test(trimmed)) {
      setReputation(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setLoading(true);

    void getContributorReputation(trimmed, controller.signal)
      .then((data) => {
        if (active) setReputation(data);
      })
      .catch(() => {
        if (active) setReputation(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [address]);

  return { reputation, loading };
}
