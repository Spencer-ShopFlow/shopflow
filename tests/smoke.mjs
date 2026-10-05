// ============================================
// ShopFlow smoke tests (fake data only)
// Run:  node tests/smoke.mjs            (all tests)
//       node tests/smoke.mjs attendance (only tests whose name contains "attendance")
// ============================================

import { run, openApp, seedFakeData, assert, WebhookStub, waitForStartup } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as smFixture from './fixtures/skillsMigrationFixture.mjs';

// The Hub payload builder as Full Edit had it before hubSync.js (main, 1 Oct), for a byte comparison
const OLD_HUB_BUILD = `async function (activityId, token, details) {
    const activity = await db.activities.get(activityId);
    // Load checkpoints
    const checkpoints = await db.checkpoints.where('activityId').equals(activityId).toArray();
    checkpoints.sort((a, b) => a.number - b.number);

    // Load students for this class (same pattern as activityDetail)
    const periodMap = await db.settings.get('period-year-map');
    const classPeriodsMap = periodMap?.value || {};
    const periodsForClass = Object.entries(classPeriodsMap)
        .filter(([period, classId]) => parseInt(classId) === activity.classId)
        .map(([period]) => period);

    const activeYear = await getActiveSchoolYear();
    const allEnrollments = await db.enrollments.toArray();
    const enrolledStudentIds = new Set(
        allEnrollments
            .filter(e => periodsForClass.includes(String(e.period)) && (!e.schoolYear || e.schoolYear === activeYear))
            .map(e => e.studentId)
    );

    const allStudents = excludeDeleted(await db.students.toArray())
        .filter(s => (s.status || 'active') === 'active' && (s.classId === activity.classId || enrolledStudentIds.has(s.id)))
        .sort(sortByStudentName);

    // Load teams and team members
    const allTeams = excludeDeleted(await db.teams.toArray()).filter(t => t.classId === activity.classId);
    const allTeamMembers = await db.teamMembers.toArray();

    // Build team lookup: studentId → teamName
    const studentTeamMap = {};
    allTeams.forEach(team => {
        const members = allTeamMembers.filter(tm => tm.teamId === team.id);
        members.forEach(m => { studentTeamMap[m.studentId] = team.name; });
    });

    // Load submissions
    const allSubmissions = await db.submissions.where('activityId').equals(activityId).toArray();
    const subByStudent = {};
    allSubmissions.forEach(s => { subByStudent[s.studentId] = s; });

    // Load checkpoint completions
    const checkpointIds = checkpoints.map(cp => cp.id);
    const allCompletions = await db.checkpointCompletions.toArray();
    const relevantCompletions = allCompletions.filter(c => checkpointIds.includes(c.checkpointId));

    // Build completion lookup: checkpointId-studentId → completion
    const compLookup = {};
    relevantCompletions.forEach(c => { compLookup[c.checkpointId + '-' + c.studentId] = c; });

    // Assemble student rows
    const studentRows = allStudents.map(s => {
        const first = (s.firstName || '').trim();
        const last = (s.lastName || '').trim();
        const dName = last ? first + ' ' + last.charAt(0) + '.' : first || 'Unknown';

        const sub = subByStudent[s.id];
        const submissionStatus = sub ? (sub.status || 'submitted') : 'missing';
        const graded = sub ? sub.status === 'graded' : false;

        const cpCompletions = checkpoints.map(cp => {
            const comp = compLookup[cp.id + '-' + s.id];
            return {
                completed: comp ? !!comp.completed : false,
                completedAt: comp ? comp.completedAt || comp.createdAt : null
            };
        });

        const completedCount = cpCompletions.filter(c => c.completed).length;
        const cpPercent = checkpoints.length > 0 ? Math.round((completedCount / checkpoints.length) * 100) : 0;

        return {
            displayName: dName,
            teamName: studentTeamMap[s.id] || '',
            submissionStatus,
            graded,
            checkpointCompletions: cpCompletions,
            cpPercentComplete: cpPercent
        };
    });

    // Look up inventory locations for tools and materials
    const allInventory = await db.inventory.toArray();
    const inventoryByName = {};
    allInventory.forEach(item => {
        inventoryByName[item.name.toLowerCase().trim()] = item.location || 'Unknown';
    });

    const toolsWithLocation = (activity.requiredTools || []).map(t => ({
        name: t.name || '',
        quantity: t.quantity || '',
        location: inventoryByName[(t.name || '').toLowerCase().trim()] || 'Unknown'
    }));

    const materialsWithLocation = (activity.requiredMaterials || []).map(m => ({
        name: m.name || '',
        quantity: m.quantity || '',
        location: inventoryByName[(m.name || '').toLowerCase().trim()] || 'Unknown'
    }));

    // Construct Classroom URL from classroomLinks
    let classroomUrl = '';
    if (activity.classroomLinks) {
        const entries = Object.entries(activity.classroomLinks);
        if (entries.length > 0) {
            const [courseId, cwId] = entries[0];
            if (courseId && cwId && cwId !== 'PENDING_CREATE') {
                classroomUrl = 'https://classroom.google.com/c/' + courseId + '/a/' + cwId + '/details';
            }
        }
    }

    // Assemble payload
    const payload = {
        action: 'sync_to_hub_sheet',
        token,
        activities: [{
            name: activity.name,
            classroomUrl: classroomUrl,
            title: activity.name,
            description: activity.description || '',
            studentGuideText: activity.studentGuideText || '',
            startDate: activity.startDate || '',
            endDate: activity.endDate || '',
            dueDate: activity.endDate || '',
            scoringType: activity.scoringType || '',
            formUrl: activity.formUrl || '',
            resourceLinks: activity.resourceLinks || [],
            // Activity Guide fields
            unit: activity.unit || '',
            lesson: activity.lesson || '',
            activityType: activity.activityType || '',
            phase: activity.phase || '',
            scaffoldingLevel: activity.scaffoldingLevel || '',
            classPeriods: activity.classPeriods || '',
            learningGoals: activity.learningGoals || [],
            fusionGoals: activity.fusionGoals || [],
            requiredTools: toolsWithLocation,
            requiredMaterials: materialsWithLocation,
            slidesUrl: activity.slidesUrl || '',
            instructionSteps: activity.instructionSteps || [],
            getReadyTime: activity.getReadyTime || '',
            getReadyTasks: activity.getReadyTasks || [],
            getReadyRoleTasks: activity.getReadyRoleTasks || '',
            conclusionQuestions: activity.conclusionQuestions || [],
            conclusionSubmissionMethod: activity.conclusionSubmissionMethod || '',
            assessmentQuestions: activity.assessmentQuestions || [],
            documentationChecklist: activity.documentationChecklist || [],
            appendixItems: activity.appendixItems || [],
            // Contract Brief (student-facing)
            contractCode: activity.contractCode || '',
            contractBrief: activity.contractBrief || {},
            certificationsRequired: activity.certificationsRequired || [],
            certificationsAvailable: activity.certificationsAvailable || [],
            portfolioPrompts: activity.portfolioPrompts || [],
            checkpoints: checkpoints.map(cp => ({
                number: cp.number,
                title: cp.title || '',
                description: cp.description || '',
                suggestedDate: cp.suggestedDate || '',
                milestone: cp.milestone || '',
                afterStep: (cp.afterStep === 0 || cp.afterStep) ? cp.afterStep : null,
                questions: cp.questions || []
            })),
            students: studentRows
        }]
    };

    if (!details) payload.activities[0].classroomUrl = payload.activities[0].classroomUrl.replace('/details', '');
    return payload;
}`;

// Loads a skills-migration fixture into the app's database (fake data only)
async function seedMigrationFixture(page, data) {
    await page.evaluate(async d => {
        const tables = ['skills', 'skillObservations', 'skillLevels', 'activities', 'activitySkills', 'checkpoints', 'settings', 'students', 'classes'];
        await db.transaction('rw', tables.map(t => db.table(t)), async () => {
            for (const t of tables) { await db.table(t).clear(); if (d[t] && d[t].length) await db.table(t).bulkAdd(d[t]); }
        });
    }, data);
}
// A plan's numbers, without its Maps (they don't cross into the test)
const PLAN_SUMMARY = `(p => ({ refusals: p.refusals, warnings: p.warnings, stats: p.stats, expected: p.expected, folded: p.folded,
    ratingsPerTarget: p.ratingsPerTarget, newSkills: p.newSkills.map(s => ({ id: s.id, name: s.name })),
    placeholders: p.placeholders.map(x => ({ skillId: x.skillId, kind: x.migration.kind, from: x.migration.fromSkillId, createdAt: x.createdAt, rating: x.rating })) }))`;

