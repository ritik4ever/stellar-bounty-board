import { useState, useRef, useEffect, useCallback } from "react";
import { FilterState } from "./constants";

const STORAGE_KEY = "stellar-bounty-board-filter-presets";

export interface FilterPreset {
  name: string;
  filters: FilterState;
}

function readPresets(): FilterPreset[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p: unknown): p is FilterPreset =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as FilterPreset).name === "string" &&
        typeof (p as FilterPreset).filters === "object"
    );
  } catch {
    return [];
  }
}

function writePresets(presets: FilterPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // localStorage full or unavailable
  }
}

interface FilterPresetsProps {
  currentFilters: FilterState;
  onApplyPreset: (filters: FilterState) => void;
}

export default function FilterPresets({
  currentFilters,
  onApplyPreset,
}: FilterPresetsProps) {
  const [presets, setPresets] = useState<FilterPreset[]>(readPresets);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Sync to localStorage whenever presets change
  useEffect(() => {
    writePresets(presets);
  }, [presets]);

  // Focus the save input when the dialog opens
  useEffect(() => {
    if (showSaveDialog && saveInputRef.current) {
      saveInputRef.current.focus();
      saveInputRef.current.select();
    }
  }, [showSaveDialog]);

  // Focus the rename input when renaming starts
  useEffect(() => {
    if (renamingIndex !== null && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingIndex]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDropdown]);

  const handleSave = useCallback(() => {
    const name = presetName.trim();
    if (!name) return;
    setPresets((prev) => [...prev, { name, filters: { ...currentFilters } }]);
    setPresetName("");
    setShowSaveDialog(false);
  }, [presetName, currentFilters]);

  const handleApply = useCallback(
    (preset: FilterPreset) => {
      onApplyPreset(preset.filters);
      setShowDropdown(false);
    },
    [onApplyPreset]
  );

  const handleDelete = useCallback(
    (index: number) => {
      setPresets((prev) => prev.filter((_, i) => i !== index));
    },
    []
  );

  const handleStartRename = useCallback(
    (index: number, currentName: string) => {
      setRenamingIndex(index);
      setRenameValue(currentName);
    },
    []
  );

  const handleFinishRename = useCallback(() => {
    if (renamingIndex === null) return;
    const name = renameValue.trim();
    if (!name) {
      setRenamingIndex(null);
      return;
    }
    setPresets((prev) =>
      prev.map((p, i) => (i === renamingIndex ? { ...p, name } : p))
    );
    setRenamingIndex(null);
  }, [renamingIndex, renameValue]);

  if (presets.length === 0 && !showSaveDialog) {
    return (
      <div className="filter-presets">
        <button
          type="button"
          className="ghost-button filter-presets__save-btn"
          onClick={() => setShowSaveDialog(true)}
          title="Save current filters as a preset"
        >
          + Save filters
        </button>
      </div>
    );
  }

  return (
    <div className="filter-presets" ref={dropdownRef}>
      <div className="filter-presets__actions">
        <button
          type="button"
          className="ghost-button filter-presets__toggle-btn"
          onClick={() => setShowDropdown((prev) => !prev)}
          title="Saved filter presets"
        >
          Presets ({presets.length})
        </button>

        {!showSaveDialog && (
          <button
            type="button"
            className="ghost-button filter-presets__save-btn"
            onClick={() => setShowSaveDialog(true)}
            title="Save current filters as a new preset"
          >
            + Save
          </button>
        )}
      </div>

      {showSaveDialog && (
        <div className="filter-presets__save-dialog">
          <input
            ref={saveInputRef}
            className="filter-presets__name-input"
            placeholder="Preset name..."
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") {
                setShowSaveDialog(false);
                setPresetName("");
              }
            }}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={!presetName.trim()}
            onClick={handleSave}
          >
            Save
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setShowSaveDialog(false);
              setPresetName("");
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {showDropdown && presets.length > 0 && (
        <div className="filter-presets__dropdown">
          {presets.map((preset, index) => (
            <div key={index} className="filter-presets__item">
              {renamingIndex === index ? (
                <input
                  ref={renameInputRef}
                  className="filter-presets__rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleFinishRename();
                    if (e.key === "Escape") setRenamingIndex(null);
                  }}
                  onBlur={handleFinishRename}
                />
              ) : (
                <button
                  type="button"
                  className="filter-presets__item-name"
                  onClick={() => handleApply(preset)}
                  title={`Apply: ${preset.name}`}
                >
                  {preset.name}
                </button>
              )}
              <div className="filter-presets__item-actions">
                <button
                  type="button"
                  className="filter-presets__item-action"
                  onClick={() => handleStartRename(index, preset.name)}
                  title="Rename"
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="filter-presets__item-action filter-presets__item-action--delete"
                  onClick={() => handleDelete(index)}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}