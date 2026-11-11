# LeetCode auto-save: design note (not built yet)

**Goal.** When a LeetCode submission comes back *Accepted* with every test passing, save the code into
`solutions/<rating>/` with the same naming and header comment the app's "Submit to GitHub" button uses
(`solutionPath()` in `app.js`), and push it. `<rating>` is the 100-band of the sheet item `LC:<slug>`, or
`unrated` for problems that aren't on the sheet.

## What every option has to do

1. **Detect the verdict.** On `leetcode.com/problems/<slug>/`, clicking Submit makes the page poll
   `GET /submissions/detail/<id>/check/`. The final response has `status_msg: "Accepted"` and
   `total_correct === total_testcases`. A script can watch that response with a `fetch`/XHR hook in the page's own
   JavaScript context, or with the `webRequest` API in an extension. Polling for the result ourselves is a fallback.
2. **Get the code.** Either read the submitted code from the editor's model at submit time, or fetch it afterwards
   with the GraphQL query `submissionDetails(submissionId) { code lang { name } }`. The query uses the page's own
   session, so no LeetCode credentials are handled.
3. **Write and push.** Either commit through the GitHub Contents API (`PUT /repos/<owner>/cp-tracker/contents/<path>`,
   the same call the app makes), or write into a local clone and run `git commit && git push`. A browser can't run git,
   so the local-clone route needs a helper process on the machine.

Points 1–2 are cheap and similar in every option. The real difference is where the GitHub write happens and what has
to be installed.

## Options

| | Userscript (Tampermonkey/Violentmonkey) | Small extension (MV3) | Reuse CPOS's browser companion |
|---|---|---|---|
| Install | Paste one script into a userscript manager | Load unpacked, or publish privately | Fork CPOS, add LeetCode, maintain the fork |
| Verdict hook | Page-context `fetch` hook (`@run-at document-start`, `@grant unsafeWindow`) | Content script in the `MAIN` world, or `webRequest` | Its content scripts only match Codeforces/CSES/AtCoder today; needs new matches and DOM code |
| GitHub write | `GM_xmlhttpRequest` to the Contents API with a fine-grained token stored in the manager | `fetch` from the service worker with a token in `chrome.storage.local` | Not built in: CPOS writes files through its local apps (VS Code / TUI over `127.0.0.1:27121/27122`), not GitHub |
| Local clone + `git push` | Not possible on its own | Only with a native-messaging host | Possible: the CPOS TUI or VS Code extension already writes files locally, but neither runs git or knows this repo |
| Phone | Works where a userscript manager runs (Firefox/Kiwi on Android; Userscripts app on iOS Safari) | Desktop only (plus Firefox Android) | Desktop only |
| Code to own | ~120 lines | ~200 lines + manifest | Fork of a large, fast-moving project |
| Token exposure | Same as the tracker today (fine-grained, `cp-tracker` only, Contents r/w) | Same, kept out of page context | n/a for GitHub; localhost traffic only |

## Recommendation

**Start with the userscript, and have it commit through the Contents API.** It's the least code, works on the phone
browsers that matter, and needs nothing installed beyond a userscript manager. It also reuses the tracker's token
model and path logic. "Save to a local clone and push" becomes "commit directly"; pulling the local clone gets you
the same result without a helper process.

If a real local clone is required (for example, to compile or diff before pushing), the next step is a tiny
native-messaging host, about 60 lines of Python run by the extension variant, that writes the file and runs `git add/commit/push`
in `~/code/cp-tracker`. I wouldn't fork CPOS for this. It doesn't target LeetCode or GitHub, and the parts we'd reuse
(DOM capture, the localhost queue) are the parts we'd have to rewrite for LeetCode anyway. If CPOS's roadmap item
"submission verdicts read back into CPOS" lands with LeetCode support, check again.

## Details to settle when building

- **Only Accepted with all tests passed.** Skip "Accepted" results from *Run* (custom tests), and ignore repeat
  submissions of identical code (hash it, and skip if `solutions/` already has the same blob SHA).
- **Header comment.** Same format as the app: problem name, platform, rating, URL, date.
- **Log it in `state.json`?** Not from the script. The tracker already picks up LeetCode solves through
  `data/external.json`. The script only writes `solutions/`.
- **Rate limits and conflicts.** Retry once when the Contents API returns `409`/`422`, since the sync workflow and the
  app push to the same branch.
- **Privacy.** Solution code is public by design; never include notes.
