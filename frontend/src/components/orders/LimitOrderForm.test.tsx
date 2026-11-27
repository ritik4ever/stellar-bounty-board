import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';

import LimitOrderForm, { type LimitOrder, type LimitOrderFormProps } from './LimitOrderForm';

const SPOT = 0.125;
const PAIR = 'XLM/USDC';

function makeOrders(): LimitOrder[] {
  return [
    {
      id: 'LO-abc123def456',
      pair: PAIR,
      side: 'buy',
      targetPrice: 0.13125,
      amount: 500,
      status: 'open',
      expiryHours: 24,
      createdAt: 1_700_000_000,
    },
    {
      id: 'LO-xyz789ghi012',
      pair: PAIR,
      side: 'sell',
      targetPrice: 0.11875,
      amount: 200,
      status: 'filled',
      expiryHours: 48,
      createdAt: 1_699_900_000,
    },
  ];
}

function props(overrides: Partial<LimitOrderFormProps> = {}): LimitOrderFormProps {
  return {
    spotPrice: SPOT,
    pair: PAIR,
    side: 'buy',
    onSubmitOrder: vi.fn().mockResolvedValue(undefined),
    onCancelOrder: vi.fn().mockResolvedValue(undefined),
    orders: [],
    ordersLoading: false,
    ordersError: null,
    ...overrides,
  };
}

describe('rendering', () => {
  it('renders heading, pair, spot price, inputs, presets, submit', () => {
    render(<LimitOrderForm {...props()} />);
    expect(screen.getAllByText(/XLM\/USDC/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/0\.125000/)).toBeInTheDocument();
    expect(screen.getByLabelText(/target price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/expiry/i)).toBeInTheDocument();
    for (const l of ['+1%', '+5%', '+10%', '−1%', '−5%', '−10%'])
      expect(screen.getByRole('button', { name: l })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /place limit order/i })).toBeInTheDocument();
    expect(screen.getAllByText(/BUY/).length).toBeGreaterThanOrEqual(1);
  });
});

describe('validation', () => {
  it('disables submit when empty', () => {
    render(<LimitOrderForm {...props()} />);
    expect(screen.getByRole('button', { name: /place limit order/i })).toBeDisabled();
  });

  it('shows error for non-positive price', async () => {
    const u = userEvent.setup();
    render(<LimitOrderForm {...props()} />);
    await u.type(screen.getByLabelText(/target price/i), '-5');
    await u.tab();
    expect(screen.getByText(/enter a positive target price/i)).toBeInTheDocument();
  });

  it('shows error for non-positive amount', async () => {
    const u = userEvent.setup();
    render(<LimitOrderForm {...props()} />);
    await u.type(screen.getByLabelText(/amount/i), '0');
    await u.tab();
    expect(screen.getByText(/enter a positive amount/i)).toBeInTheDocument();
  });

  it('shows error for invalid expiry', async () => {
    const u = userEvent.setup();
    render(<LimitOrderForm {...props()} />);
    const inp = screen.getByLabelText(/expiry/i);
    await u.clear(inp);
    await u.type(inp, '0');
    await u.tab();
    expect(screen.getByText(/expiry must be at least 1 hour/i)).toBeInTheDocument();
  });

  it('shows form error on invalid submit', async () => {
    const u = userEvent.setup();
    render(<LimitOrderForm {...props()} />);
    await u.type(screen.getByLabelText(/target price/i), '0');
    await u.type(screen.getByLabelText(/amount/i), '100');
    await u.clear(screen.getByLabelText(/expiry/i));
    await u.type(screen.getByLabelText(/expiry/i), '0');
    await u.click(screen.getByRole('button', { name: /place limit order/i }));
    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    });
  });
});

