import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Coins,
  FolderGit2,
  HandCoins,
  Rocket,
  ShieldCheck,
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
import { Bounty, CreateBountyPayload, OpenIssue } from "./types";
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
  const [form, setForm] = useState<CreateBountyPayload>(initialForm);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [issues, setIssues] = useState<OpenIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function handleExportReleasedPayouts() {
    try {
      setExporting(true);
      setError(null);
      const { blob, filename } = await exportReleasedPayoutsCsv();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export released payouts.");
    } finally {
      setExporting(false);
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

          {loading ? (
            <div className="board-list">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonBountyCard key={i} />
              ))}
            </div>
          ) : (
            <div className="board-list">
              {bounties.map((bounty) => (
                <article className="bounty-card" key={bounty.id}>
                  <div className="bounty-card__top">
                    <div>
                      <span className={`status-pill status-pill--${bounty.status}`}>
                        {bounty.status}
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

                  {bounty.submissionUrl && (
                    <a className="submission-link" href={bounty.submissionUrl} target="_blank" rel="noreferrer">
                      Review submission <ArrowUpRight size={16} />
                    </a>
                  )}

                  <div className="action-row">
                    {bounty.status === "open" && (
                      <button className="secondary-button" onClick={() => void handleReserve(bounty)}>
                        Reserve
                      </button>
                    )}
                    {bounty.status === "reserved" && (
                      <button className="secondary-button" onClick={() => void handleSubmit(bounty)}>
                        Submit PR
                      </button>
                    )}
                    {bounty.status === "submitted" && (
                      <button className="primary-button" onClick={() => void handleRelease(bounty)}>
                        Release payout
                      </button>
                    )}
                    {["open", "reserved", "expired"].includes(bounty.status) && (
                      <button className="ghost-button" onClick={() => void handleRefund(bounty)}>
                        Refund
                      </button>
                    )}
                  </div>
                </article>
              ))}
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

