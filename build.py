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

class Skip(Exception):
    """This source cannot be used; try the next one."""


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


def from_retool_db(cfg):
    """Read the parked standings straight out of retool_db over Postgres.

    The webhook does the same job, but every call to it is a Retool *workflow
    run*, and those are a metered allowance shared with every other workflow in
    the org. Reading the row directly is an ordinary database query and costs
    none of them. On 2026-11-21 the org hit 100% of 5,000 runs mid-round and
    the board stopped refreshing; this is what stops that recurring.

    Needs RETOOL_DB_URL, the connection string from Retool's Database tab.
    Raises Skip if it cannot be used, so the caller falls back to the webhook
    rather than failing the publish."""
    url = os.environ.get("RETOOL_DB_URL", "").strip()
    if not url:
        raise Skip("RETOOL_DB_URL is not set")
    try:
        import psycopg2
        import psycopg2.extras
    except ImportError:
        raise Skip("psycopg2 is not installed")

    # Retool Database requires TLS and will not negotiate without this.
    if "sslmode=" not in url:
        url += ("&" if "?" in url else "?") + "sslmode=require"
    try:
        conn = psycopg2.connect(url, connect_timeout=20)
    except Exception as exc:                       # noqa: BLE001 - any failure falls back
        raise Skip(f"could not connect: {str(exc).strip()[:160]}")
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SET statement_timeout = '30s'")
            cur.execute("SELECT payload, refreshed_at, round_start, round_end, row_count "
                        "FROM gauntlet_standings WHERE id = 1")
            row = cur.fetchone()
    except Exception as exc:                       # noqa: BLE001
        raise Skip(f"query failed: {str(exc).strip()[:160]}")
    finally:
        conn.close()

    if not row:
        raise Skip("gauntlet_standings has no row 1 yet")
    payload, refreshed_at, round_start, round_end, _count = row

    # Only this path can see the window the standings were actually computed
    # over, because the webhook does not return it. Checking it here catches
    # the mismatch that otherwise ships last round's numbers under this
    # round's dates and prize ladder.
    want = (cfg.get("start_date"), cfg.get("end_date"))
    got = (str(round_start), str(round_end))
    if all(got) and got != want:
        raise SystemExit(
            f"the parked standings cover {got[0]} to {got[1]}, but round.json says "
            f"{want[0]} to {want[1]}.\nThe dates live in two places: round.json here "
            f"and the standings block of the gauntlet-refresh workflow in Retool. "
            f"Change them together, then let the refresh run once.")

    cfg["_data_as_of"] = snapshot_id(refreshed_at.isoformat()
                                     if hasattr(refreshed_at, "isoformat") else refreshed_at)
    rows = payload if isinstance(payload, list) else unwrap(payload)
    if not rows:
        raise Skip("the parked payload is empty")
    print(f"read {len(rows)} rows straight from retool_db, no workflow run spent",
          file=sys.stderr)
    return usernames(rows)


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


# The Move column answers "where was this player a day ago".
#
# It used to answer "where was this player at the last refresh", and that was
# the wrong question. The board is ranked by stake, the leaders sit on stakes
# nobody overtakes in an hour, so the whole top of the page read flat update
# after update while only the deep ranks churned. Measured on 2026-11-14: of
# ranks 1 to 25, twenty had not moved at all, while ranks 200 to 400 were
# almost entirely in motion. An hour is simply too short a window at the top.
#
# A day is long enough that the leaders genuinely change places and short
# enough to still feel live.
MOVE_WINDOW_HOURS = 24

# How far apart stored snapshots need to be. Every refresh does not need
# keeping: anchors a few hours apart put the baseline within a few hours of a
# day old, which is close enough, and keeps this file small enough to rewrite
# on every publish without bloating the repository.
ANCHOR_SPACING_HOURS = 3

# Keep a little more than the window, so there is always an anchor old enough
# to serve it rather than falling back to the oldest thing on hand.
HISTORY_KEEP_HOURS = MOVE_WINDOW_HOURS + 6


