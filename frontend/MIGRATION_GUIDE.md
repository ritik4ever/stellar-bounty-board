# Filter Persistence Migration Guide

This guide explains how to migrate the bounty board filters to use the new `useLocalStorage` hook for persistent state management.

## Overview

The new `useLocalStorage` hook provides:
- ✅ Automatic persistence to localStorage
- ✅ Graceful error handling for corrupted data
- ✅ Cross-tab synchronization
- ✅ Full TypeScript support
- ✅ URL parameter precedence (URL params override localStorage)

## Architecture

### State Priority (Highest to Lowest)
1. **URL Parameters** - Shareable filter links take precedence
2. **localStorage** - User's saved preferences
3. **Default Values** - Fallback when both are empty

### Flow Diagram
```
User loads page
    ↓
Read URL params
    ↓
URL params exist? → YES → Use URL params, update localStorage
    ↓ NO
Read localStorage
    ↓
localStorage exists? → YES → Use localStorage value
    ↓ NO
Use default value
```

## Migration Steps

### Step 1: Import the Hook

```typescript
import { useLocalStorage } from './hooks/useLocalStorage';
```

### Step 2: Replace useState with useLocalStorage

#### Before (Current Implementation)
```typescript
const [statusFilter, setStatusFilter] = useState<"all" | BountyStatus>(
  initialFilters.statusFilter
);
```

#### After (With Persistence)
```typescript
const [statusFilter, setStatusFilter] = useLocalStorage<"all" | BountyStatus>(
  'statusFilter',
  initialFilters.statusFilter
);
```

### Step 3: Handle URL Parameter Precedence

The key is to read URL params first, then use them to initialize localStorage:

```typescript
// In App.tsx, modify the initialization logic:

// 1. Read URL params (highest priority)
const initialFilters = useMemo(() => readInitialFilters(), []);

// 2. Use URL params as initial value for localStorage
// This ensures URL params override saved preferences
const [statusFilter, setStatusFilter] = useLocalStorage<"all" | BountyStatus>(
  'statusFilter',
  initialFilters.statusFilter  // URL param or default
);

// 3. When URL changes (e.g., user clicks a shared link), update state
useEffect(() => {
  const newFilters = readInitialFilters();
  if (newFilters.statusFilter !== statusFilter) {
    setStatusFilter(newFilters.statusFilter);
  }
}, [window.location.search]); // Re-run when URL changes
```

## Complete Migration Examples

### Example 1: Status Filter Migration

**File:** `frontend/src/App.tsx`

**Before:**
```typescript
const [statusFilter, setStatusFilter] = useState<"all" | BountyStatus>(
  initialFilters.statusFilter
);
```

**After:**
```typescript
const [statusFilter, setStatusFilter] = useLocalStorage<"all" | BountyStatus>(
  'statusFilter',
  initialFilters.statusFilter
);
```

**Usage remains the same:**
```typescript
<select
  value={statusFilter}
  onChange={(event) => setStatusFilter(event.target.value as "all" | BountyStatus)}
>
  {statusOptions.map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ))}
</select>
```

### Example 2: Sort Order Migration

**File:** `frontend/src/App.tsx`

**Before:**
```typescript
const [sortOption, setSortOption] = useState<SortOption>(
  initialFilters.sortOption
);
const [sortDirection, setSortDirection] = useState<"asc" | "desc">(
  initialFilters.sortDirection
);
```

**After:**
```typescript
const [sortOption, setSortOption] = useLocalStorage<SortOption>(
  'sortOption',
  initialFilters.sortOption
);
const [sortDirection, setSortDirection] = useLocalStorage<"asc" | "desc">(
  'sortDirection',
  initialFilters.sortDirection
);
```

**Usage remains the same:**
```typescript
<select
  value={sortOption}
  onChange={(event) => {
    const newOption = event.target.value as SortOption;
    setSortOption(newOption);
    const optionConfig = sortOptions.find(opt => opt.value === newOption);
    if (optionConfig) {
      setSortDirection(optionConfig.direction);
    }
  }}
>
  {sortOptions.map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ))}
</select>
```

### Example 3: Reward Range Migration

**File:** `frontend/src/App.tsx`

**Before:**
```typescript
const [minReward, setMinReward] = useState(initialFilters.minReward);
const [maxReward, setMaxReward] = useState(initialFilters.maxReward);
```

**After:**
```typescript
const [minReward, setMinReward] = useLocalStorage<string>(
  'minReward',
  initialFilters.minReward
);
const [maxReward, setMaxReward] = useLocalStorage<string>(
  'maxReward',
  initialFilters.maxReward
);
```

**Usage remains the same:**
```typescript
<input
  type="number"
  min="0"
  step="1"
  value={minReward}
  onChange={(event) => setMinReward(event.target.value)}
  placeholder={rewardBounds.lowest > 0 ? `${rewardBounds.lowest}` : "0"}
/>

<input
  type="number"
  min="0"
  step="1"
  value={maxReward}
  onChange={(event) => setMaxReward(event.target.value)}
  placeholder={rewardBounds.highest > 0 ? `${rewardBounds.highest}` : "No limit"}
/>
```

### Example 4: Search Query Migration (with Debounce)

**File:** `frontend/src/App.tsx`

**Before:**
```typescript
const [searchQuery, setSearchQuery] = useState(initialFilters.searchQuery);
const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(initialFilters.searchQuery);

const debouncedSetSearchQuery = useMemo(() => debounce(setDebouncedSearchQuery, 300), []);

useEffect(() => {
  debouncedSetSearchQuery(searchQuery);
}, [searchQuery, debouncedSetSearchQuery]);
```

