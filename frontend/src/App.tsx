import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  Suspense,
  type FormEvent,
} from 'react';
import { useBeforeUnload } from './useBeforeUnload';
import { ChevronLeft, ChevronRight, FolderGit2, Moon, Rocket, Search, Sun } from 'lucide-react';
import { toast } from 'sonner';
import {
  createBounty,
  exportReleasedPayoutsCsv,
  getBounty,
  listBounties,
  listOpenIssues,
  releaseBountySigned,
  refundBountySigned,
  reserveBounty,
  submitBounty,
  bulkBountyAction,
  type BulkActionResult,
} from './api';
import { useFreighter } from './hooks/useFreighter';
import FreighterConnectButton from './components/FreighterConnectButton';
import { statusCopy, actionCopy, readInitialFilters } from './constants';
import { debounce } from './utils';
import { type Bounty, type BountyStatus, type CreateBountyPayload, type OpenIssue } from './types';

import BountyCard from './BountyCard';
import SkeletonBountyCard from './SkeletonBountyCard';
import EmptyState from './EmptyState';
import { ShortcutsHelpOverlay } from './ShortcutsHelpOverlay';
import BountyDetailPage from './BountyDetailPage';
import ContributorProfilePage from './ContributorProfilePage';
import ContributorDashboard from './ContributorDashboard';
import MaintainerDashboard from './MaintainerDashboard';
import ErrorBoundary from './ErrorBoundary';
import SubmissionChecklistModal, { type SubmissionFormData } from './SubmissionChecklistModal';
import { useI18n, LanguageSwitcher } from './i18n/I18nContext';

const DARK_MODE_KEY = 'stellar-bounty-board-theme';
const BOUNTIES_PER_PAGE = 10;

