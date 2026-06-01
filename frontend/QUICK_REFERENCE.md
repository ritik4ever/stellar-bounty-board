# useLocalStorage Hook - Quick Reference

## 📌 TL;DR

Replace `useState` with `useLocalStorage` to persist filter state to localStorage.

## 🚀 Quick Start

### 1. Import
```typescript
import { useLocalStorage } from './hooks';
```

### 2. Use (exactly like useState)
```typescript
// Before
const [status, setStatus] = useState('all');

// After
const [status, setStatus] = useLocalStorage('statusFilter', 'all');
```

### 3. That's it!
- ✅ Automatically saves to localStorage
- ✅ Loads from localStorage on page refresh
- ✅ Syncs across browser tabs
- ✅ Handles errors gracefully

## 📋 All 7 Filters to Migrate

```typescript
// 1. Status Filter
const [statusFilter, setStatusFilter] = useLocalStorage<"all" | BountyStatus>(
  'statusFilter',
  initialFilters.statusFilter
);

// 2. Sort Option
const [sortOption, setSortOption] = useLocalStorage<SortOption>(
  'sortOption',
  initialFilters.sortOption
);

// 3. Sort Direction
const [sortDirection, setSortDirection] = useLocalStorage<"asc" | "desc">(
  'sortDirection',
  initialFilters.sortDirection
);

// 4. Min Reward
const [minReward, setMinReward] = useLocalStorage<string>(
  'minReward',
  initialFilters.minReward
);

// 5. Max Reward
const [maxReward, setMaxReward] = useLocalStorage<string>(
  'maxReward',
  initialFilters.maxReward
);

// 6. Repo Filter
const [repoFilter, setRepoFilter] = useLocalStorage<string>(
  'repoFilter',
  initialFilters.repoFilter
);

// 7. Search Query
const [searchQuery, setSearchQuery] = useLocalStorage<string>(
  'searchQuery',
  initialFilters.searchQuery
);
```

## 🔄 URL Parameter Precedence

Add this effect to handle URL params (they override localStorage):

```typescript
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  
  const urlStatus = params.get("status") as "all" | BountyStatus | null;
  if (urlStatus && urlStatus !== statusFilter) {
    setStatusFilter(urlStatus);
  }
  
  // ... repeat for other filters ...
}, [window.location.search]);
```

## 🧪 Testing

```bash
# Install dependencies
npm install

# Run tests
npm test

# All tests should pass ✅
```

## 🔍 Verify It Works

### In Browser DevTools:
1. Open DevTools (F12)
2. Go to Application → Local Storage
3. Change a filter
4. See the value appear in localStorage
5. Refresh page
6. Filter persists ✅

### Test Scenarios:
- [ ] Load page → filters from localStorage
- [ ] Load with URL params → filters from URL
- [ ] Change filter → localStorage updates
- [ ] Refresh page → filters persist
- [ ] Open new tab → filters load from localStorage
- [ ] Share link → URL params work

## 📚 Documentation

- **Full Guide:** `MIGRATION_GUIDE.md`
- **Step-by-Step:** `IMPLEMENTATION_EXAMPLE.md`
- **Summary:** `FILTER_PERSISTENCE_SUMMARY.md`
- **This File:** `QUICK_REFERENCE.md`

## ⚡ Common Patterns

### Functional Update
```typescript
// Update based on previous value
setStatus(prev => prev === 'all' ? 'open' : 'all');
```

### Partial Object Update
```typescript
setFilters(prev => ({
  ...prev,
  status: 'open'
}));
```

### Reset to Default
```typescript
setStatus('all'); // Resets to default
```

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| Not persisting | Check browser console for errors |
| URL params ignored | Verify URL precedence effect is added |
| Cross-tab sync fails | Check storage event listener |
| localStorage full | Clear old data or reduce values |

## 📊 What Gets Stored

```javascript
// In localStorage, you'll see:
{
  "statusFilter": "open",
  "sortOption": "reward-high",
  "sortDirection": "desc",
  "minReward": "100",
  "maxReward": "1000",
  "repoFilter": "stellar-core",
  "searchQuery": "payment"
}
```

## 🔒 Security Note

✅ Safe to store: Filter preferences, search queries, UI state
❌ Never store: Passwords, tokens, private keys, sensitive data

## 📝 Files Created

```
frontend/src/hooks/
├── useLocalStorage.ts          ← Hook implementation
├── useLocalStorage.test.ts     ← 50+ tests
└── index.ts                    ← Exports

frontend/
├── MIGRATION_GUIDE.md          ← Full guide
├── IMPLEMENTATION_EXAMPLE.md   ← Step-by-step
├── FILTER_PERSISTENCE_SUMMARY.md ← Complete summary
└── QUICK_REFERENCE.md          ← This file
```

## ✅ Migration Checklist

- [ ] Read this file (you're here!)
- [ ] Run `npm install && npm test`
- [ ] Read `IMPLEMENTATION_EXAMPLE.md`
- [ ] Update App.tsx (replace 7 useState calls)
- [ ] Add URL precedence effect
- [ ] Test manually
- [ ] Commit changes

## 🎯 Expected Behavior

### Before Migration
- User sets filters
- Refreshes page
- Filters are lost ❌

### After Migration
- User sets filters
- Refreshes page
- Filters persist ✅
- Shared links work ✅
- Cross-tab sync works ✅

## 💡 Pro Tips

1. **localStorage keys are strings** - Use descriptive names like `'statusFilter'` not `'s'`
2. **JSON serialization** - Objects are automatically JSON.stringify'd
3. **Error handling** - Corrupted data falls back to defaults gracefully
4. **Performance** - Minimal overhead, writes are batched by React
5. **Debugging** - Check localStorage in DevTools Application tab

## 🚀 Next Steps

1. **Read:** `IMPLEMENTATION_EXAMPLE.md` for exact code changes
2. **Implement:** Update App.tsx with the 7 filter migrations
3. **Test:** Run `npm test` and manual testing
4. **Deploy:** Commit and push

## 📞 Questions?

- Check `MIGRATION_GUIDE.md` for detailed explanations
- Review test cases in `useLocalStorage.test.ts` for usage examples
- Check browser console for error messages
- Verify localStorage is enabled in browser settings

---

**Status:** Ready to implement
**Effort:** ~30 minutes
**Risk:** Low (isolated changes, easy rollback)
**Benefit:** Users keep their filter preferences across sessions
