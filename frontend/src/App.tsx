import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Coins,
  Download,
  ExternalLink,
  FileText,
  Filter,
  FolderGit2,
  GitBranch,
  HandCoins,
  Moon,
  Plus,
  Rocket,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Sun,
  Trash2,
  Upload,
  UserRound,
  X,
  ArrowUpDown,
} from "lucide-react";
import {
  createBounty,
  exportReleasedPayoutsCsv,
  getBounty,
  listBounties,
  listOpenIssues,
  refundBounty,
  releaseBounty,
  reserveBounty,
  submitBounty,
} from "./api";
import SubmissionChecklistModal, { type SubmissionFormData } from "./SubmissionChecklistModal";
import { BountyRecommendation, ContributorProfile, createDefaultProfile, generateRecommendations, updateProfileFromBounties } from "./recommendations";
import RecommendedBounties from "./RecommendedBounties";
import { statusCopy, actionCopy, readInitialFilters, FilterState, statusOptions, statusGlossary, sortOptions } from "./constants";
import { filterBounties, getRewardBounds, getActiveRewardLabel, getContributorMetrics, getUniqueRepos, getRepoMetrics, sortBounties, debounce, SortOption, SortState } from "./utils";
import { Bounty, CreateBountyPayload, OpenIssue, BountyStatus } from "./types";

import GitHubIssuePreviewCard from "./GitHubIssuePreviewCard";
import BountyDetailPage from "./BountyDetailPage";
import UsdAmount from "./UsdAmount";

import SkeletonBountyCard from "./SkeletonBountyCard";

const STELLAR_PUBLIC_KEY_HINT = "Expected Stellar public key (starts with G and is 56 characters).";
const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z2-7]{55}$/;

const DARK_MODE_KEY = "stellar-bounty-board:theme";

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