describe('presets', () => {
  it('sets +1%, +5%, +10%, −1%, −5%, −10%', async () => {
    const u = userEvent.setup();
    render(<LimitOrderForm {...props()} />);
    const tests: [string, number][] = [
      ['+1%', 0.12625],
      ['+5%', 0.13125],
      ['+10%', 0.1375],
      ['−1%', 0.12375],
      ['−5%', 0.11875],
      ['−10%', 0.1125],
    ];
    for (const [l, v] of tests) {
      await u.click(screen.getByRole('button', { name: l }));
      expect(
        Number((screen.getByLabelText(/target price/i) as HTMLInputElement).value)
      ).toBeCloseTo(v, 4);
      expect(screen.getByRole('button', { name: l })).toHaveAttribute('aria-pressed', 'true');
    }
  });

  it('clears preset on manual edit', async () => {
    const u = userEvent.setup();
    render(<LimitOrderForm {...props()} />);
    await u.click(screen.getByRole('button', { name: '+5%' }));
    expect(screen.getByRole('button', { name: '+5%' })).toHaveAttribute('aria-pressed', 'true');
    const inp = screen.getByLabelText(/target price/i);
    await u.clear(inp);
    await u.type(inp, '0.15');
    expect(screen.getByRole('button', { name: '+5%' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('submit', () => {
  it('calls onSubmit and resets form', async () => {
    const u = userEvent.setup();
    const fn = vi.fn().mockResolvedValue(undefined);
    render(<LimitOrderForm {...props({ onSubmitOrder: fn })} />);
    await u.type(screen.getByLabelText(/target price/i), '0.15');
    await u.type(screen.getByLabelText(/amount/i), '1000');
    await u.click(screen.getByRole('button', { name: /place limit order/i }));
    await waitFor(() =>
      expect(fn).toHaveBeenCalledWith({
        targetPrice: 0.15,
        amount: 1000,
        expiryHours: 24,
        side: 'buy',
      })
    );
    await waitFor(() =>
      expect((screen.getByLabelText(/target price/i) as HTMLInputElement).value).toBe('')
    );
  });

  it('shows error on rejection', async () => {
    const u = userEvent.setup();
    const fn = vi.fn().mockRejectedValue(new Error('Insufficient'));
    render(<LimitOrderForm {...props({ onSubmitOrder: fn })} />);
    await u.type(screen.getByLabelText(/target price/i), '0.15');
    await u.type(screen.getByLabelText(/amount/i), '1000');
    await u.click(screen.getByRole('button', { name: /place limit order/i }));
    await waitFor(() => expect(screen.getByText(/insufficient/i)).toBeInTheDocument());
  });

  it('disables while submitting', async () => {
    const u = userEvent.setup();
    const fn = vi.fn().mockImplementation(() => new Promise<void>(() => {}));
    render(<LimitOrderForm {...props({ onSubmitOrder: fn })} />);
    await u.type(screen.getByLabelText(/target price/i), '0.15');
    await u.type(screen.getByLabelText(/amount/i), '1000');
    await u.click(screen.getByRole('button', { name: /place limit order/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /placing order/i })).toBeDisabled()
    );
  });
});

describe('orders table', () => {
  it('renders rows', () => {
    render(<LimitOrderForm {...props({ orders: makeOrders() })} />);
    expect(screen.getByRole('table', { name: /active limit orders/i })).toBeInTheDocument();
    expect(screen.getByText('LO-abc...f456')).toBeInTheDocument();
    expect(screen.getByText('LO-xyz...i012')).toBeInTheDocument();
  });

  it('shows count and cancel button only for open', () => {
    render(<LimitOrderForm {...props({ orders: makeOrders() })} />);
    expect(
      within(screen.getByText(/active orders/i).closest('h3')!).getByText('2')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel order LO-abc...f456/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /cancel order LO-xyz...i012/i })
    ).not.toBeInTheDocument();
  });

  it('empty state', () => {
    render(<LimitOrderForm {...props()} />);
    expect(screen.getByText(/no active limit orders/i)).toBeInTheDocument();
  });

  it('loading state', () => {
    render(<LimitOrderForm {...props({ ordersLoading: true })} />);
    expect(screen.getByRole('table', { name: /loading limit orders/i })).toBeInTheDocument();
  });

  it('error state', () => {
    render(<LimitOrderForm {...props({ ordersError: 'Fetch failed.' })} />);
    expect(screen.getByText(/fetch failed/i)).toBeInTheDocument();
  });
});

describe('cancel', () => {
  it('calls onCancelOrder', async () => {
    const u = userEvent.setup();
    const fn = vi.fn().mockResolvedValue(undefined);
    render(<LimitOrderForm {...props({ orders: makeOrders(), onCancelOrder: fn })} />);
    await u.click(screen.getByRole('button', { name: /cancel order LO-abc...f456/i }));
    expect(fn).toHaveBeenCalledWith('LO-abc123def456');
  });

  it('shows cancelling state', async () => {
    const u = userEvent.setup();
    const fn = vi.fn().mockImplementation(() => new Promise<void>(() => {}));
    render(<LimitOrderForm {...props({ orders: makeOrders(), onCancelOrder: fn })} />);
    await u.click(screen.getByRole('button', { name: /cancel order LO-abc...f456/i }));
    await waitFor(() => expect(screen.getByText(/cancelling/i)).toBeInTheDocument());
  });

  it('shows error on cancel failure', async () => {
    const u = userEvent.setup();
    const fn = vi.fn().mockRejectedValue(new Error('Err'));
    render(<LimitOrderForm {...props({ orders: makeOrders(), onCancelOrder: fn })} />);
    await u.click(screen.getByRole('button', { name: /cancel order LO-abc...f456/i }));
    await waitFor(() => expect(screen.getByText(/failed to cancel/i)).toBeInTheDocument());
  });

  it('no cancel for non-open orders', () => {
    const ords: LimitOrder[] = [
      {
        id: 'a',
        pair: PAIR,
        side: 'buy',
        targetPrice: 0.1,
        amount: 1,
        status: 'filled',
        expiryHours: 1,
        createdAt: 1,
      },
      {
        id: 'b',
        pair: PAIR,
        side: 'sell',
        targetPrice: 0.1,
        amount: 1,
        status: 'cancelled',
        expiryHours: 1,
        createdAt: 1,
      },
      {
        id: 'c',
        pair: PAIR,
        side: 'buy',
        targetPrice: 0.1,
        amount: 1,
        status: 'expired',
        expiryHours: 1,
        createdAt: 1,
      },
    ];
    render(<LimitOrderForm {...props({ orders: ords })} />);
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });
});

describe('a11y', () => {
  it('axe: default', async () => {
    const { container } = render(<LimitOrderForm {...props()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
  it('axe: orders', async () => {
    const { container } = render(<LimitOrderForm {...props({ orders: makeOrders() })} />);
    expect(await axe(container)).toHaveNoViolations();
  });
  it('axe: loading', async () => {
    const { container } = render(<LimitOrderForm {...props({ ordersLoading: true })} />);
    expect(await axe(container)).toHaveNoViolations();
  });
  it('labels', () => {
    render(<LimitOrderForm {...props()} />);
    expect(screen.getByLabelText(/target price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
  });
  it('aria-pressed', async () => {
    const u = userEvent.setup();
    render(<LimitOrderForm {...props()} />);
    const b = screen.getByRole('button', { name: '+5%' });
    expect(b).toHaveAttribute('aria-pressed', 'false');
    await u.click(b);
    expect(b).toHaveAttribute('aria-pressed', 'true');
  });
});
