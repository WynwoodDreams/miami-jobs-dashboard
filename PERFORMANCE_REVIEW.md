# Job Stats Miami — Performance & Optimization Review

> Reviewed: March 2026
> Scope: Reduce API load, improve dashboard speed, keep data reliable
> Architecture: Static site (vanilla JS + Chart.js) backed by Python BLS fetcher → `jobs_data.json`

---

## 1. Likely Bottlenecks

| # | Bottleneck | Why It Matters |
|---|-----------|---------------|
| 1 | **Cache-busted data fetch on every page load** | `fetch('jobs_data.json?v=' + Date.now())` forces a fresh download (~50KB) on every visit, even though BLS data changes monthly at most |
| 2 | **All 9+ charts build at once on init** | Every Chart.js instance (overview, national, signals, AI) renders immediately regardless of which tab the user is viewing |
| 3 | **No browser caching at all** | HTML meta tags explicitly disable caching (`no-cache, no-store, must-revalidate`), and the `?v=timestamp` on the JSON prevents 304 responses |
| 4 | **Python fetcher has no local cache** | Every run of `fetch_bls_jobs.py` hits the BLS API fresh, even if data hasn't changed |
| 5 | **Chart.js loaded from CDN with no fallback** | If jsdelivr is slow or down, the entire dashboard is broken |
| 6 | **Google Fonts blocking render** | Inter font loads synchronously before first paint |
| 7 | **No minification** | ~943 lines of JS, ~2600 lines of HTML, ~1650 lines of CSS shipped raw |
| 8 | **Hardcoded demo data rebuilt every load** | AI Exposure and Hiring Signals charts process static arrays on every page load |

---

## 2. Quick Wins (Implement First)

### Win 1: Remove the cache-buster on `jobs_data.json`
**Current** (`app.js:894`):
```js
const resp = await fetch('jobs_data.json?v=' + Date.now());
```
**Proposed**:
```js
const resp = await fetch('jobs_data.json');
```
Then let the server set a proper `Cache-Control` header (see Caching Strategy below). Since BLS data updates monthly, there's no reason to bypass the cache on every visit.

**Impact**: Eliminates ~50KB re-download on every page load for returning visitors.

### Win 2: Lazy-build charts for inactive tabs
**Current**: `init()` builds all charts (overview + national + signals + AI) at once.
**Proposed**: Only build the active tab's charts on load. Build others when the user switches tabs.

```js
const tabBuilt = { dashboard: false, national: false, signals: false, ai: false };

function switchTab(tab) {
  // existing tab-switching logic...

  if (!tabBuilt[tab]) {
    if (tab === 'national' && nuData) buildNationSection(miamiUData, nuData);
    if (tab === 'signals') buildSignalsCharts();
    if (tab === 'ai') buildAICharts();
    tabBuilt[tab] = true;
  }
}
```
**Impact**: Reduces initial JS execution time by ~40-60%. Only the overview tab (which users see first) renders on load.

### Win 3: Preconnect and async-load fonts
**Current**: Synchronous font load blocks first paint.
**Proposed**:
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap"
      rel="stylesheet" media="print" onload="this.media='all'" />
