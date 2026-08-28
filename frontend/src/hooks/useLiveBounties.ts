import { useEffect, useState, useRef, useCallback } from 'react';
import { Bounty, BountyStatusUpdate } from '../types/bounty';
import { bountyService } from '../services/bountyService';
import { usePolling } from './usePolling';

interface UseLiveBountiesOptions {
  /** Enable live updates (SSE/WebSocket) - default: true */
  enabled?: boolean;
  /** Fallback poll interval in milliseconds when live connection fails - default: 30000 */
  fallbackInterval?: number;
  /** Maximum reconnection attempts - default: 5 */
  maxRetries?: number;
  /** Initial backoff delay in milliseconds - default: 1000 */
  initialBackoff?: number;
  /** Maximum backoff delay in milliseconds - default: 30000 */
  maxBackoff?: number;
}

interface UseLiveBountiesResult {
  /** Array of bounties */
  bounties: Bounty[];
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Whether live connection is active */
  isLive: boolean;
  /** Manual refresh function */
  refetch: () => Promise<void>;
  /** Whether fallback polling is active */
  isPolling: boolean;
}

/**
 * Real-time bounties hook with automatic fallback to polling.
 *
 * Features:
 * - SSE/WebSocket live updates when available
 * - Automatic fallback to polling when live connection fails
 * - Exponential backoff for reconnection attempts
 * - Same data shape as usePolling for drop-in replacement
 * - Auto-reconnection with backoff
 *
 * @param options - Configuration options
 * @returns Bounties data and status
 */
export function useLiveBounties(options: UseLiveBountiesOptions = {}): UseLiveBountiesResult {
  const {
    enabled = true,
    fallbackInterval = 30000,
    maxRetries = 5,
    initialBackoff = 1000,
    maxBackoff = 30000,
  } = options;

  // State
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

  // Refs for managing connections
  const eventSourceRef = useRef<EventSource | null>(null);
  const wsSocketRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const fallbackTriggeredRef = useRef(false);

  // Fetch bounties function
  const fetchBounties = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await bountyService.getAllBounties();
      if (isMountedRef.current) {
        setBounties(data);
        setError(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err : new Error('Failed to fetch bounties'));
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Manual refetch
  const refetch = useCallback(async () => {
    await fetchBounties();
  }, [fetchBounties]);

  // Handle incoming status update
  const handleStatusUpdate = useCallback((update: BountyStatusUpdate) => {
    if (!isMountedRef.current) return;

    setBounties((prev) =>
      prev.map((bounty) =>
        bounty.id === update.bountyId
          ? { ...bounty, status: update.status, updatedAt: update.timestamp }
          : bounty
      )
    );
  }, []);

  // Calculate backoff delay
  const getBackoffDelay = useCallback(
    (attempt: number): number => {
      const delay = initialBackoff * Math.pow(2, attempt);
      return Math.min(delay, maxBackoff);
    },
    [initialBackoff, maxBackoff]
  );

  // Fallback to polling
  const fallbackToPolling = useCallback(() => {
    if (fallbackTriggeredRef.current) return;
    fallbackTriggeredRef.current = true;

    if (isMountedRef.current) {
      setIsLive(false);
      setIsPolling(true);
      setError(new Error('Live connection unavailable. Falling back to polling.'));
    }
  }, []);

  // Connect to SSE
  const connectSSE = useCallback(() => {
    if (!isMountedRef.current || !enabled) return;

    try {
      const eventSource = bountyService.subscribeToStatusUpdates(handleStatusUpdate, (event) => {
        // Handle SSE error
        console.warn('SSE connection error:', event);
        if (retryCountRef.current >= maxRetries) {
          eventSource.close();
          fallbackToPolling();
        }
      });

      eventSourceRef.current = eventSource;

      // When connection opens, reset retry count
      eventSource.addEventListener('open', () => {
        if (isMountedRef.current) {
          retryCountRef.current = 0;
          setIsLive(true);
          setIsPolling(false);
          fallbackTriggeredRef.current = false;
          setError(null);
        }
      });

      setIsLive(true);
    } catch (err) {
      console.error('Failed to connect SSE:', err);
      fallbackToPolling();
    }
  }, [enabled, handleStatusUpdate, maxRetries, fallbackToPolling]);

  // Connect to WebSocket (fallback if SSE fails)
  const connectWebSocket = useCallback(() => {
    if (!isMountedRef.current || !enabled) return;

    try {
      const socket = bountyService.connectWebSocket(
        (data) => {
          // Handle WebSocket messages
          if (data.type === 'bounty-status') {
            handleStatusUpdate(data.payload);
          } else if (data.type === 'bounty-update') {
            setBounties((prev) =>
              prev.map((bounty) => (bounty.id === data.bounty.id ? data.bounty : bounty))
            );
          }
        },
        () => {
          // Error handling
          if (retryCountRef.current >= maxRetries) {
            socket.close();
            fallbackToPolling();
          }
        },
        () => {
          // Close handling
          if (isMountedRef.current && !fallbackTriggeredRef.current) {
            attemptReconnect();
          }
        }
      );

      wsSocketRef.current = socket;
      setIsLive(true);
      setIsPolling(false);
      fallbackTriggeredRef.current = false;
    } catch (err) {
      console.error('Failed to connect WebSocket:', err);
      fallbackToPolling();
    }
  }, [enabled, handleStatusUpdate, maxRetries, fallbackToPolling]);

  // Attempt reconnection with backoff
  const attemptReconnect = useCallback(() => {
    if (!isMountedRef.current || fallbackTriggeredRef.current) return;

    if (retryCountRef.current >= maxRetries) {
      fallbackToPolling();
      return;
    }

    const delay = getBackoffDelay(retryCountRef.current);
    retryCountRef.current += 1;

    if (backoffTimerRef.current) {
      clearTimeout(backoffTimerRef.current);
    }

    backoffTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current || fallbackTriggeredRef.current) return;

      // Try SSE first, then WebSocket
      connectSSE();
    }, delay);
  }, [maxRetries, getBackoffDelay, fallbackToPolling, connectSSE]);

  // Cleanup connections
  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (wsSocketRef.current) {
      wsSocketRef.current.close();
      wsSocketRef.current = null;
    }
    if (backoffTimerRef.current) {
      clearTimeout(backoffTimerRef.current);
      backoffTimerRef.current = null;
    }
  }, []);

  // Use polling as fallback
  usePolling(
    () => {
      if (isPolling || (!isLive && !fallbackTriggeredRef.current)) {
        fetchBounties();
      }
    },
    isPolling ? fallbackInterval : undefined
  );

  // Initial fetch and connection setup
  useEffect(() => {
    isMountedRef.current = true;
    fetchBounties();

    if (enabled) {
      // Try SSE first
      connectSSE();
    }

    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, [enabled, fetchBounties, connectSSE, cleanup]);

  // Reconnect when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && isMountedRef.current && !isLive && !fallbackTriggeredRef.current) {
        attemptReconnect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isLive, attemptReconnect]);

  return {
    bounties,
    isLoading,
    error,
    isLive,
    isPolling,
    refetch,
  };
}
