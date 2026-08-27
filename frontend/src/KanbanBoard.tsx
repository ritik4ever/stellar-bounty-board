import React, { useState, useCallback, useMemo } from "react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
  type BeforeCapture,
} from "@hello-pangea/dnd";
import { FolderGit2, Columns2, LayoutList } from "lucide-react";
import { toast } from "sonner";
import { type Bounty, type BountyStatus } from "./types";
import { statusCopy, actionCopy } from "./constants";
import BountyCard from "./BountyCard";

/* ── helpers ────────────────────────────────────────────────── */

/** Kanban columns — ordered left to right. */
const KANBAN_COLUMNS: BountyStatus[] = [
  "open",
  "reserved",
  "submitted",
  "released",
];

/** Terminal columns shown at the end (no drag-out). */
const TERMINAL_COLUMNS: BountyStatus[] = ["refunded", "expired", "disputed"];

/** All visible columns. */
const ALL_COLUMNS = [...KANBAN_COLUMNS, ...TERMINAL_COLUMNS];

/** Return the next allowed statuses for a bounty, or empty if terminal. */
function allowedTargets(bounty: Bounty): BountyStatus[] {
  const actions = actionCopy[bounty.status];
  if (!actions || actions.length === 0) return [];
  return actions.map((a) => {
    switch (a.action) {
      case "reserve":
        return "reserved" as BountyStatus;
      case "submit":
        return "submitted" as BountyStatus;
      case "release":
        return "released" as BountyStatus;
      case "refund":
        return "refunded" as BountyStatus;
      default:
        return null;
    }
  }).filter((s): s is BountyStatus => s !== null && ALL_COLUMNS.includes(s));
}

/** Colour for each column header. */
const COLUMN_COLORS: Record<string, string> = {
  open: "#4ade80",
  reserved: "#60a5fa",
  submitted: "#fbbf24",
  released: "#a78bfa",
  refunded: "#94a3b8",
  expired: "#f87171",
  disputed: "#fb923c",
};

/* ── props ──────────────────────────────────────────────────── */

interface KanbanBoardProps {
  bounties: Bounty[];
  onOpen: (id: string) => void;
  onReserve: (bounty: Bounty) => void;
  onSubmit: (bounty: Bounty) => void;
  onRelease: (bounty: Bounty) => void;
  onRefund: (bounty: Bounty) => void;
  onRefresh: () => void;
  /** External view toggle — true = kanban, false = list */
  isKanban: boolean;
  onToggleView: () => void;
}

/* ── component ──────────────────────────────────────────────── */