```
Also trim unused font weights. Current load: `300;400;500;600;700;800;900` (7 weights). Likely needed: `400;600;700` (3 weights). Cuts font payload by ~50%.

### Win 4: Remove anti-caching meta tags
**Current** (`jobs-dashboard.html:5-7`):
```html
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
<meta http-equiv="Pragma" content="no-cache" />
<meta http-equiv="Expires" content="0" />
```
**Proposed**: Remove all three. These prevent the browser from caching the HTML page itself. For a dashboard that changes when the JSON data changes (monthly), this is unnecessary.

---

## 3. Caching Strategy

### 3.1 What to Cache and for How Long

| Asset | Cache Duration | Rationale |
|-------|---------------|-----------|
| `jobs_data.json` | **24 hours** (`Cache-Control: public, max-age=86400`) | BLS data updates monthly. 24h is conservative enough to pick up new data within a day of a refresh run |
| HTML pages | **1 hour** (`max-age=3600`) | Layout changes are infrequent; 1h keeps the page fresh enough during active development |
| `styles.css`, `app.js` | **7 days** with content hash (`max-age=604800, immutable`) | Rename to `app.[hash].js` when contents change. Browser caches indefinitely until the HTML references a new hash |
| Chart.js CDN | **Handled by jsdelivr** | Already cached by CDN; add `integrity` + `crossorigin` attributes for security |
| Google Fonts | **Handled by Google** | Already cached by Google's CDN |

### 3.2 Separate Historical from Recent Data

BLS historical data (2006–2024) never changes. Only the latest 2-3 months may get revised.

**Option A (simple, recommended)**: Keep one `jobs_data.json` but add a `data_hash` field to metadata. The frontend can store this hash in `localStorage` and skip re-parsing if the hash matches.

```js
async function init() {
  const resp = await fetch('jobs_data.json');
  const data = await resp.json();

  const cachedHash = localStorage.getItem('data_hash');
  if (cachedHash === data.metadata.data_hash) {
    // Use cached parsed data from localStorage
    const cached = JSON.parse(localStorage.getItem('parsed_data'));
    renderFromCache(cached);
    return;
  }

  // Parse fresh data, store in localStorage
  localStorage.setItem('data_hash', data.metadata.data_hash);
  localStorage.setItem('parsed_data', JSON.stringify(parsedResult));
  render(parsedResult);
}
```

**Option B (future)**: Split into `jobs_data_historical.json` (2006–2023, immutable, cache forever) and `jobs_data_recent.json` (2024–present, cache 24h). Only fetch recent on repeat visits.

### 3.3 Cache Common Comparison Queries

Since comparisons are Miami vs. National (only 2 series), and you already fetch both in one `jobs_data.json`, there's nothing extra to cache at the query level. The comparison is computed client-side from data already in memory. If you add more comparison metros later, precompute them in the Python script and include them in the JSON.

---

## 4. Request-Flow Strategy

### 4.1 Before vs. After Request Flow

**BEFORE (current)**:
```
User opens page
  │
  ├─→ GET jobs-dashboard.html         (no cache, always fresh)
  ├─→ GET chart.js@4.4.2 from CDN    (CDN cached)
  ├─→ GET Inter font from Google      (blocks render)
  ├─→ GET jobs_data.json?v=168...     (cache-busted, always fresh ~50KB)
  │
  ├─→ Parse JSON
  ├─→ Build ALL 9+ charts at once     (blocks UI ~200-400ms)
  ├─→ Build data table
  └─→ Remove loading overlay

  Total requests: 4+ on every visit
  Cacheable: 1 (Chart.js CDN)
  Time to interactive: ~1-2s
```

**AFTER (proposed)**:
```
User opens page
  │
  ├─→ GET jobs-dashboard.html         (cached 1h)
  ├─→ GET app.[hash].js               (cached 7d, immutable)
  ├─→ GET chart.js@4.4.2 from CDN    (CDN cached, with integrity)
  ├─→ GET Inter font (async, non-blocking)
  ├─→ GET jobs_data.json              (cached 24h, ETag for 304)
  │
  ├─→ Check localStorage data_hash
  │   ├─ Match? → Use cached parsed data
  │   └─ No match? → Parse JSON, cache in localStorage
  │
  ├─→ Build ONLY overview tab charts  (4 charts instead of 9+)
  └─→ Remove loading overlay

  User switches to National tab
  └─→ Build national charts (lazy, from already-loaded data)

  User switches to AI tab
  └─→ Build AI charts (lazy, from hardcoded data already in memory)

  Total requests on repeat visit: 1-2 (most served from cache / 304)
  Time to interactive: ~400-600ms
```

### 4.2 Example Endpoint Ideas

If you eventually add a lightweight server (Express, Flask, or Vercel serverless), here are useful endpoints:

| Endpoint | Purpose | Cache |
|----------|---------|-------|
| `GET /api/data` | Return full `jobs_data.json` | 24h, ETag |
| `GET /api/data/hash` | Return only the data hash (tiny response) | 1h |
| `GET /api/data/latest` | Return only last 24 months | 6h |
| `GET /api/data/kpis` | Precomputed KPI values (rate, delta, avg, peak) | 24h |
| `GET /api/data/comparison?metro=miami&vs=national` | Precomputed comparison with spread, index | 24h |
| `GET /api/health` | Uptime + last data refresh timestamp | No cache |

For now (static hosting), none of these are needed. The single `jobs_data.json` file serves all needs.

---

## 5. Frontend Improvements

### 5.1 Prevent Duplicate Fetches
**Current risk**: If `init()` is called twice (script error, re-mount), two fetches fire.
**Fix**:
```js
let initPromise = null;
function init() {
  if (initPromise) return initPromise;
  initPromise = _doInit();
  return initPromise;
}
```

### 5.2 Tab Switch — Don't Rebuild Charts
**Current**: Charts are built once and never destroyed, which is fine. But `switchTab()` could be called rapidly.
**Fix**: The `tabBuilt` guard (Win 2) handles this. Charts build exactly once.

### 5.3 Range Buttons — No Extra Fetch Needed
**Current**: Range buttons (2Y/5Y/10Y/All) slice already-loaded data and call `chart.update()`. This is already efficient — no changes needed here.

### 5.4 Debounce is Not Needed (Yet)
The current filters (role filter buttons on the Signals tab) are simple class toggles with no API calls. No debounce needed. If you add search inputs or dropdowns that trigger data fetches later, add a 300ms debounce then.

### 5.5 Loading States per Tab
**Current**: One global loading overlay removed after init.
**Proposed**: Add a lightweight spinner per tab section for lazy-loaded charts:
```js
function switchTab(tab) {
  // show tab
  if (!tabBuilt[tab]) {
    showTabSpinner(tab);
    requestAnimationFrame(() => {
      buildTabCharts(tab);
      hideTabSpinner(tab);
      tabBuilt[tab] = true;
    });
  }
}
```

### 5.6 Reduce Font Payload
Change from:
```
Inter:wght@300;400;500;600;700;800;900
```
To:
```
Inter:wght@400;600;700
```
Check CSS for actual usage — the 300, 500, 800, 900 weights appear unused or rarely used.

---

## 6. Backend / API Improvements

### 6.1 Add Data Hash to `fetch_bls_jobs.py` Output
```python
import hashlib

