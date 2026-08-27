import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FilterState } from './constants';
import {
  SAVED_FILTER_PRESETS_KEY,
  addPreset,
  buildPreset,
  deletePreset,
  loadSavedFilterPresets,
  persistSavedFilterPresets,
  renamePreset,
  toFilterState,
} from './savedFilterPresets';
import type { SavedFilterPreset } from './savedFilterPresets';

function sampleFilters(overrides: Partial<FilterState> = {}): FilterState {
  return {
    searchQuery: 'websocket',
    statusFilter: 'reserved',
    minReward: '100',
    maxReward: '5000',
    repoFilter: 'ritik4ever/stellar-bounty-board',
    tokenFilter: 'XLM',
    sortOption: 'reward-high',
    sortDirection: 'desc',
    ...overrides,
  };
}

describe('saved filter presets', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('starts with no presets for first-time users', () => {
    expect(loadSavedFilterPresets()).toEqual([]);
  });

  it('round-trips a saved filter combination through localStorage', () => {
    const preset = buildPreset('Active work', sampleFilters());
    persistSavedFilterPresets([preset]);

    const loaded = loadSavedFilterPresets();
    expect(loaded).toHaveLength(1);
    expect(toFilterState(loaded[0])).toEqual(sampleFilters());
    expect(loaded[0].name).toBe('Active work');
  });

  it('builds a preset with a unique id and the captured filters', () => {
    const a = buildPreset('A', sampleFilters());
    const b = buildPreset('B', sampleFilters());
    expect(a.id).not.toBe(b.id);
    expect(renamePreset([a, b], a.id, 'Renamed')).toMatchObject(
      expect.arrayContaining([
        expect.objectContaining({ id: a.id, name: 'Renamed' }),
        expect.objectContaining({ id: b.id, name: 'B' }),
      ])
    );
  });

  it('reapplies the same filters after applying a stored preset', () => {
    const preset = buildPreset('Done', sampleFilters({ statusFilter: 'released' }));
    const applied = toFilterState(preset);
    expect(applied).toEqual(sampleFilters({ statusFilter: 'released' }));
  });

  it('deletes a preset without affecting the others', () => {
    const keep = buildPreset('Keep', sampleFilters());
    const remove = buildPreset('Remove', sampleFilters());
    const next = deletePreset([keep, remove], remove.id);

    expect(next).toHaveLength(1);
    expect(next[0].id).toBe(keep.id);
  });

  it('renames a preset without affecting the others', () => {
    const a = buildPreset('Original', sampleFilters());
    const b = buildPreset('Untouched', sampleFilters());
    const next = renamePreset([a, b], a.id, 'Updated');

    expect(next.find((p) => p.id === a.id)?.name).toBe('Updated');
    expect(next.find((p) => p.id === b.id)?.name).toBe('Untouched');
  });

  it('caps the stored list at the maximum preset count', () => {
    const over = Array.from({ length: 25 }, () => buildPreset('p', sampleFilters()));
    const capped = over.reduce<SavedFilterPreset[]>((list, preset) => addPreset(list, preset), []);
    // Only the newest 20 survive.
    expect(capped).toHaveLength(20);
  });

  it('returns an empty list for corrupt localStorage payloads', () => {
    window.localStorage.setItem(SAVED_FILTER_PRESETS_KEY, '{not-json');
    expect(loadSavedFilterPresets()).toEqual([]);

    window.localStorage.setItem(SAVED_FILTER_PRESETS_KEY, JSON.stringify({ nope: true }));
    expect(loadSavedFilterPresets()).toEqual([]);
  });

  it('prunes corrupt entries but keeps valid ones', () => {
    const valid = buildPreset('Valid', sampleFilters());
    const corrupted = { ...buildPreset('Bad', sampleFilters()), name: 42 };
    window.localStorage.setItem(SAVED_FILTER_PRESETS_KEY, JSON.stringify([valid, corrupted]));

    const loaded = loadSavedFilterPresets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(valid.id);
  });
});
