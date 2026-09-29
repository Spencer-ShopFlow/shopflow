// Fake datasets for the skills migration tests (P16 design v2). Every name is invented, apart from
// the skill names, which are the curriculum's (from the crosswalk). No real student data.
//
// full(): the same shape as Part B (29 Sep 2026): 66 skills, 316 ratings, 190 levels, 172 links,
//   60 activities, 199 checkpoints, 15 settings, 104 students. Expected after: skills 75 (26 deleted),
//   ratings 322, levels 229 (55 deleted), 46 visible, 85 ratings moved, 6 placeholders (all on skill 6),
//   16 links folded, 16 skillsAssessed entries folded, 18 skillsAssessable repeats dropped.
// workedExample(): the library plus C2's worked example (four students on skills 13, 14, 15).
import fs from 'node:fs';

export function loadCrosswalk() {
    const src = fs.readFileSync(new URL('../../js/features/skillsMigrationCrosswalk.js', import.meta.url), 'utf8');
    const json = src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1);
    return JSON.parse(json);
}

// Part B's ids for the 39 crosswalk skills (P16 B1), so the fixture reads like the design
const IDS = {
    'Teamwork & Collaboration': 1, 'Punctuality & Time Management': 2, 'Personal Responsibility & Accountability': 3,
    'Written Communication': 4, 'Following Classroom Norms & Expectations': 5, 'Design Challenge Problem-Solving': 6,
    'Sketch Creation in Fusion 360': 7, 'Sketch Constraining': 8, '3D Modeling from Sketches': 9, '3D Modeling from Primitives': 10,
    'Multiview Drawing Creation': 11, 'Sketch Dimensioning': 12, 'Spatial Visualization': 13, 'Isometric Sketching': 14,
    'Orthographic Projection Sketching': 15, '3D Solid Modeling (Intermediate)': 16, 'Technical Drawing Production': 17,
    'Precision Measurement with Dial Calipers': 18, 'Precision vs. Accuracy': 19, 'Statistical Analysis for Design': 20,
    'Normal Distribution': 21, 'Additive Manufacturing / 3D Printing': 22, 'Engineering Design Process': 23,
    'Concept Sketching & Brainstorming': 24, 'Design Iteration': 25, 'Presentation Skills': 26,
    'Reverse Engineering (Introduction)': 27, 'Mechanical Fasteners & Joining Methods': 28, 'Tolerance, Fit, and Allowance': 29,
    'CAD Assembly Modeling (Bottom-Up)': 30, 'CAD Assembly Modeling (Top-Down)': 31, 'Assembly Drawing Documentation': 32,
    'Reverse Engineering (Applied)': 33, 'Design for Manufacturability': 34, 'Material Properties & Identification': 35,
    'Material Selection': 36, 'Assigning Materials in CAD': 37, 'Troubleshooting & Repair': 38, 'Working Drawings': 39
};
const CATEGORIES = ['Safety', 'Fabrication', 'Design', 'Measurement', 'Digital/CAD', 'Professional', 'Communication', 'Knowledge', 'Analytical'];
const T0 = Date.parse('2026-09-01T12:00:00.000Z');

function library(cw) {
    const skills = [];
    for (const r of cw.rows) skills.push({ id: IDS[r.from], name: r.from, category: r.fromCategory, description: 'Fake description', createdAt: '2026-08-01T12:00:00.000Z' });
    cw.alreadyPresent.forEach((p, i) => skills.push({ id: 270 + i, name: p.name, category: p.category, description: 'Fake description', createdAt: '2026-09-24T12:00:00.000Z' }));
    return skills;
}

function students(n) {
    const out = [];
    for (let i = 1; i <= n; i++) out.push({ id: i, firstName: `Fake${i}`, lastName: `Student${i}`, name: `Fake${i} Student${i}`, email: `fake${i}@example.test`, classId: 1, status: 'active', anonId: `STU-FAKE-${i}`, createdAt: '2026-08-20T12:00:00.000Z' });
    return out;
}

