# Story #38 developer contract

Story: #38 - Center tab close buttons and file finder rows.
Requirements: C1, sprint 2 O2.2 and O2.3, stakeholder feedback 2026-10-11.
Branch: tests/38-centered.
QA owns [c1-centered.spec.ts](../c1-centered.spec.ts), this contract and [the pinned Zed reference](../../fixtures/zed-centered/README.md).
Developer owns app implementation under src/ and the scrubbed comparison screenshots under tests/e2e/evidence/38/.
Leave the acceptance assertions unchanged.
Expected hand-back: implementation PR with both comparison images embedded or linked, unchanged acceptance tests, and external test output for AC1-AC4.

## Numbered acceptance criteria

1. AC1: Workspace and editor close icons are vertically centered in their tabs within 1 CSS px and are drawn X icons like Zed.
2. AC2: Each X is horizontally and vertically centered within the actual close button hit area within 1 CSS px.
3. AC3: Each result's filename and path are vertically centered in the finder row within 1 CSS px.
4. AC4: The PR includes screenshots of tabs and finder next to stock Zed 1.23.2.

## Harness and keyboard paths

Reuse the real Electron fixture and its isolated profile.
Each test copies invented orchard files into a temporary real git repository, supplies the existing COD_TEST_PICK_FOLDERS native-picker responses, restores the environment and removes the copy afterward.
No shared helper or fake is changed.
Use Cmd+Shift+N/Ctrl+Shift+N for a second workspace, Cmd+Shift+E/Ctrl+Shift+E to expose the project panel, focus Add folder and press Enter.
Use Cmd+P/Ctrl+P, type an exact filename and press Enter to open or activate each editor tab.
Workspace previous/next uses the existing shortcuts from helpers/zed-keymaps.ts.
The tests cover both workspace tabs and both editor tabs while each is active, and both selected/unselected finder row states.
No mouse or UI layout class selector is used.

## Icon measurement hook

Keep the close buttons' accessible names beginning with "Close ".
Add data-testid="tab-close-icon" to the drawn SVG path inside both kinds of close button.
Use the X path from the byte-for-byte pinned close.svg, including its d attribute.
The SVG viewport and the path must be centered, with a visible nonzero stroke; stroke color may use currentColor.
Do not put the hook on the hit area, the SVG viewport or an empty wrapper.
Tests measure the actual path boundingBox(), the real button boundingBox() and the real tab boundingBox().
No pixel analysis is used.
AC1 rejects the current text multiplication sign explicitly.
AC2 measures both axes independently of the tab's height.

Reuse workspace-tab, editor-tab, file-finder-name and file-finder-path hooks and the real File finder dialog and option roles.
Keep filename/path hooks on the visible text elements, not wrappers padded to fill the row.
AC3 compares each text element's boundingBox() center with its own row's center.
The generated result set has file10.txt and file2.txt; both contain visible filename and path text.
Finder icons and matched-letter styling are out of scope.

## AC4 evidence and manual check

Provide tests/e2e/evidence/38/tabs-next-to-zed.png and tests/e2e/evidence/38/finder-next-to-zed.png.
Each image must show Cod beside stock Zed 1.23.2 with default settings and keymap, with the relevant controls large enough to inspect.
Use invented fixture data in both apps and scrub the images before committing or publishing them.
Use matching platform, scale and theme; do not substitute a source rendering or mockup for stock Zed.
The test captures fresh Cod tabs and finder views as Playwright attachments and requires both comparison PNGs to be available as review evidence.
It currently fails because those review assets are absent, rather than because a fixture is broken.
This automated gate only checks evidence availability and PNG headers.
It cannot prove stock Zed provenance, screenshot content or publication in a PR, so passing this test alone does not pass AC4.
The reviewer must inspect both images, verify the reference version and default setup, and confirm the PR embeds or links both images before reporting AC4 PASS.

## Expected red baseline and run

AC1 and AC2 should fail with their explicit missing drawn-X assertion because the current buttons contain only a text multiplication sign and no icon hook.
AC3 should fail the <= 1 CSS px center-offset assertion because finder rows currently use baseline alignment.
AC4 should fail with "missing tabs comparison next to stock Zed 1.23.2" and "missing finder comparison next to stock Zed 1.23.2".
These are predictions from source inspection, not observed test results.
QA has not launched Electron or stock Zed in the sandbox.
The PM must run this outside the sandbox before development and resume QA with the output to confirm the failures are for these reasons.

```sh
mkdir -p /tmp/cod-art/38
caffeinate -dimsu npm run test:e2e -- tests/e2e/c1-centered.spec.ts --reporter=list > /tmp/cod-art/38/run.txt 2>&1
```

On Linux omit caffeinate and run under the project's normal Xvfb environment.
The npm script builds the real app before Playwright runs.
Expected count before implementation: 0 passed, 4 failed, 0 skipped, subject to confirmation from the external run.