**After:**
```typescript
const [searchQuery, setSearchQuery] = useLocalStorage<string>(
  'searchQuery',
  initialFilters.searchQuery
);
const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(initialFilters.searchQuery);

const debouncedSetSearchQuery = useMemo(() => debounce(setDebouncedSearchQuery, 300), []);

useEffect(() => {
  debouncedSetSearchQuery(searchQuery);
}, [searchQuery, debouncedSetSearchQuery]);
```

**Note:** The debounced value is still used for filtering (not persisted), but the raw search query is persisted.

## URL Parameter Precedence Implementation

### Current Implementation (App.tsx)

The app already handles URL parameter precedence correctly:

```typescript
// 1. Read URL params on mount
const initialFilters = useMemo(() => readInitialFilters(), []);

// 2. Initialize state with URL params (or defaults)
const [statusFilter, setStatusFilter] = useLocalStorage(
  'statusFilter',
  initialFilters.statusFilter
);

// 3. When URL changes, update state
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const urlStatus = params.get("status") as "all" | BountyStatus;
  
  if (urlStatus && urlStatus !== statusFilter) {
    setStatusFilter(urlStatus);
  }
}, [window.location.search, statusFilter, setStatusFilter]);
```

### How It Works

1. **On page load:** URL params are read first via `readInitialFilters()`
2. **Initialize localStorage:** The URL param value (or default) is used as the initial value
3. **User navigates:** If user clicks a shared link with different URL params, the effect detects the change and updates state
4. **localStorage syncs:** The new value is automatically persisted to localStorage
5. **Next visit:** If user returns without URL params, localStorage value is used

## Testing the Migration

### Manual Testing Checklist

- [ ] Load page with no URL params → filters load from localStorage
- [ ] Load page with URL params → filters load from URL, localStorage is updated
- [ ] Change a filter → URL updates, localStorage updates
- [ ] Refresh page → filters persist from localStorage
- [ ] Open in new tab → filters load from localStorage
- [ ] Open shared link in new tab → filters load from URL
- [ ] Clear localStorage → filters reset to defaults
- [ ] Corrupt localStorage data → app falls back to defaults gracefully

### Automated Testing

Run the test suite:
```bash
npm test
```

Tests cover:
- ✅ Setting and retrieving values
- ✅ JSON parse error recovery
- ✅ localStorage sync across tabs
- ✅ URL params override
- ✅ Complex filter state objects
- ✅ Edge cases (null, empty string, zero, false)

## Migration Checklist

### Phase 1: Setup
- [ ] Create `frontend/src/hooks/useLocalStorage.ts`
- [ ] Create `frontend/src/hooks/useLocalStorage.test.ts`
- [ ] Create `frontend/src/hooks/index.ts`
- [ ] Run tests: `npm test` (all tests pass)

### Phase 2: Migrate Filters (in App.tsx)
- [ ] Import useLocalStorage: `import { useLocalStorage } from './hooks';`
- [ ] Replace `useState` for `statusFilter` with `useLocalStorage`
- [ ] Replace `useState` for `sortOption` with `useLocalStorage`
- [ ] Replace `useState` for `sortDirection` with `useLocalStorage`
- [ ] Replace `useState` for `minReward` with `useLocalStorage`
- [ ] Replace `useState` for `maxReward` with `useLocalStorage`
- [ ] Replace `useState` for `repoFilter` with `useLocalStorage`
- [ ] Replace `useState` for `searchQuery` with `useLocalStorage`

### Phase 3: Verify URL Precedence
- [ ] Test loading page with no URL params (uses localStorage)
- [ ] Test loading page with URL params (uses URL, updates localStorage)
- [ ] Test URL param changes (state updates, localStorage updates)
- [ ] Test shared links (URL params take precedence)

### Phase 4: Testing & QA
- [ ] Run full test suite: `npm test`
- [ ] Manual testing on Chrome, Firefox, Safari
- [ ] Test cross-tab synchronization
- [ ] Test localStorage corruption recovery
- [ ] Test with DevTools localStorage cleared

### Phase 5: Cleanup
- [ ] Remove `readInitialFilters()` if no longer needed
- [ ] Update any documentation
- [ ] Commit changes with clear message

## Troubleshooting

### Issue: Filters not persisting
**Solution:** Check browser console for errors. Ensure localStorage is not disabled.

### Issue: URL params not overriding localStorage
**Solution:** Verify `readInitialFilters()` is called on mount and URL change effect is in place.

### Issue: Cross-tab sync not working
**Solution:** Ensure storage event listener is properly attached. Check browser console for errors.

### Issue: localStorage quota exceeded
**Solution:** Clear old data or reduce stored values. The hook logs errors to console.

## Performance Considerations

- **localStorage writes:** Debounced via React's batching (minimal impact)
- **storage event listeners:** One per hook instance (negligible overhead)
- **JSON serialization:** Only on value changes (not on every render)
- **Memory:** Minimal (just stores current value in state)

## Browser Compatibility

- ✅ Chrome/Edge 4+
- ✅ Firefox 3.5+
- ✅ Safari 4+
- ✅ IE 8+
- ✅ Mobile browsers (iOS Safari, Chrome Mobile, etc.)

## Security Considerations

- **No sensitive data:** Don't store passwords, tokens, or API keys in localStorage
- **XSS protection:** localStorage is accessible to any script on the domain
- **Data validation:** Always validate data read from localStorage (the hook handles JSON errors)

## Future Enhancements

- [ ] Add encryption for sensitive data
- [ ] Add versioning for schema migrations
- [ ] Add compression for large objects
- [ ] Add expiration timestamps
- [ ] Add sync to IndexedDB for larger storage