def save_output(data, path):
    raw = json.dumps(data["series"], sort_keys=True)
    data["metadata"]["data_hash"] = hashlib.sha256(raw.encode()).hexdigest()[:12]
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
```
This lets the frontend detect whether data actually changed.

### 6.2 Add a Precomputed KPIs Section
Compute KPIs in Python so the frontend doesn't recompute them every time:
```python
data["computed"] = {
    "miami_unemployment": {
        "latest": 3.8,
        "prior_month": 3.9,
        "delta": -0.1,
        "avg_12m": 3.6,
        "peak": {"value": 12.3, "period": "2020-04"},
    },
    "spread_vs_national": {
        "latest": -0.2,
        "status": "outperforming"  # or "lagging" or "at_parity"
    }
}
```

### 6.3 Skip Fetch if Data is Current
Add a check to `fetch_bls_jobs.py`:
```python
def data_is_current(path):
    """Skip fetch if last_updated is within 25 days."""
    if not os.path.exists(path):
        return False
    with open(path) as f:
        existing = json.load(f)
    last = existing["metadata"]["last_updated"]
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(last)).days
    return age < 25
```

### 6.4 BLS Rate Limit Protection
**Current**: 1-second delay between requests + 3 retries with exponential backoff. This is already solid.
**Add**:
- Log the BLS daily quota usage (25 queries/day unauthenticated, 500 with key)
- If running via cron, add a lock file to prevent overlapping runs:
```python
import fcntl

lock_file = open('/tmp/fetch_bls.lock', 'w')
try:
    fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
except IOError:
    print("Another fetch is running, exiting.")
    sys.exit(0)
```

---

## 7. Data Refresh Schedule

| Data Type | Refresh Frequency | Rationale |
|-----------|------------------|-----------|
| **Miami unemployment rate** | Monthly (1st–10th of month) | BLS releases LAUS data ~3 weeks after reference month |
| **Miami employment level** | Monthly (same schedule) | Same BLS release |
| **National unemployment rate** | Monthly (first Friday) | BLS Employment Situation report |
| **National employment level** | Monthly (first Friday) | Same report |
| **AI Exposure data** | Quarterly or on-demand | Currently hardcoded; update when new research is published |
| **Hiring Signals** | Weekly or on-demand | Currently hardcoded demo data; update when you add a real data source |
| **Wage data** | Annually (May OEWS release) | BLS OEWS data publishes annually with ~1 year lag |

**Recommended cron schedule**:
```bash
# Fetch BLS data monthly on the 15th at 9am ET (after all monthly releases)
0 9 15 * * cd /path/to/project && python3 execution/fetch_bls_jobs.py --years 2