export function full(cw = loadCrosswalk()) {
    const skills = library(cw);
    const ratings = [];
    const levels = [];
    let tick = 0;
    const ts = () => new Date(T0 + (tick++) * 60000).toISOString();   // every rating gets its own time
    const rate = (studentId, skillId, rating, activityId) => ratings.push({ id: ratings.length + 1, studentId, skillId, activityId, checkpointId: null, rating, originalRating: rating, evidenceType: 'checkpoint_conversation', createdAt: ts(), updatedAt: null });
    const level = (studentId, skillId, lvl) => { const t = ts(); levels.push({ id: levels.length + 1, studentId, skillId, level: lvl, demonstratedAt: t, createdAt: t, updatedAt: t }); };
    const act = n => ((n - 1) % 12) + 1;

    // Skill 6 (Design Challenge Problem-Solving): 36 students, 53 ratings, levels P28 D6 B2
    for (let s = 1; s <= 6; s++) { rate(s, 6, 'Proficient', act(s)); level(s, 6, s <= 4 ? 'Developing' : 'Beginning'); }   // 6 D4 "below-ratings"
    rate(7, 6, 'Proficient', 7); rate(7, 6, 'Developing', 7); level(7, 6, 'Developing');                                  // confirmed downgrade
    rate(8, 6, 'Developing', 8); level(8, 6, 'Developing');
    for (let s = 9; s <= 36; s++) { if (s <= 24) rate(s, 6, 'Developing', act(s)); rate(s, 6, 'Proficient', act(s)); level(s, 6, 'Proficient'); }
    // Skill 23 (Engineering Design Process): 16 students (9–24), 29 ratings, levels P16
    for (let s = 9; s <= 24; s++) { if (s <= 21) rate(s, 23, 'Developing', 1 + (s % 4)); rate(s, 23, 'Proficient', 1 + (s % 4)); level(s, 23, 'Proficient'); }
    // Skill 36 (Material Selection): 3 students
    for (let s = 40; s <= 42; s++) { rate(s, 36, 'Proficient', 19); level(s, 36, 'Proficient'); }
    // Skill 24 (Concept Sketching, a rename): 16 students, 25 ratings, levels D10 A4 P2, 6 confirmed downgrades
    for (let s = 50; s <= 55; s++) { rate(s, 24, 'Proficient', 37); rate(s, 24, 'Developing', 37); level(s, 24, 'Developing'); }
    for (let s = 56; s <= 59; s++) { rate(s, 24, 'Developing', 38); level(s, 24, 'Developing'); }
    for (let s = 60; s <= 63; s++) { if (s <= 62) rate(s, 24, 'Proficient', 39); rate(s, 24, 'Advanced', 39); level(s, 24, 'Advanced'); }
    for (let s = 64; s <= 65; s++) { rate(s, 24, 'Proficient', 40); level(s, 24, 'Proficient'); }
    // Skill 25 (Design Iteration, a rename): 4 students
    for (let s = 70; s <= 73; s++) { rate(s, 25, 'Proficient', 41); level(s, 25, 'Proficient'); }
    // Keep skills: Teamwork (1) 40 levels, Punctuality (2) 40, Personal Responsibility (3) 35; 202 ratings
    const keep = (skillId, nStudents, downgrades, extras) => {
        for (let s = 1; s <= nStudents; s++) {
            if (s <= downgrades) rate(s, skillId, 'Advanced', act(s));
            if (extras.includes(s)) rate(s, skillId, 'Developing', act(s));
            rate(s, skillId, 'Proficient', act(s));
            level(s, skillId, 'Proficient');
        }
    };
    const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    keep(1, 40, 3, range(4, 40));
    keep(2, 40, 2, range(3, 31));
    keep(3, 35, 2, range(3, 16));

    // Activities 1–60 (six soft-deleted) and their links (172)
    const deleted = new Set([5, 6, 11, 12, 50, 55]);
    const linkPlan = {};
    const add = (a, ...ids) => { linkPlan[a] = (linkPlan[a] || []).concat(ids); };
    for (let a = 1; a <= 6; a++) add(a, 6, 23);            // 6 folds on Problem Definition & Research
    for (let a = 7; a <= 12; a++) add(a, 6);
    add(13, 14, 15); for (let a = 14; a <= 16; a++) add(a, 14);   // 1 fold
    add(17, 27); add(18, 34);
    add(19, 36, 35); add(20, 36, 35); add(21, 36); add(22, 36);     // 2 folds
    add(23, 7, 8); add(24, 7, 8); add(25, 7, 8); add(26, 7, 8, 9);  // 5 folds
    add(27, 9); add(28, 12); add(29, 10); add(30, 16);
    add(31, 11, 17); add(32, 11, 17);                               // 2 folds
    for (let a = 33; a <= 36; a++) add(a, 18);
    for (let a = 37; a <= 45; a++) add(a, 24);
    for (let a = 37; a <= 42; a++) add(a, 25);
    for (let a = 43; a <= 46; a++) add(a, 22);
    for (let a = 44; a <= 48; a++) add(a, 26);
    for (let a = 1; a <= 15; a++) add(a, 4);
    for (let a = 1; a <= 50; a++) add(a, 1);
    for (let a = 1; a <= 31; a++) add(a, 2);

    const skillName = new Map(skills.map(s => [s.id, s.name]));
    const activities = [], activitySkills = [], checkpoints = [];
    for (let a = 1; a <= 60; a++) {
        const ids = linkPlan[a] || [];
        activities.push({
            id: a, name: `Fake Activity ${a}`, classId: 1, status: 'active', scoringType: 'complete-incomplete',
            startDate: '2026-09-01', endDate: '2026-09-30', createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z',
            ...(deleted.has(a) ? { deletedAt: '2026-09-15T12:00:00.000Z' } : {}),
            skillsAssessed: ids.map(id => ({ skillName: skillName.get(id), skillId: id, checkpoints: [1], levels: { Proficient: `Fake descriptor for skill ${id} on activity ${a}` } }))
        });
        for (const id of ids) activitySkills.push({ id: activitySkills.length + 1, activityId: a, skillId: id, updatedAt: '2026-09-01T12:00:00.000Z' });
        if (ids.length) checkpoints.push({ id: checkpoints.length + 1, activityId: a, number: 1, title: `Fake CP ${a}.1`, skillsAssessable: ids.slice(), createdAt: '2026-09-01T12:00:00.000Z' });
    }
    checkpoints.push({ id: checkpoints.length + 1, activityId: 1, number: 2, title: 'Fake CP 1.2', skillsAssessable: [6, 23], createdAt: '2026-09-01T12:00:00.000Z' });
    checkpoints.push({ id: checkpoints.length + 1, activityId: 23, number: 2, title: 'Fake CP 23.2', skillsAssessable: [7, 8], createdAt: '2026-09-01T12:00:00.000Z' });
    while (checkpoints.length < 199) {
        const a = 51 + (checkpoints.length % 10);
        checkpoints.push({ id: checkpoints.length + 1, activityId: a, number: checkpoints.length, title: `Fake filler CP ${checkpoints.length}`, skillsAssessable: [], createdAt: '2026-09-01T12:00:00.000Z' });
    }

    const now = new Date().toISOString();
    const settings = [
        { key: 'skill-categories', value: CATEGORIES },
        { key: 'last-manual-export', value: now },
        { key: 'period-year-map', value: { 1: 1 } }
    ];
    while (settings.length < 15) settings.push({ key: `fake-setting-${settings.length}`, value: settings.length });

    return {
        skills, skillObservations: ratings, skillLevels: levels, activities, activitySkills, checkpoints, settings,
        students: students(104),
        classes: [{ id: 1, name: 'Fake Engineering', color: '#3366cc', periods: [1], createdAt: '2026-08-20T12:00:00.000Z' }]
    };
}

