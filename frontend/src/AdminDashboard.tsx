import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Archive,
  ArrowLeft,
  Download,
  KeyRound,
  LogOut,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  clearAdminApiKey,
  exportAuditLog,
  exportReleasedPayoutsCsv,
  getAdminApiKey,
  listBounties,
  releaseBountySigned,
  refundBountySigned,
  runAdminArchive,
  setAdminApiKey,
  verifyAdminKey,
} from './api';
import { useFreighter } from './hooks/useFreighter';
import type { Bounty } from './types';

interface AdminDashboardProps {
  onBack: () => void;
}

/**
 * Statuses each bulk action may target — kept in line with the backend
 * (`bountyStore.releaseBounty` / `refundBounty`): release only applies to
 * `submitted` bounties; refund applies to anything not yet finalised or
 * under review (`submitted` bounties must be reviewed, not bulk-refunded).
 */
const BULK_RELEASE_STATUSES: ReadonlySet<Bounty['status']> = new Set(['submitted']);
const BULK_REFUND_STATUSES: ReadonlySet<Bounty['status']> = new Set([
  'open',
  'reserved',
  'expired',
]);

function isBulkReleasable(bounty: Bounty): boolean {
  return BULK_RELEASE_STATUSES.has(bounty.status);
}

function isBulkRefundable(bounty: Bounty): boolean {
  return BULK_REFUND_STATUSES.has(bounty.status);
}

