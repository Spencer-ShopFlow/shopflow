// ============================================
// ShopFlow smoke tests (fake data only)
// Run:  node tests/smoke.mjs            (all tests)
//       node tests/smoke.mjs attendance (only tests whose name contains "attendance")
// ============================================

import { run, openApp, seedFakeData, assert, WebhookStub, waitForStartup } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
    }
];

run(tests);
