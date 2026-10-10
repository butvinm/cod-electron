---
name: plan-iteration
description: PM procedure for Cod's daily cycle and stakeholder meetings. Keep a ranked queue of ready stories, run the team on its own between meetings, and at each meeting demo what finished, get accept/reject, answer escalations and get the next pick. Use when the stakeholder opens a session, when choosing the next story, or when deciding whether something needs the stakeholder.
---

# Plan and run the daily cycle

An iteration is one day. There are no weekly sprints. The stakeholder meets the PM, the team works on its own until the next meeting, and every accepted story ships the same day.

## The queue

The queue is a pinned issue titled `Queue`. Its body is the ranked list of story issues, most valuable to daily use first:

```
Ranked by value to daily use. The team works top down.
1. #<n> <title> (S) - <one plain sentence on why it matters>
2. ...
Waiting for acceptance: #<n>, ...
```

- Keep at least two ready stories (criteria and size set, see `write-story`) at the top, so the team never waits for a meeting.
- Put a "look check" story early when the look of a new area has not been confirmed.
- Update it with `gh issue edit <queue> --body-file <file>` whenever the order or state changes.

## Between meetings: work alone

1. Take the top unstarted story and drive it through the workflow in `AGENTS.md`: QA tests PR -> developer PR -> reviewer -> CI -> clip. Run independent stories in parallel when they own different files.
2. Keep each agent task under about 20 minutes with a checkpoint. If a task runs long, stop it, read its last checkpoint and split the rest.
3. Keep one owner per file: before a handoff, check no other open task owns the same files.
4. Spot-check, do not redo: open one test and one diff per story and compare them with the criteria.
5. Decide technical questions and product details that fit `docs/vision.md` yourself. Record the decision in the issue or PR.
6. Escalate only these, as an issue labeled `stakeholder` with a default ("If I don't hear back, I will ..."): a change to the vision or scope, spending money, anything public about the stakeholder or their employer, and anything that cannot be undone. Then continue with unblocked work.

## Meeting

A meeting happens when the stakeholder opens the PM session, at most once a day unless they ask for more. Keep it under about 15 minutes. Agenda:

1. Demo: for each story that reached "clip PASS" since the last meeting, the `report-to-stakeholder` report. Ask to accept or reject each one.
2. Accepted: close the issue. Rejected: reopen the work with the stakeholder's words as a new criterion or comment.
3. Escalations: go through the open `stakeholder` issues. Record each answer on its issue and close it.
4. Next: show the top of the queue and take the stakeholder's pick, reorder or cuts.
5. Obligations: state what will be ready for the next meeting. Each one is either delivered then or comes with a written reason and the next step. No "almost done".

## Releases

Accepted stories merged to `master` are the release. From the first version the stakeholder uses daily (0.0.1) onwards, end each day with accepted stories with a tag `v0.0.<n>` and a release note listing them (`gh release create`).

## Output format

```
Since last meeting
| Story | Result | Clip | PR |
| --- | --- | --- | --- |
| #<n> <title> | ready for acceptance / not done: <reason> | <link> | <link> |

Questions (#<issue> each):
1. <question>? If I don't hear back, I will <default>.

Next (from the queue):
1. #<n> <title> (S) - <why>
2. ...
Ready by next meeting: <stories>. Please pick, reorder or cut.
```
