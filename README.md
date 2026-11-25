# Onyx leaderboards

The public standings pages, hosted on GitHub Pages. Three pages, built from one
script:

| URL | Board | Window | Prizes |
|---|---|---|---|
| `/` | homepage | | |
| `/gauntlet/` | Mini Games Gauntlet | Nov 20 to 27 | 20,000 across 50 |
| `/rumble/` | Rips Rumble | Nov 26 to 27 | 10,000 across 20 |

Publishing is a git commit. Whatever is committed is what the world sees, so
there is no hosting API key, no upload step and no third party account in the
path. Every version of every page is in git history.

**Live at:** `https://onyxjordan.github.io/onyx-gauntlet/`
(enable under Settings → Pages → Source `main`, folder `/ (root)`)

A board is a file. `boards/<slug>.json` holds its dates, prize ladder, copy and
which parked snapshot it reads; `sql/<slug>.sql` holds its ranking rule. One run
of `build.py` publishes them all and costs **one** Retool workflow run no matter
how many boards there are.

**Setting this up, or finishing the automation? Start with [`SETUP.md`](./SETUP.md).**
It says where each step happens, since they land across four different places.

---

## 1. Where the numbers come from

Each board's ranking rule lives in its own `sql/<slug>.sql`.

`sql/gauntlet.sql` is copied from the Minigames Live Dashboard's
`/backend/minigames/leaderboard.ts`, so the public page and the internal
dashboard rank players by the same rule and cannot drift apart. The rest of
this section describes it.

`sql/rumble.sql` is the Rips board and ranks by **total spent opening packs**,
which is the sum of `DEBIT` rows in `"RipsWalletTransaction"`. Unlike the
Gauntlet it counts every purchase rather than sweeps only, and its tiebreak is
packs opened. Internal users are excluded the same way; affiliates are in.

- Rank order is **handle descending**, rounds descending as the tiebreak.
- **SWEEP balances only.** Promotional and non-sweeps play does not count.
- **Internal users excluded**, meaning flagged internal or an `@onyxodds.com`
  email.
- **Affiliates are included.** They were excluded as a group until 2026-11-14;
  some of them promote the leaderboard, so the group filter was wrong. Named
  individuals are taken out one at a time through `excluded` in the board file.
- Dates are inclusive and Eastern.

The page follows the Onyx design system from the Onyx Sports Data site: black
onyx surfaces, purple 400 accents, extended uppercase Archivo display type,
Geist Mono labels, Doto raster numerals, bracket buttons. Movement arrows use
that site's pos/neg/mut convention (#61e970 up, #ff7a90 down, #9a93a6 flat).

Only masked handles and prizes ever reach the page. The page source is public,
so a real username embedded in it is a published username. `build.py` refuses to
write a page if an unmasked handle reaches the data array.

Players can still find themselves: type a whole username into the search box and
it jumps to that row, even though the row is shown as `j******kt` and the page
holds no usernames. Each row carries a salted hash of the handle and the page
hashes what you type to compare. Partial text still searches masked handles as
before. The tradeoff this makes is written down in `CLAUDE.md` section 3.

## 2. Publishing by hand, which needs no setup at all

The dashboard already builds this exact page. Use it:

1. Open the **Minigames Live Dashboard** → **Leaderboard** tab.
2. Set **Affiliates** to **Exclude**. It defaults to All, and forgetting is the
   easiest way to publish a wrong leaderboard.
3. Set the range to **Custom**, matching the board file. Do not use the
   "Last 7 days" preset: it is backward looking and will drift as the round runs.
4. Click **Export HTML**.
5. Replace `index.html` in this repo with that file and commit. Dragging it onto
   the file in the GitHub web UI works fine.

Pages redeploys within a minute or so.

Use **Export CSV** for payouts. That one carries real usernames alongside
handle, paid and net, and is the current view rather than full rank order.

## 3. What changes per round

Everything round-specific is in `boards/<slug>.json`, and nothing else needs editing.

```json
{
  "start_date": "2026-11-12",
  "end_date":   "2026-11-18",
  "cap": 1000,
  "pool": 10000,
  "prizes": { "1": 2500, "...": 0, "10-20": 100 },
  "exclude_affiliates": true,
  "final": false
}
```

- `prizes` keys are a rank (`"7"`) or an inclusive range (`"10-20"`). Any ladder
  works, including the 25,000 across 100 places structure from an older round.
