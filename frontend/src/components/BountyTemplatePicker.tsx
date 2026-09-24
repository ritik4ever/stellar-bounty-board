/**
 * BountyTemplatePicker – A dropdown that lets users pick a pre-defined template
 * to pre-fill the bounty creation form.
 *
 * Behaviour:
 *  - Fetches templates from the backend on mount
 *  - Hides entirely when no templates are configured
 *  - Shows a loading state while fetching
 *  - On selection, calls `onSelect(template)` with the chosen template
 */

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { listBountyTemplates } from "../api";
import type { BountyTemplate } from "../types";

interface Props {
  onSelect: (template: BountyTemplate) => void;
}

export default function BountyTemplatePicker({ onSelect }: Props) {
  const [templates, setTemplates] = useState<BountyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await listBountyTemplates();
        if (!cancelled) {
          setTemplates(data);
        }
      } catch {
        // Backend may not have a templates endpoint configured;
        // silently hide the picker.
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleChange(value: string) {
    setSelectedId(value);
    const template = templates.find((t) => t.id === value);
    if (template) {
      onSelect(template);
    }
  }

  // Hide entirely when there are no templates (after loading completes)
  if (!loading && templates.length === 0) return null;

  return (
    <label>
      Template
      <select
        value={selectedId}
        onChange={(e) => handleChange(e.target.value)}
        disabled={loading}
      >
        <option value="">
          {loading ? "Loading templates..." : "Select a template..."}
        </option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} — {t.amount} {t.tokenSymbol}
          </option>
        ))}
      </select>
    </label>
  );
}