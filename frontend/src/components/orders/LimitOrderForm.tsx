import React, { useState, useCallback, useEffect, useRef, type FormEvent } from 'react';
import { ArrowUpDown, Clock, Loader2, Tag, Timer, Trash2, TrendingUp, XCircle } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type OrderSide = 'buy' | 'sell';

export type OrderStatus = 'open' | 'filled' | 'cancelled' | 'expired';

export interface LimitOrder {
  id: string;
  pair: string;
  side: OrderSide;
  targetPrice: number;
  amount: number;
  status: OrderStatus;
  expiryHours: number;
  createdAt: number;
}

export interface LimitOrderFormProps {
  spotPrice: number;
  pair: string;
  side: OrderSide;
  onSubmitOrder: (order: {
    targetPrice: number;
    amount: number;
    expiryHours: number;
    side: OrderSide;
  }) => Promise<void>;
  onCancelOrder: (orderId: string) => Promise<void>;
  orders: LimitOrder[];
  ordersLoading: boolean;
  ordersError: string | null;
}

/* ------------------------------------------------------------------ */
/*  Presets                                                           */
/* ------------------------------------------------------------------ */

interface PricePreset {
  label: string;
  value: number;
}

const PRESETS_ABOVE: PricePreset[] = [
  { label: '+1%', value: 0.01 },
  { label: '+5%', value: 0.05 },
  { label: '+10%', value: 0.1 },
];

