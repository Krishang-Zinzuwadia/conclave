Original prompt: ok i did git stash do git pull origin main and do git stash pop fix merge conflicts if any then see the diffs and fix the code quality and make the zip game properly functional

Notes:
- Resumed with stash@{0} present. Existing untracked Zip-related files are intentionally preserved while syncing.
- Pulled origin/main at dcaf9be0 and reconciled the Zip, Chess, SFU URL, package, and lockfile conflicts.
- Aligned the Zip client with the numeric cell protocol used by the SFU and switched drag syncing to submit only the completed path.
- Verified the rendered Zip grid, numeric move payloads, drag, undo, reset, hint, and completion flow in a disposable local browser harness; no console errors observed.

Final verification:
- Focused web/SFU lint, Zip unit tests (28 passing), SFU typecheck, regenerated Next route types, and web TypeScript all pass.
- No open Zip-game TODOs. The temporary browser harness was removed after verification.
- Current task: smooth pointer-captured dragging and display server-authoritative elapsed solve timestamps.
- Implemented pointer capture with continuous crossed-cell handling and synchronous drag state. Results and live standings now show elapsed solve times from the server's round start timestamp.
- Browser QA verified a fast held drag renders local progress before release, submits the expected numeric prefix on release, and shows a 1:33.4 completion time without console errors. The temporary QA route was removed.
- Current task: make solve times unmistakable in results, hide the Zip time-limit launcher control, and add a server-enforced three-second hint cooldown.
- Completed: Zip no longer exposes a time-limit launcher option (rounds stay at a fixed five minutes), results say “Solved in m:ss.t”, and Hint is server-enforced at one use per three seconds with a visible disabled countdown.
- Browser QA confirmed the cooldown lifecycle and explicit solve-time result text; the temporary QA route was removed.
- Current task: remove the Zip deadline entirely and replace its countdown with an active elapsed-time display.
- Completed: no timeout or countdown ring remains; games stay active until players finish, the header counts elapsed time up, and score timing still uses the server round-start timestamp. Browser QA confirmed the elapsed display advances with no console errors.
- Follow-up: elapsed format is `ss:ms` below one minute and `mm:ss:ms` once a minute has elapsed, with three-digit milliseconds refreshed every 50 ms. Browser QA verified both formats and advancing milliseconds; the temporary QA route was removed.
