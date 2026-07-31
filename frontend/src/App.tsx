import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  Suspense,
  type FormEvent,
} from "react";
import { useBeforeUnload } from "./useBeforeUnload";
import {
  FolderGit2,
  Moon,
  Rocket,
  Search,
  Sun,
} from "lucide-react";
import { toast } from "sonner";
import {
  createBounty,
  getBounty,
  listBounties,
  listOpenIssues,
  refundBounty,
  releaseBounty,
  reserveBounty,
  submitBounty,
} from "./api";
import {
  statusCopy,
  actionCopy,
  readInitialFilters,
} from "./constants";
import {
  debounce,
  filterBounties,
} from "./utils";
import {
  type Bounty,
  type BountyStatus,
  type CreateBountyPayload,
  type OpenIssue,
} from "./types";

import BountyCard from "./BountyCard";
import SkeletonBountyCard from "./SkeletonBountyCard";
import EmptyState from "./EmptyState";
import { ShortcutsHelpOverlay } from "./ShortcutsHelpOverlay";
import BountyDetailPage from "./BountyDetailPage";
import ContributorProfilePage from "./ContributorProfilePage";
import ContributorDashboard from "./ContributorDashboard";
import ErrorBoundary from "./ErrorBoundary";
import SubmissionChecklistModal, { type SubmissionFormData } from "./SubmissionChecklistModal";

const DARK_MODE_KEY = "stellar-bounty-board-theme";

function useDarkMode() {
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(DARK_MODE_KEY);
      if (stored !== null) return stored === "dark";
    } catch {
      // ignore
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", dark ? "dark" : "light");
    try {
      localStorage.setItem(DARK_MODE_KEY, dark ? "dark" : "light");
    } catch {
      // ignore
    }
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}

const initialForm: CreateBountyPayload = {
  repo: "ritik4ever/stellar-stream",
  issueNumber: 48,
  title: "",
  summary: "",
  maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  tokenSymbol: "XLM",
  amount: 150,
  deadlineDays: 14,
  labels: [{ name: "help wanted", color: "0075ca" }],
};

function validateStellarPublicKey(input: string): string | null {
  const value = input.trim();
  if (!value) return "Address is required.";
  if (!/^G[A-Z0-9]{55}$/.test(value))
    return "Enter a Stellar public key (starts with 'G', 56 characters)";
  return null;
}

const contributorStatuses: Array<BountyStatus | "all"> = [
  "all",
  "reserved",
  "submitted",
  "released",
  "refunded",
  "expired",
  "disputed",
];

type BountyAction = "reserve" | "submit" | "release" | "refund";

function formatTimestamp(value?: number): string {
  if (!value) return "-";
  return new Date(value * 1000).toLocaleString();
}

