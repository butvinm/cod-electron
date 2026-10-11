# Zed permission mode reference

mode_selector.rs is copied byte for byte from Zed v1.23.2 at commit c0199504b9cce79bc27524950022ed701bc3ebd5.
Source: https://github.com/zed-industries/zed/blob/c0199504b9cce79bc27524950022ed701bc3ebd5/crates/agent_ui/src/mode_selector.rs
Git blob SHA: 46c1543bd25e0efd8506be71c1f467cd3f8a15e7.
License: https://github.com/zed-industries/zed/blob/v1.23.2/LICENSE-GPL

The source cycles to the next mode with wraparound, displays the current mode name on a small muted button with a chevron, and opens a menu marking the selected mode.
The existing byte-for-byte tests/fixtures/zed-keymaps/default-macos.json pins shift-tab -> agent::CycleModeSelector in the agent composer contexts.
The four Claude mode names and their order come from issue #33, rather than Zed's provider-dependent list.
Stock Zed could not be launched in this sandbox.
Compare the AC1 composer-mode-look-check screenshot beside stock Zed's agent composer before accepting the look.
