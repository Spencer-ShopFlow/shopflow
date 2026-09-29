// ============================================
// ShopFlow smoke-test harness
// Serves the repo locally, opens it in headless Chromium, and stubs every
// outside call so tests never touch real Google services or real data.
// Only fake students are ever created here.
// ============================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8'
};

// --- Static server for the repo (served under /shopflow/, like GitHub Pages) ---
export function startServer() {
    return new Promise(resolve => {
        const server = http.createServer((req, res) => {
            let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
            if (!urlPath.startsWith('/shopflow/')) { res.writeHead(404); return res.end(); }
            urlPath = urlPath.slice('/shopflow'.length);
            if (urlPath.endsWith('/')) urlPath += 'index.html';
            const file = path.join(ROOT, urlPath);
            if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404); return res.end();
            }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
            fs.createReadStream(file).pipe(res);
        });
        server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}/shopflow/` }));
    });
}

// --- Stub for the Google Apps Script webhook ---
// Holds Drive sync files in memory and records every call (action + headers).
export class WebhookStub {
    constructor() { this.calls = []; this.driveFiles = {}; this.replies = {}; this.delays = {}; this.raws = {}; this.sequences = {}; }
    reply(action, body) { this.replies[action] = body; }
    // Makes one action answer with a non-JSON page (the school network's echo 404s, i137)
    raw(action, text) { this.raws[action] = text; }
    // Answers the next calls of one action in order, then as usual. { raw: '<html>…' } answers
    // with a non-JSON page, as when the school network loses the script's reply (2-04, i137).
    sequence(action, items) { this.sequences[action] = items.slice(); }
    // Makes one action answer slowly (e.g. a slow upload), in milliseconds
    delay(action, ms) { this.delays[action] = ms; }
    async handle(route) {
        const req = route.request();
        let body = {};
        try { body = JSON.parse(req.postData() || '{}'); } catch (e) { body = { _unparsed: true }; }
        const headers = await req.allHeaders();
        this.calls.push({ action: body.action, body, method: req.method(), contentType: headers['content-type'] || '' });
        if (this.delays[body.action]) await new Promise(r => setTimeout(r, this.delays[body.action]));
        if (this.raws[body.action] !== undefined) {
            await route.fulfill({ status: 200, contentType: 'text/html', headers: { 'Access-Control-Allow-Origin': '*' }, body: this.raws[body.action] });
            return;
        }
        let out;
        const seq = this.sequences[body.action];
        const next = seq && seq.length ? seq.shift() : undefined;
        if (next && next.raw !== undefined) {
            await route.fulfill({ status: 200, contentType: 'text/html', headers: { 'Access-Control-Allow-Origin': '*' }, body: next.raw });
            return;
        }
        if (next) out = next;
        else if (this.replies[body.action]) out = this.replies[body.action];
        else if (body.action === 'save_to_drive') {
            this.driveFiles[body.deviceId] = { encryptedData: body.encryptedData, deviceId: body.deviceId, timestamp: body.timestamp, schemaVersion: body.schemaVersion };
            out = { status: 'success', updated: true };
        } else if (body.action === 'load_from_drive') {
            const other = body.requestingDevice === 'iPad' ? 'PC' : 'iPad';
            out = this.driveFiles[other] ? { status: 'success', ...this.driveFiles[other] } : { status: 'no_data' };
        } else out = { status: 'success', sent: 0, pushed: 0, errors: [] };
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(out) });
    }
    callsFor(action) { return this.calls.filter(c => c.action === action); }
}

// --- Browser + page helpers ---
export async function launch() {
    const executablePath = process.env.CHROMIUM_PATH || undefined;
    return chromium.launch({ executablePath });
}

// Dexie comes from unpkg in production. Locally (no internet) set DEXIE_LOCAL to a
// Dexie 4.x dist/dexie.js; in CI the real unpkg file is used.
async function routeExternals(context, stub) {
    const dexieLocal = process.env.DEXIE_LOCAL;
    await context.route('https://unpkg.com/dexie@*/**', route => dexieLocal
        ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(dexieLocal, 'utf8') })
        : route.continue());
    await context.route('https://unpkg.com/@phosphor-icons/**', route =>
        route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* icons stubbed in tests */' }));
    await context.route('https://fonts.googleapis.com/**', route => route.abort());
    await context.route('https://fonts.gstatic.com/**', route => route.abort());
    await context.route('https://script.google.com/**', route => stub.handle(route));
    await context.route('https://script.googleusercontent.com/**', route => stub.handle(route));
}

// Opens the app with a fresh, empty database. Returns { page, errors, logs, stub }.
export async function openApp(browser, base, { stub = new WebhookStub(), localStorageInit = {}, clockTime = null } = {}) {
    const context = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'America/New_York' });
    await routeExternals(context, stub);
    await context.addInitScript(init => {
        for (const [k, v] of Object.entries(init)) localStorage.setItem(k, v);
        // Tests never open real prompts; confirm() answers yes, prompt() answers "test-pass".
        window.confirm = () => true;
        window.prompt = () => 'test-pass-1234';
        window.alert = () => {};
    }, localStorageInit);
    const page = await context.newPage();
    // Optional fixed wall-clock time (e.g. an evening in New York) for date tests
    if (clockTime) await page.clock.install({ time: new Date(clockTime) });
    const errors = [];
    const logs = [];
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    page.on('console', m => { logs.push(`${m.type()}: ${m.text()}`); });
    await page.goto(base, { waitUntil: 'load' });
    await waitForStartup(page);
    return { context, page, errors, logs, stub };
}

// Startup finishes by showing the PIN screen; wait for it, then unlock (tests only).
export async function waitForStartup(page) {
    await page.waitForFunction(() => typeof db !== 'undefined' && db.isOpen && db.isOpen());
    await page.waitForFunction(() => { const s = document.getElementById('pin-lock-screen'); return s && s.style.display && s.style.display !== 'none'; }, null, { timeout: 15000 });
    await page.evaluate(() => pinLock.unlock());
    await page.waitForTimeout(300);
}

// Seeds a small fake dataset. Every name is invented.
export async function seedFakeData(page) {
    return page.evaluate(async () => {
        const now = new Date().toISOString();
        const year = await getActiveSchoolYear();
        const classId = await db.classes.add({ name: 'Test Engineering 1', color: '#3366cc', periods: [1], createdAt: now });
        await db.settings.put({ key: 'period-year-map', value: { 1: classId } });
        const names = [['Ada', 'Tester'], ['Liam', "O'Brien"], ['Maya', 'Sample'], ['Noah', 'Fixture']];
        const ids = [];
        for (let i = 0; i < names.length; i++) {
            const [firstName, lastName] = names[i];
            const id = await db.students.add({
                firstName, lastName, name: `${firstName} ${lastName}`, email: `${firstName.toLowerCase()}@example.test`,
                classId, status: 'active', anonId: `STU-TEST-${i + 1}`, createdAt: now, updatedAt: now,
                wildcatTeacher: 'Teacher', wildcatTeacherEmail: 'teacher@example.test'
            });
            ids.push(id);
            await db.enrollments.add({ studentId: id, period: '1', schoolYear: year, createdAt: now });
        }
        const teamId = await db.teams.add({ name: 'Test Team A', classId, period: '1', createdAt: now });
        for (const sid of ids.slice(0, 2)) await db.teamMembers.add({ teamId, studentId: sid });
        const today = getTodayString();
        const activityId = await db.activities.add({
            name: 'Test Activity 1', classId, startDate: today, endDate: today, status: 'active',
            scoringType: 'complete-incomplete', createdAt: now, updatedAt: now
        });
        const cp1 = await db.checkpoints.add({ activityId, number: 1, title: 'Test CP 1', createdAt: now });
        return { classId, studentIds: ids, teamId, activityId, checkpointIds: [cp1] };
    });
}

// --- Minimal test runner ---
export async function run(tests) {
    const { server, base } = await startServer();
    const browser = await launch();
    const only = process.argv.slice(2);
    let failed = 0, passed = 0, skipped = 0;
    for (const t of tests) {
        if (only.length && !only.some(o => t.name.includes(o))) continue;
        if (t.skip) { skipped++; console.log(`SKIP  ${t.name} — ${t.skip}`); continue; }
        const started = Date.now();
        try {
            await t.fn({ browser, base });
            passed++; console.log(`PASS  ${t.name} (${Date.now() - started} ms)`);
        } catch (e) {
            failed++; console.log(`FAIL  ${t.name}\n      ${String(e && e.stack || e).split('\n').slice(0, 4).join('\n      ')}`);
        }
    }
    await browser.close(); server.close();
    console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
    process.exit(failed ? 1 : 0);
}

export function assert(cond, msg) { if (!cond) throw new Error(msg); }
