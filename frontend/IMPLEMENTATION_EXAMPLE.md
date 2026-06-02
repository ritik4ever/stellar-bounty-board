# Implementation Example: Migrating App.tsx to useLocalStorage

This document shows the exact changes needed to migrate `App.tsx` to use the `useLocalStorage` hook.

## Step-by-Step Changes

### Step 1: Add Import

**Location:** Top of `frontend/src/App.tsx`

```typescript
// Add this import with other hook imports
import { useLocalStorage } from './hooks';
```

### Step 2: Replace useState Calls

Find these lines in `App.tsx` (around line 300-330) and replace them:

#### Status Filter

**BEFORE:**
```typescript
const [statusFilter, setStatusFilter] = useState<"all" | BountyStatus>(
  initialFilters.statusFilter
);
```

**AFTER:**
```typescript
const [statusFilter, setStatusFilter] = useLocalStorage<"all" | BountyStatus>(
  'statusFilter',
  initialFilters.statusFilter
);
```

#### Sort Option

**BEFORE:**
```typescript
const [sortOption, setSortOption] = useState<SortOption>(
  initialFilters.sortOption
);
```

**AFTER:**
```typescript
const [sortOption, setSortOption] = useLocalStorage<SortOption>(
  'sortOption',
  initialFilters.sortOption
);
```

#### Sort Direction

**BEFORE:**
```typescript
const [sortDirection, setSortDirection] = useState<"asc" | "desc">(
  initialFilters.sortDirection
);
```

**AFTER:**
```typescript
const [sortDirection, setSortDirection] = useLocalStorage<"asc" | "desc">(
  'sortDirection',
  initialFilters.sortDirection
);
```

#### Min Reward

**BEFORE:**
```typescript
const [minReward, setMinReward] = useState(initialFilters.minReward);
```

**AFTER:**
```typescript
const [minReward, setMinReward] = useLocalStorage<string>(
  'minReward',
  initialFilters.minReward
);
```

#### Max Reward

**BEFORE:**
```typescript
const [maxReward, setMaxReward] = useState(initialFilters.maxReward);
```

**AFTER:**
```typescript
const [maxReward, setMaxReward] = useLocalStorage<string>(
  'maxReward',
  initialFilters.maxReward
);
```

#### Repo Filter

**BEFORE:**
```typescript
const [repoFilter, setRepoFilter] = useState(initialFilters.repoFilter);
```

**AFTER:**
```typescript
const [repoFilter, setRepoFilter] = useLocalStorage<string>(
  'repoFilter',
  initialFilters.repoFilter
);
```

#### Search Query

**BEFORE:**
```typescript
const [searchQuery, setSearchQuery] = useState(initialFilters.searchQuery);
```

**AFTER:**
```typescript
const [searchQuery, setSearchQuery] = useLocalStorage<string>(
  'searchQuery',
  initialFilters.searchQuery
);
```

### Step 3: Add URL Parameter Precedence Effect

Add this effect after the existing effects (around line 450):

```typescript
// Sync URL params to state (URL params take precedence over localStorage)
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  
  // Only update if URL param exists and differs from current state
  const urlStatus = params.get("status") as "all" | BountyStatus | null;
  if (urlStatus && urlStatus !== statusFilter) {
    setStatusFilter(urlStatus);
  }
  
  const urlSort = params.get("sort") as SortOption | null;
  if (urlSort && urlSort !== sortOption) {
    setSortOption(urlSort);
  }
  
  const urlDirection = params.get("direction") as "asc" | "desc" | null;
  if (urlDirection && urlDirection !== sortDirection) {
    setSortDirection(urlDirection);
  }
  
  const urlMinReward = params.get("minReward");
  if (urlMinReward !== null && urlMinReward !== minReward) {
    setMinReward(urlMinReward);
  }
  
  const urlMaxReward = params.get("maxReward");
  if (urlMaxReward !== null && urlMaxReward !== maxReward) {
    setMaxReward(urlMaxReward);
  }
  
  const urlRepo = params.get("repo");
  if (urlRepo !== null && urlRepo !== repoFilter) {
    setRepoFilter(urlRepo);
  }
  
  const urlSearch = params.get("search");
  if (urlSearch !== null && urlSearch !== searchQuery) {
    setSearchQuery(urlSearch);
  }
}, [window.location.search]); // Re-run when URL changes
```

**Alternative: Simpler approach using readInitialFilters()**

If you prefer a cleaner approach, you can create a custom hook:

```typescript
// In a new file: frontend/src/hooks/useUrlFilters.ts
import { useEffect } from 'react';
import { readInitialFilters } from '../constants';
import { BountyStatus, SortOption } from '../types';

interface FilterSetters {
  setStatusFilter: (value: "all" | BountyStatus) => void;
  setSortOption: (value: SortOption) => void;
  setSortDirection: (value: "asc" | "desc") => void;
  setMinReward: (value: string) => void;
  setMaxReward: (value: string) => void;
  setRepoFilter: (value: string) => void;
  setSearchQuery: (value: string) => void;
}

export function useUrlFilters(setters: FilterSetters) {
  useEffect(() => {
    const filters = readInitialFilters();
    
    setters.setStatusFilter(filters.statusFilter);
    setters.setSortOption(filters.sortOption);
    setters.setSortDirection(filters.sortDirection);
    setters.setMinReward(filters.minReward);
    setters.setMaxReward(filters.maxReward);
    setters.setRepoFilter(filters.repoFilter);
    setters.setSearchQuery(filters.searchQuery);
  }, [window.location.search]);
}
```

