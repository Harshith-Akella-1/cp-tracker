# cp-tracker — notes for Claude

Personal competitive-programming tracker ("Road to 2000"). Owner: Harshith-Akella-1. Public repo, served by GitHub Pages
from `main` / root at https://harshith-akella-1.github.io/cp-tracker/. Commit straight to `main`; no branches or PRs.

## Current shape

One repo holds everything (the old `cp-tracker-data` and `cp-tracker-solutions` repos were merged in with full history,
then made private/archived):

| Path | What it is |
|---|---|
| `index.html` | All CSS + markup shell. Tokens on `:root` (rank colours `--r-*`, `--rank` set from JS). |
| `app.js` | The whole app: plain JS, no build step, no modules. Sections are marked `// ----- name`. |
| `sheet.json` | 1,084-item plan, 217 days, stable item IDs like `CF:1777A`, `CSES:1068`, `LC:two-sum`. |
| `manifest.webmanifest`, `icon.svg` | Home-screen install. |
| `data/state.json` | The attempt log, written by the app through the GitHub Contents API (`GH` object). |
| `data/STATUS.md` | Public AI-readable summary, regenerated on every sync. Contains **no** free text. |
| `data/notes-key.json` | Public KDF parameters (salt, iterations, check blob) for encrypted notes. Created by the first device that sets a passphrase. No secrets. |
| `data/external.json` | LeetCode/GFG solves, committed every 3 h by `.github/workflows/sync-platforms.yml`. |
| `solutions/<rating>/*` | Accepted code uploaded from the app. |
| `docs/` | Design notes. |

`state.json` shape: `{v, items: {<id>: {attempts[], analyses[], solutions[], skipped, done, doneAt, updatedAt}}, synced,
rewards, redeemed, grace, graceLog, reviews[], updatedAt}`. Attempt: `{id, start, end, sec, hints, editorial, wa, outcome,
mistake, notes, notesEnc?, r}`. Analysis: `{id, at, source, text, textEnc?}`. Ratings, XP, gold, HP and streak are
**derived** from attempts in `derive()`; `mergeStates()` unions two devices' logs by record id.

Config lives per device in localStorage `cpt.cfg` (`owner`, `repo` default `cp-tracker`, `branch`, `token`, `solRepo`,
`solDir`, handles). A one-time migration rewrites the old `cp-tracker-data` repo name.

### Encrypted notes
Free text — `attempts[].notes`, `analyses[].text`, `reviews[].text`, `rewards[].name`, `redeemed[].name` (table `SEALED`
in app.js) — is stored as `''` plus `<field>Enc: {enc:'v1', iv, ct, at}` (AES-GCM-256, AAD = `<prefix>:<record id>`,
key = PBKDF2-SHA-256 600k from a per-device passphrase + salt in `data/notes-key.json`). Plaintext lives only in the
device's localStorage `cpt.notes`; the derived key in `cpt.nkey`. `stripPlain()` runs on boot, in `touch()` and before
every upload; `syncNow()` refuses to PUT if any sealed field still holds plaintext. `mergeStates()` re-attaches any
ciphertext a merge would otherwise drop. `statusMd(false)` is the public file; `statusMd(true)` (Copy buttons, weekly
pack, export) includes decrypted notes and never leaves the device.

## Ground rules

- Static, no-build page. Must keep working from a phone home screen (iOS Safari + Android Chrome). No bundler, no
  framework, no npm runtime deps. External scripts only if pinned and truly needed.
- Keep `sheet.json` item IDs stable — logs reference them.
- Keep `state.json` readable by **older builds**: devices update at different times. Add fields; don't rename or change
  the type of existing ones (older builds call `.trim()`/`.replace()` on `notes`/`text`, so those stay strings).
- Never drop data in a merge you can't read. A device without the notes passphrase must carry ciphertext through untouched.
- **Notes are encrypted. Plaintext notes, passphrases, derived keys and video files never go in the repo** — not in
  `state.json`, `STATUS.md`, commit messages, test fixtures or docs. `.gitignore` blocks common video formats and `.env*`.
- The Social Network clip for the rating-up moment is picked per device and kept in IndexedDB; it is never committed,
  uploaded or served from Pages.
- Third-party code keeps its licence: CPOS (MIT, Soham Aggarwal) notices go in `third_party/cpos/LICENSE` or next to
  copied code.
- Use the project skill `.claude/skills/frontend-design` for UI work. Keep the glowing rank look around the rating.
- Verify before pushing: `node --check app.js`, serve with `python3 -m http.server`, load the page, check every tab for
  console errors.

## Roadmap

1. **Rating glow** — keep (and may refine) the glow around the rating; never lose it.
2. **UI from the collusion project** — adapt colours/type/layout/components/motion from
   github.com/Harshith-Akella-1/Algorithmic-Collusion-Detector-Penalizer- where they fit.
3. **Fold in CPOS** — github.com/Soham109/cpos (MIT). Rust TUI + browser companion + VS Code extension over 127.0.0.1;
   bring in what fits a static page (sample capture/running, analytics, skill-model recommendations, practice plan, or
   a bridge to a locally running CPOS). Credit in README.
4. **Start = new tab + timer pop-up** — open the problem in a new tab; show a small always-visible timer (Document
   Picture-in-Picture on desktop Chrome, fallbacks elsewhere). Alerts at 10/17/25 min already exist.
5. **"Welcome to Facebook" moment** — when the projected rating goes up, play a locally picked clip from *The Social
   Network* (2010, Columbia Pictures, dir. David Fincher) with an on-screen credit. IndexedDB only; no-op without a
   clip; mute/disable toggle.
6. **Later, not now: LeetCode auto-save** — see `docs/leetcode-autosave.md` (userscript vs small extension vs CPOS's
   browser companion).