function App() {
  const { dark, toggle: toggleDark } = useDarkMode();
  const initialFilters = useMemo(() => readInitialFilters(), []);
  const [form, setForm] = useState<CreateBountyPayload>(initialForm);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [, setIssues] = useState<OpenIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showShortcutsOverlay, setShowShortcutsOverlay] = useState(false);
  const [isFormDirty, setIsFormDirty] = useState(false);

  useBeforeUnload(isFormDirty);

  useEffect(() => {
    function goOnline() {
      // setIsOffline(false);
    }
    function goOffline() {
      // setIsOffline(true);
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
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

  const [statusFilter, setStatusFilter] = useState<"all" | BountyStatus>(
    initialFilters.statusFilter
  );
  const [minReward, setMinReward] = useState(initialFilters.minReward);
  const [maxReward, setMaxReward] = useState(initialFilters.maxReward);
  const [repoFilter, setRepoFilter] = useState(initialFilters.repoFilter);
  const [tokenFilter, setTokenFilter] = useState(initialFilters.tokenFilter);
  const [sortOption, setSortOption] = useState(initialFilters.sortOption);
  const [sortDirection, setSortDirection] = useState(initialFilters.sortDirection);
  const [pathname, setPathname] = useState(window.location.pathname);

  const detailId = useMemo(() => {
    const match = pathname.match(/^\/bounties\/([^/]+)$/);
    return match ? decodeURIComponent(match[1] ?? "") : null;
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

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const [bountyData, issueData] = await Promise.all([
      listBounties(signal),
      listOpenIssues(signal),
    ]);
    setBounties(bountyData);
    setIssues(issueData);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function bootstrap() {
      try {
        await refresh(signal);
      } catch (err) {
        if (signal.aborted) return;
        console.error("Failed to load project data:", err);
      } finally {
        if (!signal.aborted) {
          setLoading(false);
        }
      }
    }

    void bootstrap();

    const timer = window.setInterval(() => {
      const pollController = new AbortController();
      void refresh(pollController.signal).catch(() => { });
    }, 7000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (pathname.startsWith("/bounties/") || pathname.startsWith("/repo/")) return;

    const params = new URLSearchParams();
    if (debouncedSearchQuery.trim() !== "") params.set("search", debouncedSearchQuery);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (minReward !== "") params.set("minReward", minReward);
    if (maxReward !== "") params.set("maxReward", maxReward);
    if (repoFilter !== "") params.set("repo", repoFilter);
    if (tokenFilter !== "") params.set("tokenSymbol", tokenFilter);
    if (sortOption !== "newest") params.set("sort", sortOption);
    if (sortDirection !== "desc") params.set("direction", sortDirection);

    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
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
      if (window.location.pathname.startsWith("/bounties/") || window.location.pathname.startsWith("/repo/"))
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
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setShowShortcutsOverlay((prev) => !prev);
      } else if (event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const navigate = useCallback((nextPath: string) => {
    if (nextPath === window.location.pathname) return;
    if (isFormDirty) {
      const confirmed = window.confirm(
        "You have unsaved changes in the bounty creation form. Are you sure you want to leave?",
      );
      if (!confirmed) return;
    }
    window.history.pushState(null, "", nextPath);
    setPathname(nextPath);
  }, [isFormDirty]);

  const handleOpenBounty = useCallback(
    (id: string) => {
      navigate(`/bounties/${encodeURIComponent(id)}`);
    },
    [navigate]
  );

  async function handleReserve(bounty: Bounty) {
    const contributor = window.prompt("Contributor Stellar address", bounty.contributor ?? "");
    if (!contributor) return;
    const contributorError = validateStellarPublicKey(contributor);
    if (contributorError) {
      window.alert(contributorError);
      return;
    }
    try {
      await reserveBounty(bounty.id, contributor.trim());
      await refresh();
      toast.success("Bounty reserved successfully!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reserve bounty.");
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
      toast.success("PR submitted successfully!");
    } catch (err) {
      setSubmissionModalError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmissionModalSubmitting(false);
    }
  }

  async function handleRelease(bounty: Bounty) {
    const maintainer = window.prompt("Maintainer Stellar address", bounty.maintainer);
    if (!maintainer) return;
    const maintainerError = validateStellarPublicKey(maintainer);
    if (maintainerError) {
      window.alert(maintainerError);
      return;
    }
    const transactionHash = window.prompt("Transaction hash (64 hex chars, optional)") ?? undefined;
    try {
      await releaseBounty(bounty.id, maintainer.trim(), transactionHash || undefined);
      await refresh();
      toast.success("Bounty released — payment sent!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to release bounty.");
    }
  }

  async function handleRefund(bounty: Bounty) {
    const maintainer = window.prompt("Maintainer Stellar address", bounty.maintainer);
    if (!maintainer) return;
    const maintainerError = validateStellarPublicKey(maintainer);
    if (maintainerError) {
      window.alert(maintainerError);
      return;
    }
    const transactionHash = window.prompt("Transaction hash (64 hex chars, optional)") ?? undefined;
    try {
      await refundBounty(bounty.id, maintainer.trim(), transactionHash || undefined);
      await refresh();
      toast.success("Bounty refunded successfully!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to refund bounty.");
    }
  }

  const renderActionButton = useCallback(
    (bounty: Bounty, action: { action: BountyAction; label: string; title: string }) => {
      const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (action.action === "reserve") void handleReserve(bounty);
        else if (action.action === "submit") void handleSubmit(bounty);
        else if (action.action === "release") void handleRelease(bounty);
        else if (action.action === "refund") void handleRefund(bounty);
      };

      return (
        <button
          key={action.action}
          type="button"
          className={action.action === "refund" ? "ghost-button" : "secondary-button"}
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

  const filteredBounties = useMemo(() => {
    const effectiveRepoFilter = repoRoute ? `${repoRoute.owner}/${repoRoute.name}` : repoFilter;
    return filterBounties(bounties, {
      searchQuery: debouncedSearchQuery,
      statusFilter,
      minReward,
      maxReward,
      repoFilter: effectiveRepoFilter,
      tokenFilter,
      sortOption,
      sortDirection,
    });
  }, [
    bounties,
    debouncedSearchQuery,
    statusFilter,
    minReward,
    maxReward,
    repoFilter,
    tokenFilter,
    sortOption,
    sortDirection,
    repoRoute,
  ]);

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
    debouncedSearchQuery.trim() !== "" ||
    statusFilter !== "all" ||
    minReward !== "" ||
    maxReward !== "" ||
    repoFilter !== "";

  const { emptyStateHeading, emptyStateMessage } = useMemo(() => {
    if (debouncedSearchQuery.trim()) {
      return {
        emptyStateHeading: `No results for "${debouncedSearchQuery.trim()}"`,
        emptyStateMessage: "Try a different search term or clear filters.",
      };
    }
    return {
      emptyStateHeading: "No bounties yet",
      emptyStateMessage: "Be the first to create one!",
    };
  }, [debouncedSearchQuery]);

  if (detailId) {
    const owner = detailBounty ? repoOwner(detailBounty.repo) : "";
    return (
      <ErrorBoundary componentName="BountyDetailPage">
        <Suspense fallback={<div className="empty-state">Loading bounty...</div>}>
          <BountyDetailPage
            bounty={detailBounty}
            loading={detailLoading}
            onBack={() => navigate("/")}
            owner={owner}
            avatarUrl={detailBounty ? `https://github.com/${owner}.png?size=72` : ""}
            statusCopy={statusCopy}
            actionCopy={actionCopy}
            renderActionButton={renderActionButton}
            formatTimestamp={formatTimestamp}
            bounties={bounties}
          />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (contributorRoute) {
    return (
      <ContributorProfilePage address={contributorRoute.address} onBack={() => navigate("/")} />
    );
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      // Validate required fields
      if (!form.repo.trim()) {
        toast.error("Repository is required.");
        return;
      }
      if (!form.title.trim()) {
        toast.error("Title is required.");
        return;
      }
      if (form.amount <= 0) {
        toast.error("Reward amount must be greater than 0.");
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
      toast.success("Bounty created successfully!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create bounty.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-container">
      <header className="main-header">
        <div className="header-content">
          <div className="logo" onClick={() => navigate("/")}>
            <Rocket className="logo-icon" />
            <h1>Stellar Bounty Board</h1>
          </div>
          <div className="header-actions">
            <button className="theme-toggle" onClick={toggleDark}>
              {dark ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </div>
      </header>

      <main className="main-content">
        <section className="dashboard-hero">
          <div className="hero-grid">
            <div className="hero-main">
              <h2>Fund GitHub issues with on-chain escrow</h2>
              <p>
                A decentralized bounty platform powered by Stellar. Reserve tasks, submit solutions,
                and get paid instantly.
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
                  {submitting ? "Creating..." : "Create Bounty"}
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

        <ContributorDashboard bounties={bounties} loading={loading} />

        <section className="board-section">
          <div className="board-filters">
            <div className="search-box">
              <Search size={18} />
              <input
                ref={searchInputRef}
                placeholder="Search by repo, title, or label..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="filter-chips">
              {contributorStatuses.map((status) => (
                <button
                  key={status}
                  className={`filter-chip ${statusFilter === status ? "active" : ""}`}
                  onClick={() => setStatusFilter(status)}
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
                setSearchQuery("");
                setStatusFilter("all");
              }}
            />
          )}
        </section>
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
