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
import hashlib
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
PREV = ROOT / "previous.json"
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

def capture_as_of(cfg, payload):
    """The standings are produced on Retool's own schedule and parked in
    retool_db, so by the time we read them they are already minutes or hours
    old. Record when they were gathered, so the page can be stamped with that
    rather than with now: otherwise a frozen snapshot publishes as current."""
    if isinstance(payload, dict) and payload.get("refreshed_at"):
        cfg["_data_as_of"] = snapshot_id(payload["refreshed_at"])


def snapshot_id(raw):
    """Identify a snapshot by the instant it was taken, not by how that instant
    happened to be spelled.

    This is what decides whether a run is a republish of standings already on
    the page, and so whether the movement arrows hold or are recomputed. It has
    to be stable. Retool returns '...T17:07:49.651Z' today, but '+00:00',
    different fractional digits or a non-UTC offset all name the same moment,
    and comparing the text would read any of those as new data, recompute every
    delta against the snapshot's own ranks, and flatten the arrows to zero.
    That was a real bug; this is what stops it coming back by accident.

    Anything unparseable falls back to the raw text, which is no worse than
    what it replaced."""
    text = str(raw)
    try:
        dt = datetime.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc).isoformat()


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


def from_retool(cfg, timeout=600):
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
            raw = resp.read().decode()
    except urllib.error.HTTPError as exc:
        detail = exc.read()[:400].decode(errors="replace")
        if "1010" in detail:
            detail += ("\nThat is Cloudflare blocking the client, not Retool refusing "
                       "the key. Check the User-Agent header above still looks ordinary.")
        raise SystemExit(f"Retool webhook returned HTTP {exc.code}: {detail}")
    except urllib.error.URLError as exc:
        raise SystemExit(f"Retool webhook unreachable: {exc.reason}")

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        raise SystemExit(f"Retool webhook did not return JSON. First 300 chars:\n{raw[:300]}")

    capture_as_of(cfg, payload)
    rows = unwrap(payload)
    if not rows:
        # A webhook workflow with no Response block answers instantly with a run
        # id and executes in the background, so the caller gets no standings.
        hint = ""
        if isinstance(payload, dict) and any(
                k in payload for k in ("workflowRunId", "runId", "workflow_run_id")):
            hint = ("\nThat is a run id, not standings. The workflow has no Response "
                    "block, so it answered immediately and ran in the background. "
                    "Add a Response block returning code1's data, then publish.")
        raise SystemExit("Retool webhook returned no standings rows. "
                         f"It returned:\n{json.dumps(payload)[:300]}{hint}")
    return usernames(rows)


# --------------------------------------------------------------------------
# render
# --------------------------------------------------------------------------

def player_key(u):
    """Stable, non-reversible id for one player, so previous ranks can be
    carried between runs without committing real usernames to a public repo.
    Masked names are not usable as a key: they collide, and two players who
    both mask to the same string would swap movement arrows."""
    return hashlib.sha256(u.encode("utf-8")).hexdigest()[:16]


# Shared with the page, which hashes what someone types and compares. Changing
# it on one side only breaks search silently, so both sides must move together.
SEARCH_SALT = "onyx-gauntlet:"


def search_key(u):
    """Lets a player type their real username into the page and find their own
    row, without the page ever containing a real username.

    The page cannot match what it does not hold, and it holds only masked
    handles, so searching for "jordan" against "j****an" finds nothing. Instead
    every row carries this digest, the page hashes whatever is typed the same
    way, and compares. Nothing reversible ships.

    Normalised to lowercase and trimmed, because people do not retype their own
    handle with the capitalisation they signed up with.

    Worth being clear about the tradeoff: a digest is not a secret. Someone
    holding a list of usernames could hash it and learn which of those names
    appear on the board. They could already narrow that down from the masked
    handle, which gives the first letter, the last two and the length, so this
    makes confirming a guess exact rather than likely. The full list still
    cannot be read off the page. If that trade is not wanted, drop "k" from the
    rows below and the search falls back to masked handles only."""
    return hashlib.sha256(
        (SEARCH_SALT + u.strip().lower()).encode("utf-8")
    ).hexdigest()[:12]


def load_previous(path=PREV):
    """Movement state. Two snapshots are kept, not one:

      shown_*     the standings snapshot the live page is built from
      baseline_*  the snapshot before it, which shown_* is compared against

    The publish job runs every 15 minutes while Retool refreshes hourly, so the
    same snapshot gets published several times over. Comparing it against
    itself would show arrows once and flatten them for the next three runs, so
    a republish keeps using the same baseline and the arrows hold."""
    blank = {"shown_as_of": None, "shown_ranks": {}, "baseline_ranks": {}}
    if not path.exists():
        return blank
    try:
        prev = json.loads(path.read_text())
    except json.JSONDecodeError:
        print(f"{path} is unreadable; treating every player as new", file=sys.stderr)
        return blank
    if "shown_ranks" not in prev and isinstance(prev.get("ranks"), dict):
        # The first version of this file kept one snapshot under "ranks".
        # Carry it forward as the shown snapshot rather than discarding it,
        # which would cost a publish showing New against everybody.
        carried = prev.get("data_as_of") or prev.get("as_of")
        return {
            "shown_as_of": snapshot_id(carried) if carried else None,
            "shown_ranks": prev["ranks"],
            # No older snapshot exists to hold arrows against. Reuse the same
            # ranks, so a republish before the next refresh reads as nothing
            # moved, which is true, rather than as everybody being new.
            "baseline_ranks": prev["ranks"],
        }
    stored = prev.get("shown_as_of")
    return {
        # Normalised on the way in as well as out, so a file written before
        # snapshot_id existed starts comparing correctly on the next run
        # rather than costing one flattened set of arrows.
        "shown_as_of": snapshot_id(stored) if stored else None,
        "shown_ranks": prev.get("shown_ranks") or {},
        "baseline_ranks": prev.get("baseline_ranks") or {},
    }


