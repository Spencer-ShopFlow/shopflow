// ============================================
// ShopFlow smoke tests (fake data only)
// Run:  node tests/smoke.mjs            (all tests)
//       node tests/smoke.mjs attendance (only tests whose name contains "attendance")
// ============================================

import { run, openApp, seedFakeData, assert, WebhookStub } from './harness.mjs';

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
    }
];

run(tests);
