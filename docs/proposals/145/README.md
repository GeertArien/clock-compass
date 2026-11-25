# #145 proposal: screenshots and prototype

Not for merging. This branch holds the screenshots for the proposal on #145
and the prototype that made them. The implementation PR starts from `main`.

- `main-*`: what `main` shows today.
- `a-*`: option A, the card shows the task as it would be after Confirm.
- `b-*`: option B, the live card, labelled "As it is now" and read-only.

Each set covers `updateTask` (yearly), `setBigRock` (rock), `acceptWeekPlan`
(plan), `scheduleTask` (sched) and `setTaskDone` (done), at phone width (390 px)
and, for the yearly case, desktop width (1280 px).
