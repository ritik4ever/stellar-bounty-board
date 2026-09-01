import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CurrencyAmount from './CurrencyAmount';
import CurrencySelector from './CurrencySelector';
import { CurrencyProvider } from './CurrencyContext';
import { CURRENCY_STORAGE_KEY, resetCurrencyRatesCache } from './currency';

vi.mock('./utils', async () => {
  const actual = await vi.importActual<typeof import('./utils')>('./utils');
  return {
    ...actual,
    // 10 XLM at $0.12 is $1.20, which keeps the expected figures readable.
    xlmToUsdValue: vi.fn().mockResolvedValue(1.2),
  };
});

const RATES = { USD: 1, EUR: 0.5, NGN: 1500 };

function mockRatesOk() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: 'success', rates: RATES }),
    }),
  );
}

function mockRatesFailure() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
}

/** The app shell: a selector and an amount sharing one provider. */
function Board({ amount = 10, tokenSymbol = 'XLM' }: { amount?: number; tokenSymbol?: string }) {
  return (
    <CurrencyProvider>
      <CurrencySelector />
      <CurrencyAmount amount={amount} tokenSymbol={tokenSymbol} />
    </CurrencyProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetCurrencyRatesCache();
  mockRatesOk();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  resetCurrencyRatesCache();
});

describe('CurrencyAmount', () => {
  it('defaults to USD', async () => {
    render(<Board />);
    await waitFor(() => expect(screen.getByText('($1.20)')).toBeInTheDocument());
  });

  it('converts USDC without a token price lookup', async () => {
    render(<Board amount={100} tokenSymbol="USDC" />);
    await waitFor(() => expect(screen.getByText('($100.00)')).toBeInTheDocument());
  });

  it('renders nothing for a token with no price feed', async () => {
    const { container } = render(<Board amount={5} tokenSymbol="FOO" />);
    await waitFor(() => expect(container.querySelector('.usd-amount')).toBeNull());
  });
});

describe('switching currency', () => {
  it('updates the displayed amount', async () => {
    const user = userEvent.setup();
    render(<Board />);

    await waitFor(() => expect(screen.getByText('($1.20)')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Display currency'), 'EUR');

    await waitFor(() => expect(screen.getByText('(€0.60)')).toBeInTheDocument());
    expect(screen.queryByText('($1.20)')).not.toBeInTheDocument();
  });

  it('updates every amount on the page at once', async () => {
    const user = userEvent.setup();
    render(
      <CurrencyProvider>
        <CurrencySelector />
        <CurrencyAmount amount={10} tokenSymbol="XLM" />
        <CurrencyAmount amount={100} tokenSymbol="USDC" />
      </CurrencyProvider>,
    );

    await waitFor(() => expect(screen.getByText('($1.20)')).toBeInTheDocument());
    expect(screen.getByText('($100.00)')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Display currency'), 'EUR');

    await waitFor(() => expect(screen.getByText('(€0.60)')).toBeInTheDocument());
    expect(screen.getByText('(€50.00)')).toBeInTheDocument();
  });
});

describe('persistence', () => {
  it('writes the choice to localStorage', async () => {
    const user = userEvent.setup();
    render(<Board />);

    await waitFor(() => expect(screen.getByText('($1.20)')).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Display currency'), 'EUR');

    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(CURRENCY_STORAGE_KEY)!)).toBe('EUR'));
  });

  it('restores the choice on a fresh mount, as a reload would', async () => {
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, JSON.stringify('EUR'));

    render(<Board />);

    await waitFor(() => expect(screen.getByText('(€0.60)')).toBeInTheDocument());
    expect((screen.getByLabelText('Display currency') as HTMLSelectElement).value).toBe('EUR');
  });

  it('ignores a stored currency that is no longer offered', async () => {
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, JSON.stringify('XYZ'));

    render(<Board />);

    await waitFor(() => expect(screen.getByText('($1.20)')).toBeInTheDocument());
  });
});

describe('rate lookup failure', () => {
  it('falls back to USD without breaking the page', async () => {
    mockRatesFailure();
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, JSON.stringify('EUR'));

    render(<Board />);

    // The stored preference is EUR, but with no rates the amount still renders,
    // in USD, rather than erroring or hanging on the loading state.
    await waitFor(() => expect(screen.getByText('($1.20)')).toBeInTheDocument());
  });

  it('hides the selector when no rates are available', async () => {
    mockRatesFailure();

    render(<Board />);

    await waitFor(() => expect(screen.getByText('($1.20)')).toBeInTheDocument());
    expect(screen.queryByLabelText('Display currency')).not.toBeInTheDocument();
  });

  it('falls back to USD when the response is missing the chosen currency', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: 'success', rates: { USD: 1 } }),
      }),
    );
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, JSON.stringify('EUR'));

    render(<Board />);

    await waitFor(() => expect(screen.getByText('($1.20)')).toBeInTheDocument());
  });
});

describe('rate caching', () => {
  it('fetches rates once for many amounts', async () => {
    render(
      <CurrencyProvider>
        <CurrencyAmount amount={10} tokenSymbol="XLM" />
        <CurrencyAmount amount={20} tokenSymbol="XLM" />
        <CurrencyAmount amount={30} tokenSymbol="XLM" />
      </CurrencyProvider>,
    );

    await waitFor(() => expect(screen.getAllByText('($1.20)').length).toBe(3));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
