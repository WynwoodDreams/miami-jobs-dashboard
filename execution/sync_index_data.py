#!/usr/bin/env python3
"""
Sync the inline dataset embedded in index.html with jobs_data.json.

index.html ships its data hard-coded in a single `const data = {...};`
statement so the page works without a runtime fetch. That copy must be
refreshed whenever jobs_data.json changes, otherwise the dashboard's
"Updated ... ago" badge (and every chart) goes stale.

Run this after execution/fetch_bls_jobs.py. Exits non-zero on failure so
CI can detect a broken re-injection.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
JOBS_DATA = ROOT / "jobs_data.json"
INDEX_HTML = ROOT / "index.html"

# Matches the inline declaration: leading indent, `const data = `, the JSON
# object literal, then `;` to end of line. Non-greedy up to the final `};`.
DATA_RE = re.compile(r"^(\s*const data = )\{.*\};\s*$", re.MULTILINE)


def main() -> int:
    if not JOBS_DATA.exists():
        print(f"ERROR: {JOBS_DATA} not found", file=sys.stderr)
        return 1
    if not INDEX_HTML.exists():
        print(f"ERROR: {INDEX_HTML} not found", file=sys.stderr)
        return 1

    data = json.loads(JOBS_DATA.read_text(encoding="utf-8"))
    html = INDEX_HTML.read_text(encoding="utf-8")

    if not DATA_RE.search(html):
        print("ERROR: could not find `const data = {...};` block in index.html",
              file=sys.stderr)
        return 1

    # Compact JSON on one line, matching the existing inline format.
    inline = json.dumps(data, separators=(", ", ": "))
    new_html, count = DATA_RE.subn(lambda m: f"{m.group(1)}{inline};", html, count=1)

    if count != 1:
        print(f"ERROR: expected exactly 1 data block, replaced {count}",
              file=sys.stderr)
        return 1

    if new_html == html:
        print("index.html data already in sync with jobs_data.json.")
        return 0

    INDEX_HTML.write_text(new_html, encoding="utf-8")
    last_updated = data.get("metadata", {}).get("last_updated", "unknown")
    print(f"index.html inline data synced (last_updated: {last_updated}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
