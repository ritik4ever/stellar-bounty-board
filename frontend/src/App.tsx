import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Coins,
  FolderGit2,
  HandCoins,
  Rocket,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import {
  createBounty,
  exportReleasedPayoutsCsv,
  listBounties,
  listOpenIssues,
  refundBounty,
  releaseBounty,
  reserveBounty,
  submitBounty,
} from "./api";
import { Bounty, BountyStatus, CreateBountyPayload, OpenIssue } from "./types";
import SkeletonBountyCard from "./SkeletonBountyCard";

const initialForm: CreateBountyPayload = {
  repo: "ritik4ever/stellar-stream",
  issueNumber: 48,
  title: "",
  summary: "",
  maintainer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  tokenSymbol: "XLM",
  amount: 150,
  deadlineDays: 14,
  labels: ["help wanted"],
};

const statusOptions: Array<{ value: "all" | BountyStatus; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "reserved", label: "Reserved" },
  { value: "submitted", label: "Submitted" },
  { value: "released", label: "Released" },
  { value: "refunded", label: "Refunded" },
  { value: "expired", label: "Expired" },
];

const statusOptionValues = new Set(statusOptions.map((option) => option.value));


const statusGlossary: Array<{
  status: BountyStatus;
  label: string;
  description: string;
}> = [
  {
    status: "open",
    label: "Open",
    description: "Anyone can reserve this bounty and start working.",
  },
  {
    status: "reserved",
    label: "Reserved",
    description: "One contributor has claimed it and is preparing a fix.",
  },
  {
    status: "submitted",
    label: "Submitted",
    description: "Work is in review while the maintainer checks the submission.",
  },
  {
    status: "released",
    label: "Released",
    description: "The submission was approved and the payout was sent.",
  },
  {
    status: "refunded",
    label: "Refunded",
    description: "The bounty was canceled and the reward went back to the maintainer.",
  },
  {
    status: "expired",
    label: "Expired",
    description: "The deadline passed before the work was completed.",
  },
];

const statusCopy: Record<BountyStatus, { label: string; description: string }> = Object.fromEntries(
  statusGlossary.map(({ status, label, description }) => [status, { label, description }]),
) as Record<BountyStatus, { label: string; description: string }>;

const actionCopy: Partial<Record<BountyStatus, Array<{ label: string; tone: string; tooltip: string }>>> = {
  open: [
    {
      label: "Reserve",
      tone: "secondary-button",
      tooltip: "Claim this bounty so others know you are taking the first pass.",
    },
    {
      label: "Refund",
      tone: "ghost-button",
      tooltip: "Cancel the bounty and return the reward to the maintainer.",
    },
  ],
  reserved: [
    {
      label: "Submit PR",
      tone: "secondary-button",
      tooltip: "Share your pull request or demo link for maintainer review.",
    },
    {
      label: "Refund",
      tone: "ghost-button",
      tooltip: "Return the reward if the reserved work will not move forward.",
    },
  ],
  submitted: [
    {
      label: "Release payout",
      tone: "primary-button",
      tooltip: "Approve the submission and send the reward to the contributor.",
    },
  ],
  expired: [
    {
      label: "Refund",
      tone: "ghost-button",
      tooltip: "Recover the locked reward after the deadline has passed.",
    },
  ],
};

function readInitialFilters(): {
  searchQuery: string;
  statusFilter: "all" | BountyStatus;
  minReward: string;
  maxReward: string;
} {
  if (typeof window === "undefined") {
    return {
      searchQuery: "",
      statusFilter: "all",
      minReward: "",
      maxReward: "",
    };
  }

  const params = new URLSearchParams(window.location.search);
  const rawStatus = params.get("status");
  const statusFilter =
    rawStatus && statusOptionValues.has(rawStatus as "all" | BountyStatus)
      ? (rawStatus as "all" | BountyStatus)
      : "all";

  return {
    searchQuery: params.get("search") ?? "",
    statusFilter,
    minReward: params.get("minReward") ?? "",
    maxReward: params.get("maxReward") ?? "",
  };
}

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

