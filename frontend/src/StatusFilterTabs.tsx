import { statusCopy } from "./constants";
import type { BountyStatus } from "./types";

type Props = {
  status: "all" | BountyStatus;
  onChange: (next: "all" | BountyStatus) => void;
};

const tabs: Array<{ value: "all" | BountyStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: statusCopy.open.label },
  { value: "reserved", label: statusCopy.reserved.label },
  { value: "submitted", label: statusCopy.submitted.label },
  { value: "released", label: statusCopy.released.label },
  { value: "expired", label: statusCopy.expired.label },
];

export default function StatusFilterTabs({ status, onChange }: Props) {
  return (
    <div className="filter-row" role="tablist" aria-label="Filter by bounty status">
      {tabs.map((tab) => {
        const active = status === tab.value;

        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`filter-chip ${active ? "filter-chip--active" : ""}`}
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
