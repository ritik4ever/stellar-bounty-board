import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { xlmToUsd, resetXlmToUsdCache } from './utils';

describe('xlmToUsd', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetXlmToUsdCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the XLM/USD rate and formats the amount', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.124 } }),
    });

    await expect(xlmToUsd(100)).resolves.toBe('$12.40');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd',
      { signal: expect.any(AbortSignal) },
    );
  });

  it('caches the fetched rate for subsequent conversions', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.2 } }),
    });

    await expect(xlmToUsd(10)).resolves.toBe('$2.00');
    await expect(xlmToUsd(25)).resolves.toBe('$5.00');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back gracefully when the rate fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('network unavailable'));

    await expect(xlmToUsd(100)).resolves.toBe('USD unavailable');
  });
});