// Polls until a table holds n records. (page.waitForFunction treats a returned promise as
// "true" at once, so it can't wait on a Dexie count.)
async function waitForCount(page, table, n, timeout = 10000) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
        last = await page.evaluate(t => db.table(t).count(), table).catch(() => undefined);
        if (last === n) return;
        await page.waitForTimeout(100);
    }
    throw new Error(`${table}: expected ${n} records, found ${last}`);
}
// Writes a small JSON file for an import test and returns its path (fake data only).
const tempJson = (name, obj) => { const p = path.join(os.tmpdir(), `shopflow-test-${process.pid}-${name}.json`); fs.writeFileSync(p, JSON.stringify(obj)); return p; };

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
            await waitForCount(page, 'students', 20).catch(() => {});
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
        name: "check submissions: a students' form link (/d/e/) reads the response sheet, and a failure says why (i156)",
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'automations-enabled': 'true' };
            const { page, errors, context } = await openApp(browser, base, { stub, localStorageInit: ls });
            const ids = await seedFakeData(page);
            await page.evaluate(async aid => {
                await db.activities.update(aid, { formSpreadsheetId: 'FAKE-SHEET', formUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSfakePublishedId/viewform' });
                window.__toasts = [];
                const orig = ui.showToast.bind(ui);
                ui.showToast = (m, ...rest) => { window.__toasts.push(String(m)); return orig(m, ...rest); };
            }, ids.activityId);
            stub.reply('check_form_submissions', { status: 'success', headers: [], submissions: [] });
            const runAll = () => page.evaluate(async () => { const b = document.createElement('button'); await pages.dashboard.checkAllFormSubmissions(b); });
            await runAll();
            let calls = stub.callsFor('check_form_submissions');
            assert(calls.length === 1, `expected 1 check, got ${calls.length}`);
            assert(!('formId' in calls[0].body), `a students' link sent formId ${JSON.stringify(calls[0].body.formId)}`);
            assert(calls[0].body.spreadsheetId === 'FAKE-SHEET', 'the response sheet id was not sent');
            // An edit link still sends its editor id.
            await page.evaluate(async aid => { await db.activities.update(aid, { formUrl: 'https://docs.google.com/forms/d/1AbCfakeEditId_9/edit' }); }, ids.activityId);
            await runAll();
            calls = stub.callsFor('check_form_submissions');
            assert(calls[1].body.formId === '1AbCfakeEditId_9', `edit link sent formId ${calls[1].body.formId}`);
            // A refusal from the script is shown in plain words, on the dashboard and on the activity page.
            stub.reply('check_form_submissions', { status: 'error', message: "This form isn't one of yours, so the script won't read it." });
            await runAll();
            let toasts = await page.evaluate(() => window.__toasts);
            assert(toasts.some(t => /1 assignment failed \(.*isn't one of yours/.test(t)), 'dashboard summary did not say why: ' + toasts.slice(-1)[0]);
            await page.evaluate(async aid => { state.selectedActivity = aid; await pages.activityDetail.checkFormSubmissions(); }, ids.activityId);
            toasts = await page.evaluate(() => window.__toasts);
            assert(/^Couldn't check form submissions: This form isn't one of yours/.test(toasts.slice(-1)[0]), 'activity page did not say why: ' + toasts.slice(-1)[0]);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'wildcat save: a double tap gives 1 row and 1 email; saving again sends nothing (2-05, FF12 X1)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            stub.delay('queue_absence', 400); stub.delay('send_immediate', 400);
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'automations-enabled': 'true' };
            const { page, errors, context } = await openApp(browser, base, { stub, localStorageInit: ls });
            page.on('dialog', d => d.accept());
            const ids = await seedFakeData(page);
            const sid = String(ids.studentIds[0]);
            await page.evaluate(() => router.navigate('attendance'));
            await page.waitForTimeout(300);
            await page.evaluate(async sid => {
                document.getElementById('attendance-period').value = 'wildcat';
                document.getElementById('attendance-date').value = getTodayString();
                pages.attendance.pendingChanges = { [sid]: 'absent' };
                await Promise.all([pages.attendance.saveAttendance(), pages.attendance.saveAttendance()]);
            }, sid);
            await page.waitForTimeout(800);
            const rows = () => page.evaluate(sid => db.attendance.filter(r => r.studentId === sid && r.date === getTodayString() && r.period === 'wildcat').count(), sid);
            const emails = () => stub.calls.filter(c => ['queue_absence', 'send_immediate'].includes(c.action)).length;
            assert(await rows() === 1, `double tap: expected 1 attendance row, got ${await rows()}`);
            assert(emails() === 1, `double tap: expected 1 absence email call, got ${emails()}`);
            await page.evaluate(async () => {
                document.getElementById('attendance-period').value = 'wildcat';
                await pages.attendance.saveAttendance();
            });
            await page.waitForTimeout(800);
            assert(emails() === 1, `a second save re-sent: ${emails()} absence email calls`);
            const rec = await page.evaluate(sid => db.attendance.filter(r => r.studentId === sid && r.period === 'wildcat').first(), sid);
            assert(['queued', 'sent'].includes(rec.absenceNotified), `absenceNotified is ${rec.absenceNotified}`);
            // Marked present: every save sends cancel_absence (idempotent; covers the other device), never a queue.
            await page.evaluate(async id => { await db.attendance.update(id, { absenceNotified: 'queued' }); }, rec.id);
            await page.evaluate(async sid => {
                document.getElementById('attendance-period').value = 'wildcat';
                pages.attendance.pendingChanges = { [sid]: 'present' };
                await pages.attendance.saveAttendance();
                document.getElementById('attendance-period').value = 'wildcat';
                await pages.attendance.saveAttendance();
            }, sid);
            await page.waitForTimeout(500);
            assert(stub.callsFor('cancel_absence').length === 2, `expected a cancel on each of 2 saves, got ${stub.callsFor('cancel_absence').length}`);
            assert(emails() === 1, `marking present queued or sent again: ${emails()} absence email calls`);
            // The decision table, including records saved before this release (no absenceNotified field).
            const t = await page.evaluate(() => {
                const f = (e, s, today, after) => pages.attendance.wildcatEmailAction(e, s, today, after);
                return [
                    f(null, 'absent', true, false), f(null, 'absent', true, true), f(null, 'absent', false, false),
                    f({ status: 'absent', absenceNotified: 'queued' }, 'absent', true, false),
                    f({ status: 'absent', absenceNotified: null }, 'absent', true, false),
                    f({ status: 'absent' }, 'absent', true, true),
                    f({ status: 'absent' }, 'present', true, false),
                    f({ status: 'absent', absenceNotified: 'sent' }, 'late', true, false),
                    f({ status: 'unmarked' }, 'absent', true, false),
                    f(null, 'present', true, false),
                    f({ status: 'present', absenceNotified: null }, 'unmarked', true, false)
                ];
            });
            const want = ['queue_absence', 'send_immediate', null, null, 'queue_absence', null, 'cancel_absence', null, 'queue_absence', 'cancel_absence', 'cancel_absence'];
            assert(JSON.stringify(t) === JSON.stringify(want), `decision table: ${JSON.stringify(t)}`);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'attendance: leaving with unsaved marks asks first; Remove reports a failure (2-05, FF12 X5)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            // The harness answers confirm() with yes; here we choose the answer and count the questions.
            await page.evaluate(() => { window.__answer = false; window.__asked = 0; window.confirm = () => { window.__asked++; return window.__answer; }; });
            await page.evaluate(() => router.navigate('attendance'));
            await page.waitForTimeout(400);
            await page.evaluate(sid => pages.attendance.setStatus(sid, 'absent', true), ids.studentIds[0]);
            await page.evaluate(() => router.navigate('dashboard'));
            await page.waitForTimeout(200);
            let onAttendance = await page.evaluate(() => !document.getElementById('page-attendance').classList.contains('hidden'));
            const asked = await page.evaluate(() => window.__asked);
            assert(asked === 1 && onAttendance, `Cancel should keep her on attendance (asked ${asked}, on page ${onAttendance})`);
            assert(await page.evaluate(() => Object.keys(pages.attendance.pendingChanges).length) === 1, 'unsaved mark was lost');
            // Changing the period, answering Cancel, keeps the period and the mark
            const before = await page.evaluate(() => document.getElementById('attendance-period').value);
            await page.evaluate(() => { const s = document.getElementById('attendance-period'); s.value = 'wildcat'; s.dispatchEvent(new Event('change')); });
            await page.waitForTimeout(200);
            assert(await page.evaluate(() => document.getElementById('attendance-period').value) === before, 'period changed although she chose Cancel');
            await page.evaluate(() => { window.__answer = true; });
            await page.evaluate(() => router.navigate('dashboard'));
            await page.waitForTimeout(300);
            onAttendance = await page.evaluate(() => !document.getElementById('page-attendance').classList.contains('hidden'));
            assert(!onAttendance, 'OK should leave the page');
            // Remove from the Wildcat list: a failure is reported, not "removed"
            await page.evaluate(async () => {
                window.__toasts = [];
                const orig = ui.showToast.bind(ui);
                ui.showToast = (m, ...r) => { window.__toasts.push(String(m)); return orig(m, ...r); };
                db.wildcatSchedule.filter = () => { throw new Error('fake storage error'); };
                router.navigate('attendance');
                await new Promise(r => setTimeout(r, 300));
                await pages.attendance.removeWildcatStudent('1');
            });
            const toasts = await page.evaluate(() => window.__toasts);
            assert(toasts.some(t => /^Couldn't remove the student/.test(t)) && !toasts.some(t => /removed from Wildcat list/.test(t)), 'toasts: ' + toasts.join(' | '));
            await context.close();
        }
    },
    {
        name: "end class: switching period while absences load shows only the new period's students (2-05, X6)",
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            const res = await page.evaluate(async ({ classId, sids }) => {
                const today = getTodayString(); const now = new Date().toISOString(); const year = await getActiveSchoolYear();
                await db.settings.put({ key: 'period-year-map', value: { 1: classId, 2: classId } });
                const p2 = await db.students.add({ firstName: 'Zed', lastName: 'Periodtwo', name: 'Zed Periodtwo', email: 'zed@example.test', classId, status: 'active', createdAt: now });
                await db.enrollments.add({ studentId: p2, period: '2', schoolYear: year, createdAt: now });
                for (const sid of sids) await db.attendance.add({ studentId: String(sid), date: today, period: '1', status: 'absent', createdAt: now });
                await db.attendance.add({ studentId: String(p2), date: today, period: '2', status: 'absent', createdAt: now });
                const sel = document.getElementById('end-class-period');
                for (const v of ['1', '2']) if (![...sel.options].some(o => o.value === v)) { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); }
                sel.value = '1';
                const first = modals.loadEndClassAbsences();
                sel.value = '2';
                const second = modals.loadEndClassAbsences();
                await Promise.all([first, second]);
                const boxes = [...document.querySelectorAll('#end-class-absent-list .absent-email-checkbox')];
                return { n: boxes.length, names: boxes.map(b => b.dataset.studentName) };
            }, { classId: ids.classId, sids: ids.studentIds.slice(0, 3) });
            assert(res.n === 1 && res.names[0] === 'Zed Periodtwo', `expected only the period-2 student, got ${res.n}: ${res.names.join(', ')}`);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'wildcat teacher: shown with email, kept when not in the list, and reassigned when deleted (2-05, SEC12)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            page.on('dialog', d => d.accept());
            const ids = await seedFakeData(page);
            const r = await page.evaluate(async sids => {
                const t1 = await db.teachers.add({ lastName: 'Smith', email: 'smith.a@example.test' });
                const t2 = await db.teachers.add({ lastName: 'Smith', email: 'smith.b@example.test' });
                await db.students.update(sids[1], { wildcatTeacher: 'Smith', wildcatTeacherEmail: 'smith.a@example.test' });
                // Student 0 has a teacher who isn't in the list (teacher@example.test from the seed)
                await modals.showEditStudent(sids[0]);
                const sel = document.getElementById('student-wp-teacher');
                const out = { keptUnknown: sel.value, texts: [...sel.options].map(o => o.textContent) };
                ui.hideModal('modal-student');
                // Deleting Smith A offers to move student 1 to Smith B
                await modals.showTeacherManager();
                await modals.deleteTeacher(t1);
                out.panel = !!document.getElementById('teacher-reassign-' + t1);
                if (out.panel) await modals.confirmDeleteTeacher(t1, String(t2));
                const s1 = await db.students.get(sids[1]);
                out.moved = s1.wildcatTeacherEmail;
                out.t1Gone = !(await db.teachers.get(t1));
                return out;
            }, ids.studentIds);
            assert(r.keptUnknown === 'teacher@example.test', `unknown teacher was blanked (value "${r.keptUnknown}")`);
            assert(r.texts.includes('Smith — smith.a@example.test') && r.texts.includes('Smith — smith.b@example.test'), 'two Smiths are not told apart: ' + r.texts.join(' | '));
            assert(r.panel, 'no reassign choice when deleting a teacher who has students');
            assert(r.moved === 'smith.b@example.test' && r.t1Gone, `student not moved (${r.moved}), teacher deleted ${r.t1Gone}`);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'hidden skills: retired and merged-away skills are hidden everywhere, with Restore and the delete refusal (P16 C3)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            const s = await page.evaluate(async ({ aid, sids, cpId }) => {
                const now = new Date().toISOString(); const M = new Date(Date.now() - 86400000).toISOString();
                const keep = await db.skills.add({ name: 'Fake Kept Skill', category: 'Design', createdAt: now });
                const retired = await db.skills.add({ name: 'Fake Retired Skill', category: 'Design', createdAt: now, retiredAt: M, retiredNote: 'Not in Draft 3 — retired in the skills migration', updatedAt: M });
                const target = await db.skills.add({ name: 'Fake Target Skill', category: 'Design', createdAt: M });
                const merged = await db.skills.add({ name: 'Fake Old Skill', category: 'Design', createdAt: now, deletedAt: M, mergedInto: target, updatedAt: M });
                const empty = await db.skills.add({ name: 'Fake Empty Skill', category: 'Design', createdAt: now });
                await db.skillLevels.add({ studentId: sids[0], skillId: keep, level: 'Proficient', createdAt: now });
                await db.skillLevels.add({ studentId: sids[0], skillId: target, level: 'Developing', createdAt: M });
                await db.skillLevels.add({ studentId: sids[0], skillId: merged, level: 'Developing', createdAt: now, deletedAt: M, mergedInto: target });
                await db.skillLevels.add({ studentId: sids[1], skillId: retired, level: 'Beginning', createdAt: now });
                await db.activitySkills.add({ activityId: aid, skillId: keep });
                await db.activitySkills.add({ activityId: aid, skillId: retired });
                await db.activitySkills.add({ activityId: aid, skillId: merged, deletedAt: M, mergedInto: target });
                await db.checkpoints.update(cpId, { skillsAssessable: [keep, retired, target] });
                return { keep, retired, target, merged, empty };
            }, { aid: ids.activityId, sids: ids.studentIds, cpId: ids.checkpointIds[0] });

            // Library: visible grid, Retired list with Restore, Merged list
            await page.evaluate(() => router.navigate('skills'));
            await page.evaluate(() => pages.skills.renderLibrary());
            const lib = await page.evaluate(() => ({
                grid: [...document.querySelectorAll('#skills-library-grid .card h3')].map(h => h.textContent),
                retired: document.getElementById('skills-retired-list')?.textContent || '',
                merged: document.getElementById('skills-merged-list')?.textContent || ''
            }));
            assert(!lib.grid.includes('Fake Retired Skill') && !lib.grid.includes('Fake Old Skill') && lib.grid.includes('Fake Kept Skill'), 'library grid: ' + lib.grid.join(', '));
            assert(/Retired skills \(1\)/.test(lib.retired) && /Fake Retired Skill/.test(lib.retired), 'retired list: ' + lib.retired);
            assert(/Merged into Draft 3 skills \(1\)/.test(lib.merged) && /Fake Old Skill → Fake Target Skill/.test(lib.merged), 'merged list: ' + lib.merged);

            // Matrix, bulk update, checkpoint preload, Full Edit: visible skills only
            const pickers = await page.evaluate(async ({ aid }) => {
                await pages.skills.renderMatrix();
                const matrix = [...document.querySelectorAll('#skills-matrix th')].map(t => t.textContent);
                await pages.skills.showBulkUpdateModal();
                const bulk = [...document.querySelectorAll('#bulk-skill-select option')].map(o => o.textContent);
                ui.hideModal('modal-bulk-skill');
                const act = await db.activities.get(aid);
                pages.checkpoint.selectedClass = await db.classes.get(act.classId);
                await pages.checkpoint._preloadActivityData(act);
                const preload = pages.checkpoint._preloadedData.skills.map(x => x.name);
                const levels = pages.checkpoint._preloadedData.skillLevels.length;
                return { matrix, bulk, preload, levels };
            }, { aid: ids.activityId });
            for (const [where, list] of [['matrix', pickers.matrix], ['bulk update', pickers.bulk], ['checkpoint', pickers.preload]]) {
                assert(!list.includes('Fake Retired Skill') && !list.includes('Fake Old Skill') && list.includes('Fake Kept Skill'), `${where} shows: ${list.join(', ')}`);
            }
            assert(pickers.levels === 3, `checkpoint preload has ${pickers.levels} levels, expected 3 live ones`);

            await page.evaluate(id => modals.openFullEdit(id), ids.activityId);
            await page.waitForFunction(() => document.querySelectorAll('.fe-skill-cb').length > 0, null, { timeout: 5000 });
            await page.waitForTimeout(300);
            const fe = await page.evaluate(() => [...document.querySelectorAll('.fe-skill-cb')].map(cb => ({ name: cb.parentElement.textContent.trim(), checked: cb.checked })));
            assert(!fe.some(x => /Retired|Old Skill/.test(x.name)), 'Full Edit lists a hidden skill');
            assert(fe.find(x => x.name === 'Fake Kept Skill')?.checked, 'Full Edit lost the live link');
            await page.evaluate(() => pages.activityEdit.save());
            await page.waitForTimeout(800);
            const linksAfter = await page.evaluate(aid => db.activitySkills.where('activityId').equals(aid).toArray(), ids.activityId);
            assert(linksAfter.some(l => l.skillId === s.retired) && linksAfter.some(l => l.skillId === s.merged && l.deletedAt), 'Full Edit save removed links on hidden skills (hidden history)');

            // Student Skills tab: no hidden skill under assessed or not-yet-assessed
            await page.evaluate(sid => router.navigate('student-detail', sid), ids.studentIds[1]);
            await page.waitForTimeout(600);
            const sp = await page.evaluate(() => { const d = pages.studentDetail._data; return d ? d.allSkills.map(x => x.name) : null; });
            assert(sp && !sp.includes('Fake Retired Skill') && !sp.includes('Fake Old Skill'), 'student skills tab uses hidden skills: ' + JSON.stringify(sp));

            // Levels on hidden skills are refused; a skill with data can't be deleted; an empty one can
            const r = await page.evaluate(async ({ sids, retired, keep, empty }) => {
                await pages.skills.saveSkillLevel(sids[2], retired, 'Advanced');
                const refusedLevel = await db.skillLevels.filter(l => l.studentId === sids[2] && l.skillId === retired).count();
                pages.skills.editingSkillId = keep; await pages.skills.deleteSkill();
                const keptStill = !!(await db.skills.get(keep));
                pages.skills.editingSkillId = empty; await pages.skills.deleteSkill();
                const emptyGone = !(await db.skills.get(empty));
                await pages.skills.restoreSkill(retired);
                const restored = await db.skills.get(retired);
                return { refusedLevel, keptStill, emptyGone, restoredVisible: !isSkillHidden(restored), restoredUpdated: restored.updatedAt > new Date(Date.now() - 3600000).toISOString() };
            }, { sids: ids.studentIds, retired: s.retired, keep: s.keep, empty: s.empty });
            assert(r.refusedLevel === 0, 'a level was saved on a retired skill');
            assert(r.keptStill, 'a skill with a level was deleted');
            assert(r.emptyGone, 'an empty skill could not be deleted');
            assert(r.restoredVisible && r.restoredUpdated, 'Restore did not bring the skill back with a newer updatedAt');

            // Contract import: an old name warns and is not linked
            const guide = { contractCode: 'E9-2627-C8', skillsAssessed: [{ skillName: 'Fake Old Skill', checkpoints: [1] }, { skillName: 'Fake Kept Skill', checkpoints: [1] }], checkpoints: [{ number: 1, title: 'Fake CP', skillsAssessable: ['Fake Old Skill'] }] };
            await page.evaluate(() => router.navigate('settings'));
            await page.evaluate(async g => { document.getElementById('import-contract-json').value = JSON.stringify(g); await pages.settings.importContractGuide('paste'); }, guide);
            const warns = await page.$$eval('#import-contract-warnings li', lis => lis.map(li => li.textContent));
            assert(warns.filter(w => /'Fake Old Skill' was merged into 'Fake Target Skill'/.test(w)).length === 2, 'import warnings: ' + warns.join(' | '));
            const imported = await page.evaluate(() => db.activities.where('name').startsWith('E9-2627-C8').first());
            assert(imported && imported.skillsAssessed.length === 1 && imported.skillsAssessed[0].skillName === 'Fake Kept Skill', 'import linked a merged-away skill');

            // Analytics export: one column per visible skill
            const csv = await page.evaluate(async () => { let out = ''; const orig = window.downloadCSV; window.downloadCSV = c => { out = c; }; await pages.settings.exportStudentAnalytics(); window.downloadCSV = orig; return out.split('\n')[0]; });
            assert(/Skill: Fake Kept Skill/.test(csv) && !/Skill: Fake Old Skill/.test(csv), 'analytics header: ' + csv.slice(0, 300));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'sync epoch: a copy from the other side of the migration is refused, and import allows only Replace All (P16 N6)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'drive-sync-enabled': 'true', 'drive-sync-password': 'test-sync-pass', 'automations-enabled': 'true' };
            // Device A (the "PC"): not migrated; uploads its copy
            const a = await openApp(browser, base, { stub, localStorageInit: ls });
            await seedFakeData(a.page);
            await a.page.evaluate(async () => { driveSync._dirty = true; await driveSync.push(); });
            // Device B (the "iPad"): migrated (has a sync-epoch), different data
            const b = await openApp(browser, base, { stub, localStorageInit: ls });
            await b.page.evaluate(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }); });
            await b.page.evaluate(async () => {
                const now = new Date().toISOString();
                await db.settings.put({ key: 'sync-epoch', value: { id: 'skills-draft3-2026-11', at: now }, createdAt: now, updatedAt: now });
                await db.students.add({ firstName: 'Only', lastName: 'OnB', name: 'Only OnB', status: 'active', createdAt: now });
            });
            const before = await b.page.evaluate(() => db.students.count());
            await b.page.evaluate(() => driveSyncNow());
            await b.page.waitForTimeout(800);
            const after = await b.page.evaluate(() => ({ n: db.students.count(), line: localStorage.getItem('last-sync-now-result'), paused: localStorage.getItem('drive-sync-paused'), ts: localStorage.getItem('last-drive-sync-remote-ts') }));
            const nAfter = await b.page.evaluate(() => db.students.count());
            assert(nAfter === before, `the migrated device merged a pre-migration copy (${before} → ${nAfter} students)`);
            assert(/⛔ Download refused/.test(after.line) && /✅ Uploaded/.test(after.line), 'Sync Now line: ' + after.line);
            assert(/from before the skills migration/.test(after.paused || '') && !after.ts, 'paused message / pull clock: ' + after.paused + ' / ' + after.ts);
            // ...and the other way round: the unmigrated device refuses the migrated copy B just uploaded
            const aBefore = await a.page.evaluate(() => db.students.count());
            const res = await a.page.evaluate(() => driveSyncPull.checkOnLoad());
            const aAfter = await a.page.evaluate(() => db.students.count());
            assert(res === 'refused' && aAfter === aBefore, `unmigrated device: ${res}, ${aBefore} → ${aAfter}`);
            // Data check shows the epoch line and the pause
            await b.page.evaluate(() => pages.settings.renderDataCheck());
            const dc = await b.page.evaluate(() => pages.settings._dataCheckText);
            assert(/Skills migration: done .*\(skills-draft3-2026-11\)/.test(dc) && /Sync paused/.test(dc), 'data check: ' + dc.slice(0, 400));
            await a.page.evaluate(() => pages.settings.renderDataCheck());
            assert(/Skills migration: not done/.test(await a.page.evaluate(() => pages.settings._dataCheckText)), 'unmigrated data check line');
            // Import across the epoch: Merge and Sync Setup Only switched off, Replace All allowed
            const v = await b.page.evaluate(async () => {
                const file = await driveSync.buildSyncFile();
                file.settings = file.settings.filter(r => r.key !== 'sync-epoch');
                return { merge: await pages.settings._validateImport(file, 'merge'), setup: await pages.settings._validateImport(file, 'setup'), replace: await pages.settings._validateImport(file, 'replace') };
            });
            assert(/Only Replace All/.test(v.merge || '') && /Only Replace All/.test(v.setup || '') && v.replace === null, 'import rules: ' + JSON.stringify(v));
            // Same epoch: sync works again and the pause clears
            await a.page.evaluate(async () => { const now = new Date().toISOString(); await db.settings.put({ key: 'sync-epoch', value: { id: 'skills-draft3-2026-11', at: now }, createdAt: now, updatedAt: now }); driveSync._dirty = true; await driveSync.push(); });
            const again = await b.page.evaluate(() => driveSyncPull.checkOnLoad());
            assert(again === 'applied' && !(await b.page.evaluate(() => localStorage.getItem('drive-sync-paused'))), 'same-epoch pull: ' + again);
            assert(real(a.errors).length === 0 && real(b.errors).length === 0, 'page errors: ' + real(a.errors).concat(real(b.errors)).join(' | '));
            await a.context.close(); await b.context.close();
        }
    },
    {
        name: "upload only and look: replace this device's Drive copy with sync off; look at the other copy without changing anything (P16 N4, N5)",
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'drive-sync-enabled': 'false', 'drive-sync-password': 'test-sync-pass', 'automations-enabled': 'true' };
            const pc = await openApp(browser, base, { stub, localStorageInit: ls });
            await seedFakeData(pc.page);
            await pc.page.evaluate(() => router.navigate('settings'));
            await pc.page.evaluate(() => pages.settings.setTab ? pages.settings.setTab('data') : null).catch(() => {});
            const visibleOff = await pc.page.evaluate(() => { driveSync.updateSyncStatusUI(); return document.getElementById('drive-upload-only-btn').style.display !== 'none'; });
            assert(visibleOff, 'Upload only is hidden while sync is off');
            const r1 = await pc.page.evaluate(() => driveSyncUploadOnly());
            const calls = stub.callsFor('save_to_drive');
            assert(r1 === 'uploaded' && calls.length === 1 && calls[0].body.deviceId === 'PC' && stub.callsFor('load_from_drive').length === 0, `upload only: ${r1}, ${calls.length} uploads`);
            const line = await pc.page.evaluate(() => localStorage.getItem('last-upload-only-result'));
            assert(/✅ PC copy replaced · sync-epoch: none/.test(line), 'result line: ' + line);
            assert(!(await pc.page.evaluate(() => localStorage.getItem('last-drive-sync-received'))), 'upload only touched the pull clock');
            // A non-JSON reply says the upload may still have worked, never "failed"
            stub.raw('save_to_drive', '<html>404</html>');
            const r2 = await pc.page.evaluate(() => driveSyncUploadOnly());
            const line2 = await pc.page.evaluate(() => localStorage.getItem('last-upload-only-result'));
            assert(r2 === 'unknown' && /❓ No reply\. The upload may still have worked/.test(line2), 'no-reply line: ' + line2);
            assert(stub.callsFor('save_to_drive').length === 3, 'a lost upload reply is retried once (2-04)');
            delete stub.raws.save_to_drive;
            // With sync on it refuses and uploads nothing
            await pc.page.evaluate(() => localStorage.setItem('drive-sync-enabled', 'true'));
            const r3 = await pc.page.evaluate(() => driveSyncUploadOnly());
            assert(r3 === 'refused' && stub.callsFor('save_to_drive').length === 3, 'upload only ran with sync on');
            const hiddenOn = await pc.page.evaluate(() => { driveSync.updateSyncStatusUI(); return document.getElementById('drive-upload-only-btn').style.display === 'none'; });
            assert(hiddenOn, 'Upload only is shown while sync is on');

            // The "iPad" looks at the PC's copy: counts shown side by side, nothing changes
            const ipad = await openApp(browser, base, { stub, localStorageInit: ls });
            await ipad.page.evaluate(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }); });
            await ipad.page.evaluate(() => router.navigate('settings'));
            const before = await ipad.page.evaluate(() => db.students.count());
            const shown = await ipad.page.evaluate(() => driveSyncLook.run());
            const look = await ipad.page.evaluate(() => ({
                text: driveSyncLook._text,
                students: document.querySelector('#drive-look-result tr[data-table="students"] .drive-look-there')?.textContent,
                mark: document.querySelector('#drive-look-result tr[data-table="students"] .drive-look-mark')?.textContent,
                received: localStorage.getItem('last-drive-sync-received'), pending: !!driveSync._pendingMerge
            }));
            const after = await ipad.page.evaluate(() => db.students.count());
            assert(shown === 'shown' && look.students === '4' && look.mark === '≠', `look: ${shown}, students ${look.students} ${look.mark}`);
            assert(/Sync-epoch: none: from before the skills migration/.test(look.text), 'look text: ' + look.text.slice(0, 300));
            assert(after === before && !look.received && !look.pending, 'Look changed something on this device');
            assert(real(pc.errors).length === 0 && real(ipad.errors).length === 0, 'page errors: ' + real(pc.errors).concat(real(ipad.errors)).join(' | '));
            await pc.context.close(); await ipad.context.close();
        }
    },
    {
        name: 'skills migration: Preview on a Part-B-shaped fixture gives the design numbers; Run matches; Verify ✅ (P16 C5, C7)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await seedMigrationFixture(page, smFixture.full());
            const p = await page.evaluate(`(async () => { const snap = await skillsMigration.snapshot(); return ${PLAN_SUMMARY}(skillsMigration.plan(snap, '2026-11-05T20:31:00.000Z')); })()`);
            assert(p.refusals.length === 0, 'refusals: ' + p.refusals.join(' | '));
            const e = p.expected;
            assert(e.skills.total === 75 && e.skills.deleted === 26, `skills ${JSON.stringify(e.skills)}`);
            assert(e.skillObservations.total === 322, `ratings ${JSON.stringify(e.skillObservations)}`);
            assert(e.skillLevels.total === 229 && e.skillLevels.deleted === 55, `levels ${JSON.stringify(e.skillLevels)}`);
            assert(e.activitySkills.total === 172 && e.activitySkills.deleted === 16, `links ${JSON.stringify(e.activitySkills)}`);
            assert(e.activities.total === 60 && e.checkpoints.total === 199, 'activities/checkpoints changed count');
            const s = p.stats;
            assert(s.visibleAfter === 46 && s.ratingsMoved === 85 && s.ratingsNudged === 0 && s.placeholders === 6 && s.newLevels === 39, 'stats: ' + JSON.stringify(s));
            const pdr = p.newSkills.find(t => t.name === 'Problem Definition & Research');
            const msp = p.newSkills.find(t => t.name === 'Material Selection & Properties');
            assert(p.placeholders.every(x => x.skillId === pdr.id && x.from === 6 && x.kind === 'below-ratings'), 'placeholders: ' + JSON.stringify(p.placeholders));
            assert(p.ratingsPerTarget[pdr.id] === 88 && p.ratingsPerTarget[msp.id] === 3, 'ratings per target: ' + JSON.stringify(p.ratingsPerTarget));
            assert(s.linksFolded === 16 && s.saFoldedLive + s.saFoldedDeleted === 16 && s.checkpointDuplicatesDropped === 18, 'folds: ' + JSON.stringify(s));
            assert(p.folded.length === 16, `folded list: ${p.folded.length}`);
            // The card: Preview prints the expected table; on an iPad, Run is hidden and refused
            const ui1 = await page.evaluate(async () => {
                router.navigate('settings');
                await skillsMigration.preview();
                const out = document.getElementById('skills-migration-output').textContent;
                Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', configurable: true });
                skillsMigration.initCard();
                const hidden = document.getElementById('skills-migration-run-btn').style.display === 'none';
                const env = await skillsMigration.environmentRefusals();
                Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', configurable: true });
                skillsMigration.initCard();
                return { out, hidden, env };
            });
            assert(/skills: 75 \(26 deleted\)/.test(ui1.out) && /skillLevels: 229 \(55 deleted\)/.test(ui1.out), 'preview output: ' + ui1.out.slice(0, 400));
            assert(ui1.hidden && ui1.env.some(x => /PC only/.test(x)), 'iPad: ' + JSON.stringify(ui1));
            // Deterministic: the same data and time give the same plan
            const again = await page.evaluate(`(async () => { const snap = await skillsMigration.snapshot(); return ${PLAN_SUMMARY}(skillsMigration.plan(snap, '2026-11-05T20:31:00.000Z')); })()`);
            assert(JSON.stringify(again) === JSON.stringify(p), 'plan is not deterministic');

            // A forced error mid-write changes nothing
            const before = await page.evaluate(() => skillsMigration.currentCounts());
            const failed = await page.evaluate(async () => { skillsMigration._testFailAfterWrites = 40; const r = await skillsMigration.run(); skillsMigration._testFailAfterWrites = null; return r; });
            const afterFail = await page.evaluate(() => skillsMigration.currentCounts());
            delete before.activityLog; delete afterFail.activityLog;
            assert(!failed.ok && /forced failure/.test(failed.error || ''), 'forced failure: ' + JSON.stringify(failed));
            assert(JSON.stringify(before) === JSON.stringify(afterFail), 'a failed run changed counts');
            assert(!(await page.evaluate(() => db.settings.get('sync-epoch'))), 'a failed run wrote the epoch');

            // Refusals that depend on the device: sync on, an old export
            const env = await page.evaluate(async () => {
                localStorage.setItem('drive-sync-enabled', 'true');
                const a = await skillsMigration.environmentRefusals();
                localStorage.setItem('drive-sync-enabled', 'false');
                const keep = await db.settings.get('last-manual-export');
                await db.settings.put({ key: 'last-manual-export', value: new Date(Date.now() - 3 * 3600000).toISOString() });
                const b = await skillsMigration.environmentRefusals();
                await db.settings.put(keep);
                return { a, b };
            });
            assert(env.a.some(x => /sync off/.test(x)) && env.b.some(x => /Export JSON first/.test(x)), 'environment refusals: ' + JSON.stringify(env));

            // Run
            const r = await page.evaluate(async () => { const x = await skillsMigration.run(); return { ok: x.ok, verify: x.verify, report: skillsMigration._lastReport }; });
            assert(r.ok && r.verify.ok, 'run/verify: ' + JSON.stringify(r.verify));
            const actual = await page.evaluate(() => skillsMigration.currentCounts());
            for (const t of ['skills', 'skillObservations', 'skillLevels', 'activitySkills', 'activities', 'checkpoints']) {
                assert(actual[t].total === e[t].total && actual[t].deleted === e[t].deleted, `${t}: expected ${JSON.stringify(e[t])}, got ${JSON.stringify(actual[t])}`);
            }
            assert(actual.settings.total === before.settings.total + 1, 'settings did not gain sync-epoch');
            assert((await page.evaluate(() => getVisibleSkills().then(v => v.length))) === 46, 'visible skills after run');
            assert(/Folded skillsAssessed entries \(Q1\)[\s\S]*activity \d+/.test(r.report) && (r.report.match(/^ {2}activity \d+/gm) || []).length === 16, 'report lacks the 16 folded entries');
            assert(!/Fake\d+ Student/.test(r.report), 'report contains a student name');
            // A second run is refused; Preview says so too
            const second = await page.evaluate(() => skillsMigration.run());
            assert(!second.ok && second.refusals.some(x => /already been migrated/.test(x)), 'second run: ' + JSON.stringify(second));
            // The tool never deletes and never calls an importer
            const src = fs.readFileSync(new URL('../js/features/skillsMigration.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
            assert(!/\.delete\(|bulkDelete|\.clear\(|importContractGuide|executeImport/.test(src), 'the tool source deletes, clears or calls an importer');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'skills migration: removed ratings move with a merge but never count as live ratings (§3.3, before #23)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const M = '2026-11-05T20:31:00.000Z';
            const planOf = () => page.evaluate(`(async () => { const snap = await skillsMigration.snapshot(); return ${PLAN_SUMMARY}(skillsMigration.plan(snap, '${M}')); })()`);
            await seedMigrationFixture(page, smFixture.withRemovedRatings());
            const p = await planOf();
            assert(p.refusals.length === 0, 'refusals: ' + p.refusals.join(' | '));
            const s = p.stats;
            // The design numbers are unchanged by the removed ratings
            assert(s.placeholders === 6 && s.newLevels === 39 && s.ratingsMoved === 85, `placeholders ${s.placeholders} (6), new levels ${s.newLevels} (39), live ratings moved ${s.ratingsMoved} (85)`);
            assert(s.ratingsMovedRemoved === 2, `removed ratings moved: ${s.ratingsMovedRemoved} (expected 2)`);
            const pdr = p.newSkills.find(t => t.name === 'Problem Definition & Research');
            assert(p.ratingsPerTarget[pdr.id] === 88, 'live ratings on Problem Definition & Research: ' + p.ratingsPerTarget[pdr.id]);
            assert(s.missing.ratings === 0 && !p.warnings.some(w => /don't exist/.test(w)), 'a removed rating was reported missing: ' + JSON.stringify(s.missing));
            assert(p.expected.skillObservations.total === 326 && p.expected.skillObservations.deleted === 4, 'ratings expected: ' + JSON.stringify(p.expected.skillObservations));
            assert(p.expected.skills.total === 75 && p.expected.skillLevels.total === 229 && p.expected.skillLevels.deleted === 55, 'skills/levels expected changed');
            // Run: the two removed ratings on skill 6 now sit on the target, still removed; the others stay put
            const r = await page.evaluate(async () => {
                const res = await skillsMigration.run();
                const obs = await db.skillObservations.toArray();
                const rm = obs.filter(o => o.deletedAt).map(o => ({ s: o.studentId, skill: o.skillId, from: o.premigrationSkillId ?? null }));
                const t = (await db.skills.toArray()).find(x => x.name === 'Problem Definition & Research');
                const lvl100 = (await db.skillLevels.toArray()).filter(l => l.studentId === 100 && l.skillId === t.id).length;
                return { ok: res.ok, verify: res.verify, rm, targetId: t.id, lvl100, report: skillsMigration._lastReport };
            });
            assert(r.ok && r.verify.ok, 'run/verify: ' + JSON.stringify(r.verify));
            const rm = Object.fromEntries(r.rm.map(x => [x.s, x]));
            assert(rm[1].skill === r.targetId && rm[1].from === 6 && rm[100].skill === r.targetId && rm[100].from === 6, 'removed ratings on skill 6 did not move: ' + JSON.stringify(r.rm));
            assert(rm[80].skill === 20 && rm[80].from === null && rm[81].skill === 999, 'other removed ratings changed: ' + JSON.stringify(r.rm));
            assert(r.lvl100 === 0, 'a removed rating gave a student a level on the target');
            assert(/Ratings moved: 85 live \+ 2 removed/.test(r.report), 'report line: ' + (r.report.match(/Ratings moved:.*$/m) || [''])[0]);
            // A removed rating that would win Replace All over a live one is refused; one that would lose is only a warning
            await seedMigrationFixture(page, smFixture.withRemovedRatings({ clash: 'removed-newer' }));
            const bad = await planOf();
            assert(bad.refusals.length === 1 && /removed rating\(s\) share .* and are newer/.test(bad.refusals[0]), 'removed-newer: ' + JSON.stringify(bad.refusals));
            // The same time: which row Replace All keeps isn't certain, so it's refused too (META, 29 Sep)
            await seedMigrationFixture(page, smFixture.withRemovedRatings({ clash: 'tie' }));
            const tie = await planOf();
            assert(tie.refusals.length === 1 && /removed rating\(s\) share .* and are newer or as new/.test(tie.refusals[0]), 'tie: ' + JSON.stringify({ refusals: tie.refusals, warnings: tie.warnings }));
            await seedMigrationFixture(page, smFixture.withRemovedRatings({ clash: 'live-newer' }));
            const ok = await planOf();
            assert(ok.refusals.length === 0 && ok.warnings.some(w => /Replace All drops the removed one/.test(w)), 'live-newer: ' + JSON.stringify({ refusals: ok.refusals, warnings: ok.warnings }));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'skills migration: the worked example keeps downgrades and hand-set levels, adds placeholders, nudges a collision (P16 C2)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await seedMigrationFixture(page, smFixture.workedExample());
            const r = await page.evaluate(async () => {
                const res = await skillsMigration.run();
                const t = (await db.skills.toArray()).find(s => s.name === 'Technical Sketching & Visualization');
                const live = (await db.skillLevels.toArray()).filter(l => l.skillId === t.id && !l.deletedAt);
                const byStudent = Object.fromEntries(live.map(l => [l.studentId, l.level]));
                const ph = (await db.skillObservations.toArray()).filter(o => o.evidenceType === 'migrated').map(o => ({ s: o.studentId, kind: o.migration.kind, at: o.createdAt, skillId: o.skillId }));
                const moved = (await db.skillObservations.toArray()).filter(o => o.premigrationSkillId != null);
                const nudged = moved.filter(o => o.premigrationCreatedAt);
                const keys = new Set((await db.skillObservations.toArray()).map(o => skillsMigration.ratingKey(o)));
                return { ok: res.ok, verify: res.verify, targetId: t.id, byStudent, ph, moved: moved.length, nudged: nudged.length, uniqueKeys: keys.size, total: await db.skillObservations.count() };
            });
            assert(r.ok && r.verify.ok, 'run/verify: ' + JSON.stringify(r.verify));
            const want = { 9001: 'Proficient', 9002: 'Developing', 9003: 'Advanced', 9004: 'Proficient', 9005: 'Proficient' };
            assert(JSON.stringify(r.byStudent) === JSON.stringify(want), 'levels on the target: ' + JSON.stringify(r.byStudent));
            const ph = r.ph.map(x => `${x.s}:${x.kind}:${x.at.slice(0, 10)}`).sort();
            assert(JSON.stringify(ph) === JSON.stringify(['9001:no-ratings:2026-09-09', '9004:above-ratings:2026-09-25']), 'placeholders: ' + JSON.stringify(ph));
            assert(r.ph.every(x => x.skillId === r.targetId), 'placeholders not on the target');
            assert(r.moved === 11 && r.nudged === 1, `moved ${r.moved}, nudged ${r.nudged}`);
            assert(r.uniqueKeys === r.total, 'two ratings share a key after the move');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'skills migration: dashboard writes while Run asks (a submission, a task, a setting) give no ≠; only the tables it changes are compared',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await seedMigrationFixture(page, smFixture.full());
            const r = await page.evaluate(async () => {
                // While the Run question is open, "the dashboard" writes to a table the migration never
                // touches (submissions, tasks) and to one it does (settings). One transaction, started
                // before Run's own, so every write lands before the migration writes.
                const orig = window.confirm;
                window.confirm = () => {
                    const now = new Date().toISOString();
                    db.transaction('rw', db.submissions, db.tasks, db.settings, async () => {
                        await db.submissions.add({ activityId: 1, studentId: 1, status: 'in-progress', submittedAt: now, updatedAt: now });
                        await db.tasks.add({ title: 'Fake auto task', completed: false, createdAt: now });
                        await db.settings.put({ key: 'dismissed-auto-tasks', value: ['fake'] });
                    });
                    return true;
                };
                const res = await skillsMigration.run();
                window.confirm = orig;
                const counts = await skillsMigration.currentCounts();
                return { ok: res.ok, verifyOk: res.verify && res.verify.ok, report: skillsMigration._lastReport, settings: counts.settings.total, submissions: counts.submissions.total };
            });
            assert(r.ok && r.verifyOk, 'run failed: ' + r.report.slice(0, 400));
            assert(!/≠/.test(r.report), 'a ≠ appeared:\n' + r.report.split('\n').filter(l => /≠/.test(l)).join('\n'));
            // settings: 15 + the dashboard's row + sync-epoch, and the report expected exactly that
            assert(r.settings === 17 && /^ {2}settings: 17 \/ 17$/m.test(r.report), 'settings line: ' + (r.report.match(/^ {2}settings:.*$/m) || [''])[0]);
            const changed = r.report.split("Tables the migration doesn't change")[0];
            const others = r.report.split("Tables the migration doesn't change")[1] || '';
            assert(/Tables the migration changes \(expected \/ actual\):/.test(changed) && (changed.match(/^ {2}\w+: .* \/ /gm) || []).length === 7, 'the compared group is not the 7 tables it writes:\n' + changed.slice(0, 900));
            assert(new RegExp('^ {2}submissions: ' + r.submissions + '$', 'm').test(others) && /^ {2}tasks: 1$/m.test(others), 'the other tables are not shown as they are now:\n' + others.slice(0, 900));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'skills migration: re-seed by Replace All, Upload only on both, then sync changes nothing; Restore reaches the other device (P16 C4, C7)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'drive-sync-enabled': 'false', 'drive-sync-password': 'test-sync-pass', 'automations-enabled': 'true' };
            const pc = await openApp(browser, base, { stub, localStorageInit: ls });
            await seedMigrationFixture(pc.page, smFixture.full());
            const ran = await pc.page.evaluate(() => skillsMigration.run().then(r => r.ok));
            assert(ran, 'migration did not run');
            const file = await pc.page.evaluate(() => driveSync.buildSyncFile());
            // The "iPad": unmigrated copy, then Replace All from the PC's migrated export
            const ipad = await openApp(browser, base, { stub, localStorageInit: ls });
            await ipad.page.evaluate(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }); });
            await seedMigrationFixture(ipad.page, smFixture.full());
            await ipad.page.evaluate(() => router.navigate('settings'));
            await ipad.page.setInputFiles('#import-file-input', tempJson('migrated-pc', file));
            await ipad.page.waitForSelector('#import-replace-btn', { state: 'visible' });
            const disabled = await ipad.page.evaluate(() => ({ merge: document.getElementById('import-merge-btn').disabled, setup: document.getElementById('import-setup-btn').disabled, replace: document.getElementById('import-replace-btn').disabled }));
            assert(disabled.merge && disabled.setup && !disabled.replace, 'import buttons across the epoch: ' + JSON.stringify(disabled));
            await ipad.page.click('#import-replace-btn');
            await ipad.page.waitForTimeout(1500);
            await waitForStartup(ipad.page).catch(() => {});
            await ipad.page.evaluate(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }); });
            const iv = await ipad.page.evaluate(() => skillsMigration.verify());
            assert(iv.migrated && iv.ok, 'iPad verify after the re-seed: ' + JSON.stringify(iv.items));
            // The tables the migration writes, plus students (the reloaded iPad's own start-up writes to other tables don't matter here)
            const count = pg => pg.evaluate(async () => { const c = await skillsMigration.currentCounts(); const out = {}; for (const t of ['skills', 'skillObservations', 'skillLevels', 'activitySkills', 'activities', 'checkpoints', 'students']) out[t] = c[t]; return out; });
            const pcCounts = await count(pc.page), ipadCounts = await count(ipad.page);
            assert(JSON.stringify(pcCounts) === JSON.stringify(ipadCounts), 'counts differ after the re-seed: ' + Object.keys(pcCounts).filter(k => JSON.stringify(pcCounts[k]) !== JSON.stringify(ipadCounts[k])).map(k => `${k} ${JSON.stringify(pcCounts[k])} vs ${JSON.stringify(ipadCounts[k])}`).join('; '));
            // Upload only on both (sync off), then sync on: a pull changes nothing
            const up1 = await pc.page.evaluate(() => driveSyncUploadOnly());
            const up2 = await ipad.page.evaluate(() => driveSyncUploadOnly());
            assert(up1 === 'uploaded' && up2 === 'uploaded', `upload only: ${up1}, ${up2}`);
            for (const d of [pc, ipad]) await d.page.evaluate(() => localStorage.setItem('drive-sync-enabled', 'true'));
            const pull1 = await pc.page.evaluate(() => driveSyncPull.checkOnLoad());
            const pull2 = await ipad.page.evaluate(() => driveSyncPull.checkOnLoad());
            assert(pull1 === 'applied' && pull2 === 'applied', `pulls: ${pull1}, ${pull2}`);
            assert(JSON.stringify(await count(pc.page)) === JSON.stringify(pcCounts) && JSON.stringify(await count(ipad.page)) === JSON.stringify(ipadCounts), 'a pull changed counts');
            // Restore a retired skill on the PC; it reaches the iPad
            const restoredId = await pc.page.evaluate(async () => { const s = (await db.skills.toArray()).find(x => x.retiredAt); await pages.skills.restoreSkill(s.id); driveSync._dirty = true; await driveSync.push(); return s.id; });
            await ipad.page.evaluate(() => driveSyncPull.checkOnLoad());
            const onIpad = await ipad.page.evaluate(id => db.skills.get(id), restoredId);
            assert(onIpad && !onIpad.retiredAt, 'Restore did not reach the other device');
            assert(real(pc.errors).length === 0 && real(ipad.errors).length === 0, 'page errors: ' + real(pc.errors).concat(real(ipad.errors)).join(' | '));
            await pc.context.close(); await ipad.context.close();
        }
    },
    {
        name: 'sync: ratings made on both devices with the same id are both kept, and an edit still reaches the other device (i162, FF4)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'drive-sync-enabled': 'true', 'drive-sync-password': 'test-sync-pass', 'automations-enabled': 'true' };
            const pc = await openApp(browser, base, { stub, localStorageInit: ls });
            const ipad = await openApp(browser, base, { stub, localStorageInit: ls });
            await ipad.page.evaluate(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }); });
            // Same starting data on both (as after a re-seed): same ids, same next id
            const ids = await seedFakeData(pc.page);
            await seedFakeData(ipad.page);
            const rate = (page, sid, minute) => page.evaluate(async ({ sid, aid, minute }) => {
                let skill = await db.skills.where('name').equals('Fake Rated Skill').first();
                const skillId = skill ? skill.id : await db.skills.add({ id: 900, name: 'Fake Rated Skill', category: 'Design', createdAt: '2026-09-01T12:00:00.000Z' });
                const t = `2026-10-01T15:${String(minute).padStart(2, '0')}:00.000Z`;
                return db.skillObservations.add({ studentId: sid, skillId, activityId: aid, checkpointId: null, rating: 'Proficient', originalRating: 'Proficient', evidenceType: 'checkpoint_conversation', createdAt: t, updatedAt: t });
            }, { sid, aid: ids.activityId, minute });
            const pcRatingId = await rate(pc.page, ids.studentIds[0], 10);      // the PC rates student 1
            const ipadRatingId = await rate(ipad.page, ids.studentIds[1], 20);  // the iPad rates student 2
            assert(pcRatingId === ipadRatingId, `setup: expected the same id on both devices (${pcRatingId}, ${ipadRatingId})`);
            const push = page => page.evaluate(async () => { driveSync._dirty = true; await driveSync.push(); });
            const pull = page => page.evaluate(() => driveSyncPull.checkOnLoad());
            await push(pc.page); await pull(ipad.page);
            await push(ipad.page); await pull(pc.page);
            const count = page => page.evaluate(() => db.skillObservations.count());
            assert(await count(pc.page) === 2 && await count(ipad.page) === 2, `ratings after a two-way sync: PC ${await count(pc.page)}, iPad ${await count(ipad.page)} (expected 2 and 2)`);
            // An edit on the PC reaches the iPad, whose copy of that rating has a different id
            await pc.page.evaluate(async id => { await db.skillObservations.update(id, { rating: 'Advanced', updatedAt: '2026-10-02T15:00:00.000Z' }); }, pcRatingId);
            await push(pc.page); await pull(ipad.page);
            const onIpad = await ipad.page.evaluate(sid => db.skillObservations.filter(o => o.studentId === sid).toArray(), ids.studentIds[0]);
            assert(onIpad.length === 1 && onIpad[0].rating === 'Advanced', 'edit on the PC: ' + JSON.stringify(onIpad.map(o => o.rating)));
            // A rating whose id is free on the other device keeps that id there
            const newId = await rate(pc.page, ids.studentIds[2], 30);
            await push(pc.page); await pull(ipad.page);
            const kept = await ipad.page.evaluate(id => db.skillObservations.get(id), newId);
            assert(kept && kept.studentId === ids.studentIds[2], 'a free id was not kept');
            assert(real(pc.errors).length === 0 && real(ipad.errors).length === 0, 'page errors: ' + real(pc.errors).concat(real(ipad.errors)).join(' | '));
            await pc.context.close(); await ipad.context.close();
        }
    },
    {
        name: 'skills grading switch: off shows a note, on shows both panels, and it survives a reload and a sync (3-01, i152)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'drive-sync-enabled': 'true', 'drive-sync-password': 'test-sync-pass', 'automations-enabled': 'true' };
            const pc = await openApp(browser, base, { stub, localStorageInit: ls });
            const ids = await seedFakeData(pc.page);
            await pc.page.evaluate(async aid => {
                const skillId = await db.skills.add({ name: 'Fake Graded Skill', category: 'Design', createdAt: new Date().toISOString() });
                await db.activitySkills.add({ activityId: aid, skillId });
            }, ids.activityId);
            const grading = () => pc.page.evaluate(async aid => {
                const act = await db.activities.get(aid);
                const students = excludeDeleted(await db.students.toArray());
                await pages.activityDetail.renderSubmissions(act, students);
                const c = document.getElementById('activity-submissions');
                return { note: !!c.querySelector('.skills-grading-off-note'), obs: c.querySelectorAll('.mastery-obs-section').length, pp: /Professional Practice/.test(c.textContent) };
            }, ids.activityId);
            await pc.page.evaluate(aid => { state.selectedActivity = aid; router.navigate('activity-detail'); }, ids.activityId);
            await pc.page.waitForTimeout(500);
            let g = await grading();
            assert(g.note && g.obs === 0 && !g.pp, 'switch off: ' + JSON.stringify(g));
            // Turn it on in Settings → Classes
            await pc.page.evaluate(() => router.navigate('settings'));
            await pc.page.waitForTimeout(400);
            await pc.page.evaluate(() => pages.settings.renderClasses());
            await pc.page.evaluate(cid => document.querySelector(`.class-skills-grading-toggle[data-class-id="${cid}"]`).click(), ids.classId);
            await pc.page.waitForTimeout(300);
            assert(await pc.page.evaluate(cid => getClassMasteryMode(cid), ids.classId) === 'weighted-average', 'switch on did not write weighted-average');
            g = await grading();
            assert(!g.note && g.obs === 4 && g.pp, 'switch on: ' + JSON.stringify(g));
            // Survives a reload
            await pc.page.reload();
            await waitForStartup(pc.page);
            await pc.page.evaluate(() => router.navigate('settings'));
            await pc.page.evaluate(() => pages.settings.renderClasses());
            const checked = await pc.page.evaluate(cid => document.querySelector(`.class-skills-grading-toggle[data-class-id="${cid}"]`).checked, ids.classId);
            assert(checked, 'the switch was off after a reload');
            // Survives a sync, both ways, even over an older row on the other device
            const ipad = await openApp(browser, base, { stub, localStorageInit: ls });
            await ipad.page.evaluate(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }); });
            await seedFakeData(ipad.page);
            // An old row with no timestamps, written the way data from before 3-17 sits in the database (the hooks would stamp a new write)
            await ipad.page.evaluate(cid => db.transaction('rw', db.settings, async () => { if (typeof syncHooks !== 'undefined') syncHooks.markBulk(); await db.settings.put({ key: 'mastery-mode-' + cid, value: 'off' }); }), ids.classId);
            await pc.page.evaluate(async () => { driveSync._dirty = true; await driveSync.push(); });
            await ipad.page.evaluate(() => driveSyncPull.checkOnLoad());
            assert(await ipad.page.evaluate(cid => getClassMasteryMode(cid), ids.classId) === 'weighted-average', 'the switch did not reach the iPad');
            await ipad.page.evaluate(cid => setClassMasteryMode(cid, 'off'), ids.classId);
            await ipad.page.evaluate(async () => { driveSync._dirty = true; await driveSync.push(); });
            await pc.page.evaluate(() => driveSyncPull.checkOnLoad());
            assert(await pc.page.evaluate(cid => getClassMasteryMode(cid), ids.classId) === 'off', 'turning it off did not reach the PC');
            assert(real(pc.errors).length === 0 && real(ipad.errors).length === 0, 'page errors: ' + real(pc.errors).concat(real(ipad.errors)).join(' | '));
            await pc.context.close(); await ipad.context.close();
        }
    },
    {
        name: 'checkpoint save: waits for saved progress; keeps completedAt; a note saves once; a double tap saves once; all or nothing (3-03, DL5)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            const r = await page.evaluate(async ({ classId, activityId, teamId, cp, s0, s1 }) => {
                const P = pages.checkpoint;
                const out = {};
                const earlier = '2026-09-01T14:00:00.000Z';
                await db.checkpointCompletions.add({ checkpointId: cp, studentId: s0, completed: true, completedAt: earlier, pacing: null, createdAt: earlier, updatedAt: earlier });
                const rows = sid => db.checkpointCompletions.where('[checkpointId+studentId]').equals([cp, sid]).toArray();
                const notes = async () => (await db.notes.where('entityType').equals('checkpoint-observation').toArray()).length;
                // Tap through before the activity's saved progress has loaded (a slow load)
                const load = P._preloadActivityData;
                P._preloadActivityData = async function(a) { await new Promise(res => setTimeout(res, 300)); return load.call(this, a); };
                P.reset();
                P.selectedClass = await db.classes.get(classId);
                const picking = P.selectActivity(await db.activities.get(activityId));
                await P.selectTeam(await db.teams.get(teamId));
                await P.selectCheckpoint(await db.checkpoints.get(cp));
                await picking;
                P._preloadActivityData = load;
                out.shownDone = document.getElementById(`check-${s0}`).checked;
                // Save with a note: the finished student keeps the date they finished
                document.getElementById(`note-${s0}`).value = 'Fake quick note';
                await P.saveProgress();
                out.completedAt = (await rows(s0))[0].completedAt;
                out.notesAfter1 = await notes();
                out.noteBox = document.getElementById(`note-${s0}`).value;
                await new Promise(res => setTimeout(res, 5));
                await P.saveProgress();
                out.notesAfter2 = await notes();
                out.completedAt2 = (await rows(s0))[0].completedAt;
                // Double tap with a student who has no row yet: one row
                await db.checkpointCompletions.where('[checkpointId+studentId]').equals([cp, s1]).delete();
                document.getElementById(`check-${s1}`).checked = true;
                await Promise.all([P.saveProgress(), P.saveProgress()]);
                out.s1Rows = (await rows(s1)).length;
                // A failure part-way saves nothing
                document.getElementById(`check-${s0}`).checked = false;
                document.getElementById(`note-${s1}`).value = 'Fake second note';
                const add = db.notes.add;
                db.notes.add = () => Promise.reject(new Error('fake write failure'));
                await P.saveProgress();
                db.notes.add = add;
                out.afterFailure = (await rows(s0))[0].completed;
                out.noteKept = document.getElementById(`note-${s1}`).value;
                return out;
            }, { classId: ids.classId, activityId: ids.activityId, teamId: ids.teamId, cp: ids.checkpointIds[0], s0: ids.studentIds[0], s1: ids.studentIds[1] });
            assert(r.shownDone === true, 'a checkpoint tapped before loading showed a finished student as not done');
            assert(r.completedAt === '2026-09-01T14:00:00.000Z' && r.completedAt2 === r.completedAt, 'completedAt changed on save: ' + JSON.stringify(r));
            assert(r.notesAfter1 === 1 && r.notesAfter2 === 1 && r.noteBox === '', 'quick note saved again: ' + JSON.stringify(r));
            assert(r.s1Rows === 1, `double tap wrote ${r.s1Rows} completion rows`);
            assert(r.afterFailure === true && r.noteKept === 'Fake second note', 'a failed save changed some rows: ' + JSON.stringify(r));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'webhook: a lost reply is retried once for safe actions, never for sends; a banner after the second failure (2-04)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'drive-sync-enabled': 'true', 'drive-sync-password': 'test-sync-pass', 'automations-enabled': 'true' };
            const { page, errors, context } = await openApp(browser, base, { stub, localStorageInit: ls });
            const lost = { raw: '<!DOCTYPE html><html><body>Sorry, unable to open the file at this time.</body></html>' };
            const banner = () => page.evaluate(() => {
                const el = document.getElementById('webhook-banner');
                return el ? [...el.querySelectorAll('.webhook-banner__row')].map(r => r.dataset.kind).join() : '';
            });
            const call = action => page.evaluate(async action => {
                const r = await webhookFetch(localStorage.getItem('webhook_wildcat'), { method: 'POST', body: JSON.stringify({ action, token: 'test-token' }) });
                return r.json();
            }, action);

            // Pull: the first reply is lost, the retry gets through; no banner
            // Let the app's own start-up pull happen and finish first
            for (let i = 0; i < 100 && stub.callsFor('load_from_drive').length === 0; i++) await page.waitForTimeout(100);
            await page.waitForTimeout(300);
            stub.calls = [];
            stub.sequence('load_from_drive', [lost]);
            const pull1 = await page.evaluate(() => driveSyncPull.checkOnLoad());
            assert(stub.callsFor('load_from_drive').length === 2, `load_from_drive calls: ${stub.callsFor('load_from_drive').length} (expected 2)`);
            assert(pull1 !== 'failed' && await banner() === '', `pull after one lost reply: ${pull1}, banner "${await banner()}"`);

            // The stray GET's "please retry" answer counts as lost too
            stub.sequence('check_form_submissions', [{ status: 'error', message: 'GET not supported; please retry' }]);
            const form = await call('check_form_submissions');
            assert(stub.callsFor('check_form_submissions').length === 2 && form.status === 'success', 'please-retry not retried: ' + JSON.stringify(form));

            // Send feedback: never retried; the answer says it may have gone; the email banner shows
            stub.sequence('send_feedback', [lost]);
            const fb = await call('send_feedback');
            assert(stub.callsFor('send_feedback').length === 1, `send_feedback calls: ${stub.callsFor('send_feedback').length} (expected 1)`);
            assert(fb.status === 'error' && /may have gone through/.test(fb.message), 'send answer: ' + JSON.stringify(fb));
            assert(await banner() === 'email', `banner after a lost send: "${await banner()}"`);

            // Pull lost twice: the sync banner appears after the second failure...
            stub.calls = [];
            stub.sequence('load_from_drive', [lost, lost]);
            const pull2 = await page.evaluate(() => driveSyncPull.checkOnLoad());
            assert(stub.callsFor('load_from_drive').length === 2 && pull2 === 'failed', `second pull: ${pull2}, ${stub.callsFor('load_from_drive').length} calls`);
            assert(await banner() === 'email,sync', `banner after two lost pulls: "${await banner()}"`);
            // ...and clears on the next good sync; the email one stays until she closes it
            await page.evaluate(async () => { driveSync._dirty = true; await driveSync.push(); });
            assert(await banner() === 'email', `banner after a good sync: "${await banner()}"`);
            const text = () => page.evaluate(() => document.getElementById('webhook-banner').textContent);
            assert(/Card E/.test(await text()), 'no card letter on the email banner');
            // A script error on a background sync goes on the sync banner, with the card letter
            stub.calls = [];
            stub.reply('save_to_drive', { status: 'error', message: 'Unauthorized' });
            await page.evaluate(async () => { driveSync._dirty = true; await driveSync.push(); });
            assert(stub.callsFor('save_to_drive').length === 1, 'a script error was retried');
            assert(await banner() === 'email,sync' && /Unauthorized[\s\S]*Card D/.test(await text()), 'script error banner: ' + await text());
            delete stub.replies.save_to_drive;
            await page.evaluate(async () => { driveSync._dirty = true; await driveSync.push(); });
            assert(await banner() === 'email', `banner after the next good sync: "${await banner()}"`);
            await page.evaluate(() => document.querySelector('#webhook-banner .webhook-banner__close').click());
            assert(await banner() === '', 'the banner did not close');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'checkpoint ratings: only changes are written; one question about lower levels; deselecting removes the rating (3-03, DL6)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            const r = await page.evaluate(async ({ classId, activityId, teamId, cp, s0, s1 }) => {
                const P = pages.checkpoint;
                const now = new Date().toISOString();
                const skillId = await db.skills.add({ name: 'Fake Checkpoint Skill', category: 'Design', createdAt: now });
                await db.checkpoints.update(cp, { skillsAssessable: [skillId] });
                await db.skillLevels.add({ studentId: s0, skillId, level: 'Advanced', createdAt: now, updatedAt: now });
                await db.skillLevels.add({ studentId: s1, skillId, level: 'Proficient', createdAt: now, updatedAt: now });
                let asked = 0;
                window.confirm = () => { asked++; return false; };
                const open = async () => {
                    P.reset();
                    P.selectedClass = await db.classes.get(classId);
                    await P.selectActivity(await db.activities.get(activityId));
                    await P.selectTeam(await db.teams.get(teamId));
                    await P.selectCheckpoint(await db.checkpoints.get(cp));
                };
                const obs = () => db.skillObservations.where('activityId').equals(activityId).toArray();
                const out = {};
                await open();
                P.setSkillRating(s0, skillId, 'Proficient');
                P.setSkillRating(s1, skillId, 'Beginning');
                await P.saveProgress();
                out.askedFirst = asked;
                out.levelKept = (await db.skillLevels.where('studentId').equals(s0).first()).level;
                const before = (await obs()).map(o => o.updatedAt).join();
                // Reopen and save without changes: nothing rewritten, nothing asked
                await open();
                await new Promise(res => setTimeout(res, 5));
                asked = 0;
                await P.saveProgress();
                out.askedResave = asked;
                out.rewritten = (await obs()).map(o => o.updatedAt).join() !== before;
                // Deselect student 2's rating (tap it again) and save: it's removed
                P.setSkillRating(s1, skillId, 'Beginning');
                await P.saveProgress();
                const all = await obs();
                out.s1Live = all.filter(o => o.studentId === s1 && !o.deletedAt).length;
                out.s1Deleted = all.filter(o => o.studentId === s1 && o.deletedAt).length;
                await open();
                out.shownAfterRemove = !!document.querySelector(`#skill-btn-${s1}-${skillId}-B.active`);
                // Rating again adds a new row (a removed one isn't brought back)
                P.setSkillRating(s1, skillId, 'Developing');
                await P.saveProgress();
                const again = (await obs()).filter(o => o.studentId === s1);
                out.s1Rows = again.length;
                out.s1LiveRating = again.filter(o => !o.deletedAt).map(o => o.rating).join();
                // A removed rating that set the current level: the level stays, and she's told
                const toasts = () => document.getElementById('toast-container').textContent;
                out.noticeBefore = /The level stays at/.test(toasts());
                P.setSkillRating(s0, skillId, 'Advanced');
                await P.saveProgress();                       // sets student 1's level from this assignment
                P.setSkillRating(s0, skillId, 'Advanced');    // tap again: removed
                await P.saveProgress();
                out.notice = /The level stays at Advanced; change it on the Skills page/.test(toasts());
                out.levelAfter = (await db.skillLevels.where('studentId').equals(s0).first()).level;
                return out;
            }, { classId: ids.classId, activityId: ids.activityId, teamId: ids.teamId, cp: ids.checkpointIds[0], s0: ids.studentIds[0], s1: ids.studentIds[1] });
            assert(r.askedFirst === 1 && r.levelKept === 'Advanced', 'lower-level question: ' + JSON.stringify(r));
            assert(r.askedResave === 0 && !r.rewritten, 'an unchanged save rewrote ratings: ' + JSON.stringify(r));
            assert(r.s1Live === 0 && r.s1Deleted === 1 && !r.shownAfterRemove, 'deselect: ' + JSON.stringify(r));
            assert(r.s1Rows === 2 && r.s1LiveRating === 'Developing', 'rating again: ' + JSON.stringify(r));
            assert(!r.noticeBefore && r.notice && r.levelAfter === 'Advanced', 'level-stays notice: ' + JSON.stringify(r));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'form import: one import for both buttons; D2 attempts; own feedback field; question numbers match the form (3-02)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'automations-enabled': 'true' };
            const { page, errors, context } = await openApp(browser, base, { stub, localStorageInit: ls });
            const ids = await seedFakeData(page);
            await page.evaluate(async aid => { await db.activities.update(aid, { formSpreadsheetId: 'FAKE-SHEET-000000000000', scoringType: 'points', defaultPoints: 10 }); }, ids.activityId);
            const reply = ts => ({ status: 'success', headers: [], submissions: [{ timestamp: ts, email: 'ada@example.test', totalScore: 1, totalPossible: 2, answers: [
                { question: 'Fake Q1', answer: 'A', score: 1, maxPoints: 1 },
                { question: 'Fake Q2', answer: 'B', score: 0, maxPoints: 1, autoFeedback: 'Look again at the fake diagram.' }] }] });
            const t1 = '2026-09-20T13:00:00.000Z';
            stub.reply('check_form_submissions', reply(t1));
            const dash = () => page.evaluate(async () => { const b = document.createElement('button'); await pages.dashboard.checkAllFormSubmissions(b); });
            const onPage = () => page.evaluate(async aid => { state.selectedActivity = aid; await pages.activityDetail.checkFormSubmissions(); }, ids.activityId);
            const rec = () => page.evaluate(({ aid, sid }) => db.submissions.where('activityId').equals(aid).filter(s => s.studentId === sid).first(), { aid: ids.activityId, sid: ids.studentIds[0] });
            await dash();
            let r = await rec();
            assert(r.status === 'submitted' && r.formResponses && /^Q2 — Fake Q2:/.test(r.formFeedback || '') && !r.feedback, 'first import: ' + JSON.stringify({ s: r.status, ff: r.formFeedback, f: r.feedback }));
            // She writes feedback and grades it
            await page.evaluate(async ({ aid, sid }) => { await pages.activityDetail.saveFeedback(aid, sid, 'Fake teacher comment'); await pages.activityDetail.saveSubmission(aid, sid, 'graded', 8); }, { aid: ids.activityId, sid: ids.studentIds[0] });
            const gradedAt = (await rec()).updatedAt;
            // Re-import the same response from both buttons: graded work doesn't change at all
            await dash(); await onPage();
            r = await rec();
            assert(r.status === 'graded' && r.score === 8 && r.feedback === 'Fake teacher comment' && r.updatedAt === gradedAt, 're-import changed graded work: ' + JSON.stringify({ s: r.status, sc: r.score, f: r.feedback }));
            // A later response (from the activity page this time) starts attempt 2, ungraded
            stub.reply('check_form_submissions', reply('2026-09-25T13:00:00.000Z'));
            await onPage();
            r = await rec();
            assert(r.status === 'submitted' && r.score === null && r.feedback === '' && r.attempts && r.attempts.length === 1, 'later response: ' + JSON.stringify({ s: r.status, sc: r.score, n: r.attempts && r.attempts.length }));
            assert(r.attempts[0].score === 8 && r.attempts[0].feedback === 'Fake teacher comment' && /^Q2 —/.test(r.attempts[0].formFeedback || ''), 'attempt 1 not kept: ' + JSON.stringify(r.attempts[0]));
            // The email carries the form's feedback, then hers; an old combined field isn't sent twice
            const txt = await page.evaluate(() => formImport.emailFeedback({ formFeedback: 'Q2 — X:\n  fix', feedback: 'Q2 — X:\n  fix\n\n---\n\nFake teacher comment' }));
            assert(txt === 'Q2 — X:\n  fix\n\n---\n\nFake teacher comment', 'email text: ' + JSON.stringify(txt));
            // With the P29c v3 script, numbers are each question's place in the form, not the order sent
            const qn = await page.evaluate(() => {
                const fr = formImport.buildFormResponses({ answers: [
                    { question: 'Fake graded', answer: 'A', score: 0, maxPoints: 1, autoFeedback: 'Fake hint 1', formIndex: 2 },
                    { question: 'Fake paragraph', answer: 'B', autoFeedback: 'Fake hint 2', formIndex: 0 }] }, 'now');
                return { text: formImport.formFeedbackText(fr), kept: fr.answers.map(a => a.formIndex).join() };
            });
            assert(qn.kept === '2,0' && qn.text === 'Q1 — Fake paragraph:\n  Fake hint 2\n\nQ3 — Fake graded:\n  Fake hint 1', 'form numbers: ' + JSON.stringify(qn));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: "form import: auto-scored work is graded once its skills are rated and its form is in; portfolio work waits (3-02, i023, B12)",
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'automations-enabled': 'true' };
            const { page, errors, context } = await openApp(browser, base, { stub, localStorageInit: ls });
            const ids = await seedFakeData(page);
            const setup = await page.evaluate(async ({ aid, classId }) => {
                const now = new Date().toISOString();
                const skillId = await db.skills.add({ name: 'Fake Auto Skill', category: 'Design', createdAt: now });
                await db.activities.update(aid, { formSpreadsheetId: 'FAKE-SHEET-000000000000' });
                await db.activitySkills.add({ activityId: aid, skillId });
                const pid = await db.activities.add({ name: 'Fake Portfolio Activity', classId, startDate: getTodayString(), endDate: getTodayString(), status: 'active', scoringType: 'complete-incomplete', formSpreadsheetId: 'FAKE-SHEET-000000000000', portfolioPrompts: [{ title: 'Fake prompt', promptText: 'x' }], createdAt: now, updatedAt: now });
                await db.activitySkills.add({ activityId: pid, skillId });
                return { skillId, pid };
            }, { aid: ids.activityId, classId: ids.classId });
            stub.reply('check_form_submissions', { status: 'success', headers: [], submissions: [{ timestamp: '2026-09-20T13:00:00.000Z', email: 'ada@example.test', answers: [{ question: 'Fake conclusion', answer: 'A' }] }] });
            const run = () => page.evaluate(async () => { const b = document.createElement('button'); await pages.dashboard.checkAllFormSubmissions(b); });
            const st = aid => page.evaluate(({ aid, sid }) => db.submissions.where('activityId').equals(aid).filter(s => s.studentId === sid).first(), { aid, sid: ids.studentIds[0] });
            await run();
            assert((await st(ids.activityId)).status === 'submitted', 'graded before the skill was rated');
            // The skill is rated at a checkpoint on both activities
            await page.evaluate(async ({ aid, pid, sid, skillId }) => {
                for (const a of [aid, pid]) await db.skillObservations.add({ studentId: sid, skillId, activityId: a, checkpointId: null, rating: 'Proficient', originalRating: 'Proficient', evidenceType: 'checkpoint_conversation', createdAt: new Date().toISOString() });
            }, { aid: ids.activityId, pid: setup.pid, sid: ids.studentIds[0], skillId: setup.skillId });
            await run();
            const a = await st(ids.activityId), p = await st(setup.pid);
            assert(a.status === 'graded' && a.gradedBy === 'auto', 'fully assessed work not auto-graded: ' + JSON.stringify({ s: a.status, by: a.gradedBy }));
            assert(p.status === 'submitted', 'portfolio work was auto-graded');
            // She sets it back to submitted: the grading tab doesn't re-grade it (DL12)
            await page.evaluate(async ({ aid, sid }) => {
                await pages.activityDetail.saveSubmission(aid, sid, 'submitted', null);
                state.selectedActivity = aid;
                await pages.activityDetail.renderSubmissions(await db.activities.get(aid), excludeDeleted(await db.students.toArray()));
            }, { aid: ids.activityId, sid: ids.studentIds[0] });
            assert((await st(ids.activityId)).status === 'submitted', 'the grading tab re-graded work she set back');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'grading: a cleared score clears; a status she sets stays; feedback "sent today" is per activity (3-02, DL12, BUG8)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            const r = await page.evaluate(async ({ aid, sid, classId }) => {
                await db.activities.update(aid, { scoringType: 'points', defaultPoints: 10 });
                state.selectedActivity = aid;
                const get = () => db.submissions.where('activityId').equals(aid).filter(s => s.studentId === sid).first();
                const students = async () => excludeDeleted(await db.students.toArray());
                await pages.activityDetail.saveSubmission(aid, sid, 'graded', 7);
                const graded = (await get()).status;
                await pages.activityDetail.saveSubmission(aid, sid, 'submitted', null);            // she sets it back
                await pages.activityDetail.renderSubmissions(await db.activities.get(aid), await students());
                const afterRender = (await get()).status;
                await pages.activityDetail.saveSubmission(aid, sid, 'graded', parseFloat(''));      // the score box cleared
                const cleared = await get();
                // Feedback sent today for another activity doesn't count for this one
                const other = await db.activities.add({ name: 'Fake Other Activity', classId, startDate: getTodayString(), endDate: getTodayString(), status: 'active', createdAt: new Date().toISOString() });
                await db.notes.add(formImport.feedbackLog({ id: other, name: 'Fake Other Activity' }, sid));
                const here = (await formImport.feedbackSentToday(await db.activities.get(aid))).has(sid);
                const there = (await formImport.feedbackSentToday(await db.activities.get(other))).has(sid);
                return { graded, afterRender, clearedStatus: cleared.status, clearedScore: cleared.score, here, there };
            }, { aid: ids.activityId, sid: ids.studentIds[0], classId: ids.classId });
            assert(r.graded === 'graded' && r.afterRender === 'submitted', `status she set: ${JSON.stringify(r)}`);
            assert(r.clearedScore === null && r.clearedStatus !== 'graded', `cleared score: ${JSON.stringify(r)}`);
            assert(!r.here && r.there, `sent today: ${JSON.stringify(r)}`);
            // Form fields: a non-Forms link is refused; a pasted Sheets link gives its id
            const f = await page.evaluate(() => ({
                bad: formImport.cleanFormFields('https://example.test/form', ''),
                ok: formImport.cleanFormFields('https://docs.google.com/forms/d/e/1FAIpQLSfake/viewform', 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz_123/edit#gid=0')
            }));
            assert(f.bad.error && f.ok.formSpreadsheetId === '1AbCdEfGhIjKlMnOpQrStUvWxYz_123', 'form fields: ' + JSON.stringify(f));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'form import: a lost reply on Check Submissions is retried once, and the import still lands (2-04 + 3-02)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'automations-enabled': 'true' };
            const { page, errors, context } = await openApp(browser, base, { stub, localStorageInit: ls });
            const ids = await seedFakeData(page);
            await page.evaluate(async aid => { await db.activities.update(aid, { formSpreadsheetId: 'FAKE-SHEET-000000000000', scoringType: 'points', defaultPoints: 10 }); }, ids.activityId);
            stub.reply('check_form_submissions', { status: 'success', headers: [], submissions: [{ timestamp: '2026-09-20T13:00:00.000Z', email: 'ada@example.test', totalScore: 1, totalPossible: 1, answers: [{ question: 'Fake Q1', answer: 'A', score: 1, maxPoints: 1 }] }] });
            const lost = { raw: '<!DOCTYPE html><html><body>Sorry, unable to open the file at this time.</body></html>' };
            const rec = () => page.evaluate(({ aid, sid }) => db.submissions.where('activityId').equals(aid).filter(s => s.studentId === sid).first(), { aid: ids.activityId, sid: ids.studentIds[0] });
            // The grading tab's button
            stub.calls = [];
            stub.sequence('check_form_submissions', [lost]);
            await page.evaluate(async aid => { state.selectedActivity = aid; await pages.activityDetail.checkFormSubmissions(); }, ids.activityId);
            assert(stub.callsFor('check_form_submissions').length === 2, `grading tab: ${stub.callsFor('check_form_submissions').length} call(s) (expected 2)`);
            assert(await rec(), 'grading tab: the retried reply was not imported');
            // The dashboard's button
            await page.evaluate(({ aid, sid }) => db.submissions.where('activityId').equals(aid).filter(s => s.studentId === sid).delete(), { aid: ids.activityId, sid: ids.studentIds[0] });
            stub.calls = [];
            stub.sequence('check_form_submissions', [lost]);
            await page.evaluate(async () => { const b = document.createElement('button'); await pages.dashboard.checkAllFormSubmissions(b); });
            assert(stub.callsFor('check_form_submissions').length === 2, `dashboard: ${stub.callsFor('check_form_submissions').length} call(s) (expected 2)`);
            assert(await rec(), 'dashboard: the retried reply was not imported');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'form link: an old non-Forms link saves unchanged through Full Edit; a changed one is still refused (3-02 follow-up, B7)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base, {});
            const ids = await seedFakeData(page);
            const OLD_URL = 'https://example.test/old-student-link', OLD_SHEET = 'old-sheet-1';
            await page.evaluate(({ aid, u, s }) => db.activities.update(aid, { formUrl: u, formSpreadsheetId: s }), { aid: ids.activityId, u: OLD_URL, s: OLD_SHEET });
            await page.evaluate(() => { window.__toasts = []; const orig = ui.showToast.bind(ui); ui.showToast = (m, t, d) => { window.__toasts.push({ m, t }); return orig(m, t, d); }; });
            const open = async () => {
                await page.evaluate(id => modals.openFullEdit(id), ids.activityId);
                await page.waitForFunction(v => document.getElementById('fe-form-url')?.value === v, OLD_URL, { timeout: 5000 });
                await page.waitForTimeout(300);
            };
            const stored = () => page.evaluate(id => db.activities.get(id).then(a => ({ u: a.formUrl, s: a.formSpreadsheetId, d: a.description })), ids.activityId);
            // Unchanged old values: an unrelated edit saves, and the link and sheet id stay exactly as they were
            await open();
            await page.evaluate(() => { document.getElementById('fe-description').value = 'Fake edited description'; });
            await page.evaluate(() => pages.activityEdit.save());
            await page.waitForTimeout(800);
            let r = await stored();
            assert(r.d === 'Fake edited description' && r.u === OLD_URL && r.s === OLD_SHEET, 'unchanged old link did not save as it was: ' + JSON.stringify(r) + ' toasts: ' + JSON.stringify(await page.evaluate(() => window.__toasts)));
            // A changed link that isn't a Forms link is still refused, with the same message, and nothing is saved
            await open();
            await page.evaluate(() => { document.getElementById('fe-form-url').value = 'https://example.test/another-link'; document.getElementById('fe-description').value = 'Should not save'; });
            await page.evaluate(() => { window.__toasts = []; });
            await page.evaluate(() => pages.activityEdit.save());
            await page.waitForTimeout(500);
            const t = await page.evaluate(() => window.__toasts);
            r = await stored();
            assert(t.some(x => x.t === 'error' && /^The Google Form URL must be a Google Forms link .*Nothing was saved\.$/.test(x.m)), 'no refusal for a changed non-Forms link: ' + JSON.stringify(t));
            assert(r.u === OLD_URL && r.d === 'Fake edited description', 'a refused save changed the record: ' + JSON.stringify(r));
            // A changed sheet id is checked too
            await open();
            await page.evaluate(() => { document.getElementById('fe-form-spreadsheet').value = 'short'; window.__toasts = []; });
            await page.evaluate(() => pages.activityEdit.save());
            await page.waitForTimeout(500);
            assert((await page.evaluate(() => window.__toasts)).some(x => x.t === 'error' && /Spreadsheet ID should be the long id/.test(x.m)), 'a changed bad sheet id was not refused');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'form link: an old non-Forms link saves unchanged through the quick edit; a changed one is still refused (3-02 follow-up, B7)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base, {});
            const ids = await seedFakeData(page);
            const OLD_URL = 'https://example.test/old-student-link', OLD_SHEET = 'old-sheet-1';
            await page.evaluate(({ aid, u, s }) => db.activities.update(aid, { formUrl: u, formSpreadsheetId: s }), { aid: ids.activityId, u: OLD_URL, s: OLD_SHEET });
            await page.evaluate(() => { window.__toasts = []; const orig = ui.showToast.bind(ui); ui.showToast = (m, t, d) => { window.__toasts.push({ m, t }); return orig(m, t, d); }; });
            const stored = () => page.evaluate(id => db.activities.get(id).then(a => ({ u: a.formUrl, s: a.formSpreadsheetId, d: a.description })), ids.activityId);
            const open = async () => {
                await page.evaluate(id => modals.showEditActivity(id), ids.activityId);
                await page.waitForFunction(v => document.getElementById('activity-form-url')?.value === v, OLD_URL, { timeout: 5000 });
                await page.waitForTimeout(300);
            };
            await open();
            await page.evaluate(() => { document.getElementById('activity-description').value = 'Fake quick edit'; });
            await page.evaluate(() => modals.saveActivity());
            await page.waitForTimeout(800);
            let r = await stored();
            assert(r.d === 'Fake quick edit' && r.u === OLD_URL && r.s === OLD_SHEET, 'unchanged old link did not save as it was: ' + JSON.stringify(r) + ' toasts: ' + JSON.stringify(await page.evaluate(() => window.__toasts)));
            await open();
            await page.evaluate(() => { document.getElementById('activity-form-url').value = 'https://example.test/another-link'; document.getElementById('activity-description').value = 'Should not save'; window.__toasts = []; });
            await page.evaluate(() => modals.saveActivity());
            await page.waitForTimeout(500);
            const t = await page.evaluate(() => window.__toasts);
            r = await stored();
            assert(t.some(x => x.t === 'error' && /^The Google Form URL must be a Google Forms link .*Nothing was saved\.$/.test(x.m)), 'no refusal for a changed non-Forms link: ' + JSON.stringify(t));
            assert(r.u === OLD_URL && r.d === 'Fake quick edit', 'a refused save changed the record: ' + JSON.stringify(r));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'auto-check: fires once when its time has passed, not only on the exact minute (3-02, BUG21)',
        fn: async ({ browser, base }) => {
            const ls = { 'automations-enabled': 'true', 'auto-check-time-1': '08:00', 'auto-check-time-2': '12:00' };
            const { page, errors, context } = await openApp(browser, base, { localStorageInit: ls, clockTime: '2026-10-01T16:30:00.000Z' });   // 12:30 in New York
            await page.evaluate(() => { window.__checks = 0; pages.dashboard.checkAllFormSubmissions = async () => { window.__checks++; }; pages.dashboard.startAutoCheckTimer(); });
            await page.clock.runFor(61000);
            const first = await page.evaluate(() => window.__checks);
            await page.clock.runFor(180000);
            const later = await page.evaluate(() => window.__checks);
            assert(first === 1 && later === 1, `checks run: ${first} then ${later} (expected 1 and 1)`);
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
    },
    {
        name: 'dashboard: Wildcat Emails lists pending tasks instead of "Error loading tasks" (punch-list i148)',
        fn: async ({ browser, base }) => {
            // Automations off, so the dashboard shows the manual Wildcat email list
            const { page, errors, logs, context } = await openApp(browser, base);
            const { studentIds } = await seedFakeData(page);
            await page.evaluate(async sid => {
                await db.wildcatSchedule.add({ studentId: sid, targetDate: getTodayString(), status: 'pending', createdAt: new Date().toISOString() });
                await pages.dashboard.loadWildcatTasks();
            }, studentIds[0]);
            const withTask = await page.textContent('#wildcat-tasks-list');
            assert(!/Error loading tasks/.test(withTask), 'the Wildcat Emails box shows "Error loading tasks"');
            assert(/Ada Tester/.test(withTask) && /Sign-up Notification/.test(withTask), 'the pending sign-up email for the fake student is not listed');

            // With nothing pending, the box says so
            await page.evaluate(async () => { await db.wildcatSchedule.clear(); await pages.dashboard.loadWildcatTasks(); });
            const empty = await page.textContent('#wildcat-tasks-list');
            assert(/No pending .* emails/.test(empty), `expected the "No pending … emails" message, got: ${empty.trim().slice(0, 80)}`);

            const logged = logs.filter(l => /Error loading wildcat tasks/.test(l));
            assert(logged.length === 0, 'console: ' + logged.join(' | '));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'dashboard: the Wildcat Emails box hides when automations are on and shows when they are off (i148)',
        fn: async ({ browser, base }) => {
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'automations-enabled': 'true' };
            const { page, errors, context } = await openApp(browser, base, { localStorageInit: ls });
            await seedFakeData(page);
            const isHidden = () => page.evaluate(() => {
                const s = document.getElementById('wildcat-tasks-list').closest('section');
                return !!s && s.classList.contains('hidden');
            });
            // Automations on: the dashboard opens with the box hidden
            await page.evaluate(() => router.navigate('dashboard'));
            await page.waitForTimeout(500);
            assert(await isHidden(), 'automations on, but the Wildcat Emails box is showing');

            // Automations off: the box shows
            await page.evaluate(async () => { localStorage.setItem('automations-enabled', 'false'); await pages.dashboard.loadWildcatTasks(); });
            assert(!(await isHidden()), 'automations off, but the Wildcat Emails box is hidden');

            // And back on: hidden again
            await page.evaluate(async () => { localStorage.setItem('automations-enabled', 'true'); await pages.dashboard.loadWildcatTasks(); });
            assert(await isHidden(), 'automations switched back on, but the Wildcat Emails box is showing');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'wildcat roster: only this year\'s Wildcat enrollment makes a student permanent; an old-year or removed one leaves them a drop-in (i132)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const { studentIds: s } = await seedFakeData(page);
            const r = await page.evaluate(async s => {
                const now = new Date().toISOString();
                const year = await getActiveSchoolYear();
                const today = getTodayString();
                // Liam: removed Wildcat enrollment; Maya: last year's only; Noah: this year's (permanent)
                await db.enrollments.add({ studentId: s[1], period: 'wildcat', schoolYear: year, createdAt: now, deletedAt: now });
                await db.enrollments.add({ studentId: s[2], period: 'wildcat', schoolYear: 'old-year-2019', createdAt: now });
                await db.enrollments.add({ studentId: s[3], period: 'wildcat', schoolYear: year, createdAt: now });
                for (const id of [s[1], s[2], s[3]]) await db.attendance.add({ studentId: String(id), date: today, period: 'wildcat', status: 'absent', createdAt: now });
                router.navigate('dashboard');
                await new Promise(res => setTimeout(res, 400));
                await pages.dashboard.loadWildcatRoster();
                const roster = document.getElementById('wildcat-noshows-list').textContent;
                await pages.dashboard.loadWildcatTasks();
                const tasks = document.getElementById('wildcat-tasks-list').textContent;
                // Notify Teachers: read the confirm text, send nothing
                localStorage.setItem('automations-enabled', 'true');
                localStorage.setItem('webhook_wildcat', 'https://script.google.com/macros/s/TEST/exec');
                let asked = '';
                window.confirm = m => { asked = m; return false; };
                await pages.dashboard.sendRosterNotifications();
                return { roster, tasks, asked };
            }, s);
            for (const [where, text] of Object.entries(r)) {
                assert(/Liam/.test(text) && /Maya/.test(text), `${where}: a student with only a removed or old-year Wildcat enrollment is missing: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
                assert(!/Noah/.test(text), `${where}: this year's Wildcat student is listed as a drop-in: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
            }
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'full edit: the Slides and Instruction Steps helper texts say steps win over Slides (i185)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const { activityId } = await seedFakeData(page);
            await page.evaluate(id => modals.openFullEdit(id), activityId);
            await page.waitForFunction(() => document.getElementById('fe-name')?.value === 'Test Activity 1', null, { timeout: 5000 });
            const helpers = await page.evaluate(() => {
                const list = document.getElementById('fe-instruction-steps-list');
                const group = list.closest('.form-group');
                const slides = [...document.querySelectorAll('.form-helper')].find(p => /Google Slides workbook/.test(p.textContent));
                return { steps: group.querySelector('.form-helper').textContent, slides: slides ? slides.textContent : '' };
            });
            assert(helpers.steps === 'Shown as a step-by-step carousel whenever there is at least one step (a Slides URL then becomes an "Example Notebook →" link). Leave a role blank to hide it on that step.', 'steps helper: ' + helpers.steps);
            assert(helpers.slides === 'Link to the Google Slides workbook. The widget embeds it only when there are no instruction steps; with steps, it shows as an "Example Notebook →" link.', 'slides helper: ' + helpers.slides);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'sync paused: a left-over "Sync paused" line has a Clear button on the sync card; Cancel keeps it; nothing else changes (i177)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await seedFakeData(page);
            const openData = async () => { await page.evaluate(() => router.navigate('settings')); await page.waitForTimeout(300); await page.click('button.tab-btn:has-text("Data")'); await page.waitForTimeout(400); };
            await openData();
            const state = () => page.evaluate(() => ({
                stored: localStorage.getItem('drive-sync-paused'),
                line: document.getElementById('drive-sync-paused').offsetParent !== null ? document.getElementById('drive-sync-paused').textContent : '',
                button: !!document.getElementById('drive-sync-paused-clear') && document.getElementById('drive-sync-paused-clear').offsetParent !== null
            }));
            let s = await state();
            assert(!s.stored && !s.line && !s.button, 'with nothing paused, no line and no button: ' + JSON.stringify(s));
            const before = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().filter(k => k !== 'drive-sync-paused').map(k => [k, localStorage.getItem(k)])));
            await page.evaluate(() => driveSync.setSyncPaused('Sync paused: the fake device\'s Drive copy is from before the skills migration. Nothing was changed.'));
            await openData();
            s = await state();
            assert(/^⛔ Sync paused/.test(s.line) && s.button, 'paused: the line and the Clear button show: ' + JSON.stringify(s));
            // Cancel keeps it
            await page.evaluate(() => { window.__asked = []; window.confirm = m => { window.__asked.push(m); return false; }; });
            await page.click('#drive-sync-paused-clear');
            s = await state();
            assert(s.stored && s.button, 'Cancel cleared the message');
            // OK clears the line and the button, and nothing else in this device's settings
            await page.evaluate(() => { window.confirm = m => { window.__asked.push(m); return true; }; });
            await page.click('#drive-sync-paused-clear');
            s = await state();
            const asked = await page.evaluate(() => window.__asked);
            assert(!s.stored && !s.line && !s.button, 'OK did not clear: ' + JSON.stringify(s));
            assert(asked.length === 2 && /^Clear the "Sync paused" message\? Nothing else changes\./.test(asked[0]), 'the question: ' + JSON.stringify(asked));
            const after = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().filter(k => k !== 'drive-sync-paused').map(k => [k, localStorage.getItem(k)])));
            assert(after === before, 'other settings changed');
            const check = await page.evaluate(async () => { await pages.settings.renderDataCheck(); return pages.settings._dataCheckText; });
            assert(!/Sync paused/.test(check), 'the Data check still shows Sync paused');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'skill library: a duplicate name is refused; an unlisted category is kept on save; the analytics header keeps commas (i111)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await seedFakeData(page);
            const ids = await page.evaluate(async () => {
                const now = new Date().toISOString();
                const a = await db.skills.add({ name: 'Fake Skill One', category: 'Design', createdAt: now });
                const p = await db.skills.add({ name: 'Fake Teamwork', category: 'Professional', createdAt: now });
                const r = await db.skills.add({ name: 'Fake Retired Skill', category: 'Design', createdAt: now, retiredAt: now });
                const c = await db.skills.add({ name: 'Fake Prototyping, Testing & Iteration', category: 'Design', createdAt: now });
                await db.settings.delete('skill-categories');   // the default list, which has no "Professional"
                router.navigate('skills');
                return { a, p, r, c };
            });
            await page.waitForTimeout(300);
            const toasts = [];
            await page.exposeFunction('__toast', m => toasts.push(m));
            await page.evaluate(() => { const o = ui.showToast.bind(ui); ui.showToast = (m, t, d) => { window.__toast(m); return o(m, t, d); }; });
            const count = () => page.evaluate(() => db.skills.count());
            const n0 = await count();
            // (a) a new skill with an existing name, other capitals and spaces: refused
            await page.evaluate(async () => { await pages.skills.showAddSkillModal(); document.getElementById('skill-name').value = '  fake SKILL one '; await pages.skills.saveSkill(); });
            assert(await count() === n0 && toasts.includes('There is already a skill called "Fake Skill One". Use a different name. Nothing was saved.'), 'duplicate add: ' + JSON.stringify(toasts));
            // …a retired skill's name too
            await page.evaluate(async () => { await pages.skills.showAddSkillModal(); document.getElementById('skill-name').value = 'Fake retired skill'; await pages.skills.saveSkill(); });
            assert(await count() === n0 && toasts.some(t => /"Fake Retired Skill" \(in the Retired or Merged list\)/.test(t)), 'retired name: ' + JSON.stringify(toasts));
            // …renaming one skill to another's name
            await page.evaluate(async id => { await pages.skills.showEditSkillModal(id); document.getElementById('skill-name').value = 'Fake Teamwork'; await pages.skills.saveSkill(); }, ids.a);
            assert((await page.evaluate(id => db.skills.get(id), ids.a)).name === 'Fake Skill One', 'a rename to an existing name was saved');
            // …but an edit that keeps its own name (new capitals) saves
            await page.evaluate(async id => { await pages.skills.showEditSkillModal(id); document.getElementById('skill-name').value = 'Fake skill one'; await pages.skills.saveSkill(); }, ids.a);
            assert((await page.evaluate(id => db.skills.get(id), ids.a)).name === 'Fake skill one', 'an edit keeping its own name was refused');
            // (b) a Professional skill, with "Professional" not in the category list, keeps its category
            const opt = await page.evaluate(async id => { await pages.skills.showEditSkillModal(id); const s = document.getElementById('skill-category'); return s.selectedOptions[0].textContent; }, ids.p);
            assert(opt === 'Professional (not in the category list)', 'the unlisted category option: ' + opt);
            await page.evaluate(async () => { document.getElementById('skill-description').value = 'Fake description'; await pages.skills.saveSkill(); });
            const p = await page.evaluate(id => db.skills.get(id), ids.p);
            assert(p.category === 'Professional' && p.description === 'Fake description', 'the category changed on save: ' + p.category);
            // (c) the analytics header keeps the comma (quoted)
            const header = await page.evaluate(async () => { let out = ''; const orig = window.downloadCSV; window.downloadCSV = c => { out = c; }; await pages.settings.exportStudentAnalytics(); window.downloadCSV = orig; return out.split('\n')[0]; });
            assert(header.includes('"Skill: Fake Prototyping, Testing & Iteration"'), 'analytics header: ' + header.slice(0, 400));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'classroom: Create Skill Assignments and Create PP Assignment work from Full Edit; PP has its own link and the contract code in its title (i106)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token' };
            const { page, errors, context } = await openApp(browser, base, { stub, localStorageInit: ls });
            const { activityId } = await seedFakeData(page);
            const skillIds = await page.evaluate(async activityId => {
                const now = new Date().toISOString();
                const a = await db.skills.add({ name: 'Fake Skill Alpha', category: 'Design', createdAt: now });
                const b = await db.skills.add({ name: 'Fake Skill Beta', category: 'Professional', createdAt: now });
                for (const skillId of [a, b]) await db.activitySkills.add({ activityId, skillId, createdAt: now });
                await db.activities.update(activityId, { contractCode: 'X9', classroomLinks: { 'FAKE-COURSE-1': 'OWN-CW' } });
                return [a, b];
            }, activityId);
            stub.reply('create_classroom_coursework', { status: 'success', courseworkId: 'NEW-CW' });
            await page.evaluate(id => modals.openFullEdit(id), activityId);
            await page.waitForFunction(() => document.getElementById('fe-name')?.value === 'Test Activity 1', null, { timeout: 5000 });
            await page.waitForTimeout(300);
            const toasts = [];
            await page.exposeFunction('__toast', m => toasts.push(m));
            await page.evaluate(async () => {
                const o = ui.showToast.bind(ui); ui.showToast = (m, t, d) => { window.__toast(m); return o(m, t, d); };
                window.confirm = () => true;
                const sel = document.getElementById('fe-classroom-course');
                sel.innerHTML = '<option value="">Not linked</option><option value="FAKE-COURSE-1">Fake Course</option>';
                sel.value = 'FAKE-COURSE-1';
                await pages.activityEdit.updateSkillLinkStatus();
            });
            const box = await page.evaluate(() => ({ shown: document.getElementById('fe-skill-link-status').style.display !== 'none', summary: document.getElementById('fe-skill-link-summary').textContent }));
            assert(box.shown && box.summary === '0/2 skills linked', 'the Skill & PP box: ' + JSON.stringify(box));
            await page.evaluate(() => pages.activityEdit.createSkillAssignments());
            await page.evaluate(() => pages.activityEdit.createPPAssignment());
            const calls = stub.callsFor('create_classroom_coursework').map(c => c.body.title);
            assert(JSON.stringify(calls) === JSON.stringify(['Fake Skill Alpha', 'Fake Skill Beta', 'X9: Professional Practice']), 'coursework created: ' + JSON.stringify(calls) + ' toasts: ' + JSON.stringify(toasts));
            // the buttons refresh the summary without waiting for it, so wait for the line here
            await page.waitForFunction(() => document.getElementById('fe-skill-link-summary').textContent === '2/2 skills linked, PP linked', null, { timeout: 5000 }).catch(() => {});
            const stored = await page.evaluate(async ({ activityId, skillIds }) => {
                const a = await db.activities.get(activityId);
                const s = await db.skills.bulkGet(skillIds);
                return { own: a.classroomLinks, pp: a.ppClassroomLinks, stamped: !!a.updatedAt, skills: s.map(x => x.classroomLinks), skillStamps: s.every(x => !!x.updatedAt), summary: document.getElementById('fe-skill-link-summary').textContent };
            }, { activityId, skillIds });
            assert(JSON.stringify(stored.own) === '{"FAKE-COURSE-1":"OWN-CW"}', "the assignment's own Classroom link changed: " + JSON.stringify(stored.own));
            assert(JSON.stringify(stored.pp) === '{"FAKE-COURSE-1":"NEW-CW"}' && stored.stamped, 'the PP link: ' + JSON.stringify(stored));
            assert(stored.skills.every(l => l && l['FAKE-COURSE-1'] === 'NEW-CW') && stored.skillStamps, 'the skill links: ' + JSON.stringify(stored));
            assert(stored.summary === '2/2 skills linked, PP linked', 'summary after: ' + stored.summary);
            // A second tap: nothing more is created
            await page.evaluate(() => pages.activityEdit.createPPAssignment());
            assert(stub.callsFor('create_classroom_coursework').length === 3 && toasts.includes('PP assignment already linked to this course'), 'second PP tap: ' + JSON.stringify(toasts));
            // Saving Full Edit keeps both links
            await page.evaluate(() => pages.activityEdit.save());
            await page.waitForTimeout(800);
            const after = await page.evaluate(id => db.activities.get(id).then(a => ({ own: a.classroomLinks, pp: a.ppClassroomLinks })), activityId);
            assert(JSON.stringify(after) === '{"own":{"FAKE-COURSE-1":"OWN-CW"},"pp":{"FAKE-COURSE-1":"NEW-CW"}}', 'after Full Edit save: ' + JSON.stringify(after));
            // A new, unsaved assignment is told to save first
            toasts.length = 0;
            await page.evaluate(async () => {
                pages.activityEdit._formFor = { mode: 'create' };
                await pages.activityEdit.createPPAssignment();
                await pages.activityEdit.createSkillAssignments();
            });
            assert(toasts.filter(t => t === 'Save the assignment first, then create its Classroom assignments.').length === 2 && stub.callsFor('create_classroom_coursework').length === 3, 'unsaved: ' + JSON.stringify(toasts));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'full edit: a save keeps what it can\'t show (object role tasks, an unlisted phase, a number, extra brief keys, status); an edited field still saves (i123, 1-18)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const { activityId } = await seedFakeData(page);
            const original = {
                getReadyRoleTasks: { leader: 'Fake: hand out the kit', recorder: 'Fake: open the notebook' },
                phase: 'Fake Phase 9', classPeriods: 3, status: 'archived', scoringType: 'points',
                contractCode: 'X9',
                contractBrief: { clientName: 'Fake Client', problemStatement: 'Fake problem', constraints: 'One fake constraint as text', deliverables: ['Fake deliverable'], context: 'Fake extra key' },
                pacingMilestones: { ahead: 'Fake ahead', onTime: '', behind: '', note: 'Fake extra pacing key' },
                getReadyTasks: [{ role: 'leader', task: 'Fake object task' }],
                unit: 'Fake Unit'
            };
            await page.evaluate(({ id, o }) => db.activities.update(id, o), { id: activityId, o: original });
            const open = async () => {
                await page.evaluate(id => modals.openFullEdit(id), activityId);
                await page.waitForFunction(() => document.getElementById('fe-name')?.value === 'Test Activity 1', null, { timeout: 5000 });
                await page.waitForTimeout(300);
            };
            await open();
            const shown = await page.evaluate(() => {
                const r = document.getElementById('fe-get-ready-role-tasks');
                const ph = document.getElementById('fe-phase');
                return { roleText: r.value, roleReadOnly: r.readOnly, phase: ph.value, phaseLabel: (ph.selectedOptions[0] || {}).textContent || '' };
            });
            assert(!/\[object Object\]/.test(shown.roleText) && /leader: Fake: hand out the kit/.test(shown.roleText) && shown.roleReadOnly, 'role tasks box: ' + JSON.stringify(shown));
            assert(shown.phase === 'Fake Phase 9' && shown.phaseLabel === 'Fake Phase 9 (not in the list)', 'phase dropdown: ' + JSON.stringify(shown));
            await page.evaluate(() => pages.activityEdit.save());
            await page.waitForTimeout(800);
            const pick = a => Object.fromEntries(Object.keys(original).map(k => [k, a[k]]));
            const after1 = await page.evaluate(id => db.activities.get(id), activityId);
            assert(JSON.stringify(pick(after1)) === JSON.stringify(original), 'an unchanged save changed stored fields:\n' + JSON.stringify(pick(after1)) + '\nwas\n' + JSON.stringify(original));
            // An edited field still saves, and the rest stays
            await open();
            await page.evaluate(() => { document.getElementById('fe-unit').value = 'Fake Unit Edited'; document.getElementById('fe-pacing-behind').value = 'Fake behind'; });
            await page.evaluate(() => pages.activityEdit.save());
            await page.waitForTimeout(800);
            const after2 = await page.evaluate(id => db.activities.get(id), activityId);
            assert(after2.unit === 'Fake Unit Edited' && after2.pacingMilestones.behind === 'Fake behind' && after2.pacingMilestones.note === 'Fake extra pacing key', 'edited fields: ' + JSON.stringify({ unit: after2.unit, pacing: after2.pacingMilestones }));
            assert(JSON.stringify(after2.getReadyRoleTasks) === JSON.stringify(original.getReadyRoleTasks) && after2.contractBrief.context === 'Fake extra key' && after2.contractBrief.constraints === original.contractBrief.constraints && after2.status === 'archived' && after2.scoringType === 'points', 'kept fields after an edit: ' + JSON.stringify(after2));
            // A new assignment's form starts clean (no read-only box, no leftover option)
            await page.evaluate(() => modals.openFullEdit(null));
            await page.waitForTimeout(800);
            const fresh = await page.evaluate(() => ({ ro: document.getElementById('fe-get-ready-role-tasks').readOnly, extra: document.querySelectorAll('#fe-phase option[data-unlisted]').length }));
            assert(!fresh.ro && fresh.extra === 0, 'the create form kept the last open\'s marks: ' + JSON.stringify(fresh));
            // The quick "+ Assignment" form's edit keeps status and grading type too; a new one starts active and mastery
            const quick = await page.evaluate(async id => {
                await modals.showEditActivity(id);
                await new Promise(r => setTimeout(r, 600));
                document.getElementById('activity-end-date').value = '2026-12-18';
                await modals.saveActivity();
                const edited = await db.activities.get(id);
                return { status: edited.status, scoringType: edited.scoringType, end: edited.endDate };
            }, activityId);
            assert(quick.status === 'archived' && quick.scoringType === 'points' && quick.end === '2026-12-18', 'quick form edit: ' + JSON.stringify(quick));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'hub sync: one payload builder; Full Edit, the card button and End Class send exactly what they sent before; the card shows the last sync; links merged (her request, 5-02)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'automations-enabled': 'true' };
            const { page, errors, context } = await openApp(browser, base, { stub, localStorageInit: ls });
            const ids = await seedFakeData(page);
            // The builder exactly as Full Edit had it before this PR (main, 1 Oct), for a byte comparison
            await page.addScriptTag({ content: 'window.__oldHubBuild = ' + OLD_HUB_BUILD });
            await page.evaluate(async ({ aid, s }) => {
                const t = '2026-09-28T13:00:00.000Z';
                const cp1 = await db.checkpoints.add({ activityId: aid, number: 1, title: 'Fake Sketch', description: 'Fake d', suggestedDate: '2026-10-02', milestone: 'Fake m', afterStep: 0, questions: [{ question: 'Fake q?' }], createdAt: t });
                const cp2 = await db.checkpoints.add({ activityId: aid, number: 2, title: 'Fake Build', createdAt: t });
                await db.checkpointCompletions.add({ checkpointId: cp1, studentId: s[0], completed: true, completedAt: '2026-09-29T14:00:00.000Z', createdAt: t });
                await db.checkpointCompletions.add({ checkpointId: cp2, studentId: s[1], completed: false, createdAt: t });
                await db.submissions.add({ activityId: aid, studentId: s[0], status: 'graded', createdAt: t });
                await db.submissions.add({ activityId: aid, studentId: s[1], status: 'submitted', createdAt: t });
                // every fake student has one, so the dashboard's automatic fill (i171) can't change the payload mid-test
                for (const sid of s.slice(2)) await db.submissions.add({ activityId: aid, studentId: sid, status: 'not-started', createdAt: t });
                await db.inventory.add({ name: 'Fake Saw', category: 'tools', location: 'Shelf 2', quantity: 1, createdAt: t });
                await db.activities.update(aid, {
                    classroomLinks: { 'FAKE-COURSE': 'FAKE-CW' }, unit: 'Fake Unit', formUrl: 'https://docs.google.com/forms/d/e/FAKE/viewform',
                    requiredTools: [{ name: 'Fake Saw', quantity: '1' }], requiredMaterials: [{ name: 'Fake Glue', quantity: '2' }],
                    resourceLinks: [{ url: 'https://example.test/rubric', title: 'Fake rubric' }, { url: 'https://youtu.be/abcdefghijk', title: 'Fake video' }],
                    instructionSteps: [{ title: 'Fake step', body: 'Fake body', roles: { leader: 'Fake lead' } }], contractCode: 'X9', contractBrief: { clientName: 'Fake client' },
                    sitePageUrl: 'https://sites.example.test/fake-page'
                });
            }, { aid: ids.activityId, s: ids.studentIds });
            const build = details => page.evaluate(async ({ aid, details }) => JSON.stringify(await hubSync.buildPayload(await db.activities.get(aid), 'test-token', { classroomDetails: details })), { aid: ids.activityId, details });
            const old = details => page.evaluate(async ({ aid, details }) => JSON.stringify(await window.__oldHubBuild(aid, 'test-token', details)), { aid: ids.activityId, details });
            // 1. With no Classroom materials, byte-identical to before, for both kinds of link
            const [n1, o1, n2, o2] = [await build(true), await old(true), await build(false), await old(false)];
            assert(n1 === o1, 'Full Edit payload changed:\n' + n1.slice(0, 400) + '\n' + o1.slice(0, 400));
            assert(n2 === o2, 'End Class payload changed');
            assert(n1.includes('/a/FAKE-CW/details"') && n2.includes('/a/FAKE-CW"'), 'the two Classroom link forms');
            const sentLast = () => JSON.stringify(stub.callsFor('sync_to_hub_sheet').slice(-1)[0].body);
            // 2. The card: a 📤 Sync to Hub button and a line; tapping it sends Full Edit's payload
            await page.evaluate(() => router.navigate('activities'));
            await page.waitForTimeout(400);
            const line0 = await page.textContent(`#hub-sync-line-${ids.activityId}`);
            assert(line0.trim() === 'Hub: not synced yet', 'card line before: ' + line0);
            await page.click(`#hub-sync-btn-${ids.activityId}`);
            await page.waitForTimeout(600);
            assert(stub.callsFor('sync_to_hub_sheet').length === 1 && sentLast() === n1 && sentLast() === await old(true), 'the card sent something else');
            const after = await page.evaluate(async aid => ({ line: document.getElementById('hub-sync-line-' + aid).textContent, at: (await db.activities.get(aid)).lastHubSync, btn: document.getElementById('hub-sync-btn-' + aid).textContent }), ids.activityId);
            assert(/^Hub: synced /.test(after.line) && after.at && after.btn === '📤 Sync to Hub', 'after the card sync: ' + JSON.stringify(after));
            // 3. Full Edit's button sends the same
            await page.evaluate(id => modals.openFullEdit(id), ids.activityId);
            await page.waitForFunction(() => document.getElementById('fe-name')?.value === 'Test Activity 1', null, { timeout: 5000 });
            // Full Edit's sync needs the form to have finished loading (EP24's _formFor)
            await page.waitForFunction(() => pages.activityEdit._formFor && pages.activityEdit._formFor.mode === 'edit', null, { timeout: 10000 });
            await page.evaluate(() => pages.activityEdit.syncToHub());
            await page.waitForTimeout(400);
            assert(stub.callsFor('sync_to_hub_sheet').length === 2 && sentLast() === await old(true), 'Full Edit sent something else');
            // 4. End Class sends its own form (no /details)
            await page.evaluate(async aid => {
                document.getElementById('end-class-hub-activities').innerHTML = '<input type="checkbox" class="hub-sync-checkbox" value="' + aid + '" checked>';
                document.getElementById('end-class-period').value = '1';
                await modals.completeEndClass();
            }, ids.activityId);
            await page.waitForTimeout(400);
            assert(stub.callsFor('sync_to_hub_sheet').length === 3 && sentLast() === await old(false), 'End Class sent something else');
            // 5. With Classroom materials: their links join resourceLinks (YouTube by id, once); nothing else changes
            await page.evaluate(aid => db.activities.update(aid, { materials: [
                { type: 'link', url: 'https://example.test/extra', title: 'Fake extra' },
                { type: 'youtubeVideo', youtubeId: 'abcdefghijk', title: 'Fake video again' },
                { type: 'driveFile', driveFileId: 'FAKEDRIVEID', title: 'Fake doc' },
                { type: 'link', url: 'https://example.test/rubric', title: 'Fake rubric again' }] }), ids.activityId);
            const n3 = JSON.parse(await build(true)), o3 = JSON.parse(await old(true));
            const links = n3.activities[0].resourceLinks.map(l => l.url + '|' + l.title);
            assert(JSON.stringify(links) === JSON.stringify(['https://example.test/rubric|Fake rubric', 'https://youtu.be/abcdefghijk|Fake video', 'https://example.test/extra|Fake extra', 'https://drive.google.com/file/d/FAKEDRIVEID/view|Fake doc']), 'merged links: ' + JSON.stringify(links));
            delete n3.activities[0].resourceLinks; delete o3.activities[0].resourceLinks;
            assert(JSON.stringify(n3) === JSON.stringify(o3), 'with materials, something besides resourceLinks changed');
            // 6. Classroom create (quick form): the links go with it; and its Save no longer wipes the materials list
            stub.reply('create_classroom_coursework', { status: 'success', courseworkId: 'NEW-CW', title: 'Fake', maxPoints: 100 });
            const q = await page.evaluate(async aid => {
                await modals.showEditActivity(aid);
                await new Promise(r => setTimeout(r, 600));
                state._classroomPendingCreate = { 'FAKE-COURSE-2': { maxPoints: 100 } };
                await modals.saveActivity();
                await new Promise(r => setTimeout(r, 600));
                return (await db.activities.get(aid)).materials;
            }, ids.activityId);
            assert(Array.isArray(q) && q.length === 4, 'the quick form wiped the materials list: ' + JSON.stringify(q));
            const sentMats = (stub.callsFor('create_classroom_coursework').slice(-1)[0] || { body: {} }).body.materials || [];
            const urls = sentMats.map(m => m.type + ':' + (m.url || m.youtubeId || m.driveFileId));
            assert(JSON.stringify(urls) === JSON.stringify(['link:https://sites.example.test/fake-page', 'link:https://example.test/extra', 'youtubeVideo:abcdefghijk', 'driveFile:FAKEDRIVEID', 'link:https://example.test/rubric']), 'quick-form create materials: ' + JSON.stringify(urls));
            // 7. Full Edit's ↑ Update sends the same list (P29f lists the new ones in the description), and an empty list when there are none
            stub.reply('update_classroom_coursework', { status: 'success', courseworkId: 'FAKE-CW', title: 'Test Activity 1', maxPoints: 100, linksInDescription: 2 });
            const updToasts = await page.evaluate(async aid => {
                window.__toasts = [];
                const orig = ui.showToast.bind(ui);
                ui.showToast = (m, ...r) => { window.__toasts.push(String(m)); return orig(m, ...r); };
                await modals.openFullEdit(aid);
                for (let i = 0; i < 100 && !(pages.activityEdit._formFor && pages.activityEdit._formFor.mode === 'edit'); i++) await new Promise(r => setTimeout(r, 100));
                const fe = pages.activityEdit;
                document.getElementById('fe-classroom-course').innerHTML = '<option value="FAKE-COURSE" selected>Fake course</option>';
                document.getElementById('fe-classroom-cw').innerHTML = '<option value="FAKE-CW" selected>Fake cw</option>';
                await fe.updateCoursework();
                const afterFirst = window.__toasts.slice();
                fe._materials = []; fe._resourceLinks = []; fe._data.activity.sitePageUrl = '';
                await fe.updateCoursework();
                return { afterFirst, all: window.__toasts.slice() };
            }, ids.activityId);
            const updCalls = stub.callsFor('update_classroom_coursework');
            const updUrls = (updCalls[0] && updCalls[0].body.materials || []).map(m => m.type + ':' + (m.url || m.youtubeId || m.driveFileId));
            assert(updCalls.length === 2 && JSON.stringify(updUrls) === JSON.stringify(urls), 'Update materials: ' + JSON.stringify(updUrls));
            assert(Array.isArray(updCalls[1].body.materials) && updCalls[1].body.materials.length === 0, 'Update with no links must send an empty list: ' + JSON.stringify(updCalls[1].body));
            assert(updToasts.afterFirst.some(t => t === '✅ Updated in Classroom: Test Activity 1 (100 pts) · 2 links listed in the description'), 'Update toast: ' + JSON.stringify(updToasts.afterFirst));
            // a webhook that couldn't add the links says so; an older webhook (no count) shows the old toast
            stub.reply('update_classroom_coursework', { status: 'success', courseworkId: 'FAKE-CW', title: 'Test Activity 1', maxPoints: 100, linksError: "Couldn't read the assignment, so no links were added: Fake" });
            const t2 = await page.evaluate(async () => { window.__toasts = []; await pages.activityEdit.updateCoursework(); return window.__toasts.slice(); });
            assert(t2.length === 2 && t2[0] === '✅ Updated in Classroom: Test Activity 1 (100 pts)' && t2[1] === "Links not added to the description: Couldn't read the assignment, so no links were added: Fake", 'link error toasts: ' + JSON.stringify(t2));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'settings: Automations has no Scheduled Grade Push, and auto-check times still save (1-03, D17)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await page.evaluate(() => router.navigate('settings'));
            await page.waitForTimeout(300);
            await page.click('button.tab-btn:has-text("Automations")');
            await page.waitForTimeout(300);
            const text = await page.textContent('#page-settings');
            assert(!/Scheduled Grade Push/.test(text), 'Settings still shows "Scheduled Grade Push to Classroom"');
            const leftovers = await page.evaluate(() => ({
                inputs: document.querySelectorAll('#auto-push-time-1, #auto-push-time-2').length,
                save: typeof pages.settings.saveAutoPushTimes
            }));
            assert(leftovers.inputs === 0 && leftovers.save === 'undefined', `push-time leftovers: ${JSON.stringify(leftovers)}`);

            // The neighbouring auto-check times are untouched
            await page.evaluate(() => { document.getElementById('auto-check-time-1').value = '07:45'; pages.settings.saveAutoCheckTimes(); });
            const saved = await page.evaluate(() => localStorage.getItem('auto-check-time-1'));
            assert(saved === '07:45', `auto-check time not saved (got ${saved})`);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'data check: Settings → Data shows each table\'s count exactly, and no names (1-04)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            // Load the fake roster the same way she would on staging
            await page.evaluate(() => router.navigate('settings'));
            await page.setInputFiles('#import-file-input', new URL('./fixtures/fake-roster.json', import.meta.url).pathname);
            await page.waitForSelector('#import-replace-btn', { state: 'visible' });
            await page.click('#import-replace-btn');
            await waitForCount(page, 'students', 20);
            // Soft-delete one fake student so the "deleted" column has something to show
            await page.evaluate(async () => { const s = await db.students.toCollection().first(); await db.students.update(s.id, { deletedAt: new Date().toISOString() }); });
            await page.evaluate(() => router.navigate('settings'));
            await page.click('button.tab-btn:has-text("Data")');
            await page.waitForSelector('#data-check-body table');

            const shown = await page.$$eval('#data-check-body tr[data-table]', trs => Object.fromEntries(trs.map(tr => [tr.dataset.table, Number(tr.querySelector('.data-check-total').textContent)])));
            const actual = await page.evaluate(async () => Object.fromEntries(await Promise.all(db.tables.map(async t => [t.name, await t.count()]))));
            for (const [t, n] of Object.entries(actual)) assert(shown[t] === n, `${t}: screen shows ${shown[t]}, database has ${n}`);
            // The fake roster's own counts
            const fixture = { students: 20, enrollments: 20, teams: 5, teamMembers: 20, attendance: 7, activities: 2, checkpoints: 4, checkpointCompletions: 8, submissions: 10, classes: 2 };
            for (const [t, n] of Object.entries(fixture)) assert(shown[t] === n, `${t}: expected the fake roster's ${n}, screen shows ${shown[t]}`);
            const deletedCell = await page.textContent('#data-check-body tr[data-table="students"] td:nth-child(3)');
            assert(deletedCell.trim() === '1', `students deleted column shows "${deletedCell.trim()}", expected 1`);

            // Counts only: no student name appears on the card or in the copy text
            const names = await page.evaluate(async () => (await db.students.toArray()).flatMap(s => [s.firstName, s.lastName]).filter(Boolean));
            const cardText = await page.textContent('#data-check-card');
            const copyText = await page.evaluate(() => pages.settings._dataCheckText);
            const leaked = names.filter(n => cardText.includes(n) || copyText.includes(n));
            assert(leaked.length === 0, `${leaked.length} name(s) appear on the Data check`);
            assert(/students: 20 \(1 deleted\)/.test(copyText), 'copy text is missing the students line');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'import safety: a {"settings":[]} file is refused for Replace All, and nothing changes (1-01)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await seedFakeData(page);
            const before = await page.evaluate(async () => ({ students: await db.students.count(), backups: await backupDb.backups.count() }));
            await page.evaluate(() => router.navigate('settings'));
            await page.setInputFiles('#import-file-input', tempJson('settings-only', { settings: [] }));
            await page.waitForSelector('#import-replace-btn', { state: 'visible' });
            const disabled = await page.$eval('#import-replace-btn', b => b.disabled);
            assert(disabled, 'Replace All is not switched off for a settings-only file');
            const warning = await page.textContent('#import-preview-body');
            assert(/Replace All is switched off/.test(warning), 'the preview does not say why Replace All is off');
            // Even if it were called anyway, it must refuse
            await page.evaluate(() => pages.settings.executeImport('replace'));
            await page.waitForTimeout(300);
            const after = await page.evaluate(async () => ({ students: await db.students.count(), backups: await backupDb.backups.count() }));
            assert(after.students === before.students, `students changed: ${before.students} → ${after.students}`);
            assert(after.backups === before.backups, `a refused import still saved a snapshot (${before.backups} → ${after.backups})`);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'import safety: a valid Replace All saves exactly 1 snapshot of the old data first (1-01)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await seedFakeData(page);
            const before = await page.evaluate(async () => ({ students: await db.students.count(), backups: await backupDb.backups.count() }));
            await page.evaluate(() => router.navigate('settings'));
            await page.setInputFiles('#import-file-input', new URL('./fixtures/fake-roster.json', import.meta.url).pathname);
            await page.waitForSelector('#import-replace-btn', { state: 'visible' });
            assert(!(await page.$eval('#import-replace-btn', b => b.disabled)), 'Replace All is switched off for a valid backup');
            await page.click('#import-replace-btn');
            await waitForCount(page, 'students', 20);
            const snap = await page.evaluate(async () => {
                const all = await backupDb.backups.orderBy('createdAt').toArray();
                const last = all[all.length - 1];
                return { count: all.length, slot: last.slot, label: last.label, students: JSON.parse(last.data).students.length };
            });
            assert(snap.count === before.backups + 1, `expected 1 new snapshot, found ${snap.count - before.backups}`);
            assert(snap.slot === 'safety' && /Before import \(Replace All\)/.test(snap.label), `snapshot label: ${snap.label}`);
            assert(snap.students === before.students, `snapshot holds ${snap.students} students, expected the ${before.students} from before`);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'import safety: Sync Setup Only never removes or overwrites this device\'s newer students (1-01)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const { studentIds } = await seedFakeData(page);
            // Give this device's students local changes the backup doesn't have, plus one student the backup lacks
            const mine = await page.evaluate(async ids => {
                const later = new Date(Date.now() + 60000).toISOString();
                for (const id of ids) await db.students.update(id, { firstName: `LocalEdit${id}`, updatedAt: later });
                const extra = await db.students.add({ firstName: 'OnlyHere', lastName: 'Fixture', name: 'OnlyHere Fixture', classId: 1, status: 'active', createdAt: later, updatedAt: later });
                ids.push(extra);
                return (await db.students.bulkGet(ids)).map(s => `${s.id}:${s.firstName}`);
            }, studentIds);
            studentIds.push(Number(mine[mine.length - 1].split(':')[0]));
            await page.evaluate(() => router.navigate('settings'));
            await page.setInputFiles('#import-file-input', new URL('./fixtures/fake-roster.json', import.meta.url).pathname);
            await page.waitForSelector('#import-setup-btn', { state: 'visible' });
            await page.click('#import-setup-btn');
            await page.waitForTimeout(800);
            const now = await page.evaluate(async ids => (await db.students.bulkGet(ids)).map(s => s ? `${s.id}:${s.firstName}` : 'missing'), studentIds);
            const lost = mine.filter((m, i) => m !== now[i]);
            assert(lost.length === 0, `${lost.length} of this device's ${mine.length} fake students were removed or overwritten`);
            const n = await page.evaluate(() => db.students.count());
            assert(n >= 20, `expected the backup's other students to be added (count ${n})`);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'backup export: the password is typed twice; a mismatch or a short one exports nothing (1-02)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await seedFakeData(page);
            const tryExport = async answers => {
                await page.evaluate(a => { window.__promptCalls = 0; window.prompt = () => { window.__promptCalls++; return a.shift() ?? null; }; }, answers);
                const download = page.waitForEvent('download', { timeout: 2000 }).then(() => true).catch(() => false);
                await page.evaluate(() => pages.settings.exportData());
                return { downloaded: await download, prompts: await page.evaluate(() => window.__promptCalls) };
            };
            const mismatch = await tryExport(['fake-pass-1234', 'fake-pass-9999']);
            assert(!mismatch.downloaded && mismatch.prompts === 2, `mismatch: downloaded=${mismatch.downloaded}, prompts=${mismatch.prompts}`);
            const short = await tryExport(['short']);
            assert(!short.downloaded && short.prompts === 1, `short password: downloaded=${short.downloaded}, prompts=${short.prompts}`);
            const matched = await tryExport(['fake-pass-1234', 'fake-pass-1234']);
            assert(matched.downloaded && matched.prompts === 2, `matched: downloaded=${matched.downloaded}, prompts=${matched.prompts}`);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'backup export: a matched-password export re-imports on a fresh copy (1-02)',
        fn: async ({ browser, base }) => {
            const a = await openApp(browser, base);
            await seedFakeData(a.page);
            const n = await a.page.evaluate(() => db.students.count());
            await a.page.evaluate(() => { const ans = ['fake-pass-1234', 'fake-pass-1234']; window.prompt = () => ans.shift() ?? null; });
            const [download] = await Promise.all([a.page.waitForEvent('download'), a.page.evaluate(() => pages.settings.exportData())]);
            const file = path.join(os.tmpdir(), `shopflow-test-${process.pid}-export.json`);
            await download.saveAs(file);
            await a.context.close();

            const b = await openApp(browser, base);
            await b.page.evaluate(() => { window.prompt = () => 'fake-pass-1234'; });
            await b.page.evaluate(() => router.navigate('settings'));
            await b.page.setInputFiles('#import-file-input', file);
            await b.page.waitForSelector('#import-replace-btn', { state: 'visible' });
            await b.page.click('#import-replace-btn');
            await waitForCount(b.page, 'students', n);
            assert(real(b.errors).length === 0, 'page errors: ' + real(b.errors).join(' | '));
            await b.context.close();
        }
    },
    {
        name: 'grading tab: level descriptors are found by skill id, so a renamed or re-capitalised skill keeps them (1-05)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const { classId, activityId } = await seedFakeData(page);
            await page.evaluate(async ({ classId, activityId }) => {
                const now = new Date().toISOString();
                const renamed = await db.skills.add({ name: 'Fake Safety Practices', category: 'Fake', createdAt: now });
                const oldRecord = await db.skills.add({ name: 'Fake Sketching', category: 'Fake', createdAt: now });
                await db.activitySkills.bulkAdd([{ activityId, skillId: renamed }, { activityId, skillId: oldRecord }]);
                await db.activities.update(activityId, { skillsAssessed: [
                    // The guide used different capitals and an older name; the id is what matters
                    { skillName: 'FAKE SAFETY (old name)', skillId: renamed, checkpoints: [], levels: { Proficient: 'Fake descriptor for safety' } },
                    // An older record with no skillId still matches by name, ignoring case
                    { skillName: 'fake sketching', checkpoints: [], levels: { Proficient: 'Fake descriptor for sketching' } }
                ] });
                // The observation panels only show in mastery mode (row 3-01 will add the switch)
                await db.settings.put({ key: 'mastery-mode-' + classId, value: 'current-best' });
                state.selectedActivity = activityId;
                state.activityDetailInitialTab = 'grading';
                router.navigate('activity-detail');
            }, { classId, activityId });
            await page.waitForSelector('#ad-tab-grading .mastery-obs-section', { state: 'attached', timeout: 5000 });
            const text = await page.textContent('#ad-tab-grading');
            assert(/Fake descriptor for safety/.test(text), 'the renamed skill lost its level descriptors');
            assert(/Fake descriptor for sketching/.test(text), 'an older record without a skill id lost its level descriptors');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'sync: an edit made during a slow upload is uploaded on the next cycle (1-14, push race)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'drive-sync-enabled': 'true', 'drive-sync-password': 'test-sync-pass' };
            const a = await openApp(browser, base, { stub, localStorageInit: ls });
            await seedFakeData(a.page);
            stub.delay('save_to_drive', 1500);
            await a.page.evaluate(() => { driveSync.DEBOUNCE_MS = 300; driveSync.markDirty(); });
            // Wait for the slow upload to start, then edit while it's in flight
            for (let i = 0; i < 50 && stub.callsFor('save_to_drive').length < 1; i++) await a.page.waitForTimeout(100);
            assert(stub.callsFor('save_to_drive').length === 1, 'the first upload never started');
            await a.page.evaluate(async () => {
                await db.students.add({ firstName: 'Late', lastName: 'Edit', name: 'Late Edit', classId: 1, status: 'active', createdAt: new Date().toISOString() });
                driveSync.markDirty();
            });
            for (let i = 0; i < 60 && stub.callsFor('save_to_drive').length < 2; i++) await a.page.waitForTimeout(100);
            await a.page.waitForTimeout(1700); // let the second (slow) upload finish
            const uploads = stub.callsFor('save_to_drive').length;
            assert(uploads === 2, `expected the edit to be uploaded in 1 more upload (2 in total), saw ${uploads}`);
            // The other device receives the edit
            const b = await openApp(browser, base, { stub, localStorageInit: ls });
            await b.page.evaluate(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }); });
            await b.page.evaluate(() => driveSyncPull.checkOnLoad());
            const n = await b.page.evaluate(() => db.students.count());
            assert(n === 5, `the other device has ${n} students, expected 5 (4 + the edit made during the upload)`);
            assert(real(a.errors).length === 0 && real(b.errors).length === 0, 'page errors: ' + real(a.errors.concat(b.errors)).join(' | '));
            await a.context.close(); await b.context.close();
        }
    },
    {
        name: 'sync: a pull still applies when the two devices\' clocks disagree (1-14, pull clock)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'drive-sync-enabled': 'true', 'drive-sync-password': 'test-sync-pass' };
            const a = await openApp(browser, base, { stub, localStorageInit: ls });
            await seedFakeData(a.page);
            await a.page.evaluate(async () => { driveSync._dirty = true; await driveSync.push(); });
            const pcStamp = stub.driveFiles.PC && stub.driveFiles.PC.timestamp;
            assert(pcStamp, 'device A did not upload');
            // Device B's clock runs an hour fast; it last applied an older upload from A
            const hour = 3600000;
            const b = await openApp(browser, base, { stub, localStorageInit: { ...ls,
                'last-drive-sync-received': new Date(Date.now() + hour).toISOString(),
                'last-drive-sync-remote-ts': new Date(Date.now() - hour).toISOString() } });
            await b.page.evaluate(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }); });
            const first = await b.page.evaluate(() => driveSyncPull.checkOnLoad());
            const n = await b.page.evaluate(() => db.students.count());
            assert(first === 'applied' && n === 4, `skewed clock: pull returned "${first}", device B has ${n} students (expected applied, 4)`);
            // The same upload is not applied twice
            const again = await b.page.evaluate(() => driveSyncPull.checkOnLoad());
            assert(again === 'none', `the same upload was pulled again ("${again}")`);
            const remembered = await b.page.evaluate(() => localStorage.getItem('last-drive-sync-remote-ts'));
            assert(remembered === pcStamp, 'device B did not remember the other device\'s timestamp');
            await a.context.close(); await b.context.close();
        }
    },
    {
        name: 'settings: the Auto-Sync switch reacts once per tap, however many times Settings was opened (i173)',
        fn: async ({ browser, base }) => {
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'drive-sync-enabled': 'false', 'drive-sync-password': 'test-sync-pass', 'automations-enabled': 'true' };
            const { page, errors, context } = await openApp(browser, base, { localStorageInit: ls });
            for (let i = 0; i < 3; i++) {
                await page.evaluate(() => router.navigate('dashboard'));
                await page.waitForTimeout(200);
                await page.evaluate(() => router.navigate('settings'));
                await page.waitForTimeout(400);
            }
            const r = await page.evaluate(async () => {
                const toasts = [];
                const orig = ui.showToast.bind(ui);
                ui.showToast = (m, t, d) => { toasts.push(m); return orig(m, t, d); };
                let dirty = 0;
                const origDirty = driveSync.markDirty.bind(driveSync);
                driveSync.markDirty = () => { dirty++; return origDirty(); };
                const toggle = document.getElementById('drive-sync-toggle');
                toggle.click();
                const onToasts = toasts.slice();
                toasts.length = 0;
                toggle.click();
                ui.showToast = orig; driveSync.markDirty = origDirty;
                return { onToasts, offToasts: toasts, dirty, enabled: localStorage.getItem('drive-sync-enabled') };
            });
            assert(r.onToasts.length === 1 && /Drive sync enabled/.test(r.onToasts[0]), 'turning on: ' + JSON.stringify(r.onToasts));
            assert(r.dirty === 1, 'marked dirty ' + r.dirty + ' times');
            assert(r.offToasts.length === 1 && /Drive sync disabled/.test(r.offToasts[0]) && r.enabled === 'false', 'turning off: ' + JSON.stringify(r.offToasts));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'mastery engine: spec acceptance tests 1-4 and 8 (the weighted average), back-dated corrections, removed ratings skipped (3-06)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const r = await page.evaluate(() => {
                const cfg = masteryEngine.mergeConfig(null);
                const at = i => new Date(Date.UTC(2026, 9, 1, 12, i)).toISOString();
                const obs = ratings => ratings.map((rating, i) => ({ id: i + 1, rating, createdAt: at(i) }));
                const h = (ratings, c = cfg) => masteryEngine.scoreHistory(obs(ratings), c, 'weighted-average');
                const out = {};
                out.t1 = h(['Proficient']);
                out.t2 = h(['Developing', 'Proficient', 'Proficient', 'Advanced']).steps.map(s => s.score);
                out.t3 = h(['Proficient', 'Developing']).steps.map(s => s.score);
                const slide = h(['Advanced', ...Array(40).fill('Beginning')]).steps.map(s => s.score);
                out.t4 = { first: h(['Beginning']).score, last: slide[slide.length - 1], min: Math.min(...slide), falling: slide.every((x, i) => i === 0 || x <= slide[i - 1]) };
                out.t8 = h(['Beginning', 'Proficient']).raw;
                // A back-dated correction inserts where it belongs: D (1 Oct), A (3 Oct), then P observed 2 Oct
                out.backdated = masteryEngine.scoreHistory([
                    { id: 1, rating: 'Developing', createdAt: '2026-10-01T12:00:00.000Z' },
                    { id: 2, rating: 'Advanced', createdAt: '2026-10-03T12:00:00.000Z' },
                    { id: 3, rating: 'Proficient', createdAt: '2026-10-04T12:00:00.000Z', observedAt: '2026-10-02T12:00:00.000Z' }
                ], cfg, 'weighted-average').steps.map(s => s.rating[0]).join('');
                out.removed = masteryEngine.scoreHistory([{ id: 1, rating: 'Proficient', createdAt: at(0) }, { id: 2, rating: 'Beginning', createdAt: at(1), deletedAt: at(2) }], cfg, 'weighted-average').score;
                out.levels = [80.3, 83.3, 77.5, 60, 59, 92.5].map(x => masteryEngine.levelFor(x, cfg));
                out.best = masteryEngine.scoreHistory(obs(['Advanced', 'Beginning']), cfg, 'current-best').score;
                return out;
            });
            assert(r.t1.score === 85 && r.t1.raw === 85, 'test 1: ' + JSON.stringify(r.t1));
            assert(JSON.stringify(r.t2) === JSON.stringify([70, 79.8, 83.2, 94.1]), 'test 2: ' + JSON.stringify(r.t2));
            assert(JSON.stringify(r.t3) === JSON.stringify([85, 79]), 'test 3: ' + JSON.stringify(r.t3));
            assert(r.t4.first === 50 && r.t4.last === 50 && r.t4.min >= 50 && r.t4.falling, 'test 4: ' + JSON.stringify(r.t4));
            assert(Math.abs(r.t8 - 72.75) < 1e-9, 'test 8: ' + r.t8);
            assert(r.backdated === 'DPA', 'back-dated order: ' + r.backdated);
            assert(r.removed === 85, 'a removed rating counted: ' + r.removed);
            assert(JSON.stringify(r.levels) === JSON.stringify(['Proficient', 'Proficient', 'Proficient', 'Developing', 'Beginning', 'Advanced']), 'levels: ' + JSON.stringify(r.levels));
            assert(r.best === 100, 'current-best: ' + r.best);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'students: editing an archived student keeps them archived (i166); a new student starts active',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            const r = await page.evaluate(async sid => {
                await db.students.update(sid, { status: 'archived', updatedAt: new Date().toISOString() });
                await modals.showEditStudent(sid);
                await new Promise(res => setTimeout(res, 300));
                document.getElementById('student-email').value = 'changed@example.test';
                await modals.saveStudent();
                const edited = await db.students.get(sid);
                await modals.showAddStudent();
                document.getElementById('student-first-name').value = 'Fake';
                document.getElementById('student-last-name').value = 'Newstudent';
                document.getElementById('student-class-id').value = String(edited.classId);
                document.querySelector('.student-period-checkbox[value="1"]').checked = true;
                await modals.saveStudent();
                const added = (await db.students.toArray()).find(s => s.lastName === 'Newstudent');
                return { status: edited.status, email: edited.email, added: added && added.status };
            }, ids.studentIds[0]);
            assert(r.email === 'changed@example.test', 'the edit did not save: ' + JSON.stringify(r));
            assert(r.status === 'archived', 'editing an archived student un-archived them: ' + r.status);
            assert(r.added === 'active', 'a new student did not start active: ' + r.added);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'students CSV: the Class column shows the class each enrollment period belongs to (i167)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await seedFakeData(page);
            const r = await page.evaluate(async () => {
                const files = [];
                window.downloadCSV = (content, filename) => files.push({ content, filename });
                await pages.students.exportToCSV(false);
                await pages.students.exportToCSV(true);
                return files.map(f => f.content.trim().split('\n'));
            });
            const [full, ferpa] = r;
            assert(full.length === 5 && full.slice(1).every(l => l.split(',')[3] === 'Test Engineering 1'), 'full export Class column:\n' + full.join('\n'));
            assert(ferpa.length === 5 && ferpa.slice(1).every(l => l.split(',')[1] === 'Test Engineering 1'), 'FERPA-safe export Class column:\n' + ferpa.join('\n'));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'mastery engine: acceptance tests 7a-7c, 9, 12, 13 (opportunity set, two categories, the two flags) (3-06)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const r = await page.evaluate(() => {
                const today = '2026-10-15';
                const skills = [];
                for (let i = 1; i <= 15; i++) skills.push({ id: i, name: `Fake Tech ${i}`, category: 'Design' });
                for (let i = 16; i <= 20; i++) skills.push({ id: i, name: `Fake Prof ${i}`, category: 'Professional' });
                const all = skills.map(s => s.id);
                const activity = (id, endDate, ids, classId = 1) => ({ id, classId, name: `Fake Activity ${id}`, endDate, skillsAssessed: ids.map(skillId => ({ skillId })) });
                // Every skill starts at Beginning (one observation), then the raised ones get one Proficient
                const slacker = raised => {
                    const obs = [];
                    for (const id of all) obs.push({ id: obs.length + 1, studentId: '7', skillId: id, activityId: 1, rating: 'Beginning', createdAt: '2026-10-01T12:00:00.000Z' });
                    for (const id of raised) obs.push({ id: obs.length + 1, studentId: 7, skillId: String(id), activityId: 1, rating: 'Proficient', createdAt: '2026-10-10T12:00:00.000Z' });
                    const res = masteryEngine.compute({ skills, skillObservations: obs, activities: [activity(1, '2026-10-12', all)], activitySkills: [], checkpoints: [], studentIds: [7] }, 1, { today });
                    const st = res.students[0];
                    return { t: st.technical.grade, p: st.professional.grade, final: Math.round((0.7 * st.technical.mean + 0.3 * st.professional.mean) * 100) / 100 };
                };
                const out = { a: slacker([1, 2, 3, 4]), b: slacker([1, 2, 3, 16]), c: slacker([16, 17, 18, 19]) };
                // 9: ten opportunity skills and no evidence at all → 50, not "no grade"; a skill not yet taught doesn't count
                const r9 = masteryEngine.compute({ skills, skillObservations: [], activities: [activity(1, '2026-10-12', all.slice(0, 10)), activity(2, '2026-11-20', [11, 12])], activitySkills: [], checkpoints: [], studentIds: [7] }, 1, { today });
                out.t9 = { grade: r9.students[0].technical.grade, count: r9.students[0].technical.count, prof: r9.students[0].professional.grade };
                // A live activity link and a due checkpoint also open skills; retired skills and other classes don't count
                const hidden = skills.map(s => (s.id === 3 ? { ...s, retiredAt: '2026-11-05T00:00:00.000Z' } : s));
                const rOpen = masteryEngine.compute({ skills: hidden, skillObservations: [], activities: [activity(1, '2026-10-12', []), activity(2, '2026-11-20', []), activity(9, '2026-10-01', [5], 2)], activitySkills: [{ activityId: 1, skillId: 1 }, { activityId: 1, skillId: 3 }, { activityId: 1, skillId: 4, deletedAt: 'x' }], checkpoints: [{ activityId: 2, suggestedDate: '2026-10-05', skillsAssessable: [2] }], studentIds: [7] }, 1, { today });
                out.open = rOpen.opportunity.slice().sort().join(',');
                // Overrides: the class closes 1; student 7 gets 6 opened
                const rOv = masteryEngine.compute({ skills, skillObservations: [], activities: [activity(1, '2026-10-12', [1, 2])], activitySkills: [], checkpoints: [], studentIds: [7, 8] }, 1, { today, overrides: { closed: [1], students: { 7: { open: [6] } } } });
                out.ov = rOv.students.map(s => s.technical.skills.map(x => x.skillId).join('+')).join(' / ');
                // 12: three professional skills open → flagged; five → not
                out.t12 = [
                    masteryEngine.compute({ skills, skillObservations: [], activities: [activity(1, '2026-10-12', [16, 17, 18, 1])], activitySkills: [], checkpoints: [], studentIds: [7] }, 1, { today }).flags.professionalFloor,
                    masteryEngine.compute({ skills, skillObservations: [], activities: [activity(1, '2026-10-12', [16, 17, 18, 19, 20])], activitySkills: [], checkpoints: [], studentIds: [7] }, 1, { today }).flags.professionalFloor.flagged
                ];
                // 13: a due contract with two professional skills; student 8 has no rating for skill 17 on it
                const obs13 = [
                    { id: 1, studentId: 7, skillId: 16, activityId: 1, rating: 'Proficient', createdAt: '2026-10-10T12:00:00.000Z' },
                    { id: 2, studentId: 7, skillId: 17, activityId: 1, rating: 'Proficient', createdAt: '2026-10-10T12:00:00.000Z' },
                    { id: 3, studentId: 8, skillId: 16, activityId: 1, rating: 'Proficient', createdAt: '2026-10-10T12:00:00.000Z' },
                    { id: 4, studentId: 8, skillId: 17, activityId: 2, rating: 'Proficient', createdAt: '2026-10-10T12:00:00.000Z' },
                    { id: 5, studentId: 7, skillId: 16, activityId: 1, rating: 'Advanced', createdAt: '2026-10-11T12:00:00.000Z', deletedAt: '2026-10-11T13:00:00.000Z' }
                ];
                out.t13 = masteryEngine.compute({ skills, skillObservations: obs13, activities: [activity(1, '2026-10-12', [16, 17, 1]), activity(2, '2026-11-20', [17])], activitySkills: [], checkpoints: [], studentIds: [7, 8] }, 1, { today }).flags.missingProfessional;
                out.off = masteryEngine.compute({ skills, skillObservations: [], activities: [], activitySkills: [], checkpoints: [], studentIds: [7] }, 1, { today, mode: 'off' }).off;
                return out;
            });
            assert(r.a.t === 56.07 && r.a.p === 50 && r.a.final === 54.25, 'test 7a: ' + JSON.stringify(r.a));
            assert(r.b.t === 54.55 && r.b.p === 54.55 && r.b.final === 54.55, 'test 7b: ' + JSON.stringify(r.b));
            assert(r.c.t === 50 && r.c.p === 68.2 && r.c.final === 55.46, 'test 7c: ' + JSON.stringify(r.c));
            assert(r.t9.grade === 50 && r.t9.count === 10 && r.t9.prof === null, 'test 9: ' + JSON.stringify(r.t9));
            assert(r.open === '1,2', 'opportunity from links and checkpoints (retired 3, removed link 4, other class 5 left out): ' + r.open);
            assert(r.ov === '2+6 / 2', 'overrides: ' + r.ov);
            assert(r.t12[0].flagged === true && r.t12[0].count === 3 && r.t12[1] === false, 'test 12: ' + JSON.stringify(r.t12));
            assert(r.t13.length === 1 && r.t13[0].activityId === '1' && r.t13[0].skillId === '17' && r.t13[0].missing === 1 && r.t13[0].studentIds[0] === '8', 'test 13: ' + JSON.stringify(r.t13));
            assert(r.off === true, 'mode off still graded');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'students: Undo after the deletion has synced keeps the student, in both sync directions (i166 follow-up)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            const r = await page.evaluate(async sid => {
                const pause = ms => new Promise(res => setTimeout(res, ms));
                await db.students.update(sid, { status: 'archived' });
                await pages.students.deleteStudent(sid);
                const deletedCopy = await db.students.get(sid);      // what the other device holds after syncing the delete
                await pause(20);
                const undo = [...document.querySelectorAll('#toast-container button')].find(b => b.textContent === 'Undo');
                undo.click();
                await pause(300);
                const undone = await db.students.get(sid);
                // 1. This device pulls the other device's copy, which still has the deletion.
                await driveSync.applyPulledData({ students: [deletedCopy] });
                const afterPullHere = await db.students.get(sid);
                // 2. The other device (still deleted) pulls this device's undone copy.
                await db.students.put(deletedCopy);
                await driveSync.applyPulledData({ students: [undone] });
                const afterPullThere = await db.students.get(sid);
                return { undone, afterPullHere, afterPullThere, deletedAt: deletedCopy.deletedAt };
            }, ids.studentIds[0]);
            assert(r.undone.restoredAt && r.undone.restoredAt > r.deletedAt && r.undone.updatedAt === r.undone.restoredAt, 'Undo did not set restoredAt/updatedAt: ' + JSON.stringify(r.undone));
            assert(r.undone.status === 'archived' && !r.undone.deletedAt, 'Undo did not bring back the archived student: ' + JSON.stringify(r.undone));
            assert(!r.afterPullHere.deletedAt && r.afterPullHere.status === 'archived', 'the other device\'s older deletion won here: ' + JSON.stringify(r.afterPullHere));
            assert(!r.afterPullThere.deletedAt && r.afterPullThere.status === 'archived', 'the Undo did not reach the other device: ' + JSON.stringify(r.afterPullThere));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'deleted items: Restore brings a student back with the status they had; older deletions come back active',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            const r = await page.evaluate(async ([archivedId, oldId]) => {
                await db.students.update(archivedId, { status: 'archived' });
                await pages.students.deleteStudent(archivedId);
                // Deleted before this fix: no statusBeforeDelete stored
                await db.students.update(oldId, { status: 'deleted', deletedAt: new Date().toISOString() });
                await pages.settings.restoreItem('students', archivedId);
                await pages.settings.restoreItem('students', oldId);
                return { archived: await db.students.get(archivedId), old: await db.students.get(oldId) };
            }, [ids.studentIds[0], ids.studentIds[1]]);
            assert(!r.archived.deletedAt && r.archived.status === 'archived', 'Restore did not keep the archived status: ' + JSON.stringify(r.archived));
            assert(r.archived.restoredAt && r.archived.updatedAt === r.archived.restoredAt, 'Restore did not set restoredAt/updatedAt: ' + JSON.stringify(r.archived));
            assert(!r.old.deletedAt && r.old.status === 'active', 'an older deletion did not come back active: ' + JSON.stringify(r.old));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'progressbook numbers: one list, one box each; digits only; no two students share one; the count of active students without a number reaches 0 (3-04)',
        fn: async ({ browser, base }) => {
            const ls = { 'drive-sync-enabled': 'true', 'drive-sync-password': 'test-sync-pass' };
            const { page, errors, context } = await openApp(browser, base, { localStorageInit: ls });
            const ids = await seedFakeData(page);
            // One archived fake student: not in the list, not counted
            await page.evaluate(() => db.students.add({ firstName: 'Fake', lastName: 'Archived', name: 'Fake Archived', status: 'archived', createdAt: new Date().toISOString() }));
            await page.evaluate(() => { window.__toasts = []; const orig = ui.showToast.bind(ui); ui.showToast = (m, t, d) => { window.__toasts.push({ m, t }); return orig(m, t, d); }; });
            await page.evaluate(() => router.navigate('students'));
            await page.evaluate(() => pages.students.openProgressbookNumbers());
            const boxes = () => page.$$eval('#progressbook-list .progressbook-input', els => els.map(e => ({ id: parseInt(e.dataset.studentId), v: e.value })));
            const summary = () => page.textContent('#progressbook-summary');
            let b = await boxes();
            assert(b.length === 4, `boxes: ${b.length} (expected the 4 active fake students)`);
            assert(/^0 of 4 active students have a number; 4 without one\.$/.test(await summary()), 'summary: ' + await summary());
            const fill = vals => page.evaluate(vals => { const inputs = document.querySelectorAll('#progressbook-list .progressbook-input'); vals.forEach((v, i) => { if (v !== null) inputs[i].value = v; }); }, vals);
            const saved = () => page.evaluate(() => db.students.toArray().then(all => all.filter(s => s.status !== 'archived').map(s => s.progressbookId || '')));
            // Letters are refused; nothing saved
            await fill(['1001', 'l002', null, null]);
            await page.evaluate(() => pages.students.saveProgressbookNumbers());
            assert((await page.evaluate(() => window.__toasts)).some(x => x.t === 'error' && /digits only.*Nothing was saved/.test(x.m)), 'letters not refused');
            assert((await saved()).every(v => v === ''), 'a refused save wrote numbers');
            // Two students with one number are refused; nothing saved
            await fill(['1001', '1001', null, null]);
            await page.evaluate(() => pages.students.saveProgressbookNumbers());
            assert((await page.evaluate(() => window.__toasts)).some(x => x.t === 'error' && /can't share a Progressbook number/.test(x.m)), 'duplicate not refused');
            assert((await saved()).every(v => v === ''), 'a refused duplicate wrote numbers');
            // Three good numbers save (a space is ignored); the list and count update; the change will sync
            await page.evaluate(() => { driveSync._dirty = false; });
            await fill(['1001', '1 002', '1003', null]);
            await page.evaluate(() => pages.students.saveProgressbookNumbers());
            assert(/^3 of 4 active students have a number; 1 without one\.$/.test(await summary()), 'summary after save: ' + await summary());
            const s1 = await saved();
            assert(s1.filter(v => v).sort().join(',') === '1001,1002,1003', 'saved: ' + JSON.stringify(s1));
            assert(await page.evaluate(() => driveSync._dirty === true), 'the save was not marked for sync');
            const stamped = await page.evaluate(() => db.students.toArray().then(all => all.filter(s => s.progressbookId).every(s => s.updatedAt)));
            assert(stamped, 'a saved number has no updatedAt, so it would not sync');
            // "Only students with no number" shows the one left; Enter in a box moves to the next
            await page.check('#progressbook-missing-only');
            b = await boxes();
            assert(b.length === 1 && b[0].v === '', 'missing-only filter: ' + JSON.stringify(b));
            await page.uncheck('#progressbook-missing-only');
            await page.focus('#progressbook-list .progressbook-input >> nth=0');
            await page.keyboard.press('Enter');
            const focusedIndex = await page.evaluate(() => [...document.querySelectorAll('#progressbook-list .progressbook-input')].indexOf(document.activeElement));
            assert(focusedIndex === 1, 'Enter did not move to the next box: ' + focusedIndex);
            // The last one through the student's own edit dialog; a taken number is refused there too
            const lastId = await page.evaluate(() => db.students.toArray().then(all => all.find(s => s.status !== 'archived' && !s.progressbookId).id));
            await page.evaluate(() => pages.students.closeProgressbookNumbers());
            await page.evaluate(id => modals.showEditStudent(id), lastId);
            await page.waitForTimeout(300);
            await page.evaluate(() => { document.getElementById('student-progressbook-id').value = '1001'; });
            await page.evaluate(() => modals.saveStudent());
            assert((await page.evaluate(() => window.__toasts)).some(x => /already belongs to another student/.test(x.m)), 'the edit dialog took a used number');
            await page.evaluate(() => { document.getElementById('student-progressbook-id').value = '1004'; });
            await page.evaluate(() => modals.saveStudent());
            await page.waitForTimeout(300);
            assert((await page.evaluate(id => db.students.get(id), lastId)).progressbookId === '1004', 'the edit dialog did not save the number');
            await page.evaluate(() => pages.students.openProgressbookNumbers());
            assert(/^4 of 4 active students have a number; 0 without one\.$/.test(await summary()), 'final summary: ' + await summary());
            // It never goes to the webhook: the files that build request bodies mention it only in the student dialog
            const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
            const others = ['js/pages/activities.js', 'js/pages/attendance.js', 'js/pages/activityDetail.js', 'js/pages/dashboard.js', 'js/features/formImport.js'].filter(f => /progressbookId/.test(read(f)));
            const modalLines = read('js/ui/modals.js').split('\n').filter(l => /progressbookId/.test(l));
            assert(others.length === 0 && modalLines.length === 6 && modalLines.every(l => /student-progressbook-id|const progressbookId|progressbookId === null|if \(progressbookId\)|s\.progressbookId|progressbookId: progressbookId/.test(l)), 'progressbookId outside the student dialog: ' + others.join(', ') + ' ' + modalLines.length);
            const helper = await page.evaluate(() => document.getElementById('student-progressbook-id').parentElement.querySelector('.form-helper').textContent);
            assert(helper === 'For the Progressbook grade exports. Kept in ShopFlow and its encrypted sync copy; never sent to the Student Hub or Classroom.', 'the number box helper: ' + helper);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'progressbook exports: two four-column CSVs match the hand-calculated fixture; no number = left out; leading zeros dropped; = exports as text (3-08)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            const r = await page.evaluate(async ({ classId, activityId, s }) => {
                const now = new Date().toISOString();
                const yesterday = formatDateString(new Date(Date.now() - 86400000));
                const add = (name, category) => db.skills.add({ name, category, createdAt: now });
                const T1 = await add('Fake Tech 1', 'Design'), T2 = await add('Fake Tech 2', 'Measurement');
                const P = [];
                for (let i = 1; i <= 4; i++) P.push(await add('Fake Prof ' + i, 'Professional'));
                await db.activities.update(activityId, { endDate: yesterday, skillsAssessed: [T1, T2, ...P].map(skillId => ({ skillId })) });
                let t = 0;
                const rate = (studentId, skillId, rating) => db.skillObservations.add({ studentId, skillId, activityId, checkpointId: null, rating, evidenceType: 'checkpoint_conversation', createdAt: new Date(Date.UTC(2026, 9, 1, 12, t++)).toISOString(), updatedAt: now });
                // Ada: T1 P -> tech (85+50)/2 = 67.5; P1 A -> prof (100+50+50+50)/4 = 62.5
                await rate(s[0], T1, 'Proficient'); await rate(s[0], P[0], 'Advanced');
                // Liam: T1 D -> 70, T2 A -> 100 -> tech 85; P1 P -> prof (85+150)/4 = 58.75
                await rate(s[1], T1, 'Developing'); await rate(s[1], T2, 'Advanced'); await rate(s[1], P[0], 'Proficient');
                // Maya has no Progressbook number; Noah's has leading zeros and his last name starts with =
                await db.students.update(s[0], { progressbookId: '1001' });
                await db.students.update(s[1], { progressbookId: '1002' });
                await db.students.update(s[3], { progressbookId: '00456', lastName: '=HYPERLINK(1)' });
                await setClassMasteryMode(classId, 'weighted-average');
                const files = [];
                window.downloadCSV = (content, filename) => files.push({ content, filename });
                router.navigate('settings');
                await pages.settings.renderClasses();
                const button = !!document.querySelector(`button[onclick="progressbookExport.open(${classId})"]`);
                await progressbookExport.open(classId);
                const out = {
                    button,
                    rows: document.querySelectorAll('#modal-progressbook-export .progressbook-export-row').length,
                    missing: document.getElementById('progressbook-export-missing')?.textContent || '',
                    flags: [...document.querySelectorAll('#progressbook-export-flags li')].map(li => li.textContent),
                    open: !document.getElementById('modal-progressbook-export').classList.contains('hidden')
                };
                progressbookExport.download('technical');
                progressbookExport.download('professional');
                out.files = files.slice();
                // Skills grading off: no export
                await setClassMasteryMode(classId, 'off');
                progressbookExport.close();
                await progressbookExport.open(classId);
                out.offStaysClosed = document.getElementById('modal-progressbook-export').classList.contains('hidden');
                // SEC16: the student CSV escapes too
                await db.students.update(s[2], { firstName: '@SUM(1,2)', lastName: 'Sample, "Jr"' });
                files.length = 0;
                await pages.students.exportToCSV(false);
                out.studentCsv = files[0] ? files[0].content : '';
                return out;
            }, { classId: ids.classId, activityId: ids.activityId, s: ids.studentIds });
            assert(r.button && r.open && r.rows === 4, 'preview: ' + JSON.stringify({ button: r.button, open: r.open, rows: r.rows }));
            assert(/^1 student\(s\) have no Progressbook number/.test(r.missing), 'missing-number line: ' + r.missing);
            assert(r.flags.length === 4 && r.flags.every(f => /student\(s\) have no rating for Fake Prof/.test(f)), 'Amendment 5c flags in the preview: ' + JSON.stringify(r.flags));
            const lines = c => c.trim().split('\n');
            const want = {
                technical: ['Student Number,First Name,Last Name,Mark', "456,Noah,'=HYPERLINK(1),50", "1002,Liam,O'Brien,85", '1001,Ada,Tester,67.5'],
                professional: ['Student Number,First Name,Last Name,Mark', "456,Noah,'=HYPERLINK(1),50", "1002,Liam,O'Brien,58.75", '1001,Ada,Tester,62.5']
            };
            assert(r.files.length === 2, 'files downloaded: ' + r.files.length);
            for (const [i, cat] of ['technical', 'professional'].entries()) {
                const got = lines(r.files[i].content);
                assert(got[0] === want[cat][0] && JSON.stringify(got.slice(1).sort()) === JSON.stringify(want[cat].slice(1).sort()), `${cat} CSV:\n${r.files[i].content}`);
                const expectName = 'Progressbook_Test_Engineering_1_' + (cat === 'technical' ? 'Engineering_Skills' : 'Professional_Practice');
                assert(r.files[i].filename === expectName, 'filename: ' + r.files[i].filename);
            }
            assert(r.offStaysClosed, 'the export opened for a class with skills grading off');
            const wantFirst = '"\'@SUM(1,2)"', wantLast = '"Sample, ""Jr"""';
            assert(r.studentCsv.includes(wantFirst) && r.studentCsv.includes(wantLast), 'student CSV escaping: ' + r.studentCsv);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'mastery engine: from the database, a config change and a removed middle rating recompute; nothing is written (tests 5, 6; 3-06)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            const r = await page.evaluate(async ({ classId, activityId, s0 }) => {
                const now = new Date().toISOString();
                const yesterday = formatDateString(new Date(Date.now() - 86400000));
                const skillId = await db.skills.add({ name: 'Fake Engine Skill', category: 'Design', createdAt: now });
                await db.activities.update(activityId, { endDate: yesterday, skillsAssessed: [{ skillId, skillName: 'Fake Engine Skill' }] });
                const obsIds = [];
                for (const [i, rating] of ['Developing', 'Proficient', 'Proficient', 'Advanced'].entries()) {
                    obsIds.push(await db.skillObservations.add({ studentId: s0, skillId, activityId, checkpointId: null, rating, evidenceType: 'checkpoint_conversation', createdAt: new Date(Date.UTC(2026, 9, 1 + i, 12)).toISOString(), updatedAt: now }));
                }
                const dump = async () => JSON.stringify(await Promise.all(['skillLevels', 'skillObservations', 'settings', 'students'].map(t => db.table(t).toArray())));
                const score = res => res.students.find(s => String(s.studentId) === String(s0)).technical.skills.find(x => x.skillId === String(skillId)).score;
                const out = {};
                out.off = (await masteryEngine.recomputeAll(classId)).off;          // no mastery-mode row: off
                await setClassMasteryMode(classId, 'weighted-average');
                const before = await dump();
                const r1 = await masteryEngine.recomputeAll(classId);
                await masteryEngine.recomputeSkillScore(s0, skillId, classId);
                out.unchanged = (await dump()) === before;
                out.s1 = score(r1);
                out.others = r1.students.filter(s => String(s.studentId) !== String(s0)).map(s => s.technical.grade);
                out.count = r1.students.length;
                await db.settings.put({ key: 'mastery-config-' + classId, value: { levelValues: { proficient: 80 } }, updatedAt: now });
                out.s2 = score(await masteryEngine.recomputeAll(classId));
                out.one = (await masteryEngine.recomputeSkillScore(s0, skillId, classId)).steps.map(s => s.score);
                await db.settings.delete('mastery-config-' + classId);
                await db.skillObservations.update(obsIds[1], { deletedAt: now, updatedAt: now });
                out.s3 = (await masteryEngine.recomputeSkillScore(String(s0), String(skillId), classId)).steps.map(s => s.score);
                return out;
            }, { classId: ids.classId, activityId: ids.activityId, s0: ids.studentIds[0] });
            assert(r.off === true, 'a class with no mastery-mode row was graded');
            assert(r.s1 === 94.1 && r.count === 4 && r.others.every(g => g === 50), 'default config: ' + JSON.stringify(r));
            assert(r.s2 === 92.6 && JSON.stringify(r.one) === JSON.stringify([70, 76.5, 78.8, 92.6]), 'test 5 (proficient 80): ' + JSON.stringify({ s2: r.s2, one: r.one }));
            assert(JSON.stringify(r.s3) === JSON.stringify([70, 79.8, 92.9]), 'test 6 (removed middle rating): ' + JSON.stringify(r.s3));
            assert(r.unchanged, 'the engine wrote to the database');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'progressbook show workings: each row expands to its open skills, category and score or "not rated (counts as 50)"; CSVs and tables unchanged (i192)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            await page.evaluate(async ({ classId, activityId, s }) => {
                const now = new Date().toISOString();
                const yesterday = formatDateString(new Date(Date.now() - 86400000));
                const add = (name, category) => db.skills.add({ name, category, createdAt: now });
                const T1 = await add('Fake Tech 1', 'Design'), T2 = await add('Fake Tech 2', 'Measurement');
                const P = [];
                for (let i = 1; i <= 3; i++) P.push(await add('Fake Prof ' + i, 'Professional'));
                P.push(await add('Fake Prof 4 <i>x</i>', 'Professional'));
                await db.activities.update(activityId, { endDate: yesterday, skillsAssessed: [T1, T2, ...P].map(skillId => ({ skillId })) });
                let t = 0;
                const rate = (studentId, skillId, rating) => db.skillObservations.add({ studentId, skillId, activityId, checkpointId: null, rating, evidenceType: 'checkpoint_conversation', createdAt: new Date(Date.UTC(2026, 9, 1, 12, t++)).toISOString(), updatedAt: now });
                // Ada: T1 Proficient then Developing -> 85, then 0.40*70 + 0.60*85 = 79; P1 Advanced -> 100
                await rate(s[0], T1, 'Proficient'); await rate(s[0], T1, 'Developing'); await rate(s[0], P[0], 'Advanced');
                // Liam: T1 D -> 70, T2 A -> 100; P1 P -> 85
                await rate(s[1], T1, 'Developing'); await rate(s[1], T2, 'Advanced'); await rate(s[1], P[0], 'Proficient');
                await db.students.update(s[0], { progressbookId: '1001' });
                await db.students.update(s[1], { progressbookId: '1002' });
                await setClassMasteryMode(classId, 'weighted-average');
                router.navigate('settings');
                await pages.settings.renderClasses();
            }, { classId: ids.classId, activityId: ids.activityId, s: ids.studentIds });
            const dump = () => page.evaluate(async () => {
                const out = {};
                for (const t of db.tables) out[t.name] = await t.toArray();
                return JSON.stringify(out);
            });
            const files = () => page.evaluate(() => {
                const got = [];
                window.downloadCSV = (content, filename) => got.push({ content, filename });
                progressbookExport.download('technical');
                progressbookExport.download('professional');
                return got;
            });
            await page.evaluate(classId => progressbookExport.open(classId), ids.classId);
            const csvBefore = await files();   // (each download adds one activityLog line, as on #31)
            const before = await dump();
            // Every workings row starts hidden; one ▸ per student row
            const shape = await page.evaluate(() => ({
                rows: document.querySelectorAll('#modal-progressbook-export .progressbook-export-row').length,
                toggles: document.querySelectorAll('#modal-progressbook-export .progressbook-workings-toggle').length,
                hidden: [...document.querySelectorAll('#modal-progressbook-export .progressbook-export-workings')].every(r => r.hidden && r.offsetParent === null)
            }));
            assert(shape.rows === 4 && shape.toggles === 4 && shape.hidden, 'workings rows: ' + JSON.stringify(shape));
            const indexOf = first => page.evaluate(first => [...document.querySelectorAll('#modal-progressbook-export .progressbook-export-row')].findIndex(tr => tr.cells[0].textContent.includes(first)), first);
            const expand = async first => {
                const i = await indexOf(first);
                await page.click(`#progressbook-workings-toggle-${i}`);
                return page.evaluate(i => {
                    const row = document.getElementById('progressbook-workings-' + i);
                    return {
                        visible: !row.hidden && row.offsetParent !== null,
                        expanded: document.getElementById('progressbook-workings-toggle-' + i).getAttribute('aria-expanded'),
                        italic: row.querySelectorAll('i').length,
                        lines: [...row.querySelectorAll('.progressbook-workings-line')].map(tr => [...tr.cells].map(c => c.textContent.trim()).join(' | '))
                    };
                }, i);
            };
            const ada = await expand('Ada');
            const liam = await expand('Liam');
            const nr = 'not rated (counts as 50)';
            const wantAda = ['Fake Tech 1 | Engineering | 79', `Fake Tech 2 | Engineering | ${nr}`, 'Fake Prof 1 | Professional | 100', `Fake Prof 2 | Professional | ${nr}`, `Fake Prof 3 | Professional | ${nr}`, `Fake Prof 4 <i>x</i> | Professional | ${nr}`];
            const wantLiam = ['Fake Tech 1 | Engineering | 70', 'Fake Tech 2 | Engineering | 100', 'Fake Prof 1 | Professional | 85', `Fake Prof 2 | Professional | ${nr}`, `Fake Prof 3 | Professional | ${nr}`, `Fake Prof 4 <i>x</i> | Professional | ${nr}`];
            assert(ada.visible && ada.expanded === 'true' && JSON.stringify(ada.lines) === JSON.stringify(wantAda), 'Ada workings: ' + JSON.stringify(ada));
            assert(liam.visible && JSON.stringify(liam.lines) === JSON.stringify(wantLiam), 'Liam workings: ' + JSON.stringify(liam));
            assert(ada.italic === 0, 'a skill name was not escaped');
            // A second tap hides it again
            const i = await indexOf('Ada');
            await page.click(`#progressbook-workings-toggle-${i}`);
            const closed = await page.evaluate(i => document.getElementById('progressbook-workings-' + i).hidden && document.getElementById('progressbook-workings-toggle-' + i).getAttribute('aria-expanded') === 'false', i);
            assert(closed, 'the second tap did not hide the workings');
            // A changed Beginning value shows in the line (the config's value, not a literal 50)
            const cfg60 = await page.evaluate(async ({ classId }) => {
                await db.settings.put({ key: 'mastery-config-' + classId, value: { levelValues: { beginning: 60 } } });
                await progressbookExport.open(classId);
                const text = document.getElementById('progressbook-export-body').textContent;
                await db.settings.delete('mastery-config-' + classId);
                return text.includes('not rated (counts as 60)') && !text.includes('not rated (counts as 50)');
            }, { classId: ids.classId });
            assert(cfg60, 'the "not rated" line does not use the class config\'s Beginning value');
            await page.evaluate(classId => progressbookExport.open(classId), ids.classId);
            await page.click(`#progressbook-workings-toggle-${await indexOf('Liam')}`);
            // Read-only: nothing in the database changed; the CSVs are byte-identical with workings open
            const after = await dump();
            assert(after === before, 'the preview or the workings changed the database');
            const csvAfter = await files();
            assert(csvBefore.length === 2 && JSON.stringify(csvAfter) === JSON.stringify(csvBefore), 'CSVs changed: ' + JSON.stringify({ csvBefore, csvAfter }));
            const want = {
                technical: 'Student Number,First Name,Last Name,Mark\n1002,Liam,O\'Brien,85\n1001,Ada,Tester,64.5\n',
                professional: 'Student Number,First Name,Last Name,Mark\n1002,Liam,O\'Brien,58.75\n1001,Ada,Tester,62.5\n'
            };
            const norm = c => c.replace(/\r\n/g, '\n');
            assert(norm(csvBefore[0].content) === want.technical && norm(csvBefore[1].content) === want.professional, 'CSV text: ' + JSON.stringify(csvBefore.map(f => f.content)));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'sync while open: an idle iPad picks up the PC\'s change on its own, without a reload; never while editing (2-03)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'drive-sync-enabled': 'true', 'drive-sync-password': 'test-sync-pass' };
            const pc = await openApp(browser, base, { stub, localStorageInit: ls });
            await seedFakeData(pc.page);
            const ipad = await openApp(browser, base, { stub, localStorageInit: ls });
            await ipad.page.evaluate(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }); });
            await seedFakeData(ipad.page);
            // The real schedule: every 5 minutes, and at most once a minute when the app comes back
            const cfg = await ipad.page.evaluate(() => ({ every: driveSyncWhileOpen.INTERVAL_MS, gap: driveSyncWhileOpen.MIN_GAP_MS, started: driveSyncWhileOpen._started }));
            assert(cfg.every === 300000 && cfg.gap === 60000 && cfg.started, 'schedule: ' + JSON.stringify(cfg));
            // Let the iPad's own start-up download finish, then run its timer fast for the test
            for (let i = 0; i < 100 && !stub.callsFor('load_from_drive').some(c => c.body.requestingDevice === 'iPad'); i++) await ipad.page.waitForTimeout(100);
            await ipad.page.waitForTimeout(300);
            await ipad.page.evaluate(() => {
                window.__noReload = 'still here';
                clearInterval(driveSyncWhileOpen._timer);
                driveSyncWhileOpen.INTERVAL_MS = 1500;
                driveSyncWhileOpen._timer = setInterval(() => driveSyncWhileOpen.tick('timer'), driveSyncWhileOpen.INTERVAL_MS);
                window.__renders = 0;
                const orig = pages.students.render.bind(pages.students);
                pages.students.render = (...a) => { window.__renders++; return orig(...a); };
            });
            await ipad.page.evaluate(() => router.navigate('students'));
            const rendersBefore = await ipad.page.evaluate(() => window.__renders);
            // The PC adds a fake student and uploads
            await pc.page.evaluate(async () => {
                const now = new Date().toISOString();
                await db.students.add({ firstName: 'Fake', lastName: 'Newcomer', name: 'Fake Newcomer', email: 'newcomer@example.test', status: 'active', createdAt: now, updatedAt: now });
                driveSync._dirty = true; await driveSync.push();
            });
            const iPadUploadsBefore = stub.callsFor('save_to_drive').filter(c => c.body.deviceId === 'iPad').length;
            let got = 0;
            for (let i = 0; i < 60 && !got; i++) { await ipad.page.waitForTimeout(100); got = await ipad.page.evaluate(() => db.students.filter(s => s.email === 'newcomer@example.test').count()); }
            await ipad.page.waitForTimeout(300);
            const after = await ipad.page.evaluate(() => ({ still: window.__noReload, renders: window.__renders, last: driveSyncWhileOpen.lastResult }));
            assert(got === 1, 'the idle iPad did not pick up the new student within the interval');
            assert(after.still === 'still here', 'the page reloaded');
            assert(after.renders > rendersBefore, 'the students list was not redrawn: ' + JSON.stringify(after));
            assert(stub.callsFor('save_to_drive').filter(c => c.body.deviceId === 'iPad').length === iPadUploadsBefore, 'the background check uploaded');
            // Never while editing: a dialog open, unsaved attendance marks, or the checkpoint page
            await ipad.page.evaluate(() => clearInterval(driveSyncWhileOpen._timer));
            const blocked = await ipad.page.evaluate(async () => {
                const out = {};
                const before = () => driveSyncWhileOpen._lastAttempt;
                document.querySelector('.modal-backdrop').classList.remove('hidden');
                let t = before(); out.dialog = [await driveSyncWhileOpen.tick('timer'), driveSyncWhileOpen._lastAttempt === t];
                document.querySelector('.modal-backdrop').classList.add('hidden');
                router.navigate('attendance');
                pages.attendance.pendingChanges = { fake: 'absent' };
                t = before(); out.attendance = [await driveSyncWhileOpen.tick('timer'), driveSyncWhileOpen._lastAttempt === t];
                pages.attendance.pendingChanges = {};
                router.navigate('checkpoint');
                t = before(); out.checkpoint = [await driveSyncWhileOpen.tick('timer'), driveSyncWhileOpen._lastAttempt === t];
                router.navigate('students');
                out.visibleTooSoon = await driveSyncWhileOpen.tick('visible');
                return out;
            });
            assert(/form is open/.test(blocked.dialog[0]) && blocked.dialog[1], 'dialog open: ' + JSON.stringify(blocked.dialog));
            assert(/unsaved attendance/.test(blocked.attendance[0]) && blocked.attendance[1], 'attendance: ' + JSON.stringify(blocked.attendance));
            assert(/editing page/.test(blocked.checkpoint[0]) && blocked.checkpoint[1], 'checkpoint page: ' + JSON.stringify(blocked.checkpoint));
            assert(blocked.visibleTooSoon === 'too soon', 'coming back to the app within a minute: ' + blocked.visibleTooSoon);
            assert(real(pc.errors).length === 0 && real(ipad.errors).length === 0, 'page errors: ' + real(pc.errors).concat(real(ipad.errors)).join(' | '));
            await pc.context.close(); await ipad.context.close();
        }
    },
    {
        name: 'sync reliability: settings, class and note edits written without updatedAt reach the other device; differing settings = 0; pulls keep timestamps (3-17)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'drive-sync-enabled': 'true', 'drive-sync-password': 'test-sync-pass' };
            const pc = await openApp(browser, base, { stub, localStorageInit: ls });
            const ids = await seedFakeData(pc.page);
            const ipad = await openApp(browser, base, { stub, localStorageInit: ls });
            await ipad.page.evaluate(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }); });
            await seedFakeData(ipad.page);
            for (let i = 0; i < 100 && !stub.callsFor('load_from_drive').some(c => c.body.requestingDevice === 'iPad'); i++) await ipad.page.waitForTimeout(100);
            await ipad.page.waitForTimeout(300);
            const push = p => p.evaluate(async () => { driveSync._dirty = true; return driveSync.push(); });
            const pull = p => p.evaluate(() => driveSyncPull.checkOnLoad());
            // Line both devices up, and give the PC a note the iPad also has
            const noteId = await pc.page.evaluate(sid => db.notes.add({ entityType: 'student', entityId: sid, content: 'Fake note', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }), ids.studentIds[0]);
            await push(pc.page); await pull(ipad.page); await push(ipad.page); await pull(pc.page);
            // The PC changes things the way the app's screens do: no updatedAt, no markDirty
            const dirty = await pc.page.evaluate(async ({ classId, noteId }) => {
                driveSync._dirty = false;
                await db.settings.put({ key: 'period-year-map', value: { 1: classId, 2: classId } });
                await db.settings.put({ key: 'skill-categories', value: ['Fake A', 'Fake B'] });
                await db.settings.put({ key: 'active-school-year', value: '2026-2027' });
                await db.settings.put({ key: 'last-manual-export', value: 'PC-ONLY' });
                await db.classes.update(classId, { name: 'Fake Renamed Class' });
                await db.notes.update(noteId, { content: 'Fake note, edited on the PC' });
                return driveSync._dirty;
            }, { classId: ids.classId, noteId });
            await ipad.page.evaluate(() => db.transaction('rw', db.settings, async () => { if (typeof syncHooks !== 'undefined') syncHooks.markBulk(); await db.settings.put({ key: 'last-manual-export', value: 'IPAD-ONLY' }); }));
            await push(pc.page);
            await pull(ipad.page);
            const settingsOf = p => p.evaluate(() => db.settings.toArray().then(rows => Object.fromEntries(rows.filter(r => !['last-manual-export', 'anon-id-counter'].includes(r.key)).map(r => [r.key, JSON.stringify(r.value)]))));
            const [a, b] = [await settingsOf(pc.page), await settingsOf(ipad.page)];
            const differing = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]);
            const onIpad = await ipad.page.evaluate(async ({ classId, noteId }) => ({
                className: (await db.classes.get(classId)).name,
                note: (await db.notes.get(noteId)).content,
                exportAt: (await db.settings.get('last-manual-export')).value,
                mapStamp: (await db.settings.get('period-year-map')).updatedAt
            }), { classId: ids.classId, noteId });
            const pcMapStamp = await pc.page.evaluate(() => db.settings.get('period-year-map').then(r => r.updatedAt));
            // And back: the iPad renames the flex period
            await ipad.page.evaluate(() => db.settings.put({ key: 'flex-period-name', value: 'Fake Flex' }));
            await push(ipad.page); await pull(pc.page);
            const back = await pc.page.evaluate(() => db.settings.get('flex-period-name').then(r => r && r.value));
            assert(dirty === true, 'a change made without markDirty was not queued for upload');
            assert(differing.length === 0, 'settings that differ after the sync: ' + differing.join(', '));
            assert(onIpad.className === 'Fake Renamed Class' && onIpad.note === 'Fake note, edited on the PC', 'class/note edits: ' + JSON.stringify(onIpad));
            assert(onIpad.exportAt === 'IPAD-ONLY', "the PC's last-export time replaced the iPad's own");
            assert(pcMapStamp && onIpad.mapStamp === pcMapStamp, 'the pull re-stamped a pulled record: ' + JSON.stringify({ pc: pcMapStamp, ipad: onIpad.mapStamp }));
            assert(back === 'Fake Flex', 'the iPad\'s setting did not reach the PC: ' + back);
            assert(real(pc.errors).length === 0 && real(ipad.errors).length === 0, 'page errors: ' + real(pc.errors).concat(real(ipad.errors)).join(' | '));
            await pc.context.close(); await ipad.context.close();
        }
    },
    {
        name: 'restore: a restored snapshot survives the next sync on both devices; a restored deleted item survives too; old snapshots are upgraded (3-18)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'drive-sync-enabled': 'true', 'drive-sync-password': 'test-sync-pass' };
            const pc = await openApp(browser, base, { stub, localStorageInit: ls });
            const ids = await seedFakeData(pc.page);
            const ipad = await openApp(browser, base, { stub, localStorageInit: ls });
            await ipad.page.evaluate(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }); });
            await seedFakeData(ipad.page);
            for (let i = 0; i < 100 && !stub.callsFor('load_from_drive').some(c => c.body.requestingDevice === 'iPad'); i++) await ipad.page.waitForTimeout(100);
            await ipad.page.waitForTimeout(300);
            const push = p => p.evaluate(async () => { driveSync._dirty = true; return driveSync.push(); });
            const pull = p => p.evaluate(() => driveSyncPull.checkOnLoad());
            const both = async () => { await push(pc.page); await pull(ipad.page); await push(ipad.page); await pull(pc.page); };
            const state = p => p.evaluate(async s0 => {
                const all = await db.students.toArray();
                return { live: all.filter(s => !s.deletedAt).length, first: (await db.students.get(s0)).firstName };
            }, ids.studentIds[0]);
            await both();
            // The snapshot: 4 fake students
            const backupId = await pc.page.evaluate(() => autoBackup.saveSafety('Fake snapshot'));
            // After it: a fifth student, and a rename; both devices have them
            await pc.page.evaluate(async s0 => {
                await db.students.add({ firstName: 'Fake', lastName: 'Later', name: 'Fake Later', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
                await db.students.update(s0, { firstName: 'Renamed', updatedAt: new Date().toISOString() });
            }, ids.studentIds[0]);
            await both();
            const before = { pc: await state(pc.page), ipad: await state(ipad.page) };
            // Restore the snapshot on the PC (the same steps as the Restore button, without the reload)
            const uploadsBefore = stub.callsFor('save_to_drive').length;
            const downloadsBefore = stub.callsFor('load_from_drive').length;
            const summary = await pc.page.evaluate(async id => autoBackup.restoreData(await backupDb.backups.get(id)), backupId);
            const afterRestore = await state(pc.page);
            const uploadsDuring = stub.callsFor('save_to_drive').length - uploadsBefore;
            const downloadsDuring = stub.callsFor('load_from_drive').length - downloadsBefore;
            await pull(ipad.page); await push(ipad.page); await pull(pc.page); await both();
            const after = { pc: await state(pc.page), ipad: await state(ipad.page) };
            // Deleted Items → Restore survives the other device's older deletion
            await pc.page.evaluate(async sid => { await db.students.update(sid, { deletedAt: new Date().toISOString(), status: 'deleted' }); }, ids.studentIds[1]);
            await both();
            await new Promise(r => setTimeout(r, 20));
            await pc.page.evaluate(sid => pages.settings.restoreItem('students', sid), ids.studentIds[1]);
            await both();
            const undeleted = {
                pc: await pc.page.evaluate(sid => db.students.get(sid).then(s => !s.deletedAt), ids.studentIds[1]),
                ipad: await ipad.page.evaluate(sid => db.students.get(sid).then(s => !s.deletedAt), ids.studentIds[1])
            };
            // An old snapshot (Novice levels, name-only students) is upgraded on the way in
            const migrated = await pc.page.evaluate(() => {
                const m = autoBackup.migrateSnapshot({ skillLevels: [{ id: 1, level: 'Novice' }], students: [{ id: 9, name: 'Fake Oldname Student' }] });
                return { level: m.skillLevels[0].level, first: m.students[0].firstName, last: m.students[0].lastName };
            });
            const noDataIndex = await pc.page.evaluate(() => !backupDb.backups.schema.idxByName.data);
            // A failed Auto-Backup says so
            const failed = await pc.page.evaluate(async () => {
                const toasts = []; const orig = ui.showToast.bind(ui); ui.showToast = (m, t) => { toasts.push({ m, t }); };
                const add = backupDb.backups.add; backupDb.backups.add = () => Promise.reject(new Error('Fake quota exceeded'));
                const ok = await autoBackup.save('noon');
                backupDb.backups.add = add; ui.showToast = orig;
                return { ok, toast: toasts.find(x => /Auto-Backup failed/.test(x.m)), stored: localStorage.getItem('auto-backup-last-failure') };
            });
            assert(before.pc.live === 5 && before.ipad.live === 5 && before.ipad.first === 'Renamed', 'setup: ' + JSON.stringify(before));
            assert(afterRestore.live === 4 && afterRestore.first === 'Ada' && summary.keptAsDeleted === 1, 'restore on the PC: ' + JSON.stringify({ afterRestore, summary }));
            assert(summary.uploaded === true && uploadsDuring === 1 && downloadsDuring === 0, 'restore uploads once and downloads nothing: ' + JSON.stringify({ summary, uploadsDuring, downloadsDuring }));
            assert(after.pc.live === 4 && after.ipad.live === 4 && after.pc.first === 'Ada' && after.ipad.first === 'Ada', 'the restore did not survive syncing: ' + JSON.stringify(after));
            assert(undeleted.pc && undeleted.ipad, 'a restored deleted student was deleted again by the sync: ' + JSON.stringify(undeleted));
            assert(migrated.level === 'Beginning' && migrated.first === 'Fake' && migrated.last === 'Oldname Student', 'old snapshot: ' + JSON.stringify(migrated));
            assert(noDataIndex, 'the backup database still indexes the whole snapshot');
            assert(failed.ok === false && failed.toast && failed.toast.t === 'warning' && /Fake quota exceeded/.test(failed.stored || ''), 'Auto-Backup failure: ' + JSON.stringify(failed));
            assert(real(pc.errors).length === 0 && real(ipad.errors).length === 0, 'page errors: ' + real(pc.errors).concat(real(ipad.errors)).join(' | '));
            await pc.context.close(); await ipad.context.close();
        }
    },
    {
        name: 'sync: Sync Now downloads before it uploads, and its result stays on the sync card (1-14)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'drive-sync-enabled': 'true', 'drive-sync-password': 'test-sync-pass' };
            const { page, errors, context } = await openApp(browser, base, { stub, localStorageInit: ls });
            await seedFakeData(page);
            const start = stub.calls.length;
            await page.evaluate(() => router.navigate('settings'));
            await page.evaluate(() => driveSyncNow());
            const order = stub.calls.slice(start).map(c => c.action).filter(a => a === 'load_from_drive' || a === 'save_to_drive');
            assert(order[0] === 'load_from_drive' && order.includes('save_to_drive'), `Sync Now order: ${order.join(' → ')}`);
            const line = await page.textContent('#drive-sync-now-result');
            assert(/Last Sync Now/.test(line) && /Uploaded/.test(line) && /Nothing new to download/.test(line), `result line: "${line}"`);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'full edit: opening fake A then fake B shows B\'s Classroom link (or none), and Save doesn\'t copy A\'s (1-11)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const { classId, activityId: aId } = await seedFakeData(page);
            const bId = await page.evaluate(async classId => {
                const today = getTodayString(), now = new Date().toISOString();
                return db.activities.add({ name: 'Test Activity B', classId, startDate: today, endDate: today, status: 'active', scoringType: 'complete-incomplete', createdAt: now, updatedAt: now });
            }, classId);
            await page.evaluate(id => db.activities.update(id, { classroomLinks: { 'FAKE-COURSE-1': 'FAKE-CW-A' } }), aId);
            const openEdit = async (id, name) => {
                await page.evaluate(id => modals.openFullEdit(id), id);
                await page.waitForFunction(n => document.getElementById('fe-name')?.value === n, name, { timeout: 5000 });
                await page.waitForTimeout(300);
            };
            // Open A and pick its (fake) course and coursework, as "Load Courses" would
            await openEdit(aId, 'Test Activity 1');
            await page.evaluate(() => {
                document.getElementById('fe-classroom-course').innerHTML = '<option value="">Not linked</option><option value="FAKE-COURSE-1">Fake Course</option>';
                document.getElementById('fe-classroom-course').value = 'FAKE-COURSE-1';
                document.getElementById('fe-classroom-cw').innerHTML = '<option value="">Select assignment...</option><option value="FAKE-CW-A">Fake coursework A</option>';
                document.getElementById('fe-classroom-cw').value = 'FAKE-CW-A';
            });
            // Now open B, which has no Classroom link
            await openEdit(bId, 'Test Activity B');
            const shown = await page.evaluate(() => ({ course: document.getElementById('fe-classroom-course').value, cw: document.getElementById('fe-classroom-cw').value }));
            assert(!shown.course && !shown.cw, `B's form still shows A's Classroom selection: ${JSON.stringify(shown)}`);
            await page.evaluate(() => pages.activityEdit.save());
            await page.waitForTimeout(800);
            const links = await page.evaluate(id => db.activities.get(id).then(a => a.classroomLinks || null), bId);
            assert(!links, `saving B linked it to: ${JSON.stringify(links)}`);
            const aLinks = await page.evaluate(id => db.activities.get(id).then(a => a.classroomLinks), aId);
            assert(aLinks && aLinks['FAKE-COURSE-1'] === 'FAKE-CW-A', 'A lost its own Classroom link');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'contract import: an update keeps the status and every left-out field; a field given empty clears it (i174)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await seedFakeData(page);
            const r = await page.evaluate(async () => {
                const now = new Date().toISOString();
                const skillId = await db.skills.add({ name: 'Fake Welding', category: 'Fabrication', createdAt: now });
                await db.standards.add({ code: 'FAKE.1', description: 'Fake standard', createdAt: now });
                const imp = async g => { document.getElementById('import-contract-json').value = JSON.stringify(g); await pages.settings.importContractGuide('paste'); };
                router.navigate('settings');
                await imp({
                    contractCode: 'E9-FAKE-174', unit: 'Fake Unit', phase: 'Build', slidesUrl: 'https://example.test/slides',
                    contractBrief: { clientName: 'Fake Client', problemStatement: 'Fake problem' },
                    learningGoals: ['Old goal'], requiredTools: ['Fake saw'],
                    skillsAssessed: [{ skillName: 'Fake Welding', checkpoints: [1], levelDescriptors: { proficient: 'Welds' } }],
                    webxamCoverage: ['FAKE.1'],
                    checkpoints: [{ number: 1, title: 'Fake CP 1' }]
                });
                const act = (await db.activities.toArray()).find(x => x.contractCode === 'E9-FAKE-174');
                await db.activities.update(act.id, { status: 'archived' });
                // Re-import: phase, slidesUrl, contractBrief, skillsAssessed and webxamCoverage left out;
                // requiredTools and unit given empty; learningGoals changed
                await imp({ contractCode: 'e9-fake-174', unit: '', requiredTools: [], learningGoals: ['New goal'], checkpoints: [{ number: 1, title: 'Fake CP 1' }] });
                const a = await db.activities.get(act.id);
                const links = await db.activitySkills.where('activityId').equals(act.id).toArray();
                const stds = await db.activityStandards.where('activityId').equals(act.id).toArray();
                return { a, links: links.map(l => l.skillId), stds: stds.length, skillId, count: (await db.activities.toArray()).filter(x => /^e9-fake-174$/i.test(x.contractCode || '')).length };
            });
            assert(r.count === 1, 'the re-import made a second assignment');
            assert(r.a.status === 'archived', 'the update changed the status to ' + r.a.status);
            assert(r.a.phase === 'Build' && r.a.slidesUrl === 'https://example.test/slides' && r.a.description === 'Fake problem' && r.a.contractBrief && r.a.contractBrief.clientName === 'Fake Client', 'a left-out field was cleared: ' + JSON.stringify({ phase: r.a.phase, slides: r.a.slidesUrl, description: r.a.description }));
            assert(r.a.skillsAssessed.length === 1 && r.links.length === 1 && r.links[0] === r.skillId && r.stds === 1, 'left-out skills or standards were cleared: ' + JSON.stringify({ sa: r.a.skillsAssessed, links: r.links, stds: r.stds }));
            assert(Array.isArray(r.a.requiredTools) && r.a.requiredTools.length === 0 && r.a.unit === null, 'a field given empty was kept: ' + JSON.stringify({ tools: r.a.requiredTools, unit: r.a.unit }));
            assert(r.a.learningGoals.length === 1 && r.a.learningGoals[0] === 'New goal', 'a changed field was not written');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'contract import: a bad shape is refused before anything is saved, naming the checkpoint and field (i175)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await seedFakeData(page);
            const r = await page.evaluate(async () => {
                const now = new Date().toISOString();
                await db.skills.add({ name: 'Fake Welding', category: 'Fabrication', createdAt: now });
                const imp = async g => { document.getElementById('import-contract-json').value = JSON.stringify(g); await pages.settings.importContractGuide('paste'); };
                router.navigate('settings');
                const good = { contractCode: 'E9-FAKE-175', contractBrief: { problemStatement: 'First version' }, checkpoints: [{ number: 1, title: 'Plan' }, { number: 2, title: 'Build' }] };
                await imp(good);
                const act = (await db.activities.toArray()).find(x => x.contractCode === 'E9-FAKE-175');
                const before = { a: act, cps: await db.checkpoints.where('activityId').equals(act.id).toArray(), log: await db.activityLog.count(), acts: await db.activities.count() };
                // Checkpoint 2 lists a number as a skill: the old importer saved the assignment and checkpoint 1, then crashed
                await imp({ contractCode: 'E9-FAKE-175', contractBrief: { problemStatement: 'Second version' }, checkpoints: [{ number: 1, title: 'Plan v2' }, { number: 2, title: 'Build', skillsAssessable: ['Fake Welding', 42] }] });
                const shown = [...document.querySelectorAll('#import-contract-warnings li')].map(li => li.textContent);
                // A new guide whose skills entry has no name: nothing created
                await imp({ contractCode: 'E9-FAKE-175B', skillsAssessed: [{ levelDescriptors: {} }] });
                const shown2 = [...document.querySelectorAll('#import-contract-warnings li')].map(li => li.textContent);
                const after = { a: await db.activities.get(act.id), cps: await db.checkpoints.where('activityId').equals(act.id).toArray(), log: await db.activityLog.count(), acts: await db.activities.count() };
                return { before, after, shown, shown2 };
            });
            assert(r.shown.some(t => t === 'Checkpoint 2 ("Build"): "skillsAssessable" item 2 must be text (it\'s a number).'), 'refusal not shown as expected: ' + JSON.stringify(r.shown));
            assert(r.shown2.some(t => /^skillsAssessed item 1: "skillName" must be text/.test(t)), 'second refusal: ' + JSON.stringify(r.shown2));
            assert(r.after.a.description === 'First version' && r.after.a.updatedAt === r.before.a.updatedAt, 'the assignment was changed: ' + r.after.a.description);
            assert(JSON.stringify(r.after.cps.map(c => c.title)) === JSON.stringify(r.before.cps.map(c => c.title)), 'checkpoints changed: ' + r.after.cps.map(c => c.title).join(', '));
            assert(r.after.acts === r.before.acts && r.after.log === r.before.log, `something was saved: activities ${r.before.acts}→${r.after.acts}, log ${r.before.log}→${r.after.log}`);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'contract import: an empty checkpoints list is refused on a re-import, and nothing is deleted; a new guide may have none',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            const r = await page.evaluate(async sid => {
                const imp = async g => { document.getElementById('import-contract-json').value = JSON.stringify(g); await pages.settings.importContractGuide('paste'); };
                router.navigate('settings');
                await imp({ contractCode: 'E9-FAKE-CPE', contractBrief: { problemStatement: 'First' }, checkpoints: [{ number: 1, title: 'Plan' }, { number: 2, title: 'Build' }] });
                const act = (await db.activities.toArray()).find(x => x.contractCode === 'E9-FAKE-CPE');
                const cps = await db.checkpoints.where('activityId').equals(act.id).toArray();
                await db.checkpointCompletions.add({ checkpointId: cps[0].id, studentId: sid, completed: true, completedAt: new Date().toISOString() });
                const before = { comps: await db.checkpointCompletions.count(), log: await db.activityLog.count() };
                await imp({ contractCode: 'E9-FAKE-CPE', contractBrief: { problemStatement: 'Second' }, checkpoints: [] });
                const shown = [...document.querySelectorAll('#import-contract-warnings li')].map(li => li.textContent);
                const after = { a: await db.activities.get(act.id), cps: await db.checkpoints.where('activityId').equals(act.id).count(), comps: await db.checkpointCompletions.count(), log: await db.activityLog.count() };
                await imp({ contractCode: 'E9-FAKE-CPE-NEW', checkpoints: [] });
                const created = (await db.activities.toArray()).some(x => x.contractCode === 'E9-FAKE-CPE-NEW');
                return { before, after, shown, created };
            }, ids.studentIds[0]);
            assert(r.shown.length === 1 && r.shown[0] === '"checkpoints" is an empty list. Re-importing E9-FAKE-CPE with it would delete all 2 of its checkpoints and their completion records. Leave "checkpoints" out to keep them.', 'refusal: ' + JSON.stringify(r.shown));
            assert(r.after.cps === 2 && r.after.comps === r.before.comps && r.after.a.description === 'First' && r.after.log === r.before.log, 'something changed: ' + JSON.stringify({ cps: r.after.cps, comps: [r.before.comps, r.after.comps], d: r.after.a.description }));
            assert(r.created, 'a new guide with no checkpoints was refused');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'contract import: level descriptions in any capitals are kept; other keys are warned about (i176)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await seedFakeData(page);
            const r = await page.evaluate(async () => {
                await db.skills.add({ name: 'Fake Welding', category: 'Fabrication', createdAt: new Date().toISOString() });
                router.navigate('settings');
                document.getElementById('import-contract-json').value = JSON.stringify({
                    contractCode: 'E9-FAKE-176',
                    skillsAssessed: [{ skillName: 'fake welding', levelDescriptors: { Beginning: 'b', developing: 'd', PROFICIENT: 'p', ' Advanced ': 'a', Expert: 'x' } }]
                });
                await pages.settings.importContractGuide('paste');
                const act = (await db.activities.toArray()).find(x => x.contractCode === 'E9-FAKE-176');
                return { levels: act.skillsAssessed[0] && act.skillsAssessed[0].levels, shown: [...document.querySelectorAll('#import-contract-warnings li')].map(li => li.textContent) };
            });
            assert(JSON.stringify(r.levels) === JSON.stringify({ Beginning: 'b', Developing: 'd', Proficient: 'p', Advanced: 'a' }), 'levels stored: ' + JSON.stringify(r.levels));
            assert(r.shown.length === 1 && r.shown[0] === 'Skill "fake welding": the level description "Expert" isn\'t Beginning, Developing, Proficient or Advanced, so it wasn\'t imported.', 'warnings: ' + JSON.stringify(r.shown));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'contract import: a fake v6-shaped guide shows 3 warnings, and Full Edit opens it cleanly (1-12)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            await seedFakeData(page);
            await page.evaluate(() => db.inventory.add({ name: 'Fake Band Saw', category: 'Tool', quantity: 1, threshold: 0, createdAt: new Date().toISOString() }));
            const guide = {
                contractCode: 'E9-2627-C9',
                contractBrief: { clientName: 'Fake Client', problemStatement: 'Fake problem', constraints: 'Must be fake', deliverables: ['Fake prototype'] },
                assessmentQuestions: [
                    'A plain-text question',
                    { question: 'Fake question with an options list', options: ['A', 'B', 'C', 'D'] },
                    { question: 'A well-formed fake question', optionA: 'a', optionB: 'b', optionC: 'c', optionD: 'd', correctAnswer: 'A' }
                ],
                certificationsRequired: ['Fake Band Saw'],
                checkpoints: []
            };
            await page.evaluate(() => router.navigate('settings'));
            await page.evaluate(async g => { document.getElementById('import-contract-json').value = JSON.stringify(g); await pages.settings.importContractGuide('paste'); }, guide);
            const shown = await page.$$eval('#import-contract-warnings li', lis => lis.map(li => li.textContent));
            assert(shown.length === 3, `expected 3 warnings on screen, got ${shown.length}: ${shown.join(' | ')}`);
            assert(shown.some(w => /plain text/.test(w)) && shown.some(w => /"options"/.test(w)) && shown.some(w => /constraints/.test(w)), `warnings: ${shown.join(' | ')}`);

            // Full Edit opens the imported guide without a crash, and shows names, not [object Object]
            const actId = await page.evaluate(() => db.activities.where('name').startsWith('E9-2627-C9').first().then(a => a.id));
            await page.evaluate(id => modals.openFullEdit(id), actId);
            await page.waitForFunction(() => (document.getElementById('fe-name')?.value || '').startsWith('E9-2627-C9'), null, { timeout: 5000 });
            await page.waitForTimeout(300);
            const view = await page.evaluate(() => ({
                constraints: [...document.querySelectorAll('#fe-contract-constraints-list input')].map(i => i.value),
                certs: [...document.querySelectorAll('#fe-certs-required-list input')].map(i => i.value)
            }));
            assert(view.constraints.length === 1 && view.constraints[0] === 'Must be fake', `constraints shown: ${JSON.stringify(view.constraints)}`);
            assert(view.certs.length === 1 && view.certs[0] === 'Fake Band Saw', `certifications shown: ${JSON.stringify(view.certs)}`);
            // Saving keeps the certification's tool link
            await page.evaluate(() => pages.activityEdit.save());
            await page.waitForTimeout(800);
            const cert = await page.evaluate(id => db.activities.get(id).then(a => a.certificationsRequired[0]), actId);
            assert(cert && typeof cert === 'object' && cert.name === 'Fake Band Saw' && cert.toolId, `certification after save: ${JSON.stringify(cert)}`);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'classroom create: the Site Page URL is attached once, even if it\'s also in the materials list (1-12)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            stub.reply('create_classroom_coursework', { status: 'success', courseworkId: 'FAKE-CW-NEW', title: 'Fake' });
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token' };
            const { page, errors, context } = await openApp(browser, base, { stub, localStorageInit: ls });
            await seedFakeData(page);
            const url = 'https://sites.google.com/fake-school.test/fake-guide';
            // Edit mode: the saved assignment has the Site Page URL, and it's also in the materials list
            await page.evaluate(async url => {
                state._classroomPendingCreate = { 'FAKE-COURSE-1': { maxPoints: 100 } };
                pages.activityEdit._data = { activity: { name: 'Fake Assignment', sitePageUrl: url } };
                pages.activityEdit._materials = [{ type: 'link', url, title: 'Guide again' }, { type: 'link', url: 'https://example.test/other', title: 'Other' }];
                await pages.activityEdit._processPendingClassroomCreates({ sitePageUrl: url, classroomLinks: {} }, 'Fake Assignment', '', '');
            }, url);
            const call = stub.callsFor('create_classroom_coursework')[0];
            assert(call, 'no create_classroom_coursework call');
            const urls = (call.body.materials || []).map(m => m.url);
            assert(urls.filter(u => u === url).length === 1, `edit mode: Site Page URL attached ${urls.filter(u => u === url).length} times`);
            assert(urls.includes('https://example.test/other'), 'the other material was dropped');
            // Create mode: nothing saved yet, so the URL must come from the form (X15)
            await page.evaluate(async url => {
                state._classroomPendingCreate = { 'FAKE-COURSE-1': { maxPoints: 100 } };
                pages.activityEdit._data = {};
                pages.activityEdit._materials = [];
                await pages.activityEdit._processPendingClassroomCreates({ sitePageUrl: url, classroomLinks: {} }, 'Fake New Assignment', '', '');
            }, url);
            const created = (stub.callsFor('create_classroom_coursework')[1].body.materials || []).map(m => m.url);
            assert(created.filter(u => u === url).length === 1, `create mode: Site Page URL attached ${created.filter(u => u === url).length} times`);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'teams: a member removed on one device stays removed on both after syncing, and both devices keep both history rows (i230)',
        fn: async ({ browser, base }) => {
            // Two devices: A (this page) and B (a second page with its own database, loaded from A's starting file)
            const A = await openApp(browser, base);
            const ids = await seedFakeData(A.page);
            const B = await openApp(browser, base);
            const sids = ids.studentIds;
            const file = page => page.evaluate(async () => JSON.parse(JSON.stringify(await driveSync.buildSyncFile())));
            const load = (page, f) => page.evaluate(async f => {   // B starts as an exact copy of A (as after a re-seed)
                await db.transaction('rw', db.tables, async () => {
                    for (const t of db.tables) { await t.clear(); if (Array.isArray(f[t.name]) && f[t.name].length) await t.bulkAdd(f[t.name]); }
                });
            }, f);
            const pull = (page, f) => page.evaluate(f => driveSync.applyPulledData(f, new Date().toISOString()), f);
            const members = (page, teamId) => page.evaluate(async t => (await db.teamMembers.where('teamId').equals(t).toArray()).map(m => m.studentId).sort((a, b) => a - b), teamId);
            const save = (page, teamId, keep) => page.evaluate(async ({ teamId, keep }) => {
                await modals.showEditTeam(teamId);
                await new Promise(r => setTimeout(r, 400));
                document.querySelectorAll('.team-member-checkbox').forEach(cb => { cb.checked = keep.includes(parseInt(cb.value)); });
                await modals.saveTeam();
            }, { teamId, keep });
            // The team starts with students 0, 1, 2 on both devices
            await A.page.evaluate(async ({ t, s }) => { await db.teamMembers.add({ teamId: t, studentId: s, createdAt: '2026-09-01T12:00:00.000Z' }); }, { t: ids.teamId, s: sids[2] });
            const start = await file(A.page);
            await load(B.page, start);
            assert(JSON.stringify(await members(B.page, ids.teamId)) === JSON.stringify([sids[0], sids[1], sids[2]].sort((a, b) => a - b)), 'B did not start with the same team');
            // A swaps student 2 for student 3
            await save(A.page, ids.teamId, [sids[0], sids[1], sids[3]]);
            const want = [sids[0], sids[1], sids[3]].sort((a, b) => a - b);
            assert(JSON.stringify(await members(A.page, ids.teamId)) === JSON.stringify(want), 'A did not save the team: ' + JSON.stringify(await members(A.page, ids.teamId)));
            // B, meanwhile, changes another team, so its history row can share an id with A's
            const otherTeam = await B.page.evaluate(async ({ classId, s }) => {
                const t = await db.teams.add({ name: 'Fake Team B', classId, period: '1', createdAt: '2026-09-01T12:00:00.000Z' });
                await db.teamMembers.add({ teamId: t, studentId: s, createdAt: '2026-09-01T12:00:00.000Z' });
                return t;
            }, { classId: ids.classId, s: sids[3] });
            await save(B.page, otherTeam, [sids[1]]);
            // A pulls B's copy (which still has student 2 on the team): student 2 must stay off
            await pull(A.page, await file(B.page));
            assert(JSON.stringify(await members(A.page, ids.teamId)) === JSON.stringify(want), 'after A pulled B, A has ' + JSON.stringify(await members(A.page, ids.teamId)));
            // B pulls A's copy: student 2 leaves, student 3 joins, on B too
            await pull(B.page, await file(A.page));
            assert(JSON.stringify(await members(B.page, ids.teamId)) === JSON.stringify(want), 'after B pulled A, B has ' + JSON.stringify(await members(B.page, ids.teamId)));
            // Another round each way changes nothing
            await pull(A.page, await file(B.page));
            await pull(B.page, await file(A.page));
            assert(JSON.stringify(await members(A.page, ids.teamId)) === JSON.stringify(want) && JSON.stringify(await members(B.page, ids.teamId)) === JSON.stringify(want), 'a second round changed the team');
            // Both devices keep every history row (A's 'left' + 'joined', and B's 'left' + 'joined')
            const hist = page => page.evaluate(async () => (await db.teamHistory.toArray()).map(h => `${h.teamId}:${h.studentId}:${h.action}`).sort());
            const hA = await hist(A.page), hB = await hist(B.page);
            assert(JSON.stringify(hA) === JSON.stringify(hB) && hA.length === 4, 'history differs or lost rows: ' + JSON.stringify({ hA, hB }));
            // Putting student 2 back later (on B) also syncs
            await new Promise(r => setTimeout(r, 20));
            await save(B.page, ids.teamId, [sids[0], sids[1], sids[2], sids[3]]);
            await pull(A.page, await file(B.page));
            const back = [sids[0], sids[1], sids[2], sids[3]].sort((a, b) => a - b);
            assert(JSON.stringify(await members(A.page, ids.teamId)) === JSON.stringify(back), 're-adding did not sync: ' + JSON.stringify(await members(A.page, ids.teamId)));
            // A team already doubled by the old behaviour: one Save on one device fixes both
            await save(A.page, ids.teamId, [sids[0], sids[1]]);
            await pull(B.page, await file(A.page));
            await pull(A.page, await file(B.page));
            const two = [sids[0], sids[1]].sort((a, b) => a - b);
            assert(JSON.stringify(await members(A.page, ids.teamId)) === JSON.stringify(two) && JSON.stringify(await members(B.page, ids.teamId)) === JSON.stringify(two), 'one Save did not fix both devices');
            assert(real(A.errors).length === 0 && real(B.errors).length === 0, 'page errors: ' + real(A.errors).concat(real(B.errors)).join(' | '));
            await A.context.close(); await B.context.close();
        }
    },
    {
        name: 'busy buttons: a double tap on Save Student, Save Team or the quick assignment Save writes one record; different records still save together (3-15, DL7)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            // Save Student: a real double tap on the button
            await page.evaluate(async classId => {
                await modals.showAddStudent();
                await new Promise(r => setTimeout(r, 300));
                document.getElementById('student-first-name').value = 'Fake';
                document.getElementById('student-last-name').value = 'Doubletap';
                document.getElementById('student-class-id').value = String(classId);
                document.querySelector('.student-period-checkbox[value="1"]').checked = true;
            }, ids.classId);
            await page.dblclick('#modal-student button.btn--primary');
            await page.waitForTimeout(800);
            // Save Team: a real double tap too
            await page.evaluate(async classId => {
                await modals.showAddTeam();
                await new Promise(r => setTimeout(r, 300));
                document.getElementById('team-name').value = 'Fake Doubletap Team';
                document.getElementById('team-class-id').value = String(classId);
                modals.loadTeamMembersList && await modals.loadTeamMembersList();
                await new Promise(r => setTimeout(r, 300));
                const box = document.querySelector('.team-member-checkbox');
                if (box) box.checked = true;
            }, ids.classId);
            await page.dblclick('#modal-team button.btn--primary');
            await page.waitForTimeout(800);
            const r = await page.evaluate(async classId => {
                const out = {};
                out.students = (await db.students.toArray()).filter(s => s.lastName === 'Doubletap').length;
                out.teams = (await db.teams.toArray()).filter(t => t.name === 'Fake Doubletap Team').length;
                // The quick "+ Assignment" form: two saves at once write one assignment
                await modals.showAddActivity();
                await new Promise(r => setTimeout(r, 400));
                document.getElementById('activity-name').value = 'Fake Doubletap Assignment';
                const cls = document.getElementById('activity-class-id'); if (cls) cls.value = String(classId);
                const sd = document.getElementById('activity-start-date'); if (sd) sd.value = '2026-10-05';
                const ed = document.getElementById('activity-end-date'); if (ed) ed.value = '2026-10-09';
                await Promise.all([modals.saveActivity(), modals.saveActivity()]);
                out.activities = (await db.activities.toArray()).filter(a => a.name === 'Fake Doubletap Assignment').length;
                // The helper: same key refused while running, different keys run together, and it frees up afterwards
                const fake = { calls: [], slow: async function(id) { this.calls.push(id); await new Promise(r => setTimeout(r, 100)); return id; } };
                guards.wrapBusy(fake, 'fake', ['slow']);
                const res = await Promise.all([fake.slow(1), fake.slow(1), fake.slow(2)]);
                await fake.slow(1);
                out.helper = { calls: fake.calls, res };
                // A thrown error frees it too
                const boom = { n: 0, go: async function() { this.n++; throw new Error('fake failure'); } };
                guards.wrapBusy(boom, 'boom', ['go']);
                for (let i = 0; i < 2; i++) { try { await boom.go(); } catch (e) { /* expected */ } }
                out.afterError = boom.n;
                // Every listed action is wrapped (a misspelt or moved name would silently not be)
                out.unwrapped = [];
                for (const [get, label, names] of guards.BUSY) for (const n of names) { const o = get(); if (!o || !o[n] || !o[n].__busyGuarded) out.unwrapped.push(label + '.' + n); }
                out.busyLeft = document.querySelectorAll('[aria-busy="true"]').length;
                return out;
            }, ids.classId);
            // A real tap on an action that manages its own button (Progressbook "Save numbers") still saves
            await page.evaluate(() => pages.students.openProgressbookNumbers());
            await page.waitForTimeout(500);
            await page.fill('#progressbook-list .progressbook-input', '5551');
            await page.click('#progressbook-save-btn');
            await page.waitForTimeout(600);
            const pb = await page.evaluate(async () => ({ saved: (await db.students.toArray()).filter(s => s.progressbookId === '5551').length, enabled: !document.getElementById('progressbook-save-btn').disabled, clean: !guards.isDirty('modal-progressbook') }));
            assert(pb.saved === 1 && pb.enabled && pb.clean, 'Progressbook Save by tap: ' + JSON.stringify(pb));
            assert(r.students === 1, 'double tap on Save Student wrote ' + r.students + ' students');
            assert(r.teams === 1, 'double tap on Save Team wrote ' + r.teams + ' teams');
            assert(r.activities === 1, 'two quick-form saves at once wrote ' + r.activities + ' assignments');
            assert(JSON.stringify(r.helper) === JSON.stringify({ calls: [1, 2, 1], res: [1, undefined, 2] }), 'busy helper: ' + JSON.stringify(r.helper));
            assert(r.afterError === 2, 'an error left the action stuck: ' + r.afterError);
            assert(r.unwrapped.length === 0, 'listed but not wrapped: ' + r.unwrapped.join(', '));
            assert(r.busyLeft === 0, 'aria-busy left on ' + r.busyLeft + ' button(s)');
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'modals: Enter in a field submits nothing and doesn\'t reload; × and Escape ask first only after a change; Cancel and Save never ask (3-15, DL15, DL16)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            // The harness answers every confirm() with OK; here each question is recorded and answered as set
            const dialogs = [];
            await page.exposeFunction('__recordConfirm', m => { dialogs.push(m); });
            await page.evaluate(() => { window.__answer = false; window.confirm = m => { window.__recordConfirm(String(m)); return window.__answer; }; });
            const setAnswer = v => page.evaluate(a => { window.__answer = a; }, v);
            await page.evaluate(() => { window.__stillHere = true; });
            // Enter in Team Name: no submit, no reload, no team
            await page.evaluate(() => modals.showAddTeam());
            await page.waitForTimeout(300);
            await page.click('#team-name');
            await page.keyboard.type('Fake Enter Team');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(500);
            const afterEnter = await page.evaluate(async () => ({ here: window.__stillHere === true, teams: (await db.teams.toArray()).filter(t => t.name === 'Fake Enter Team').length, open: !document.getElementById('modal-team').classList.contains('hidden') }));
            assert(afterEnter.here && afterEnter.teams === 0 && afterEnter.open, 'Enter in Team Name: ' + JSON.stringify(afterEnter));
            // Something was typed: Escape asks; "Cancel" in the question keeps the modal open
            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
            const kept = await page.evaluate(() => !document.getElementById('modal-team').classList.contains('hidden'));
            assert(dialogs.length === 1 && /Close without saving/.test(dialogs[0]) && kept, 'Escape after typing: ' + JSON.stringify({ dialogs, kept }));
            // × asks too: "Cancel" keeps it open (its own onclick mustn't close it first)
            await page.click('#modal-team .modal__close');
            await page.waitForTimeout(200);
            const keptX = await page.evaluate(() => !document.getElementById('modal-team').classList.contains('hidden'));
            assert(dialogs.length === 2 && keptX, '× after typing, answered Cancel: ' + JSON.stringify({ dialogs, keptX }));
            // "OK" closes it
            await setAnswer(true);
            await page.click('#modal-team .modal__close');
            await page.waitForTimeout(200);
            const closed = await page.evaluate(() => document.getElementById('modal-team').classList.contains('hidden'));
            assert(dialogs.length === 3 && closed, '× after typing: ' + JSON.stringify({ dialogs, closed }));
            dialogs.length = 2;
            // Opened again: it starts clean; changes made by code (a dispatched change event) don't count
            await page.evaluate(() => modals.showAddTeam());
            await page.waitForTimeout(300);
            await page.evaluate(() => { const n = document.getElementById('team-name'); n.value = 'By code'; n.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('team-form').reset(); });
            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
            const closed2 = await page.evaluate(() => document.getElementById('modal-team').classList.contains('hidden'));
            assert(dialogs.length === 2 && closed2, 'Escape with no change asked or stayed open: ' + JSON.stringify({ dialogs, closed2 }));
            // Cancel after typing closes without asking
            await page.evaluate(() => modals.showAddTeam());
            await page.waitForTimeout(300);
            await page.click('#team-name');
            await page.keyboard.type('Fake Cancel Team');
            await page.click('#modal-team button.btn--secondary');
            await page.waitForTimeout(200);
            const closed3 = await page.evaluate(() => document.getElementById('modal-team').classList.contains('hidden'));
            assert(dialogs.length === 2 && closed3, 'Cancel asked or stayed open: ' + JSON.stringify({ dialogs, closed3 }));
            // Save after typing closes without asking, and the next open is clean
            await page.evaluate(async sid => {
                await modals.showEditStudent(sid);
                await new Promise(r => setTimeout(r, 300));
            }, ids.studentIds[0]);
            await page.click('#student-email');
            await page.keyboard.press('End');
            await page.keyboard.type('x');
            await page.click('#modal-student button.btn--primary');
            await page.waitForTimeout(600);
            const saved = await page.evaluate(async sid => ({ closed: document.getElementById('modal-student').classList.contains('hidden'), email: (await db.students.get(sid)).email }), ids.studentIds[0]);
            assert(dialogs.length === 2 && saved.closed && /x$/.test(saved.email), 'Save asked, or did not save: ' + JSON.stringify({ dialogs, saved }));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'unsaved changes: Full Edit and the checkpoint page ask before leaving; Save doesn\'t; Delete assignment and Delete team ask first (3-15, DL16, X16)',
        fn: async ({ browser, base }) => {
            const { page, errors, context } = await openApp(browser, base);
            const ids = await seedFakeData(page);
            // The harness answers every confirm() with OK; here each question is recorded and answered as set
            const dialogs = [];
            await page.exposeFunction('__recordConfirm', m => { dialogs.push(m); });
            await page.evaluate(() => { window.__answer = false; window.confirm = m => { window.__recordConfirm(String(m)); return window.__answer; }; });
            const setAnswer = v => page.evaluate(a => { window.__answer = a; }, v);
            const visible = () => page.evaluate(() => document.querySelector('.page:not(.hidden)')?.id);
            // Full Edit, opened and left with no change: no question
            await page.evaluate(id => modals.openFullEdit(id), ids.activityId);
            await page.waitForFunction(() => pages.activityEdit._formFor && pages.activityEdit._formFor.mode === 'edit', null, { timeout: 10000 });
            await page.waitForTimeout(300);
            await page.evaluate(() => router.navigate('activities'));
            assert(dialogs.length === 0 && await visible() === 'page-activities', 'Full Edit with no change asked: ' + JSON.stringify(dialogs));
            // Typed in: leaving asks; "Cancel" stays (two Classroom links must survive staying and saving)
            await page.evaluate(aid => db.activities.update(aid, { classroomLinks: { 'FAKE-COURSE-1': 'FAKE-CW-1', 'FAKE-COURSE-2': 'FAKE-CW-2' } }), ids.activityId);
            await page.evaluate(id => modals.openFullEdit(id), ids.activityId);
            await page.waitForFunction(() => pages.activityEdit._formFor && pages.activityEdit._formFor.mode === 'edit', null, { timeout: 10000 });
            await page.waitForTimeout(300);
            await page.click('#fe-name');
            await page.keyboard.press('End');
            await page.keyboard.type(' edited');
            await page.evaluate(() => router.navigate('activities'));
            assert(dialogs.length === 1 && /Leave Full Edit without saving/.test(dialogs[0]) && await visible() === 'page-activity-edit', 'Full Edit typed, leave: ' + JSON.stringify(dialogs));
            // Its own Cancel button asks too
            await page.click('#page-activity-edit button.btn--secondary:has-text("Cancel")');
            await page.waitForTimeout(200);
            assert(dialogs.length === 2 && await visible() === 'page-activity-edit', 'Full Edit Cancel after typing: ' + JSON.stringify(dialogs));
            // Save: no question, and it leaves
            await page.click('#page-activity-edit button.btn--primary:has-text("Save")');
            await page.waitForTimeout(800);
            const afterSave = await page.evaluate(async aid => { const a = await db.activities.get(aid); return { name: a.name, links: a.classroomLinks }; }, ids.activityId);
            assert(dialogs.length === 2 && await visible() === 'page-activity-detail' && afterSave.name === 'Test Activity 1 edited', 'Full Edit Save: ' + JSON.stringify({ dialogs, afterSave, page: await visible() }));
            assert(JSON.stringify(afterSave.links) === JSON.stringify({ 'FAKE-COURSE-1': 'FAKE-CW-1', 'FAKE-COURSE-2': 'FAKE-CW-2' }), 'Classroom links after Cancel → stay → Save: ' + JSON.stringify(afterSave.links));
            // A list row added by a tap counts as a change
            await page.evaluate(id => modals.openFullEdit(id), ids.activityId);
            await page.waitForFunction(() => pages.activityEdit._formFor && pages.activityEdit._formFor.mode === 'edit', null, { timeout: 10000 });
            await page.waitForTimeout(300);
            // (its section starts folded: unfold it, then tap "+ Add Goal")
            await page.evaluate(() => {
                for (let el = document.querySelector('#page-activity-edit button[onclick*="addLearningGoal"]'); el; el = el.parentElement) {
                    if (el.style && el.style.display === 'none') el.style.display = '';
                    el.classList && el.classList.remove('hidden', 'collapsed');
                }
            });
            await page.locator('#page-activity-edit button[onclick*="addLearningGoal"]').first().click();
            await setAnswer(true);
            await page.evaluate(() => router.navigate('activities'));
            assert(dialogs.length === 3 && await visible() === 'page-activities', 'Full Edit row added, leave (OK): ' + JSON.stringify(dialogs));
            // The checkpoint page: a tap on a student's box, then leaving, asks
            await setAnswer(false);
            await page.evaluate(() => router.navigate('checkpoint'));
            await page.waitForTimeout(300);
            await page.evaluate(async ({ classId, activityId, teamId, cp }) => {
                await db.checkpoints.update(cp, { questions: [{ question: 'Fake question?', expectedResponse: 'Fake answer' }] });
                const P = pages.checkpoint;
                P.reset();
                P.selectedClass = await db.classes.get(classId);
                await P.selectActivity(await db.activities.get(activityId));
                await P.selectTeam(await db.teams.get(teamId));
                await P.selectCheckpoint(await db.checkpoints.get(cp));
            }, { classId: ids.classId, activityId: ids.activityId, teamId: ids.teamId, cp: ids.checkpointIds[0] });
            await page.waitForTimeout(300);
            // A "visual reference only" box doesn't count as a change (leaving and coming back doesn't ask)
            await page.click('#page-checkpoint input[title="Visual reference only"]');
            const vrDirty = await page.evaluate(() => guards.isDirty('page-checkpoint'));
            assert(!vrDirty && dialogs.length === 3, 'the visual-reference box counted as a change');
            await page.click(`#check-${ids.studentIds[0]}`);
            await page.evaluate(() => router.navigate('dashboard'));
            assert(dialogs.length === 4 && /Leave the checkpoint page without saving/.test(dialogs[3]) && await visible() === 'page-checkpoint', 'checkpoint tap, leave: ' + JSON.stringify(dialogs));
            // Saved: leaving doesn't ask
            await page.evaluate(() => pages.checkpoint.saveProgress());
            await page.waitForTimeout(300);
            await page.evaluate(() => router.navigate('dashboard'));
            assert(dialogs.length === 4 && await visible() === 'page-dashboard', 'checkpoint saved, leave: ' + JSON.stringify(dialogs));
            // Delete assignment and Delete team ask first: "Cancel" keeps them, "OK" deletes
            const del = await page.evaluate(async ({ aid, tid }) => {
                await pages.activities.deleteActivity(aid);
                await pages.teams.deleteTeam(tid);
                return { a: !!(await db.activities.get(aid)).deletedAt, t: !!(await db.teams.get(tid)).deletedAt };
            }, { aid: ids.activityId, tid: ids.teamId });
            assert(!del.a && !del.t && dialogs.length === 6 && /Delete the assignment "Test Activity 1 edited"/.test(dialogs[4]) && /Delete the team "Test Team A"/.test(dialogs[5]), 'Delete, answered Cancel: ' + JSON.stringify({ del, dialogs }));
            await setAnswer(true);
            const del2 = await page.evaluate(async ({ aid, tid }) => {
                await pages.activities.deleteActivity(aid);
                await pages.teams.deleteTeam(tid);
                return { a: !!(await db.activities.get(aid)).deletedAt, t: !!(await db.teams.get(tid)).deletedAt };
            }, { aid: ids.activityId, tid: ids.teamId });
            assert(del2.a && del2.t, 'Delete, answered OK: ' + JSON.stringify(del2));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'classroom create: at most 20 attachments (Classroom refuses more); Site page and materials first; the toast says how many were left out (#44)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            stub.reply('create_classroom_coursework', { status: 'success', courseworkId: 'FAKE-CW-20', title: 'Fake', maxPoints: 100 });
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'automations-enabled': 'true' };
            const { page, errors, context } = await openApp(browser, base, { stub, localStorageInit: ls });
            const ids = await seedFakeData(page);
            await page.evaluate(() => {
                window.__toasts = [];
                const orig = ui.showToast.bind(ui);
                ui.showToast = (m, ...r) => { window.__toasts.push(String(m)); return orig(m, ...r); };
            });
            const site = 'https://sites.example.test/fake-guide';
            const links = Array.from({ length: 25 }, (_, i) => ({ url: 'https://example.test/link-' + i, title: 'Fake link ' + i }));
            // Full Edit's create on save: Site page + 2 materials + 25 resource links = 28
            await page.evaluate(async ({ site, links }) => {
                state._classroomPendingCreate = { 'FAKE-COURSE-1': { maxPoints: 100 } };
                pages.activityEdit._data = { activity: { name: 'Fake Many Links', sitePageUrl: site } };
                pages.activityEdit._materials = [{ type: 'link', url: 'https://example.test/m1', title: 'M1' }, { type: 'youtubeVideo', youtubeId: 'abcdefghijk', title: 'Fake video' }];
                pages.activityEdit._resourceLinks = links;
                await pages.activityEdit._processPendingClassroomCreates({ sitePageUrl: site, classroomLinks: {} }, 'Fake Many Links', '', '');
            }, { site, links });
            const fe = stub.callsFor('create_classroom_coursework')[0];
            assert(fe, 'no create call from Full Edit');
            const feMats = fe.body.materials || [];
            assert(feMats.length === 20, `Full Edit sent ${feMats.length} attachments`);
            assert(feMats[0].url === site && feMats[1].url === 'https://example.test/m1' && feMats[2].youtubeId === 'abcdefghijk' && feMats[19].url === 'https://example.test/link-16', 'Full Edit order: ' + JSON.stringify(feMats.map(m => m.url || m.youtubeId)));
            let toasts = await page.evaluate(() => window.__toasts.splice(0));
            assert(toasts.some(t => t.startsWith('✅ Created') && t.includes('· 8 links not attached (Classroom allows 20; students see them in 🔗 Links)')), 'Full Edit toasts: ' + toasts.join(' | '));
            // The quick + Assignment form's create (edit mode): the stored record's links, capped the same way
            await page.evaluate(async ({ aid, site, links }) => {
                await db.activities.update(aid, { sitePageUrl: site, materials: [{ type: 'link', url: 'https://example.test/m1', title: 'M1' }], resourceLinks: links });
                await modals.showEditActivity(aid);
                await new Promise(r => setTimeout(r, 600));
                state._classroomPendingCreate = { 'FAKE-COURSE-2': { maxPoints: 100 } };
                await modals.saveActivity();
                await new Promise(r => setTimeout(r, 600));
            }, { aid: ids.activityId, site, links });
            const qf = stub.callsFor('create_classroom_coursework')[1];
            assert(qf, 'no create call from the quick form');
            assert((qf.body.materials || []).length === 20 && qf.body.materials[0].url === site, `quick form sent ${(qf.body.materials || []).length} attachments`);
            toasts = await page.evaluate(() => window.__toasts.splice(0));
            assert(toasts.some(t => t.startsWith('✅ Created') && t.includes('· 7 links not attached')), 'quick-form toasts: ' + toasts.join(' | '));
            // 20 or fewer: nothing is left out and the toast is as before
            await page.evaluate(async () => {
                state._classroomPendingCreate = { 'FAKE-COURSE-3': { maxPoints: 100 } };
                pages.activityEdit._data = { activity: { name: 'Fake Few Links' } };
                pages.activityEdit._materials = [];
                pages.activityEdit._resourceLinks = [{ url: 'https://example.test/only', title: 'Only' }];
                await pages.activityEdit._processPendingClassroomCreates({ classroomLinks: {} }, 'Fake Few Links', '', '');
            });
            const few = stub.callsFor('create_classroom_coursework')[2];
            assert(few && few.body.materials.length === 1, 'a short list was changed');
            toasts = await page.evaluate(() => window.__toasts.splice(0));
            assert(toasts.some(t => t === '✅ Created "Fake" in Classroom'), 'short-list toast: ' + toasts.join(' | '));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    },
    {
        name: 'transactions: a save or delete that fails part-way changes nothing (student, team, Full Edit, Wildcat attendance with no email sent, Permanently Delete, task delete, skills import) (3-16, DL8)',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'automations-enabled': 'true' };
            const { page, errors, context } = await openApp(browser, base, { stub, localStorageInit: ls });
            const ids = await seedFakeData(page);
            await page.evaluate(() => {
                window.__snap = async () => { const o = {}; for (const t of db.tables) if (t.name !== 'activityLog') o[t.name] = await t.toArray(); return JSON.stringify(o); };
                // Makes the nth write of one kind on one table fail (a Dexie hook that throws)
                window.__failOn = (table, hook, nth) => {
                    let n = 0;
                    const fn = function () { if (++n >= (nth || 1)) throw new Error('Fake failure (3-16 test)'); };
                    db.table(table).hook(hook, fn);
                    return () => db.table(table).hook(hook).unsubscribe(fn);
                };
            });
            const results = {};
            // 1. A new student whose enrollment fails: no student, no anonId counter step
            results.student = await page.evaluate(async classId => {
                const before = await __snap();
                await modals.showAddStudent();
                await new Promise(r => setTimeout(r, 300));
                document.getElementById('student-first-name').value = 'Fake';
                document.getElementById('student-last-name').value = 'Atomic';
                document.getElementById('student-class-id').value = String(classId);
                document.querySelector('.student-period-checkbox[value="1"]').checked = true;
                const off = __failOn('enrollments', 'creating');
                await modals.saveStudent();
                off();
                ui.hideModal('modal-student');
                return before === await __snap();
            }, ids.classId);
            // 2. A team edit whose history row fails: members unchanged
            results.team = await page.evaluate(async ({ teamId, sids }) => {
                const before = await __snap();
                await modals.showEditTeam(teamId);
                await new Promise(r => setTimeout(r, 400));
                document.querySelectorAll('.team-member-checkbox').forEach(cb => { cb.checked = [sids[2], sids[3]].includes(parseInt(cb.value)); });
                const off = __failOn('teamHistory', 'creating', 2);
                await modals.saveTeam();
                off();
                ui.hideModal('modal-team');
                return before === await __snap();
            }, { teamId: ids.teamId, sids: ids.studentIds });
            // 3. Full Edit: the assignment is updated, then its checkpoint write fails: the assignment keeps its old name
            await page.evaluate(id => modals.openFullEdit(id), ids.activityId);
            await page.waitForFunction(() => document.getElementById('fe-name')?.value === 'Test Activity 1', null, { timeout: 5000 });
            results.fullEdit = await page.evaluate(async () => {
                const before = await __snap();
                document.getElementById('fe-name').value = 'Fake Renamed';
                const off = __failOn('checkpoints', 'updating');
                const off2 = __failOn('checkpoints', 'creating');
                await pages.activityEdit.save();
                off(); off2();
                return { same: before === await __snap(), name: (await db.activities.toArray())[0].name };
            });
            // 4. Wildcat: a drop-in marked absent, and the row write fails: no row, and no no-show email goes out
            await page.evaluate(() => { if (typeof guards !== 'undefined' && guards.markClean) guards.markClean('page-activity-edit'); router.navigate('attendance'); });
            await page.waitForTimeout(300);
            results.attendance = await page.evaluate(async sids => {
                const before = await __snap();
                document.getElementById('attendance-period').value = 'wildcat';
                document.getElementById('attendance-date').value = getTodayString();
                pages.attendance.pendingChanges = { [String(sids[0])]: 'absent', [String(sids[1])]: 'absent' };
                const off = __failOn('attendance', 'creating', 2);
                await pages.attendance.saveAttendance();
                off();
                pages.attendance.pendingChanges = {};
                return before === await __snap();
            }, ids.studentIds);
            await page.waitForTimeout(500);
            const emails = stub.calls.filter(c => ['queue_absence', 'send_immediate', 'cancel_absence'].includes(c.action)).length;
            // 5. Permanently Delete a student whose notes can't be removed: the student isn't tombstoned, nothing else goes
            results.permanent = await page.evaluate(async sid => {
                await db.notes.add({ entityType: 'student', entityId: sid, content: 'Fake note' });
                await db.students.update(sid, { deletedAt: new Date().toISOString(), status: 'deleted' });
                const before = await __snap();
                const off = __failOn('notes', 'deleting');
                await pages.settings.permanentlyDelete('students', sid);
                off();
                return before === await __snap();
            }, ids.studentIds[3]);
            // 6. Deleting an auto-task whose delete fails: its key isn't added to the dismissed list
            results.task = await page.evaluate(async () => {
                const id = await db.tasks.add({ description: 'Fake auto task', type: 'auto', autoKey: 'grading-needed-999', status: 'pending' });
                const before = await __snap();
                const off = __failOn('tasks', 'deleting');
                await pages.tasks.deleteTask(id);
                off();
                return before === await __snap();
            });
            // 7. A skills library import whose second skill fails: no skills and no category change
            results.skills = await page.evaluate(async () => {
                const before = await __snap();
                pages.settings._readJsonFile = async () => [{ name: 'Fake Lib A', category: 'Fake Cat' }, { name: 'Fake Lib B', category: 'Fake Cat' }];
                const off = __failOn('skills', 'creating', 2);
                await pages.settings.importSkillsLibrary({ target: { files: [{}], value: 'x' } });
                off();
                return before === await __snap();
            });
            assert(results.student && results.team && results.fullEdit.same && results.attendance && results.permanent && results.task && results.skills,
                'a failed save left part of its writes: ' + JSON.stringify(results));
            assert(results.fullEdit.name === 'Test Activity 1', 'Full Edit name: ' + results.fullEdit.name);
            assert(emails === 0, `a no-show email went out for a save that failed (${emails})`);
            // And without failures the same saves work
            const ok = await page.evaluate(async classId => {
                await modals.showAddStudent();
                await new Promise(r => setTimeout(r, 300));
                document.getElementById('student-first-name').value = 'Fake';
                document.getElementById('student-last-name').value = 'Atomic';
                document.getElementById('student-class-id').value = String(classId);
                document.querySelector('.student-period-checkbox[value="1"]').checked = true;
                await modals.saveStudent();
                const s = (await db.students.toArray()).find(x => x.lastName === 'Atomic');
                return { s: !!s, enr: s ? (await db.enrollments.where('studentId').equals(s.id).count()) : 0 };
            }, ids.classId);
            assert(ok.s && ok.enr === 1, 'a normal save: ' + JSON.stringify(ok));
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    }
];


run(tests);
