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

**Search by real username works without breaking that.** Players could not find
themselves, because typing a whole handle cannot match the mask it is shown as.
So each row also carries `k`, a salted sha256 of the lowercased handle
(`search_key()` in `build.py`, `SEARCH_SALT` shared with `digest()` in
`template.html` — change one and search silently stops working). The page hashes
what is typed and compares. An exact match wins outright and shows that one row;
otherwise it falls back to substring matching against masked handles.

Be honest about what that costs: a digest is not a secret. Someone holding a
list of usernames can hash it and learn which of those names are on the board.
The mask already gives the first letter, the last two and the length, so this
turns a likely guess into a confirmed one. The list still cannot be read off the
page. Jordan asked for the search on 2026-11-14 knowing the page is public; if
the trade is ever unwanted, drop `"k"` from the rows in `render()` and search
degrades to masked handles only.

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
- **Affiliates are included.** Jordan excluded them on 2026-09-23 and reversed
  it on 2026-11-14: some affiliates promote the leaderboard, so removing the
  whole group was wrong. `exclude_affiliates` stays false. Individuals are
  removed one at a time via `excluded` in `round.json`, which holds digests
  rather than usernames because the repo is public; generate one with
  `build.py --exclude-key`. An exclusion moves everyone below it up a place,
  so it changes who is paid.
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
(`onyx.css`), so the Gauntlet matches the rest of Onyx. Type and structure never
change between rounds: Archivo at 125% width for the extended uppercase display,
Geist Mono for labels, Doto for raster numerals, the mint-free sticky header,
marquee, diamond-marked eyebrow, bracket buttons and raster art.

**Only the palette changes for a seasonal round.** Every colour is a token on
`:root`, including the channel forms `--ox-accent-rgb`, `--ox-black-rgb` and
`--ox-stroke-rgb` that the row tints and sticky header use. Those channel
tokens exist because the first Thanksgiving pass missed three `rgba(176,56,249)`
literals and left purple podium rows under an orange theme.

| Round | Accent | Tag to restore it |
|---|---|---|
| Nov 12 to 18, the house look | `--ox-purple:#b038f9` | `round-2026-11-12_purple` |
| Nov 20 to 27, Thanksgiving | `--ox-purple:#ff8a3d` harvest orange, `--ox-lilac:#ffc46b` amber, warmed greys | current |

Restore an earlier look with
`git checkout <tag> -- template.html onyx.js`, which leaves `round.json` and the
standings alone.

Up/down/flat colours keep the meaning they have on `picks.html`, whatever the
palette: green up, red down, muted flat, accent for New.

### The art engine

`onyx.js` is copied from the baseball repo but **this copy has diverged**, and
the extras must survive any resync:

- Tones `amber`, `ember`, `cranberry`, `wheat` beside the house purple set.
- Shapes `turkey`, `leaf`, `acorn`, `pumpkin`, `wheat`, drawn with ordinary
  canvas calls in the unit box `ball()` sets up, the same way the ball sports
  are drawn, so they rasterise into the character ramp like everything else.
- **Falling leaves.** `data-ox-leaves` on a canvas makes the pointer shed leaves
  that are thrown along the swipe, flutter down, sway and fade, and that the
  pointer shoves aside and drags around itself so the cascade parts rather than
  being passed through. They keep falling after the pointer leaves, so `tick()`
  treats a canvas with leaves in the air as hot and gives it the full frame
  clock instead of the idle 20fps. Capped at 46, spawned every 26ms (twice on a
  fast drag), and off entirely under `prefers-reduced-motion`.

  Three things here were each a failed attempt first, so do not undo them:

  - **They sample the real `SHAPES.leaf` silhouette**, rasterised once into
    `LEAFMASK` and read back per particle with that particle's rotation and
    size. A five-lobed radial blob was tried and never read as a leaf at any
    size.
  - **They have their own canvas** (`.hero-leaves`, `data-ox-art="none"`, which
    draws nothing). Sharing the textured canvas meant the opacity that quietened
    the background texture dimmed the leaves to the same 13%.
  - **`data-ox-lens="0"`** switches off the pointer bulge and ripple for a
    canvas. With the lens left on, the leaves looked like debris on water rather
    than a cascade. The lens stays on everywhere else.

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