- `pool` is a checksum. If the ladder does not sum to it the build aborts, which
  catches the typo that would otherwise pay out the wrong total.
- `final` switches the hero line to "Final Standings as of". Set it for the
  closing update so a finished round stops claiming to be live.
- The dates must match the Custom range on the dashboard. A wrong window
  produces a leaderboard that looks completely plausible and is wrong.

**The prize ladder exists in two places.** the board file here, and `PRIZE_TABLE`
in the dashboard's `frontend/utils/format.ts`. They currently agree. Change both
together or the two exports will disagree.

## 4. Automating it

`build.py` fetches standings and renders `index.html`; the workflow commits it.
That needs a Retool workflow exposing the query over a webhook:

1. Retool → **Workflows** → new workflow, trigger type **Webhook**.
2. Add a SQL query block named `standings` on the **analytics-reader** resource.
   Do not retype the query, generate it so it cannot drift from `sql/<slug>.sql`:
   ```bash
   python3 build.py --print-sql retool
   ```
   That prints it with this round's cap as the `LIMIT`, the affiliate rule
   applied, and Retool's `{{ startTrigger.data.startDate }}` bindings in place.
3. Return block: `return { standings: formatDataAsArray(standings.data) }`
4. Set the block timeout to 120 seconds or more, for the reason in section 5.
5. Deploy, then put the webhook URL and workflow API key into this repo's
   Settings → Secrets and variables → Actions as `RETOOL_WEBHOOK_URL` and
   `RETOOL_WORKFLOW_KEY`.

Then Actions → **publish** → Run workflow, with **dry_run** ticked. It renders
and shows the diff without committing, and attaches the page as an artifact.
When that looks right, run it again without dry_run.

The schedule in `.github/workflows/publish.yml` is commented out on purpose.
Uncomment it only after section 5.

## 5. How the refresh actually works

Two scheduled jobs, not one, and the split is the whole trick.

```
Retool "gauntlet-refresh"   hourly, no time limit
  standings  analytics-reader, the slow query (2 to 3 minutes)
  query1     writes the result into retool_db.gauntlet_standings

GitHub "publish"            on a Retool dispatch, plus a 4x daily backstop
  calls Retool "gauntlet-standings" webhook
  that webhook only reads the parked copy out of retool_db  (~200ms)
  build.py renders index.html, commits, deploys to Pages
```

**The Retool half is reliable. The GitHub half is not.** Checked 2026-11-14:
the Retool refresh had been firing hourly between :07 and :14 all round, while
GitHub, asked for a run every 15 minutes, fired the schedule 3 times in 19
hours. Dropped slots, not late ones. So the standings were being recalculated
on time and simply not published, and the page would sit on a snapshot five or
six hours old while a fresh one waited in `retool_db`.

Asking more often does not help; that was already the mitigation that failed.
The minutes are now off the congested :00 and :30 marks, which is the only
lever the cron itself offers.

**The real fix is to stop relying on GitHub's clock.** Retool's schedule does
fire on time, so let it start the publish the moment it has new data. Add a
final block to `gauntlet-refresh`, after the one that writes the snapshot:

It is a **resource query**, not a Code block. Retool Workflows' JavaScript
runtime has no `fetch`, so a Code block fails with
`ReferenceError: fetch is not defined`. HTTP goes through a REST resource.

```
Resource  GitHub publish (onyx-gauntlet)     base URL https://api.github.com
POST      /repos/OnyxJordan/onyx-gauntlet/actions/workflows/publish.yml/dispatches
Body      dropdown JSON, one row: key "ref", value "main"
```

The resource holds an `Authorization: Bearer <token>` header, where the token is
a GitHub fine-grained personal access token scoped to this one repository with
**Actions: read and write**. Success is a **204** with an empty body.

Nothing else changes: the cron stays as a backstop, and a publish started either
way does the same work. Step by step in
[`retool/github-dispatch.md`](./retool/github-dispatch.md) and SETUP.md stage 5.

**Why it is built this way.** Retool caps a *synchronous* webhook response at
120 seconds. That is a platform limit, not a setting: raising a block timeout
does nothing when an HTTP caller is waiting. The standings query passed 120
seconds on 2026-11-13, one day into the round, and every scheduled publish
started failing.

A *scheduled* Retool workflow has no such cap. So the slow query moved there,
and the webhook now serves a pre-computed answer. The query can take as long as
it likes and nothing is waiting on it.

