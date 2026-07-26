# Session Handoff — 2026-07-26

Read this first if you're picking up this repo cold. It exists because a
prior session's context doesn't carry forward automatically — this file is
the bridge.

## Repo state

- Branch: `claude/dog-game-continuation-whq4ms` (HEAD = `e11bc91`, matches
  origin, working tree clean at time of writing).
- Live: https://pappydapimp69.github.io/Dog/ — deployed at `e11bc91` via
  `.github/workflows/pages.yml`, which only triggers on push to
  `claude/dog-game-continue-oc3xqh` (a separate branch, gated by a GitHub
  Pages environment-protection rule restricting deploys to it specifically).
  To redeploy after new commits land here: fast-forward that branch —
  `git push origin HEAD:refs/heads/claude/dog-game-continue-oc3xqh --force-with-lease=claude/dog-game-continue-oc3xqh:<known-sha>`
  — and confirm with the user first; never push to a branch other than
  `claude/dog-game-continuation-whq4ms` without explicit permission.

## Last 5 commits (a full round of playtest feedback, all shipped + tested)

- `e11bc91` Boot flow rebuilt as a 3-screen wizard (slots -> coat -> name),
  fixed controller nav (single state-driven `#start-btn` per step, not one
  button per screen).
- `916198c` Added a visible Dennis figure for the cold-open cutscene, plus
  `cutscene.js`'s optional `ctx.charPos` hook — a backward-compatible
  extension of the documented T11 "generic camera framing only" boundary,
  not a rewrite of it.
- `78f3a04` Fixed the player dog's scale (was rendering at human height) via
  `DOG_VISUAL_SCALE = 0.55` in `world.js`, plus retuned every dependent
  camera offset and mouth/attachment offset in `world.js`, `fetch.js`,
  `keepsake.js`.
- `339062c` Suspicion Retirement — the meter HUD actually retires on adoption.
- `f48e445` Added a test hook for Rex contest state; verified the full
  playthrough end to end.

## Status

All tracked tasks are completed and there's no open work item queued. This
is a clean stopping point, not a mid-task handoff — ask the user what's next
rather than assuming more work is pending.

## Brain (this repo is linked, full mode)

Run `brain query <terms>` before any non-trivial work, and `brain mine` +
`brain sync` after landing real fixes. This was skipped for most of the
prior session and got logged as its own lesson — don't repeat it.

New lessons filed and promoted to canon this session
(`projects/pappydapimp69__dog.md`):
- `E68` — a single state-driven confirm button beats one button per screen
  for a linear, gamepad-navigable flow, but every listener on it must stay
  strictly idempotent.
- `E69` — a uniform `.scale.setScalar()` fix isn't complete until every
  camera/attachment offset tuned to the model's old size is also rescaled.
- `E70` — bend a documented architecture boundary with a narrow, optional,
  no-op-by-default hook rather than reopening it for every caller.
- `[process][compliance]` — the Brain query/mine/sync loop is not enforced
  by the commit-time tension gate; it has to be run unprompted, every
  session, especially when a concrete task list is competing for attention.
- `[orchestration][verification]` — a multi-agent blind-verification design
  is only as strong as the message-passing substrate's isolation; if a
  downstream verifier refuses input as contaminated, treat that as correct
  and halt rather than routing around it.

## Test suite

134 unit tests across 6 files, plus a large set of Playwright browser
regressions kept in the sandbox scratchpad (not part of the shipped repo) —
all green as of `e11bc91`.
