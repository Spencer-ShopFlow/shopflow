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

## Full-suite counts (all New York time zone, run after noon New York time, one suite at a time)

Base `a25c408`: **158 passed, 0 failed**; static checks pass; ESLint check pass (0 undefined names, 67 unused variables, not failed). Setup: Playwright (pre-installed Chromium), Dexie 4.0.8 from the Dexie.js git tag, ESLint 9.39.5 from npm. Every new test below was also run on the base code (code stashed, test kept) and failed there.

| Job | PR | Head | New tests | Full suite on head | Static / ESLint |
|---|---|---|---|---|---|
| 4 R1 | #84 (`releaseR1/ready`), #83 (`style/r1-foundation`) | 08b01f9 / e628a23 | 1 (+ the i304 grey) | 164 passed, 0 failed | pass / pass |
| 5 i331 | #86 | c4cd901 | 1 | 159 / 0 | pass / pass |
| 9 i079 | #87 | c004e24 | 1 | 159 / 0 | pass / pass |
| 6 i337 | #88 | 43b1407 | 1 | 158 / 1: DL8 only (the flake #85 fixes; DL8 alone 2 of 3 passed) | pass / pass |
| 10 i111 | #89 | 11e2d5f | 1 | 159 / 0 (re-run; the first run was cut off by a time limit) | pass / pass |
| 8 i334 | #90 | 4f904fa | 2 | 159 / 1: DL8 only (the same flake) | pass / pass |
| 7A i335 | #91 | 680f39e | 3 | 161 / 0 | pass / pass |
| 7B i375 | #92 | ae86e40 | 5 | 163 / 0 | pass / pass |

Expected head count = 158 + new tests (R1: 158 + 5 R1 tests + 1 new = 164). CI (`smoke.yml`: smoke + static + ESLint) runs on every PR; results in "CI" below.

## Job 4 (i357, i354): Release R1 fixes. Status: **done (code, checklists, screenshots); staging step not taken, by this task's rule**

