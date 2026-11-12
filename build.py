#!/usr/bin/env python3
"""
Onyx Odds, Mini Games Gauntlet leaderboard builder.

Renders template.html into index.html, which GitHub Pages serves. Publishing is
a git commit, not an upload, so there is no hosting API key anywhere in here.

The page this produces is structurally identical to the dashboard's own
"Export HTML" button (Minigames Live Dashboard, LeaderboardTable.tsx): the data
array holds masked handles and prizes only, never real usernames. That matters.
The page source is public, so a real username embedded here is a published
username.

Standings can come from:

  --source retool   POST to a Retool workflow webhook running standings.sql.
                    The automated path.
  --source json     A local JSON file shaped like that webhook's response, or a
                    CSV-to-JSON of the dashboard's "Export CSV". For replaying a
                    snapshot or publishing without credentials.

If you just want today's numbers up without any of this, you do not need the
script at all: use Export HTML on the dashboard and drop the file in as
index.html. See README section 2.

Fail-safe: zero usable rows exits nonzero before writing, so a bad fetch cannot
blank the live page.

Run:
  python3 build.py --source json --json-file standings.json
  python3 build.py --source retool
  python3 build.py --print-sql retool
"""

import argparse
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
TEMPLATE = ROOT / "template.html"
ROUND = ROOT / "round.json"
SQL = ROOT / "standings.sql"
OUT = ROOT / "index.html"

EASTERN = ZoneInfo("America/New_York")

# An affiliate is a user whose id owns a Promotion.
AFFILIATE_EXCLUDE = (
    '  AND NOT EXISTS (SELECT 1 FROM "Promotion" _aff '
    'WHERE _aff."ownerUserId" = tpb."userId")'
)
# A handle ending in a long digit run is usually a signup fallback id.
FALLBACK_ID = re.compile(r"\d{6,}$")


# --------------------------------------------------------------------------
# round config
# --------------------------------------------------------------------------

def load_round(path=ROUND):
    cfg = json.loads(path.read_text())
    cfg["prize_table"] = expand_prizes(cfg.get("prizes", {}))
    pool, total = cfg.get("pool"), sum(cfg["prize_table"])
    if pool is not None and total != pool:
        raise SystemExit(
            f"prize ladder sums to {total:,} but round.json declares pool {pool:,}. "
            "Fix one or the other before publishing."
        )
    return cfg


def expand_prizes(prizes):
    """{'1': 2500, '10-20': 100} -> [2500, 0, ..., 100] indexed by rank-1."""
    by_rank = {}
    for key, amount in prizes.items():
        if key.startswith("_"):
            continue
        lo, hi = (int(p) for p in key.split("-", 1)) if "-" in key else (int(key), int(key))
        if lo < 1 or hi < lo:
            raise SystemExit(f"bad prize range {key!r} in round.json")
        for r in range(lo, hi + 1):
            if r in by_rank:
                raise SystemExit(f"rank {r} gets a prize twice in round.json")
            by_rank[r] = amount
    return [by_rank.get(r, 0) for r in range(1, max(by_rank) + 1)] if by_rank else []


# --------------------------------------------------------------------------
# the ranking query
# --------------------------------------------------------------------------

def standings_sql(cfg, flavor="psycopg", sql_path=SQL):
    """Fill standings.sql's markers and rewrite its :named parameters for the
    client that will run it. 'psycopg' also doubles every literal percent sign,
    which psycopg would otherwise read as a placeholder: the internal-user
    filter contains a real one, in LIKE '%@onyxodds.com'."""
    sql = sql_path.read_text()
    affiliate = AFFILIATE_EXCLUDE if cfg.get("exclude_affiliates", True) else ""
    # int() is the guard: cap reaches the query as a literal, not a bind param.
    sql = (sql.replace("  /*AFFILIATE_FILTER*/", affiliate)
              .replace("/*ROW_LIMIT*/", f"LIMIT {int(cfg.get('cap', 1000))}"))
    if flavor == "psycopg":
        return (sql.replace("%", "%%")
                   .replace(":start_date", "%(start_date)s")
                   .replace(":end_date", "%(end_date)s"))
    if flavor == "retool":
        return (sql.replace(":start_date", "{{ startTrigger.data.startDate }}")
                   .replace(":end_date", "{{ startTrigger.data.endDate }}"))
    raise SystemExit(f"unknown SQL flavor {flavor!r}")


# --------------------------------------------------------------------------
# standings sources
# --------------------------------------------------------------------------

def unwrap(payload):
    """Accept {'standings': [...]}, {'data': [...]} or a bare array."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("standings", "data", "rows", "result"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


def usernames(rows):
    """Pull the username out of standings rows, preserving the query's order."""
    out = []
    for row in rows:
        if isinstance(row, str):
            out.append(row.strip())
            continue
        if not isinstance(row, dict):
            continue
        for key in ("username", "player", "name", "user_id"):
            val = row.get(key)
            if isinstance(val, str) and val.strip():
                out.append(val.strip())
                break
    return out