def movement(names, previous):
    """Spots gained since the previous run, positive for a climb. None means
    the player was not in the previous standings, which the page shows as New
    rather than as an improvement from nowhere."""
    out = []
    for i, u in enumerate(names):
        was = previous.get(player_key(u))
        out.append(None if was is None else was - (i + 1))
    return out


def save_previous(names, when, data_as_of, state, path=PREV):
    """Promote: what was shown becomes the baseline, this snapshot becomes
    what is shown. Ranks are keyed by a truncated sha256 of the username, so
    no real usernames reach this public repo."""
    path.write_text(json.dumps({
        "_comment": "Movement state for the Move column. shown_* is the "
                    "snapshot the page is built from; baseline_* is the one it "
                    "is compared against. Keys are a truncated sha256 of the "
                    "username. Delete this file to reset every arrow to New.",
        "written_at": when.isoformat(),
        "shown_as_of": data_as_of,
        "shown_ranks": {player_key(u): i + 1 for i, u in enumerate(names)},
        "baseline_as_of": state.get("shown_as_of"),
        "baseline_ranks": state.get("shown_ranks") or {},
    }, indent=0, sort_keys=True) + "\n")


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


def render(names, cfg, when, deltas=None, template=TEMPLATE):
    table = cfg["prize_table"]
    shown = names[: int(cfg.get("cap", 1000))]
    deltas = deltas or [None] * len(shown)
    rows = [
        {"r": i + 1, "u": mask(u), "p": table[i] if i < len(table) else 0,
         "d": deltas[i] if i < len(deltas) else None, "k": search_key(u)}
        for i, u in enumerate(shown)
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

def parse_iso_eastern(text):
    """Read an ISO timestamp from the stored snapshot and express it Eastern."""
    t = str(text).strip().replace("Z", "+00:00")
    dt = datetime.datetime.fromisoformat(t)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(EASTERN)


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
        payload = json.loads(args.json_file.read_text())
        capture_as_of(cfg, payload)
        names = usernames(unwrap(payload))
    else:
        names = from_retool(cfg)

    print(f"{len(names)} rows from {args.source}", file=sys.stderr)
    report(names)
    if not names:
        raise SystemExit("no usable standings; aborting before write so the live page stands.")

    # Explicit --at wins; otherwise use when the data was gathered; otherwise now.
    if args.at:
        when = parse_when(args.at)
    elif cfg.get("_data_as_of"):
        when = parse_iso_eastern(cfg["_data_as_of"])
        age = datetime.datetime.now(EASTERN) - when
        print(f"standings gathered {when:%Y-%m-%d %H:%M %Z}, "
              f"{int(age.total_seconds() // 60)} minutes old", file=sys.stderr)
        if age > datetime.timedelta(hours=12):
            raise SystemExit(
                f"the parked standings are {age} old, which means the Retool "
                "schedule has stopped refreshing them. Refusing to publish a "
                "stale snapshot as though it were current."
            )
    else:
        when = parse_when(None)

    state = load_previous()
    data_as_of = cfg.get("_data_as_of") or when.isoformat()
    republish = state["shown_as_of"] is not None and data_as_of == state["shown_as_of"]
    # A republish of the same snapshot is compared against the same baseline it
    # used the first time, so the arrows it shows do not change.
    against = state["baseline_ranks"] if republish else state["shown_ranks"]

    deltas = movement(names, against)
    html, rows = render(names, cfg, when, deltas)
    args.out.write_text(html)

    # Only record once the page is written, so an aborted build cannot swallow
    # a round of movement.
    if args.out != OUT:
        pass
    elif republish:
        print(f"republish of the {data_as_of} snapshot; baseline held", file=sys.stderr)
    else:
        save_previous(names, when, data_as_of, state)

    moved = [d for d in deltas if d]
    print(f"movement: {sum(1 for d in deltas if d is None)} new, "
          f"{sum(1 for d in moved if d > 0)} up, {sum(1 for d in moved if d < 0)} down, "
          f"{sum(1 for d in deltas if d == 0)} unchanged", file=sys.stderr)
    paid = sum(1 for r in rows if r["p"] > 0)
    print(f"Wrote {args.out}: {len(rows)} players, {paid} paid places, "
          f"{sum(r['p'] for r in rows):,} awarded", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