- **PRs updated in place, not replaced:** #83 (`style/r1-foundation` → `releaseR1/base`) head **e628a23**; #84 (`releaseR1/ready` → `main`, draft, do not merge) head **08b01f9** (was 3b365da). Both PR descriptions now lead with the Nov 5 changes; the Oct 31 text is in each PR's edit history.
- **Fix 1 (contrast)** and **fix 2 (matrix font):** commit **e628a23**. `css/base.css` line 108 `--color-text-tertiary: var(--bp-muted);` (`--bp-disabled` kept, unused); `css/pages.css` `#skills-matrix select { font-family: var(--font-family-display); }`; the i304 test's grey is `rgb(94, 90, 82)`. New test "R1 fixes (i357): …" checks the dropdown font, that all four level words fit the box, and the hint colour. On the old CSS it fails ("matrix dropdown font: Arial"), and the i304 test fails on the old grey; both pass on the head.
- **Fix 3 (#85 folded in):** merged into `releaseR1/ready`: 6efeedf (PR #83's fixes, `--no-ff`) and **08b01f9** (`fix/dl8-wait-formfor` ac8d2f1, `--no-ff`). Cache stays **esb-v131**. **Newest commit: 08b01f9.**
- **File count: 16, not 15.** `css/pages.css` is new to R1, because fix 2's rule lives there (#85 touches only `tests/smoke.mjs`, already in R1). The checklist's G2 says 16. META: either accept 16, or move the one rule into `css/base.css` to get back to 15.
- **Tests on 08b01f9:** New York **164 passed, 0 failed**; Tokyo (`TZ=Asia/Tokyo` plus the browser time zone, a local uncommitted harness edit) **161 passed, 3 failed: the known three (0-08, 3-02, i295); 160/3 on Oct 31, plus the new test**. Static checks and ESLint pass.
- **CI on #84: smoke success** (run 42097722037, 19:50–19:57 UTC, head 08b01f9). CI on #83: smoke success.
- **Fix 4 (screenshots):** `docs/r1-screenshots` commit **383a018**, `r1/R1_skillsmatrix_after_draft_v2.png` (the full words "Beginning / Developing / Proficient / Advanced" in every box; "Developing" 46.5 px) and `r1/R1_hinttext_after_draft_v2.png` (Notes tab "No notes yet." in rgb(94, 90, 82)). Fake data, iPad landscape 1080×810 at 2×, Chromium.
- **Fixes 5–12 (checklists), new files in ShopFlow_Ilias:**
  - `R1_Staging_Look_draft_v2.md` (7,321 bytes, id 18gtT2uvWNQG7znYVXnH9btv3EBrYBHja). Fix 5 says: staging serves **Release 10 (esb-v130, fork `main` a25c408) as of Thu Nov 5**, and R1 reaches staging only when META moves the fork's `main`. Fix 6 adds steps D1–D2 (Drive in Safari, then Replace All at the staging address only). Fix 7 rewrites L2; fix 8 rewrites L4. All dates read "to be set (after the Nov 13 cutover)". Beyond the list: L2 now says to read the line starting "App version:", because the card's first line is "ShopFlow data check (counts only)…".
  - `R1_Release_Checklist_draft_v2.md` (18,677 bytes, id 1Sl6e3RpAkHVcED5n-ODCV1zc4--DLg51): fixes 9–12, as listed:
    - G3 and "At the top" give 08b01f9; G2 gives 16 files, with a note;
    - a #85 / i354 row, and #85 under "Not different";
    - Release 10's "If something goes wrong" table, adjusted to esb-v130/v131;
    - S0a/S0b, each with a STOP;
    - Part 8 corrected (the s690 line, no "Beginnin/Developi" line, "grey hint text is now darker");
    - every date "to be set (after the Nov 13 cutover)".
    Every quoted on-screen string was checked against the code at 08b01f9.
  - `R1_staging_fake_roster_draft_v1.json` (67,832 bytes, id 1BDUUY-5Nge2oksCIbPNsAjPLiZFSuZ-K).
    - **Contents:** 16 invented students (`@example.test` only), 2 classes, 3 assignments, 8 skills with 103 skill levels, and 128 attendance rows. No webhooks or token; one settings row.
    - **How it was made:** it is the output of the app's own `buildExportData()`, unencrypted. Import accepts an unencrypted file, so no password is needed.
    - **Proof:** in a fresh browser it was loaded through "📤 Import JSON", then the real "Replace All". All three tables showed rows, with no page errors.
- **Could not check:** whether the iPad's staging copy already has a fake roster (no access to it). The v2 look assumes it doesn't.
- **Part 3 (fast-forward `main`) not done:** this task overrides the Oct 31 permission. The fork's `main` is still a25c408, so staging still serves esb-v130. #85 stays open; it will show as merged when `main` moves.
- **For META:** if staging sync is on when she does Replace All on staging, the fake data uploads to the staging Drive copy. That's harmless (fake), but the look should say "staging sync off" if that matters.

## Job 5 (i331): feedback "Sent" exact match. Status: **done, PR #86**

- Head **c4cd901**. Files: `js/pages/students.js` (Assignments tab), `js/pages/settings.js` (CSV "Feedback Sent"), `tests/smoke.mjs`.
- **Confirmed:** `formImport.feedbackLogIsFor` (PR #68) is in a25c408 (`js/features/formImport.js:225`).
- **Fix:** both places now call `formImport.feedbackLogIsFor(n, activity)`: `activityId` when present, else the quoted name, so older logs still match their own assignment. Display only.
- **Test:** "i331: feedback Sent badge and CSV column match the exact assignment …". Fake Lab 1 / Lab 10, with feedback only for Lab 10 (a new log and an older name-only log).
- Base 0/1, head 1/1. With settings.js reverted alone, the CSV assertion fails (Lab 1 read Yes/No/Yes/No). The i226 tests still pass.

## Job 6 (i337): Google Drive Sync first in Settings > Data. Status: **done, PR #88**

- Head **43b1407**. `index.html`: the whole card, with its comment, moved to be the first child of `#settings-tab-data`. The same 71 lines are removed and added, and nothing inside them changed. Plus one test.
- Nothing depended on the order. Tests and code find these cards by id, and there are no nth-child selectors between Data cards.
- **Test:** "i337: Google Drive Sync is the first section in Settings > Data". Base 0/1, head 1/1. The Data check, i304, s390 and Upload-only tests still pass (9/9).
- **Screenshots** (fake data), branch **`docs/i337-screenshots`** commit **2f09b93**, folder `docs/screenshots/i337/`:
  - before and after at 1366×768 (plus a full-page shot) and 1920×1080 (Chromium);
  - iPad (gen 7) portrait and landscape.
  - Checked by eye: Drive Sync is first and Data check follows, with no overlap at any size. The rail looks blank at iPad portrait because the icon library is stubbed in tests; the base looks the same.

## Job 7 (i335, i375 (a)(b)): know right away when students fall behind. Status: **done, two PRs: #91 (7A), #92 (7B)**

### PR #91 (7A): "Behind" list and start-of-class pop-up. Head **680f39e**

- **Files:** new `js/features/behindList.js`, `js/pages/dashboard.js`, `index.html`, `css/pages.css`, `sw.js` (the new file in the precache list; no `CACHE_VERSION` change), `tests/smoke.mjs`.
- **List** (dashboard card "⏰ Behind"): grouped by class period (`period-year-map`; Wildcat skipped). It comes from `behindList.compute`, which is pure-read.
  - **(i) Missing work:** a graded assignment at least one school day past its due date, where the student has no submission, or one still not-started or in-progress. Or: the assignment has a Google Form, isn't graded yet, and no form response is on file.
  - **(ii) Teams late:** an open assignment with a checkpoint past its target date and no tick from any team member, e.g. "CP 2 Prototype was due Tue: 1 school day late" (earliest late checkpoint, plus "+N more").
- **Rules:**
  - **school days only:** the existing `getSchoolDayPosition` and the no-school calendar (weekends, holiday, break and no-school days skipped; delay days count);
  - **skipped:** students absent today, archived and deleted students, and old-year enrollments;
  - **graded assignments only.**
- **Pop-up:** shown the first time each class period is current today. The trigger is the dashboard's existing one-minute `updateCurrentPeriod` tick (the single s380 timer), so it still shows once if she opens the app mid-period.
  - Once per period per day, remembered in localStorage `behind-popup-shown` (this device only, not synced); dismissible.
  - Never on no-school days, over the PIN screen, or over another open window.
- **Privacy:** the card and the pop-up open with **counts only** ("Period 1 · class: 2 missing, 1 team late"). Names appear only after **Show names**, and every re-render hides them again. **No projector or privacy mode existed** (searched for privacy, projector, presentation and hideNames), so this toggle is new.
- **Alerts:** **adds 0**. It's a card, not the alerts table, so the open-alert cap is unaffected.
- **Tests:** 3 `i335:` tests (compute rules; school-day lateness; card and pop-up counts-only and once per period, including the PIN lock). Base 0/3, head 3/3. The `dashboard:` and `alerts (i261)` tests pass (9/9).
- **For META:**
  - **"Graded" isn't a stored field.** Here it means points or rubric scoring, a points value above 0, a Google Form, or a Classroom link (`behindList.isGradedActivity`). Please confirm.
  - **There is no "excused" attendance status** (only present, late, absent and unmarked). 'excused' is skipped if one is added later.
- **Classroom turn-in state: not built.** It isn't stored locally. **Webhook proposal** (a paste for later, not built):
  - **New action:** `check_classroom_submissions { token, courseId, courseWorkId }`, with the ids from `activity.classroomLinks`.
  - **Classroom call:** `courses.courseWork.studentSubmissions.list`.
  - **Returns:** `[{ email, state (TURNED_IN | RETURNED | CREATED | RECLAIMED_BY_STUDENT), late, updateTime }]`.
  - **App side:** call it during Check Submissions and match students by email (as formImport does). Store `classroomState`, `classroomLate` and `classroomCheckedAt` on the submission. TURNED_IN or RETURNED raises a not-started or in-progress status to 'submitted'.
  - **Before building:** no Dexie version change is needed, but the new fields need the identity-registry check, and this should wait until after the Nov 13 cutover.
- **Noticed, not fixed:**
  - `js/ui/modals.js` around line 1286: the non-instructional-day warning reads `ni.date`, but those rows store `ni.start`, so the warning never fires.
  - `activity.classPeriods` is saved but used nowhere.

### PR #92 (7B): automatic checkpoint target dates. Head **ae86e40** (on d45abb7; squash on assembly)

- **Files:** `js/core/utils.js` (new `nthSchoolDayDate`), `js/pages/settings.js` (contract import, `contractPlanDays`), `tests/smoke.mjs`.
- **Format:** Steps_Roles_Banners_Reference_v3 §3/§3a and the Nov 2 day-list report, the same rules as the student day list.
  - Each `kind: "endOfDay"` step (exact) closes a day. Days are numbered in order, not by the title's number.
  - Steps after the last banner make one more day.
  - The n-th `kind: "checkpoint"` step places guide checkpoint n (by position, as re-import matches checkpoints). `afterStep` is not used.
  - A guide with no `endOfDay` step has no plan.
  - The first worker draft guessed a different format; I caught it and had it rebuilt on the reference.
- **Dates:** day 1 = the start date, or the next school day after it. Weekends and no-school days are skipped; delays count (the same as `getSchoolDayPosition`).
- **Only blanks are filled.** Dates she set, dates in the guide, and dates the guide clears (#35) are never changed. **Re-import behaviour for existing dates is unchanged:** the Release 9 and i313 guard tests pass (14/14 on the related filters).
- **A checkpoint with no matching day** (no n-th checkpoint step) is **left blank**. It is counted in the import summary ("N checkpoints with no day in the plan (left blank)") and named under the import box.
- **First import of a new assignment fills nothing.** The importer's start date is then only today's placeholder, and dates counted from it would look hand-set. The summary asks her to set the start date and import again; re-import fills the blanks. This is a one-line change if META wants first-import filling.
- **Tests:** 5 `i375:` tests on guides in the real shape (including a wrongly capitalised `EndOfDay`, a misleading title number, a trailing day, a stored plan on re-import, and no banners). Base 0/5, head 5/5.
- **For META to confirm:**
  - checkpoint n pairs with the n-th checkpoint step (the widget doesn't link them);
  - dates aren't capped at the assignment's end date;
  - auto-filled dates aren't marked and aren't recomputed if she later moves the start date.

## Job 8 (i334): printable student progress report. Status: **done, PR #90 (ships only after her yes)**

- **Head and files:** **4f904fa**. New `js/features/progressReport.js`, `js/pages/students.js` (the button), `index.html`, `css/pages.css` (print CSS), `sw.js` (precache list +1; no cache bump), `tests/smoke.mjs`.
- **What it shows:** a "Print progress report" button on the student page opens a sheet, and Print uses `window.print`. Print CSS hides all app chrome, and the PIN lock hides the sheet.
  - **Each rated skill:** current level (the engine's `scoreHistory`) and the trend, oldest first with dates.
  - **The two category marks:** the same calls as the Progressbook export (`masteryEngine.recomputeAll` + `progressbookExport.mark`).
  - **The three lowest skills** (ties by name, then id), each with the next level's descriptor by skill id, or a fixed sentence.
  - **An optional one-line comment**, never stored.
- **No AI, no charts. Writes nothing:** the test checks that table counts, database contents and localStorage are the same before and after.
- **Screenshot** (fake data, print media): checked by eye; only the sheet prints.
- **Tests:** 2 `i334:` tests; base 0/2, head 2/2.
- **For META:**
  - "Current level" is the engine's level, not the latest rating; is that what she wants on the printout?
  - The descriptor lookup is by skill id only (no name fallback).
- **The trend chart was not added.** All of Jobs 1–7 were done, but I kept v1 text-only to leave time for verification. It can be added in a follow-up.

## Job 9 (i079): equipment importer edge cases. Status: **done, PR #87**

- **What had already shipped:** the **"Update existing equipment (preview first)"** path, `b6ae932` (#64, **Release 8**, i300), already handled both cases. A row with no name is listed as skipped; a name twice in the file is listed as a duplicate and not changed.
- **What hadn't:** the older **"🔧 Import Equipment" (JSON)** button (`importEquipment`, `js/pages/settings.js`) still had both bugs on a25c408.
  - A nameless row threw on `item.name.toLowerCase()` and stopped the import part-way, with the earlier rows already added.
  - A name listed twice was added twice.
- **Fix (head c004e24):**
  - rows with a blank name are skipped and counted in the toast;
  - names match ignoring case and spaces;
  - the first row wins, and later ones are skipped as duplicates.
- **Test:** "i079: 'Import Equipment' skips a row with no name …". Base fails (the import stopped after the first row); head passes. The i300 tests pass.
- **Noticed, not fixed:** `importEquipment` counts deleted items as existing names, and it has no transaction or safety snapshot.

## Job 10 (i111 part 3): Classroom title after a skill rename. Status: **done, PR #89**

- **Head and files:** **11e2d5f**. `js/pages/skills.js`, `js/ui/toasts.js` (new `ui.showActionToast`), `js/ui/guards.js` (1 line), `tests/smoke.mjs`.
- **What it does:** the webhook already has `update_classroom_coursework` (used at `js/ui/modals.js:1130` and `js/pages/activities.js:2485`).
  - After a rename of a skill with `classroomLinks`, a 20-second toast says Classroom still shows the old title and offers **Update title in Classroom** (one tap, never automatic).
  - The tap reads the assignment (`list_classroom_coursework`), then updates it with the new title and the points Classroom already has, so the points can't be reset.
  - Any failure, or no webhook, gives a plain "rename it in Classroom by hand" message.
- **Test:** "i111: renaming a skill …"; fails on base, passes on head.
- **For META:**
  - The brief says grades already reach this assignment, but the i301 commit (ea2bf55) says nothing in the app writes grades to skill assignments. Please check.
  - The Apps Script source isn't in the repo. If it always puts `maxPoints` in `updateMask`, an assignment with no points could be cleared; a safe script change is to build the mask only from the fields sent.

## Job 11 (i360): close the 23 shipped PRs. Status: **done**

- **Release 8 (her PR #12, 08561c8):** #57–#70, 14 PRs. **Release 9 (her #13, 63cd64d):** #72–#75, 4 PRs. **Release 10 (her #14, a25c408):** #77–#81, 5 PRs. Total 23.
- **How each was matched:** by `git merge-base --is-ancestor` of the PR head against `release8/ready`, `release9/ready` and `release10/ready`. Her PR heads were read with a read-only `git ls-remote` of her repo: #12 = 08561c8, #13 = 63cd64d, #14 = a25c408.
- **What was done:** each got the comment "Shipped in Release n (her PR #…)" and was closed. All 23 matched; none skipped.
- **Still open, untouched (outside this job):** #85 (folded into R1; shows as merged when `main` moves), #27, #30, #45, #51, and this batch's #83, #84, #86–#92.

## CI

CI (`smoke.yml`: smoke, static checks, ESLint) on each PR's head:
- **#83, #84, #87, #89, #90, #91, #92: green on the first run.**
- **#86 and #88: red on the first run, green on re-run.** The only failure was the DL8 test ("Classroom link after a failed save"), the known flake #85 fixes. These branches start from a25c408, which doesn't have #85. I re-ran the failed job (no new commit); both went green.
- **Expect the same DL8 flake on any branch from a25c408 until #85 ships with R1.** Full-suite DL8 failures above: j6 and j8, once each, locally.

## Not done and why

- **Job 4, Part 3 of the Oct 31 file:** the fast-forward of the fork's `main` to R1 was not done. This task says not to; META decides after review. Staging stays on esb-v130.
- **Job 4, fix 6:** the iPad's staging copy wasn't inspected (no access). The fake roster file is provided on the assumption that it's empty.
- **Job 7A:** Classroom turn-in state was not built; it needs a webhook change (proposal above).
- **Job 8:** no trend chart (optional, not added). Shipping waits for her yes, by rule.
- **No pushes to `main`, nothing merged, and nothing touched in SpencerDJHS/shopflow** (read-only `ls-remote` only).

## Assembly notes for Release 11 (META)

- #90 (8) and #91 (7A) both add to `css/pages.css`, `index.html` and the `sw.js` precache list, so expect small conflicts when assembling. All PRs branch from a25c408. #84 (R1) touches `css/pages.css` too.
- No PR changes `js/core/db.js`, `js/features/identity.js`, `js/features/identityMigration.js` or `js/features/driveSync.js` (cutover-safe). None bumps `CACHE_VERSION` except R1's existing esb-v131.

## Punch-list lines

Appended to each item's note (pinned with if_version) as written below. If an append failed, it is marked here, and tonight's run should add it.

- **i344:** `Nov 5, 3:52 PM · reviewer: DRAFT READY: answer in ShopFlow_Reviewer_to_META_2026-11-05_megabatch_v1.md §Job 1.`
- **i346:** `Nov 5, 3:52 PM · reviewer: DRAFT READY: answer in ShopFlow_Reviewer_to_META_2026-11-05_megabatch_v1.md §Job 2.`
- **i358:** `Nov 5, 3:52 PM · reviewer: DRAFT READY: answer in ShopFlow_Reviewer_to_META_2026-11-05_megabatch_v1.md §Job 3.`
- **i357:** `Nov 5, 3:52 PM · reviewer: DRAFT READY: PR #84 (releaseR1/ready 08b01f9; #83 e628a23; 12 fixes, #85 folded in; 16 files; 164/0 NY, 161/3 Tokyo; CI green; main not moved), ShopFlow_Reviewer_to_META_2026-11-05_megabatch_v1.md.`
- **i354:** `Nov 5, 3:52 PM · reviewer: DRAFT READY: PR #84 (#85 merged into releaseR1/ready at 08b01f9), ShopFlow_Reviewer_to_META_2026-11-05_megabatch_v1.md.`
- **i331:** `Nov 5, 3:52 PM · reviewer: DRAFT READY: PR #86, ShopFlow_Reviewer_to_META_2026-11-05_megabatch_v1.md.`
- **i337:** `Nov 5, 3:52 PM · reviewer: DRAFT READY: PR #88, ShopFlow_Reviewer_to_META_2026-11-05_megabatch_v1.md.`
- **i335:** `Nov 5, 3:52 PM · reviewer: DRAFT READY: PR #91, ShopFlow_Reviewer_to_META_2026-11-05_megabatch_v1.md.`
- **i375:** `Nov 5, 3:52 PM · reviewer: DRAFT READY: PR #91 (a), PR #92 (b), ShopFlow_Reviewer_to_META_2026-11-05_megabatch_v1.md.`
- **i334:** `Nov 5, 3:52 PM · reviewer: DRAFT READY: PR #90, ShopFlow_Reviewer_to_META_2026-11-05_megabatch_v1.md.`
- **i079:** `Nov 5, 3:52 PM · reviewer: DRAFT READY: PR #87, ShopFlow_Reviewer_to_META_2026-11-05_megabatch_v1.md.`
- **i111:** `Nov 5, 3:52 PM · reviewer: DRAFT READY: PR #89 (part 3), ShopFlow_Reviewer_to_META_2026-11-05_megabatch_v1.md.`
- **i360:** `Nov 5, 3:52 PM · reviewer: DRAFT READY: all 23 closed with "Shipped in Release n (her PR #…)"; none skipped; ShopFlow_Reviewer_to_META_2026-11-05_megabatch_v1.md §Job 11.`
