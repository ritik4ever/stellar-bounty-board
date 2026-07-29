import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';

import LimitOrderForm, { type LimitOrder, type LimitOrderFormProps } from './LimitOrderForm';

/* ------------------------------------------------------------------ */
/*  Fixtures                                                          */
/* ------------------------------------------------------------------ */

const SPOT_PRICE = 0.125;
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

function defaultProps(overrides: Partial<LimitOrderFormProps> = {}): LimitOrderFormProps {
  return {
    spotPrice: SPOT_PRICE,
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

/* ------------------------------------------------------------------ */
/*  Rendering                                                         */
/* ------------------------------------------------------------------ */

describe('LimitOrderForm rendering', () => {
  it('renders heading with pair and spot price', () => {
    render(<LimitOrderForm {...defaultProps()} />);

    expect(screen.getAllByRole('heading', { name: /limit orders/i }).length).toBeGreaterThanOrEqual(
      1
    );
    expect(screen.getAllByText(/XLM\/USDC/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/0\.125000/)).toBeInTheDocument();
  });

  it('renders target price, amount, and expiry inputs', () => {
    render(<LimitOrderForm {...defaultProps()} />);

    expect(screen.getByLabelText(/target price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/expiry window/i)).toBeInTheDocument();
  });

  it('renders all six price preset buttons', () => {
    render(<LimitOrderForm {...defaultProps()} />);

    for (const label of ['+1%', '+5%', '+10%', '−1%', '−5%', '−10%']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('renders the submit button', () => {
    render(<LimitOrderForm {...defaultProps()} />);
    expect(screen.getByRole('button', { name: /place limit order/i })).toBeInTheDocument();
  });

  it('shows side badge (BUY/SELL)', () => {
    const { rerender } = render(<LimitOrderForm {...defaultProps({ side: 'buy' })} />);
    expect(screen.getAllByText(/BUY/).length).toBeGreaterThanOrEqual(1);

    rerender(<LimitOrderForm {...defaultProps({ side: 'sell' })} />);
    expect(screen.getAllByText(/SELL/).length).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Validation                                                        */
/* ------------------------------------------------------------------ */

describe('LimitOrderForm validation', () => {
  it('disables submit when form is empty', () => {
    render(<LimitOrderForm {...defaultProps()} />);
    expect(screen.getByRole('button', { name: /place limit order/i })).toBeDisabled();
  });

  it('shows error for non-positive target price', async () => {
    const user = userEvent.setup();
    render(<LimitOrderForm {...defaultProps()} />);

    const input = screen.getByLabelText(/target price/i);
    await user.type(input, '-5');
    await user.tab();

    expect(screen.getByText(/enter a positive target price/i)).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows error for non-positive amount', async () => {
    const user = userEvent.setup();
    render(<LimitOrderForm {...defaultProps()} />);

    const input = screen.getByLabelText(/amount/i);
    await user.type(input, '0');
    await user.tab();

    expect(screen.getByText(/enter a positive amount/i)).toBeInTheDocument();
  });

  it('shows error for zero expiry', async () => {
    const user = userEvent.setup();
    render(<LimitOrderForm {...defaultProps()} />);

    const input = screen.getByLabelText(/expiry window/i);
    await user.clear(input);
    await user.type(input, '0');
    await user.tab();

    expect(screen.getByText(/expiry must be at least 1 hour/i)).toBeInTheDocument();
  });

  it('shows form error banner on submit with invalid data', async () => {
    const user = userEvent.setup();
    render(<LimitOrderForm {...defaultProps()} />);

    await user.type(screen.getByLabelText(/target price/i), '0');
    await user.type(screen.getByLabelText(/amount/i), '100');
    await user.clear(screen.getByLabelText(/expiry window/i));
    await user.type(screen.getByLabelText(/expiry window/i), '0');

    await user.click(screen.getByRole('button', { name: /place limit order/i }));

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert');
      expect(alerts.length).toBeGreaterThan(0);
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Price presets                                                     */
/* ------------------------------------------------------------------ */

describe('LimitOrderForm price presets', () => {
  it('sets target price to +1% of spot', async () => {
    const user = userEvent.setup();
    render(<LimitOrderForm {...defaultProps()} />);

    await user.click(screen.getByRole('button', { name: '+1%' }));

    const input = screen.getByLabelText(/target price/i) as HTMLInputElement;
    expect(Number(input.value)).toBeCloseTo(0.12625, 4);
    expect(screen.getByRole('button', { name: '+1%' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sets target price to +5% of spot', async () => {
    const user = userEvent.setup();
    render(<LimitOrderForm {...defaultProps()} />);
    await user.click(screen.getByRole('button', { name: '+5%' }));
    expect(Number((screen.getByLabelText(/target price/i) as HTMLInputElement).value)).toBeCloseTo(
      0.13125,
      4
    );
  });

  it('sets target price to −10% of spot', async () => {
    const user = userEvent.setup();
    render(<LimitOrderForm {...defaultProps()} />);
    await user.click(screen.getByRole('button', { name: '−10%' }));
    expect(Number((screen.getByLabelText(/target price/i) as HTMLInputElement).value)).toBeCloseTo(
      0.1125,
      4
    );
  });

  it('clears preset selection when user types manually', async () => {
    const user = userEvent.setup();
    render(<LimitOrderForm {...defaultProps()} />);

    await user.click(screen.getByRole('button', { name: '+5%' }));
    expect(screen.getByRole('button', { name: '+5%' })).toHaveAttribute('aria-pressed', 'true');

    const input = screen.getByLabelText(/target price/i);
    await user.clear(input);
    await user.type(input, '0.15');

    expect(screen.getByRole('button', { name: '+5%' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows sell badge when side prop is sell', () => {
    render(<LimitOrderForm {...defaultProps({ side: 'sell' })} />);
    expect(screen.getAllByText(/SELL/).length).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Submit flow                                                       */
/* ------------------------------------------------------------------ */

describe('LimitOrderForm submit flow', () => {
  it('calls onSubmitOrder with correct values and resets form', async () => {
    const user = userEvent.setup();
    const onSubmitOrder = vi.fn().mockResolvedValue(undefined);
    render(<LimitOrderForm {...defaultProps({ onSubmitOrder })} />);

    await user.type(screen.getByLabelText(/target price/i), '0.15');
    await user.type(screen.getByLabelText(/amount/i), '1000');

    await user.click(screen.getByRole('button', { name: /place limit order/i }));

    await waitFor(() => {
      expect(onSubmitOrder).toHaveBeenCalledWith({
        targetPrice: 0.15,
        amount: 1000,
        expiryHours: 24,
        side: 'buy',
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/limit order placed successfully/i)).toBeInTheDocument();
    });
    expect((screen.getByLabelText(/target price/i) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/amount/i) as HTMLInputElement).value).toBe('');
  });

  it('shows error when onSubmitOrder rejects', async () => {
    const user = userEvent.setup();
    const onSubmitOrder = vi.fn().mockRejectedValue(new Error('Insufficient balance'));
    render(<LimitOrderForm {...defaultProps({ onSubmitOrder })} />);

    await user.type(screen.getByLabelText(/target price/i), '0.15');
    await user.type(screen.getByLabelText(/amount/i), '1000');
    await user.click(screen.getByRole('button', { name: /place limit order/i }));

    await waitFor(() => {
      expect(screen.getByText(/insufficient balance/i)).toBeInTheDocument();
    });
  });

  it('disables submit while processing', async () => {
    const user = userEvent.setup();
    const onSubmitOrder = vi.fn().mockImplementation(() => new Promise<void>(() => {}));
    render(<LimitOrderForm {...defaultProps({ onSubmitOrder })} />);

    await user.type(screen.getByLabelText(/target price/i), '0.15');
    await user.type(screen.getByLabelText(/amount/i), '1000');
    await user.click(screen.getByRole('button', { name: /place limit order/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /placing order/i })).toBeDisabled();
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Active orders table                                               */
/* ------------------------------------------------------------------ */

describe('LimitOrderForm active orders table', () => {
  it('renders order rows with all columns', () => {
    const orders = makeOrders();
    render(<LimitOrderForm {...defaultProps({ orders })} />);

    expect(screen.getByRole('table', { name: /active limit orders/i })).toBeInTheDocument();
    expect(screen.getByText('LO-abc...f456')).toBeInTheDocument();
    expect(screen.getByText('BUY')).toBeInTheDocument();
    expect(screen.getByText('SELL')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Filled')).toBeInTheDocument();
  });

  it('shows cancel button only for open orders', () => {
    render(<LimitOrderForm {...defaultProps({ orders: makeOrders() })} />);

    expect(screen.getByRole('button', { name: /cancel order LO-abc...f456/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /cancel order LO-xyz...i012/i })
    ).not.toBeInTheDocument();
  });

  it('shows order count in heading', () => {
    render(<LimitOrderForm {...defaultProps({ orders: makeOrders() })} />);
    const heading = screen.getByText(/active orders/i).closest('h3')!;
    expect(within(heading).getByText('2')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Empty state                                                       */
/* ------------------------------------------------------------------ */

describe('LimitOrderForm empty state', () => {
  it('shows empty message when no orders', () => {
    render(<LimitOrderForm {...defaultProps()} />);
    expect(screen.getByText(/no active limit orders/i)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Loading state                                                     */
/* ------------------------------------------------------------------ */

describe('LimitOrderForm loading state', () => {
  it('shows skeleton table while loading', () => {
    render(<LimitOrderForm {...defaultProps({ ordersLoading: true })} />);
    expect(screen.getByRole('table', { name: /loading limit orders/i })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Error state                                                       */
/* ------------------------------------------------------------------ */

describe('LimitOrderForm error state', () => {
  it('shows error banner when ordersError is set', () => {
    render(<LimitOrderForm {...defaultProps({ ordersError: 'Failed to fetch orders.' })} />);
    expect(screen.getByText(/failed to fetch orders/i)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Cancel order                                                      */
/* ------------------------------------------------------------------ */

describe('LimitOrderForm cancel order', () => {
  it('calls onCancelOrder with the correct order ID', async () => {
    const user = userEvent.setup();
    const onCancelOrder = vi.fn().mockResolvedValue(undefined);
    render(<LimitOrderForm {...defaultProps({ orders: makeOrders(), onCancelOrder })} />);

    await user.click(screen.getByRole('button', { name: /cancel order LO-abc...f456/i }));
    expect(onCancelOrder).toHaveBeenCalledWith('LO-abc123def456');
  });

  it('shows cancelling state during cancellation', async () => {
    const user = userEvent.setup();
    const onCancelOrder = vi.fn().mockImplementation(() => new Promise<void>(() => {}));
    render(<LimitOrderForm {...defaultProps({ orders: makeOrders(), onCancelOrder })} />);

    await user.click(screen.getByRole('button', { name: /cancel order LO-abc...f456/i }));

    await waitFor(() => {
      expect(screen.getByText(/cancelling/i)).toBeInTheDocument();
    });
  });

  it('shows error when cancel fails', async () => {
    const user = userEvent.setup();
    const onCancelOrder = vi.fn().mockRejectedValue(new Error('Network error'));
    render(<LimitOrderForm {...defaultProps({ orders: makeOrders(), onCancelOrder })} />);

    await user.click(screen.getByRole('button', { name: /cancel order LO-abc...f456/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to cancel/i)).toBeInTheDocument();
    });
  });

  it('does not render cancel button for non-open orders', () => {
    const orders: LimitOrder[] = [
      {
        id: 'LO-1',
        pair: PAIR,
        side: 'buy',
        targetPrice: 0.13,
        amount: 100,
        status: 'filled',
        expiryHours: 24,
        createdAt: 1,
      },
      {
        id: 'LO-2',
        pair: PAIR,
        side: 'sell',
        targetPrice: 0.12,
        amount: 50,
        status: 'cancelled',
        expiryHours: 24,
        createdAt: 1,
      },
      {
        id: 'LO-3',
        pair: PAIR,
        side: 'buy',
        targetPrice: 0.14,
        amount: 75,
        status: 'expired',
        expiryHours: 24,
        createdAt: 1,
      },
    ];
    render(<LimitOrderForm {...defaultProps({ orders })} />);
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Accessibility                                                     */
/* ------------------------------------------------------------------ */

describe('LimitOrderForm accessibility', () => {
  it('has no axe violations in default state', async () => {
    const { container } = render(<LimitOrderForm {...defaultProps()} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations with active orders', async () => {
    const { container } = render(<LimitOrderForm {...defaultProps({ orders: makeOrders() })} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations while loading', async () => {
    const { container } = render(<LimitOrderForm {...defaultProps({ ordersLoading: true })} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('form inputs have associated labels', () => {
    render(<LimitOrderForm {...defaultProps()} />);
    expect(screen.getByLabelText(/target price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/expiry window/i)).toBeInTheDocument();
  });

  it('preset buttons have aria-pressed', async () => {
    const user = userEvent.setup();
    render(<LimitOrderForm {...defaultProps()} />);

    const btn = screen.getByRole('button', { name: '+5%' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await user.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });
});