function useDarkMode() {
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(DARK_MODE_KEY);
      if (stored !== null) return stored === 'dark';
    } catch {
      // ignore
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    try {
      localStorage.setItem(DARK_MODE_KEY, dark ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}

const initialForm: CreateBountyPayload = {
  repo: 'ritik4ever/stellar-stream',
  issueNumber: 48,
  title: '',
  summary: '',
  maintainer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  tokenSymbol: 'XLM',
  amount: 150,
  deadlineDays: 14,
  labels: [{ name: 'help wanted', color: '0075ca' }],
};

function validateStellarPublicKey(input: string): string | null {
  const value = input.trim();
  if (!value) return 'Address is required.';
  if (!/^G[A-Z0-9]{55}$/.test(value))
    return "Enter a Stellar public key (starts with 'G', 56 characters)";
  return null;
}

const contributorStatuses: Array<BountyStatus | 'all'> = [
  'all',
  'reserved',
  'submitted',
  'released',
  'refunded',
  'expired',
  'disputed',
];

type BountyAction = 'reserve' | 'submit' | 'release' | 'refund';

function formatTimestamp(value?: number): string {
  if (!value) return '-';
  return new Date(value * 1000).toLocaleString();
}

/** Extract the GitHub owner segment from an "owner/repo" string. */
function repoOwner(repo: string): string {
  return repo.split('/')[0] ?? '';
}

function App() {
  const { t } = useI18n();
  const { dark, toggle: toggleDark } = useDarkMode();
  const freighter = useFreighter();
  const initialFilters = useMemo(() => readInitialFilters(), []);
  const [form, setForm] = useState<CreateBountyPayload>(initialForm);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [totalBounties, setTotalBounties] = useState(0);
  const [hasMoreBounties, setHasMoreBounties] = useState(false);
  const [page, setPage] = useState(1);
  const [, setIssues] = useState<OpenIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showShortcutsOverlay, setShowShortcutsOverlay] = useState(false);
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [viewMode, setViewMode] = useState<'browse' | 'maintainer'>('browse');

  useBeforeUnload(isFormDirty);

  useEffect(() => {
    function goOnline() {
      // setIsOffline(false);
    }
    function goOffline() {
      // setIsOffline(true);
    }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const [searchQuery, setSearchQuery] = useState(initialFilters.searchQuery);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);

  const debouncedSetSearchQuery = useMemo(
    () => debounce((value: string) => setDebouncedSearchQuery(value), 300),
    []
  );

  useEffect(() => {
    debouncedSetSearchQuery(searchQuery);
  }, [searchQuery, debouncedSetSearchQuery]);

  const [statusFilter, setStatusFilter] = useState<'all' | BountyStatus>(
    initialFilters.statusFilter
  );
  const [minReward, setMinReward] = useState(initialFilters.minReward);
  const [maxReward, setMaxReward] = useState(initialFilters.maxReward);
  const [repoFilter, setRepoFilter] = useState(initialFilters.repoFilter);
  const [tokenFilter, setTokenFilter] = useState(initialFilters.tokenFilter);
  const [sortOption, setSortOption] = useState(initialFilters.sortOption);
  const [sortDirection, setSortDirection] = useState(initialFilters.sortDirection);
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearchQuery,
    statusFilter,
    minReward,
    maxReward,
    repoFilter,
    tokenFilter,
    sortOption,
    sortDirection,
    pathname,
  ]);

  const detailId = useMemo(() => {
    const match = pathname.match(/^\/bounties\/([^/]+)$/);
    return match ? decodeURIComponent(match[1] ?? '') : null;
  }, [pathname]);

  const [detailBounty, setDetailBounty] = useState<Bounty | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [submissionModalBounty, setSubmissionModalBounty] = useState<Bounty | null>(null);
  const [submissionModalData, setSubmissionModalData] = useState<SubmissionFormData | undefined>(
    undefined
  );
  const [submissionModalSubmitting, setSubmissionModalSubmitting] = useState(false);
  const [submissionModalError, setSubmissionModalError] = useState<string | null>(null);
  const submissionReturnFocusRef = useRef<HTMLElement | null>(null);

  // #829 — maintainer bulk-actions (multi-select release/refund)
  const [selectedBountyIds, setSelectedBountyIds] = useState<string[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkActionResult[] | null>(null);

  const toggleBountySelection = useCallback((id: string) => {
    setSelectedBountyIds((prev) =>
      prev.includes(id) ? prev.filter((selected) => selected !== id) : [...prev, id]
    );
  }, []);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const repoRouteMatch = pathname.match(/^\/repo\/([^/]+)\/([^/]+)$/);
      const effectiveRepo = repoRouteMatch
        ? `${decodeURIComponent(repoRouteMatch[1] ?? '')}/${decodeURIComponent(repoRouteMatch[2] ?? '')}`
        : repoFilter;
      const apiSort = sortOption.startsWith('reward-')
        ? 'amount'
        : sortOption.startsWith('deadline-')
          ? 'deadline'
          : 'createdAt';
      const [bountyData, issueData] = await Promise.all([
        listBounties(
          {
            page,
            limit: BOUNTIES_PER_PAGE,
            q: debouncedSearchQuery.trim() || undefined,
            repo: effectiveRepo || undefined,
            minReward: minReward || undefined,
            maxReward: maxReward || undefined,
            status: statusFilter === 'all' ? undefined : statusFilter,
            tokenSymbol: tokenFilter || undefined,
            sort: apiSort,
            order: sortDirection,
          },
          signal
        ),
        listOpenIssues(signal),
      ]);
      setBounties(bountyData.data);
      setTotalBounties(bountyData.total);
      setHasMoreBounties(bountyData.hasMore);
      setIssues(issueData);
    },
    [
      page,
      debouncedSearchQuery,
      repoFilter,
      minReward,
      maxReward,
      statusFilter,
      tokenFilter,
      sortOption,
      sortDirection,
      pathname,
    ]
  );

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function bootstrap() {
      try {
        await refresh(signal);
      } catch (err) {
        if (signal.aborted) return;
        console.error('Failed to load project data:', err);
      } finally {
        if (!signal.aborted) {
          setLoading(false);
        }
      }
    }

    void bootstrap();

    const timer = window.setInterval(() => {
      const pollController = new AbortController();
      void refresh(pollController.signal).catch(() => {});
    }, 7000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (pathname.startsWith('/bounties/') || pathname.startsWith('/repo/')) return;

    const params = new URLSearchParams();
    if (debouncedSearchQuery.trim() !== '') params.set('search', debouncedSearchQuery);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (minReward !== '') params.set('minReward', minReward);
    if (maxReward !== '') params.set('maxReward', maxReward);
    if (repoFilter !== '') params.set('repo', repoFilter);
    if (tokenFilter !== '') params.set('tokenSymbol', tokenFilter);
    if (sortOption !== 'newest') params.set('sort', sortOption);
    if (sortDirection !== 'desc') params.set('direction', sortDirection);

    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', nextUrl);
  }, [
    debouncedSearchQuery,
    statusFilter,
    minReward,
    maxReward,
    repoFilter,
    tokenFilter,
    sortOption,
    sortDirection,
    pathname,
  ]);

  useEffect(() => {
    function handlePopState() {
      setPathname(window.location.pathname);
      if (
        window.location.pathname.startsWith('/bounties/') ||
        window.location.pathname.startsWith('/repo/')
      )
        return;
      const filters = readInitialFilters();
      setSearchQuery(filters.searchQuery);
      setStatusFilter(filters.statusFilter);
      setMinReward(filters.minReward);
      setMaxReward(filters.maxReward);
      setRepoFilter(filters.repoFilter);
      setTokenFilter(filters.tokenFilter);
      setSortOption(filters.sortOption);
      setSortDirection(filters.sortDirection);
      setPage(1);
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      if (event.key === '?') {
        event.preventDefault();
        setShowShortcutsOverlay((prev) => !prev);
      } else if (event.key === '/') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const navigate = useCallback(
    (nextPath: string) => {
      if (nextPath === window.location.pathname) return;
      if (isFormDirty) {
        const confirmed = window.confirm(
          'You have unsaved changes in the bounty creation form. Are you sure you want to leave?'
        );
        if (!confirmed) return;
      }
      window.history.pushState(null, '', nextPath);
      setPathname(nextPath);
    },
    [isFormDirty]
  );

  const handleOpenBounty = useCallback(
    (id: string) => {
      navigate(`/bounties/${encodeURIComponent(id)}`);
    },
    [navigate]
  );

  async function handleReserve(bounty: Bounty) {
    const contributor = window.prompt('Contributor Stellar address', bounty.contributor ?? '');
    if (!contributor) return;
    const contributorError = validateStellarPublicKey(contributor);
    if (contributorError) {
      window.alert(contributorError);
      return;
    }
    try {
      await reserveBounty(bounty.id, contributor.trim());
      await refresh();
      toast.success('Bounty reserved successfully!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reserve bounty.');
    }
  }

  async function handleSubmit(bounty: Bounty) {
    submissionReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSubmissionModalBounty(bounty);
    setSubmissionModalError(null);
    setSubmissionModalData(undefined);
  }

  function closeSubmissionModal() {
    setSubmissionModalBounty(null);
    setSubmissionModalError(null);
    window.requestAnimationFrame(() => {
      submissionReturnFocusRef.current?.focus();
      submissionReturnFocusRef.current = null;
    });
  }

  async function handleSubmissionConfirm(data: SubmissionFormData) {
    if (!submissionModalBounty) return;
    setSubmissionModalSubmitting(true);
    setSubmissionModalError(null);
    setSubmissionModalData(data);
    try {
      await submitBounty(
        submissionModalBounty.id,
        data.contributor,
        data.prLink,
        data.notes || undefined
      );
      closeSubmissionModal();
      setSubmissionModalData(undefined);
      await refresh();
      toast.success('PR submitted successfully!');
    } catch (err) {
      setSubmissionModalError(err instanceof Error ? err.message : 'Submission failed.');
    } finally {
      setSubmissionModalSubmitting(false);
    }
  }

  async function handleRelease(bounty: Bounty) {
    // Require Freighter connection for maintainer actions
    if (!freighter.isConnected || !freighter.publicKey) {
      toast.error('Please connect your Freighter wallet first to sign the release action.');
      return;
    }
    if (!freighter.isOnCorrectNetwork) {
      toast.error('Please switch to the correct Stellar network in Freighter.');
      return;
    }

    const transactionHash = window.prompt('Transaction hash (64 hex chars, optional)') ?? undefined;
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      maintainer: freighter.publicKey,
      ...(transactionHash ? { transactionHash } : {}),
      action: 'release' as const,
      bountyId: bounty.id,
      timestamp,
    };

    try {
      // Sign the payload with Freighter
      const { signature, publicKey } = await freighter.signPayload(payload);

      // Send the signed request
      await releaseBountySigned(bounty.id, payload, signature, publicKey);
      await refresh();
      toast.success('Bounty released — payment sent!');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to release bounty.';
      toast.error(message);
    }
  }

  async function handleRefund(bounty: Bounty) {
    // Require Freighter connection for maintainer actions
    if (!freighter.isConnected || !freighter.publicKey) {
      toast.error('Please connect your Freighter wallet first to sign the refund action.');
      return;
    }
    if (!freighter.isOnCorrectNetwork) {
      toast.error('Please switch to the correct Stellar network in Freighter.');
      return;
    }

    const transactionHash = window.prompt('Transaction hash (64 hex chars, optional)') ?? undefined;
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = {
      maintainer: freighter.publicKey,
      ...(transactionHash ? { transactionHash } : {}),
      action: 'refund' as const,
      bountyId: bounty.id,
      timestamp,
    };

    try {
      // Sign the payload with Freighter
      const { signature, publicKey } = await freighter.signPayload(payload);

      // Send the signed request
      await refundBountySigned(bounty.id, payload, signature, publicKey);
      await refresh();
      toast.success('Bounty refunded successfully!');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refund bounty.';
      toast.error(message);
    }
  }

  /**
   * #829 — run a bulk release/refund over every selected bounty via the
   * admin bulk-action endpoint. The backend processes each item
   * independently, so we surface per-item success/failure results and never
   * lose successful items because another one failed.
   */
  async function handleBulkAction(action: 'release' | 'refund') {
    if (selectedBountyIds.length === 0 || bulkRunning) return;

    // The bulk endpoint authorizes via the admin API key and validates the
    // maintainer address against each bounty, exactly like the single
    // release/refund endpoints validate `maintainer`.
    let maintainer = freighter.isConnected && freighter.publicKey ? freighter.publicKey : '';
    if (!maintainer) {
      maintainer =
        window.prompt('Maintainer Stellar address (G...) used to authorize these bulk actions:') ??
        '';
      if (!maintainer.trim()) return;
      maintainer = maintainer.trim();
      if (!validateStellarPublicKey(maintainer)) {
        toast.error("Enter a Stellar public key (starts with 'G', 56 characters)");
        return;
      }
    }

    const adminKey = (window.prompt('Admin API key for bulk actions:') ?? '').trim();
    if (!adminKey) {
      toast.error('An admin API key is required for bulk actions.');
      return;
    }

    setBulkRunning(true);
    setBulkResults(null);
    try {
      const data = await bulkBountyAction(action, selectedBountyIds, maintainer, adminKey);
      setBulkResults(data.results);
      await refresh();
      setSelectedBountyIds([]);

      const verb = action === 'release' ? 'released' : 'refunded';
      if (data.failed === 0) {
        toast.success(`${data.succeeded} bounty(ies) ${verb} successfully.`);
      } else {
        toast.error(
          `Bulk ${action} finished: ${data.succeeded} succeeded, ${data.failed} failed. See the results panel for details.`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bulk action failed.';
      toast.error(message);
    } finally {
      setBulkRunning(false);
    }
  }

  async function handleExportCsv() {
    setIsExporting(true);
    try {
      const { blob, filename } = await exportReleasedPayoutsCsv();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export CSV.');
    } finally {
      setIsExporting(false);
    }
  }

  const renderActionButton = useCallback(
    (bounty: Bounty, action: { action: BountyAction; label: string; title: string }) => {
      const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (action.action === 'reserve') void handleReserve(bounty);
        else if (action.action === 'submit') void handleSubmit(bounty);
        else if (action.action === 'release') void handleRelease(bounty);
        else if (action.action === 'refund') void handleRefund(bounty);
      };

      return (
        <button
          key={action.action}
          type="button"
          className={action.action === 'refund' ? 'ghost-button' : 'secondary-button'}
          title={action.title}
          onClick={onClick}
        >
          {action.label}
        </button>
      );
    },
    [refresh]
  );

  const repoRoute = useMemo(() => {
    const match = pathname.match(/^\/repo\/([^/]+)\/([^/]+)$/);
    return match
      ? {
          owner: decodeURIComponent(match[1]),
          name: decodeURIComponent(match[2]),
        }
      : null;
  }, [pathname]);

  const contributorRoute = useMemo(() => {
    const match = pathname.match(/^\/contributor\/([^/]+)$/);
    return match ? { address: decodeURIComponent(match[1]) } : null;
  }, [pathname]);

  useEffect(() => {
    if (!detailId) {
      setDetailBounty(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    getBounty(detailId)
      .then((bounty) => {
        if (active) {
          setDetailBounty(bounty);
          setDetailLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setDetailBounty(null);
          setDetailLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [detailId]);

  const filteredBounties = bounties;

  const groupedBounties = useMemo(() => {
    if (repoRoute) {
      return { [`${repoRoute.owner}/${repoRoute.name}`]: filteredBounties };
    }
    const groups: Record<string, Bounty[]> = {};
    filteredBounties.forEach((bounty) => {
      if (!groups[bounty.repo]) groups[bounty.repo] = [];
      groups[bounty.repo].push(bounty);
    });
    return groups;
  }, [filteredBounties, repoRoute]);

  const hasActiveFilters =
    debouncedSearchQuery.trim() !== '' ||
    statusFilter !== 'all' ||
    minReward !== '' ||
    maxReward !== '' ||
    repoFilter !== '';

  const { emptyStateHeading, emptyStateMessage } = useMemo(() => {
    if (debouncedSearchQuery.trim()) {
      return {
        emptyStateHeading: `No results for "${debouncedSearchQuery.trim()}"`,
        emptyStateMessage: 'Try a different search term or clear filters.',
      };
    }
    return {
      emptyStateHeading: 'No bounties yet',
      emptyStateMessage: 'Be the first to create one!',
    };
  }, [debouncedSearchQuery]);

  if (detailId) {
    const owner = detailBounty ? repoOwner(detailBounty.repo) : '';
    return (
      <ErrorBoundary componentName="BountyDetailPage">
        <Suspense fallback={<div className="empty-state">Loading bounty...</div>}>
          <BountyDetailPage
            bounty={detailBounty}
            loading={detailLoading}
            onBack={() => navigate('/')}
            owner={owner}
            avatarUrl={detailBounty ? `https://github.com/${owner}.png?size=72` : ''}
            statusCopy={statusCopy}
            actionCopy={actionCopy}
            renderActionButton={renderActionButton}
            formatTimestamp={formatTimestamp}
            bounties={bounties}
            onBountyUpdated={(updated) => {
              setDetailBounty(updated);
              void refresh();
            }}
          />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (contributorRoute) {
    return (
      <ContributorProfilePage address={contributorRoute.address} onBack={() => navigate('/')} />
    );
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      // Validate required fields
      if (!form.repo.trim()) {
        toast.error('Repository is required.');
        return;
      }
      if (!form.title.trim()) {
        toast.error('Title is required.');
        return;
      }
      if (form.amount <= 0) {
        toast.error('Reward amount must be greater than 0.');
        return;
      }
      const maintainerError = validateStellarPublicKey(form.maintainer);
      if (maintainerError) {
        toast.error(`Maintainer address: ${maintainerError}`);
        return;
      }
      await createBounty({
        ...form,
        maintainer: form.maintainer.trim(),
        labels: form.labels.filter(Boolean),
      });
      setForm({ ...initialForm, issueNumber: form.issueNumber + 1 });
      setIsFormDirty(false);
      await refresh();
      toast.success('Bounty created successfully!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create bounty.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-container">
      <header className="main-header">
        <div className="header-content">
          <div className="logo" onClick={() => navigate('/')}>
            <Rocket className="logo-icon" />
            <h1>{t('app.title', 'Stellar Bounty Board')}</h1>
          </div>
          <div className="header-actions">
            <LanguageSwitcher />
            <FreighterConnectButton freighter={freighter} compact />
            <button
              className="theme-toggle"
              aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={toggleDark}
            >
              {dark ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </div>
      </header>

      <main className="main-content">
        <section className="dashboard-hero">
          <div className="hero-grid">
            <div className="hero-main">
              <h2>{t('app.hero.title', 'Fund GitHub issues with on-chain escrow')}</h2>
              <p>
                {t(
                  'app.hero.subtitle',
                  'A decentralized bounty platform powered by Stellar. Reserve tasks, submit solutions, and get paid instantly.'
                )}
              </p>
              <form className="bounty-form" onSubmit={handleCreate}>
                <div className="form-row">
                  <label>
                    Repository
                    <input
                      value={form.repo}
                      onChange={(e) => {
                        setForm({ ...form, repo: e.target.value });
                        setIsFormDirty(true);
                      }}
                      placeholder="owner/repo"
                    />
                  </label>
                  <label>
                    Issue #
                    <input
                      type="number"
                      value={form.issueNumber}
                      onChange={(e) => {
                        setForm({ ...form, issueNumber: Number(e.target.value) });
                        setIsFormDirty(true);
                      }}
                    />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Title
                    <input
                      value={form.title}
                      onChange={(e) => {
                        setForm({ ...form, title: e.target.value });
                        setIsFormDirty(true);
                      }}
                      placeholder="Add WebSocket updates..."
                    />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Reward
                    <input
                      type="number"
                      value={form.amount}
                      onChange={(e) => {
                        setForm({ ...form, amount: Number(e.target.value) });
                        setIsFormDirty(true);
                      }}
                    />
                  </label>
                  <label>
                    Asset
                    <select
                      value={form.tokenSymbol}
                      onChange={(e) => {
                        setForm({ ...form, tokenSymbol: e.target.value });
                        setIsFormDirty(true);
                      }}
                    >
                      <option value="XLM">XLM</option>
                      <option value="USDC">USDC</option>
                    </select>
                  </label>
                </div>
                <div className="form-actions">
                  <button type="submit" disabled={submitting}>
                    {submitting ? 'Creating...' : 'Create Bounty'}
                  </button>
                  {isFormDirty && (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setForm(initialForm);
                        setIsFormDirty(false);
                      }}
                    >
                      Discard
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </section>

        <nav className="dashboard-view-switcher" role="tablist" aria-label="Dashboard views">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'browse'}
            className={`view-tab-btn ${viewMode === 'browse' ? 'view-tab-btn--active' : ''}`}
            onClick={() => setViewMode('browse')}
          >
            Public Browse
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'maintainer'}
            className={`view-tab-btn ${viewMode === 'maintainer' ? 'view-tab-btn--active' : ''}`}
            onClick={() => setViewMode('maintainer')}
          >
            Maintainer Dashboard
          </button>
        </nav>

        {viewMode === 'maintainer' ? (
          <MaintainerDashboard
            bounties={bounties}
            maintainerAddress={freighter.publicKey || ''}
            loading={loading}
            onSelectBounty={(id) => setDetailId(id)}
            onRelease={(b) => void handleRelease(b)}
            onRefund={(b) => void handleRefund(b)}
          />
        ) : (
          <>
            <ContributorDashboard bounties={bounties} loading={loading} />

            <section className="board-section">
              {(selectedBountyIds.length > 0 || bulkResults) && (
                <div
                  className="bulk-toolbar"
                  role="toolbar"
                  aria-label="Bulk actions for selected bounties"
                >
                  {selectedBountyIds.length > 0 ? (
                    <>
                      <span className="bulk-toolbar__count" aria-live="polite">
                        {selectedBountyIds.length} selected
                      </span>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={bulkRunning}
                        onClick={() => void handleBulkAction('release')}
                      >
                        {bulkRunning ? 'Processing...' : 'Release selected'}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={bulkRunning}
                        onClick={() => void handleBulkAction('refund')}
                      >
                        {bulkRunning ? 'Processing...' : 'Refund selected'}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={bulkRunning}
                        onClick={() => setSelectedBountyIds([])}
                      >
                        Clear selection
                      </button>
                    </>
                  ) : (
                    <span className="bulk-toolbar__count">
                      No bounties selected — tick checkboxes on bounty cards to select.
                    </span>
                  )}

                  {selectedBountyIds.length > 0 && (
                    <div className="export-toolbar" aria-label="Export bounties">
                      <button
                        type="button"
                        className={
                          isExporting
                            ? 'secondary-button secondary-button--loading'
                            : 'secondary-button'
                        }
                        disabled={isExporting}
                        onClick={handleExportCsv}
                      >
                        {isExporting ? (
                          <span className="spinner" aria-hidden="true" />
                        ) : (
                          'Export CSV'
                        )}
                      </button>
                    </div>
                  )}

                  {bulkResults && bulkResults.length > 0 && (
                    <div className="bulk-results" aria-live="polite">
                      <h4>Last bulk action results</h4>
                      <ul>
                        {bulkResults.map((result) => (
                          <li
                            key={result.bountyId}
                            className={
                              result.success ? 'bulk-result--success' : 'bulk-result--failure'
                            }
                          >
                            <strong>{result.bountyId}</strong>:{' '}
                            {result.success
                              ? `Success (${result.status ?? 'updated'})`
                              : `Failed — ${result.error ?? 'Unknown error'}`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="board-filters">
                <div className="search-box">
                  <Search size={18} />
                  <input
                    ref={searchInputRef}
                    placeholder="Search by repo, title, or label..."
                    value={searchQuery}
                    onChange={(e) => {
                      setPage(1);
                      setSearchQuery(e.target.value);
                    }}
                  />
                </div>
                <div className="filter-chips">
                  {contributorStatuses.map((status) => (
                    <button
                      key={status}
                      className={`filter-chip ${statusFilter === status ? 'active' : ''}`}
                      onClick={() => {
                        setPage(1);
                        setStatusFilter(status);
                      }}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>

              {loading ? (
                <div className="board-grid">
                  {[1, 2, 3].map((i) => (
                    <SkeletonBountyCard key={i} />
                  ))}
                </div>
              ) : Object.keys(groupedBounties).length > 0 ? (
                <div className="board-groups">
                  {Object.entries(groupedBounties).map(([repo, repoBounties]) => (
                    <div key={repo} className="repo-group">
                      <h3 className="repo-heading">
                        <FolderGit2 size={18} /> {repo}
                      </h3>
                      <div className="board-grid">
                        {repoBounties.map((bounty) => (
                          <BountyCard
                            key={bounty.id}
                            bounty={bounty}
                            onOpen={handleOpenBounty}
                            renderActionButton={renderActionButton}
                            selection={
                              freighter.isConnected && freighter.publicKey
                                ? bounty.status !== 'released' && bounty.status !== 'refunded'
                                  ? {
                                      selected: selectedBountyIds.includes(bounty.id),
                                      onToggle: () => toggleBountySelection(bounty.id),
                                    }
                                  : undefined
                                : undefined
                            }
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  heading={emptyStateHeading}
                  message={emptyStateMessage}
                  hasFilters={hasActiveFilters}
                  onClearFilters={() => {
                    setSearchQuery('');
                    setStatusFilter('all');
                  }}
                />
              )}
              <nav className="pagination-controls" aria-label="Bounty pages">
                <button
                  type="button"
                  aria-label="Previous page"
                  disabled={page === 1}
                  onClick={() => setPage((current) => current - 1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <span>
                  Page {page} of {Math.max(1, Math.ceil(totalBounties / BOUNTIES_PER_PAGE))} ·{' '}
                  {totalBounties} bounties
                </span>
                <button
                  type="button"
                  aria-label="Next page"
                  disabled={!hasMoreBounties}
                  onClick={() => setPage((current) => current + 1)}
                >
                  <ChevronRight size={18} />
                </button>
              </nav>
            </section>
          </>
        )}
      </main>

      {submissionModalBounty && (
        <SubmissionChecklistModal
          bounty={submissionModalBounty}
          initialData={submissionModalData}
          submitting={submissionModalSubmitting}
          error={submissionModalError}
          onSubmit={(data) => void handleSubmissionConfirm(data)}
          onClose={closeSubmissionModal}
        />
      )}

      <ShortcutsHelpOverlay
        isOpen={showShortcutsOverlay}
        onClose={() => setShowShortcutsOverlay(false)}
      />
    </div>
  );
}

export default App;
