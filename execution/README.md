# BLS Data Fetch Script

## Usage

```bash
# Default: 10 years of history
python3 fetch_bls_jobs.py

# Custom range (up to 20 years with API key)
python3 fetch_bls_jobs.py --years 20
```

## API Key

Set `BLS_API_KEY` in a `.env` file at the project root, or as an environment variable.

Without a key: max 10 years, 25 series/day.  
With a key: max 20 years, higher rate limits.

## Output

Writes `jobs_data.json` to the project root with the structure:

```json
{
  "metadata": { "last_updated": "...", "metro_area": {...}, ... },
  "series": {
    "LAUMT123310000000003": { "label": "Unemployment Rate", "data": [...] },
    "LAUMT123310000000005": { "label": "Total Employment Level", "data": [...] }
  }
}
```

Each data record:
```json
{ "year": 2025, "month": 12, "period": "2025-12", "value": 3.5, "footnotes": ["Preliminary."] }
```

## Syncing index.html

`index.html` ships its data hard-coded inline (so the page renders without a
runtime fetch). After running the fetch script, re-inject the fresh data:

```bash
python3 sync_index_data.py
```

This rewrites the `const data = {...};` block in `index.html` from
`jobs_data.json`. Skipping it leaves the dashboard's "Updated ... ago" badge
and charts stale even though `jobs_data.json` is current.

## Scheduling

Automated monthly via `.github/workflows/monthly-data-update.yml`, which runs
the fetch + sync and commits the result. Add a `BLS_API_KEY` repo secret to
unlock the full 20-year history (without it the API caps at 10 years).

To run on a local cron instead:

```cron
# Refresh on the 1st of each month at 9am
0 9 1 * * cd /path/to/project && python3 execution/fetch_bls_jobs.py --years 20 --force && python3 execution/sync_index_data.py
```