export default function KanbanBoard({
  bounties,
  onOpen,
  onReserve,
  onSubmit,
  onRelease,
  onRefund,
  isKanban,
  onToggleView,
}: KanbanBoardProps) {
  /* Track which column IDs are temporarily "locked" during a drag. */
  const [invalidDropTargets, setInvalidDropTargets] = useState<
    Set<string>
  >(new Set());

  const columnMap = useMemo(() => {
    const map: Record<BountyStatus, Bounty[]> = {} as Record<
      BountyStatus,
      Bounty[]
    >;
    for (const col of ALL_COLUMNS) map[col] = [];
    for (const b of bounties) {
      const col = b.status;
      if (map[col]) map[col].push(b);
    }
    return map;
  }, [bounties]);

  /* ── drag lifecycle ──────────────────────────────────────── */

  const handleBeforeCapture = useCallback(
    (start: BeforeCapture) => {
      /* Find the dragged bounty to know its allowed targets. */
      const dragged = bounties.find((b) => b.id === start.draggableId);
      if (!dragged) return;
      const allowed = new Set(allowedTargets(dragged));
      /* Mark columns that are NOT allowed. */
      const invalid = new Set(
        ALL_COLUMNS.filter((c) => c !== dragged.status && !allowed.has(c))
      );
      setInvalidDropTargets(invalid);
    },
    [bounties]
  );

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      setInvalidDropTargets(new Set());

      const { draggableId, source, destination } = result;
      if (!destination) return; // dropped outside
      if (source.droppableId === destination.droppableId) return; // same column

      const targetStatus = destination.droppableId as BountyStatus;
      const bounty = bounties.find((b) => b.id === draggableId);
      if (!bounty) return;

      /* Check if the transition is allowed. */
      const allowed = allowedTargets(bounty);
      if (!allowed.includes(targetStatus)) {
        toast.error(
          `Cannot move "${bounty.title.slice(0, 40)}..." from ${statusCopy[bounty.status].label} to ${statusCopy[targetStatus].label}`
        );
        return;
      }

      /* Trigger the correct action. */
      switch (targetStatus) {
        case "reserved":
          onReserve(bounty);
          break;
        case "submitted":
          onSubmit(bounty);
          break;
        case "released":
          onRelease(bounty);
          break;
        case "refunded":
          onRefund(bounty);
          break;
        default:
          toast.error(`Unsupported drop target: ${targetStatus}`);
      }
    },
    [bounties, onReserve, onSubmit, onRelease, onRefund]
  );

  /* ── list view (fallback) ────────────────────────────────── */

  if (!isKanban) {
    return (
      <div className="board-section">
        <div className="kanban-toolbar">
          <button
            type="button"
            className="secondary-button"
            onClick={onToggleView}
            title="Switch to Kanban view"
          >
            <Columns2 size={16} />
            <span>Kanban</span>
          </button>
        </div>
        {/* Render children — the caller handles the list view itself */}
        {null}
      </div>
    );
  }

  /* ── kanban view ─────────────────────────────────────────── */

  return (
    <div className="kanban-container">
      <div className="kanban-toolbar">
        <button
          type="button"
          className="secondary-button"
          onClick={onToggleView}
          title="Switch to list view"
        >
          <LayoutList size={16} />
          <span>List</span>
        </button>
      </div>

      <DragDropContext
        onBeforeCapture={handleBeforeCapture}
        onDragEnd={handleDragEnd}
      >
        <div className="kanban-board">
          {ALL_COLUMNS.map((col) => {
            const items = columnMap[col] ?? [];
            const isInvalid = invalidDropTargets.has(col);
            const isTerminal = TERMINAL_COLUMNS.includes(col);

            return (
              <Droppable
                key={col}
                droppableId={col}
                isDropDisabled={isTerminal || isInvalid}
              >
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`kanban-column ${
                      snapshot.isDraggingOver ? "kanban-column--drag-over" : ""
                    } ${isInvalid ? "kanban-column--invalid" : ""}`}
                  >
                    <div
                      className="kanban-column-header"
                      style={{ borderTopColor: COLUMN_COLORS[col] ?? "#888" }}
                    >
                      <span className="kanban-column-title">
                        {statusCopy[col]?.label ?? col}
                      </span>
                      <span className="kanban-column-count">{items.length}</span>
                    </div>

                    <div className="kanban-column-body">
                      {items.map((bounty, index) => (
                        <Draggable
                          key={bounty.id}
                          draggableId={bounty.id}
                          index={index}
                          isDragDisabled={isTerminal}
                        >
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={`kanban-card ${
                                snapshot.isDragging ? "kanban-card--dragging" : ""
                              }`}
                              onClick={() => onOpen(bounty.id)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  onOpen(bounty.id);
                                }
                              }}
                            >
                              <div className="kanban-card-title">
                                {bounty.title}
                              </div>
                              <div className="kanban-card-meta">
                                <span className="kanban-card-repo">
                                  <FolderGit2 size={12} />
                                  {bounty.repo}
                                </span>
                                <span className="kanban-card-amount">
                                  {bounty.amount} {bounty.tokenSymbol}
                                </span>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  </div>
                )}
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>
    </div>
  );
}