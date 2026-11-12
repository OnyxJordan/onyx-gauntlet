# Setup

Everything needed to go from "page is published by hand" to "page updates
itself". Each step says **where** you are when you do it, because the steps
land in four different places.

The four places:

| Where | What lives there |
|---|---|
| **This repo** (github.com/OnyxJordan/onyx-gauntlet) | the page, the build script, the workflow, repo secrets |
| **Retool** (retoolonyx.retool.com) | the Minigames Live Dashboard, and the workflow that will serve standings over a webhook |
| **The database** | the one index this needs, which neither Retool resource can create (stage 1) |
| **tiiny.host** | nothing any more. The page moved off it. Cancel the plan if the API key was the only reason for it |

---

## You can publish today without any of this

Stages 1 to 4 automate the update. None of them are needed to put correct
standings up right now.

1. Open the **Minigames Live Dashboard**
   (https://retoolonyx--minigames-live-dashboard.retool.app/)
2. **Leaderboard** tab
3. Top right of the page header, set **Affiliates** to **Exclude**.
   It defaults to All. Forgetting is the easiest way to publish standings that
   pay the wrong people.
4. Range buttons, choose **Custom**, enter the dates from `round.json`
   (currently `2026-11-12` to `2026-11-18`), press **Go**.
   Do not use the "Last 7 days" preset. It is backward looking and slides
   forward every day, so it stops matching the round.
5. **Export HTML**, top right of the leaderboard card
6. In this repo, open `index.html`, click the pencil, delete everything, paste
   the exported file, commit

GitHub Pages redeploys in a minute or so. Use **Export CSV** for payouts, which
carries real usernames alongside handle, paid and net.

---

## Stage 1. The index

**Where: the database, through whoever administers it. Not Retool.**

This is the only thing standing between you and a scheduled job, and it is the
one step you cannot do yourself from any tool you currently have open.

### Why it is needed

`"ThirdPartyBet"` is roughly 37 million rows across 38 GB, and no index on it
leads with `createdAt`. The closest is `("userId", "createdAt" DESC)`, which
cannot serve a date range without a `userId` to lead on. So the standings query
reads the entire table every time.

Measured, not guessed: `EXPLAIN` puts the plan at a cost of about 3.46 million,
topped by `Parallel Seq Scan on "ThirdPartyBet"`.

It also lands on the **production primary**. Despite the name, the
`analytics-reader` resource is not a replica. `pg_is_in_recovery()` returns
false.

Run this hourly without the index and you are putting 24 full scans of a 38 GB
table a day through the database that serves the app.

### Why you cannot run it from Retool

Postgres requires you to own a table to index it. `"ThirdPartyBet"` is owned by
**`svc_migrator`**, and neither Retool resource qualifies:

| Resource | Connects as | Owner or superuser? |
|---|---|---|
| `analytics-reader` | `postgres-readonly` | no, and read only |
| `appDatabaseWrite` | `retool_user` | no, member of no roles |

Running it from Retool fails with `must be owner of table ThirdPartyBet`.

### What to ask for

Send this to whoever holds the `svc_migrator` credential or a superuser login,
to run against the production primary:

```sql
CREATE INDEX CONCURRENTLY "ThirdPartyBet_createdAt_idx"
  ON "ThirdPartyBet" ("createdAt");
```

Notes worth passing along with it:

- `CONCURRENTLY` means it will not lock writes, so it is safe during trading.
- On 37 million rows it will take a while. Off-peak is kinder.
- `CONCURRENTLY` cannot run inside a transaction block. If their tool wraps
  statements in one, it has to be run outside it.
- If it fails partway it leaves an invalid index behind. Clean up with
  `DROP INDEX CONCURRENTLY "ThirdPartyBet_createdAt_idx";` and retry.

### Confirming it landed

Anyone with read access can check, including from Retool on `analytics-reader`:

```sql
SELECT indexname FROM pg_indexes
WHERE tablename = 'ThirdPartyBet' AND indexdef LIKE '%(createdAt)%';
```

Two rows means it worked. One row, the `userId` one, means it did not.

---

## Stage 2. The Retool workflow

**Where: Retool, retoolonyx.retool.com, the Workflows section in the left nav.
Not the dashboard app.**

The dashboard cannot be called from outside Retool, so the query gets its own
workflow with a webhook trigger.

1. **Workflows** → **Create new**. Name it `gauntlet-standings`.
2. Trigger type: **Webhook**.
3. Add a **SQL query** block. Rename it to exactly `standings`, because the
   return block refers to it by name. Resource: **analytics-reader**.
4. Do not retype the query. Generate it, so it cannot drift from
   `standings.sql` in this repo:

   ```bash
   python3 build.py --print-sql retool
   ```

   That prints it with this round's `cap` as the `LIMIT`, the affiliate
   exclusion applied, and Retool's `{{ startTrigger.data.startDate }}` bindings
   already in place. Paste the output in as-is.

   No terminal handy? The same query is in `standings.sql`, but you would have
   to substitute the markers by hand. Generating it is safer.

5. In that block's settings, set the **timeout to 120 seconds or more**. The
   default is too short for an unindexed scan of this table.
6. Add a **Response** block, or set the workflow's return value, to:

   ```js
   return { standings: formatDataAsArray(standings.data) }
   ```

   `formatDataAsArray` does nothing if the block already returns row objects,
   and fixes it if the resource returns column-oriented data. Safe either way.

7. Click **Deploy**. A workflow that is saved but not deployed will not answer
   its webhook.
8. Open the webhook trigger's config panel and copy two values: the **webhook
   URL** and the **workflow API key**. Keep them for stage 3.

Re-run `--print-sql retool` and re-paste whenever `round.json` changes.

---

## Stage 3. Repo secrets

**Where: this repo on github.com → Settings → Secrets and variables → Actions
→ the "Secrets" tab → "New repository secret".**

| Name | Value |
|---|---|
| `RETOOL_WEBHOOK_URL` | the webhook URL from stage 2 |
| `RETOOL_WORKFLOW_KEY` | the workflow API key from stage 2 |

That is the whole list. There is no hosting key, because publishing is a commit
rather than an upload.

Secrets are write-only. You can replace one later but never read it back, so
keep your own copy somewhere.

---

## Stage 4. Prove it, then switch it on

**Where: this repo on github.com → the Actions tab.**

1. Left sidebar, click the **publish** workflow.
2. **Run workflow** button, top right. Tick **dry_run**. Run.
3. It fetches, renders and prints the diff, and commits nothing. Open the run,
   scroll to the bottom, download the **index-html** artifact and open it.
   Check the top few ranks, the timestamp line and the prize column.
4. Happy with it? Run it again with **dry_run** unticked. That commits
   `index.html` and Pages redeploys.
5. Only once steps 1 to 4 have all worked, edit
   `.github/workflows/publish.yml` and uncomment these two lines:

   ```yaml
     schedule:
       - cron: "5 * * * *"
   ```

   That is hourly at five past. Do not do this before stage 1 is done.

If a run fails, the log names the reason. The most common are a workflow that
was saved but not deployed, and a block timeout that is still at the default.

---

## Three things that will bite later

**The round window exists in two places.** `round.json` here, and the Custom
range on the dashboard. The automated path reads `round.json`. A hand export
reads whatever the dashboard is set to. If they disagree, both paths publish
confidently and differently.

**The prize ladder exists in two places.** `round.json` here, and `PRIZE_TABLE`
in the dashboard's `frontend/utils/format.ts`. They agree today. A round with a
different structure needs both edited.

**Affiliates differ by path on purpose.** The automated path excludes them,
because `standings.sql` says so. A hand export includes them unless you set the
Affiliates toggle, which does not default to Exclude.

---

## When a round ends

Set `"final": true` in `round.json` and publish once more, or run the workflow
with the **final** input ticked. The hero line changes from "Updated as of" to
"Final Standings as of".

This matters. The previous page sat for two months reading "Updated as of
September 15" while frozen, which tells players it is current when it is not.
