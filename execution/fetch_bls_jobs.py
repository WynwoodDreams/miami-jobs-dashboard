#!/usr/bin/env python3
"""
BLS API Data Fetch Tool
========================
Fetches monthly employment and unemployment data for:
  1. Miami–Fort Lauderdale–West Palm Beach, FL Metro Area (CBSA: 33100)
  2. United States National (for Miami vs. Nation comparison)

Series pulled:
  Miami Metro:
    - LAUMT123310000000003  →  Unemployment Rate (%)
    - LAUMT123310000000005  →  Total Employment Level (persons)

  National:
    - LNS14000000            →  US Unemployment Rate (%) — seasonally adjusted
    - LNS12000000            →  US Civilian Employment Level (thousands of persons)

Output:
  - ../jobs_data.json  (project root)

Resilience model (why this script is hard to break):
  * MERGE, don't replace. Newly fetched months are merged over the existing
    jobs_data.json, keyed by period. Historical months that aren't re-fetched
    are preserved, and revised months (BLS often revises the last 2–3) are
    overwritten with the fresher value. A short fetch can therefore only
    *refresh* recent data — it can never shrink the 20-year history.
  * Fail soft. A transient error on one chunk falls back to per-series
    requests; a series that still fails is simply left at its existing value.
    One dropped connection no longer discards the whole run.
  * Never clobber good data with nothing. If the fetch returns zero records,
    the existing file is left untouched and the run exits non-zero so CI
    surfaces the outage without corrupting the dataset.
  * No spurious commits. If the merged series are byte-identical to what's
    already on disk, the file (and its last_updated stamp) is left alone.

Usage:
  python3 fetch_bls_jobs.py [--years N] [--force]

Options:
  --years N   Number of years of history to fetch (default: 20, max: 20).
              Automatically capped to 10 when no API key is present, since the
              unauthenticated BLS tier only serves ~10 years — existing history
              is preserved by the merge, so this is lossless.
  --force     Fetch even if the on-disk data was updated recently.
"""

import os
import sys
import json
import time
import random
import hashlib
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
        "scope": "miami",
    },
    "LAUMT123310000000005": {
        "label": "Total Employment Level",
        "unit": "persons",
        "description": "Total employed persons for the Miami–Fort Lauderdale–West Palm Beach, FL Metro Area",
        "scope": "miami",
    },
    "LNS14000000": {
        "label": "US Unemployment Rate",
        "unit": "%",
        "description": "National civilian unemployment rate, seasonally adjusted",
        "scope": "national",
    },
    "LNS12000000": {
        "label": "US Employment Level",
        "unit": "thousands of persons",
        "description": "National civilian employment level (thousands), seasonally adjusted",
        "scope": "national",
    },
}

METRO = {
    "name": "Miami–Fort Lauderdale–West Palm Beach, FL",
    "cbsa_code": "33100",
    "area_code": "12060",
    "state": "Florida",
}

# The unauthenticated BLS v2 tier only serves ~10 years of history and is far
# more likely to drop connections on large multi-year requests. Cap fetch depth
# to this when there's no key — the merge preserves any older history on disk.
UNAUTH_MAX_YEARS = 10

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
        "(limited to 25 series/day, ~10 years of data)."
    )
    return None


def fetch_series(series_ids, start_year, end_year, api_key, retries=4, backoff=2.0):
    """POST a single BLS request. Raises on definitive failure after retries."""
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
            log.info(f"Fetching BLS data (attempt {attempt}/{retries}): years={start_year}–{end_year}, series={series_ids}")
            resp = requests.post(BLS_API_URL, json=payload, headers=headers, timeout=45)
            resp.raise_for_status()
            data = resp.json()

            status = data.get("status", "UNKNOWN")
            if status != "REQUEST_SUCCEEDED":
                messages = data.get("message", [])
                log.error(f"BLS API returned status '{status}': {messages}")
                raise RuntimeError(f"BLS API error: {messages}")

            return data

        except (requests.RequestException, RuntimeError, ValueError) as exc:
            log.warning(f"Attempt {attempt} failed: {exc}")
            if attempt < retries:
                # Exponential backoff with jitter so simultaneous/transient
                # BLS disconnects don't all retry in lockstep.
                sleep_time = backoff ** attempt + random.uniform(0, 1.5)
                log.info(f"Retrying in {sleep_time:.1f}s …")
                time.sleep(sleep_time)
            else:
                raise


