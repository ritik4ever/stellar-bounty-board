import React, { memo, type ReactNode } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { type Bounty } from './types';
import { actionCopy } from './constants';

export interface KanbanCardProps {
  bounty: Bounty;
  onOpen: (id: string) => void;
  renderActionButton: (
    bounty: Bounty,
    action: {
      action: 'reserve' | 'submit' | 'release' | 'refund';
      label: string;
      title: string;
    }
  ) => ReactNode;
  /** When true, the card is being dragged as an overlay — disable the draggable hook */
  isOverlay?: boolean;
}

/** Truncate a Stellar public key to a short display form. */
function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

/**
 * A compact Kanban card that wraps a bounty for use inside the KanbanBoard.
 * It is draggable via @dnd-kit and shows a minimal set of info alongside
 * the same action buttons used in the list view.
 */
const KanbanCard = memo(function KanbanCard({
  bounty,
  onOpen,
  renderActionButton,
  isOverlay = false,
}: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: bounty.id,
    data: { bounty },
    disabled: isOverlay,
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  const actions = actionCopy[bounty.status] ?? [];

  return (
    <article
      ref={setNodeRef}
      style={style}
      className="kanban-card"
      aria-label={`Bounty: ${bounty.title}. Drag to move to next status.`}
      // Spread DnD listeners/attributes only on the drag handle area (the card header)
    >
      {/* Drag handle — full top bar */}
      <div
        className="kanban-card__handle"
        {...listeners}
        {...attributes}
        aria-roledescription="draggable bounty card"
        title="Drag to change status"
      >
        <span className="kanban-card__amount">
          {bounty.amount} {bounty.tokenSymbol}
        </span>
      </div>

      {/* Clickable title area */}
      <button
        type="button"
        className="kanban-card__title-btn"
        onClick={() => onOpen(bounty.id)}
        title="Open bounty details"
      >
        {bounty.title}
      </button>

      <div className="kanban-card__meta">
        <span className="meta-label">
          {bounty.repo} #{bounty.issueNumber}
        </span>
        {bounty.contributor && (
          <span className="meta-label" title={bounty.contributor}>
            {shortAddress(bounty.contributor)}
          </span>
        )}
      </div>

      {actions.length > 0 && (
        <div className="kanban-card__actions">
          {actions.map((action) => renderActionButton(bounty, action))}
        </div>
      )}
    </article>
  );
});

export default KanbanCard;