function formatRelativeDeadline(deadlineAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = deadlineAt - now;
  const days = Math.ceil(Math.abs(diff) / (24 * 60 * 60));
  if (diff >= 0) {
    return `${days} day${days === 1 ? "" : "s"} left`;
  }
  return `${days} day${days === 1 ? "" : "s"} overdue`;
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function validateStellarPublicKey(input: string): string | null {
  const value = input.trim();
  if (!value) return "Address is required.";
  if (!/^G[A-Z0-9]{55}$/.test(value)) return "Enter a Stellar public key (starts with 'G', 56 characters)";
  return null;
}


const contributorStatuses: Array<BountyStatus | "all"> = [
  "all",
  "reserved",
  "submitted",
  "released",
  "refunded",
  "expired",
];
const boardStatuses: Array<BountyStatus | "all"> = [
  "all",
  "open",
  "reserved",
  "submitted",
  "released",
  "refunded",
];

type BountyAction = "reserve" | "submit" | "release" | "refund";

function repoOwner(repo: string): string {
  return repo.split("/")[0] ?? repo;
}

function formatTimestamp(value?: number): string {
  if (!value) return "-";
  return new Date(value * 1000).toLocaleString();
}

function BountyAmount({ bounty }: { bounty: Bounty }) {
  return (
    <div className="amount-chip">
      <strong>{bounty.amount} {bounty.tokenSymbol}</strong>
      <UsdAmount amount={bounty.amount} tokenSymbol={bounty.tokenSymbol} />
    </div>
  );
}

function App() {
  const { dark, toggle: toggleDark } = useDarkMode();
  const initialFilters = useMemo(() => readInitialFilters(), []);
  const [form, setForm] = useState<CreateBountyPayload>(initialForm);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [issues, setIssues] = useState<OpenIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState(initialFilters.searchQuery);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(initialFilters.searchQuery);
  
  // Debounced search update
  const debouncedSetSearchQuery = useMemo(() => debounce(setDebouncedSearchQuery, 300), []);
  
  useEffect(() => {
    debouncedSetSearchQuery(searchQuery);
  }, [searchQuery, debouncedSetSearchQuery]);
  const [statusFilter, setStatusFilter] = useState<"all" | BountyStatus>(initialFilters.statusFilter);
  const [minReward, setMinReward] = useState(initialFilters.minReward);
  const [maxReward, setMaxReward] = useState(initialFilters.maxReward);
  const [repoFilter, setRepoFilter] = useState(initialFilters.repoFilter);
  const [sortOption, setSortOption] = useState(initialFilters.sortOption);
  const [sortDirection, setSortDirection] = useState(initialFilters.sortDirection);
  const [pathname, setPathname] = useState(window.location.pathname);
  const [profileContributor, setProfileContributor] = useState("");
  const [profileStatus, setProfileStatus] = useState<"all" | BountyStatus>("all");

  // Submission checklist modal state
  const [submissionModalBounty, setSubmissionModalBounty] = useState<Bounty | null>(null);
  const [submissionModalSubmitting, setSubmissionModalSubmitting] = useState(false);
  const [submissionModalError, setSubmissionModalError] = useState<string | null>(null);
  const [submissionModalData, setSubmissionModalData] = useState<Partial<SubmissionFormData> | undefined>(undefined);



  async function refresh(signal?: AbortSignal): Promise<void> {
    const [bountyData, issueData] = await Promise.all([
      listBounties(signal),
      listOpenIssues(signal),
    ]);
    setBounties(bountyData);
    setIssues(issueData);
  }

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function bootstrap() {
      try {
        await refresh(signal);
      } catch (err) {
        if (signal.aborted) return; // component unmounted — ignore
        setError(err instanceof Error ? err.message : "Failed to load project data.");
      } finally {
        if (!signal.aborted) {
          setLoading(false);
        }
      }
    }

    void bootstrap();

    const timer = window.setInterval(() => {
      const pollController = new AbortController();
      void refresh(pollController.signal).catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          // Silent poll failure — do not surface to user
        }
      });
    }, 7000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (pathname.startsWith("/bounties/") || pathname.startsWith("/repo/")) return;
    const params = new URLSearchParams();

    if (debouncedSearchQuery.trim() !== "") {
      params.set("search", debouncedSearchQuery);
    }

    if (statusFilter !== "all") {
      params.set("status", statusFilter);
    }

    if (minReward !== "") {
      params.set("minReward", minReward);
    }

    if (maxReward !== "") {
      params.set("maxReward", maxReward);
    }

    if (repoFilter !== "") {
      params.set("repo", repoFilter);
    }

    if (sortOption !== "newest") {
      params.set("sort", sortOption);
    }

    if (sortDirection !== "desc") {
      params.set("direction", sortDirection);
    }

    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }, [maxReward, minReward, pathname, debouncedSearchQuery, statusFilter, repoFilter, sortOption, sortDirection]);

  useEffect(() => {
    function handlePopState() {
      const nextPathname = window.location.pathname;
      setPathname(nextPathname);

      if (nextPathname.startsWith("/bounties/") || nextPathname.startsWith("/repo/")) return;
      const filters = readInitialFilters();
      setSearchQuery(filters.searchQuery);
      setStatusFilter(filters.statusFilter);
      setMinReward(filters.minReward);
      setMaxReward(filters.maxReward);
      setRepoFilter(filters.repoFilter);
      setSortOption(filters.sortOption);
      setSortDirection(filters.sortDirection);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(nextPath: string) {
    if (nextPath === window.location.pathname) return;
    window.history.pushState(null, "", nextPath);
    setPathname(nextPath);
  }

  const metrics = useMemo(() => {
    const activePool = bounties.filter((bounty: Bounty) =>
      ["open", "reserved", "submitted"].includes(bounty.status),
    );
    return {
      liveBounties: activePool.length,
      fundedVolume: bounties.reduce((sum: number, bounty: Bounty) => sum + bounty.amount, 0),
      openIssues: bounties.filter((bounty: Bounty) => bounty.status === "open").length,
      shippedRewards: bounties.filter((bounty: Bounty) => bounty.status === "released").length,
    };
  }, [bounties]);

  const uniqueRepos = useMemo(() => {
    return getUniqueRepos(bounties);
  }, [bounties]);

  const rewardBounds = useMemo(() => {
    return getRewardBounds(bounties);
  }, [bounties]);

  const activeRewardLabel = useMemo(() => {
    return getActiveRewardLabel(minReward, maxReward, rewardBounds);
  }, [minReward, maxReward, rewardBounds]);

  const contributorMetrics = useMemo(() => {
    return getContributorMetrics(bounties, profileContributor);
  }, [bounties, profileContributor]);

  const [profile, setProfile] = useState(() => createDefaultProfile());
  const [detailBounty, setDetailBounty] = useState<Bounty | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const recommendations = useMemo(() => {
    return generateRecommendations(bounties, profile);
  }, [bounties, profile]);

  function clearFilters() {
    setSearchQuery("");
    setStatusFilter("all");
    setMinReward("");
    setMaxReward("");
    setRepoFilter("");
    setSortOption("newest");
    setSortDirection("desc");
  }

  async function handleExportReleasedPayouts() {
    setExporting(true);
    try {
      await exportReleasedPayoutsCsv();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export payouts.");
    } finally {
      setExporting(false);
    }
  }




  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const maintainerError = validateStellarPublicKey(form.maintainer);
      if (maintainerError) {
        setError(`Maintainer address: ${maintainerError}`);
        return;
      }
      await createBounty({
        ...form,
        maintainer: form.maintainer.trim(),
        labels: form.labels.filter(Boolean),
      });
      setForm({
        ...initialForm,
        issueNumber: form.issueNumber + 1,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create bounty.");
    } finally {
      setSubmitting(false);
    }
  }

  function renderActionButton(
    bounty: Bounty,
    action: { action: BountyAction; label: string; title: string },
  ): ReactNode {
    const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (action.action === "reserve") {
        void handleReserve(bounty);
        return;
      }
      if (action.action === "submit") {
        void handleSubmit(bounty);
        return;
      }
      if (action.action === "release") {
        void handleRelease(bounty);
        return;
      }
      void handleRefund(bounty);
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
  }

  const detailId = useMemo(() => {
    const match = pathname.match(/^\/bounties\/([^/]+)$/);
    return match ? decodeURIComponent(match[1] ?? "") : null;
  }, [pathname]);

  const repoRoute = useMemo(() => {
    const match = pathname.match(/^\/repo\/([^/]+)\/([^/]+)$/);
    return match ? { owner: decodeURIComponent(match[1]), name: decodeURIComponent(match[2]) } : null;
  }, [pathname]);

  // Fetch single bounty via dedicated API endpoint instead of filtering the full list
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
    const filtered = filterBounties(bounties, {
      searchQuery: debouncedSearchQuery,
      statusFilter,
      minReward,
      maxReward,
      repoFilter: effectiveRepoFilter,
      sortOption,
      sortDirection,
    });
    
    // Apply sorting
    return sortBounties(filtered, { option: sortOption, direction: sortDirection });
  }, [bounties, debouncedSearchQuery, statusFilter, minReward, maxReward, repoFilter, repoRoute, sortOption, sortDirection]);

  const groupedBounties = useMemo(() => {
    if (repoRoute) {
      return { [repoRoute.owner + '/' + repoRoute.name]: filteredBounties };
    }
    const groups: Record<string, typeof filteredBounties> = {};
    filteredBounties.forEach((bounty) => {
      if (!groups[bounty.repo]) {
        groups[bounty.repo] = [];
      }
      groups[bounty.repo].push(bounty);
    });
    return groups;
  }, [filteredBounties, repoRoute]);

  if (detailId) {
    const bounty = detailBounty;
    const owner = bounty ? repoOwner(bounty.repo) : "";
    const avatarUrl = bounty ? `https://github.com/${owner}.png?size=72` : "";

    return (
      <BountyDetailPage
        bounty={bounty}
        loading={detailLoading}
        onBack={() => navigate("/")}
        owner={owner}
        avatarUrl={avatarUrl}
        statusCopy={statusCopy}
        actionCopy={actionCopy}
        renderActionButton={renderActionButton}
        formatTimestamp={formatTimestamp}
      />
    );
  }

  async function handleReserve(bounty: Bounty) {
    const contributor = window.prompt("Contributor Stellar address", bounty.contributor ?? "");
    if (!contributor) return;
    const contributorError = validateStellarPublicKey(contributor);
    if (contributorError) {
      window.alert(contributorError);
      return;
    }
    try {
      setError(null);
      await reserveBounty(bounty.id, contributor.trim());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reserve bounty.");
    }
  }

  async function handleSubmit(bounty: Bounty) {
    setSubmissionModalBounty(bounty);
    setSubmissionModalError(null);
    // Preserve any previously entered data for this bounty
    setSubmissionModalData(undefined);
  }

  async function handleSubmissionConfirm(data: SubmissionFormData) {
    if (!submissionModalBounty) return;
    setSubmissionModalSubmitting(true);
    setSubmissionModalError(null);
    // Preserve entered data so it survives a failed submission
    setSubmissionModalData(data);
    try {
      setError(null);
      await submitBounty(
        submissionModalBounty.id,
        data.contributor,
        data.prLink,
        data.notes || undefined,
      );
      setSubmissionModalBounty(null);
      setSubmissionModalData(undefined);
      await refresh();
    } catch (err) {
      setSubmissionModalError(err instanceof Error ? err.message : "Failed to submit bounty.");
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
      setError(null);
      await releaseBounty(bounty.id, maintainer.trim(), transactionHash || undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to release bounty.");
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
      setError(null);
      await refundBounty(bounty.id, maintainer.trim(), transactionHash || undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refund bounty.");
    }
  }


  return (
    <div className="page-shell">
      <div className="glow glow-left" />
      <div className="glow glow-right" />

      <header className="hero">
        <button
          type="button"
          className="dark-mode-toggle"
          onClick={toggleDark}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <div className="hero-copy">
          <span className="eyebrow">Stellar + Open Source</span>
          <h1>Fund GitHub issues with on-chain style escrow.</h1>
          <p>
            Stellar Bounty Board turns backlog items into funded contribution lanes.
            Maintainers lock a reward, contributors reserve the work, and payout flows
            through a simple review lifecycle.
          </p>
          <div className="hero-actions">
            <a href="#create" className="primary-link">
              Launch a bounty
            </a>
            <a href="#issues" className="secondary-link">
              Contribution backlog
            </a>
            <button
              type="button"
              className="secondary-link"
              disabled={exporting}
              onClick={() => void handleExportReleasedPayouts()}
            >
              {exporting ? "Exporting..." : "Export released payouts (CSV)"}
            </button>
          </div>
        </div>

        <section className="hero-panel">
          <div className="hero-panel__row">
            <ShieldCheck size={18} />
            <span>Escrow-first maintainer controls</span>
          </div>
          <div className="hero-panel__row">
            <FolderGit2 size={18} />
            <span>GitHub issue and PR-linked lifecycle</span>
          </div>
          <div className="hero-panel__row">
            <Coins size={18} />
            <span>Built to graduate from demo backend to Soroban source of truth</span>
          </div>
        </section>
      </header>

      {repoRoute && (
        <section className="hero-panel">
          <div className="hero-panel__row">
            <GitBranch size={18} />
            <span>
              <strong>{repoRoute.owner}/{repoRoute.name}</strong> repository
            </span>
          </div>
          <div className="hero-panel__row">
            <ExternalLink size={18} />
            <span>
              <a 
                href={`https://github.com/${repoRoute.owner}/${repoRoute.name}`}
                target="_blank"
                rel="noreferrer"
                className="inline-link"
              >
                View on GitHub
              </a>
            </span>
          </div>
          <div className="hero-panel__row">
            <ArrowUpRight size={18} />
            <span>
              <button 
                className="ghost-button"
                onClick={() => navigate("/")}
              >
                View all repositories
              </button>
            </span>
          </div>
        </section>
      )}

      <section className="metrics">
        <article className="metric-card">
          <span>Live bounties</span>
          <strong>{metrics.liveBounties}</strong>
        </article>
        <article className="metric-card">
          <span>Funded volume</span>
          <strong>{metrics.fundedVolume} XLM</strong>
        </article>
        <article className="metric-card">
          <span>Open to claim</span>
          <strong>{metrics.openIssues}</strong>
        </article>
        <article className="metric-card">
          <span>Released payouts</span>
          <strong>{metrics.shippedRewards}</strong>
        </article>
      </section>

      {error && <div className="error-banner">{error}</div>}

      {profileContributor && (
        <RecommendedBounties 
          recommendations={recommendations} 
          loading={loading} 
        />
      )}

      <main className="content-grid">
        <section className="panel form-panel" id="create">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Maintainer flow</span>
              <h2>Create a bounty</h2>
            </div>
            <Rocket size={18} />
          </div>

          <form className="bounty-form" onSubmit={handleCreate}>
            <label>
              Repository
              <input
                value={form.repo}
                onChange={(event) => setForm({ ...form, repo: event.target.value })}
                placeholder="owner/repo"
              />
            </label>

            <div className="two-up">
              <label>
                Issue number
                <input
                  type="number"
                  value={form.issueNumber}
                  onChange={(event) =>
                    setForm({ ...form, issueNumber: Number(event.target.value) })
                  }
                />
              </label>

              <label>
                Reward
                <input
                  type="number"
                  min="1"
                  value={form.amount}
                  onChange={(event) => setForm({ ...form, amount: Number(event.target.value) })}
                />
              </label>
            </div>

            <label>
              Issue title
              <input
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="Example: Add WebSocket payout updates"
              />
            </label>

            <label>
              Summary
              <textarea
                value={form.summary}
                onChange={(event) => setForm({ ...form, summary: event.target.value })}
                placeholder="What should a contributor build?"
                rows={4}
              />
            </label>

            <div className="two-up">
              <label>
                Maintainer address
                <input
                  value={form.maintainer}
                  onChange={(event) => setForm({ ...form, maintainer: event.target.value })}
                  placeholder="G... (56 chars)"
                  inputMode="text"
                  autoComplete="off"
                  aria-invalid={Boolean(form.maintainer.trim() && validateStellarPublicKey(form.maintainer))}
                />
                <small className="field-hint">Enter a Stellar public key (starts with 'G', 56 characters)</small>
                {form.maintainer.trim() && validateStellarPublicKey(form.maintainer) && (
                  <small className="field-error">{validateStellarPublicKey(form.maintainer)}</small>
                )}
              </label>

              <label>
                Token
                <input
                  value={form.tokenSymbol}
                  onChange={(event) => setForm({ ...form, tokenSymbol: event.target.value })}
                />
              </label>
            </div>

            <div className="two-up">
              <label>
                Deadline in days
                <input
                  type="number"
                  min="1"
                  max="90"
                  value={form.deadlineDays}
                  onChange={(event) =>
                    setForm({ ...form, deadlineDays: Number(event.target.value) })
                  }
                />
              </label>

              <label>
                Labels
                <input
                  value={form.labels.join(", ")}
                  onChange={(event) =>
  setForm({
    ...form,
    labels: event.target.value
      .split(",")
      .map((item) => ({ name: item.trim(), color: "0075ca" }))
      .filter((item) => item.name !== ""),
  })
}
placeholder="help wanted, backend"
/>
              </label>
            </div>

            <GitHubIssuePreviewCard
              repo={form.repo}
              issueNumber={form.issueNumber}
              title={form.title}
              labels={form.labels}
            />

            <button className="primary-button" disabled={submitting}>
              {submitting ? "Publishing..." : "Publish bounty"}
            </button>
          </form>
        </section>

        <section className="panel board-panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Contributor flow</span>
              <h2>Bounty board</h2>
            </div>
            <div className="board-sort">
              <label className="board-sort__label">
                <ArrowUpDown size={16} />
                <span>Amount</span>
                <select
                  value={sortOption === "reward-high" && sortDirection === "desc"
                    ? "reward-high-desc"
                    : sortOption === "reward-low" && sortDirection === "asc"
                    ? "reward-low-asc"
                    : "reward-high-desc"
                  }
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "reward-high-desc") {
                      setSortOption("reward-high");
                      setSortDirection("desc");
                    } else if (value === "reward-low-asc") {
                      setSortOption("reward-low");
                      setSortDirection("asc");
                    }
                  }}
                >
                  <option value="reward-high-desc">High → Low</option>
                  <option value="reward-low-asc">Low → High</option>
                </select>
              </label>
            </div>
            <HandCoins size={18} />
          </div>

          <div className="board-filters">
            <div className="board-filters__header">
              <div>
                <span className="panel-kicker">Board filters</span>
                <p>
                  Showing <strong>{filteredBounties.length}</strong> of <strong>{bounties.length}</strong>{" "}
                  bounties
                </p>
              </div>
              <button className="ghost-button filter-reset" type="button" onClick={clearFilters}>
                Clear filters
              </button>
            </div>

            <div className="filter-grid">
              <label className="filter-field filter-field--search">
                <span>Search</span>
                <div className="input-with-icon">
                  <Search size={16} />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search repo, title, labels, status"
                  />
                </div>
              </label>

              <label className="filter-field">
                <span>Status</span>
                <div className="input-with-icon">
                  <SlidersHorizontal size={16} />
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as "all" | BountyStatus)}
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="filter-field">
                <span>Repository</span>
                <div className="input-with-icon">
                  <GitBranch size={16} />
                  <select
                    value={repoFilter}
                    onChange={(event) => setRepoFilter(event.target.value)}
                  >
                    <option value="">All repositories</option>
                    {uniqueRepos.map((repo) => (
                      <option key={repo} value={repo}>
                        {repo}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="filter-field">
                <span>Min reward</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={minReward}
                  onChange={(event) => setMinReward(event.target.value)}
                  placeholder={rewardBounds.lowest > 0 ? `${rewardBounds.lowest}` : "0"}
                />
              </label>

              <label className="filter-field">
                <span>Max reward</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={maxReward}
                  onChange={(event) => setMaxReward(event.target.value)}
                  placeholder={rewardBounds.highest > 0 ? `${rewardBounds.highest}` : "No limit"}
                />
              </label>

              <label className="filter-field">
                <span>Sort by</span>
                <div className="input-with-icon">
                  <ArrowUpDown size={16} />
                  <select
                    value={sortOption}
                    onChange={(event) => {
                      const newOption = event.target.value as SortOption;
                      setSortOption(newOption);
                      // Set default direction for this sort option
                      const optionConfig = sortOptions.find(opt => opt.value === newOption);
                      if (optionConfig) {
                        setSortDirection(optionConfig.direction);
                      }
                    }}
                  >
                    {sortOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            </div>

            <div className="active-range" aria-live="polite">
              <span className="active-range__label">Active reward range</span>
              <strong>{activeRewardLabel}</strong>
            </div>
          </div>

          <section className="status-glossary" aria-labelledby="status-glossary-title">
            <div className="status-glossary__header">
              <div>
                <span className="panel-kicker">Contributor guide</span>
                <h3 id="status-glossary-title">Status quick guide</h3>
              </div>
              <span className="status-glossary__hint">Hover or tap pills and buttons for a short explanation.</span>
            </div>
            <div className="status-glossary__list">
              {statusGlossary.map((item) => (
                <article className="status-glossary__item" key={item.status}>
                  <span className={`status-pill status-pill--${item.status}`}>{item.label}</span>
                  <p>{item.description}</p>
                </article>
              ))}
            </div>
          </section>

          <div className="board-status-pills" role="tablist" aria-label="Filter bounties by status">
            {boardStatuses.map((status) => (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={statusFilter === status}
                className={`filter-chip ${statusFilter === status ? "filter-chip--active" : ""}`}
                onClick={() => setStatusFilter(status)}
              >
                {status === "all" ? "All" : statusCopy[status].label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="board-list">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonBountyCard key={i} />
              ))}
            </div>
          ) : Object.keys(groupedBounties).length > 0 ? (
            <div className="board-list">
              {Object.entries(groupedBounties).map(([repo, repoBounties]) => (
                <div key={repo} className="repo-group">
                  <div className="repo-group__header">
                    <h3 
                      className="repo-group__title"
                      onClick={() => navigate(`/repo/${repo.split('/')[0]}/${repo.split('/')[1]}`)}
                      role="link"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          navigate(`/repo/${repo.split('/')[0]}/${repo.split('/')[1]}`);
                        }
                      }}
                    >
                      {repo}
                    </h3>
                    <span className="repo-count">{repoBounties.length} bounties</span>
                  </div>
                  <div className="repo-group__metrics">
                    <div className="repo-metric">
                      <span className="repo-metric__label">Open</span>
                      <span className="repo-metric__value">{repoBounties.filter(b => b.status === 'open').length}</span>
                    </div>
                    <div className="repo-metric">
                      <span className="repo-metric__label">Funded</span>
                      <span className="repo-metric__value">{repoBounties.reduce((sum, b) => sum + b.amount, 0)} XLM</span>
                    </div>
                    <div className="repo-metric">
                      <span className="repo-metric__label">Paid</span>
                      <span className="repo-metric__value">{repoBounties.filter(b => b.status === 'released').reduce((sum, b) => sum + b.amount, 0)} XLM</span>
                    </div>
                  </div>
                  <div className="repo-group__bounties">
                    {repoBounties.map((bounty) => (
                <article
                  className="bounty-card"
                  key={bounty.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(`/bounties/${encodeURIComponent(bounty.id)}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(`/bounties/${encodeURIComponent(bounty.id)}`);
                    }
                  }}
                >
                  <div className="bounty-card__top">
                    <div>
                      <span
                        className={`status-pill status-pill--${bounty.status}`}
                        title={statusCopy[bounty.status].description}
                        aria-label={`${statusCopy[bounty.status].label}: ${statusCopy[bounty.status].description}`}
                      >
                        {statusCopy[bounty.status].label}
                      </span>
                      <h3>{bounty.title}</h3>
                    </div>

                  </div>

                  <p className="bounty-summary">{bounty.summary}</p>

                  <div className="meta-grid">
                    <div>
                      <span className="meta-label">Issue</span>
                      <strong>
                        <a
                          className="inline-link"
                          href={`https://github.com/${bounty.repo}/issues/${bounty.issueNumber}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {bounty.repo} #{bounty.issueNumber}
                        </a>
                      </strong>
                    </div>
                    <div>
                      <span className="meta-label">Deadline</span>
                      <strong>{formatRelativeDeadline(bounty.deadlineAt)}</strong>
                    </div>
                    <div>
                      <span className="meta-label">Maintainer</span>
                      <strong>{shortAddress(bounty.maintainer)}</strong>
                    </div>
                    <div>
                      <span className="meta-label">Contributor</span>
                      <strong>{bounty.contributor ? shortAddress(bounty.contributor) : "Open"}</strong>
                    </div>
                    {bounty.status === "released" && bounty.releasedTxHash && (
                      <div>
                        <span className="meta-label">Release tx</span>
                        <strong>{`${bounty.releasedTxHash.slice(0, 10)}...`}</strong>
                      </div>
                    )}
                    {bounty.status === "refunded" && bounty.refundedTxHash && (
                      <div>
                        <span className="meta-label">Refund tx</span>
                        <strong>{`${bounty.refundedTxHash.slice(0, 10)}...`}</strong>
                      </div>
                    )}
                  </div>

                  <div className="chip-row">
                    {bounty.labels.map((label) => (
                      <span className="chip" key={label.name}>
  {label.name}
</span>
                    ))}
                  </div>

                  <p className="status-helper">
                    <strong>{statusCopy[bounty.status].label}:</strong> {statusCopy[bounty.status].description}
                  </p>

                  {bounty.submissionUrl && (
                    <a className="submission-link" href={bounty.submissionUrl} target="_blank" rel="noreferrer">
                      Review submission <ArrowUpRight size={16} />
                    </a>
                  )}

                  <div className="action-row">
                    {(actionCopy[bounty.status] ?? []).map((action) => renderActionButton(bounty, action))}
                  </div>
                </article>
              ))}
              </div>
            </div>
          ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state__content">
                <h3>No bounties found</h3>
                <p>
                  {debouncedSearchQuery && (
                    <>No bounties match "<strong>{debouncedSearchQuery}</strong>"</>
                  ) || statusFilter !== "all" || minReward || maxReward || repoFilter ? (
                    <>No bounties match the current filters</>
                  ) : (
                    <>No bounties available yet</>
                  )}
                </p>
                <div className="empty-state__suggestions">
                  <p><strong>Suggestions:</strong></p>
                  <ul>
                    <li>Try adjusting your search terms or filters</li>
                    <li>Check back later for new bounties</li>
                    <li>Browse all repositories to see available opportunities</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      <section className="panel issues-panel" id="issues">
        <div className="panel-header">
          <div>
            <span className="panel-kicker">Open source angle</span>
            <h2>Issue drafts to open next</h2>
          </div>
          <FolderGit2 size={18} />
        </div>

        <div className="issue-list">
          {issues.map((issue) => (
            <article className="issue-card" key={issue.id}>
              <div className="issue-card__top">
                <strong>{issue.id}</strong>
                <span className={`impact-chip impact-chip--${issue.impact}`}>{issue.impact}</span>
              </div>
              <h3>{issue.title}</h3>
              <p> className="items-center text-center"{issue.summary}</p>
              <div className="chip-row">
                {issue.labels.map((label) => (
                  <span className="chip" key={label.name}>
  {label.name}
</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel profile-panel" id="profile">
        <div className="panel-header">
          <div>
            <span className="panel-kicker">Contributor angle</span>
            <h2>Contributor profile</h2>
          </div>
          <UserRound size={18} />
        </div>

        <div className="profile-controls">
          <label>
            Contributor address
            <input
              value={profileContributor}
              onChange={(event) => setProfileContributor(event.target.value)}
              placeholder="G... (Stellar address)"
              inputMode="text"
              autoComplete="off"
              aria-invalid={Boolean(profileContributor.trim() && validateStellarPublicKey(profileContributor))}
            />
            <small className="field-hint">Enter a Stellar public key (starts with 'G', 56 characters)</small>
            {profileContributor.trim() && validateStellarPublicKey(profileContributor) && (
              <small className="field-error">{validateStellarPublicKey(profileContributor)}</small>
            )}
          </label>

          <div className="filter-row" role="tablist" aria-label="Filter by bounty status">
            {contributorStatuses.map((status) => (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={profileStatus === status}
                className={`filter-chip ${profileStatus === status ? "filter-chip--active" : ""}`}
                onClick={() => setProfileStatus(status)}
                disabled={!contributorMetrics.contributor && status !== "all"}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="empty-state">Loading contributor history...</div>
        ) : !contributorMetrics.contributor ? (
          <div className="empty-state">
            Enter a contributor address to see reserved, submitted, and released bounties plus total
            earnings.
          </div>
        ) : contributorMetrics.filtered.length === 0 ? (
          <div className="empty-state">
            No bounties found for <strong>{shortAddress(contributorMetrics.contributor)}</strong>
            {profileStatus === "all" ? "." : ` in "${profileStatus}" status.`}
          </div>
        ) : (
          <div className="profile-grid">
            <div className="profile-metrics">
              <div className="profile-metric">
                <span className="meta-label">Reserved</span>
                <strong>{contributorMetrics.countsByStatus.get("reserved") ?? 0}</strong>
              </div>
              <div className="profile-metric">
                <span className="meta-label">Submitted</span>
                <strong>{contributorMetrics.countsByStatus.get("submitted") ?? 0}</strong>
              </div>
              <div className="profile-metric">
                <span className="meta-label">Released</span>
                <strong>{contributorMetrics.countsByStatus.get("released") ?? 0}</strong>
              </div>
              <div className="profile-metric">
                <span className="meta-label">Refunded</span>
                <strong>{contributorMetrics.countsByStatus.get("refunded") ?? 0}</strong>
              </div>
              <div className="profile-metric">
                <span className="meta-label">Expired</span>
                <strong>{contributorMetrics.countsByStatus.get("expired") ?? 0}</strong>
              </div>
            </div>

            <div className="profile-earnings">
              <span className="meta-label">Total earnings (released)</span>
              <div className="earnings-row">
                {Array.from(contributorMetrics.releasedTotalsByAsset.entries()).length === 0 ? (
                  <strong>0</strong>
                ) : (
                  Array.from(contributorMetrics.releasedTotalsByAsset.entries()).map(([asset, total]) => (
                    <div className="earnings-chip" key={asset}>
                      <strong>{total}</strong>
                      <span>{asset}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="profile-list">
              {contributorMetrics.filtered.map((bounty) => (
                <article className="bounty-card" key={bounty.id}>
                  <div className="bounty-card__top">
                    <div>
                      <span className={`status-pill status-pill--${bounty.status}`}>{bounty.status}</span>
                      <h3>{bounty.title}</h3>
                    </div>
                    <BountyAmount bounty={bounty} />
                  </div>

                  <p className="bounty-summary">{bounty.summary}</p>

                  <div className="meta-grid">
                    <div>
                      <span className="meta-label">Issue</span>
                      <strong>
                        <a
                          className="inline-link"
                          href={`https://github.com/${bounty.repo}/issues/${bounty.issueNumber}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {bounty.repo} #{bounty.issueNumber}
                        </a>
                      </strong>
                    </div>
                    <div>
                      <span className="meta-label">Maintainer</span>
                      <strong>{shortAddress(bounty.maintainer)}</strong>
                    </div>
                    {bounty.submissionUrl && (
                      <div>
                        <span className="meta-label">Submission</span>
                        <strong>
                          <a className="inline-link" href={bounty.submissionUrl} target="_blank" rel="noreferrer">
                            View link
                          </a>
                        </strong>
                      </div>
                    )}
                    {bounty.status === "released" && bounty.releasedTxHash && (
                      <div>
                        <span className="meta-label">Release tx</span>
                        <strong>{`${bounty.releasedTxHash.slice(0, 10)}...`}</strong>
                      </div>
                    )}
                    {bounty.status === "refunded" && bounty.refundedTxHash && (
                      <div>
                        <span className="meta-label">Refund tx</span>
                        <strong>{`${bounty.refundedTxHash.slice(0, 10)}...`}</strong>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      {submissionModalBounty && (
        <SubmissionChecklistModal
          bounty={submissionModalBounty}
          initialData={submissionModalData}
          submitting={submissionModalSubmitting}
          error={submissionModalError}
          onSubmit={(data) => void handleSubmissionConfirm(data)}
          onClose={() => {
            if (!submissionModalSubmitting) {
              setSubmissionModalBounty(null);
              setSubmissionModalError(null);
            }
          }}
        />
      )}
    </div>
  );
}

export default App;
