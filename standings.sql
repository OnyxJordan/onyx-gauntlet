-- Gauntlet standings. Single source of truth for how players are ranked.
--
-- Copied from the Minigames Live Dashboard's /backend/minigames/leaderboard.ts
-- so the public leaderboard and the internal dashboard can never disagree about
-- who is in front. If that file changes, change this one.
--
-- Ranking rule: handle descending, rounds descending as the tiebreak. SWEEP
-- balances only. Internal users excluded. Dates inclusive, Eastern.
--
-- Not run as-is. build.py fills the two /*markers*/ below from round.json and
-- rewrites the :named parameters for whichever client is running it, so keep
-- both in place when editing.
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
  ROUND(SUM(tpb."stakeCents")::numeric / 100.0, 2)          AS handle
FROM "ThirdPartyBet" tpb
JOIN "Balance" bal ON bal.id = tpb."balanceId" AND bal.type = 'SWEEP'
JOIN "User" u ON u.id = tpb."userId"
LEFT JOIN internal_users iu ON iu.id = tpb."userId"
-- The "+ interval '0 second'" is load bearing. It changes no value, it stops
-- the planner using "ThirdPartyBet_userId_createdAt_idx".
--
-- "ThirdPartyBet" has no index leading with createdAt, and its statistics are
-- refreshed by autoanalyse rather than on a schedule, so a round that starts
-- after the last analyse sits past the end of the planner's histogram. On
-- 2026-11-21 it estimated 1 row for a window holding 399,555, chose that index
-- and nested loops on the strength of it, and ran past the 600 second block
-- timeout; the refresh had been failing since 04:03 and the board froze at
-- 3:15am. Made non-sargable, the planner falls back to a default estimate,
-- picks a parallel scan, and the query behaves like it did all last round.
--
-- Delete this the day "ThirdPartyBet" gets an index on createdAt, and not
-- before. See README, "The index".
WHERE tpb."createdAt" + interval '0 second' >= :start_date::date::timestamp AT TIME ZONE 'America/New_York'
  AND tpb."createdAt" + interval '0 second' <  (:end_date::date + 1)::timestamp AT TIME ZONE 'America/New_York'
  AND iu.id IS NULL
  /*AFFILIATE_FILTER*/
GROUP BY u.id
ORDER BY handle DESC, rounds DESC
/*ROW_LIMIT*/
