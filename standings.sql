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
WHERE tpb."createdAt" >= :start_date::date::timestamp AT TIME ZONE 'America/New_York'
  AND tpb."createdAt" <  (:end_date::date + 1)::timestamp AT TIME ZONE 'America/New_York'
  AND iu.id IS NULL
  /*AFFILIATE_FILTER*/
GROUP BY u.id
ORDER BY handle DESC, rounds DESC
/*ROW_LIMIT*/
