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

**This is optional.** The automation runs without it, every 3 hours. The index
is what would let it run hourly or faster, and would stop each run costing a
full read of the biggest table in the database.

### In one paragraph, for forwarding

The bets table is 38 GB and 37 million rows. The leaderboard asks for
everything inside a date range. There is no index on the date column, so
Postgres reads every row and checks each one, which takes about 63 seconds and
reads the whole table. Adding an index on that column is a single command, does
not alter any data, does not lock writes, and would make the query close to
instant.

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

## The Retool side: two workflows

**Both are built and published as of 2026-11-13.** This records what they are,
so they can be rebuilt or understood later.

### `gauntlet-refresh` (schedule, hourly)

Does the slow work, with nothing waiting on it.

- Trigger: **Schedule**, hourly. Webhook trigger off.
- Block `standings`: Resource query on **analytics-reader**, the full standings
  SQL with the round's dates written in. Block timeout **600000**.
  Regenerate it any time with `python3 build.py --print-sql retool`, then
  replace the two `{{ startTrigger.data... }}` bindings with the literal dates,
  since a scheduled workflow has no incoming request to read them from.
- Block `query1`: Resource query on **retool_db**:

  ```sql
  INSERT INTO gauntlet_standings (id, refreshed_at, round_start, round_end, row_count, payload)
  VALUES (1, now(), '2026-11-12', '2026-11-18', {{ standings.data.length }}, {{ JSON.stringify(standings.data) }}::jsonb)
  ON CONFLICT (id) DO UPDATE SET
    refreshed_at = EXCLUDED.refreshed_at,
    round_start  = EXCLUDED.round_start,
    round_end    = EXCLUDED.round_end,
    row_count    = EXCLUDED.row_count,
    payload      = EXCLUDED.payload
  ```

### `gauntlet-standings` (webhook)

What GitHub calls. Reads the parked copy only, so it answers in about 200ms and
never approaches Retool's 120 second synchronous cap.

- Trigger: **Webhook**. Schedule off.
- Block `standings`: Resource query on **retool_db**:
  `SELECT payload, refreshed_at FROM gauntlet_standings WHERE id = 1`
- Block `code1`: `return { standings: standings.data[0].payload, refreshed_at: standings.data[0].refreshed_at }`
- Block `response1`: Status code `200`, Return body `code1.data` (no braces,
  that field is an expression box).

### The storage table

In `retool_db`, created 2026-11-13. One row, id always 1.

```sql
CREATE TABLE IF NOT EXISTS gauntlet_standings (
  id           integer PRIMARY KEY DEFAULT 1,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  round_start  date,
  round_end    date,
  row_count    integer,
  payload      jsonb NOT NULL,
  CONSTRAINT gauntlet_standings_single_row CHECK (id = 1)
);
```

### Things that cost time, so they are written down

- A **Resource query** block runs SQL; a **Code** block runs JavaScript. Pasting
  SQL into a Code block gives `SyntaxError: Unexpected identifier 'INTO'`.
- Block names are **case sensitive** in `{{ }}` references.
- The small **▶** on a block runs it from the browser and dies on a long query
  with `Internal Error running a block: Failed to fetch`. Use the top **Run**.
- A webhook workflow with no **Response** block returns a run id immediately and
  runs in the background, so the caller gets no data.
- Retool is behind Cloudflare, which rejects Python's default user agent with
  `403 error code: 1010`. `build.py` sends an ordinary one.
- An unpublished change does not affect the live webhook. Publish after editing.

