// ============================================
// ShopFlow smoke tests (fake data only)
// Run:  node tests/smoke.mjs            (all tests)
//       node tests/smoke.mjs attendance (only tests whose name contains "attendance")
// ============================================

import { run, openApp, seedFakeData, assert, WebhookStub, waitForStartup } from './harness.mjs';

const PAGES = ['dashboard', 'students', 'teams', 'activities', 'inventory', 'calendar', 'tasks', 'progress', 'skills', 'settings'];

// Page errors that come from our own test stubs, not from the app.
const IGNORED = [/phosphor/i];
const real = errs => errs.filter(e => !IGNORED.some(r => r.test(e)));

const tests = [
    {
        name: 'boot: the app opens with an empty database and no script errors',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const visible = await page.isVisible('#page-dashboard');
            assert(visible, 'dashboard is not visible after boot');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'navigation: every sidebar page renders with fake data and no script errors',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await seedFakeData(page);
            for (const p of PAGES) {
                await page.evaluate(pg => router.navigate(pg), p);
                await page.waitForTimeout(250);
                assert(await page.isVisible(`#page-${p}`), `page ${p} not visible`);
            }
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'import: the fake roster loads through Settings → Import JSON → Replace All',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await page.evaluate(() => router.navigate('settings'));
            await page.setInputFiles('#import-file-input', new URL('./fixtures/fake-roster.json', import.meta.url).pathname);
            await page.waitForSelector('#import-replace-btn', { state: 'visible' });
            await page.click('#import-replace-btn');
            await page.waitForFunction(() => db.students.count().then(n => n === 20), null, { timeout: 10000 }).catch(() => {});
            const n = await page.evaluate(() => db.students.count());
            assert(n === 20, `expected 20 fake students after import, found ${n}`);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'sync: two fake devices exchange data through the stubbed Drive webhook',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'drive-sync-enabled': 'true', 'drive-sync-password': 'test-sync-pass', 'automations-enabled': 'true' };
            const a = await openApp(browser, base, { stub, localStorageInit: ls });
            await seedFakeData(a.page);
            await a.page.evaluate(async () => { driveSync._dirty = true; await driveSync.push(); });
            assert(stub.callsFor('save_to_drive').length >= 1, 'device A did not upload');
            // Device B pretends to be the iPad by pulling the "PC" file.
            const b = await openApp(browser, base, { stub, localStorageInit: ls });
            await b.page.evaluate(() => {
                Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' });
            });
            await b.page.evaluate(async () => { await driveSyncPull.checkOnLoad(); if (driveSyncPull.applyPending) await driveSyncPull.applyPending(); });
            await b.page.waitForTimeout(500);
            const count = await b.page.evaluate(() => db.students.count());
            assert(stub.callsFor('load_from_drive').length >= 1, 'device B did not download');
            assert(count === 4, `device B has ${count} students after sync, expected 4`);
            await a.context.close(); await b.context.close();
        }
    },
    {
        name: 'detail pages: opening a student or team shows that record, with no errors (0-06)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            const rejections = [];
            page.on('console', m => { if (/Uncaught|unhandled/i.test(m.text())) rejections.push(m.text()); });
            for (const [i, sid] of ids.studentIds.entries()) {
                await page.evaluate(id => viewStudent(id), sid);
                await page.waitForTimeout(300);
                const header = await page.textContent('#student-detail-header');
                const expected = ['Tester', "O'Brien", 'Sample', 'Fixture'][i];
                assert(header.includes(expected), `student page for id ${sid} shows the wrong student`);
            }
            // The way a dashboard alert opens a student: navigate with an id only
            await page.evaluate(id => router.navigate('student-detail', id), ids.studentIds[2]);
            await page.waitForTimeout(300);
            assert((await page.textContent('#student-detail-header')).includes('Sample'), 'alert-style navigation shows the wrong student');
            await page.evaluate(id => router.navigate('team-detail', id), ids.teamId);
            await page.waitForTimeout(300);
            assert((await page.textContent('#team-detail-title')).includes('Test Team A'), 'team page shows the wrong team');
            assert(real(errors).length === 0 && rejections.length === 0, 'errors: ' + [...real(errors), ...rejections].join(' | '));
            await context.close();
        }
    },
    {
        name: 'student Edit button opens the edit form for that student (0-06)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            await page.evaluate(id => viewStudent(id), ids.studentIds[0]);
            await page.waitForTimeout(300);
            await page.click('#student-detail-header button:has-text("Edit")');
            await page.waitForTimeout(300);
            assert(await page.isVisible('#modal-student'), 'edit form did not open');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'phone width: the menu button opens the sidebar and the overlay closes it (0-06)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await page.setViewportSize({ width: 390, height: 800 });
            await page.waitForTimeout(200);
            assert(await page.isVisible('#sidebar-toggle'), 'menu button is not visible on a phone-width screen');
            await page.click('#sidebar-toggle');
            assert(await page.evaluate(() => document.getElementById('sidebar').classList.contains('sidebar--open')), 'sidebar did not open');
            await page.evaluate(() => document.getElementById('sidebar-overlay').click());
            assert(!(await page.evaluate(() => document.getElementById('sidebar').classList.contains('sidebar--open'))), 'overlay did not close the sidebar');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'wildcat absence: the webhook call is a simple request with no JSON Content-Type header (0-07)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'automations-enabled': 'true' };
            const { page, errors, context } = await openApp(browser, base, { stub, localStorageInit: ls });
            const ids = await seedFakeData(page);
            await page.evaluate(() => router.navigate('attendance'));
            await page.waitForTimeout(300);
            await page.evaluate(async sid => {
                document.getElementById('attendance-period').value = 'wildcat';
                document.getElementById('attendance-date').value = getTodayString();
                pages.attendance.pendingChanges = { [String(sid)]: 'absent' };
                await pages.attendance.saveAttendance();
            }, ids.studentIds[0]);
            await page.waitForTimeout(500);
            const calls = stub.calls.filter(c => ['queue_absence', 'send_immediate'].includes(c.action));
            assert(calls.length === 1, `expected 1 absence call, got ${calls.length}`);
            assert(!/application\/json/i.test(calls[0].contentType), `absence call sent Content-Type ${calls[0].contentType}`);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: "permanent delete works for a name with an apostrophe (O'Brien) (0-07)",
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            const obrien = ids.studentIds[1];
            await page.evaluate(async id => { await db.students.update(id, { deletedAt: new Date().toISOString() }); }, obrien);
            await page.evaluate(() => router.navigate('settings'));
            await page.waitForTimeout(300);
            await page.click('button.tab-btn:has-text("Deleted Items")');
            await page.waitForTimeout(500);
            const buttons = await page.$$(`#settings-tab-deleted button:has-text("Permanently Delete")`);
            assert(buttons.length >= 1, 'no Permanently Delete button shown');
            await buttons[0].click();
            await page.waitForTimeout(500);
            const rec = await page.evaluate(id => db.students.get(id), obrien);
            assert(rec && rec.permanentlyDeleted === true, "O'Brien was not permanently deleted");
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'check submissions: a graded form submission stays graded unless a later response arrives (0-07, D2)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'automations-enabled': 'true' };
            const { page, errors, context } = await openApp(browser, base, { stub, localStorageInit: ls });
            const ids = await seedFakeData(page);
            const t0 = '2026-09-20T13:00:00.000Z';
            const subId = await page.evaluate(async ({ aid, sid, t0 }) => {
                await db.activities.update(aid, { formSpreadsheetId: 'FAKE-SHEET' });
                return db.submissions.add({ activityId: aid, studentId: sid, status: 'graded', score: 0, submittedAt: t0, gradedAt: t0, feedback: 'Good work', createdAt: t0 });
            }, { aid: ids.activityId, sid: ids.studentIds[0], t0 });
            const response = ts => ({ status: 'success', headers: [], submissions: [{ timestamp: ts, email: 'ada@example.test', answers: [{ question: 'Q1', answer: 'A', score: 1, maxPoints: 1 }], totalScore: 1, totalPossible: 1 }] });
            stub.reply('check_form_submissions', response(t0));
            const run = () => page.evaluate(async () => { const b = document.createElement('button'); await pages.dashboard.checkAllFormSubmissions(b); });
            await run(); await run();
            let rec = await page.evaluate(id => db.submissions.get(id), subId);
            assert(rec.status === 'graded' && rec.feedback === 'Good work' && rec.score === 0, `graded work changed by a re-import (status ${rec.status}, score ${rec.score})`);
            stub.reply('check_form_submissions', response('2026-09-25T13:00:00.000Z'));
            await run();
            rec = await page.evaluate(id => db.submissions.get(id), subId);
            assert(rec.status === 'submitted' && rec.attempts && rec.attempts.length === 1, 'a later response did not start a new attempt');
            assert(rec.attempts[0].score === 0, `archived score of 0 became ${rec.attempts[0].score}`);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'end class: Hub sync boxes start unticked, and a disabled Hub step is hidden and skipped (0-07)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'automations-enabled': 'true' };
            const { page, errors, context } = await openApp(browser, base, { stub, localStorageInit: ls });
            await seedFakeData(page);
            const on = await page.evaluate(async () => {
                await modals.loadEndClassHubActivities('1');
                const boxes = [...document.querySelectorAll('.hub-sync-checkbox')];
                return { count: boxes.length, checked: boxes.filter(b => b.checked).length };
            });
            assert(on.count >= 1, 'no Hub activities listed');
            assert(on.checked === 0, `${on.checked} Hub box(es) ticked by default`);
            const off = await page.evaluate(async () => {
                await db.settings.put({ key: 'end-class-steps', value: { hubSync: false, absentNotifications: false } });
                await modals.loadEndClassHubActivities('1');
                // Tick a box by hand anyway, then complete: nothing may be sent
                document.getElementById('end-class-hub-activities').innerHTML = '<input type="checkbox" class="hub-sync-checkbox" value="1" checked>';
                document.getElementById('end-class-period').value = '1';
                await modals.completeEndClass();
                return document.getElementById('end-class-hub-sync-card').style.display;
            });
            assert(off === 'none', 'Hub card still shown when the step is turned off');
            assert(stub.callsFor('sync_to_hub_sheet').length === 0, 'Hub sync ran although the step is turned off');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: "rubric buttons work when a criterion name has an apostrophe (0-07)",
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            const rec = await page.evaluate(async ({ aid, sid }) => {
                await db.activities.update(aid, { scoringType: 'rubric', rubric: { levels: ['Exceeds', 'Meets', 'Approaching'], criteria: [{ name: "Student's Design" }, { name: 'Build "quality"' }] } });
                await pages.activityDetail.saveRubricScoreAt(aid, sid, 0, 1);
                await pages.activityDetail.saveRubricScoreAt(aid, sid, 1, 0);
                return db.submissions.where('activityId').equals(aid).filter(s => s.studentId === sid).first();
            }, { aid: ids.activityId, sid: ids.studentIds[0] });
            assert(rec && rec.rubricScores["Student's Design"] === 'Meets' && rec.rubricScores['Build "quality"'] === 'Exceeds', 'rubric scores not saved: ' + JSON.stringify(rec && rec.rubricScores));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'escapeHtml escapes quotes, and no Classroom payload (with the token) is logged (0-07)',
        fn: async ({ browser, base }) => {
            const { page, context } = await openApp(browser, base);
            const out = await page.evaluate(() => escapeHtml(`a"b'c<d>&`));
            assert(out === 'a&quot;b&#39;c&lt;d&gt;&amp;', 'escapeHtml returned ' + out);
            const src = await (await page.request.get(new URL('js/pages/activities.js', page.url()).href)).text();
            assert(!/console\.log\('Classroom payload/.test(src), 'Classroom payload is still logged');
            await context.close();
        }
    },
    {
        name: 'feedback email sends for a graded fake student (calculateFinalGrade restored) (0-08)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'automations-enabled': 'true' };
            stub.reply('send_feedback', { status: 'success', sent: 1, errors: [] });
            const { page, errors, context } = await openApp(browser, base, { stub, localStorageInit: ls });
            const ids = await seedFakeData(page);
            await page.evaluate(async ({ aid, sid, cp }) => {
                await db.activities.update(aid, { scoringType: 'points', defaultPoints: 50, checkpointGradeWeight: 20 });
                await db.checkpointCompletions.add({ checkpointId: cp, studentId: sid, completed: true, completedAt: new Date().toISOString() });
                await db.submissions.add({ activityId: aid, studentId: sid, status: 'graded', score: 40, feedback: 'Nice bridge.', submittedAt: new Date().toISOString() });
                await pages.activityDetail.sendStudentFeedback(aid, sid);
            }, { aid: ids.activityId, sid: ids.studentIds[0], cp: ids.checkpointIds[0] });
            await page.waitForTimeout(300);
            const calls = stub.callsFor('send_feedback');
            assert(calls.length === 1, `expected 1 feedback call, got ${calls.length}`);
            const fb = calls[0].body.feedbacks[0];
            // 20% checkpoints (1 of 1 done) + 80% points (40/50) = 0.2 + 0.64 = 84%
            assert(Math.round(fb.gradePercent) === 84, 'grade percent was ' + fb.gradePercent);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'push to Classroom sends only graded work, and partial rubrics are skipped (0-08)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'automations-enabled': 'true' };
            stub.reply('push_to_classroom', { status: 'success', pushed: 1, total: 1, errors: [] });
            const { page, errors, context } = await openApp(browser, base, { stub, localStorageInit: ls });
            const ids = await seedFakeData(page);
            await page.evaluate(async ({ aid, s }) => {
                await db.activities.update(aid, { scoringType: 'rubric', defaultPoints: 100, classroomLinks: { COURSE1: 'CW1' },
                    rubric: { levels: ['Exceeds', 'Meets', 'Approaching'], criteria: [{ name: 'Design' }, { name: 'Build' }] } });
                await db.submissions.add({ activityId: aid, studentId: s[0], status: 'graded', rubricScores: { Design: 'Exceeds', Build: 'Meets' } });
                await db.submissions.add({ activityId: aid, studentId: s[1], status: 'graded', rubricScores: { Design: 'Exceeds' } });
                await db.submissions.add({ activityId: aid, studentId: s[2], status: 'in-progress', rubricScores: {} });
                state.selectedActivity = aid;
                const btn = document.getElementById('push-classroom-btn') || Object.assign(document.createElement('button'), { id: 'push-classroom-btn' });
                if (!btn.isConnected) document.body.appendChild(btn);
                await pages.activityDetail.pushToClassroom();
            }, { aid: ids.activityId, s: ids.studentIds });
            const calls = stub.callsFor('push_to_classroom');
            assert(calls.length === 1, `expected 1 push, got ${calls.length}`);
            const grades = calls[0].body.grades;
            assert(grades.length === 1 && grades[0].score === 75, 'pushed grades: ' + JSON.stringify(grades));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'the Archived badge shows only on archived classes (0-08)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await seedFakeData(page);
            await page.evaluate(async () => { await db.classes.add({ name: 'Old Fake Class', color: '#999', periods: [], status: 'archived', createdAt: new Date().toISOString() }); });
            await page.evaluate(() => router.navigate('settings'));
            await page.waitForTimeout(500);
            const badges = await page.$$eval('#settings-tab-classes .badge', els => els.filter(e => /Archived/.test(e.textContent)).length);
            assert(badges === 1, `${badges} Archived badge(s) shown, expected 1`);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'an evening reload does not add more auto-backups (0-08)',
        fn: async ({ browser, base }) => {
            // 9:30 PM in New York is already the next day in UTC
            const { page, context } = await openApp(browser, base, { clockTime: '2026-10-06T21:30:00-04:00' });
            const first = await page.evaluate(() => backupDb.backups.count());
            await page.reload(); await waitForStartup(page);
            await page.reload(); await waitForStartup(page);
            const after = await page.evaluate(() => backupDb.backups.count());
            assert(first === 2, `expected 2 backups after the first evening open, found ${first}`);
            assert(after === 2, `evening reloads added backups: ${first} → ${after}`);
            await context.close();
        }
    }
];

run(tests);