// full() plus removed ratings (deletedAt), the kind #23's Checkpoint Save writes when a rating is
// deselected. They move with a merge but never count as live ratings (§3.3, META 29 Sep):
//   - skill 6 (merged), student 1: a removed "Developing", the same as the level. Live, it would be the
//     rating behind the level and cancel that student's D4 placeholder; removed, the placeholder stays.
//   - skill 6 (merged), student 100: a removed "Advanced" and nothing else. Live, it would bring the
//     student into the merge with a new level; removed, it doesn't.
//   - skill 20 (retired), student 80: a removed rating. It stays where it is.
//   - skill 999 (no such skill), student 81: removed, so not reported as "missing".
// clash: 'removed-newer' adds a removed rating that shares a live rating's key and is newer (Replace All
// would keep the removed one: a refusal); 'live-newer' has the live one newer (Replace All drops the
// removed one: a warning only).
export function withRemovedRatings({ clash = null } = {}, cw = loadCrosswalk()) {
    const d = full(cw);
    const obs = d.skillObservations;
    const removed = (studentId, skillId, rating, activityId, createdAt, deletedAt) => obs.push({ id: obs.length + 1, studentId, skillId, activityId, checkpointId: null, rating, originalRating: rating, evidenceType: 'checkpoint_conversation', createdAt, updatedAt: deletedAt, deletedAt });
    removed(1, 6, 'Developing', 1, '2026-09-20T12:00:00.000Z', '2026-09-21T12:00:00.000Z');
    removed(100, 6, 'Advanced', 2, '2026-09-20T12:05:00.000Z', '2026-09-21T12:05:00.000Z');
    removed(80, 20, 'Proficient', 19, '2026-09-20T12:10:00.000Z', '2026-09-21T12:10:00.000Z');
    removed(81, 999, 'Proficient', 19, '2026-09-20T12:15:00.000Z', '2026-09-21T12:15:00.000Z');
    if (clash) {
        const at = '2026-09-22T12:00:00.000Z';
        obs.push({ id: obs.length + 1, studentId: 82, skillId: 1, activityId: 3, checkpointId: null, rating: 'Proficient', originalRating: 'Proficient', evidenceType: 'checkpoint_conversation', createdAt: at, updatedAt: clash === 'live-newer' ? '2026-09-24T12:00:00.000Z' : at });
        removed(82, 1, 'Developing', 3, at, '2026-09-23T12:00:00.000Z');
    }
    return d;
}

