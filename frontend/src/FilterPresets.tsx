import { useState, useEffect, useCallback } from "react";
import { Bookmark, Trash2, Edit3, Check, X } from "lucide-react";
import type { FilterState } from "./constants";

const STORAGE_KEY = "stellar-bounty-board-filter-presets";

export interface SavedFilterPreset {
  id: string;
  name: string;
  filters: FilterState;
}

function loadPresets(): SavedFilterPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedFilterPreset[];
  } catch {
    return [];
  }
}

function savePresets(presets: SavedFilterPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // ignore storage errors
  }
}

let nextId = 1;
function generateId(): string {
  return `preset-${Date.now()}-${nextId++}`;
}

type Props = {
  currentFilters: FilterState;
  onApplyPreset: (filters: FilterState) => void;
};

export default function FilterPresets({ currentFilters, onApplyPreset }: Props) {
  const [presets, setPresets] = useState<SavedFilterPreset[]>(() => loadPresets());
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Sync presets to localStorage whenever they change
  useEffect(() => {
    savePresets(presets);
  }, [presets]);

  const handleSave = useCallback(() => {
    const name = window.prompt("Name this filter preset:", "");
    if (!name || !name.trim()) return;
    const newPreset: SavedFilterPreset = {
      id: generateId(),
      name: name.trim(),
      filters: { ...currentFilters },
    };
    setPresets((prev) => [...prev, newPreset]);
  }, [currentFilters]);

  const handleApply = useCallback(
    (preset: SavedFilterPreset) => {
      onApplyPreset(preset.filters);
      setIsOpen(false);
    },
    [onApplyPreset]
  );

  const handleDelete = useCallback(
    (id: string, event: React.MouseEvent) => {
      event.stopPropagation();
      if (!window.confirm("Delete this filter preset?")) return;
      setPresets((prev) => prev.filter((p) => p.id !== id));
      if (editingId === id) {
        setEditingId(null);
      }
    },
    [editingId]
  );

  const handleStartEdit = useCallback(
    (id: string, name: string, event: React.MouseEvent) => {
      event.stopPropagation();
      setEditingId(id);
      setEditName(name);
    },
    []
  );

  const handleConfirmEdit = useCallback(
    (id: string) => {
      const trimmed = editName.trim();
      if (!trimmed) return;
      setPresets((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p))
      );
      setEditingId(null);
    },
    [editName]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, id: string) => {
      if (e.key === "Enter") {
        handleConfirmEdit(id);
      } else if (e.key === "Escape") {
        handleCancelEdit();
      }
    },
    [handleConfirmEdit, handleCancelEdit]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside() {
      setIsOpen(false);
    }
    // Delay to avoid the same click that opened the dropdown
    const timer = setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="filter-presets" data-testid="filter-presets">
      <button
        type="button"
        className="filter-presets__save"
        onClick={handleSave}
        title="Save current filters as a preset"
        disabled={isSaving}
      >
        <Bookmark size={16} />
        Save Filters
      </button>

      {presets.length > 0 && (
        <div className="filter-presets__dropdown-wrapper">
          <button
            type="button"
            className="filter-presets__toggle"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(!isOpen);
            }}
            title="Apply a saved filter preset"
          >
            Presets ({presets.length})
          </button>

          {isOpen && (
            <div
              className="filter-presets__dropdown"
              role="menu"
              onClick={(e) => e.stopPropagation()}
            >
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className="filter-presets__item"
                  role="menuitem"
                  onClick={() => handleApply(preset)}
                >
                  {editingId === preset.id ? (
                    <div className="filter-presets__edit-row">
                      <input
                        className="filter-presets__edit-input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, preset.id)}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button
                        type="button"
                        className="filter-presets__icon-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConfirmEdit(preset.id);
                        }}
                        title="Confirm"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        className="filter-presets__icon-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancelEdit();
                        }}
                        title="Cancel"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="filter-presets__name">{preset.name}</span>
                      <div className="filter-presets__actions">
                        <button
                          type="button"
                          className="filter-presets__icon-btn"
                          onClick={(e) => handleStartEdit(preset.id, preset.name, e)}
                          title="Rename preset"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          className="filter-presets__icon-btn filter-presets__icon-btn--delete"
                          onClick={(e) => handleDelete(preset.id, e)}
                          title="Delete preset"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}