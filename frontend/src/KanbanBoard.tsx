/**
 * KanbanBoard — bounty lifecycle management via drag-and-drop.
 *
 * Columns: Open → Reserved → Submitted → Released
 *
 * Valid transitions (mirroring actionCopy):
 *   open      → reserved   (reserve)
 *   reserved  → submitted  (submit)
 *   submitted → released   (release)
 *   submitted → refunded   (refund) — refunded column is shown as a terminal sink
 *
 * Dragging to any other column is rejected and the card snaps back with an
 * explanatory toast message.
 */
import React, { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { toast } from 'sonner';
import { type Bounty, type BountyStatus } from './types';
import KanbanCard from './KanbanCard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KanbanAction = 'reserve' | 'submit' | 'release' | 'refund';

export interface KanbanBoardProps {
  bounties: Bounty[];
  onOpen: (id: string) => void;
  renderActionButton: (
    bounty: Bounty,
    action: {
      action: KanbanAction;
      label: string;
      title: string;
    }
  ) => ReactNode;
  /** Called when a valid transition drop occurs; should return the updated bounty */
  onTransition: (bounty: Bounty, action: KanbanAction, targetStatus: BountyStatus) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The four lifecycle columns shown on the board */
const KANBAN_COLUMNS: Array<{ status: BountyStatus; label: string; color: string }> = [
  { status: 'open', label: 'Open', color: 'var(--color-status-open, #3b82f6)' },
  { status: 'reserved', label: 'Reserved', color: 'var(--color-status-reserved, #f59e0b)' },
  { status: 'submitted', label: 'Submitted', color: 'var(--color-status-submitted, #8b5cf6)' },
  { status: 'released', label: 'Released', color: 'var(--color-status-released, #10b981)' },
];

/**
 * Valid drag transitions: source status → { target status → action name }
 */
const VALID_TRANSITIONS: Partial<
  Record<BountyStatus, Partial<Record<BountyStatus, KanbanAction>>>
> = {
  open: { reserved: 'reserve' },
  reserved: { submitted: 'submit' },
  submitted: { released: 'release', refunded: 'refund' },
};

function getTransitionAction(from: BountyStatus, to: BountyStatus): KanbanAction | null {
  return VALID_TRANSITIONS[from]?.[to] ?? null;
}

function describeInvalidDrop(from: BountyStatus, to: BountyStatus): string {
  // Same column
  if (from === to) return '';

  const valid = VALID_TRANSITIONS[from];
  if (!valid || Object.keys(valid).length === 0) {
    return `"${from}" bounties cannot be moved — this status is terminal.`;
  }
  const allowed = Object.keys(valid).join(', ');
  return `Cannot move from "${from}" to "${to}". Allowed destination${
    allowed.includes(',') ? 's' : ''
  }: ${allowed}.`;
}

// ---------------------------------------------------------------------------
// Droppable column
// ---------------------------------------------------------------------------

interface KanbanColumnProps {
  status: BountyStatus;
  label: string;
  color: string;
  bounties: Bounty[];
  isOver: boolean;
  canDrop: boolean;
  onOpen: (id: string) => void;
  renderActionButton: KanbanBoardProps['renderActionButton'];
}

function KanbanColumn({
  status,
  label,
  color,
  bounties,
  isOver,
  canDrop,
  onOpen,
  renderActionButton,
}: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({ id: status });

  const columnClass = [
    'kanban-column',
    isOver && canDrop ? 'kanban-column--over-valid' : '',
    isOver && !canDrop ? 'kanban-column--over-invalid' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={setNodeRef}
      className={columnClass}
      aria-label={`${label} column, ${bounties.length} bounties`}
    >
      <div className="kanban-column__header" style={{ borderTopColor: color }}>
        <span className="kanban-column__title">{label}</span>
        <span className="kanban-column__count">{bounties.length}</span>
      </div>
      <div className="kanban-column__cards">
        {bounties.map((bounty) => (
          <KanbanCard
            key={bounty.id}
            bounty={bounty}
            onOpen={onOpen}
            renderActionButton={renderActionButton}
          />
        ))}
        {bounties.length === 0 && (
          <div className="kanban-column__empty" aria-label="No bounties in this column">
            No bounties
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main board
// ---------------------------------------------------------------------------

/**
 * KanbanBoard renders four lifecycle columns and manages drag-and-drop state
 * transitions with validation, optimistic updates, and rollback on failure.
 */
export default function KanbanBoard({
  bounties,
  onOpen,
  renderActionButton,
  onTransition,
}: KanbanBoardProps) {
  const [activeBounty, setActiveBounty] = useState<Bounty | null>(null);
  /** Optimistic local overrides: bountyId → overridden status */
  const [optimisticStatus, setOptimisticStatus] = useState<Record<string, BountyStatus>>({});
  /** Tracks which bounties are pending an in-flight transition */
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  // Merge optimistic overrides into the bounty list
  const displayBounties = useMemo(
    () =>
      bounties.map((b) => (optimisticStatus[b.id] ? { ...b, status: optimisticStatus[b.id]! } : b)),
    [bounties, optimisticStatus]
  );

  const columnBounties = useMemo(() => {
    const map: Record<BountyStatus, Bounty[]> = {
      open: [],
      reserved: [],
      submitted: [],
      released: [],
      refunded: [],
      expired: [],
      disputed: [],
    };
    displayBounties.forEach((b) => map[b.status]?.push(b));
    return map;
  }, [displayBounties]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const bounty = (active.data.current as { bounty: Bounty } | undefined)?.bounty ?? null;
    setActiveBounty(bounty);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveBounty(null);
      const { active, over } = event;

      if (!over) return; // Dropped outside any column

      const bountyId = active.id as string;
      const targetStatus = over.id as BountyStatus;

      // Find the real (non-optimistic) source bounty
      const sourceBounty = bounties.find((b) => b.id === bountyId);
      if (!sourceBounty) return;

      const fromStatus = optimisticStatus[bountyId] ?? sourceBounty.status;

      // Same column — no-op
      if (fromStatus === targetStatus) return;

      // Prevent double-submitting while a transition is in flight
      if (pendingIds.has(bountyId)) {
        toast.warning('This bounty already has a pending action.');
        return;
      }

      const action = getTransitionAction(fromStatus, targetStatus);

      if (!action) {
        const reason = describeInvalidDrop(fromStatus, targetStatus);
        if (reason) toast.error(reason);
        return;
      }

      // Optimistic update — move card to target column immediately
      setOptimisticStatus((prev) => ({ ...prev, [bountyId]: targetStatus }));
      setPendingIds((prev) => new Set(prev).add(bountyId));

      try {
        await onTransition(sourceBounty, action, targetStatus);
        // On success, clear the optimistic override (the real data will come
        // from the parent's refresh, which overwrites the bounties prop)
        setOptimisticStatus((prev) => {
          const next = { ...prev };
          delete next[bountyId];
          return next;
        });
      } catch {
        // Rollback optimistic update on failure
        setOptimisticStatus((prev) => {
          const next = { ...prev };
          delete next[bountyId];
          return next;
        });
        // Error toast is raised by the caller (onTransition), but add a
        // generic fallback here for safety
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(bountyId);
          return next;
        });
      }
    },
    [bounties, optimisticStatus, pendingIds, onTransition]
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={(e) => void handleDragEnd(e)}
    >
      <div className="kanban-board" role="region" aria-label="Bounty lifecycle kanban board">
        {KANBAN_COLUMNS.map(({ status, label, color }) => {
          const isOver = activeBounty !== null && activeBounty.status !== status;
          const fromStatus = activeBounty
            ? (optimisticStatus[activeBounty.id] ?? activeBounty.status)
            : null;
          const canDrop = fromStatus !== null && getTransitionAction(fromStatus, status) !== null;

          return (
            <KanbanColumn
              key={status}
              status={status}
              label={label}
              color={color}
              bounties={columnBounties[status]}
              isOver={isOver && activeBounty?.status !== status}
              canDrop={canDrop}
              onOpen={onOpen}
              renderActionButton={renderActionButton}
            />
          );
        })}
      </div>

      {/* Floating overlay card while dragging */}
      <DragOverlay>
        {activeBounty && (
          <KanbanCard
            bounty={activeBounty}
            onOpen={onOpen}
            renderActionButton={renderActionButton}
            isOverlay
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