function App() {
  const initialFilters = useMemo(() => readInitialFilters(), []);
  const [form, setForm] = useState<CreateBountyPayload>(initialForm);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [issues, setIssues] = useState<OpenIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(initialFilters.searchQuery);
  const [statusFilter, setStatusFilter] = useState<"all" | BountyStatus>(initialFilters.statusFilter);
  const [minReward, setMinReward] = useState(initialFilters.minReward);
  const [maxReward, setMaxReward] = useState(initialFilters.maxReward);

  async function refresh(): Promise<void> {
    const [bountyData, issueData] = await Promise.all([listBounties(), listOpenIssues()]);
    setBounties(bountyData);
    setIssues(issueData);
  }

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        await refresh();
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load project data.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void bootstrap();
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 7000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();

    if (searchQuery.trim() !== "") {
      params.set("search", searchQuery);
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

    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }, [maxReward, minReward, searchQuery, statusFilter]);

  useEffect(() => {
    function handlePopState() {
      const filters = readInitialFilters();
      setSearchQuery(filters.searchQuery);
      setStatusFilter(filters.statusFilter);
      setMinReward(filters.minReward);
      setMaxReward(filters.maxReward);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const metrics = useMemo(() => {
    const activePool = bounties.filter((bounty) =>
      ["open", "reserved", "submitted"].includes(bounty.status),
    );
    return {
      liveBounties: activePool.length,
      fundedVolume: bounties.reduce((sum, bounty) => sum + bounty.amount, 0),
      openIssues: bounties.filter((bounty) => bounty.status === "open").length,
      shippedRewards: bounties.filter((bounty) => bounty.status === "released").length,
    };
  }, [bounties]);

  const rewardBounds = useMemo(() => {
    if (bounties.length === 0) {
      return { lowest: 0, highest: 0 };
    }

    return {
      lowest: Math.min(...bounties.map((bounty) => bounty.amount)),
      highest: Math.max(...bounties.map((bounty) => bounty.amount)),
    };
  }, [bounties]);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const parsedMinReward = minReward === "" ? null : Number(minReward);
  const parsedMaxReward = maxReward === "" ? null : Number(maxReward);

  const effectiveMinReward =
    parsedMinReward !== null && Number.isFinite(parsedMinReward) ? parsedMinReward : null;
  const effectiveMaxReward =
    parsedMaxReward !== null && Number.isFinite(parsedMaxReward) ? parsedMaxReward : null;

  const filteredBounties = useMemo(() => {
    return bounties.filter((bounty) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        [
          bounty.title,
          bounty.summary,
          bounty.repo,
          bounty.status,
          bounty.issueNumber.toString(),
          bounty.tokenSymbol,
          ...bounty.labels,
        ].some((value) => value.toLowerCase().includes(normalizedSearch));

      const matchesStatus = statusFilter === "all" || bounty.status === statusFilter;
      const matchesMinReward = effectiveMinReward === null || bounty.amount >= effectiveMinReward;
      const matchesMaxReward = effectiveMaxReward === null || bounty.amount <= effectiveMaxReward;

      return matchesSearch && matchesStatus && matchesMinReward && matchesMaxReward;
    });
  }, [
    bounties,
    effectiveMaxReward,
    effectiveMinReward,
    normalizedSearch,
    statusFilter,
  ]);

  const activeRewardLabel = useMemo(() => {
    if (effectiveMinReward === null && effectiveMaxReward === null) {
      return `Any reward (${rewardBounds.lowest}–${rewardBounds.highest} XLM available)`;
    }

    const lower = effectiveMinReward ?? rewardBounds.lowest;
    const upper = effectiveMaxReward ?? rewardBounds.highest;
    return `${lower}–${upper} XLM`;
  }, [effectiveMaxReward, effectiveMinReward, rewardBounds.highest, rewardBounds.lowest]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createBounty({
        ...form,
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

  async function handleReserve(bounty: Bounty) {
    const contributor = window.prompt("Contributor Stellar address", bounty.contributor ?? "");
    if (!contributor) return;
    try {
      setError(null);
      await reserveBounty(bounty.id, contributor);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reserve bounty.");
    }
  }

  async function handleSubmit(bounty: Bounty) {
    const contributor = window.prompt("Contributor Stellar address", bounty.contributor ?? "");
    if (!contributor) return;
    const submissionUrl = window.prompt("Pull request or demo URL");
    if (!submissionUrl) return;
    const notes = window.prompt("Optional notes for the maintainer") ?? undefined;

    try {
      setError(null);
      await submitBounty(bounty.id, contributor, submissionUrl, notes);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit bounty.");
    }
  }

  async function handleRelease(bounty: Bounty) {
    const maintainer = window.prompt("Maintainer Stellar address", bounty.maintainer);
    if (!maintainer) return;
    const transactionHash = window.prompt("Transaction hash (64 hex chars, optional)") ?? undefined;
    try {
      setError(null);
      await releaseBounty(bounty.id, maintainer, transactionHash || undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to release bounty.");
    }
  }

  async function handleRefund(bounty: Bounty) {
    const maintainer = window.prompt("Maintainer Stellar address", bounty.maintainer);
    if (!maintainer) return;
    const transactionHash = window.prompt("Transaction hash (64 hex chars, optional)") ?? undefined;
    try {
      setError(null);
      await refundBounty(bounty.id, maintainer, transactionHash || undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refund bounty.");
    }
  }


    }
  }

  return (
    <div className="page-shell">
      <div className="glow glow-left" />
      <div className="glow glow-right" />

      <header className="hero">
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
                />
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
                        .map((item) => item.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="help wanted, backend"
                />
              </label>
            </div>

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

          {loading ? (
            <div className="board-list">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonBountyCard key={i} />
              ))}
            </div>
          ) : filteredBounties.length > 0 ? (
            <div className="board-list">
              {filteredBounties.map((bounty) => (
                <article className="bounty-card" key={bounty.id}>
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
                    <div className="amount-chip">
                      {bounty.amount} {bounty.tokenSymbol}
                    </div>
                  </div>

                  <p className="bounty-summary">{bounty.summary}</p>

                  <div className="meta-grid">
                    <div>
                      <span className="meta-label">Issue</span>
                      <strong>
                        {bounty.repo} #{bounty.issueNumber}
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
                      <span className="chip" key={label}>
                        {label}
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
          ) : (
            <div className="empty-state">
              No bounties match the current search, status, and reward range filters.
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
              <p>{issue.summary}</p>
              <div className="chip-row">
                {issue.labels.map((label) => (
                  <span className="chip" key={label}>
                    {label}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default App;
