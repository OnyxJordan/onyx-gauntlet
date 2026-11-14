# Mini Games Gauntlet leaderboard

The public Gauntlet standings page, hosted on GitHub Pages.

Publishing is a git commit. Whatever `index.html` holds is what the world sees,
so there is no hosting API key, no upload step and no third party account in the
path. Every version of the page is in git history.

**Live at:** `https://onyxjordan.github.io/onyx-gauntlet/`
(enable under Settings → Pages → Source `main`, folder `/ (root)`)

**Setting this up, or finishing the automation? Start with [`SETUP.md`](./SETUP.md).**
It says where each step happens, since they land across four different places.

---

## 1. Where the numbers come from

The ranking rule lives in `standings.sql`, copied from the Minigames Live
Dashboard's `/backend/minigames/leaderboard.ts`. The public page and the
internal dashboard rank players by the same rule and cannot drift apart.

- Rank order is **handle descending**, rounds descending as the tiebreak.
- **SWEEP balances only.** Promotional and non-sweeps play does not count.
- **Internal users excluded**, meaning flagged internal or an `@onyxodds.com`
  email.
- **Affiliates excluded**, meaning any user whose id owns a `Promotion`. This is
  a deliberate difference from the dashboard, which includes them by default.
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
3. Set the range to **Custom**, matching `round.json`. Do not use the
   "Last 7 days" preset: it is backward looking and will drift as the round runs.
4. Click **Export HTML**.
5. Replace `index.html` in this repo with that file and commit. Dragging it onto
   the file in the GitHub web UI works fine.

Pages redeploys within a minute or so.

Use **Export CSV** for payouts. That one carries real usernames alongside
handle, paid and net, and is the current view rather than full rank order.

## 3. What changes per round

Everything round-specific is in `round.json`, and nothing else needs editing.

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

**The prize ladder exists in two places.** `round.json` here, and `PRIZE_TABLE`
in the dashboard's `frontend/utils/format.ts`. They currently agree. Change both
together or the two exports will disagree.

## 4. Automating it

`build.py` fetches standings and renders `index.html`; the workflow commits it.
That needs a Retool workflow exposing the query over a webhook:

1. Retool → **Workflows** → new workflow, trigger type **Webhook**.
2. Add a SQL query block named `standings` on the **analytics-reader** resource.
   Do not retype the query, generate it so it cannot drift from `standings.sql`:
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

GitHub "publish"            :04 :19 :34 :49, when GitHub feels like it
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

```js
// Resource query, type REST / HTTP, or a JS block using fetch.
// POST https://api.github.com/repos/OnyxJordan/onyx-gauntlet/actions/workflows/publish.yml/dispatches
// Headers: Authorization: Bearer {{ retoolContext.configVars.GITHUB_TOKEN }}
//          Accept: application/vnd.github+json
// Body:    { "ref": "main" }
```

The token is a GitHub fine-grained personal access token scoped to this one
repository with **Actions: read and write**, stored as a Retool config variable
or secret. Nothing else changes: the cron stays as a backstop, and a publish
started either way does the same work.

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

### The index, still worth having

`"ThirdPartyBet"` is 37 million rows across 38 GB with no index leading with
`createdAt`, so the query reads the whole table. That is why it takes minutes.

```sql
CREATE INDEX CONCURRENTLY "ThirdPartyBet_createdAt_idx"
  ON "ThirdPartyBet" ("createdAt");
```

It cannot be run from Retool: Postgres requires table ownership and
`"ThirdPartyBet"` is owned by `svc_migrator`, while `analytics-reader` connects
as `postgres-readonly` and `appDatabaseWrite` as `retool_user`. It needs an
infra credential.

Nothing is blocked on it any more. It would just mean each hourly refresh costs
a second instead of three minutes of reading the production primary, and the
two-workflow split could collapse back into one.

## 6. Files

| File | Purpose |
|---|---|
| `index.html` | The published page. This is the deliverable. |
| `template.html` | Same page with `__DATA__` and `__UPDATED__` placeholders. Derived from real dashboard output, so rendered pages match it structurally. |
| `build.py` | Fetch, rank, mask, render. Standard library only. |
| `standings.sql` | The ranking rule. One source of truth, shared with the Retool workflow via `--print-sql`. |
| `round.json` | The only file that changes between rounds. |
| `previous.json` | Last run's ranks, keyed by a truncated sha256 of the username so no real usernames are stored. Drives the Move column. Delete it to reset every arrow to New. |
| (no file) | `retool_db.gauntlet_standings` is the single-row table the Retool refresh writes to and the webhook reads from. Created 2026-11-13. |
| `.github/workflows/publish.yml` | Scheduled and manual publishing. Schedule off by default. |

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
