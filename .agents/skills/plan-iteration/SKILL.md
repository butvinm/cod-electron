---
name: plan-iteration
description: PM procedure for Cod's weekly rhythm. Monday - propose stories and get the stakeholder's pick. During the week - track the board and keep agents unblocked. Friday - a demo from clips. Use at the start of a week, when checking progress, or at the end of a week.
---

# Plan and run an iteration

An iteration is one week. The stakeholder chooses, the PM runs it, the team delivers, Friday shows it.

## Monday: proposal and pick

1. Read the board: `gh issue list --label story --state open --json number,title,labels` and last week's leftovers.
2. Pick 5-8 candidate stories, ordered by value to daily use. Make sure each has acceptance criteria and a size (otherwise run `write-story` first). Put a "look check" story early if the look of a new area has not been confirmed.
3. Send the stakeholder a short proposal:

   ```
   Week of <date>. Proposed (most valuable first):
   1. #<n> <title> (S) - <one plain sentence on why it matters>
   2. ...
   Capacity guess: about <k> stories.
   Please pick, reorder or cut. Questions: <numbered or "none">
   ```

4. Record the pick: move picked issues to "This week" on the board and add a milestone `week-<YYYY-MM-DD>` (`gh issue edit <n> --milestone <name>`).

## During the week: track

For each picked story, drive it through the workflow in `AGENTS.md`: QA tests PR -> developer PR -> reviewer -> CI -> clip. Daily:

1. Check the board and open PRs: `gh pr list`, `gh pr checks <pr>`.
2. Keep each agent task under about 20 minutes with a checkpoint. If a task runs long, stop it, read its last checkpoint and split the rest.
3. Keep one owner per file: before a handoff, check no other open task owns the same files.
4. Spot-check, do not redo: open one test and one diff per story and compare them with the criteria.
5. When blocked on the stakeholder, batch questions into one short message instead of asking one at a time.

## Friday: demo

1. For every story that reached "clip PASS", run `report-to-stakeholder`.
2. Put the clips in the order of the week's pick into one message: story title, clip link, PASS/FAIL table.
3. List what did not finish and why, in one line each.
4. Ask the stakeholder to accept or reject each story. Close accepted issues; move rejected ones back with the stakeholder's words as a new criterion or comment.
5. Write a three-line retrospective on the milestone: what went well, what hurt, one change for next week.

## Output format

Monday: the proposal above. Friday:

```
Week of <date> demo
| Story | Result | Clip | PR |
| --- | --- | --- | --- |
| #<n> <title> | ready for acceptance / not done: <reason> | <link> | <link> |
Retro: <well> / <hurt> / <change>
```
