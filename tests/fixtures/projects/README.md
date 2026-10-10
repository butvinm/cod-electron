# Story #4 project folders

All content is invented. Copy orchard and harbor into a fresh temporary directory for each scenario. Run real `git init --quiet --initial-branch=main` in each copied root, so `.git` exists without storing nested Git metadata in this repository. No commits or user identity are needed.

The orchard folder deliberately mixes uppercase and lowercase names, directories and files, dotfiles, a gitignored file and numbered names. Its alpha directory has two files to avoid compact single-directory folding. The harbor folder provides a second root and a separate workspace state.

The ignored.txt file is deliberately ignored by the fixture's .gitignore. Stage it explicitly with `git add -f tests/fixtures/projects/orchard/ignored.txt` when committing the tests outside the sandbox.
