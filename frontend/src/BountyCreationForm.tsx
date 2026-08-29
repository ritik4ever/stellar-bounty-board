import React, { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { type CreateBountyPayload } from "./types";
import { validateStellarPublicKey } from "./utils";
import { useBeforeUnload } from "./useBeforeUnload";

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

interface BountyCreationFormProps {
  onSubmit: (payload: CreateBountyPayload) => Promise<void>;
  onDirtyChange?: (isDirty: boolean) => void;
}

export default function BountyCreationForm({ onSubmit, onDirtyChange }: BountyCreationFormProps) {
  const [form, setForm] = useState<CreateBountyPayload>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [isFormDirty, setIsFormDirty] = useState(false);

  useBeforeUnload(isFormDirty);

  const updateDirtyState = (dirty: boolean) => {
    setIsFormDirty(dirty);
    onDirtyChange?.(dirty);
  };

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

      const payload = {
        ...form,
        maintainer: form.maintainer.trim(),
        labels: form.labels.filter(Boolean),
      };

      await onSubmit(payload);

      setForm({ ...initialForm, issueNumber: form.issueNumber + 1 });
      updateDirtyState(false);
    } catch (err) {
      // Allow parent to handle/toast error, keep form state
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="bounty-form" onSubmit={handleCreate}>
      <div className="form-row">
        <label>
          Repository
          <input
            value={form.repo}
            onChange={(e) => {
              setForm({ ...form, repo: e.target.value });
              updateDirtyState(true);
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
              updateDirtyState(true);
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
              updateDirtyState(true);
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
              updateDirtyState(true);
            }}
          />
        </label>
        <label>
          Asset
          <select
            value={form.tokenSymbol}
            onChange={(e) => {
              setForm({ ...form, tokenSymbol: e.target.value });
              updateDirtyState(true);
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
              updateDirtyState(false);
            }}
          >
            Discard
          </button>
        )}
      </div>
    </form>
  );
}
