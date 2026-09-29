// ============================================
// Builds tests/fixtures/fake-roster.json: an invented class list for the
// staging site. Every name and email is made up (example.test addresses).
// Import it on staging with Settings → Data → Import (Replace All).
// Run: node tests/make-fake-roster.mjs
// ============================================

import fs from 'node:fs';
import path from 'node:path';
import { startServer, launch, openApp, ROOT } from './harness.mjs';

const FIRST = ['Ada', 'Liam', 'Maya', 'Noah', 'Iris', 'Owen', 'Zara', 'Eli', 'Nora', 'Theo', 'Lena', 'Jude', 'Rosa', 'Milo', 'Ivy', 'Cole', 'Ruby', 'Finn', 'Tess', 'Omar'];
const LAST = ['Tester', "O'Brien", 'Sample', 'Fixture', 'Mockley', 'Stubbs', 'Dummett', 'Placer', 'Trialson', 'Demo'];

const { server, base } = await startServer();
const browser = await launch();
const { page, context } = await openApp(browser, base);

const data = await page.evaluate(async ({ FIRST, LAST }) => {
    const now = new Date().toISOString();
    const year = await getActiveSchoolYear();
    const today = getTodayString();
    const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return formatDateString(x); };
    const c1 = await db.classes.add({ name: 'Fake Engineering 1', color: '#2563eb', periods: [1, 2], createdAt: now });
    const c2 = await db.classes.add({ name: 'Fake Engineering 2', color: '#16a34a', periods: [3], createdAt: now });
    await db.settings.put({ key: 'period-year-map', value: { 1: c1, 2: c1, 3: c2 } });
    const studentIds = [];
    for (let i = 0; i < 20; i++) {
        const firstName = FIRST[i], lastName = LAST[i % LAST.length];
        const classId = i < 14 ? c1 : c2;
        const period = i < 7 ? '1' : i < 14 ? '2' : '3';
        const id = await db.students.add({
            firstName, lastName, name: `${firstName} ${lastName}`,
            email: `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/[^a-z]/g, '')}@example.test`,
            classId, status: 'active', anonId: `STU-FAKE-${String(i + 1).padStart(2, '0')}`,
            wildcatTeacher: 'Fake Teacher', wildcatTeacherEmail: 'fake.teacher@example.test',
            createdAt: now, updatedAt: now
        });
        studentIds.push(id);
        await db.enrollments.add({ studentId: id, period, schoolYear: year, createdAt: now });
    }
    const teams = [];
    for (let t = 0; t < 5; t++) {
        const classId = t < 4 ? c1 : c2;
        const teamId = await db.teams.add({ name: `Fake Team ${t + 1}`, classId, period: t < 2 ? '1' : t < 4 ? '2' : '3', createdAt: now });
        teams.push(teamId);
        for (const sid of studentIds.slice(t * 4, t * 4 + 4)) await db.teamMembers.add({ teamId, studentId: sid });
    }
    const a1 = await db.activities.add({ name: 'Fake Bridge Build', classId: c1, startDate: addDays(today, -7), endDate: addDays(today, 7), status: 'active', scoringType: 'complete-incomplete', createdAt: now, updatedAt: now });
    const a2 = await db.activities.add({ name: 'Fake Past Project', classId: c1, startDate: addDays(today, -30), endDate: addDays(today, -10), status: 'active', scoringType: 'points', defaultPoints: 100, createdAt: now, updatedAt: now });
    const cps = [];
    for (let n = 1; n <= 4; n++) cps.push(await db.checkpoints.add({ activityId: a1, number: n, title: `Fake Checkpoint ${n}`, suggestedDate: addDays(today, n - 5), createdAt: now }));
    for (const sid of studentIds.slice(0, 8)) await db.checkpointCompletions.add({ checkpointId: cps[0], studentId: sid, completed: true, completedAt: now, createdAt: now });
    for (const sid of studentIds.slice(0, 10)) await db.submissions.add({ activityId: a2, studentId: sid, status: 'graded', score: 70 + (sid % 30), submittedAt: now, gradedAt: now, createdAt: now });
    for (const sid of studentIds.slice(0, 7)) {
        await db.attendance.add({ studentId: String(sid), date: addDays(today, -1), period: '1', status: sid % 5 === 0 ? 'absent' : 'present', createdAt: now, updatedAt: now });
    }
    const out = {};
    for (const table of db.tables) out[table.name] = await table.toArray();
    out.schemaVersion = db.verno;
    out.appVersion = '1.0';
    out.exportDate = now;
    out.note = 'Fake data for the staging site only. Every name is invented.';
    return out;
}, { FIRST, LAST });

// Drop things that shouldn't travel in a fixture (logs, backups metadata, alerts).
for (const t of ['activityLog', 'alerts', 'tasks']) data[t] = [];
data.settings = data.settings.filter(s => ['period-year-map', 'active-school-year', 'anon-id-counter'].includes(s.key));

const outFile = path.join(ROOT, 'tests', 'fixtures', 'fake-roster.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(data, null, 1));
console.log(`Wrote ${path.relative(ROOT, outFile)}: ${data.students.length} fake students, ${data.teams.length} teams, ${data.activities.length} activities`);
await context.close(); await browser.close(); server.close();
