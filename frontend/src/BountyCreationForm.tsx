import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { CreateBountyPayload } from "./types";

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

type BountyCreationFormProps = {
  onSubmit: (payload: CreateBountyPayload) => Promise<void>;
};

export default function BountyCreationForm({ onSubmit }: BountyCreationFormProps) {
  const [form, setForm] = useState<CreateBountyPayload>(initialForm);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const maintainerError = validateStellarPublicKey(form.maintainer);
    if (maintainerError) {
      toast.error(`Maintainer address: ${maintainerError}`);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        ...form,
        maintainer: form.maintainer.trim(),
        labels: form.labels.filter(Boolean),
      });
      setForm((prev) => ({ ...initialForm, issueNumber: prev.issueNumber + 1 }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="bounty-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <label>
          Repository
          <input
            value={form.repo}
            onChange={(e) => setForm({ ...form, repo: e.target.value })}
            placeholder="owner/repo"
          />
        </label>
        <label>
          Issue #
          <input
            type="number"
            value={form.issueNumber}
            onChange={(e) => setForm({ ...form, issueNumber: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Title
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
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
            onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
          />
        </label>
        <label>
          Asset
          <select
            value={form.tokenSymbol}
            onChange={(e) => setForm({ ...form, tokenSymbol: e.target.value })}
          >
            <option value="XLM">XLM</option>
            <option value="USDC">USDC</option>
          </select>
        </label>
      </div>
      <button type="submit" disabled={submitting}>
        {submitting ? "Creating..." : "Create Bounty"}
      </button>
    </form>
  );
}