**The page is stamped with the snapshot's `refreshed_at`, not with now.** The
standings can be up to an hour old by the time they are published, and a page
that said "Updated as of" the publish time would be claiming a freshness it
does not have. If the snapshot is ever more than 12 hours old, `build.py`
aborts rather than publishing, so a Retool schedule that silently stopped
leaves a visibly stale page instead of a fresh-looking wrong one.

### The index, and why the query has a wart in it

`"ThirdPartyBet"` is 46 million rows across 50 GB with no index leading with
`createdAt`. That has been true since the start and was only ever a cost. On
2026-11-21 it became an outage.

The table's statistics are refreshed by autoanalyse, not on a schedule, and it
takes about two million writes a day. A round that starts after the last
analyse therefore sits **past the end of the planner's histogram**, and
Postgres estimates almost nothing for it. On the day it broke it estimated
**1 row** for a window holding **399,555**, picked
`ThirdPartyBet_userId_createdAt_idx` and nested loops on the strength of that
estimate, and ran past the 600 second block timeout. The refresh had been
failing every hour since 04:03 and the board froze at 3:15am.

`sql/gauntlet.sql` now adds `+ interval '0 second'` to both sides of the date
filter. It changes no value; it makes the predicate non-sargable so that index
cannot be used, the planner falls back to a default selectivity, and it picks
a parallel scan again:

```
before   Nested Loop,  rows=1       (actual 399,555)   killed at 600s
after    Gather Merge, rows=30,115, 2 workers          the plan that ran all last round
```

That is a workaround for a missing index, and it is commented as such in the
query. The actual fix is still:

```sql
CREATE INDEX CONCURRENTLY "ThirdPartyBet_createdAt_idx"
  ON "ThirdPartyBet" ("createdAt");
```

`CONCURRENTLY` means no write downtime. It cannot be run from Retool: Postgres
requires table ownership, `"ThirdPartyBet"` is owned by `svc_migrator`, and
`analytics-reader` connects as `postgres-readonly` while `appDatabaseWrite` is
`retool_user`. It needs whoever holds an infra credential. With it the query
reads a week of rows instead of scanning fifty gigabytes, the refresh costs a
second rather than minutes, and the `interval '0 second'` wart should be
deleted the same day.

## 6. Files

| File | Purpose |
|---|---|
| `index.html` | The published homepage. Generated; do not hand edit. |
| `<slug>/index.html` | A published board page. Generated; do not hand edit. |
| `home.html` | Homepage template. |
| `template.html` | Board-page template. Derived from real dashboard output, so rendered pages match it structurally. |
| `site.css` | What all three pages share: tokens, header, page tabs, hero, stat strip, footer. Change the theme here, once. |
| `onyx.js` | The raster art engine. |
| `build.py` | Fetch, rank, mask, render every board plus the homepage. Standard library only. |
| `boards/<slug>.json` | One board: dates, prize ladder, copy, snapshot row. The only file that changes between rounds. |
| `sql/<slug>.sql` | That board's ranking rule, shared with Retool via `--print-sql`. |
| `state/<slug>.json` | That board's last ranks, keyed by a truncated sha256 of the username so no real usernames are stored. Drives the Move column. Delete it to reset every arrow to New. |
| (no file) | `retool_db.gauntlet_standings` is the table the Retool refresh writes to and the webhook reads from. One row per board: 1 Gauntlet, 2 Rumble. |
| `.github/workflows/publish.yml` | The only workflow. Builds every board and commits; GitHub's own Pages builder deploys the push. |
| `retool/rips-rumble.md` | The Retool edits the Rumble needs before it can publish. |

## 7. Copy rules for anything written around this

These apply to push and email copy for Onyx promos generally. The page itself
already complies, since prize chips print `2,500` with no currency symbol.

- Never use `$`. Spell amounts out: "25,000 Bonus Onyx Cash".
- Never use "cash" on its own. The branded term is **"Bonus Onyx Cash"**.
- Footer: "No purchase necessary. 18+. Terms apply."

## 8. History

- Previously hosted on tiiny.host at `onyxgamesgauntlet.tiiny.site`. That site
  started returning 404 and its management UI errored, so the page moved here.
  Hosting is now a git push, which removes the dependency entirely.
- The page seeded into this repo is the September 15 2026 standings, recovered
  from the live site before it went down, relabelled as final.
- Originally the "Onyx Blackjack Leaderboard", later rebranded "Mini Games
  Gauntlet". Prize pools have varied by round: 25,000 across 100 places, and the
  current 10,000 across 20.