def load_previous(path=PREV):
    """Movement state: a short history of standings snapshots, oldest first.

    Each entry is {"as_of": <snapshot id>, "order": [player keys in rank
    order]}, so a player's rank is their index plus one. Storing the order
    rather than a key-to-rank map halves the file.

    Two older formats are migrated rather than discarded, because dropping
    this file costs a publish that reads New against all thousand players."""
    blank = {"history": []}
    if not path.exists():
        return blank
    try:
        prev = json.loads(path.read_text())
    except json.JSONDecodeError:
        print(f"{path} is unreadable; treating every player as new", file=sys.stderr)
        return blank

    if isinstance(prev.get("history"), list):
        out = []
        for h in prev["history"]:
            if h.get("as_of") and isinstance(h.get("order"), list):
                out.append({"as_of": snapshot_id(h["as_of"]), "order": h["order"]})
        out.sort(key=lambda h: h["as_of"])
        return {"history": out}

    # Older formats kept rank maps: {"ranks": {...}} first, then
    # {"shown_ranks": ..., "baseline_ranks": ...}. Convert whatever is there
    # into ordered anchors, oldest first.
    hist = []
    for as_of_key, ranks_key in (("baseline_as_of", "baseline_ranks"),
                                 ("shown_as_of", "shown_ranks"),
                                 ("as_of", "ranks"),
                                 ("data_as_of", "ranks")):
        ranks, as_of = prev.get(ranks_key), prev.get(as_of_key)
        if isinstance(ranks, dict) and ranks and as_of:
            entry = {"as_of": snapshot_id(as_of), "order": ranks_to_order(ranks)}
            if entry["as_of"] not in [h["as_of"] for h in hist]:
                hist.append(entry)
    hist.sort(key=lambda h: h["as_of"])
    return {"history": hist}


def ranks_to_order(ranks):
    """A {key: rank} map back into rank order. Ranks are unique and start at
    one, so sorting by rank reconstructs the list exactly."""
    return [k for k, _ in sorted(ranks.items(), key=lambda kv: kv[1])]


def pick_baseline(history, now_id):
    """The anchor the Move column is measured from: the most recent one at
    least MOVE_WINDOW_HOURS older than the snapshot being published.

    Before there is a full day of history, fall back to the oldest anchor
    there is, so the column still says something true, just over a shorter
    window. It widens on its own as the round runs."""
    now = parse_snapshot(now_id)
    # Only ever measure against something that genuinely came earlier. Without
    # this, publishing a snapshot older than the stored anchors would compare
    # it against the future and report movement backwards.
    past = [h for h in history if parse_snapshot(h["as_of"]) < now]
    if not past:
        return None
    cutoff = now - datetime.timedelta(hours=MOVE_WINDOW_HOURS)
    older = [h for h in past if parse_snapshot(h["as_of"]) <= cutoff]
    return older[-1] if older else past[0]


def parse_snapshot(sid):
    """Snapshot ids are canonical UTC isoformat, so this round-trips. An
    unparseable one sorts as very old rather than crashing the build."""
    try:
        return datetime.datetime.fromisoformat(sid)
    except (ValueError, TypeError):
        return datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)


def movement(names, baseline):
    """Spots gained since the baseline snapshot, positive for a climb. None
    means the player was not in it, which the page shows as New rather than as
    an improvement from nowhere."""
    was = {}
    if baseline:
        was = {k: i + 1 for i, k in enumerate(baseline["order"])}
    return [None if (p := was.get(player_key(u))) is None else p - (i + 1)
            for i, u in enumerate(names)]


