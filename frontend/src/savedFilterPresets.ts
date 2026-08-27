import type { FilterState } from './constants';

/**
 * A named snapshot of the dashboard's active filter combination, persisted
 * to localStorage so maintainers can reapply a filter set later.
 */
export interface SavedFilterPreset extends FilterState {
  /** Stable identifier for the preset (used for rename/delete). */
  id: string;
  /** Human-readable name shown in the presets dropdown. */
  name: string;
}

export const SAVED_FILTER_PRESETS_KEY = 'stellar-bounty-board-filter-presets';

/** Upper bound on stored presets, so localStorage can't be ballooned. */
export const MAX_SAVED_PRESETS = 20;

const KNOWN_STATUSES = new Set([
  'all',
  'open',
  'reserved',
  'submitted',
  'released',
  'refunded',
  'expired',
  'disputed',
]);

const KNOWN_SORT_OPTIONS = new Set([
  'reward-high',
  'reward-low',
  'deadline-soonest',
  'deadline-latest',
  'newest',
  'oldest',
]);

function isPreset(value: unknown): value is SavedFilterPreset {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.searchQuery === 'string' &&
    typeof p.statusFilter === 'string' &&
    KNOWN_STATUSES.has(p.statusFilter) &&
    typeof p.minReward === 'string' &&
    typeof p.maxReward === 'string' &&
    typeof p.repoFilter === 'string' &&
    typeof p.tokenFilter === 'string' &&
    typeof p.sortOption === 'string' &&
    KNOWN_SORT_OPTIONS.has(p.sortOption) &&
    (p.sortDirection === 'asc' || p.sortDirection === 'desc')
  );
}

/**
 * Loads saved filter presets from localStorage.
 *
 * Never throws and is safe for first-time users: a missing key, an
 * unparseable or non-array payload, or corrupt entries all degrade to an
 * empty list (or prune the offending entries) instead of surfacing errors.
 */
export function loadSavedFilterPresets(): SavedFilterPreset[] {
  try {
    const raw = window.localStorage.getItem(SAVED_FILTER_PRESETS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPreset);
  } catch {
    return [];
  }
}

/**
 * Persists the preset list to localStorage, best-effort: quota errors or a
 * blocked storage should never break the dashboard.
 */
export function persistSavedFilterPresets(presets: SavedFilterPreset[]): void {
  try {
    window.localStorage.setItem(SAVED_FILTER_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // localStorage unavailable — presets simply won't persist.
  }
}

/**
 * Builds a new preset capturing the given filter state under `name`.
 */
export function buildPreset(name: string, filters: FilterState): SavedFilterPreset {
  return {
    id: createPresetId(),
    name,
    ...filters,
  };
}

function createPresetId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Appends a preset, capping the list at `MAX_SAVED_PRESETS` (newest kept). */
export function addPreset(
  presets: SavedFilterPreset[],
  preset: SavedFilterPreset
): SavedFilterPreset[] {
  return [...presets, preset].slice(-MAX_SAVED_PRESETS);
}

/** Returns a new list with `id` renamed (other presets untouched). */
export function renamePreset(
  presets: SavedFilterPreset[],
  id: string,
  name: string
): SavedFilterPreset[] {
  return presets.map((preset) => (preset.id === id ? { ...preset, name } : preset));
}

/** Returns a new list with `id` removed (other presets untouched). */
export function deletePreset(presets: SavedFilterPreset[], id: string): SavedFilterPreset[] {
  return presets.filter((preset) => preset.id !== id);
}

/** Converts a stored preset back into an active `FilterState`. */
export function toFilterState(preset: SavedFilterPreset): FilterState {
  return {
    searchQuery: preset.searchQuery,
    statusFilter: preset.statusFilter,
    minReward: preset.minReward,
    maxReward: preset.maxReward,
    repoFilter: preset.repoFilter,
    tokenFilter: preset.tokenFilter,
    sortOption: preset.sortOption,
    sortDirection: preset.sortDirection,
  };
}
