# Filter Persistence Architecture Diagrams

## 1. State Priority Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    User Loads Page                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────┐
        │  Read URL Parameters           │
        │  (?status=open&sort=reward)    │
        └────────────┬───────────────────┘
                     │
                     ▼
        ┌────────────────────────────────┐
        │  URL Params Exist?             │
        └────────────┬───────────────────┘
                     │
        ┌────────────┴────────────┐
        │ YES                     │ NO
        ▼                         ▼
    ┌─────────────┐      ┌──────────────────┐
    │ Use URL     │      │ Read localStorage│
    │ Params      │      │ (saved prefs)    │
    │             │      └────────┬─────────┘
    │ Update      │               │
    │ localStorage│      ┌────────┴─────────┐
    │ with URL    │      │ localStorage     │
    │ values      │      │ exists?          │
    └──────┬──────┘      └────────┬─────────┘
           │                      │
           │          ┌───────────┴──────────┐
           │          │ YES                  │ NO
           │          ▼                      ▼
           │      ┌─────────────┐    ┌──────────────┐
           │      │ Use saved   │    │ Use default  │
           │      │ preferences │    │ values       │
           │      └─────────────┘    └──────────────┘
           │              │                  │
           └──────────────┴──────────────────┘
                         │
                         ▼
        ┌────────────────────────────────┐
        │  Initialize React State        │
        │  (useLocalStorage hook)        │
        └────────────┬───────────────────┘
                     │
                     ▼
        ┌────────────────────────────────┐
        │  Render UI with Filters        │
        └────────────────────────────────┘
```

## 2. Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         React Component                          │
│                                                                  │
│  const [status, setStatus] = useLocalStorage('statusFilter')   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┼─────────────┐
                │             │             │
                ▼             ▼             ▼
        ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
        │ User Changes │ │ URL Changes  │ │ Another Tab  │
        │ Filter       │ │ (shared link)│ │ Changes Data │
        └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
               │                │                │
               ▼                ▼                ▼
        ┌──────────────────────────────────────────────────┐
        │         setStatus(newValue)                      │
        │         (or effect updates state)                │
        └──────────────────┬───────────────────────────────┘
                           │
                ┌──────────┴──────────┐
                │                     │
                ▼                     ▼
        ┌──────────────────┐  ┌──────────────────┐
        │ Update React     │  │ Write to         │
        │ State            │  │ localStorage     │
        │ (re-render)      │  │ (JSON.stringify) │
        └──────────────────┘  └──────────────────┘
                │                     │
                │                     ▼
                │            ┌──────────────────┐
                │            │ Dispatch storage │
                │            │ event to all     │
                │            │ tabs/windows     │
                │            └────────┬─────────┘
                │                     │
                │                     ▼
                │            ┌──────────────────┐
                │            │ Other tabs       │
                │            │ receive event    │
                │            │ and sync state   │
                │            └──────────────────┘
                │
                ▼
        ┌──────────────────┐
        │ UI Re-renders    │
        │ with new filter  │
        └──────────────────┘
```

## 3. useLocalStorage Hook Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                    Component Mounts                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────┐
        │ useState initializer runs      │
        │ (read from localStorage)       │
        └────────────┬───────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
    ┌─────────────┐      ┌──────────────────┐
    │ localStorage│      │ localStorage     │
    │ has value?  │      │ is empty or      │
    │             │      │ corrupted?       │
    └────────────┬┘      └────────┬─────────┘
                 │ YES            │ YES
                 ▼                ▼
            ┌─────────┐      ┌──────────────┐
            │ Parse   │      │ Use default  │
            │ JSON    │      │ value        │
            │ value   │      │ (log error)  │
            └────┬────┘      └──────┬───────┘
                 │                  │
                 └──────────┬───────┘
                            │
                            ▼
                    ┌──────────────────┐
                    │ Set initial state│
                    │ in React         │
                    └────────┬─────────┘
                             │
                             ▼
        ┌────────────────────────────────┐
        │ useEffect: Add storage event   │
        │ listener (for cross-tab sync)  │
        └────────────┬───────────────────┘
                     │
                     ▼
        ┌────────────────────────────────┐
        │ Component Ready                │
        │ (can now render)               │
        └────────────────────────────────┘
