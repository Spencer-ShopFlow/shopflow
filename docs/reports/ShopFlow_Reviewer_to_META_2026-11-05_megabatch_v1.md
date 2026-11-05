# Reviewer to META: mega batch, Thu Nov 5 2026 (v1)

From the Reviewer (a cloud Claude Code session) for "ShopFlow Reviewer: Mega Batch, Thu Nov 5, 2026 (v1)". All code was read at fork `main` = `a25c408` (= `release10/ready`, her live code). Counts and ids only; no student data anywhere.

## 0. Start-of-work check

- **Access:** Drive read/write **yes**; punch list read **yes**; fork push **yes**. No Cowork move needed.
- **Fork refs at 2:41 PM:** `main` = `release10/ready` = `releaseR1/base` = `a25c408`; `releaseR1/ready` = `3b365da` (as the task said); `style/r1-foundation` = `a5ee0b2` (#83's head); `fix/dl8-wait-formfor` = `ac8d2f1` (#85).
- **`git ls-remote origin 'refs/pull/*'`:** the newest PR was **#85**. Nothing after #85 existed, so no open PR already covered Jobs 4–11. #83 = `a5ee0b2`, #84 = `3b365da`, #85 = `ac8d2f1`.
- **Cutover (Nov 13):** the P20 code (`feat/p20-identity-r9`, `dafd1ff`) is already an ancestor of `a25c408`, so the cutover is a data run on live code with no open cutover code branch. Handoff v26 predates the cutover plan; I took the files from the Oct 31 cutover-prep report. **No job touched `js/core/db.js`, `js/features/identity.js`, `js/features/identityMigration.js` or the pull/merge in `js/features/driveSync.js`.**
- `formImport.feedbackLogIsFor` (PR #68) **is in `a25c408`** (`js/features/formImport.js:225`, already used at `js/pages/activityDetail.js:271`).

---

## Job 1 (i344): E2's checkpoint-order questions. Status: **done** (read-only)

**Q1. Can the teacher sign checkpoint 10 or 11 while 6–9 are still open? Does the teacher's checkpoint page force order?**

**Yes, she can, and no, the page does not force order.**
- `js/pages/checkpoint.js:292-313` (`selectTeam`): every checkpoint of the assignment is drawn as its own button, sorted by number, and every button is clickable. Nothing checks whether earlier checkpoints are done.
- `js/pages/checkpoint.js:324` (`selectCheckpoint`) and the save (`checkpoint.js:625-720`): the save reads only the ticks on the open checkpoint's screen (`marks`, 643-652) and writes `checkpointCompletions` for that checkpoint only (678-711). No rule looks at other checkpoints.
- Only the display shows order. **Team Progress** (`js/pages/activityDetail.js:467-484`) calls the *first* checkpoint not finished by every team member "current": "Working on CP n". It then judges Ahead/On Track/Behind from that checkpoint's target date (493-508). So a team with CP 10 and 11 signed but CP 7 open shows "Working on CP 7", and "Behind Schedule" once CP 7's date has passed.
- Out of scope: the student-facing widget (the CP Apps Script) is not in this repository, so I could not check what order it shows to students.

**Q2. If a checkpoint is never signed, does the contract still count as finished for grading? Can skills listed only on unsigned checkpoints still be rated?**

- **The app has no "contract finished" flag.** Grading uses the checkpoint share in `calculateFinalGrade`:
  - **completion mode:** checkpoint score = signed ÷ all of the assignment's checkpoints (`js/core/utils.js:137-139`);
  - **timeliness mode:** a checkpoint signed on time counts 1, a late one 0.5, an unsigned one 0 (`js/core/utils.js:126-135`).
  - The final grade weights that by `checkpointGradeWeight` (`utils.js:116-117`), so an unsigned checkpoint lowers the grade only when that weight is above 0.
  - "✅ All Checkpoints Complete" (`activityDetail.js:513`) and the dashboard's team count (`js/pages/dashboard.js:1264-1268`) need every checkpoint signed by every member.
  - The automatic "missing work" task (`js/features/autoTasks.js:150-175`) skips a student who has a submission or grade. Otherwise it flags the student while any checkpoint is unsigned.
- **Yes, its skills can still be rated.**
  - On the checkpoint page, the "Assess Skills" button and its panel are drawn for every team member whether or not the box is ticked (`checkpoint.js:439-440`, `465`).
  - The ratings are saved separately from the tick (`checkpoint.js:712-719`).
- **For skills grading, signing never matters.**
  - The mastery engine reads no checkpoint completions (`js/features/masteryEngine.js:238-246`: the snapshot has no `checkpointCompletions`).
  - A skill listed on a checkpoint enters the whole class's opportunity set once the checkpoint's target date has passed, signed or not (`masteryEngine.js:149-153`).
  - From then on, any student with no rating on it counts as Beginning (`masteryEngine.js:183-187`, `unassessedPolicy: 'countAsBeginning'`, line 16).
- **One sentence for E2:** ShopFlow lets her sign checkpoints in any order. An unsigned checkpoint only lowers the checkpoint part of the grade (when that part has weight). Its skills can still be rated at any time, and once its target date passes those skills count for every student, as Beginning if unrated.

## Job 2 (i346): E4's "some students only" question. Status: **done** (read-only)

**Can ShopFlow assign an activity or contract to a chosen subset of a class, so it is visible and ratable only for that group? No, not inside ShopFlow.**

- **The activity record has no student or group field.**
  - Activities are indexed `name, classId, startDate, endDate, status` (`js/core/db.js:186`).
  - Nothing in `js/` stores a subset (searched for `studentIds`, `assignedTo`, `assigneeMode`, `studentEmails`).
- **Classroom can target individual students, but ShopFlow doesn't keep the list.**
  - Full Edit's "Individual students" choice collects emails (`js/pages/activities.js:2418-2423`) and sends `assigneeMode: 'INDIVIDUAL_STUDENTS'` with `studentEmails` to `create_classroom_coursework` (`activities.js:2545-2548`).
  - The choice lives only in the in-memory pending-create state (`state._classroomPendingCreate`, `activities.js:2444-2451`). It is not saved on the activity, so nothing else in ShopFlow uses it.
- **Everything else is class-wide.**
  - Skills grading builds the class from enrollments in the class's periods (`masteryEngine.js:224-236`).
  - An activity's or checkpoint's skills open for **every** student in the class on the due or target date (`masteryEngine.js:141-153`).
  - The automatic missing-work task covers every student in the class (`autoTasks.js:165`), and so does the Hub sync (`js/features/hubSync.js:108`).
- **Teams are the unit of checkpoint tracking.** The checkpoint page lists one team's members (`checkpoint.js:286-290`). A subset can be put in its own team(s) for checkpoints, but the activity still belongs to the whole class.
- **Partly there in the engine:** it accepts per-student overrides (`mastery-opportunity-{classId}` → `students[id].open/closed`, `masteryEngine.js:123-124`, `172-177`). No screen sets them (see Job 3, Q2).
- **Planned?** I found no branch or code for it. Whether it is on the Master Plan is META's to confirm.
- **Safest workaround today:**
  1. In Classroom, post to "Individual students" as now.
  2. In ShopFlow, put the subset in its own team(s) for checkpoint ticks.
  3. **Don't list the subset-only skills on the activity (`skillsAssessed`) or its checkpoints (`skillsAssessable`).** Rate them on the subset only. A rated skill enters only that student's own set (`masteryEngine.js:176`), so classmates are not counted as Beginning on it.
  4. Expect the automatic missing-work task to flag classmates outside the subset (`autoTasks.js:165-175`); dismiss those. Use a checkpoint grade weight of 0 if the subset activity is graded.

## Job 3 (i358): capstone checks for the curriculum hub. Status: **done** (read-only)

Read the task file `ShopFlow_Task_Reviewer_CapstoneChecks_v1.md`; answered here, so no separate capstone-checks report was made (META can copy this section).

**Q1. When does a skill listed on a checkpoint enter the opportunity set?**
- **On the checkpoint's own target date (`suggestedDate`), not the assignment's due date.**
  - `masteryEngine.compute`, `js/features/masteryEngine.js:149-153`: `due(c.suggestedDate || a.endDate)`.
  - "Passes" means the date is before today (`masteryEngine.js:137`: `String(date) < today`), so the skill opens the school day after the target date.
  - **A checkpoint with no target date falls back to the assignment's due date (`endDate`).**
- **A skill listed only on the assignment** (`skillsAssessed`, or a live `activitySkills` link; `masteryEngine.js:114-118`) opens on the assignment's due date (`endDate`, `masteryEngine.js:141-147`).
- **Other ways in:**
  - for one student, any rating opens the skill at once (`masteryEngine.js:176`);
  - the class config's always-open skills (`alwaysOpenSkillIds`, line 154);
  - the class override's open list (155).
- **Signing does not matter.** Completion is never read (`masteryEngine.js:238-246`).
- **The Progressbook export uses the same engine** (`js/features/progressbookExport.js:64`, `recomputeAll`).
- **The Release 10 grade-gap finder (#79) uses the same rule** when it says where to rate an unrated skill (`progressbookExport.js:170-175`: `due(c.suggestedDate || …endDate)`).
- **One sentence for the curriculum writer:** A skill named on a milestone checkpoint starts counting for the whole class the day after that checkpoint's target date (or the day after the assignment's due date if the checkpoint has none), whether or not the checkpoint is signed. From then on an unrated student counts as Beginning.
- **Against the spec:** this matches the engine's own §6 comment (`masteryEngine.js:110-113`).

**Q2. Is the grading spec's per-student override (closing a skill for one student) built?**
- **In the engine, yes. On screen, no.**
  - `compute` takes `overrides = { open: [skillIds], closed: [skillIds], students: { [studentId]: { open: [], closed: [] } } }` (`masteryEngine.js:121-124`).
  - It applies a student's `closed` after everything else, so it wins over the date rule and over the student's own ratings (`masteryEngine.js:172-177`). It also leaves that student out of the professional-skill "missing rating" flag (`209-210`).
  - The overrides come from the settings row `mastery-opportunity-{classId}` (`masteryEngine.js:249-251`).
  - **Nothing in the app writes that row.** It is read in `masteryEngine.js` and only translated by the cutover (`js/features/identity.js:145`, `447-456`). There is no screen, button or import for it.
- **The other overrides:**
  - **class-wide open/closed per skill:** same row, same state (engine yes, screen no);
  - **always-open skills:** `alwaysOpenSkillIds` in `mastery-config-{classId}` (`masteryEngine.js:22`, `39`, `154`), engine yes, screen no;
  - **per class:** skills grading on/off and its mode (`mastery-mode-{classId}`, `js/core/utils.js:440-449`), set by the Settings > Classes card toggle (`js/pages/settings.js:652`). This one has a screen.
  - **Per student:** only the `students` part of `mastery-opportunity-{classId}`, and it has no screen.
- **One sentence:** The grading engine already honors a per-student "close this skill" override (for an extended absence or IEP), but ShopFlow has no screen to set one yet, so for now it can't be used without a build.
- **Against the spec:** §6's "either direction" is met in the engine (open and closed, class and student); the missing part is the screen.

---
