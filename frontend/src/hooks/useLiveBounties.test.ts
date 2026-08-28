import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLiveBounties } from './useLiveBounties';
import { bountyService } from '../services/bountyService';

// Mock the bounty service
vi.mock('../services/bountyService', () => ({
  bountyService: {
    getAllBounties: vi.fn(),
    subscribeToStatusUpdates: vi.fn(),
    connectWebSocket: vi.fn(),
  },
}));

describe('useLiveBounties', () => {
  const mockBounties = [
    {
      id: '1',
      title: 'Bounty 1',
      description: 'Description 1',
      amount: '100',
      status: 'open' as const,
      creator: '0x123',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (bountyService.getAllBounties as any).mockResolvedValue(mockBounties);
  });

  it('should fetch bounties on mount', async () => {
    const { result } = renderHook(() => useLiveBounties({ enabled: false }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.bounties).toEqual(mockBounties);
    expect(bountyService.getAllBounties).toHaveBeenCalled();
  });

  it('should return loading state initially', () => {
    const { result } = renderHook(() => useLiveBounties({ enabled: false }));

    expect(result.current.isLoading).toBe(true);
  });

  it('should handle error state', async () => {
    (bountyService.getAllBounties as any).mockRejectedValue(new Error('Failed to fetch'));

    const { result } = renderHook(() => useLiveBounties({ enabled: false }));

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('should attempt to connect to SSE when enabled', () => {
    const mockEventSource = {
      addEventListener: vi.fn(),
      close: vi.fn(),
    };
    (bountyService.subscribeToStatusUpdates as any).mockReturnValue(mockEventSource);

    renderHook(() => useLiveBounties({ enabled: true }));

    expect(bountyService.subscribeToStatusUpdates).toHaveBeenCalled();
  });

  it('should fallback to polling when SSE fails', async () => {
    (bountyService.subscribeToStatusUpdates as any).mockImplementation(() => {
      throw new Error('SSE connection failed');
    });

    const { result } = renderHook(() => useLiveBounties({ enabled: true }));

    await waitFor(() => {
      expect(result.current.isLive).toBe(false);
      expect(result.current.isPolling).toBe(true);
    });
  });

  it('should refetch manually', async () => {
    const { result } = renderHook(() => useLiveBounties({ enabled: false }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    (bountyService.getAllBounties as any).mockClear();

    await act(async () => {
      await result.current.refetch();
    });

    expect(bountyService.getAllBounties).toHaveBeenCalled();
  });
});
