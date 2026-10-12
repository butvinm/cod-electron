---
name: record-clip
description: QA procedure to record a 30-60 second clip of the flow a Cod story changed, one chapter per file, and validate it with an ffmpeg contact sheet before it is shown to the stakeholder. Use after verify mode passes.
---

# Record a clip

Output: `artifacts/<issue>/<chapter>.mp4` (30-60 s), `artifacts/<issue>/<chapter>-sheet.png`, and a clip line in the QA hand-back. The `artifacts/` folder is git-ignored; clips are attached to the issue or PR, never committed.

## Rules

- One chapter per file: one flow, one story. Never one long video for many flows; a failed chapter must be re-recordable on its own.
- 30-60 seconds. Start on a clean state, show the flow at a human pace, end on the result.
- Fakes only: the fake agent provider and look-alike pages, invented data. Nothing from an employer, no real accounts, no tokens on screen, no desktop notifications from other apps.
- Recording launches Electron, so it runs outside Codex's sandbox (see `.claude/agents/qa.md`). On macOS wrap it in `caffeinate -dimsu` so the machine does not sleep mid-recording; if it seems to hang, check `pmset -g log | tail -50` first.

- Quiet mode: `tests/e2e/helpers/electron.ts` sets `COD_TEST_QUIET=1`, so test windows are hidden and the app never activates on macOS. Playwright videos and screenshots still work, but for a clip that must show a real visible window, run with `COD_TEST_VISIBLE=1` (for example `COD_TEST_VISIBLE=1 caffeinate -dimsu npx playwright test ...`). It turns quiet mode off. Clip scripts that launch Electron themselves must pass it through.

## Steps

1. Write or reuse the chapter script `tests/clips/<chapter>.spec.ts`: a Playwright for Electron test that performs the flow with short pauses (`page.waitForTimeout(600)` is fine here, only here) and asserts each step's result, so the clip is also a test.
2. Record with Playwright's video option at the window size used for demos (for example 1600x1000):

   ```
   caffeinate -dimsu npx playwright test tests/clips/<chapter>.spec.ts --config playwright.clips.config.ts
   ```

3. Convert and trim to MP4:

   ```
   ffmpeg -y -i test-results/<dir>/video.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart artifacts/<issue>/<chapter>.mp4
   ```

4. Check the duration: `ffprobe -v error -show_entries format=duration -of csv=p=0 artifacts/<issue>/<chapter>.mp4` must be between 30 and 60.
5. Make the contact sheet of 16 evenly spaced frames:

   ```
   ffmpeg -y -i artifacts/<issue>/<chapter>.mp4 -vf "fps=16/<duration>,scale=480:-1,tile=4x4" -frames:v 1 artifacts/<issue>/<chapter>-sheet.png
   ```

6. Look at the sheet (open the image). Check: no blank or black frames, no stuck frame across the whole clip, the changed flow is visible, the final frame shows the result, nothing private or work-related appears. Re-record if any check fails.
7. Attach the MP4 to the issue (drag it into a comment, or the PM uploads it) and note its link.

## Output format

```
Clip: artifacts/<issue>/<chapter>.mp4, <duration> s
Contact sheet: artifacts/<issue>/<chapter>-sheet.png, frames checked: OK | <problem>
Shows: AC<n>, AC<m> (which criteria are visible in the clip)
```