```

## 4. User Interaction Flow

```
User Interface
    │
    ├─ Status Filter Dropdown
    │  └─ onChange → setStatus('open')
    │
    ├─ Sort Option Dropdown
    │  └─ onChange → setSortOption('reward-high')
    │
    ├─ Min/Max Reward Inputs
    │  └─ onChange → setMinReward('100')
    │
    ├─ Search Input
    │  └─ onChange → setSearchQuery('payment')
    │
    └─ Repo Filter Dropdown
       └─ onChange → setRepoFilter('stellar-core')
                │
                ▼
        ┌──────────────────────────────┐
        │ useLocalStorage setValue()   │
        │ called with new value        │
        └────────────┬─────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
    ┌─────────────┐      ┌──────────────────┐
    │ Update React│      │ Write to         │
    │ state       │      │ localStorage     │
    │ (triggers   │      │ (JSON.stringify) │
    │ re-render)  │      └──────────────────┘
    └─────────────┘               │
        │                         │
        ▼                         ▼
    ┌─────────────┐      ┌──────────────────┐
    │ Component   │      │ Dispatch storage │
    │ re-renders  │      │ event            │
    │ with new    │      └──────────────────┘
    │ filter      │               │
    └─────────────┘               ▼
        │              ┌──────────────────┐
        │              │ Other tabs       │
        │              │ receive event    │
        │              │ and update       │
        │              └──────────────────┘
        │
        ▼
    ┌─────────────────────────────┐
    │ URL updates via             │
    │ window.history.replaceState │
    │ (existing code)             │
    └─────────────────────────────┘
```

## 5. Error Handling Flow

```
┌──────────────────────────────────┐
│ Read from localStorage           │
└────────────┬─────────────────────┘
             │
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
┌─────────┐    ┌──────────────────┐
│ Valid   │    │ Invalid JSON or  │
│ JSON?   │    │ null value?      │
└────┬────┘    └────────┬─────────┘
     │ YES              │ YES
     ▼                  ▼
┌─────────┐    ┌──────────────────┐
│ Parse & │    │ Log error to     │
│ use     │    │ console          │
│ value   │    │ (for debugging)  │
└────┬────┘    └────────┬─────────┘
     │                  │
     └──────────┬───────┘
                │
                ▼
        ┌──────────────────┐
        │ Use default      │
        │ value (fallback) │
        └──────────────────┘
                │
                ▼
        ┌──────────────────┐
        │ App continues    │
        │ normally         │
        │ (no crash)       │
        └──────────────────┘
```

## 6. Cross-Tab Synchronization

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser Window                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐         ┌──────────────────┐         │
│  │   Tab 1          │         │   Tab 2          │         │
│  │ (stellar-board)  │         │ (stellar-board)  │         │
│  │                  │         │                  │         │
│  │ useLocalStorage  │         │ useLocalStorage  │         │
│  │ 'statusFilter'   │         │ 'statusFilter'   │         │
│  │                  │         │                  │         │
│  │ User changes     │         │ Listening for    │         │
│  │ filter to 'open' │         │ storage events   │         │
│  └────────┬─────────┘         └────────┬─────────┘         │
│           │                            │                   │
│           ▼                            │                   │
│  ┌──────────────────┐                  │                   │
│  │ setStatus('open')│                  │                   │
│  │ (setValue)       │                  │                   │
│  └────────┬─────────┘                  │                   │
│           │                            │                   │
│           ▼                            │                   │
│  ┌──────────────────┐                  │                   │
│  │ localStorage     │                  │                   │
│  │ .setItem(        │                  │                   │
│  │  'statusFilter', │                  │                   │
│  │  '"open"'        │                  │                   │
│  │ )                │                  │                   │
│  └────────┬─────────┘                  │                   │
│           │                            │                   │
│           ▼                            │                   │
│  ┌──────────────────┐                  │                   │
│  │ Browser fires    │                  │                   │
│  │ 'storage' event  │                  │                   │
│  │ (all tabs)       │                  │                   │
│  └────────┬─────────┘                  │                   │
│           │                            │                   │
│           └────────────────────────────┼──────────────────┐│
│                                        │                  ││
│                                        ▼                  ││
│                                ┌──────────────────┐       ││
│                                │ storage event    │       ││
│                                │ listener fires   │       ││
│                                │ in Tab 2         │       ││
│                                └────────┬─────────┘       ││
│                                         │                 ││
│                                         ▼                 ││
│                                ┌──────────────────┐       ││
│                                │ Parse new value  │       ││
│                                │ from event       │       ││
│                                └────────┬─────────┘       ││
│                                         │                 ││
│                                         ▼                 ││
│                                ┌──────────────────┐       ││
│                                │ setStoredValue   │       ││
│                                │ ('open')         │       ││
│                                └────────┬─────────┘       ││
│                                         │                 ││
│                                         ▼                 ││
│                                ┌──────────────────┐       ││
│                                │ Tab 2 re-renders │       ││
│                                │ with new filter  │       ││
│                                └──────────────────┘       ││
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 7. URL Parameter Precedence

```
┌─────────────────────────────────────────────────────────────┐
│                    Page Load Sequence                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────┐
        │ readInitialFilters()           │
        │ (reads URL params)             │
        └────────────┬───────────────────┘
                     │
                     ▼
        ┌────────────────────────────────┐
        │ useLocalStorage initializes    │
        │ with URL param value           │
        │ (or default if no URL param)   │
        └────────────┬───────────────────┘
                     │
                     ▼
        ┌────────────────────────────────┐
        │ useEffect watches URL changes  │
        │ (window.location.search)       │
        └────────────┬───────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
    ┌─────────────┐      ┌──────────────────┐
    │ URL changed │      │ URL unchanged    │
    │ (new link)  │      │ (normal use)     │
    └────────┬────┘      └──────────────────┘
             │
             ▼
    ┌──────────────────┐
    │ Read new URL     │
    │ params           │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │ Update state     │
    │ with URL values  │
    │ (override        │
    │ localStorage)    │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │ localStorage     │
    │ updates with     │
    │ new values       │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │ UI re-renders    │
    │ with new filters │
    └──────────────────┘
