# Story #4 Zed defaults

project-panel-defaults.json is a selected-value transcription, not a complete settings file, from [Zed v1.23.2 assets/settings/default.json](https://github.com/zed-industries/zed/blob/v1.23.2/assets/settings/default.json). The raw source URL is stored in the fixture. Values were checked through the web reader because shell DNS was unavailable. Source lines 869-986 define the panel defaults; lines 1753-1765 define scan exclusions.

The default sort is directories first, case-insensitive natural ordering, lowercase first on ties. Dotfiles and gitignored files are shown; `.git` is excluded entirely. The tests avoid case-only filename pairs because macOS commonly uses a case-insensitive filesystem.

The existing [macOS keymap](../zed-keymaps/default-macos.json) and [Linux keymap](../zed-keymaps/default-linux.json) are reused without changes. Their source URLs and blob hashes are in [the keymap README](../zed-keymaps/README.md).

AC2 reference: Workspace binds Cmd+B / Ctrl+B to ToggleLeftDock and Cmd+Shift+E / Ctrl+Shift+E to project_panel::ToggleFocus. The settings put the stock panel on the right and start it open. Closed startup and a project panel in the left dock are story exceptions.

AC3 reference: ProjectPanel binds Left/Right to CollapseSelectedEntry/ExpandSelectedEntry, Enter to Rename and Space to Open in ProjectPanel && not_editing. The global keymap has Up/Down selection actions. A story asking Enter to open must explicitly record that exception.

AddFolderToProject has Cmd+Shift+A / Ctrl+Shift+A in RecentProjects, not Workspace. A workspace-wide add-folder shortcut needs a documented story exception; the panel button can exercise AC1 without inventing a global Zed binding.

Zed license: [GPL-3.0](https://github.com/zed-industries/zed/blob/v1.23.2/LICENSE-GPL).
