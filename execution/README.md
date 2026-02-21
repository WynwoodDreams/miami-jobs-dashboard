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

## Scheduling

```cron
# Refresh on the 1st of each month at 9am
0 9 1 * * cd /path/to/project && python3 execution/fetch_bls_jobs.py --years 2
```