def fetch_chunk_resilient(series_ids, start_year, end_year, api_key):
    """Fetch a year-chunk for all series, degrading gracefully on failure.

    Tries one batched request first (cheapest). If that fails after retries,
    falls back to one request per series so a single bad series/payload can't
    sink the others. Returns {seriesID: [raw BLS records]}; series that could
    not be fetched are simply absent (their existing data is preserved by the
    caller's merge).
    """
    try:
        raw = fetch_series(series_ids, start_year, end_year, api_key)
        return {
            s.get("seriesID", ""): s.get("data", [])
            for s in raw.get("Results", {}).get("series", [])
        }
    except (requests.RequestException, RuntimeError, ValueError) as exc:
        log.warning(
            f"Batched fetch for {start_year}–{end_year} failed ({exc}); "
            "retrying series individually."
        )

    out = {}
    for sid in series_ids:
        try:
            raw = fetch_series([sid], start_year, end_year, api_key)
            for s in raw.get("Results", {}).get("series", []):
                out[s.get("seriesID", "")] = s.get("data", [])
            time.sleep(1)  # be polite between per-series retries
        except (requests.RequestException, RuntimeError, ValueError) as exc:
            log.error(
                f"Series {sid} could not be fetched for {start_year}–{end_year}: "
                f"{exc}. Keeping existing data for it."
            )
    return out


def parse_series_data(raw_records):
    """Turn raw BLS monthly records into clean, sorted period records."""
    records = []
    for item in raw_records:
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


def load_existing_series(path):
    """Return {seriesID: {period: record}} from an existing output file.

    Missing/corrupt file yields an empty dict — the run then behaves like a
    first-time fetch rather than crashing.
    """
    if not path.exists():
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            existing = json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        log.warning(f"Could not read existing data at {path}: {exc}")
        return {}

    out = {}
    for sid, series in existing.get("series", {}).items():
        by_period = {}
        for r in series.get("data", []):
            period = r.get("period")
            if period:
                by_period[period] = r
        out[sid] = by_period
    return out


def merge_records(existing_by_period, fetched_records):
    """Merge fetched records over existing ones, keyed by period.

    Fetched values win for overlapping periods (this captures BLS revisions to
    recent months); periods present only in the existing data are preserved.
    Returns a list sorted ascending by (year, month).
    """
    merged = dict(existing_by_period)  # period -> record
    for r in fetched_records:
        merged[r["period"]] = r
    records = list(merged.values())
    records.sort(key=lambda r: (r["year"], r["month"]))
    return records


def series_hash(series_block):
    """Stable hash over just the series data, so an unchanged refresh produces
    an identical hash regardless of the last_updated timestamp."""
    raw = json.dumps(series_block, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:12]


def build_output(fetched_by_sid, existing_by_sid):
    """Assemble the output document, merging fetched data over existing."""
    output = {
        "metadata": {
            "source": "U.S. Bureau of Labor Statistics (BLS)",
            "api_version": "v2",
            "metro_area": METRO,
            "national": {
                "name": "United States",
                "note": "National series are seasonally adjusted (CPS). Miami series are not seasonally adjusted (LAUS)."
            },
            "series_definitions": {
                sid: {
                    "label": info["label"],
                    "unit": info["unit"],
                    "description": info["description"],
                    "scope": info["scope"],
                }
                for sid, info in SERIES.items()
            },
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "fetch_status": "success",
        },
        "series": {},
    }

    for sid, info in SERIES.items():
        fetched = parse_series_data(fetched_by_sid.get(sid, []))
        existing = existing_by_sid.get(sid, {})
        records = merge_records(existing, fetched)

        # The merge can only add or update periods, never drop them — guard
        # anyway so a logic slip can never silently shrink history.
        if len(records) < len(existing):
            raise RuntimeError(
                f"Refusing to shrink {sid}: merged {len(records)} < existing {len(existing)}"
            )

        output["series"][sid] = {
            "label": info["label"],
            "unit": info["unit"],
            "scope": info["scope"],
            "data": records,
            "record_count": len(records),
            "latest": records[-1] if records else None,
        }
        latest = records[-1]["period"] if records else "no data"
        log.info(f"  {info['label']} ({sid}): {len(records)} records | latest {latest}")

    return output


