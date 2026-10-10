# Story #5 editor samples

All samples use invented orchard data.
sample.ts, sample.js, sample.py, sample.go, sample.rs, sample.md and sample.json cover AC1's seven languages.
scratch.txt contains a single line without a final newline so exact keyboard edit and disk-save assertions have no newline-policy ambiguity.

The automatic fixture copies the existing orchard and harbor projects to a fresh temporary directory for every test, then overlays these samples in each project root and runs real git init.
All edits and saves target those copies.
The temporary directories are removed after Electron closes, and COD_TEST_PICK_FOLDERS is restored.
No tracked fixture is edited by the test.
