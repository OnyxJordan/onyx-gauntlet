# CLAUDE.md: Mini Games Gauntlet leaderboard

Onboards a fresh session onto the **Onyx Odds Mini Games Gauntlet** public
leaderboard, built for Jordan (GitHub `OnyxJordan`, jordan@onyxodds.com). Read
all of it before touching anything. Most of what follows was learned by getting
it wrong first.

This repo is standalone. It has no relationship to `OnyxJordan/Onyx-BB` (the
fantasy best-ball product) beyond having briefly lived inside it; that copy was
deleted in Onyx-BB#3 precisely so there is one source of truth. Do not put
leaderboard code back there.

## State verified 2026-11-12

- **The page is this repo's `index.html`.** GitHub Pages serves it. Publishing
  is a commit; there is no upload step and no hosting API key.
- **Previously on tiiny.host** at `onyxgamesgauntlet.tiiny.site`. That URL
  started returning 404 and the tiiny management UI errored, which is why it
  moved. `index.html` here is the September 15 2026 page, recovered from the
  live site before it went down, relabelled as final.
- **Nothing is automated yet.** The workflow exists, its schedule is commented
  out, and the Retool webhook it needs has not been built. See `SETUP.md`.
- **The round in `round.json` is 2026-11-12 to 2026-11-18.** Confirm with
  Jordan before trusting it; a stale window publishes a plausible, wrong page.

## 1. The product in one paragraph

A public, read-only standings page for a recurring sweepstakes contest on Onyx
Mini Games. Players are ranked by **handle** over a date window, top 20 win a
share of a 10,000 Bonus Onyx Cash pool, and the page shows masked handles with
prizes. It is a single self-contained HTML file: no build step, no framework,
no runtime API calls, all data inlined.

## 2. The thing that is easy to miss

