// ============================================
// ShopFlow ESLint check (plan row 0-05; same rules as the 0-14 report)
// Fails if any name is used that is never defined (`no-undef`): in js/**,
// index.html's inline <script>, or any inline event handler (onclick="…") in
// index.html or in JS template strings. `no-unused-vars` is reported, not failed.
// The app's own globals (top-level names in every app file) are declared
// automatically, so a new file or function needs no config change.
// Run: node tests/eslint-check.mjs            (add --verbose to list unused variables)
// Needs eslint, globals and espree (cd tests && npm install).
// ============================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import globals from 'globals';
import * as espree from 'espree';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = f => path.join(ROOT, f);
const verbose = process.argv.includes('--verbose');

const jsFiles = [];
(function walk(dir) {
    for (const e of fs.readdirSync(rel(dir), { withFileTypes: true })) {
        const r = path.join(dir, e.name);
        if (e.isDirectory()) walk(r); else if (e.name.endsWith('.js')) jsFiles.push(r);
    }
})('js');
jsFiles.sort();
const sources = Object.fromEntries(jsFiles.map(f => [f, fs.readFileSync(rel(f), 'utf8')]));
const html = fs.readFileSync(rel('index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => ({
    code: m[1], line: html.slice(0, m.index).split('\n').length
}));
const parseOpts = { ecmaVersion: 'latest', sourceType: 'script' };

// ---- The app's own globals ----
const appGlobals = {};
function collectTopLevel(code) {
    for (const node of espree.parse(code, parseOpts).body) {
        if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) appGlobals[node.id.name] = 'writable';
        if (node.type === 'VariableDeclaration') for (const d of node.declarations) if (d.id.type === 'Identifier') appGlobals[d.id.name] = 'writable';
    }
    for (const m of code.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) appGlobals[m[1]] = 'writable';
}
for (const f of jsFiles) collectTopLevel(sources[f]);
inlineScripts.forEach(s => collectTopLevel(s.code));

const config = {
    languageOptions: {
        ecmaVersion: 'latest', sourceType: 'script',
        // Dexie is loaded from unpkg in index.html
        globals: { ...globals.browser, Dexie: 'readonly', ...appGlobals }
    },
    // vars: "local" because every top-level name is shared across the app's scripts
    rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { vars: 'local' }] }
};
const linter = new Linter({ configType: 'flat' });
// Flat config only matches .js names, so HTML snippets are linted under a .js name
const asJs = f => (f.endsWith('.js') ? f : 'index-html-inline.js');

const errors = [];
const unused = [];
function record(msgs, label, lineOffset = 0, lineFixed = null) {
    for (const m of msgs) {
        const where = `${label}:${lineFixed ?? (m.line || 0) + lineOffset}`;
        if (m.ruleId === 'no-unused-vars') unused.push(`${where} ${m.message}`);
        else errors.push(`${where} ${m.ruleId || 'parse error'}: ${m.message}`);
    }
}
for (const f of jsFiles) record(linter.verify(sources[f], [config], { filename: f }), f);
inlineScripts.forEach(s => record(linter.verify(s.code, [config], { filename: asJs('index.html') }), 'index.html <script>', s.line - 1));

// ---- Inline event handlers ----
let handlers = 0;
const unparsed = [];
const handlerConfig = { ...config, rules: { 'no-undef': 'error' } };
function checkHandlers(text, file, fromTemplate) {
    for (const m of text.matchAll(/\bon[a-z]+\s*=\s*"([^"]*)"/g)) {
        let code = m[1];
        if (fromTemplate) code = code.replace(/\$\{[^}]*\}/g, '0').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        code = code.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
        const line = text.slice(0, m.index).split('\n').length;
        handlers++;
        // Handlers run with `event` and `this` in scope
        const msgs = linter.verify(`(function(event){ ${code}\n});`, [handlerConfig], { filename: asJs(file) });
        if (msgs.some(x => x.fatal)) { unparsed.push(`${file}:${line}`); continue; }
        record(msgs, `${file} (inline handler)`, 0, line);
    }
}
checkHandlers(html.replace(/<!--[\s\S]*?-->/g, c => c.replace(/[^\n]/g, ' ')), 'index.html', false);
// Comments are blanked first (keeping line numbers), so an example in a comment isn't checked
const withoutComments = code => {
    let out = code;
    for (const c of espree.parse(code, { ...parseOpts, comment: true, range: true }).comments.reverse())
        out = out.slice(0, c.range[0]) + out.slice(c.range[0], c.range[1]).replace(/[^\n]/g, ' ') + out.slice(c.range[1]);
    return out;
};
for (const f of jsFiles) checkHandlers(withoutComments(sources[f]), f, true);

// ---- Result ----
if (verbose) for (const u of unused) console.log(`note  ${u}`);
if (unparsed.length) console.log(`note  ${unparsed.length} inline handler(s) split across a template, not checked: ${unparsed.join(', ')}`);
for (const e of errors) console.log(`FAIL  ${e}`);
// On GitHub, each failure also shows as an annotation on the pull request
if (process.env.GITHUB_ACTIONS) for (const e of errors.slice(0, 10)) {
    const m = e.match(/^(.+?)(?: <script>| \(inline handler\))?:(\d+) (.*)$/);
    if (m) console.log(`::error file=${m[1]},line=${m[2]}::${m[3].replace(/[\r\n]/g, ' ')}`);
}
const summary = `ESLint ${Linter.version}: ${jsFiles.length} files, ${handlers} inline handlers, ${Object.keys(appGlobals).length} app globals; ${errors.length} undefined, ${unused.length} unused variables (not failed)`;
if (errors.length) { console.log(`\n${summary}`); process.exit(1); }
console.log(`PASS  eslint check: no undefined names (${summary})`);