```

## 8. Component State Management

```
┌─────────────────────────────────────────────────────────────┐
│                      App Component                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Persistent State (useLocalStorage)                        │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ • statusFilter (localStorage key: 'statusFilter')   │  │
│  │ • sortOption (localStorage key: 'sortOption')       │  │
│  │ • sortDirection (localStorage key: 'sortDirection') │  │
│  │ • minReward (localStorage key: 'minReward')         │  │
│  │ • maxReward (localStorage key: 'maxReward')         │  │
│  │ • repoFilter (localStorage key: 'repoFilter')       │  │
│  │ • searchQuery (localStorage key: 'searchQuery')     │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  Non-Persistent State (useState)                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ • bounties (API data)                               │  │
│  │ • loading (loading state)                           │  │
│  │ • error (error messages)                            │  │
│  │ • debouncedSearchQuery (debounced search)           │  │
│  │ • detailBounty (detail view data)                   │  │
│  │ • ... other UI state ...                            │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  Effects                                                   │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ • useEffect: Fetch bounties on mount                │  │
│  │ • useEffect: Debounce search query                  │  │
│  │ • useEffect: Update URL when filters change         │  │
│  │ • useEffect: Sync URL params to state               │  │
│  │ • useEffect: Handle popstate (back/forward)         │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  Derived State (useMemo)                                   │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ • filteredBounties (apply all filters)              │  │
│  │ • sortedBounties (apply sort)                       │  │
│  │ • uniqueRepos (extract unique repos)                │  │
│  │ • rewardBounds (min/max rewards)                    │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 9. localStorage Structure

```
Browser localStorage
├── Key: 'statusFilter'
│   └── Value: "open" (JSON string)
│
├── Key: 'sortOption'
│   └── Value: "reward-high" (JSON string)
│
├── Key: 'sortDirection'
│   └── Value: "desc" (JSON string)
│
├── Key: 'minReward'
│   └── Value: "100" (JSON string)
│
├── Key: 'maxReward'
│   └── Value: "1000" (JSON string)
│
├── Key: 'repoFilter'
│   └── Value: "stellar-core" (JSON string)
│
└── Key: 'searchQuery'
    └── Value: "payment" (JSON string)
```

## 10. Testing Coverage Map

```
useLocalStorage Hook Tests
├── Basic Functionality (4 tests)
│   ├── Initialize with default
│   ├── Initialize with stored value
│   ├── Persist on update
│   └── Support functional updates
│
├── Type Support (6 tests)
│   ├── String values
│   ├── Number values
│   ├── Boolean values
│   ├── Object values
│   ├── Array values
│   └── Union types
│
├── Error Handling (3 tests)
│   ├── JSON parse errors
│   ├── Corrupted data
│   └── localStorage quota exceeded
│
├── Cross-Tab Sync (5 tests)
│   ├── Sync on storage event
│   ├── Ignore different keys
│   ├── Handle item removal
│   ├── Handle corrupted data from other tab
│   └── Cleanup on unmount
│
├── Complex Scenarios (3 tests)
│   ├── Filter state objects
│   ├── Partial updates
│   └── Multiple independent hooks
│
└── Edge Cases (5 tests)
    ├── null values
    ├── Empty strings
    ├── Zero values
    ├── false values
    └── Deeply nested objects
```

---

These diagrams illustrate the complete architecture of the filter persistence system, showing how data flows through the application, how errors are handled, and how state is synchronized across tabs and browser sessions.
