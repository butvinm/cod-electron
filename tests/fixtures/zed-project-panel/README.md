# Project panel reference for story #37

AC1 keeps Zed's file type mapping at v1.23.2 and uses Lucide drawings under ISC, per the PM decision in stakeholder issue #53 (default: Lucide).
Zed's own GPL-3.0-or-later icon drawings are not included.
The local source was inspected without launching stock Zed or Electron.

## Mapping and icon references

Zed v1.23.2 is pinned to commit c0199504b9cce79bc27524950022ed701bc3ebd5.
The issue's file_types.json path does not exist at this checkout.
The mapping comes from https://github.com/zed-industries/zed/blob/c0199504b9cce79bc27524950022ed701bc3ebd5/crates/theme/src/icon_theme.rs and the resolver from https://github.com/zed-industries/zed/blob/c0199504b9cce79bc27524950022ed701bc3ebd5/crates/file_icons/src/file_icons.rs.
No test reads those Rust files, so their fixture copies have been removed.
Do not copy the GPL mapping/resolver implementation into the MIT app.

| Row or Zed icon kind | Zed mapping | Lucide reference |
| --- | --- | --- |
| Closed folder | folder | folder.svg |
| Open folder | folder_open | folder-open.svg |
| Unknown extension / default file | file | file.svg |
| Generic code | code | file-code.svg |
| .ts | typescript | file-code.svg |
| .rs | rust | file-code.svg |
| .py | python | file-code.svg |
| .md | book | book-open.svg |
| .json | code (JSON file) | file-braces.svg |

JSON keeps Zed's file classification but uses the closest Lucide drawing for JSON, file-braces.svg, as specified by the updated AC1 handoff.
All six SVG files are copied byte for byte from icons/ in lucide-static 1.55.0, provided locally at /tmp/lucide-dl/package.
Upstream package: https://www.npmjs.com/package/lucide-static/v/1.55.0
Upstream project: https://github.com/lucide-icons/lucide
LICENSE is the package's complete, unchanged license text; LICENSES records the fixture origins and licenses.
The AC1 test compares rendered SVG geometry with these Lucide references without relaxing the comparison.

## Retained Zed settings and generated folder

The unmodified default-settings.json comes from https://github.com/zed-industries/zed/blob/c0199504b9cce79bc27524950022ed701bc3ebd5/assets/settings/default.json.
The existing ../zed-themes/one.json supplies One Dark element.selected (#454a56ff) and border.focused (#47679eff).
Pinned defaults enable file_icons and auto_reveal_entries, with folder_indicator set to icon.
The generated throwaway folder is panel-look, containing branches/nested/item-000.ts through item-089.ts, sample.ts, sample.json, sample.md, sample.rs, sample.py and sample.unknown-cod37.
All file content is invented.
