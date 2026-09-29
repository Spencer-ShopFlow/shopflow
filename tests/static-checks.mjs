// ============================================
// ShopFlow static checks (no browser, no dependencies)
// 1. Every method called on the app's global objects is defined somewhere.
// 2. Every local script and stylesheet in index.html is cached by the
//    service worker (sw.js LOCAL_FILES), and every cached file exists.
// Run: node tests/static-checks.mjs
// ============================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const jsFiles = [];
(function walk(dir) {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) walk(rel); else if (e.name.endsWith('.js')) jsFiles.push(rel);
    }
})('js');

const sources = Object.fromEntries([...jsFiles, 'index.html'].map(f => [f, read(f)]));
const all = Object.values(sources).join('\n');
const problems = [];

// ---- 1. Calls to undefined methods ----
// Methods are defined as `name: function`, `name: async function`, `name(...) {`,
// `async name(...) {` or `obj.name = function`. Objects are `pages.x = {` or `const x = {`.
const definedMethods = new Set([
    ...[...all.matchAll(/^\s*(?:async\s+)?(\w+)\s*(?::\s*(?:async\s+)?(?:function|\()|\([^)]*\)\s*\{)/gm)].map(m => m[1]),
    ...[...all.matchAll(/\.(\w+)\s*=\s*(?:async\s+)?(?:function|\()/g)].map(m => m[1])
]);
const definedPages = new Set([...all.matchAll(/pages\.(\w+)\s*=\s*\{/g)].map(m => m[1]));
const OBJECTS = 'modals|ui|router|driveSync|driveSyncPull|autoBackup|pinLock|alertsEngine|autoTasks|globalSearch|exportReminder';
for (const [file, src] of Object.entries(sources)) {
    const lineOf = i => src.slice(0, i).split('\n').length;
    for (const m of src.matchAll(new RegExp(`\\b(pages\\.(\\w+)|${OBJECTS})\\.(\\w+)\\s*\\(`, 'g'))) {
        const [, obj, pageName, method] = m;
        // Calls guarded by a typeof check on the same line are allowed.
        if (isGuarded(src, lineOf(m.index), method)) continue;
        if (pageName && !definedPages.has(pageName)) problems.push(`${file}:${lineOf(m.index)} calls ${obj}.${method}() but pages.${pageName} is never defined`);
        else if (!pageName && !definedMethods.has(method)) problems.push(`${file}:${lineOf(m.index)} calls ${obj}.${method}() but ${method} is never defined`);
    }
}
// pages.dashboard.closeSidebar-style calls to functions that exist only as window globals.
for (const [file, src] of Object.entries(sources)) {
    for (const m of src.matchAll(/pages\.(\w+)\.(\w+)\s*\(/g)) {
        const [, pageName, method] = m;
        if (!definedPages.has(pageName)) continue;
        if (isGuarded(src, src.slice(0, m.index).split('\n').length, method)) continue;
        const block = extractObject(all, `pages.${pageName} = {`);
        const onPage = block && new RegExp(`^\\s*(?:async\\s+)?${method}\\s*(?::|\\()`, 'm').test(block);
        const assigned = new RegExp(`pages\\.${pageName}\\.${method}\\s*=`).test(all);
        if (!onPage && !assigned) problems.push(`${file}:${src.slice(0, m.index).split('\n').length} calls pages.${pageName}.${method}() but pages.${pageName} has no ${method}`);
    }
}
// A call is "guarded" when the same line or the two lines above test that the
// method exists first (typeof ... or `&& obj.method` inside an if).
function isGuarded(src, lineNo, method) {
    const lines = src.split('\n').slice(Math.max(0, lineNo - 3), lineNo);
    return lines.some(l => /\bif\s*\(|typeof/.test(l) && new RegExp(`\\.${method}\\b(?!\\s*\\()`).test(l));
}
function extractObject(text, opener) {
    const start = text.indexOf(opener);
    if (start < 0) return null;
    let depth = 0;
    for (let i = text.indexOf('{', start); i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
    }
    return null;
}

// ---- 2. Service worker cache list ----
const sw = read('sw.js');
const listed = new Set([...sw.slice(sw.indexOf('LOCAL_FILES')).split('];')[0].matchAll(/'\.\/([^']+)'/g)].map(m => m[1]));
const html = read('index.html');
const referenced = [
    ...[...html.matchAll(/<script\s+src="(?!https?:)([^"]+)"/g)].map(m => m[1]),
    ...[...html.matchAll(/<link\s+rel="stylesheet"\s+href="(?!https?:)([^"]+)"/g)].map(m => m[1])
];
for (const f of referenced) if (!listed.has(f)) problems.push(`index.html loads ${f}, but sw.js LOCAL_FILES doesn't cache it (offline launch would break)`);
for (const f of listed) if (!fs.existsSync(path.join(ROOT, f))) problems.push(`sw.js LOCAL_FILES lists ${f}, which doesn't exist`);

// 2-04: every webhook call goes through webhookFetch (retry once, lost-reply message, banner).
// Only js/core/webhook.js calls fetch() itself.
for (const [file, src] of Object.entries(sources)) {
    if (file.replace(/\\/g, '/') === 'js/core/webhook.js' || !file.endsWith('.js')) continue;
    for (const m of src.matchAll(/(?<![\w.])fetch\(/g)) {
        problems.push(`${file}:${src.slice(0, m.index).split('\n').length} calls fetch() directly; use webhookFetch() (plan row 2-04)`);
    }
}

const unique = [...new Set(problems)];
if (unique.length) { console.log(unique.map(p => 'FAIL  ' + p).join('\n')); console.log(`\n${unique.length} problem(s)`); process.exit(1); }
console.log('PASS  static checks: no undefined method calls; service-worker cache list complete; webhook calls use webhookFetch');