# Optional: retry on 16th in case of failure
0 9 16 * * cd /path/to/project && python3 execution/fetch_bls_jobs.py --years 2
```

**Why the 15th?** The BLS LAUS (Local Area Unemployment Statistics) for Miami typically releases around the 3rd week of the following month. Running on the 15th catches the prior month's state/metro data for most months. If you want to catch it faster, run on the 20th instead.

---

## 8. Priority Order

### HIGH Priority (do this week)
| # | Change | Effort | Impact |
|---|--------|--------|--------|
| 1 | Remove `?v=Date.now()` cache-buster from `jobs_data.json` fetch | 1 min | Enables browser caching for the largest asset |
| 2 | Remove anti-caching meta tags from HTML | 1 min | Enables browser caching for the HTML page |
| 3 | Lazy-build charts for inactive tabs | 30 min | Cuts initial render work by ~50% |
| 4 | Trim font weights (7 → 3) and async-load | 5 min | Faster first paint, smaller font download |

### MEDIUM Priority (this month)
| # | Change | Effort | Impact |
|---|--------|--------|--------|
| 5 | Add `data_hash` to Python output + localStorage caching in JS | 1-2 hrs | Skip re-parsing on repeat visits |
| 6 | Add precomputed KPIs section in JSON output | 1 hr | Reduce client-side computation |
| 7 | Add `integrity` + `crossorigin` to Chart.js CDN link | 5 min | Security + cache reliability |
| 8 | Guard against double `init()` calls | 10 min | Prevent duplicate fetches |
| 9 | Add per-tab loading spinners | 30 min | Better UX for lazy-loaded tabs |

### LOW Priority (when needed)
| # | Change | Effort | Impact |
|---|--------|--------|--------|
| 10 | Minify JS/CSS for production | 30 min | ~30-40% smaller payloads |
| 11 | Split `jobs_data.json` into historical + recent | 2-3 hrs | Only matters if the JSON grows significantly |
| 12 | Add a service worker for offline support | 3-4 hrs | Nice for mobile users, not critical |
| 13 | Self-host Chart.js instead of CDN | 15 min | Eliminates external dependency |
| 14 | Add lock file to prevent concurrent fetcher runs | 30 min | Only matters with aggressive cron |

---

## 9. What NOT to Overbuild Yet

| Temptation | Why to Skip It |
|-----------|---------------|
| **Add a backend server (Express/Flask)** | The static JSON approach works perfectly for monthly BLS data. A server adds hosting cost and complexity for zero benefit right now. |
| **Add Redis/Memcached** | You have one JSON file. `localStorage` + HTTP caching is all you need. |
| **Add React/Next.js** | The vanilla JS works, renders fast, and has zero build step. A framework migration is a full rewrite with no user-facing benefit. |
| **Add a database** | 4 series × 240 months = ~960 records. A JSON file handles this fine. |
| **Build a real-time WebSocket feed** | BLS data updates monthly. Polling every 24h is more than sufficient. |
| **Add GraphQL** | You have one data shape served from one file. GraphQL solves a problem you don't have. |
| **Split into microservices** | One Python script + one JSON file + one HTML page. There's nothing to split. |
| **Add user authentication** | Unless you need personalized views, skip it. |
| **Over-index on CDN/edge caching** | Relevant when you have thousands of concurrent users. For now, browser caching covers it. |

---

## 10. Rollout Plan

### Phase 1: Quick Cache Wins (Day 1)
- [ ] Remove `?v=Date.now()` from `fetch('jobs_data.json')` in `app.js`
- [ ] Remove the 3 anti-caching meta tags from `jobs-dashboard.html`
- [ ] Trim Inter font weights to `400;600;700`
- [ ] Add `media="print" onload="this.media='all'"` to font stylesheet link
- **Expected result**: Returning visitors load instantly from browser cache. First paint is faster.

### Phase 2: Lazy Rendering (Day 2-3)
- [ ] Add `tabBuilt` guard object
- [ ] Move `buildNationSection()`, `buildSignalsCharts()`, and `buildAICharts()` into `switchTab()`
- [ ] Add lightweight per-tab spinner
- [ ] Guard `init()` against double execution
- **Expected result**: Initial page load renders 4 charts instead of 9+. Time to interactive drops significantly.

### Phase 3: Smart Caching (Week 2)
- [ ] Add `data_hash` field to `fetch_bls_jobs.py` output
- [ ] Add `localStorage` caching in `app.js` keyed by `data_hash`
- [ ] Add precomputed KPI values to JSON output
- [ ] Add `integrity` attribute to Chart.js CDN script tag
- **Expected result**: Repeat visits skip JSON parsing entirely. KPIs render from precomputed values.

### Phase 4: Production Polish (Week 3-4)
- [ ] Minify `app.js` and `styles.css` (use a simple tool like `terser` and `csso`)
- [ ] Consider self-hosting Chart.js
- [ ] Add skip-if-current logic to `fetch_bls_jobs.py`
- [ ] Fine-tune cron schedule for BLS release dates
- [ ] Add fetcher lock file for cron safety
- **Expected result**: Production-grade performance with minimal infrastructure.

---

## Summary

This site is well-structured for its purpose. The main performance issues are not architectural — they're about **unnecessary cache-busting** and **eager rendering**. Four changes (remove cache-buster, remove anti-cache meta tags, lazy-load tabs, trim fonts) will deliver most of the performance gains in under an hour of work. Everything else is incremental polish.

The BLS data model is inherently friendly to caching: it updates monthly, historical data never changes, and the total payload is small (~50KB). Lean into that instead of fighting it with `Date.now()` cache-busting.