**The dashboard already builds this page.** The Minigames Live Dashboard
(Retool app `e068a374-6c26-11f1-8422-77b4193c4333`, published at
https://retoolonyx--minigames-live-dashboard.retool.app/) has an **Export HTML**
button in `frontend/components/minigames/LeaderboardTable.tsx`, and its
`buildHtml()` produces exactly this page.

That is the primary publishing path, and it needs no code here at all. See
`SETUP.md`, "You can publish today". `build.py` exists to do the same thing on a
schedule, not to replace it.

Consequences:

- `template.html` was **derived from real dashboard output**, not hand written,
  so rendered pages match the export structurally. Keep it that way.
- `mask()` in `build.py` mirrors `maskUsername()` in the dashboard's
  `frontend/utils/format.ts`. `round.json`'s ladder mirrors `PRIZE_TABLE` in the
  same file. Both pairs must change together or the two paths disagree.

## 3. Privacy rule, load bearing

**Only masked handles and prizes may reach the page.** The data array is
`[{"r":1,"u":"j******kt","p":2500}, ...]`. The page source is public, so a real
username in it is a published username.

An earlier draft of this pipeline shipped real usernames and masked them in the
browser. That was a regression against what the dashboard already did. `render()`
in `build.py` has a guard that refuses to write the file if an unmasked handle
reaches the data; it is tested by breaking `mask()` on purpose. Do not remove it.

## 4. File map

| Path | What it is |
|---|---|
| `index.html` | The published page. The deliverable. |
| `template.html` | Same page with `__DATA__` and `__UPDATED__` placeholders |
| `build.py` | Fetch, rank, mask, render. Standard library only |
| `standings.sql` | The ranking rule. One source of truth |
| `round.json` | The only file that changes between rounds |
| `.github/workflows/publish.yml` | Scheduled and manual publishing. Schedule off |
| `SETUP.md` | How to finish wiring the automation, step by step |
| `README.md` | Operating guide |

## 5. The ranking rule

`standings.sql`, copied from the dashboard's
`/backend/minigames/leaderboard.ts` so the two cannot drift:

- Rank order is **handle descending**, rounds descending as the tiebreak. The
  page never renumbers; rank is the query's row order.
- **SWEEP balances only.**
- **Internal users excluded**: flagged internal, or an `@onyxodds.com` email.
- **Affiliates excluded**, meaning any user whose id owns a `Promotion`. This is
  deliberate and differs from the dashboard, which includes them by default.
  Jordan decided this on 2026-09-23.
- Dates inclusive, Eastern.

`build.py --print-sql retool` regenerates it with Retool bindings. Always
generate; never retype.

## 6. Database facts worth not rediscovering

- **`analytics-reader` is not a replica.** `pg_is_in_recovery()` is false. It is
  the production primary, reached as `postgres-readonly`. Treat query cost as
  production load.
- **`"ThirdPartyBet"` has no index leading with `createdAt`.** 37M rows, 38 GB,
  so the standings query full-scans it. `EXPLAIN` cost about 3.46 million.
- **Neither Retool resource can create that index.** The table is owned by
  `svc_migrator`; `analytics-reader` is `postgres-readonly` and
  `appDatabaseWrite` is `retool_user`, a superuser of nothing and a member of no
  roles. It needs an infra credential. Full detail in `SETUP.md` stage 1.
- The query is heavy enough to exceed short client timeouts. Retool's own
  runtime is fine with a raised block timeout.

## 6b. Look and feel

The page follows the Onyx design system from `OnyxJordan/onyx-baseball-fix`
(`onyx.css`), so the Gauntlet matches the rest of Onyx:

- Tokens copied from that file's `:root`: `--ox-black:#0c0c0c`,
  `--ox-ink:#08080a`, `--ox-white:#fcfcfc`, `--ox-body:#afa5bd`,
  `--ox-stroke:#2f2f2f`, `--ox-purple:#b038f9`, `--ox-lilac:#d795ff`,
  `--ox-green:#61e970`, `--ox-mint:#a5feaf`. No yellow.
- Type: Archivo at 125% width for the extended uppercase display, Geist Mono
  for labels, Doto for raster numerals (ranks and the stat strip).
- Components reproduced inline: mint announcement bar, sticky header with the
  real Onyx wordmark and mark, marquee, diamond-marked eyebrow, bracket
  buttons, raster digit hero art.
- Up/down/flat colours follow that site's `picks.html`:
  `.pos{#61e970} .neg{#ff7a90} .mut{#9a93a6}`.

Keep it self contained. The real site loads `onyx.css` and `onyx.js`; this page
inlines what it needs instead, because it has to work as one file.

## 6c. Movement arrows

`previous.json` holds the last published run's ranks, keyed by
`sha256(username)[:16]`. Masked names cannot be the key: they collide, and two
players masking to the same string would swap arrows.

`d` on each row is spots gained, positive for a climb, `null` for a player who
was not in the previous standings (shown as New, not as a climb from nowhere).
Previous ranks are saved only after the page is actually written, so an aborted
build cannot swallow a round of movement.

## 7. Gotchas

- **The affiliate toggle on the dashboard defaults to All.** A hand export made
  without switching it to Exclude publishes standings that pay the wrong people.
  The automated path is unaffected.
- **Do not use the dashboard's "Last 7 days" preset for a round.** It is
  backward looking and slides daily. Use Custom, matching `round.json`.
- **`pool` in `round.json` is a checksum.** If the ladder does not sum to it the
  build aborts. That is intended; it catches the typo that pays the wrong total.
- **A finished round must be marked final.** `"final": true` switches the hero
  line to "Final Standings as of". The previous page sat frozen for two months
  saying "Updated as of September 15", telling players it was current.
- **`<` is escaped to `<` in the data array**, same as the dashboard does,
  so no handle can close the script tag.
- **Masking is not cleaning.** Spaces in handles, signup fallback ids and
  duplicates are reported by `build.py` but not rewritten, because masking hides
  most of what used to matter. Flag them upstream rather than editing here.

## 8. House style (from Jordan, applies across Onyx work)

- **Sweepstakes copy:** never use `$`; spell amounts out. Never use "cash"
  alone; the branded term is **"Bonus Onyx Cash"**. Footer: "No purchase
  necessary. 18+. Terms apply." The page complies already, printing `2,500`
  with no symbol.
- **No em dashes in anything Jordan reads.** That includes docs and commit
  messages in this repo.
- **Never invent data.** Fields that cannot be sourced are null.
- **Never put model identifiers in commits, PRs, code, or comments.** End
  commits with the attribution lines the session's system reminder specifies.
- Jordan states problems tersely and works from the live artifact. Root-cause
  rather than patch the symptom, verify before claiming, and lead summaries with
  what changed.

## 9. Open items

- `SETUP.md` stages 1 to 4 are all outstanding. Stage 1, the index, gates the
  rest.
- Custom domain. `onyxjordan.github.io/onyx-gauntlet` works, but pointing
  something like `gauntlet.onyxodds.com` at it is one CNAME and avoids ever
  being locked to a host again.
- The prize ladder is duplicated between here and the dashboard's `format.ts`.
  Worth collapsing to one source if a round ever changes structure.
