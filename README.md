# Road to 1600 — CP tracker

Personal competitive-programming tracker for the "Road to 1600" sheet (Striver A2Z + Codeforces + CSES + AtCoder + USACO Guide, ordered by CF-equivalent rating).

## Files
Everything lives in this one repo:
- `index.html`, `app.js` — the app (plain JS, no build step), served by GitHub Pages from `main` / root
- `sheet.json` — the day-by-day plan (1,084 items with stable IDs)
- `manifest.webmanifest`, `icon.svg` — "Add to Home Screen" support
- `data/state.json` — your attempt log (written by the app through the GitHub API)
- `data/STATUS.md` — human/AI-readable summary, regenerated on every sync
- `data/external.json` — LeetCode/GFG solves, written by the sync workflow
- `solutions/<rating>/*` — accepted code uploaded from the app
- `.github/workflows/sync-platforms.yml` — fetches LeetCode/GFG solves every 3 hours

## Where your data lives
The app reads and writes `data/` in this repo (`cp-tracker`). It used to be split across `cp-tracker-data` and
`cp-tracker-solutions`; both were merged in here with their full git history.

Practice rating, XP, gold, HP and streak are all derived from the attempt log, so two devices merge cleanly.

## Setup
1. GitHub Pages: repo Settings → Pages → Deploy from branch → `main` / root.
2. Open the site on each device → Setup → enter your GitHub username, repo `cp-tracker`, and a fine-grained token
   with access to `cp-tracker` only and **Contents: Read and write**. The token stays in that browser's local storage.
3. Codeforces/AtCoder solves sync from their public APIs whenever the app is opened (at most every 30 min, or via "Check all platforms").
   LeetCode/GFG solves come from the workflow above.

**Existing devices:** the app switches its repo setting from `cp-tracker-data` to `cp-tracker` by itself, but your token
was made for the old repo. Edit the token on GitHub (Settings → Developer settings → Fine-grained tokens → your token →
Repository access) and add `cp-tracker`, or create a new one and paste it into Setup on each device.

## Using other AIs
- **Copy for AI** (on any problem): copies your status summary, the problem, your current attempt and history, and asks for a fixed `ANALYSIS` block at the end.
- **Paste analysis**: paste the reply (or just the block) back in; it is stored on the problem and appears in `STATUS.md`.
- **Status → Copy weekly review pack** / **Paste review**: same loop for weekly reviews.

## Timer
Alerts (sound + vibration + banner) at 10 min (hint 1), 17 min (hint 2), 25 min (editorial).

## Practice rating
Elo-style: after each logged attempt, `R += K × (score − expected)`, expected = 1 / (1 + 10^((problem − R)/400)).
Score: solved alone within the estimate 1.0 (slower 0.85 / 0.75), after hint 1 0.6, after hint 2 0.4, editorial 0.1, unsolved 0. K = 40 for the first 50 attempts, then 24.

## Regenerating the sheet
`sheet.json` is produced by the builder scripts (see sheet-builder.zip). Keep item IDs stable so existing logs still match.
