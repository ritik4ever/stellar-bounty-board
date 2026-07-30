import React, { useState, useCallback, type FormEvent } from 'react';
import { Clock, Loader2, Tag, Timer, Trash2, TrendingUp, XCircle } from 'lucide-react';

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
/*  Skeleton row                                                      */
/* ------------------------------------------------------------------ */

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
        <span className="skeleton-block" style={{ width: 40, height: 14 }} />
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
  const [targetPrice, setTargetPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [expiryHours, setExpiryHours] = useState('24');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelErrorId, setCancelErrorId] = useState<string | null>(null);

  const safeSpot = Number.isFinite(spotPrice) ? spotPrice : 0;
  const targetPriceNum = parseFloat(targetPrice);
  const amountNum = parseFloat(amount);
  const expiryNum = parseInt(expiryHours, 10);

  const tpInvalid = targetPrice !== '' && (!Number.isFinite(targetPriceNum) || targetPriceNum <= 0);
  const amtInvalid = amount !== '' && (!Number.isFinite(amountNum) || amountNum <= 0);
  const expInvalid = expiryHours !== '' && (!Number.isFinite(expiryNum) || expiryNum < 1);

  const canSubmit =
    targetPrice.trim() !== '' &&
    amount.trim() !== '' &&
    expiryHours.trim() !== '' &&
    Number.isFinite(targetPriceNum) &&
    targetPriceNum > 0 &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    Number.isFinite(expiryNum) &&
    expiryNum >= 1 &&
    !submitting;

  const applyPreset = useCallback(
    (p: PricePreset) => {
      setTargetPrice((safeSpot * (1 + p.value)).toFixed(6));
      setSelectedPreset(p.label);
      setFormError(null);
    },
    [safeSpot]
  );

  const handlePriceChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTargetPrice(e.target.value);
    setSelectedPreset(null);
    setFormError(null);
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setFormError(null);

      const errs: string[] = [];
      if (!Number.isFinite(targetPriceNum) || targetPriceNum <= 0)
        errs.push('Target price must be a positive number.');
      if (!Number.isFinite(amountNum) || amountNum <= 0)
        errs.push('Amount must be a positive number.');
      if (!Number.isFinite(expiryNum) || expiryNum < 1)
        errs.push('Expiry must be at least 1 hour.');

      if (errs.length > 0) {
        setFormError(errs.join(' '));
        return;
      }

      setSubmitting(true);
      try {
        await onSubmitOrder({
          targetPrice: targetPriceNum,
          amount: amountNum,
          expiryHours: expiryNum,
          side,
        });
        setTargetPrice('');
        setAmount('');
        setExpiryHours('24');
        setSelectedPreset(null);
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Failed to place order.');
      } finally {
        setSubmitting(false);
      }
    },
    [targetPriceNum, amountNum, expiryNum, side, onSubmitOrder]
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

  return (
    <section className="lo-shell">
      <div className="lo-header">
        <h2 className="lo-heading">Limit Orders</h2>
        <p className="lo-subtitle">
          Place on-chain limit orders for <strong>{pair}</strong> ({side.toUpperCase()}).
          <br />
          <span className="lo-spot-label">
            Current spot: <strong>{safeSpot.toFixed(6)}</strong>
          </span>
        </p>
      </div>

      <form
        className="panel lo-form"
        onSubmit={handleSubmit}
        noValidate
        aria-label="Place limit order"
      >
        <div>
          <span className="amount-chip">
            {side.toUpperCase()} {pair}
          </span>
        </div>

        <div className="lo-field">
          <label htmlFor="lo-target-price">
            <Tag size={14} aria-hidden="true" /> Target Price
          </label>
          <input
            id="lo-target-price"
            type="text"
            inputMode="decimal"
            placeholder="0.000000"
            value={targetPrice}
            onChange={handlePriceChange}
            aria-invalid={tpInvalid}
            autoComplete="off"
          />
          <span className="field-hint">Price per unit in quote asset</span>
          {tpInvalid && (
            <span className="field-error" id="lo-tp-err" role="alert">
              Enter a positive target price.
            </span>
          )}
        </div>

        <fieldset className="lo-presets">
          <legend className="lo-presets__legend">Quick set from spot</legend>
          <div className="lo-presets__group">
            <span className="lo-presets__label">Above market</span>
            <div className="lo-presets__row">
              {PRESETS_ABOVE.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={`filter-chip${selectedPreset === p.label ? ' filter-chip--active' : ''}`}
                  onClick={() => applyPreset(p)}
                  aria-pressed={selectedPreset === p.label}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="lo-presets__group">
            <span className="lo-presets__label">Below market</span>
            <div className="lo-presets__row">
              {PRESETS_BELOW.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={`filter-chip${selectedPreset === p.label ? ' filter-chip--active' : ''}`}
                  onClick={() => applyPreset(p)}
                  aria-pressed={selectedPreset === p.label}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </fieldset>

        <div className="two-up">
          <div className="lo-field">
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
              aria-invalid={amtInvalid}
              autoComplete="off"
            />
            <span className="field-hint">Quantity of base asset</span>
            {amtInvalid && (
              <span className="field-error" id="lo-amt-err" role="alert">
                Enter a positive amount.
              </span>
            )}
          </div>
          <div className="lo-field">
            <label htmlFor="lo-expiry">
              <Timer size={14} aria-hidden="true" /> Expiry (hours)
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
              aria-invalid={expInvalid}
            />
            <span className="field-hint">Order cancelled after this period</span>
            {expInvalid && (
              <span className="field-error" role="alert">
                Expiry must be at least 1 hour.
              </span>
            )}
          </div>
        </div>

        {formError && (
          <div className="error-banner" role="alert">
            {formError}
          </div>
        )}

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

      <div className="lo-orders-section">
        <h3 className="lo-orders-heading">
          <Clock size={18} aria-hidden="true" /> Active Orders
          {!ordersLoading && orders.length > 0 && <span className="chip">{orders.length}</span>}
        </h3>

        {ordersLoading ? (
          <div className="lo-table__wrapper">
            <table className="lo-table" aria-label="Loading limit orders">
              <thead>
                <tr>
                  <th>ID</th>
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
        ) : ordersError ? (
          <div className="error-banner" role="alert">
            <XCircle size={18} aria-hidden="true" /> {ordersError}
          </div>
        ) : orders.length === 0 ? (
          <div className="empty-state empty-state--board" role="status">
            <TrendingUp className="empty-state__icon" aria-hidden="true" size={36} />
            <h3 className="empty-state__heading">No active limit orders</h3>
            <p className="empty-state__message">
              Place a limit order using the form above to get started.
            </p>
          </div>
        ) : (
          <div className="lo-table__wrapper">
            <table className="lo-table" aria-label="Active limit orders">
              <thead>
                <tr>
                  <th>ID</th>
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
                {orders.map((o) => {
                  const cancelling = cancellingId === o.id;
                  return (
                    <tr key={o.id} className="lo-table__row">
                      <td
                        className="lo-table__cell lo-table__cell--mono"
                        data-label="ID"
                        title={o.id}
                      >
                        {truncateId(o.id)}
                      </td>
                      <td className="lo-table__cell" data-label="Pair">
                        {o.pair}
                      </td>
                      <td className="lo-table__cell" data-label="Side">
                        <span className="chip">{o.side.toUpperCase()}</span>
                      </td>
                      <td className="lo-table__cell lo-table__cell--mono" data-label="Price">
                        {o.targetPrice.toFixed(6)}
                      </td>
                      <td className="lo-table__cell" data-label="Amount">
                        {o.amount.toLocaleString()}
                      </td>
                      <td className="lo-table__cell" data-label="Status">
                        <span className={statusPillClass(o.status)}>{STATUS_LABELS[o.status]}</span>
                      </td>
                      <td className="lo-table__cell lo-table__cell--muted" data-label="Expiry">
                        <Clock size={12} aria-hidden="true" /> {o.expiryHours}h
                      </td>
                      <td className="lo-table__cell lo-table__cell--muted" data-label="Created">
                        {formatDate(o.createdAt)}
                      </td>
                      <td className="lo-table__cell" data-label="Actions">
                        {o.status === 'open' && (
                          <div className="lo-cancel-cell">
                            <button
                              type="button"
                              className="ghost-button lo-cancel-btn"
                              onClick={() => handleCancel(o.id)}
                              disabled={cancelling}
                              aria-label={`Cancel order ${truncateId(o.id)}`}
                            >
                              {cancelling ? (
                                <Loader2 size={14} className="lo-spinner" aria-hidden="true" />
                              ) : (
                                <Trash2 size={14} aria-hidden="true" />
                              )}
                              {cancelling ? 'Cancelling…' : 'Cancel'}
                            </button>
                            {cancelErrorId === o.id && (
                              <span className="field-error" role="alert">
                                Failed to cancel.
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
