# Adding the Rips Rumble to Retool

Three edits, all inside Retool, maybe ten minutes. Until they are done the
Rumble page shows "Standings open soon" and the Gauntlet carries on exactly as
it is; nothing here can break the Gauntlet.

**The whole point of this shape: it costs no extra Retool workflow runs.** The
same `gauntlet-refresh` run computes both boards, and one call to
`gauntlet-standings` returns both. That matters because the allowance is 5,000
runs a month for the whole org and it ran out mid-round on 2026-11-21.

---

## 1. Let the table hold more than one board

**Where: Retool → Database → the SQL editor (or any query on `retool_db`).**

`gauntlet_standings` was built to hold exactly one row. Take that restriction
off, so the Rumble can live in row 2:

```sql
ALTER TABLE gauntlet_standings DROP CONSTRAINT IF EXISTS gauntlet_standings_single_row;
```

The Gauntlet stays in row 1 and is untouched.

---

## 2. Compute the Rips standings in `gauntlet-refresh`

**Where: Retool → Workflows → `gauntlet-refresh`.**

Two blocks, added after the ones already there. The Gauntlet's blocks stay
exactly as they are.

### 2a. Block `rips`, a Resource query on **analytics-reader**

Default block timeout is fine. This query runs in about 5 seconds, unlike the
Gauntlet's: `RipsWalletTransaction` is 789k rows and already has the index it
needs.

```sql
-- Rips Rumble standings. Single source of truth for how players are ranked.
--
-- Ranking rule: total pack purchases descending, packs opened descending as
-- the tiebreak. Jordan, 2026-11-25: "stake are total purchases of packs".
--
-- A pack purchase is a DEBIT row in "RipsWalletTransaction". The other
-- operations are the other side of the ledger and must not be counted:
--   DEBIT     the player buying a pack        <- this is the stake
--   CREDIT    a prize paid back, available or hold
--   SELLBACK  a prize sold back
--   HOLD / WITHDRAW / REFUND
--
-- amountCents is the whole purchase. The row also splits out redeemableCents
-- and bonusAmountCents; those are not used, because the rule is total
-- purchases rather than sweeps-only play. That differs from the Gauntlet,
-- which counts SWEEP balances only, and it is deliberate.
--
-- Internal users excluded, same rule as the Gauntlet. Affiliates are in.
-- Dates inclusive, Eastern.
--
-- This table is 789k rows with a (userId, createdAt) index, so unlike the
-- Gauntlet's query it needs no planner coaxing and runs in about 5 seconds.
--
-- Not run as-is. build.py fills the two /*markers*/ below from the board file
-- and rewrites the :named parameters for whichever client is running it, so
-- keep both in place when editing.
WITH internal_users AS (
  SELECT u.id
  FROM "User" u
  WHERE u."userMetrics"->>'isInternal' = 'true'
     OR u."email" LIKE '%@onyxodds.com'
)
SELECT
  COALESCE(u."userId", '')                                  AS user_id,
  COALESCE(u."username", u."name", u."userId", '(unknown)') AS username,
  COUNT(*)                                                  AS rounds,
  ROUND(SUM(rwt."amountCents")::numeric / 100.0, 2)         AS handle
FROM "RipsWalletTransaction" rwt
JOIN "User" u ON u.id = rwt."userId"
LEFT JOIN internal_users iu ON iu.id = rwt."userId"
WHERE rwt.operation = 'DEBIT'
  AND rwt."createdAt" >= '2026-11-26'::date::timestamp AT TIME ZONE 'America/New_York'
  AND rwt."createdAt" <  ('2026-11-27'::date + 1)::timestamp AT TIME ZONE 'America/New_York'
  AND iu.id IS NULL

GROUP BY u.id
HAVING SUM(rwt."amountCents") > 0
ORDER BY handle DESC, rounds DESC
LIMIT 1000
```

A pack purchase is a `DEBIT` row. `CREDIT`, `SELLBACK`, `HOLD`, `WITHDRAW` and
`REFUND` are the other side of the ledger and are deliberately not counted, so
this is total spent on packs, which is what "stake" means here.

`LIMIT 1000` is a hard cap, not a performance tuning knob. The board lists a
thousand ranks and the page never says how many entered, so nothing here may
carry a total back.

Regenerate this any time with `python3 build.py --print-sql scheduled --board rumble`.

### 2b. Block `rips_park`, a Resource query on **retool_db**

```sql
INSERT INTO gauntlet_standings (id, refreshed_at, round_start, round_end, row_count, payload)
VALUES (2, now(), '2026-11-26', '2026-11-27', {{ rips.data.length }}, {{ JSON.stringify(rips.data) }}::jsonb)
ON CONFLICT (id) DO UPDATE SET
  refreshed_at = EXCLUDED.refreshed_at,
  round_start  = EXCLUDED.round_start,
  round_end    = EXCLUDED.round_end,
  row_count    = EXCLUDED.row_count,
  payload      = EXCLUDED.payload
```

The dates here must match `boards/rumble.json` in the repo. If they do not, the
build refuses to publish rather than putting one window's numbers under another
window's prize ladder, and the run log says so.

Keep the GitHub dispatch block last, so it fires once both boards are parked.

---

## 3. Make the webhook return both boards

**Where: Retool → Workflows → `gauntlet-standings`.**

This is the one GitHub calls on every publish. Today it returns row 1 only.
One call must return every board, otherwise publishing two boards costs two
workflow runs instead of one.

### Block `standings`, Resource query on **retool_db**

Replace it with:

```sql
SELECT id, payload, refreshed_at, round_start, round_end
FROM gauntlet_standings
ORDER BY id
```

### Block `code1`

Replace it with:

```js
return { boards: standings.data }
```

### Block `response1`

Unchanged: status `200`, return body `code1.data`.

Then **Publish release**. An unpublished change does nothing.

The build understands both the old answer and the new one, so the Gauntlet
keeps publishing whichever is live. Only the Rumble needs the new one.

---

## Checking it worked

Press **Run** on `gauntlet-refresh`. Then Actions → **publish** → Run workflow,
and the log should read:

```
gauntlet: NNN rows from auto
rumble: NNNN rows from auto
home: wrote .../index.html: 2 boards, 30,000 in total prizes
```

If instead it says `rumble: NOT published: gauntlet_standings has no row 2 yet`,
step 2 has not run. If it says the parked standings cover different dates, the
dates in step 2b and in `boards/rumble.json` disagree.
