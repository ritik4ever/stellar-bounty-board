import React from 'react';
import type { BountyTemplate, CreateBountyPayload, GithubLabel } from '../types';

interface BountyTemplatePickerProps {
  templates: BountyTemplate[];
  onSelect: (template: Partial<CreateBountyPayload>) => void;
  disabled?: boolean;
}

export default function BountyTemplatePicker({
  templates,
  onSelect,
  disabled = false,
}: BountyTemplatePickerProps) {
  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    if (!value) return;

    const template = templates.find((t) => t.id === value);
    if (!template) return;

    const labels: GithubLabel[] = template.labels.map((label) =>
      typeof label === 'string' ? { name: label, color: '0075ca' } : label
    );

    onSelect({
      amount: template.amount,
      tokenSymbol: template.tokenSymbol,
      deadlineDays: template.deadlineDays,
      labels,
    });

    event.target.value = '';
  }

  if (templates.length === 0) return null;

  return (
    <label>
      Template
      <select onChange={handleChange} defaultValue="" disabled={disabled}>
        <option value="" disabled>
          Choose a template to pre-fill...
        </option>
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name} — {template.amount} {template.tokenSymbol} ({template.deadlineDays}d)
          </option>
        ))}
      </select>
    </label>
  );
}