// P16 C2's worked example on top of the full library: skills 13, 14, 15 → Technical Sketching & Visualization.
// Students 9001–9004 (fake). Plus one pair of ratings saved in one checkpoint save (same time) on 14 and 15,
// which would collide once both point at the target: the second must be nudged by 1 ms.
export function workedExample(cw = loadCrosswalk()) {
    const skills = library(cw);
    const d = s => `2026-09-${s}T15:00:00.000Z`;
    const ratings = [];
    const r = (studentId, skillId, rating, when, activityId = 101) => ratings.push({ id: ratings.length + 1, studentId, skillId, activityId, checkpointId: null, rating, originalRating: rating, evidenceType: 'checkpoint_conversation', createdAt: when, updatedAt: when });
    const levels = [];
    const L = (studentId, skillId, level, when) => levels.push({ id: levels.length + 1, studentId, skillId, level, demonstratedAt: when, createdAt: when, updatedAt: when });
    // STU-9001: 13 none → Proficient by hand (9 Sep); 14: D (2 Sep), P (12 Sep) → P
    L(9001, 13, 'Proficient', d('09')); r(9001, 14, 'Developing', d('02')); r(9001, 14, 'Proficient', d('12')); L(9001, 14, 'Proficient', d('12'));
    // STU-9002: 14: P (12 Sep), D (19 Sep, confirmed) → D · 15: D (10 Sep) → D
    r(9002, 14, 'Proficient', d('12')); r(9002, 14, 'Developing', d('19')); L(9002, 14, 'Developing', d('19')); r(9002, 15, 'Developing', d('10')); L(9002, 15, 'Developing', d('10'));
    // STU-9003: 15: A (15 Sep) → A · 14: P (12 Sep), D (19 Sep, confirmed) → D
    r(9003, 15, 'Advanced', d('15')); L(9003, 15, 'Advanced', d('15')); r(9003, 14, 'Proficient', d('12')); r(9003, 14, 'Developing', d('19')); L(9003, 14, 'Developing', d('19'));
    // STU-9004: 15: D (10 Sep) → raised by hand to P on 25 Sep
    r(9004, 15, 'Developing', d('10')); L(9004, 15, 'Proficient', d('25'));
    // One checkpoint save rating 14 and 15 at the same moment for STU-9005 (collides after the move)
    r(9005, 14, 'Proficient', d('20'), 102); r(9005, 15, 'Proficient', d('20'), 102); L(9005, 14, 'Proficient', d('20')); L(9005, 15, 'Proficient', d('20'));
    const settings = [{ key: 'skill-categories', value: CATEGORIES }, { key: 'last-manual-export', value: new Date().toISOString() }];
    return { skills, skillObservations: ratings, skillLevels: levels, activities: [], activitySkills: [], checkpoints: [], settings, students: [], classes: [] };
}
