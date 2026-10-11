# Zed centered controls reference

Story #38 uses stock Zed 1.23.2, commit c0199504b9cce79bc27524950022ed701bc3ebd5.
close.svg is copied byte for byte from the read-only source checkout.
Source: https://github.com/zed-industries/zed/blob/c0199504b9cce79bc27524950022ed701bc3ebd5/assets/icons/close.svg

The pane builds its close control with IconName::Close in crates/workspace/src/pane.rs:3021-3031.
The finder builds a horizontal label pair inside a ListItem in crates/file_finder/src/file_finder.rs:2186-2200.
The filename uses the normal label size and the path uses LabelSize::Small at lines 1407-1411.
These source observations do not replace the required screenshots from stock Zed.
