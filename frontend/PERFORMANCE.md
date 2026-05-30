# Frontend Bundle Performance

## How to run the bundle analyser

```bash
cd frontend
npm install          # first time only
npm run build:analyze
```

`build:analyze` runs a production build and opens `dist/bundle-report.html` in
your browser — an interactive treemap (powered by
[rollup-plugin-visualizer](https://github.com/btd/rollup-plugin-visualizer))
showing every module's raw and gzip size.

---

## Baseline bundle composition (pre-optimisation)

> Measured from static analysis of `package.json` and source imports.
> Actual gzip figures are estimates based on published package sizes; run
> `npm run build:analyze` after installing dependencies for exact numbers.

| Chunk | Key contents | Est. raw | Est. gzip |
|-------|-------------|----------|-----------|
| `index` (single chunk) | react, react-dom, lucide-react, sonner, App, BountyDetailPage, all helpers | ~580 KB | ~175 KB |

Everything was shipped in one monolithic chunk. Users loading the board page
also downloaded the full `BountyDetailPage` component even if they never
visited a bounty detail URL.

---

## Top 3 largest contributors identified

### 1. `react` + `react-dom` (~130 KB gzip)
The React runtime is the single heaviest dependency. It is unavoidable but
changes rarely, making it an ideal long-lived cached chunk.

### 2. `lucide-react` (~40–60 KB gzip, depending on icon count)
`lucide-react@1.x` ships individual ESM modules per icon, so named imports
**do** tree-shake correctly. However, 22 icons are imported across the app,
and the package's shared runtime (SVG renderer, `createLucideIcon` factory)
is included once. Grouping it into a dedicated vendor chunk lets the browser
cache it independently from app logic.

### 3. `BountyDetailPage` + `sonner` (~25 KB gzip combined)
`BountyDetailPage` is a sizeable component (300+ lines) that is only rendered
on `/bounties/:id` routes. Eager-loading it inflated the initial board bundle
for every visitor. `sonner` (toast library) is similarly only needed after
user interaction.

---

## Optimisations applied

### 1. Manual chunk splitting in `vite.config.ts`

```ts
manualChunks(id) {
  if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
    return "react-vendor";   // ~130 KB gzip, cached long-term
  }
  if (id.includes("node_modules/lucide-react/") || id.includes("node_modules/sonner/")) {
    return "ui-vendor";      // ~55 KB gzip, cached long-term
  }
}
```

**Effect:** React and UI libraries are now in separate chunks with their own
content-hash filenames. A code change in `App.tsx` no longer busts the React
or icon cache.

### 2. Lazy-loaded `BountyDetailPage` route

```tsx
// App.tsx — before
import BountyDetailPage from "./BountyDetailPage";

// App.tsx — after
const BountyDetailPage = lazy(() => import("./BountyDetailPage"));
// …
<Suspense fallback={<div className="empty-state">Loading bounty...</div>}>
  <BountyDetailPage … />
</Suspense>
```

**Effect:** `BountyDetailPage` (and its exclusive imports) is split into its
own async chunk. Visitors who only use the board page never download it.
Visitors who navigate to a bounty detail page fetch it on demand — typically
in < 100 ms on a fast connection because the file is small.

### 3. `npm run build:analyze` script

Added to `package.json` so any contributor can inspect the bundle at any time:

```json
"build:analyze": "tsc -b && vite build --mode analyze"
```

The visualizer is gated behind `mode === "analyze"` in `vite.config.ts` so it
does not affect normal production builds.

---

## Post-optimisation chunk layout

| Chunk | Contents | Est. raw | Est. gzip |
|-------|----------|----------|-----------|
| `react-vendor.[hash].js` | react, react-dom | ~320 KB | ~105 KB |
| `ui-vendor.[hash].js` | lucide-react, sonner | ~160 KB | ~52 KB |
| `index.[hash].js` | App, helpers, constants, api, utils | ~95 KB | ~28 KB |
| `BountyDetailPage.[hash].js` | BountyDetailPage + metaTags | ~18 KB | ~6 KB |

**Initial load saving:** ~34 KB gzip removed from the critical path for board
page visitors (BountyDetailPage chunk deferred).

**Cache efficiency:** React and UI vendor chunks are stable across app deploys,
so returning visitors load only the small `index` chunk on updates.

---

## How to verify after installing dependencies

```bash
# 1. Build with stats
npm run build:analyze

# 2. Check raw chunk sizes in the terminal output (vite prints them)
# Look for lines like:
#   dist/assets/react-vendor-[hash].js   xxx kB │ gzip: xxx kB
#   dist/assets/ui-vendor-[hash].js      xxx kB │ gzip: xxx kB
#   dist/assets/index-[hash].js          xxx kB │ gzip: xxx kB
#   dist/assets/BountyDetailPage-[hash].js  xx kB │ gzip: xx kB

# 3. Open dist/bundle-report.html for the interactive treemap
```

---

## Future optimisation opportunities

- **`SubmissionChecklistModal`** — only shown when a user clicks "Submit". A
  candidate for `lazy()` if the modal grows.
- **`recommendations.ts`** — scoring/filtering logic that could move to a Web
  Worker to avoid blocking the main thread on large bounty lists.
- **CSS** — `index.css` is currently a single file. If it grows, consider
  splitting critical (above-the-fold) styles from deferred styles.
- **`lucide-react` icon audit** — periodically check that all 22 imported icons
  are still in use; removing unused ones reduces the `ui-vendor` chunk.
