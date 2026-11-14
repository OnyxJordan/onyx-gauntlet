// Paste this into a Code block at the END of the Retool workflow
// "gauntlet-refresh", after the block that writes the snapshot (query1).
//
// What it does: tells GitHub to publish the standings right now.
//
// Why it exists: GitHub's own scheduler drops most scheduled runs. Measured
// 2026-11-14, it fired 3 times in 19 hours when asked for 96. Retool's
// schedule fires on time, so Retool starts the publish instead. The GitHub
// cron stays switched on as a backstop; a double publish is harmless because
// a run that finds nothing changed commits nothing.
//
// Needs one Retool config variable named GITHUB_TOKEN, holding a GitHub
// fine-grained personal access token scoped to OnyxJordan/onyx-gauntlet with
// Actions set to "Read and write". See SETUP.md, "Stage 5".

const res = await fetch(
  "https://api.github.com/repos/OnyxJordan/onyx-gauntlet/actions/workflows/publish.yml/dispatches",
  {
    method: "POST",
    headers: {
      Authorization: "Bearer " + retoolContext.configVars.GITHUB_TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      // GitHub rejects requests with no User-Agent.
      "User-Agent": "onyx-gauntlet-refresh",
    },
    body: JSON.stringify({ ref: "main" }),
  }
);

// GitHub answers 204 with an empty body on success. Anything else is a
// failure worth seeing in the run log rather than swallowing: a 401 means the
// token is wrong or expired, a 403 means it lacks Actions write, and a 404
// means the token cannot see this repository at all.
if (res.status !== 204) {
  const body = await res.text();
  throw new Error("GitHub dispatch failed: " + res.status + " " + body);
}

return { dispatched: true, status: res.status };
