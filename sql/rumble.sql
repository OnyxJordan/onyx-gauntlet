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
  /* How many players qualified in total, carried on every row. The query is
     limited to the ranks the page lists, so counting the rows that come back
     would report the cap instead of the field: 1,000 when 6,600 entered.
     Window functions are evaluated before LIMIT, so this is the true count. */
  COUNT(*) OVER ()                                          AS field,
  ROUND(SUM(rwt."amountCents")::numeric / 100.0, 2)         AS handle
FROM "RipsWalletTransaction" rwt
JOIN "User" u ON u.id = rwt."userId"
LEFT JOIN internal_users iu ON iu.id = rwt."userId"
WHERE rwt.operation = 'DEBIT'
  AND rwt."createdAt" >= :start_date::date::timestamp AT TIME ZONE 'America/New_York'
  AND rwt."createdAt" <  (:end_date::date + 1)::timestamp AT TIME ZONE 'America/New_York'
  AND iu.id IS NULL
  /*AFFILIATE_FILTER*/
GROUP BY u.id
HAVING SUM(rwt."amountCents") > 0
ORDER BY handle DESC, rounds DESC
/*ROW_LIMIT*/