Then in App.tsx:
```typescript
useUrlFilters({
  setStatusFilter,
  setSortOption,
  setSortDirection,
  setMinReward,
  setMaxReward,
  setRepoFilter,
  setSearchQuery,
});
```

### Step 4: No Changes Needed for Component Logic

All the existing component code remains the same! The hook is a drop-in replacement for `useState`:

```typescript
// Status filter select - NO CHANGES NEEDED
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

// Sort option select - NO CHANGES NEEDED
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

// Reward inputs - NO CHANGES NEEDED
<input
  type="number"
  value={minReward}
  onChange={(event) => setMinReward(event.target.value)}
/>

<input
  type="number"
  value={maxReward}
  onChange={(event) => setMaxReward(event.target.value)}
/>
```

## Complete Modified Section

Here's what the state initialization section should look like after migration:

```typescript
function App() {
  const { dark, toggle: toggleDark } = useDarkMode();
  const initialFilters = useMemo(() => readInitialFilters(), []);
  const [form, setForm] = useState<CreateBountyPayload>(initialForm);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [issues, setIssues] = useState<OpenIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persistent filter state
  const [searchQuery, setSearchQuery] = useLocalStorage<string>(
    'searchQuery',
    initialFilters.searchQuery
  );
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(initialFilters.searchQuery);
  
  const debouncedSetSearchQuery = useMemo(() => debounce(setDebouncedSearchQuery, 300), []);
  
  useEffect(() => {
    debouncedSetSearchQuery(searchQuery);
  }, [searchQuery, debouncedSetSearchQuery]);

  const [statusFilter, setStatusFilter] = useLocalStorage<"all" | BountyStatus>(
    'statusFilter',
    initialFilters.statusFilter
  );
  const [minReward, setMinReward] = useLocalStorage<string>(
    'minReward',
    initialFilters.minReward
  );
  const [maxReward, setMaxReward] = useLocalStorage<string>(
    'maxReward',
    initialFilters.maxReward
  );
  const [repoFilter, setRepoFilter] = useLocalStorage<string>(
    'repoFilter',
    initialFilters.repoFilter
  );
  const [sortOption, setSortOption] = useLocalStorage<SortOption>(
    'sortOption',
    initialFilters.sortOption
  );
  const [sortDirection, setSortDirection] = useLocalStorage<"asc" | "desc">(
    'sortDirection',
    initialFilters.sortDirection
  );

  // Non-persistent state
  const [pathname, setPathname] = useState(window.location.pathname);
  const detailId = useMemo(() => {
    const match = pathname.match(/^\/bounties\/([^/]+)$/);
    return match ? decodeURIComponent(match[1] ?? "") : null;
  }, [pathname]);
  // ... rest of state ...
}
```

## Testing the Changes

### 1. Run the test suite
```bash
cd frontend
npm test
```

### 2. Manual testing
```bash
npm run dev
```

Then test these scenarios:

**Scenario 1: Fresh page load**
- Open DevTools → Application → localStorage
- Should be empty initially
- Change a filter (e.g., status to "open")
- localStorage should now have `statusFilter: "open"`

**Scenario 2: Page refresh**
- Change filters
- Refresh page (Cmd+R)
- Filters should persist

**Scenario 3: Shared link**
- Change filters
- Copy URL
- Open in new tab
- Filters should load from URL
- localStorage should update

**Scenario 4: Cross-tab sync**
- Open two tabs with the app
- Change filter in tab 1
- Tab 2 should update automatically (if both tabs are visible)

**Scenario 5: Corrupted data**
- Open DevTools → Console
- Run: `localStorage.setItem('statusFilter', 'invalid json {]')`
- Refresh page
- App should load with default filters (no crash)
- Console should show error message

## Rollback Plan

If issues arise, rollback is simple:

1. Replace `useLocalStorage` calls back to `useState`
2. Remove the URL precedence effect
3. Commit and deploy

The changes are isolated to state initialization, so rollback is low-risk.

## Performance Impact

- **Minimal:** localStorage writes are batched by React
- **No additional renders:** Hook uses same state mechanism as useState
- **Storage event listeners:** One per filter (negligible overhead)
- **JSON serialization:** Only on value changes

## Browser DevTools Inspection

To inspect localStorage in DevTools:

**Chrome/Edge:**
1. Open DevTools (F12)
2. Go to Application tab
3. Click "Local Storage" in left sidebar
4. Select your domain
5. Look for keys: `statusFilter`, `sortOption`, `sortDirection`, `minReward`, `maxReward`, `repoFilter`, `searchQuery`

**Firefox:**
1. Open DevTools (F12)
2. Go to Storage tab
3. Click "Local Storage" in left sidebar
4. Select your domain
5. View the same keys

## Debugging Tips

**Check if localStorage is working:**
```javascript
// In browser console
localStorage.setItem('test', 'value');
localStorage.getItem('test'); // Should return 'value'
localStorage.removeItem('test');
```

**Check if hook is persisting:**
```javascript
// After changing a filter, check localStorage
localStorage.getItem('statusFilter'); // Should show the value
```

**Check if URL params work:**
```javascript
// Navigate to: http://localhost:3000/?status=open
// statusFilter should be 'open'
// localStorage should be updated
```

**Monitor storage events:**
```javascript
// In browser console
window.addEventListener('storage', (e) => {
  console.log('Storage changed:', e.key, e.newValue);
});
```
