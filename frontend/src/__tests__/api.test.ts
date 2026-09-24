/**
 * @jest-environment jsdom
 */
import { fetchBounties, createBounty, updateBounty, deleteBounty } from '../api';
import { Bounty } from '../types';

describe('api.ts', () => {
  const mockFetch = global.fetch as jest.Mock;

  beforeEach(() => {
    mockFetch.mockClear();
  });

  // ---------- fetchBounties ----------
  it('fetchBounties returns data on success', async () => {
    const mockData: Bounty[] = [
      { id: '1', title: 'Test Bounty', status: 'open' },
      { id: '2', title: 'Another Bounty', status: 'closed' },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    const result = await fetchBounties();

    expect(mockFetch).toHaveBeenCalledWith('/api/bounties', { method: 'GET' });
    expect(result).toEqual(mockData);
  });

  it('fetchBounties throws error on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Internal Server Error' }),
    });

    await expect(fetchBounties()).rejects.toThrow('Failed to fetch bounties');
  });

  it('fetchBounties throws error when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(fetchBounties()).rejects.toThrow('Network error');
  });

  // ---------- createBounty ----------
  it('createBounty sends POST and returns created bounty', async () => {
    const newBounty = { title: 'New Bounty', amount: 100 };
    const createdBounty: Bounty = { id: '3', title: 'New Bounty', status: 'open', amount: 100 };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => createdBounty,
    });

    const result = await createBounty(newBounty);

    expect(mockFetch).toHaveBeenCalledWith('/api/bounties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newBounty),
    });
    expect(result).toEqual(createdBounty);
  });

  it('createBounty throws error on non-ok response', async () => {
    const newBounty = { title: 'New Bounty', amount: 100 };

    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'Bad Request' }),
    });

    await expect(createBounty(newBounty)).rejects.toThrow('Bad Request');
  });

  it('createBounty throws error when fetch throws', async () => {
    const newBounty = { title: 'New Bounty', amount: 100 };

    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(createBounty(newBounty)).rejects.toThrow('Network error');
  });

  // ---------- updateBounty ----------
  it('updateBounty sends PUT and returns updated bounty', async () => {
    const updates = { status: 'closed' };
    const updatedBounty: Bounty = { id: '1', title: 'Test Bounty', status: 'closed', amount: 100 };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => updatedBounty,
    });

    const result = await updateBounty('1', updates);

    expect(mockFetch).toHaveBeenCalledWith('/api/bounties/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    expect(result).toEqual(updatedBounty);
  });

  it('updateBounty throws error on non-ok response', async () => {
    const updates = { status: 'closed' };

    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'Not Found' }),
    });

    await expect(updateBounty('999', updates)).rejects.toThrow('Not Found');
  });

  it('updateBounty throws error when fetch throws', async () => {
    const updates = { status: 'closed' };

    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(updateBounty('1', updates)).rejects.toThrow('Network error');
  });

  // ---------- deleteBounty ----------
  it('deleteBounty sends DELETE and resolves on success', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await expect(deleteBounty('1')).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledWith('/api/bounties/1', { method: 'DELETE' });
  });

  it('deleteBounty throws error on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'Forbidden' }),
    });

    await expect(deleteBounty('1')).rejects.toThrow('Forbidden');
  });

  it('deleteBounty throws error when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(deleteBounty('1')).rejects.toThrow('Network error');
  });
});
