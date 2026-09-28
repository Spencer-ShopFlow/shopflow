// ESLint report for plan row 0-12 (report only; changes no app code).
// Rules: no-undef and no-unused-vars, with the app's own globals declared.
// Lints: every js/**/*.js file, index.html's inline <script> blocks, and every
// inline event handler (onclick="…" etc.) in index.html and in JS template strings.
// Writes eslint-report.json.
import fs from 'node:fs';
import path from 'node:path';
import { Linter } from 'eslint';
import globals from 'globals';
import * as espree from 'espree';

const ROOT = process.cwd();
const jsFiles = [];
(function walk(dir) {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) walk(rel); else if (e.name.endsWith('.js')) jsFiles.push(rel);
    }
})('js');
jsFiles.sort();
const html = fs.readFileSync('index.html', 'utf8');
const loadedScripts = new Set([...html.matchAll(/<script\s+src="(?!https?:)\.?\/?([^"]+)"/g)].map(m => m[1]));
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => ({
    code: m[1], line: html.slice(0, m.index).split('\n').length - 1 + 1
}));

const parseOpts = { ecmaVersion: 'latest', sourceType: 'script', tokens: true, loc: true, range: true };

// ---- 1. The app's own globals: top-level declarations in every loaded file, plus window.X = … ----
const declaredIn = {};  // name -> [file]
function addGlobal(name, file) { (declaredIn[name] ||= []).includes(file) || declaredIn[name].push(file); }
const sources = {};
for (const f of jsFiles) {
    sources[f] = fs.readFileSync(f, 'utf8');
    let ast;
    try { ast = espree.parse(sources[f], parseOpts); } catch (e) { console.error('parse error', f, e.message); continue; }
    for (const node of ast.body) {
        if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') addGlobal(node.id.name, f);
        if (node.type === 'VariableDeclaration') for (const d of node.declarations) if (d.id.type === 'Identifier') addGlobal(d.id.name, f);
    }
    for (const m of sources[f].matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) addGlobal(m[1], f);
}
inlineScripts.forEach((s, i) => {
    const ast = espree.parse(s.code, parseOpts);
    for (const node of ast.body) {
        if (node.type === 'FunctionDeclaration') addGlobal(node.id.name, 'index.html <script>');
        if (node.type === 'VariableDeclaration') for (const d of node.declarations) if (d.id.type === 'Identifier') addGlobal(d.id.name, 'index.html <script>');
    }
});
// Loaded from unpkg in index.html
const cdnGlobals = { Dexie: 'readonly' };
const appGlobals = Object.fromEntries(Object.keys(declaredIn).map(n => [n, 'writable']));

const baseConfig = {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...globals.browser, ...cdnGlobals, ...appGlobals } },
    // vars: "local" because every top-level name is shared across the app's scripts;
    // cross-file unused globals are found separately below.
    rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { vars: 'local' }] }
};
const linter = new Linter({ configType: 'flat' });
const results = [];
function lint(code, file, lineOffset = 0, rules) {
    const cfg = rules ? { ...baseConfig, rules } : baseConfig;
    // Flat config only matches .js names, so HTML snippets are linted under a .js name
    const msgs = linter.verify(code, [cfg], { filename: file.endsWith('.js') ? file : 'index-html-inline.js' });
    for (const m of msgs) results.push({ file, line: (m.line || 0) + lineOffset, column: m.column, rule: m.ruleId || 'parse', message: m.message });
    return msgs;
}
for (const f of jsFiles) lint(sources[f], f);
inlineScripts.forEach(s => lint(s.code, 'index.html <script>', s.line - 1));

// ---- 2. Inline event handlers: free names must exist ----
const handlerSkipped = [];
let handlerCount = 0;
function lintHandlers(text, file, fromTemplate) {
    for (const m of text.matchAll(/\bon[a-z]+\s*=\s*"([^"]*)"/g)) {
        let code = m[1];
        if (fromTemplate) code = code.replace(/\$\{[^}]*\}/g, '0').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        code = code.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
        const line = text.slice(0, m.index).split('\n').length;
        handlerCount++;
        // Handlers run with `event` and `this` in scope
        const wrapped = `(function(event){ ${code}\n});`;
        const msgs = linter.verify(wrapped, [{ ...baseConfig, rules: { 'no-undef': 'error' } }], { filename: file.endsWith('.js') ? file : 'index-html-inline.js' });
        for (const x of msgs) {
            if (x.fatal) { handlerSkipped.push(`${file}:${line}`); continue; }
            results.push({ file: `${file} (inline handler)`, line, column: 0, rule: x.ruleId, message: x.message });
        }
    }
}
lintHandlers(html, 'index.html', false);
for (const f of jsFiles) lintHandlers(sources[f], f, true);

// ---- 3. Cross-file: top-level names never referenced anywhere ----
// Count identifier tokens across all JS, plus word matches inside strings/templates
// (inline handlers) and in index.html; a name used only at its declaration is unreferenced.
const refCount = Object.fromEntries(Object.keys(declaredIn).map(n => [n, 0]));
const wordRe = /[A-Za-z_$][\w$]*/g;
for (const f of jsFiles) {
    const ast = espree.parse(sources[f], parseOpts);
    for (const t of ast.tokens) {
        if (t.type === 'Identifier' && t.value in refCount) refCount[t.value]++;
        else if (t.type === 'String' || t.type === 'Template') for (const w of t.value.match(wordRe) || []) if (w in refCount) refCount[w]++;
    }
}
const htmlNoScripts = html.replace(/<script>[\s\S]*?<\/script>/g, ' ');
for (const w of htmlNoScripts.match(wordRe) || []) if (w in refCount) refCount[w]++;
inlineScripts.forEach(s => { for (const t of espree.parse(s.code, parseOpts).tokens) if (t.type === 'Identifier' && t.value in refCount) refCount[t.value]++; });
const unreferencedGlobals = Object.keys(refCount)
    .filter(n => refCount[n] <= declaredIn[n].length && !/^window\./.test(n))
    .map(n => ({ name: n, file: declaredIn[n].join(', ') }));

// ---- 4. Files on disk that index.html never loads ----
const notLoaded = jsFiles.filter(f => !loadedScripts.has(f.split(path.sep).join('/')));

const out = {
    commit: process.env.GITHUB_SHA || null,
    eslintVersion: Linter.version,
    files: jsFiles.length, inlineScripts: inlineScripts.length, inlineHandlers: handlerCount,
    appGlobals: Object.keys(declaredIn).length,
    handlerSkipped, results, unreferencedGlobals, notLoaded
};
fs.writeFileSync('eslint-report.json', JSON.stringify(out, null, 1));
const by = r => results.filter(x => x.rule === r).length;
console.log(`ESLint ${Linter.version}: ${jsFiles.length} files, ${handlerCount} inline handlers, ${Object.keys(declaredIn).length} app globals`);
console.log(`no-undef: ${by('no-undef')}  no-unused-vars: ${by('no-unused-vars')}  parse: ${by('parse')}  unreferenced globals: ${unreferencedGlobals.length}  handlers skipped: ${handlerSkipped.length}`);
