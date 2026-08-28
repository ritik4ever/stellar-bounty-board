import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useXBull, isXBullInstalled } from './useXBull';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type MockXBullSDK = {
  getAddress: ReturnType<typeof vi.fn>;
  signMessage: ReturnType<typeof vi.fn>;
};

function mockXBullSDK(overrides?: Partial<MockXBullSDK>): MockXBullSDK {
  return {
    getAddress: vi.fn().mockResolvedValue({ address: 'GBULLPUBLICKEY1234567890ABCDEFGHIJK' }),
    signMessage: vi.fn().mockResolvedValue({
      signedMessage: 'signed-abc',
      signerAddress: 'GBULLPUBLICKEY1234567890ABCDEFGHIJK',
    }),
    ...overrides,
  };
}

function installXBull(sdk: MockXBullSDK) {
  (window as any).xBullSDK = sdk;
}

function uninstallXBull() {
  delete (window as any).xBullSDK;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('isXBullInstalled', () => {
  afterEach(uninstallXBull);

  it('returns false when window.xBullSDK is absent', () => {
    uninstallXBull();
    expect(isXBullInstalled()).toBe(false);
  });

  it('returns true when window.xBullSDK is present', () => {
    installXBull(mockXBullSDK());
    expect(isXBullInstalled()).toBe(true);
  });
});

describe('useXBull – not installed', () => {
  beforeEach(uninstallXBull);
  afterEach(uninstallXBull);

  it('starts disconnected with a NO_XBULL error', () => {
    const { result } = renderHook(() => useXBull());
    expect(result.current.isConnected).toBe(false);
    expect(result.current.publicKey).toBeNull();
    expect(result.current.error?.code).toBe('NO_XBULL');
  });

  it('connect() sets NO_XBULL error without throwing', async () => {
    const { result } = renderHook(() => useXBull());
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.isConnected).toBe(false);
    expect(result.current.error?.code).toBe('NO_XBULL');
  });

  it('signPayload() rejects with NO_XBULL error', async () => {
    const { result } = renderHook(() => useXBull());
    await expect(
      result.current.signPayload({ bountyId: 'B1', action: 'release' })
    ).rejects.toMatchObject({ code: 'NO_XBULL' });
  });
});

describe('useXBull – installed, happy path', () => {
  let sdk: MockXBullSDK;

  beforeEach(() => {
    sdk = mockXBullSDK();
    installXBull(sdk);
  });

  afterEach(uninstallXBull);

  it('starts disconnected with no error', () => {
    const { result } = renderHook(() => useXBull());
    expect(result.current.isConnected).toBe(false);
    expect(result.current.publicKey).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('connect() sets publicKey and isConnected', async () => {
    const { result } = renderHook(() => useXBull());
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.isConnected).toBe(true);
    expect(result.current.publicKey).toBe('GBULLPUBLICKEY1234567890ABCDEFGHIJK');
    expect(result.current.error).toBeNull();
    expect(sdk.getAddress).toHaveBeenCalledOnce();
  });

  it('disconnect() resets state', async () => {
    const { result } = renderHook(() => useXBull());
    await act(async () => {
      await result.current.connect();
    });
    act(() => {
      result.current.disconnect();
    });
    expect(result.current.isConnected).toBe(false);
    expect(result.current.publicKey).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('signPayload() calls signMessage and returns signature + publicKey', async () => {
    const { result } = renderHook(() => useXBull());
    await act(async () => {
      await result.current.connect();
    });

    const payload = { bountyId: 'B1', action: 'release', timestamp: 1000 };
    const signed = await act(async () => result.current.signPayload(payload));

    expect(sdk.signMessage).toHaveBeenCalledWith(JSON.stringify(payload));
    expect(signed).toEqual({
      signature: 'signed-abc',
      publicKey: 'GBULLPUBLICKEY1234567890ABCDEFGHIJK',
    });
  });
});

describe('useXBull – installed, error cases', () => {
  afterEach(uninstallXBull);

  it('connect() sets USER_REJECTED when user cancels', async () => {
    installXBull(
      mockXBullSDK({
        getAddress: vi.fn().mockRejectedValue(new Error('User rejected the request')),
      })
    );
    const { result } = renderHook(() => useXBull());
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.isConnected).toBe(false);
    expect(result.current.error?.code).toBe('USER_REJECTED');
  });

  it('connect() sets NOT_CONNECTED on generic error', async () => {
    installXBull(
      mockXBullSDK({
        getAddress: vi.fn().mockRejectedValue(new Error('Something went wrong')),
      })
    );
    const { result } = renderHook(() => useXBull());
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.isConnected).toBe(false);
    expect(result.current.error?.code).toBe('NOT_CONNECTED');
  });

  it('connect() sets NOT_CONNECTED when getAddress returns no address', async () => {
    installXBull(
      mockXBullSDK({
        getAddress: vi.fn().mockResolvedValue({ address: '' }),
      })
    );
    const { result } = renderHook(() => useXBull());
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.isConnected).toBe(false);
    expect(result.current.error?.code).toBe('NOT_CONNECTED');
  });

  it('signPayload() rejects with USER_REJECTED when user cancels signing', async () => {
    const sdk = mockXBullSDK({
      signMessage: vi.fn().mockRejectedValue(new Error('User canceled the signing')),
    });
    installXBull(sdk);
    const { result } = renderHook(() => useXBull());

    // Connect first
    await act(async () => {
      await result.current.connect();
    });

    await expect(
      act(async () => result.current.signPayload({ action: 'release' }))
    ).rejects.toMatchObject({ code: 'USER_REJECTED' });
  });

  it('signPayload() rejects with NOT_CONNECTED if called without connecting', async () => {
    installXBull(mockXBullSDK());
    const { result } = renderHook(() => useXBull());

    await expect(
      act(async () => result.current.signPayload({ action: 'release' }))
    ).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });

  it('signPayload() rejects with SIGNING_FAILED on unknown error', async () => {
    const sdk = mockXBullSDK({
      signMessage: vi.fn().mockRejectedValue(new Error('Network timeout')),
    });
    installXBull(sdk);
    const { result } = renderHook(() => useXBull());

    await act(async () => {
      await result.current.connect();
    });

    await expect(
      act(async () => result.current.signPayload({ action: 'release' }))
    ).rejects.toMatchObject({ code: 'SIGNING_FAILED' });
  });
});

describe('useXBull – connecting state', () => {
  afterEach(uninstallXBull);

  it('sets connecting=true while getAddress is pending', async () => {
    let resolveGetAddress!: (value: { address: string }) => void;
    const sdk = mockXBullSDK({
      getAddress: vi.fn(
        () =>
          new Promise<{ address: string }>((res) => {
            resolveGetAddress = res;
          })
      ),
    });
    installXBull(sdk);
    const { result } = renderHook(() => useXBull());

    // Start connect without awaiting
    let connectPromise: Promise<void>;
    act(() => {
      connectPromise = result.current.connect();
    });

    expect(result.current.connecting).toBe(true);

    await act(async () => {
      resolveGetAddress({ address: 'GBULLPUBLICKEY1234567890ABCDEFGHIJK' });
      await connectPromise!;
    });

    expect(result.current.connecting).toBe(false);
  });
});