def save_output(data, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    log.info(f"Data saved → {path.resolve()}")


def data_is_current(path, max_age_days=25):
    """Return True if existing data was fetched less than max_age_days ago."""
    if not path.exists():
        return False
    try:
        with open(path, encoding="utf-8") as f:
            existing = json.load(f)
        last = existing.get("metadata", {}).get("last_updated", "")
        if not last:
            return False
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(last)).days
        return age < max_age_days
    except (json.JSONDecodeError, ValueError, KeyError, OSError):
        return False


def existing_data_hash(path):
    """Return the recorded data_hash of the on-disk file, or None."""
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f).get("metadata", {}).get("data_hash")
    except (json.JSONDecodeError, OSError):
        return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Fetch BLS employment data for Miami metro + US national comparison."
    )
    parser.add_argument("--years", type=int, default=20, metavar="N",
                        help="Years of history to fetch (default: 20, max: 20).")
    parser.add_argument("--force", action="store_true",
                        help="Fetch even if existing data is recent.")
    args = parser.parse_args()

    # Skip fetch if data is already current (unless --force)
    if not args.force and data_is_current(OUTPUT_FILE):
        log.info("Existing data is recent (< 25 days old). Skipping fetch. Use --force to override.")
        return 0

    api_key = load_api_key()

    current_year = datetime.now().year
    years_back = max(1, min(args.years, 20))
    if not api_key and years_back > UNAUTH_MAX_YEARS:
        log.info(
            f"No API key: capping fetch to {UNAUTH_MAX_YEARS} years "
            "(older history on disk is preserved by the merge)."
        )
        years_back = UNAUTH_MAX_YEARS
    start_year = current_year - years_back
    end_year = current_year

    series_ids = list(SERIES.keys())
    existing_by_sid = load_existing_series(OUTPUT_FILE)
    have_existing = any(existing_by_sid.values())

    log.info("=" * 60)
    log.info("BLS Job Market Data Fetch — Miami Metro + US National")
    log.info(f"  Series          : {', '.join(series_ids)}")
    log.info(f"  Date Range      : {start_year} – {end_year}")
    log.info(f"  Existing on disk: {'yes' if have_existing else 'no'}")
    log.info(f"  Output File     : {OUTPUT_FILE.resolve()}")
    log.info("=" * 60)

    chunk_size = 20 if api_key else 10
    fetched_by_sid = {sid: [] for sid in series_ids}
    any_fetched = False

    chunk_start = start_year
    while chunk_start <= end_year:
        chunk_end = min(chunk_start + chunk_size - 1, end_year)
        got = fetch_chunk_resilient(series_ids, chunk_start, chunk_end, api_key)
        for sid, records in got.items():
            if sid in fetched_by_sid and records:
                fetched_by_sid[sid].extend(records)
                any_fetched = True
        chunk_start = chunk_end + 1
        if chunk_start <= end_year:
            time.sleep(1)  # be polite to BLS API

    # Never overwrite good data with nothing. If the whole fetch came back
    # empty, leave the existing file untouched and flag the outage to CI.
    if not any_fetched:
        if have_existing:
            log.error(
                "Fetch returned no data. Existing jobs_data.json left untouched "
                "(data preserved, but stale). Exiting non-zero to flag the outage."
            )
        else:
            log.error("Fetch returned no data and there is no existing file to preserve.")
        return 1

    output = build_output(fetched_by_sid, existing_by_sid)

    # Skip the write entirely when nothing actually changed — this keeps
    # last_updated stable and prevents empty "refresh" commits in CI.
    new_hash = series_hash(output["series"])
    output["metadata"]["data_hash"] = new_hash
    if new_hash == existing_data_hash(OUTPUT_FILE):
        log.info("Series data unchanged since last run — leaving jobs_data.json as-is.")
        return 0

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
    return 0


if __name__ == "__main__":
    sys.exit(main())
