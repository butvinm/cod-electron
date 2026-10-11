# Project panel reference for story #37

Unmodified files from Zed v1.23.2, commit c0199504b9cce79bc27524950022ed701bc3ebd5.
The local source was inspected without launching stock Zed or Electron.

- `icon_theme.rs`: https://github.com/zed-industries/zed/blob/c0199504b9cce79bc27524950022ed701bc3ebd5/crates/theme/src/icon_theme.rs
- `file_icons.rs`: https://github.com/zed-industries/zed/blob/c0199504b9cce79bc27524950022ed701bc3ebd5/crates/file_icons/src/file_icons.rs
- `default-settings.json`: https://github.com/zed-industries/zed/blob/c0199504b9cce79bc27524950022ed701bc3ebd5/assets/settings/default.json
- SVGs and `LICENSES`: https://github.com/zed-industries/zed/tree/c0199504b9cce79bc27524950022ed701bc3ebd5/assets/icons

The issue's `file_types.json` path does not exist at this checkout.
The mapping is in `icon_theme.rs`: ts -> typescript.svg, json -> code.svg, md -> book.svg, rs -> rust.svg, py -> python.svg, unknown -> file.svg.
Folders use folder.svg and folder_open.svg.
The complete mapping and resolver are test references, not app implementation code.
Zed Rust source is GPL-3.0; see https://github.com/zed-industries/zed/blob/c0199504b9cce79bc27524950022ed701bc3ebd5/LICENSE-GPL.
The upstream icon notice is copied unchanged in `LICENSES`.
The developer must establish each copied app icon's license and preserve its notice, or document a Lucide substitute as allowed by the issue.
QA must approve a substitute reference before changing any geometry assertion.

The existing `../zed-themes/one.json` supplies One Dark element.selected (#454a56ff) and border.focused (#47679eff).
Pinned defaults enable file_icons and auto_reveal_entries, with folder_indicator set to icon.
The generated throwaway folder is panel-look, containing branches/nested/item-000.ts through item-089.ts, sample.ts, sample.json, sample.md, sample.rs, sample.py and sample.unknown-cod37.
All file content is invented.