function isActionable(bounty: Bounty): boolean {
  return isBulkReleasable(bounty) || isBulkRefundable(bounty);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Gate shown to anyone who has not yet authenticated with the admin API key.
 * Non-admins are blocked from the dashboard content — there is nothing to
 * view until the key is verified against the backend.
 */
function AdminGate({ onAuthed }: { onAuthed: () => void }) {
  const [key, setKey] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;

    setVerifying(true);
    setError(null);
    try {
      const valid = await verifyAdminKey(trimmed);
      if (!valid) {
        setError('Invalid admin key. Access denied.');
        return;
      }
      // Only persist the key after the backend has accepted it.
      setAdminApiKey(trimmed);
      onAuthed();
    } catch {
      setError('Could not verify the admin key. Please try again.');
    } finally {
      setVerifying(false);
    }
  }

  return (
    <section className="admin-gate" aria-label="Admin sign in">
      <div className="admin-gate__icon">
        <ShieldAlert size={28} />
      </div>
      <h1>Admin access required</h1>
      <p>
        This dashboard is restricted to platform admins. Enter the admin API key configured on the
        server to continue.
      </p>
      <form className="admin-gate__form" onSubmit={handleSubmit}>
        <label htmlFor="admin-api-key">Admin API key</label>
        <input
          id="admin-api-key"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="••••••••••••••••"
        />
        {error && (
          <p className="admin-gate__error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={verifying || key.trim() === ''}>
          <KeyRound size={16} />
          {verifying ? 'Verifying...' : 'Unlock dashboard'}
        </button>
      </form>
    </section>
  );
}

export default function AdminDashboard({ onBack }: AdminDashboardProps) {
  const freighter = useFreighter();
  const [authed, setAuthed] = useState<boolean>(() => getAdminApiKey() !== null);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState<'release' | 'refund' | null>(null);
  const [exporting, setExporting] = useState<'audit' | 'payouts' | null>(null);
  const [archiving, setArchiving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setBounties(await listBounties());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load bounties.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed) {
      void refresh();
    }
  }, [authed, refresh]);

  const metrics = useMemo(() => {
    const count = (status: Bounty['status']) =>
      bounties.filter((bounty) => bounty.status === status).length;
    return {
      total: bounties.length,
      open: count('open'),
      pending: count('reserved') + count('submitted'),
      disputes: count('disputed'),
      released: count('released'),
      refunded: count('refunded'),
    };
  }, [bounties]);

  const actionableBounties = useMemo(
    () => bounties.filter((bounty) => isActionable(bounty)),
    [bounties]
  );

  const selectedActionable = useMemo(
    () => actionableBounties.filter((bounty) => selectedIds.has(bounty.id)),
    [actionableBounties, selectedIds]
  );

  const selectedReleasable = selectedActionable.filter((bounty) => isBulkReleasable(bounty));
  const selectedRefundable = selectedActionable.filter((bounty) => isBulkRefundable(bounty));

  function handleSignOut() {
    clearAdminApiKey();
    setSelectedIds(new Set());
    setAuthed(false);
  }

  async function handleExportAuditLog() {
    setExporting('audit');
    try {
      const { blob, filename } = await exportAuditLog();
      downloadBlob(blob, filename);
      toast.success('Audit log exported.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export the audit log.');
    } finally {
      setExporting(null);
    }
  }

  async function handleExportPayouts() {
    setExporting('payouts');
    try {
      const { blob, filename } = await exportReleasedPayoutsCsv();
      downloadBlob(blob, filename);
      toast.success('Released payouts exported.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export released payouts.');
    } finally {
      setExporting(null);
    }
  }

  async function handleArchive() {
    setArchiving(true);
    try {
      const result = await runAdminArchive();
      if (result.archivedCount > 0) {
        toast.success(
          `Archived ${result.archivedCount} ${result.archivedCount === 1 ? 'bounty' : 'bounties'}.`
        );
      } else {
        toast.success('No bounties were eligible for archiving.');
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to run the archive job.');
    } finally {
      setArchiving(false);
    }
  }

  function toggleSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = actionableBounties.every((bounty) => next.has(bounty.id));
      if (allSelected) {
        actionableBounties.forEach((bounty) => next.delete(bounty.id));
      } else {
        actionableBounties.forEach((bounty) => next.add(bounty.id));
      }
      return next;
    });
  }

  /**
   * Runs the same signed release/refund flow the board uses for single
   * bounties, sequentially across the selected set.  Each action still
   * requires a Freighter signature from a whitelisted maintainer wallet —
   * the dashboard deliberately does not bypass that on-chain authorization
   * control with the admin key alone.
   */
  async function handleBulkAction(action: 'release' | 'refund') {
    if (selectedActionable.length === 0) return;

    if (!freighter.isConnected || !freighter.publicKey) {
      toast.error('Please connect your Freighter wallet first to sign the bulk action.');
      return;
    }
    if (!freighter.isOnCorrectNetwork) {
      toast.error('Please switch to the correct Stellar network in Freighter.');
      return;
    }

    setBulkBusy(action);
    let succeeded = 0;
    const failures: string[] = [];

    for (const bounty of selectedActionable) {
      const timestamp = Math.floor(Date.now() / 1000);

      try {
        if (action === 'release') {
          const payload = {
            maintainer: freighter.publicKey,
            action: 'release' as const,
            bountyId: bounty.id,
            timestamp,
          };
          const { signature, publicKey } = await freighter.signPayload(payload);
          await releaseBountySigned(bounty.id, payload, signature, publicKey);
        } else {
          const payload = {
            maintainer: freighter.publicKey,
            action: 'refund' as const,
            bountyId: bounty.id,
            timestamp,
          };
          const { signature, publicKey } = await freighter.signPayload(payload);
          await refundBountySigned(bounty.id, payload, signature, publicKey);
        }
        succeeded += 1;
      } catch (err) {
        failures.push(`${bounty.id}: ${err instanceof Error ? err.message : 'action failed'}`);
      }
    }

    await refresh();
    setSelectedIds(new Set());

    if (failures.length === 0) {
      toast.success(
        `Bulk ${action} complete — ${succeeded} ${succeeded === 1 ? 'bounty' : 'bounties'} processed.`
      );
    } else {
      toast.error(`Bulk ${action}: ${succeeded} succeeded, ${failures.length} failed.`);
    }

    setBulkBusy(null);
  }

  if (!authed) {
    return (
      <div className="page-shell">
        <AdminGate onAuthed={() => setAuthed(true)} />
      </div>
    );
  }

  const bulkBusyLabel =
    bulkBusy === null ? null : bulkBusy === 'release' ? 'Releasing...' : 'Refunding...';

  return (
    <div className="page-shell admin-dashboard">
      <header className="admin-dashboard__header">
        <div className="admin-dashboard__title">
          <span className="meta-label">
            <ShieldCheck size={12} /> Admin
          </span>
          <h1>Admin dashboard</h1>
          <p>Admin-only operations for the bounty board.</p>
        </div>
        <div className="admin-dashboard__header-actions">
          <button className="secondary-button" onClick={onBack} aria-label="Go back to board">
            <ArrowLeft size={16} /> Back to board
          </button>
          <button className="ghost-button" onClick={handleSignOut} aria-label="Sign out of admin">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </header>

      <section className="admin-section" aria-label="Operational metrics">
        <h2>Operational summary</h2>
        <div className="metrics admin-metrics">
          <div className="metric-card">
            <span>Open disputes</span>
            <strong>{loading ? '–' : metrics.disputes}</strong>
          </div>
          <div className="metric-card">
            <span>Pending bounties</span>
            <strong>{loading ? '–' : metrics.pending}</strong>
          </div>
          <div className="metric-card">
            <span>Open</span>
            <strong>{loading ? '–' : metrics.open}</strong>
          </div>
          <div className="metric-card">
            <span>Total bounties</span>
            <strong>{loading ? '–' : metrics.total}</strong>
          </div>
        </div>
      </section>

      <section className="admin-section" aria-label="Admin actions">
        <h2>Actions</h2>
        <div className="admin-actions-grid">
          <article className="admin-action-card">
            <div>
              <h3>Export audit log</h3>
              <p>Download the full cross-bounty audit log as JSON (admin-gated).</p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handleExportAuditLog()}
              disabled={exporting !== null}
            >
              <Download size={16} />
              {exporting === 'audit' ? 'Exporting...' : 'Export audit log'}
            </button>
          </article>

          <article className="admin-action-card">
            <div>
              <h3>Export released payouts</h3>
              <p>Download released payouts as CSV for bookkeeping.</p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handleExportPayouts()}
              disabled={exporting !== null}
            >
              <Download size={16} />
              {exporting === 'payouts' ? 'Exporting...' : 'Export payouts (CSV)'}
            </button>
          </article>

          <article className="admin-action-card">
            <div>
              <h3>Archive old bounties</h3>
              <p>Run the archive pass now (same rules as the scheduled job).</p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handleArchive()}
              disabled={archiving}
            >
              <Archive size={16} />
              {archiving ? 'Archiving...' : 'Run archive'}
            </button>
          </article>
        </div>
      </section>

      <section className="admin-section" aria-label="Bulk release and refund">
        <div className="admin-bulk__heading">
          <div>
            <h2>Bulk release / refund</h2>
            <p>
              Select bounties and run one action across all of them. Every action is signed
              individually by your Freighter wallet (a whitelisted maintainer key) — the same
              authorization control as the board, never bypassed.
            </p>
          </div>
          <div className="admin-bulk__buttons">
            <button
              type="button"
              className="secondary-button"
              disabled={selectedReleasable.length === 0 || bulkBusy !== null}
              onClick={() => void handleBulkAction('release')}
            >
              {bulkBusyLabel ?? `Release selected (${selectedReleasable.length})`}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={selectedRefundable.length === 0 || bulkBusy !== null}
              onClick={() => void handleBulkAction('refund')}
            >
              {bulkBusyLabel ?? `Refund selected (${selectedRefundable.length})`}
            </button>
          </div>
        </div>

        {actionableBounties.length === 0 ? (
          <p className="admin-bulk__empty">
            No bounties are currently actionable. Submitted bounties can be released; open,
            reserved, and expired bounties can be refunded.
          </p>
        ) : (
          <div className="admin-bulk__list">
            <label className="admin-bulk__row admin-bulk__row--head">
              <input
                type="checkbox"
                checked={actionableBounties.every((bounty) => selectedIds.has(bounty.id))}
                onChange={toggleSelectAll}
                aria-label="Select all actionable bounties"
              />
              <span>Bounty</span>
              <span>Status</span>
              <span>Actions available</span>
            </label>
            {actionableBounties.map((bounty) => (
              <label className="admin-bulk__row" key={bounty.id}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(bounty.id)}
                  onChange={() => toggleSelection(bounty.id)}
                  aria-label={`Select ${bounty.id}`}
                />
                <span className="admin-bulk__title">
                  <strong>{bounty.title}</strong>
                  <small>
                    {bounty.repo} · {bounty.id} · {bounty.amount} {bounty.tokenSymbol}
                  </small>
                </span>
                <span>{bounty.status}</span>
                <span>
                  {isBulkReleasable(bounty) && <em>release</em>}
                  {isBulkRefundable(bounty) && <em>refund</em>}
                </span>
              </label>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
