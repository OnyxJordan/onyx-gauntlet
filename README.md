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

Only masked handles and prizes ever reach the page. The page source is public,
so a real username embedded in it is a published username. `build.py` refuses to
write a page if an unmasked handle reaches the data array.

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

## 5. Read this before enabling the schedule

`"ThirdPartyBet"` is roughly 37 million rows across 38 GB, and **no index on it
leads with `createdAt`**. The nearest is `("userId", "createdAt" DESC)`, which
cannot serve a date range without a `userId` to lead on, so the standings query
scans the whole table.

This is measured. `EXPLAIN` puts the plan at a cost of about 3.46 million,
topped by `Parallel Seq Scan on "ThirdPartyBet"`.

It also lands on the **production primary**. Despite its name, the
`analytics-reader` resource is not a replica: `pg_is_in_recovery()` returns
false. It is the primary, reached as the `postgres-readonly` user.

One index fixes it:

```sql
CREATE INDEX CONCURRENTLY "ThirdPartyBet_createdAt_idx"
  ON "ThirdPartyBet" ("createdAt");
```

**This cannot be run from Retool.** Postgres requires table ownership to add an
index, `"ThirdPartyBet"` is owned by `svc_migrator`, and neither resource
qualifies: `analytics-reader` connects as `postgres-readonly`, and
`appDatabaseWrite` connects as `retool_user`, which is not a superuser and a
member of no roles. It needs an infra credential. `SETUP.md` stage 1 has the
request to send, the caveats to send with it, and how to confirm it landed.

Until it exists, publish by hand rather than hourly.

## 6. Files

| File | Purpose |
|---|---|
| `index.html` | The published page. This is the deliverable. |
| `template.html` | Same page with `__DATA__` and `__UPDATED__` placeholders. Derived from real dashboard output, so rendered pages match it structurally. |
| `build.py` | Fetch, rank, mask, render. Standard library only. |
| `standings.sql` | The ranking rule. One source of truth, shared with the Retool workflow via `--print-sql`. |
| `round.json` | The only file that changes between rounds. |
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