def from_retool(cfg, timeout=180):
    url = os.environ.get("RETOOL_WEBHOOK_URL", "").strip()
    key = os.environ.get("RETOOL_WORKFLOW_KEY", "").strip()
    if not url:
        raise SystemExit("RETOOL_WEBHOOK_URL is not set. See README section 4.")
    body = json.dumps({
        "startDate": cfg.get("start_date", ""),
        "endDate": cfg.get("end_date", ""),
    }).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    # Retool sits behind Cloudflare, which rejects urllib's default
    # "Python-urllib/3.x" agent with 403 "error code: 1010" before the request
    # ever reaches Retool. Any ordinary agent string gets through.
    req.add_header("User-Agent",
                   "onyx-gauntlet/1.0 (+https://github.com/OnyxJordan/onyx-gauntlet)")
    if key:
        req.add_header("X-Workflow-Api-Key", key)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return usernames(unwrap(json.loads(resp.read().decode())))
    except urllib.error.HTTPError as exc:
        detail = exc.read()[:400].decode(errors="replace")
        if "1010" in detail:
            detail += ("\nThat is Cloudflare blocking the client, not Retool refusing "
                       "the key. Check the User-Agent header above still looks ordinary.")
        raise SystemExit(f"Retool webhook returned HTTP {exc.code}: {detail}")
    except urllib.error.URLError as exc:
        raise SystemExit(f"Retool webhook unreachable: {exc.reason}")


# --------------------------------------------------------------------------
# render
# --------------------------------------------------------------------------

def mask(u):
    """first char + stars + last two. Mirrors maskUsername() in the dashboard's
    frontend/utils/format.ts. Change both together or the two will disagree."""
    if not u:
        return ""
    if len(u) <= 2:
        return u
    return u[0] + "*" * max(1, len(u) - 3) + u[-2:]


def updated_line(when, final=False):
    lead = "Final Standings as of" if final else "Updated as of"
    clock = f"{when.hour % 12 or 12}:{when.minute:02d} {'AM' if when.hour < 12 else 'PM'}"
    return f"{lead} {clock} ET · {when.strftime('%B')} {when.day}, {when.year}"


def report(names):
    """Advisory only. Masking hides most of what used to need cleaning, so this
    flags what masking does not fix rather than rewriting anything."""
    seen, dupes, fallbacks, spaced = {}, [], [], []
    for i, u in enumerate(names, start=1):
        if re.search(r"\s", u):
            spaced.append((i, u))
        if FALLBACK_ID.search(u):
            fallbacks.append((i, u))
        first = seen.get(u.lower())
        if first:
            dupes.append((i, u, first))
        else:
            seen[u.lower()] = i
    for label, hits in (("duplicate handles", dupes),
                        ("handles containing spaces", spaced),
                        ("likely signup fallback ids", fallbacks)):
        if hits:
            print(f"  {label}: {len(hits)}", file=sys.stderr)
            for hit in hits[:5]:
                print(f"    rank {hit[0]}: {hit[1]}", file=sys.stderr)


def render(names, cfg, when, template=TEMPLATE):
    table = cfg["prize_table"]
    rows = [
        {"r": i + 1, "u": mask(u), "p": table[i] if i < len(table) else 0}
        for i, u in enumerate(names[: int(cfg.get("cap", 1000))])
    ]
    # Escape < exactly as the dashboard's buildHtml does, so no handle can close
    # the script tag.
    data = json.dumps(rows, separators=(",", ":")).replace("<", "\\u003c")

    html = template.read_text()
    for placeholder, value in (("__UPDATED__", updated_line(when, cfg.get("final", False))),
                               ("__DATA__", data)):
        if placeholder not in html:
            raise SystemExit(f"template is missing {placeholder}")
        html = html.replace(placeholder, value)

    if re.search(r"var ALL=.*?[\"']u[\"']:\s*[\"'][^\"'*]{3,}[\"']", html):
        raise SystemExit("refusing to write: an unmasked handle reached the page data")
    return html, rows


# --------------------------------------------------------------------------

def parse_when(text):
    if not text:
        return datetime.datetime.now(EASTERN)
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d %I:%M %p", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(text, fmt).replace(tzinfo=EASTERN)
        except ValueError:
            continue
    raise SystemExit(f"could not read --at {text!r}; use 'YYYY-MM-DD HH:MM' (Eastern)")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build the Gauntlet leaderboard page.")
    ap.add_argument("--source", choices=("retool", "json"), default="retool")
    ap.add_argument("--json-file", type=Path, help="standings JSON, with --source json")
    ap.add_argument("--at", help="timestamp for the hero line, Eastern. Default: now.")
    ap.add_argument("--final", action="store_true",
                    help='say "Final Standings as of" (same as "final": true in round.json)')
    ap.add_argument("--print-sql", choices=("psycopg", "retool"), metavar="FLAVOR",
                    help="print the standings query for this round and exit")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args(argv)

    cfg = load_round()
    if args.print_sql:
        print(standings_sql(cfg, args.print_sql))
        return 0
    if args.final:
        cfg["final"] = True

    if args.source == "json":
        if not args.json_file:
            raise SystemExit("--source json needs --json-file")
        names = usernames(unwrap(json.loads(args.json_file.read_text())))
    else:
        names = from_retool(cfg)

    print(f"{len(names)} rows from {args.source}", file=sys.stderr)
    report(names)
    if not names:
        raise SystemExit("no usable standings; aborting before write so the live page stands.")

    html, rows = render(names, cfg, parse_when(args.at))
    args.out.write_text(html)
    paid = sum(1 for r in rows if r["p"] > 0)
    print(f"Wrote {args.out}: {len(rows)} players, {paid} paid places, "
          f"{sum(r['p'] for r in rows):,} awarded", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
