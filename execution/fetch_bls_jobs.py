#!/usr/bin/env python3
"""
BLS API Data Fetch Tool
========================
Fetches monthly employment and unemployment data for the
Miami–Fort Lauderdale–West Palm Beach, FL Metro Area (CBSA: 33100)
from the U.S. Bureau of Labor Statistics (BLS) API v2.

Series pulled:
  - LAUMT123310000000003  →  Unemployment Rate (%)
  - LAUMT123310000000005  →  Total Employment Level (persons)

Output:
  - ../jobs_data.json  (project root)

Usage:
  python3 fetch_bls_jobs.py [--years N]

Options:
  --years N   Number of years of history to fetch (default: 10, max: 20)
"""

import os
import sys
import json
import time
import argparse
import logging
from datetime import datetime, timezone
from pathlib import Path

import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"

SERIES = {
    "LAUMT123310000000003": {
        "label": "Unemployment Rate",
        "unit": "%",
        "description": "Monthly unemployment rate for the Miami–Fort Lauderdale–West Palm Beach, FL Metro Area",
    },
    "LAUMT123310000000005": {
        "label": "Total Employment Level",
        "unit": "persons",
        "description": "Total employed persons for the Miami–Fort Lauderdale–West Palm Beach, FL Metro Area",
    },
}

METRO = {
    "name": "Miami–Fort Lauderdale–West Palm Beach, FL",
    "cbsa_code": "33100",
    "area_code": "12060",
    "state": "Florida",
}

OUTPUT_FILE = Path(__file__).parent.parent / "jobs_data.json"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_api_key() -> str | None:
    """Load BLS API key from environment or .env file."""
    key = os.environ.get("BLS_API_KEY", "").strip()
    if key:
        log.info("BLS API key loaded from environment variable.")
        return key

    search_dirs = [
        Path(__file__).parent,
        Path(__file__).parent.parent,
        Path.cwd(),
    ]
    for d in search_dirs:
        env_path = d / ".env"
        if env_path.exists():
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("BLS_API_KEY="):
                        key = line.split("=", 1)[1].strip().strip('"').strip("'")
                        if key:
                            log.info(f"BLS API key loaded from {env_path}")
                            return key

    log.warning(
        "No BLS_API_KEY found. Using unauthenticated tier "
        "(limited to 25 series/day, 10 years of data)."
    )
    return None


def fetch_series(series_ids, start_year, end_year, api_key, retries=3, backoff=2.0):
    payload = {
        "seriesid": series_ids,
        "startyear": str(start_year),
        "endyear": str(end_year),
        "calculations": True,
        "annualaverage": False,
        "aspects": False,
    }
    if api_key:
        payload["registrationkey"] = api_key

    headers = {"Content-Type": "application/json"}

    for attempt in range(1, retries + 1):
        try:
            log.info(f"Fetching BLS data (attempt {attempt}/{retries}): years={start_year}–{end_year}")
            resp = requests.post(BLS_API_URL, json=payload, headers=headers, timeout=30)
            resp.raise_for_status()
            data = resp.json()

            status = data.get("status", "UNKNOWN")
            if status != "REQUEST_SUCCEEDED":
                messages = data.get("message", [])
                log.error(f"BLS API returned status '{status}': {messages}")
                raise RuntimeError(f"BLS API error: {messages}")

            return data

        except (requests.RequestException, RuntimeError) as exc:
            log.warning(f"Attempt {attempt} failed: {exc}")
            if attempt < retries:
                sleep_time = backoff ** attempt
                log.info(f"Retrying in {sleep_time:.1f}s …")
                time.sleep(sleep_time)
            else:
                raise


def parse_series_data(raw_series):
    records = []
    for item in raw_series.get("data", []):
        period = item.get("period", "")
        if not period.startswith("M") or period == "M13":
            continue
        try:
            month_num = int(period[1:])
            year = int(item["year"])
            value = float(item["value"])
        except (ValueError, KeyError):
            continue

        records.append({
            "year": year,
            "month": month_num,
            "period": f"{year}-{month_num:02d}",
            "value": value,
            "footnotes": [
                f.get("text", "") for f in item.get("footnotes", []) if f.get("text")
            ],
        })

    records.sort(key=lambda r: (r["year"], r["month"]))
    return records


def build_output(api_response):
    series_map = {}
    for raw in api_response.get("Results", {}).get("series", []):
        sid = raw.get("seriesID", "")
        series_map[sid] = parse_series_data(raw)

    output = {
        "metadata": {
            "source": "U.S. Bureau of Labor Statistics (BLS) Local Area Unemployment Statistics",
            "api_version": "v2",
            "metro_area": METRO,
            "series_definitions": {
                sid: {"label": info["label"], "unit": info["unit"], "description": info["description"]}
                for sid, info in SERIES.items()
            },
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "fetch_status": "success",
        },
        "series": {},
    }

    for sid, info in SERIES.items():
        records = series_map.get(sid, [])
        output["series"][sid] = {
            "label": info["label"],
            "unit": info["unit"],
            "data": records,
            "record_count": len(records),
            "latest": records[-1] if records else None,
        }
        log.info(f"  {info['label']} ({sid}): {len(records)} monthly records")

    return output


def save_output(data, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    log.info(f"Data saved → {path.resolve()}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Fetch BLS employment data for Miami–Fort Lauderdale–West Palm Beach metro area."
    )
    parser.add_argument("--years", type=int, default=10, metavar="N",
                        help="Number of years of history to fetch (default: 10, max: 20)")
    args = parser.parse_args()

    current_year = datetime.now().year
    years_back = max(1, min(args.years, 20))
    start_year = current_year - years_back
    end_year = current_year

    api_key = load_api_key()
    series_ids = list(SERIES.keys())

    log.info("=" * 60)
    log.info("BLS Job Market Data Fetch — Miami–Fort Lauderdale–West Palm Beach")
    log.info(f"  CBSA Code       : {METRO['cbsa_code']}")
    log.info(f"  Series          : {', '.join(series_ids)}")
    log.info(f"  Date Range      : {start_year} – {end_year}")
    log.info(f"  Output File     : {OUTPUT_FILE.resolve()}")
    log.info("=" * 60)

    chunk_size = 20 if api_key else 10
    all_raw_series = {sid: [] for sid in series_ids}

    chunk_start = start_year
    while chunk_start <= end_year:
        chunk_end = min(chunk_start + chunk_size - 1, end_year)
        raw = fetch_series(series_ids, chunk_start, chunk_end, api_key)
        for raw_series in raw.get("Results", {}).get("series", []):
            sid = raw_series.get("seriesID", "")
            if sid in all_raw_series:
                all_raw_series[sid].extend(raw_series.get("data", []))
        chunk_start = chunk_end + 1

    synthetic_response = {
        "Results": {
            "series": [{"seriesID": sid, "data": data} for sid, data in all_raw_series.items()]
        }
    }

    output = build_output(synthetic_response)
    save_output(output, OUTPUT_FILE)

    log.info("")
    log.info("✅ Fetch complete. Summary:")
    for sid, series_info in output["series"].items():
        latest = series_info.get("latest")
        latest_str = (
            f"{latest['period']} → {latest['value']} {series_info['unit']}"
            if latest else "no data"
        )
        log.info(f"  [{series_info['label']}] {series_info['record_count']} records | Latest: {latest_str}")
    log.info(f"  Last updated: {output['metadata']['last_updated']}")


if __name__ == "__main__":
    main()
