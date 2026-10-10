# Zed keymap reference

These are unmodified copies of Zed v1.23.2. They are JSON with comments and trailing commas, parsed with TypeScript's JSONC parser in the test helper.

| File | Source URL | Git blob SHA |
| --- | --- | --- |
| default-macos.json | https://raw.githubusercontent.com/zed-industries/zed/v1.23.2/assets/keymaps/default-macos.json | 38ce1ab5aad9ae99a24cf22f1b13f7ad174cdc86 |
| default-linux.json | https://raw.githubusercontent.com/zed-industries/zed/v1.23.2/assets/keymaps/default-linux.json | 8f05d55e2ac8569e95bfaddd02147ad590254540 |

Source repository: https://github.com/zed-industries/zed/tree/v1.23.2/assets/keymaps

Zed is licensed under GPL-3.0: https://github.com/zed-industries/zed/blob/v1.23.2/LICENSE-GPL

The AC3 test checks all contexts on both platforms, including bindings with null actions and first strokes of multi-stroke chords. Modifier order is normalized before comparison.