def save_previous(names, when, data_as_of, state, path=PREV):
    """Record this snapshot as an anchor, if the newest one is old enough to
    need company, then drop anchors past the retention window.

    Keys are a truncated sha256 of the username, so no real usernames reach
    this public repo."""
    history = list(state["history"])
    now = parse_snapshot(data_as_of)

    newest = parse_snapshot(history[-1]["as_of"]) if history else None
    if newest is None or now - newest >= datetime.timedelta(hours=ANCHOR_SPACING_HOURS):
        history.append({"as_of": data_as_of,
                        "order": [player_key(u) for u in names]})

    keep = now - datetime.timedelta(hours=HISTORY_KEEP_HOURS)
    # Always leave two anchors standing, so a gap in refreshes cannot prune
    # the history down to nothing and reset every arrow to New.
    while len(history) > 2 and parse_snapshot(history[0]["as_of"]) < keep:
        history.pop(0)

    path.write_text(json.dumps({
        "_comment": f"Movement state for the Move column, which reports "
                    f"movement over {MOVE_WINDOW_HOURS} hours. Each history "
                    f"entry is one standings snapshot, players in rank order, "
                    f"keyed by a truncated sha256 of the username. Delete this "
                    f"file to reset every arrow to New.",
        "written_at": when.isoformat(),
        "window_hours": MOVE_WINDOW_HOURS,
        "history": history,
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


def round_line(cfg):
    """The round window, for the hero and the terms. Reads from round.json, so
    the dates on the page cannot drift from the dates the query ran with.

    Collapses the month when both ends share it, "November 12 to 18, 2026",
    and the year when both ends share that."""
    try:
        a = datetime.date.fromisoformat(cfg["start_date"])
        b = datetime.date.fromisoformat(cfg["end_date"])
    except (KeyError, ValueError):
        raise SystemExit("round.json needs start_date and end_date as YYYY-MM-DD")
    if a == b:
        return f"{a.strftime('%B')} {a.day}, {a.year}"
    if (a.year, a.month) == (b.year, b.month):
        return f"{a.strftime('%B')} {a.day} to {b.day}, {b.year}"
    if a.year == b.year:
        return f"{a.strftime('%B')} {a.day} to {b.strftime('%B')} {b.day}, {b.year}"
    return (f"{a.strftime('%B')} {a.day}, {a.year} to "
            f"{b.strftime('%B')} {b.day}, {b.year}")


def drop_excluded(names, cfg):
    """Remove named individuals from the standings before ranking.

    Affiliates as a group are in the board: some of them promote the
    leaderboard, so excluding all of them was wrong. Individuals are taken out
    one at a time instead, which is what "excluded" in round.json is for.

    It holds digests, not usernames, because this repository is public and a
    username committed to it is a published username. Generate one with:

        python3 build.py --exclude-key "thehandle"

    Matching ignores case and surrounding spaces, so the handle does not have
    to be typed exactly as the player signed up."""
    keys = {k.strip().lower() for k in cfg.get("excluded", []) if isinstance(k, str)}
    if not keys:
        return names, 0
    kept = [u for u in names if search_key(u) not in keys]
    return kept, len(names) - len(kept)


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

    paid = sum(1 for p in table if p > 0)
    html = template.read_text()
    for placeholder, value in (("__UPDATED__", updated_line(when, cfg.get("final", False))),
                               ("__ROUND__", round_line(cfg)),
                               # Counted from the ladder rather than written out,
                               # so the terms cannot promise a different number of
                               # places or a different pool than the page pays.
                               ("__PLACES__", str(paid)),
                               ("__POOL__", f"{sum(table):,}"),
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
    ap.add_argument("--source", choices=("auto", "db", "retool", "json"), default="auto",
                    help="auto: the database if RETOOL_DB_URL is set, else the webhook")
    ap.add_argument("--json-file", type=Path, help="standings JSON, with --source json")
    ap.add_argument("--at", help="timestamp for the hero line, Eastern. Default: now.")
    ap.add_argument("--final", action="store_true",
                    help='say "Final Standings as of" (same as "final": true in round.json)')
    ap.add_argument("--print-sql", choices=("psycopg", "retool"), metavar="FLAVOR",
                    help="print the standings query for this round and exit")
    ap.add_argument("--exclude-key", metavar="USERNAME",
                    help="print the digest to add to \"excluded\" in round.json "
                         "to keep this player out of the standings, and exit")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args(argv)

    if args.exclude_key:
        print(search_key(args.exclude_key))
        print(f'Add that line to "excluded" in round.json. It is a one-way '
              f'digest, so the handle itself never reaches this public repo.',
              file=sys.stderr)
        return 0

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
    elif args.source == "retool":
        names = from_retool(cfg)
    else:
        # Prefer the database: it costs no Retool workflow run and it is the
        # only source that can check the round window. Anything that stops it
        # working falls through to the webhook rather than failing the
        # publish, because a page that updates and costs a run beats a page
        # that does not update. --source db refuses to fall back, for testing.
        try:
            names = from_retool_db(cfg)
        except Skip as why:
            if args.source == "db":
                raise SystemExit(f"--source db: {why}")
            print(f"database read skipped ({why}); falling back to the webhook",
                  file=sys.stderr)
            names = from_retool(cfg)

    print(f"{len(names)} rows from {args.source}", file=sys.stderr)
    names, dropped = drop_excluded(names, cfg)
    if dropped:
        # Named, not counted silently: an exclusion moves everyone below it up
        # a place and changes who is paid, so it belongs in the run log.
        print(f"excluded {dropped} named "
              f"{'player' if dropped == 1 else 'players'}", file=sys.stderr)
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
    already_stored = data_as_of in [h["as_of"] for h in state["history"]]

    # The baseline depends only on the snapshot being published and the stored
    # history, never on how many times this has run, so republishing the same
    # standings shows the same arrows rather than flattening them.
    baseline = pick_baseline(state["history"], data_as_of)
    deltas = movement(names, baseline)
    html, rows = render(names, cfg, when, deltas)
    args.out.write_text(html)

    # Only record once the page is written, so an aborted build cannot swallow
    # a round of movement.
    if args.out == OUT and not already_stored:
        save_previous(names, when, data_as_of, state)

    if baseline:
        age = parse_snapshot(data_as_of) - parse_snapshot(baseline["as_of"])
        hours = age.total_seconds() / 3600
        short = hours + 0.05 < MOVE_WINDOW_HOURS
        print(f"movement measured over {hours:.1f}h"
              + (f" (still filling the {MOVE_WINDOW_HOURS}h window)" if short else ""),
              file=sys.stderr)
    else:
        print("no history yet; every player reads New", file=sys.stderr)

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
