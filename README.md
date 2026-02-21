# Miami Metro Job Market Dashboard

Interactive job market data pipeline and dashboard for the **Miami–Fort Lauderdale–West Palm Beach, FL Metro Area**, powered by the U.S. Bureau of Labor Statistics (BLS) Local Area Unemployment Statistics (LAUS) API.

---

## Quick Start

```bash
# 1. Copy and fill in your BLS API key
cp .env.example .env
# Edit .env → BLS_API_KEY=your_key_here

# 2. Fetch latest data
python3 execution/fetch_bls_jobs.py --years 20

# 3. Serve the dashboard
python3 -m http.server 8080
# Open: http://localhost:8080/jobs-dashboard.html
```

---

## BLS Series

| Series ID | Metric | Unit |
|-----------|--------|------|
| `LAUMT123310000000003` | Unemployment Rate | % |
| `LAUMT123310000000005` | Total Employment Level | persons |

**Metro Area:** Miami–Fort Lauderdale–West Palm Beach, FL  
**CBSA Code:** 33100 · **Frequency:** Monthly, not seasonally adjusted

---

## Files

| File | Description |
|------|-------------|
| `execution/fetch_bls_jobs.py` | BLS API v2 data fetch script |
| `jobs_data.json` | Fetched data (239 records, Jan 2006 – Dec 2025) |
| `jobs-dashboard.html` | Interactive dashboard (Chart.js, no build step) |
| `.env.example` | API key template |
| `execution/README.md` | Detailed pipeline documentation |

---

## Dashboard Features

- 4 KPI cards — latest unemployment rate, employment level, 12-month average, peak on record
- Unemployment rate trend chart (2Y / 5Y / 10Y / All filters)
- Employment level trend chart (2Y / 5Y / 10Y / All filters)
- Dual-axis overlay chart — unemployment vs. employment on same timeline
- Year-over-year change bar chart
- Seasonal pattern chart — average by calendar month
- 24-month data table with YoY deltas and preliminary flags

---

## API Key

Register for a free BLS API key (required for 20 years of data):  
👉 https://www.bls.gov/developers/api_signature_v2.htm

Without a key, the unauthenticated tier allows 25 series/day and 10 years of history.

---

## Data Source

U.S. Bureau of Labor Statistics — [Local Area Unemployment Statistics (LAUS)](https://www.bls.gov/lau/)  
Data is not seasonally adjusted. BLS releases metro area data approximately 3–4 weeks after the reference month.
