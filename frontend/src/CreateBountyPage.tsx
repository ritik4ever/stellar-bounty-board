import React, { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Rocket } from 'lucide-react';
import { createBounty } from './api';
import { useBeforeUnload } from './useBeforeUnload';
import { type CreateBountyPayload } from './types';

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

export default function CreateBountyPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<CreateBountyPayload>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [isFormDirty, setIsFormDirty] = useState(false);

  useBeforeUnload(isFormDirty);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
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
      const bounty = await createBounty({
        ...form,
        maintainer: form.maintainer.trim(),
        labels: form.labels.filter(Boolean),
      });
      setIsFormDirty(false);
      toast.success('Bounty created successfully!');
      // Redirect to the new bounty's detail page on successful creation
      navigate(`/bounties/${encodeURIComponent(bounty.id)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create bounty.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleDiscard() {
    setForm(initialForm);
    setIsFormDirty(false);
  }

  return (
    <div className="app-container">
      <header className="main-header">
        <div className="header-content">
          <div className="logo" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
            <Rocket className="logo-icon" />
            <h1>Stellar Bounty Board</h1>
          </div>
        </div>
      </header>

      <main className="main-content">
        <section className="dashboard-hero">
          <div className="hero-grid">
            <div className="hero-main">
              <button
                type="button"
                className="ghost-button"
                onClick={() => navigate('/')}
                style={{
                  marginBottom: '1rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
                aria-label="Back to bounty board"
              >
                <ArrowLeft size={16} />
                Back to board
              </button>

              <h2>Create New Bounty</h2>
              <p>
                Fund a GitHub issue with on-chain Stellar escrow. Fill in the details below to
                create a new bounty.
              </p>

              <form
                className="bounty-form"
                onSubmit={handleCreate}
                aria-label="Create bounty form"
                noValidate
              >
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
                      required
                      aria-required="true"
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
                      min={1}
                      required
                      aria-required="true"
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
                      required
                      aria-required="true"
                    />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Summary
                    <input
                      value={form.summary}
                      onChange={(e) => {
                        setForm({ ...form, summary: e.target.value });
                        setIsFormDirty(true);
                      }}
                      placeholder="Brief description of the work needed..."
                    />
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    Maintainer Stellar Address
                    <input
                      value={form.maintainer}
                      onChange={(e) => {
                        setForm({ ...form, maintainer: e.target.value });
                        setIsFormDirty(true);
                      }}
                      placeholder="G..."
                      required
                      aria-required="true"
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
                      min={1}
                      required
                      aria-required="true"
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
                  <label>
                    Deadline (days)
                    <input
                      type="number"
                      value={form.deadlineDays}
                      onChange={(e) => {
                        setForm({ ...form, deadlineDays: Number(e.target.value) });
                        setIsFormDirty(true);
                      }}
                      min={1}
                    />
                  </label>
                </div>
                <div className="form-actions">
                  <button type="submit" disabled={submitting}>
                    {submitting ? 'Creating...' : 'Create Bounty'}
                  </button>
                  {isFormDirty && (
                    <button type="button" className="ghost-button" onClick={handleDiscard}>
                      Discard
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