const PRESETS_BELOW: PricePreset[] = [
  { label: '−1%', value: -0.01 },
  { label: '−5%', value: -0.05 },
  { label: '−10%', value: -0.1 },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const STATUS_LABELS: Record<OrderStatus, string> = {
  open: 'Open',
  filled: 'Filled',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

function truncateId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function FieldError({ message, id }: { message: string; id?: string }) {
  return (
    <span className="field-error" id={id} role="alert">
      {message}
    </span>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <span className="field-hint">{children}</span>;
}

function SkeletonRow() {
  return (
    <tr className="lo-table__row lo-table__row--skeleton" aria-hidden="true">
      <td className="lo-table__cell">
        <span className="skeleton-block" style={{ width: 80, height: 14 }} />
      </td>
      <td className="lo-table__cell">
        <span className="skeleton-block" style={{ width: 60, height: 14 }} />
      </td>
      <td className="lo-table__cell">
        <span className="skeleton-block" style={{ width: 50, height: 14 }} />
      </td>
      <td className="lo-table__cell">
        <span className="skeleton-block" style={{ width: 70, height: 14 }} />
      </td>
      <td className="lo-table__cell">
        <span className="skeleton-block" style={{ width: 50, height: 14 }} />
      </td>
      <td className="lo-table__cell">
        <span className="skeleton-block" style={{ width: 64, height: 24, borderRadius: 999 }} />
      </td>
      <td className="lo-table__cell">
        <span className="skeleton-block" style={{ width: 60, height: 14 }} />
      </td>
      <td className="lo-table__cell">
        <span className="skeleton-block" style={{ width: 100, height: 14 }} />
      </td>
      <td className="lo-table__cell">
        <span className="skeleton-block" style={{ width: 72, height: 32, borderRadius: 999 }} />
      </td>
    </tr>
  );
}

function statusPillClass(status: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    open: 'status-pill--open',
    filled: 'status-pill--released',
    cancelled: 'status-pill--refunded',
    expired: 'status-pill--expired',
  };
  return `status-pill ${map[status]}`;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

export default function LimitOrderForm({
  spotPrice,
  pair,
  side,
  onSubmitOrder,
  onCancelOrder,
  orders,
  ordersLoading,
  ordersError,
}: LimitOrderFormProps) {
  /* ---- form state ---- */
  const [targetPrice, setTargetPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [expiryHours, setExpiryHours] = useState('24');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelErrorId, setCancelErrorId] = useState<string | null>(null);

  /* ---- auto-dismiss success ---- */
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (successMessage) {
      successTimerRef.current = setTimeout(() => setSuccessMessage(null), 3000);
    }
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, [successMessage]);

  /* ---- derived ---- */
  const safeSpotPrice = Number.isFinite(spotPrice) ? spotPrice : 0;
  const targetPriceNum = parseFloat(targetPrice);
  const amountNum = parseFloat(amount);
  const expiryHoursNum = parseInt(expiryHours, 10);

  const canSubmit =
    targetPrice.trim() !== '' &&
    amount.trim() !== '' &&
    expiryHours.trim() !== '' &&
    Number.isFinite(targetPriceNum) &&
    targetPriceNum > 0 &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    Number.isFinite(expiryHoursNum) &&
    expiryHoursNum >= 1 &&
    !submitting;

  const targetPriceInvalid =
    targetPrice !== '' && (!Number.isFinite(targetPriceNum) || targetPriceNum <= 0);
  const amountInvalid = amount !== '' && (!Number.isFinite(amountNum) || amountNum <= 0);
  const expiryInvalid =
    expiryHours !== '' && (!Number.isFinite(expiryHoursNum) || expiryHoursNum < 1);

  /* ---- handlers ---- */
  const applyPreset = useCallback(
    (preset: PricePreset) => {
      const newPrice = safeSpotPrice * (1 + preset.value);
      setTargetPrice(newPrice.toFixed(6));
      setSelectedPreset(preset.label);
      setFormError(null);
    },
    [spotPrice]
  );

  const handleTargetPriceChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTargetPrice(e.target.value);
    setSelectedPreset(null);
    setFormError(null);
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setFormError(null);
      setSuccessMessage(null);

      const errs: string[] = [];
      if (!Number.isFinite(targetPriceNum) || targetPriceNum <= 0)
        errs.push('Target price must be a positive number.');
      if (!Number.isFinite(amountNum) || amountNum <= 0)
        errs.push('Amount must be a positive number.');
      if (!Number.isFinite(expiryHoursNum) || expiryHoursNum < 1)
        errs.push('Expiry window must be at least 1 hour.');

      if (errs.length > 0) {
        setFormError(errs.join(' '));
        return;
      }

      setSubmitting(true);
      try {
        await onSubmitOrder({
          targetPrice: targetPriceNum,
          amount: amountNum,
          expiryHours: expiryHoursNum,
          side,
        });
        setTargetPrice('');
        setAmount('');
        setExpiryHours('24');
        setSelectedPreset(null);
        setSuccessMessage('Limit order placed successfully.');
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Failed to place order.');
      } finally {
        setSubmitting(false);
      }
    },
    [targetPriceNum, amountNum, expiryHoursNum, side, onSubmitOrder]
  );

  const handleCancel = useCallback(
    async (orderId: string) => {
      setCancellingId(orderId);
      setCancelErrorId(null);
      try {
        await onCancelOrder(orderId);
      } catch {
        setCancelErrorId(orderId);
      } finally {
        setCancellingId(null);
      }
    },
    [onCancelOrder]
  );

  /* ---- render helpers ---- */
  const renderPresetButton = (p: PricePreset) => {
    const active = selectedPreset === p.label;
    return (
      <button
        key={p.label}
        type="button"
        className={`filter-chip${active ? ' filter-chip--active' : ''}`}
        onClick={() => applyPreset(p)}
        aria-pressed={active}
      >
        {p.label}
      </button>
    );
  };

  const renderOrdersTable = () => {
    if (ordersLoading) {
      return (
        <div className="lo-table__wrapper">
          <table className="lo-table" aria-label="Loading limit orders">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Pair</th>
                <th>Side</th>
                <th>Price</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Expiry</th>
                <th>Created</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3].map((i) => (
                <SkeletonRow key={i} />
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (ordersError) {
      return (
        <div className="lo-error error-banner" role="alert">
          <XCircle size={18} aria-hidden="true" />
          <span>{ordersError}</span>
        </div>
      );
    }

    if (orders.length === 0) {
      return (
        <div className="empty-state empty-state--board" role="status">
          <TrendingUp className="empty-state__icon" aria-hidden="true" size={36} />
          <h3 className="empty-state__heading">No active limit orders</h3>
          <p className="empty-state__message">
            Place a limit order using the form above to get started.
          </p>
        </div>
      );
    }

    return (
      <div className="lo-table__wrapper">
        <table className="lo-table" aria-label="Active limit orders">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Pair</th>
              <th>Side</th>
              <th>Price</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Expiry</th>
              <th>Created</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const isCancelling = cancellingId === order.id;
              return (
                <tr key={order.id} className="lo-table__row">
                  <td
                    className="lo-table__cell lo-table__cell--mono"
                    data-label="Order ID"
                    title={order.id}
                  >
                    {truncateId(order.id)}
                  </td>
                  <td className="lo-table__cell" data-label="Pair">
                    {order.pair}
                  </td>
                  <td className="lo-table__cell" data-label="Side">
                    <span
                      className={`chip${order.side === 'buy' ? ' status-pill--open' : ' status-pill--refunded'}`}
                    >
                      {order.side.toUpperCase()}
                    </span>
                  </td>
                  <td className="lo-table__cell lo-table__cell--mono" data-label="Price">
                    {order.targetPrice.toFixed(6)}
                  </td>
                  <td className="lo-table__cell" data-label="Amount">
                    {order.amount.toLocaleString()}
                  </td>
                  <td className="lo-table__cell" data-label="Status">
                    <span className={statusPillClass(order.status)}>
                      {STATUS_LABELS[order.status]}
                    </span>
                  </td>
                  <td className="lo-table__cell lo-table__cell--muted" data-label="Expiry">
                    <span className="lo-inline-icon">
                      <Clock size={12} aria-hidden="true" />
                      {order.expiryHours}h
                    </span>
                  </td>
                  <td className="lo-table__cell lo-table__cell--muted" data-label="Created">
                    {formatDate(order.createdAt)}
                  </td>
                  <td className="lo-table__cell" data-label="Actions">
                    {order.status === 'open' ? (
                      <div className="lo-cancel-cell">
                        <button
                          type="button"
                          className="ghost-button lo-cancel-btn"
                          onClick={() => handleCancel(order.id)}
                          disabled={isCancelling}
                          aria-label={`Cancel order ${truncateId(order.id)}`}
                        >
                          {isCancelling ? (
                            <Loader2 size={14} className="lo-spinner" aria-hidden="true" />
                          ) : (
                            <Trash2 size={14} aria-hidden="true" />
                          )}
                          <span>{isCancelling ? 'Cancelling…' : 'Cancel'}</span>
                        </button>
                        {cancelErrorId === order.id && (
                          <span className="field-error" role="alert">
                            Failed to cancel. Try again.
                          </span>
                        )}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  /* ---- main render ---- */
  return (
    <section className="lo-shell" aria-labelledby="lo-heading">
      {/* ── Header ── */}
      <div className="lo-header">
        <h2 id="lo-heading" className="lo-heading">
          <ArrowUpDown size={22} aria-hidden="true" />
          Limit Orders
        </h2>
        <p className="lo-subtitle">
          Place on-chain limit orders for <strong>{pair}</strong> ({side.toUpperCase()} side).
          <br />
          <span className="lo-spot-label">
            Current spot: <strong>{safeSpotPrice.toFixed(6)}</strong>
          </span>
        </p>
      </div>

      {/* ── Form ── */}
      <form
        className="panel lo-form"
        onSubmit={handleSubmit}
        noValidate
        aria-label="Place limit order"
      >
        {/* Side display */}
        <div className="lo-side-badge">
          <span className={`amount-chip`}>
            {side.toUpperCase()} {pair}
          </span>
        </div>

        {/* Target price */}
        <div className="lo-form__field">
          <label htmlFor="lo-target-price">
            <Tag size={14} aria-hidden="true" />
            Target Price
          </label>
          <input
            id="lo-target-price"
            type="text"
            inputMode="decimal"
            placeholder="0.000000"
            value={targetPrice}
            onChange={handleTargetPriceChange}
            aria-invalid={targetPriceInvalid}
            aria-describedby={targetPriceInvalid ? 'lo-target-price-error' : undefined}
            autoComplete="off"
          />
          <FieldHint>Price per unit in quote asset</FieldHint>
          {targetPriceInvalid && (
            <FieldError message="Enter a positive target price." id="lo-target-price-error" />
          )}
        </div>

        {/* Price presets */}
        <fieldset className="lo-presets">
          <legend className="lo-presets__legend">Quick set from spot</legend>
          <div className="lo-presets__group">
            <span className="lo-presets__label">Above market</span>
            <div className="lo-presets__row">{PRESETS_ABOVE.map(renderPresetButton)}</div>
          </div>
          <div className="lo-presets__group">
            <span className="lo-presets__label">Below market</span>
            <div className="lo-presets__row">{PRESETS_BELOW.map(renderPresetButton)}</div>
          </div>
        </fieldset>

        {/* Amount + Expiry */}
        <div className="two-up">
          <div className="lo-form__field">
            <label htmlFor="lo-amount">Amount</label>
            <input
              id="lo-amount"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setFormError(null);
              }}
              aria-invalid={amountInvalid}
              aria-describedby={amountInvalid ? 'lo-amount-error' : undefined}
              autoComplete="off"
            />
            <FieldHint>Quantity of base asset</FieldHint>
            {amountInvalid && (
              <FieldError message="Enter a positive amount." id="lo-amount-error" />
            )}
          </div>
          <div className="lo-form__field">
            <label htmlFor="lo-expiry">
              <Timer size={14} aria-hidden="true" />
              Expiry Window (hours)
            </label>
            <input
              id="lo-expiry"
              type="number"
              min="1"
              step="1"
              placeholder="24"
              value={expiryHours}
              onChange={(e) => {
                setExpiryHours(e.target.value);
                setFormError(null);
              }}
              aria-invalid={expiryInvalid}
              aria-describedby={expiryInvalid ? 'lo-expiry-error' : undefined}
            />
            <FieldHint>Order cancelled after this period</FieldHint>
            {expiryInvalid && (
              <FieldError message="Expiry must be at least 1 hour." id="lo-expiry-error" />
            )}
          </div>
        </div>

        {/* Feedback */}
        {formError && (
          <div className="error-banner lo-form__error" role="alert">
            {formError}
          </div>
        )}
        {successMessage && (
          <div className="active-range lo-form__success" role="status" aria-live="polite">
            {successMessage}
          </div>
        )}

        {/* Submit */}
        <div className="lo-form__actions">
          <button
            type="submit"
            className="primary-button"
            disabled={!canSubmit}
            aria-busy={submitting}
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="lo-spinner" aria-hidden="true" /> Placing Order…
              </>
            ) : (
              'Place Limit Order'
            )}
          </button>
        </div>
      </form>

      {/* ── Active Orders ── */}
      <div className="lo-orders-section">
        <h3 className="lo-orders-heading">
          <Clock size={18} aria-hidden="true" />
          Active Orders
          {!ordersLoading && orders.length > 0 && <span className="chip">{orders.length}</span>}
        </h3>
        {renderOrdersTable()}
      </div>
    </section>
  );
}
