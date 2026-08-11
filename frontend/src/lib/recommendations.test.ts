import { getRecommendedBounties } from './recommendations';
import type { Bounty } from '../types';

// Mock fetch or API calls
jest.mock('./recommendations', () => {
  const original = jest.requireActual('./recommendations');
  return {
    ...original,
    getCompletedBounties: jest.fn(),
    getOpenBounties: jest.fn(),
  };
});

const mockGetCompletedBounties = jest.fn();
const mockGetOpenBounties = jest.fn();

// Override the internal functions for testing
jest.mock('./recommendations', () => {
  return {
    getRecommendedBounties: jest.fn(),
  };
});

// We'll test the logic directly by re-importing and using jest.spyOn
import * as recommendationsModule from './recommendations';

describe('getRecommendedBounties', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty array when wallet is not connected', async () => {
    const result = await getRecommendedBounties(null);
    expect(result).toEqual([]);
  });

  it('returns empty array when wallet address is undefined', async () => {
    const result = await getRecommendedBounties(undefined);
    expect(result).toEqual([]);
  });

  it('falls back to highest-value bounties when user has no history', async () => {
    // Mock the internal functions
    jest.spyOn(recommendationsModule as any, 'getCompletedBounties').mockResolvedValue([]);
    jest.spyOn(recommendationsModule as any, 'getOpenBounties').mockResolvedValue([
      { id: '1', title: 'Low Value', value: 50, status: 'open', labels: [] },
      { id: '2', title: 'High Value', value: 200, status: 'open', labels: [] },
      { id: '3', title: 'Medium Value', value: 100, status: 'open', labels: [] },
      { id: '4', title: 'Highest Value', value: 300, status: 'open', labels: [] },
    ]);

    const result = await getRecommendedBounties('0x123');

    expect(result).toHaveLength(3);
    expect(result[0].value).toBe(300);
    expect(result[1].value).toBe(200);
    expect(result[2].value).toBe(100);
  });

  it('returns bounties matching user labels when history exists', async () => {
    jest.spyOn(recommendationsModule as any, 'getCompletedBounties').mockResolvedValue([
      { id: 'c1', title: 'Completed React', value: 100, status: 'completed', labels: ['react', 'frontend'] },
      { id: 'c2', title: 'Completed Python', value: 150, status: 'completed', labels: ['python', 'backend'] },
    ]);

    jest.spyOn(recommendationsModule as any, 'getOpenBounties').mockResolvedValue([
      { id: 'o1', title: 'React Task', value: 100, status: 'open', labels: ['react'] },
      { id: 'o2', title: 'Python Task', value: 200, status: 'open', labels: ['python'] },
      { id: 'o3', title: 'Rust Task', value: 300, status: 'open', labels: ['rust'] },
      { id: 'o4', title: 'Fullstack React+Python', value: 250, status: 'open', labels: ['react', 'python'] },
    ]);

    const result = await getRecommendedBounties('0x123');

    expect(result).toHaveLength(3);
    // Should prefer bounties with matching labels
    const resultIds = result.map((b) => b.id);
    expect(resultIds).toContain('o1');
    expect(resultIds).toContain('o2');
    expect(resultIds).toContain('o4');
    // Rust task should not be included (no matching labels)
    expect(resultIds).not.toContain('o3');
  });

  it('ranks bounties by number of matching labels', async () => {
    jest.spyOn(recommendationsModule as any, 'getCompletedBounties').mockResolvedValue([
      { id: 'c1', title: 'Completed React', value: 100, status: 'completed', labels: ['react', 'python', 'typescript'] },
    ]);

    jest.spyOn(recommendationsModule as any, 'getOpenBounties').mockResolvedValue([
      { id: 'o1', title: 'React Only', value: 100, status: 'open', labels: ['react'] },
      { id: 'o2', title: 'React+Python', value: 200, status: 'open', labels: ['react', 'python'] },
      { id: 'o3', title: 'React+Python+TS', value: 300, status: 'open', labels: ['react', 'python', 'typescript'] },
    ]);

    const result = await getRecommendedBounties('0x123');

    // Should be sorted by label match count (3 > 2 > 1)
    expect(result[0].id).toBe('o3');
    expect(result[1].id).toBe('o2');
    expect(result[2].id).toBe('o1');
  });

  it('handles single label match correctly', async () => {
    jest.spyOn(recommendationsModule as any, 'getCompletedBounties').mockResolvedValue([
      { id: 'c1', title: 'Completed React', value: 100, status: 'completed', labels: ['react'] },
    ]);

    jest.spyOn(recommendationsModule as any, 'getOpenBounties').mockResolvedValue([
      { id: 'o1', title: 'React Task', value: 100, status: 'open', labels: ['react'] },
      { id: 'o2', title: 'Python Task', value: 200, status: 'open', labels: ['python'] },
      { id: 'o3', title: 'Another React', value: 150, status: 'open', labels: ['react'] },
    ]);

    const result = await getRecommendedBounties('0x123');

    expect(result).toHaveLength(3);
    const resultIds = result.map((b) => b.id);
    expect(resultIds).toContain('o1');
    expect(resultIds).toContain('o3');
    // Python task may be included if there are fewer than 3 matching
    // But React tasks should be ranked higher
    const o1Index = resultIds.indexOf('o1');
    const o3Index = resultIds.indexOf('o3');
    const o2Index = resultIds.indexOf('o2');
    expect(o1Index).toBeLessThan(o2Index);
    expect(o3Index).toBeLessThan(o2Index);
  });
});
