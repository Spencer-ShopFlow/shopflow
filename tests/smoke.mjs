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
        name: 'sync (i239): uploads are base64, well under the old size; old copies still read; exports keep the old form; a newer form is named, not blamed on the password',
        fn: async ({ browser, base }) => {
            const stub = new WebhookStub();
            const ls = { webhook_wildcat: 'https://script.google.com/macros/s/TEST/exec', webhook_token: 'test-token', 'drive-sync-enabled': 'true', 'drive-sync-password': 'test-sync-pass', 'automations-enabled': 'true' };
            const pc = await openApp(browser, base, { stub, localStorageInit: ls });
            await seedFakeData(pc.page);
            // Pad the fake data so the size comparison means something (a few hundred KB of text)
            await pc.page.evaluate(async () => {
                const rows = [];
                for (let i = 0; i < 400; i++) rows.push({ content: 'Padding note ' + i + ' '.padEnd(400, 'x'), createdAt: new Date(1.75e12 + i * 60000).toISOString() });
                await db.notes.bulkAdd(rows);
            });
            await pc.page.evaluate(async () => { driveSync._dirty = true; await driveSync.push(); });
            const up = stub.callsFor('save_to_drive');
            assert(up.length === 1, `expected one upload, saw ${up.length}`);
            const pkg = JSON.parse(up[0].body.encryptedData);
            assert(pkg.isEncrypted === true && pkg.encoding === 'base64' && typeof pkg.data === 'string' && typeof pkg.salt === 'string' && typeof pkg.iv === 'string',
                'the upload is not in the base64 form: ' + JSON.stringify(Object.keys(pkg)) + ' data is ' + (Array.isArray(pkg.data) ? 'a list' : typeof pkg.data));
            const rawBytes = await pc.page.evaluate(async () => new Blob([JSON.stringify(await driveSync.buildSyncFile())]).size);
            const ratio = up[0].body.encryptedData.length / rawBytes;
            assert(ratio < 1.5, `the upload is ${ratio.toFixed(2)} times the data (the old form is about 3.6; base64 is about 1.33)`);

            // Upload only sends the same form
            await pc.page.evaluate(() => localStorage.setItem('drive-sync-enabled', 'false'));
            const r = await pc.page.evaluate(() => { window.confirm = () => true; return driveSyncUploadOnly(); });
            const up2 = stub.callsFor('save_to_drive');
            assert(r === 'uploaded' && up2.length === 2 && JSON.parse(up2[1].body.encryptedData).encoding === 'base64', `upload only: ${r}, form ${up2[1] && JSON.parse(up2[1].body.encryptedData).encoding}`);
            await pc.page.evaluate(() => localStorage.setItem('drive-sync-enabled', 'true'));

            // The "iPad" downloads the new form and merges it
            const ipad = await openApp(browser, base, { stub, localStorageInit: ls });
            await ipad.page.evaluate(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }); });
            await ipad.page.evaluate(async () => { await driveSyncPull.checkOnLoad(); if (driveSyncPull.applyPending) await driveSyncPull.applyPending(); });
            await ipad.page.waitForTimeout(500);
            const got = await ipad.page.evaluate(() => db.students.count());
            assert(got === 4, `the iPad has ${got} students after downloading the base64 copy, expected 4`);

            // The old form (every Drive copy and export made before this release) still reads
            const old = await pc.page.evaluate(async () => {
                const text = await secureStorage.encrypt(JSON.stringify(await driveSync.buildSyncFile()), 'test-sync-pass');
                const back = JSON.parse(await secureStorage.decrypt(text, 'test-sync-pass'));
                return { isList: Array.isArray(JSON.parse(text).data), encoding: JSON.parse(text).encoding, students: back.students.length };
            });
            assert(old.isList && old.encoding === undefined && old.students === 4, 'old form: ' + JSON.stringify(old));

            // Export JSON still writes the old form (it calls encrypt without { compact: true })
            const settingsSrc = await pc.page.evaluate(async () => (await fetch('js/pages/settings.js')).text());
            const exportCalls = settingsSrc.match(/secureStorage\.encrypt\([^)]*\)/g) || [];
            assert(exportCalls.length === 1 && !/compact/.test(exportCalls[0]), 'Export JSON encrypt calls: ' + exportCalls.join(' | '));

            // A form from a newer ShopFlow: Look and the download say so, and nothing changes
            stub.driveFiles.PC = { ...stub.driveFiles.PC, encryptedData: JSON.stringify({ isEncrypted: true, encoding: 'some-future-form', data: 'AAAA' }), timestamp: new Date(Date.now() + 60000).toISOString() };
            await ipad.page.evaluate(() => router.navigate('settings'));
            const look = await ipad.page.evaluate(() => driveSyncLook.run());
            assert(/newer ShopFlow/.test(look) && /Nothing was changed/.test(look), 'Look on a newer form: ' + look);
            const toasts = [];
            await ipad.page.exposeFunction('recordToast', t => toasts.push(t));
            await ipad.page.evaluate(() => { const orig = ui.showToast; ui.showToast = function (m, ...rest) { window.recordToast(String(m)); return orig.call(this, m, ...rest); }; });
            const pulled = await ipad.page.evaluate(() => driveSyncPull.checkOnLoad());
            const after = await ipad.page.evaluate(async () => ({ students: await db.students.count(), pending: !!driveSync._pendingMerge }));
            assert(pulled === 'failed' && after.students === 4 && !after.pending, `newer form download: ${pulled}, ${after.students} students, pending ${after.pending}`);
            assert(toasts.some(t => /newer ShopFlow/.test(t)) && !toasts.some(t => /sync password/.test(t)), 'toasts: ' + toasts.join(' | '));

            assert(real(pc.errors).length === 0 && real(ipad.errors).length === 0, 'page errors: ' + real(pc.errors).concat(real(ipad.errors)).join(' | '));
            await pc.context.close(); await ipad.context.close();
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
            await ipad.page.evaluate(cid => db.settings.put({ key: 'mastery-mode-' + cid, value: 'off' }), ids.classId);   // an old row with no timestamps
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
    },
    {
        name: 'auto-backups: snapshots are not indexed by their data; a v2 database upgrades with its snapshots kept, and Restore still works (v115)',
        fn: async ({ browser, base }) => {
            // 9 AM: no auto-backup runs on open, so the test controls every snapshot
            const { page, errors, context } = await openApp(browser, base, { clockTime: '2026-10-08T09:00:00-04:00' });
            const indexNames = () => page.evaluate(() => new Promise((res, rej) => {
                const q = indexedDB.open('EngineeringSecondBrain_Backups');
                q.onsuccess = () => { const d = q.result; const s = d.transaction('backups').objectStore('backups'); const out = { version: d.version, indexes: [...s.indexNames].sort() }; d.close(); res(out); };
                q.onerror = () => rej(q.error);
            }));
            await page.evaluate(() => backupDb.backups.count());
            const fresh = await indexNames();
            assert(!fresh.indexes.includes('data'), 'a fresh backups database still indexes data: ' + JSON.stringify(fresh));
            assert(fresh.indexes.join(',') === 'createdAt,label,slot', 'fresh indexes: ' + JSON.stringify(fresh));

            // Rebuild the backups database as the old version 2 (with the data index), holding 3 snapshots
            const { studentIds } = await seedFakeData(page);
            await page.evaluate(async () => {
                backupDb.close();
                await Dexie.delete('EngineeringSecondBrain_Backups');
                const old = new Dexie('EngineeringSecondBrain_Backups');
                old.version(1).stores({ backups: '++id, createdAt, label' });
                old.version(2).stores({ backups: '++id, createdAt, label, slot, data' });
                await old.open();
                const data = {};
                for (const table of db.tables) data[table.name] = await table.toArray();
                data.exportDate = new Date().toISOString();
                for (let i = 0; i < 3; i++) {
                    await old.backups.add({ createdAt: new Date(Date.now() - (3 - i) * 3600e3).toISOString(), localDate: getTodayString(), label: 'Fake snapshot ' + i, slot: i ? 'noon' : '4pm', data: JSON.stringify(data) });
                }
                old.close();
            });
            const old = await indexNames();
            assert(old.version === 20 && old.indexes.includes('data'), 'the old v2 database was not set up: ' + JSON.stringify(old));
            // A change after the snapshots, which Restore must undo
            await page.evaluate(() => db.students.add({ firstName: 'Fake', lastName: 'Latecomer', name: 'Fake Latecomer', status: 'active', createdAt: new Date().toISOString() }));

            // Reopen the app: Dexie upgrades the backups database to v3
            await page.reload(); await waitForStartup(page);
            const upgraded = await page.evaluate(async () => ({ count: await backupDb.backups.count(), labels: (await backupDb.backups.orderBy('createdAt').toArray()).map(b => b.label) }));
            const after = await indexNames();
            assert(after.version === 30 && !after.indexes.includes('data'), 'not upgraded: ' + JSON.stringify(after));
            assert(upgraded.count === 3 && upgraded.labels.join('|') === 'Fake snapshot 0|Fake snapshot 1|Fake snapshot 2', 'snapshots after the upgrade: ' + JSON.stringify(upgraded));

            // Restore the newest snapshot: the latecomer goes, the seeded students stay
            const newestId = await page.evaluate(async () => (await backupDb.backups.orderBy('createdAt').last()).id);
            await Promise.all([page.waitForNavigation({ timeout: 15000 }), page.evaluate(id => autoBackup.restore(id), newestId)]);
            await waitForStartup(page);
            const students = await page.evaluate(() => db.students.count());
            assert(students === studentIds.length, `after Restore: ${students} students, expected ${studentIds.length}`);
            const safety = await page.evaluate(async () => (await backupDb.backups.orderBy('createdAt').last()).slot);
            assert(safety === 'safety', 'Restore did not keep a safety snapshot first: ' + safety);
            assert(real(errors).length === 0, 'page errors: ' + real(errors).join(' | '));
            await context.close();
        }
    }
];

run(tests);
