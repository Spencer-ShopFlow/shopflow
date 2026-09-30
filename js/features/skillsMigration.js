// ============================================
// SKILLS MIGRATION (Draft 3) — plan row 1-06 / i159, design P16 v2 (C1, C2, C5, C7)
// Settings → Data → "Skills migration (Draft 3)": Preview, Run (PC only), Verify, Copy report.
//
// Everything is computed first, from one snapshot of the tables (plan), then written in one
// IndexedDB transaction (run). The tool never deletes: it calls no delete, bulkDelete or clear,
// and no importer. Removals are soft (deletedAt + mergedInto, or retiredAt). Reports carry
// counts and skill, activity and checkpoint ids only — never student names or ids.
// ============================================

const skillsMigration = {
    EPOCH_ID: 'skills-draft3-2026-11',
    TOOL: 'skills-migration v1',
    EXPORT_MAX_AGE_MS: 2 * 60 * 60 * 1000,   // Run needs a JSON export from the last 2 hours
    TABLES: ['skills', 'skillObservations', 'skillLevels', 'activitySkills', 'activities', 'checkpoints', 'settings'],
    LEVELS: { Beginning: 1, Developing: 2, Proficient: 3, Advanced: 4 },
    // The tables Replace All's clean-up de-duplicates, with their keys (settings.js executeImport)
    REPLACE_ALL_KEYS: {
        attendance: ['studentId', 'date', 'period'],
        checkpointCompletions: ['checkpointId', 'studentId'],
        submissions: ['activityId', 'studentId'],
        skillLevels: ['studentId', 'skillId'],
        skillObservations: ['studentId', 'skillId', 'activityId', 'createdAt'],
        certifications: ['studentId', 'toolId'],
        wildcatSchedule: ['studentId', 'targetDate'],
        teamMembers: ['teamId', 'studentId'],
        enrollments: ['studentId', 'period', 'schoolYear'],
        settings: ['key'],
        activityStandards: ['activityId', 'standardId'],
        activitySkills: ['activityId', 'skillId']
    },
    _lastReport: '',
    _testFailAfterWrites: null,   // tests only: throw after this many writes, to prove the rollback

    crosswalk: function() { return SKILLS_CROSSWALK_DRAFT3; },

    norm: function(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); },

    ratingKey: function(r) {
        return ['studentId', 'skillId', 'activityId', 'createdAt'].map(f => String(r[f] ?? '')).join('|');
    },

    // The tables the plan reads: the ones it writes (TABLES) plus submissions (refusal 13)
    READ_TABLES: function() { return this.TABLES.concat(['submissions']); },

    // Reads the given tables into snap, with their counts and Replace All duplicate keys.
    // Call it inside a transaction whose scope holds those tables.
    _readInto: async function(snap, tableNames) {
        snap.counts = snap.counts || {};
        snap.dupes = snap.dupes || {};
        for (const name of tableNames) {
            const rows = await db.table(name).toArray();
            if (this.READ_TABLES().includes(name)) snap[name] = rows;
            snap.counts[name] = { total: rows.length, deleted: rows.filter(r => r && r.deletedAt).length };
            const keys = this.REPLACE_ALL_KEYS[name];
            if (keys) {
                const seen = new Set();
                let d = 0;
                for (const r of rows) {
                    const k = keys.map(f => String(r[f] ?? '')).join('|');
                    if (seen.has(k)) d++; else seen.add(k);
                }
                snap.dupes[name] = d;
            }
        }
        return snap;
    },

    // Every table the plan reads, plus the counts of every table (for the expected-after table),
    // read in one read transaction so the numbers belong together even while the dashboard is
    // writing (submissions, alerts, tasks).
    snapshot: async function() {
        const snap = {};
        await db.transaction('r', db.tables, () => this._readInto(snap, db.tables.map(t => t.name)));
        return snap;
    },

    // ── The whole migration, computed in memory. Pure: same snapshot and M → same plan. ──
    plan: function(snap, M) {
        const cw = this.crosswalk();
        const E = this.EPOCH_ID;
        const refusals = [];
        const warnings = [];
        const norm = s => this.norm(s);
        const lv = name => this.LEVELS[name] || 0;
        const at = r => r.updatedAt || r.createdAt || '';

        const skills = snap.skills.slice().sort((a, b) => a.id - b.id);
        const skillById = new Map(skills.map(s => [s.id, s]));
        const byNorm = new Map();
        for (const s of skills) {
            const k = norm(s.name);
            if (!byNorm.has(k)) byNorm.set(k, []);
            byNorm.get(k).push(s);
        }

        // 10: two stored skills that differ only in capitals or spacing
        for (const [, list] of byNorm) {
            if (list.length > 1) refusals.push(`Two skills differ only in capitals or spacing (ids ${list.map(s => s.id).join(', ')}).`);
        }
        // 3: already migrated, or partly
        const epochRow = snap.settings.find(r => r.key === 'sync-epoch');
        if (epochRow && epochRow.value && epochRow.value.id === E) refusals.push('This device has already been migrated (sync-epoch is set).');
        const tagged = skills.filter(s => s.mergedInto || s.retiredAt || s.migration || s.deletedAt);
        if (tagged.length) refusals.push(`${tagged.length} skill(s) already carry deletedAt, mergedInto, retiredAt or a migration tag (ids ${tagged.map(s => s.id).join(', ')}).`);

        // 7: resolve every crosswalk name to exactly one stored skill, spelled exactly
        const resolve = (name, where) => {
            const list = byNorm.get(norm(name)) || [];
            if (list.length !== 1) { refusals.push(`${where} "${name}" matches ${list.length} stored skills (needs exactly 1).`); return null; }
            if (list[0].name !== name) { refusals.push(`${where} "${name}" is stored with a different spelling (skill ${list[0].id}).`); return null; }
            return list[0];
        };
        const rowSkill = new Map();          // crosswalk row → stored skill
        for (const row of cw.rows) {
            const s = resolve(row.from, 'Crosswalk skill');
            if (s) {
                rowSkill.set(row, s);
                if (row.fromCategory && s.category !== row.fromCategory) warnings.push(`Skill ${s.id} is filed under "${s.category}", the crosswalk expects "${row.fromCategory}".`);
            }
        }
        const presentSkills = [];
        for (const p of cw.alreadyPresent) {
            const s = resolve(p.name, 'Draft 3 skill');
            if (s) {
                presentSkills.push(s);
                if (s.category !== p.category) warnings.push(`Skill ${s.id} is filed under "${s.category}", Draft 3 expects "${p.category}".`);
            }
        }
        // 8: a stored skill in neither list
        const known = new Set([...rowSkill.values(), ...presentSkills].map(s => s.id));
        const unknown = skills.filter(s => !known.has(s.id));
        if (unknown.length) refusals.push(`${unknown.length} stored skill(s) are in neither the crosswalk nor the Draft 3 list (ids ${unknown.map(s => s.id).join(', ')}).`);
        // 9: a Draft 3 name already used by another skill
        const renameRows = cw.rows.filter(r => r.class === 'rename');
        for (const t of cw.createTargets) {
            const list = byNorm.get(norm(t.name)) || [];
            if (list.length) refusals.push(`The Draft 3 name "${t.name}" is already used (skill ${list.map(s => s.id).join(', ')}).`);
        }
        for (const r of renameRows) {
            const own = rowSkill.get(r);
            const list = (byNorm.get(norm(r.to)) || []).filter(s => !own || s.id !== own.id);
            if (list.length) refusals.push(`The Draft 3 name "${r.to}" is already used (skill ${list.map(s => s.id).join(', ')}).`);
        }
        // 11: every Draft 3 category is in skill-categories
        const catRow = snap.settings.find(r => r.key === 'skill-categories');
        const cats = (catRow && Array.isArray(catRow.value)) ? catRow.value : [];
        const needCats = new Set([...cw.expectedCategories, ...cw.createTargets.map(t => t.category), ...cw.rows.map(r => r.toCategory).filter(Boolean)]);
        const missingCats = [...needCats].filter(c => !cats.includes(c));
        if (missingCats.length) refusals.push(`These categories are missing from the skill categories setting: ${missingCats.join(', ')}.`);
        // 13: any skillScores
        const scored = snap.submissions.filter(s => s.skillScores && Object.keys(s.skillScores).length > 0);
        if (scored.length) refusals.push(`${scored.length} submission(s) have skill scores.`);
        // 6: two ratings already share Replace All's key. Removed ratings (deletedAt) aren't counted
        // as duplicates of each other or of a live one (§3.3), with one exception: Replace All keeps
        // the newest row of a shared key whether or not it's removed, so a removed rating that
        // would win over the live one would lose that live rating in the re-seed.
        const live = r => !r.deletedAt;
        const liveObs = snap.skillObservations.filter(live);
        const preGroups = new Map();
        for (const r of snap.skillObservations) {
            const k = this.ratingKey(r);
            if (!preGroups.has(k)) preGroups.set(k, []);
            preGroups.get(k).push(r);
        }
        let preDup = 0, removedWins = 0, removedShared = 0;
        // Replace All's clean-up keeps the row with the newest updatedAt || createdAt
        const stamp = r => r.updatedAt || r.createdAt || '';
        for (const [, g] of preGroups) {
            if (g.length < 2) continue;
            const liveN = g.filter(live).length;
            if (liveN > 1) preDup++;
            else if (liveN === 1) {
                // Refused when a removed rating is newer than the live one, or as new: with the same
                // time, which row Replace All keeps isn't certain (META, 29 Sep)
                const liveAt = stamp(g.find(live));
                if (g.some(r => !live(r) && stamp(r) >= liveAt)) removedWins++; else removedShared++;
            }
            else removedShared++;
        }
        if (preDup) refusals.push(`${preDup} pair(s) of ratings already share student, skill, activity and time; Replace All would drop one.`);
        if (removedWins) refusals.push(`${removedWins} removed rating(s) share student, skill, activity and time with a live rating and are newer or as new; Replace All could keep the removed one and drop the live one.`);
        if (removedShared) warnings.push(`${removedShared} removed rating(s) share student, skill, activity and time with another rating; Replace All drops the removed one. Nothing live is lost.`);

        // Crosswalk internal consistency: each target's mergedFrom equals its merge rows
        for (const t of cw.createTargets) {
            const fromRows = cw.rows.filter(r => r.class === 'merge' && r.to === t.name).map(r => r.from).sort();
            if (JSON.stringify(fromRows) !== JSON.stringify(t.mergedFrom.slice().sort())) refusals.push(`Crosswalk error: "${t.name}" lists different old skills than its merge rows.`);
        }

        // ── Classes ──
        const retireIds = new Set(), mergeTargetOf = new Map(), renameOf = new Map(), recatOf = new Map();
        for (const row of cw.rows) {
            const s = rowSkill.get(row);
            if (!s) continue;
            if (row.class === 'retire') retireIds.add(s.id);
            else if (row.class === 'merge') mergeTargetOf.set(s.id, row.to);
            else if (row.class === 'rename') renameOf.set(s.id, row);
            else if (row.class === 'recategorize') recatOf.set(s.id, row);
        }

        // 12: live references to a retiring skill (needs her decision)
        const liveActs = new Set(snap.activities.filter(a => !a.deletedAt).map(a => a.id));
        let retiringRefs = 0;
        for (const l of snap.activitySkills) if (!l.deletedAt && liveActs.has(l.activityId) && retireIds.has(l.skillId)) retiringRefs++;
        for (const a of snap.activities) if (!a.deletedAt) for (const e of (a.skillsAssessed || [])) if (retireIds.has(e.skillId)) retiringRefs++;
        for (const c of snap.checkpoints) if (liveActs.has(c.activityId)) for (const id of (c.skillsAssessable || [])) if (retireIds.has(id)) retiringRefs++;
        if (retiringRefs) refusals.push(`${retiringRefs} live reference(s) to a retiring skill (activity links, skillsAssessed or checkpoints). This needs her decision first.`);

        // 14: skillsAssessed entries whose id and name point to two different live skills
        let idNameClash = 0;
        for (const a of snap.activities) for (const e of (a.skillsAssessed || [])) {
            if (e.skillId == null || !skillById.has(e.skillId) || !e.skillName) continue;
            const byName = byNorm.get(norm(e.skillName)) || [];
            if (byName.length === 1 && byName[0].id !== e.skillId) idNameClash++;
        }
        if (idNameClash) refusals.push(`${idNameClash} skillsAssessed entr(ies) name one skill and point to another by id.`);

        // ── C1 step 1: the nine new skills, with ids chosen now (max id + 1 …) so Preview and Run agree ──
        let nextSkillId = skills.reduce((m, s) => Math.max(m, s.id), 0) + 1;
        const targetsByName = new Map();
        const newSkills = cw.createTargets.map(t => {
            const rec = {
                id: nextSkillId++, name: t.name, category: t.category, description: t.description,
                createdAt: M, updatedAt: M,
                migration: { epoch: E, kind: 'merge-target', mergedFrom: t.mergedFrom.map(n => { const r = cw.rows.find(x => x.from === n); const s = r && rowSkill.get(r); return s ? s.id : null; }) }
            };
            targetsByName.set(t.name, rec);
            return rec;
        });
        const targetIdOf = new Map();   // merged-away old id → new target id
        for (const [oldId, tName] of mergeTargetOf) targetIdOf.set(oldId, targetsByName.get(tName).id);
        const mapId = id => (targetIdOf.has(id) ? targetIdOf.get(id) : id);
        const finalName = new Map(skills.map(s => [s.id, renameOf.has(s.id) ? renameOf.get(s.id).to : s.name]));
        for (const t of newSkills) finalName.set(t.id, t.name);

        // ── Step 2: renames and the recategorisation ──
        const skillUpdates = [];   // [id, changes]
        for (const [id, row] of renameOf) {
            const s = skillById.get(id);
            skillUpdates.push([id, {
                name: row.to, category: row.toCategory, description: cw.renameDescriptions[row.to] || s.description || '',
                previousName: s.name, previousCategory: s.category, previousDescription: s.description || '',
                updatedAt: M, migration: { epoch: E, kind: 'renamed' }
            }]);
        }
        for (const [id, row] of recatOf) {
            const s = skillById.get(id);
            skillUpdates.push([id, { category: row.toCategory, previousCategory: s.category, updatedAt: M, migration: { epoch: E, kind: 'recategorised' } }]);
        }

        // ── Step 3: move ratings; nudge createdAt by 1 ms where a key would repeat ──
        const obsSorted = snap.skillObservations.slice().sort((a, b) => a.id - b.id);
        const keySet = new Set();
        for (const r of obsSorted) if (!targetIdOf.has(r.skillId)) keySet.add(this.ratingKey(r));
        const bump = iso => new Date(new Date(iso).getTime() + 1).toISOString();
        // Removed ratings move too (both devices must agree), and their keys count here, but they
        // aren't counted as live ratings moved in (§3.3)
        const obsUpdates = [];
        let nudged = 0, movedRemoved = 0;
        const movedTo = new Map();   // target id → live ratings moved in
        for (const r of obsSorted) {
            if (!targetIdOf.has(r.skillId)) continue;
            const T = targetIdOf.get(r.skillId);
            const changes = { skillId: T, premigrationSkillId: r.skillId, updatedAt: M };
            let createdAt = r.createdAt || r.updatedAt || M;
            let key = this.ratingKey({ ...r, skillId: T, createdAt });
            if (keySet.has(key)) {
                changes.premigrationCreatedAt = r.createdAt;
                while (keySet.has(key)) { createdAt = bump(createdAt); key = this.ratingKey({ ...r, skillId: T, createdAt }); }
                changes.createdAt = createdAt;
                nudged++;
            }
            keySet.add(key);
            obsUpdates.push([r.id, changes]);
            if (r.deletedAt) { movedRemoved++; continue; }
            movedTo.set(T, (movedTo.get(T) || 0) + 1);
        }

        // ── Step 4 (C2): levels and D4 placeholders, classified against each level's own old skill ──
        const ratingsOf = new Map();    // "student|skill" → live ratings (before the move); a removed one is never behind a level
        for (const r of liveObs) {
            const k = r.studentId + '|' + r.skillId;
            if (!ratingsOf.has(k)) ratingsOf.set(k, []);
            ratingsOf.get(k).push(r);
        }
        const levelsOf = new Map();     // "student|skill" → live level records
        for (const l of snap.skillLevels) {
            if (l.deletedAt) continue;
            const k = l.studentId + '|' + l.skillId;
            if (!levelsOf.has(k)) levelsOf.set(k, []);
            levelsOf.get(k).push(l);
        }
        let dupLevels = 0;
        const newestLevel = list => list.slice().sort((a, b) => at(b).localeCompare(at(a)) || b.id - a.id)[0];
        for (const [, list] of levelsOf) if (list.length > 1) dupLevels++;
        if (dupLevels) warnings.push(`${dupLevels} student/skill pair(s) have two level records; the newer is carried, and Replace All keeps only one.`);

        const placeholders = [];
        const placeholderKinds = {};
        const levelKeys = [...levelsOf.keys()].sort((a, b) => newestLevel(levelsOf.get(a)).id - newestLevel(levelsOf.get(b)).id);
        for (const k of levelKeys) {
            const L = newestLevel(levelsOf.get(k));
            const skill = skillById.get(L.skillId);
            if (!skill) continue;                                  // orphan level: reported below
            if (retireIds.has(L.skillId)) continue;                // hidden history: no placeholder
            const rs = ratingsOf.get(k) || [];
            if (rs.some(r => r.rating === L.level)) continue;      // a rating is behind it
            const best = rs.reduce((m, r) => Math.max(m, lv(r.rating)), 0);
            const kind = rs.length === 0 ? 'no-ratings' : (lv(L.level) > best ? 'above-ratings' : 'below-ratings');
            const T = mapId(L.skillId);
            let createdAt = L.updatedAt || L.createdAt || L.demonstratedAt || M;
            let key = this.ratingKey({ studentId: L.studentId, skillId: T, activityId: null, createdAt });
            while (keySet.has(key)) { createdAt = bump(createdAt); key = this.ratingKey({ studentId: L.studentId, skillId: T, activityId: null, createdAt }); }
            keySet.add(key);
            placeholders.push({
                studentId: L.studentId, skillId: T, activityId: null, checkpointId: null,
                rating: L.level, originalRating: L.level, evidenceType: 'migrated',
                note: `Level carried over from "${skill.name}" in the Draft 3 skills migration; no rating was behind it.`,
                migration: { epoch: E, kind, fromSkillId: L.skillId, fromSkillName: skill.name, fromLevelId: L.id },
                createdAt, migratedAt: M, updatedAt: M
            });
            const pk = `${T}|${kind}`;
            placeholderKinds[pk] = (placeholderKinds[pk] || 0) + 1;
        }

        // New levels on merge targets: the highest carried-in level (C2 steps 1–3)
        const newLevels = [];
        const levelUpdates = [];
        const perTarget = new Map(newSkills.map(t => [t.id, { oldIds: t.migration.mergedFrom, levelsWritten: 0, oldLevelsMarked: 0 }]));
        for (const t of newSkills) {
            const oldIds = t.migration.mergedFrom.filter(id => id != null);
            const students = new Set();
            for (const l of snap.skillLevels) if (!l.deletedAt && oldIds.includes(l.skillId)) students.add(l.studentId);
            for (const r of liveObs) if (oldIds.includes(r.skillId)) students.add(r.studentId);   // a removed rating doesn't bring a student in
            for (const sid of [...students].sort((a, b) => (a > b ? 1 : a < b ? -1 : 0))) {
                const candidates = [];
                for (const k of oldIds) {
                    const ls = levelsOf.get(sid + '|' + k);
                    if (ls && ls.length) {
                        const L = newestLevel(ls);
                        candidates.push({ value: lv(L.level), level: L.level, demonstratedIn: L.demonstratedIn ?? null, demonstratedAt: L.demonstratedAt || null, updatedAt: L.updatedAt || '', createdAt: L.createdAt || '', fromSkillId: k, fromLevelId: L.id });
                    } else {
                        const rs = ratingsOf.get(sid + '|' + k) || [];
                        if (rs.length) {
                            const best = rs.slice().sort((a, b) => lv(b.rating) - lv(a.rating) || (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
                            candidates.push({ value: lv(best.rating), level: best.rating, demonstratedIn: best.activityId ?? null, demonstratedAt: best.createdAt || null, updatedAt: best.updatedAt || '', createdAt: best.createdAt || '', fromSkillId: k, fromLevelId: null });
                        }
                    }
                }
                if (!candidates.length) continue;
                candidates.sort((a, b) => b.value - a.value
                    || String(b.demonstratedAt || '').localeCompare(String(a.demonstratedAt || ''))
                    || b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt));
                const w = candidates[0];
                newLevels.push({
                    studentId: sid, skillId: t.id, level: w.level, demonstratedIn: w.demonstratedIn, demonstratedAt: w.demonstratedAt,
                    createdAt: M, updatedAt: M,
                    migration: { epoch: E, kind: 'merged-level', fromSkillIds: candidates.map(c => c.fromSkillId), carriedFromSkillId: w.fromSkillId, carriedFromLevelId: w.fromLevelId }
                });
                perTarget.get(t.id).levelsWritten++;
            }
        }
        // Old levels on merged-away skills are marked (every record, duplicates included)
        for (const l of snap.skillLevels.slice().sort((a, b) => a.id - b.id)) {
            if (l.deletedAt || !targetIdOf.has(l.skillId)) continue;
            const T = targetIdOf.get(l.skillId);
            levelUpdates.push([l.id, { deletedAt: M, mergedInto: T, updatedAt: M }]);
            perTarget.get(T).oldLevelsMarked++;
        }

        // ── Step 5a: activitySkills ──
        const linkUpdates = [];
        const liveTargetLink = new Set();
        for (const l of snap.activitySkills) if (!l.deletedAt && !targetIdOf.has(l.skillId)) liveTargetLink.add(l.activityId + '|' + l.skillId);
        let linksRewritten = 0, linksFolded = 0;
        for (const l of snap.activitySkills.slice().sort((a, b) => a.id - b.id)) {
            if (l.deletedAt || !targetIdOf.has(l.skillId)) continue;
            const T = targetIdOf.get(l.skillId);
            const key = l.activityId + '|' + T;
            if (liveTargetLink.has(key)) {
                linkUpdates.push([l.id, { deletedAt: M, mergedInto: T, updatedAt: M }]);
                linksFolded++;
            } else {
                linkUpdates.push([l.id, { skillId: T, premigrationSkillId: l.skillId, updatedAt: M }]);
                liveTargetLink.add(key);
                linksRewritten++;
            }
        }

        // ── Step 5b: activities.skillsAssessed (Q1: the first entry's levels are kept) ──
        const activityUpdates = [];
        const folded = [];            // { activityId, keptSkillId, foldedSkillId, targetId }
        let saRewritten = 0, saFoldedLive = 0, saFoldedDeleted = 0, saUnknown = 0;
        for (const a of snap.activities.slice().sort((x, y) => x.id - y.id)) {
            const list = Array.isArray(a.skillsAssessed) ? a.skillsAssessed : null;
            if (!list || !list.length) continue;
            const out = [];
            const indexByTarget = new Map();
            for (const e of list) {
                if (!e || typeof e !== 'object') { out.push(e); continue; }
                let s = (e.skillId != null && skillById.has(e.skillId)) ? skillById.get(e.skillId) : null;
                if (!s && typeof e.skillName === 'string') {
                    const byName = byNorm.get(norm(e.skillName)) || [];
                    if (byName.length === 1) s = byName[0];
                }
                if (!s) { out.push(e); saUnknown++; continue; }
                const T = mapId(s.id);
                if (indexByTarget.has(T)) {
                    const kept = out[indexByTarget.get(T)];
                    const cps = (kept.checkpoints || []).slice();
                    for (const c of (e.checkpoints || [])) if (!cps.includes(c)) cps.push(c);
                    kept.checkpoints = cps;
                    kept.mergedFrom = (kept.mergedFrom || []).concat([{ skillId: s.id, skillName: e.skillName ?? s.name, levels: e.levels || {} }]);
                    folded.push({ activityId: a.id, keptSkillId: kept._fromSkillId, foldedSkillId: s.id, targetId: T, deletedActivity: !!a.deletedAt });
                    if (a.deletedAt) saFoldedDeleted++; else saFoldedLive++;
                } else {
                    const entry = { ...e, skillId: T, skillName: finalName.get(T) };
                    Object.defineProperty(entry, '_fromSkillId', { value: s.id, enumerable: false });
                    indexByTarget.set(T, out.length);
                    out.push(entry);
                }
            }
            const clean = out.map(e => (e && typeof e === 'object' ? JSON.parse(JSON.stringify(e)) : e));
            if (JSON.stringify(clean) !== JSON.stringify(list)) {
                activityUpdates.push([a.id, { skillsAssessed: clean, updatedAt: M }]);
                saRewritten++;
            }
        }

        // ── Step 5c: checkpoints.skillsAssessable ──
        const checkpointUpdates = [];
        let cpDropped = 0;
        for (const c of snap.checkpoints.slice().sort((x, y) => x.id - y.id)) {
            const list = Array.isArray(c.skillsAssessable) ? c.skillsAssessable : null;
            if (!list || !list.length) continue;
            const out = [];
            for (const id of list) { const m = mapId(id); if (!out.includes(m)) out.push(m); else cpDropped++; }
            if (JSON.stringify(out) !== JSON.stringify(list)) checkpointUpdates.push([c.id, { skillsAssessable: out, updatedAt: M }]);
        }

        // ── Steps 6–7: retire, and mark merged-away skills ──
        for (const id of [...retireIds].sort((a, b) => a - b)) {
            skillUpdates.push([id, { retiredAt: M, retiredNote: 'Not in Draft 3 — retired in the skills migration', updatedAt: M, migration: { epoch: E, kind: 'retired' } }]);
        }
        for (const [oldId, T] of [...targetIdOf].sort((a, b) => a[0] - b[0])) {
            skillUpdates.push([oldId, { deletedAt: M, mergedInto: T, updatedAt: M, migration: { epoch: E, kind: 'merged' } }]);
        }

        // ── Step 8: the marker ──
        const epochSetting = { key: 'sync-epoch', value: { id: E, at: M, crosswalkId: cw.crosswalkId, tool: this.TOOL }, createdAt: M, updatedAt: M };

        // References to skill ids that don't exist (left alone; warned)
        const missing = { ratings: 0, levels: 0, links: 0, checkpoints: 0 };
        for (const r of liveObs) if (!skillById.has(r.skillId)) missing.ratings++;
        for (const l of snap.skillLevels) if (!skillById.has(l.skillId)) missing.levels++;
        for (const l of snap.activitySkills) if (!skillById.has(l.skillId)) missing.links++;
        for (const c of snap.checkpoints) for (const id of (c.skillsAssessable || [])) if (!skillById.has(id)) missing.checkpoints++;
        if (missing.ratings + missing.levels + missing.links + missing.checkpoints + saUnknown) {
            warnings.push(`References to skills that don't exist (left alone): ratings ${missing.ratings}, levels ${missing.levels}, links ${missing.links}, checkpoint entries ${missing.checkpoints}, skillsAssessed entries ${saUnknown}.`);
        }
        const noCreated = snap.skillObservations.filter(r => !r.createdAt).length;   // all rows: removed ones move and are keyed too
        if (noCreated) warnings.push(`${noCreated} rating(s) have no createdAt; updatedAt is used for ordering.`);

        // ── Expected counts after (Data check format) ──
        const expected = {};
        for (const [name, c] of Object.entries(snap.counts)) expected[name] = { total: c.total, deleted: c.deleted };
        expected.skills.total += newSkills.length;
        expected.skills.deleted += targetIdOf.size;
        expected.skillObservations.total += placeholders.length;
        expected.skillLevels.total += newLevels.length;
        expected.skillLevels.deleted += levelUpdates.length;
        expected.activitySkills.deleted += linksFolded;
        if (!epochRow) expected.settings.total += 1;
        const dupeTotal = Object.values(snap.dupes).reduce((s, n) => s + n, 0);

        const visibleAfter = skills.filter(s => !retireIds.has(s.id) && !targetIdOf.has(s.id)).length + newSkills.length;
        const ratingsPerTarget = {};
        for (const t of newSkills) ratingsPerTarget[t.id] = (movedTo.get(t.id) || 0) + placeholders.filter(p => p.skillId === t.id).length;   // live only

        return {
            M, refusals, warnings, newSkills, skillUpdates, obsUpdates, placeholders, newLevels, levelUpdates,
            linkUpdates, activityUpdates, checkpointUpdates, epochSetting, folded, expected, dupes: snap.dupes, dupeTotal,
            stats: {
                created: newSkills.length, renamed: renameOf.size, recategorised: recatOf.size, mergedAway: targetIdOf.size, retired: retireIds.size,
                ratingsMoved: obsUpdates.length - movedRemoved, ratingsMovedRemoved: movedRemoved, ratingsNudged: nudged, placeholders: placeholders.length, placeholderKinds,
                newLevels: newLevels.length, oldLevelsMarked: levelUpdates.length,
                linksRewritten, linksFolded, saActivitiesRewritten: saRewritten, saFoldedLive, saFoldedDeleted, saUnknown,
                checkpointsRewritten: checkpointUpdates.length, checkpointDuplicatesDropped: cpDropped,
                visibleAfter, expectedVisible: cw.expectedVisibleAfter, missing
            },
            perTarget, ratingsPerTarget, targetNames: new Map(newSkills.map(t => [t.id, t.name]))
        };
    },

    // Refusals that depend on this device rather than the data (C7 run refusals 1–5)
    environmentRefusals: async function() {
        const out = [];
        if (localStorage.getItem('drive-sync-enabled') === 'true') out.push('Turn Drive sync off first.');
        if (syncThisDevice() === 'iPad') out.push('The migration runs on the PC only.');
        const exp = await db.settings.get('last-manual-export');
        const t = exp && exp.value ? new Date(exp.value).getTime() : 0;
        if (!t || Date.now() - t > this.EXPORT_MAX_AGE_MS) out.push('Export JSON first: the last export is more than 2 hours old (or there is none).');
        if (driveSync._pendingMerge) out.push('A downloaded update is still waiting to be applied. Close and reopen the app with sync off.');
        return out;
    },

    // ── The plan's writes. Call inside a rw transaction over TABLES; any error aborts it. ──
    _write: async function(p) {
        let writes = 0;
        const step = () => {
            writes++;
            if (this._testFailAfterWrites != null && writes > this._testFailAfterWrites) throw new Error('Test: forced failure mid-write');
        };
        {
            for (const s of p.newSkills) { await db.skills.add(s); step(); }
            for (const [id, c] of p.skillUpdates.filter(([, c]) => c.migration && (c.migration.kind === 'renamed' || c.migration.kind === 'recategorised'))) { await db.skills.update(id, c); step(); }
            for (const [id, c] of p.obsUpdates) { await db.skillObservations.update(id, c); step(); }
            for (const r of p.placeholders) { await db.skillObservations.add(r); step(); }
            for (const l of p.newLevels) { await db.skillLevels.add(l); step(); }
            for (const [id, c] of p.levelUpdates) { await db.skillLevels.update(id, c); step(); }
            for (const [id, c] of p.linkUpdates) { await db.activitySkills.update(id, c); step(); }
            for (const [id, c] of p.activityUpdates) { await db.activities.update(id, c); step(); }
            for (const [id, c] of p.checkpointUpdates) { await db.checkpoints.update(id, c); step(); }
            for (const [id, c] of p.skillUpdates.filter(([, c]) => c.migration && (c.migration.kind === 'retired' || c.migration.kind === 'merged'))) { await db.skills.update(id, c); step(); }
            await db.settings.put(p.epochSetting); step();
        }
        return writes;
    },

    // ── Writes a plan in one transaction. Any error: nothing is changed. ──
    apply: async function(p) {
        let writes = 0;
        await db.transaction('rw', this.TABLES.map(t => db.table(t)), async () => { writes = await this._write(p); });
        return writes;
    },

    // ── Run's write: re-reads the tables it plans from inside the write transaction, plans again,
    // writes, and counts the tables it wrote, all in that one transaction. Nothing can land between
    // the plan and the writes, and the "actual" counts can only differ from the expected ones if the
    // tool itself wrote something other than planned. Counts of the other tables come from `outer`
    // (the snapshot before the confirmation); the tool never compares them.
    _planAndWrite: async function(outer, M) {
        let p = null;
        const actual = {};
        await db.transaction('rw', this.READ_TABLES().map(t => db.table(t)), async () => {
            const snap = { counts: { ...outer.counts }, dupes: { ...outer.dupes } };
            await this._readInto(snap, this.READ_TABLES());
            p = this.plan(snap, M);
            if (p.refusals.length) { const e = new Error('Refused: ' + p.refusals.join(' ')); e.refused = true; throw e; }
            await this._write(p);
            for (const name of this.TABLES) {
                const rows = await db.table(name).toArray();
                actual[name] = { total: rows.length, deleted: rows.filter(r => r && r.deletedAt).length };
            }
        });
        return { p, actual };
    },

    // ── Verify (read-only, both devices; C5 V2, V3, V6–V10) ──
    verify: async function() {
        const cw = this.crosswalk();
        const snap = {};
        for (const t of this.TABLES) snap[t] = await db.table(t).toArray();
        const epochRow = snap.settings.find(r => r.key === 'sync-epoch');
        if (!epochRow || !epochRow.value || epochRow.value.id !== this.EPOCH_ID) {
            return { migrated: false, items: [], ok: false };
        }
        const items = [];
        const check = (id, label, ok, detail) => items.push({ id, label, ok: !!ok, detail: detail || '' });
        const skills = snap.skills;
        const visible = skills.filter(s => !isSkillHidden(s));
        const mergedAway = skills.filter(s => s.deletedAt && s.mergedInto);
        const retired = skills.filter(s => s.retiredAt && !s.deletedAt);

        // V2: exactly Draft 3's visible names and categories
        const want = new Map();
        for (const t of cw.createTargets) want.set(t.name, t.category);
        for (const r of cw.rows) if (r.class !== 'merge' && r.class !== 'retire') want.set(r.to, r.toCategory);
        for (const p of cw.alreadyPresent) want.set(p.name, p.category);
        const have = new Map(visible.map(s => [s.name, s.category]));
        const wrong = [...want].filter(([n, c]) => have.get(n) !== c).length + [...have.keys()].filter(n => !want.has(n)).length;
        check('V2', `Visible skills: ${visible.length} (Draft 3: ${cw.expectedVisibleAfter}); ${retired.length} retired; ${mergedAway.length} merged`,
            visible.length === cw.expectedVisibleAfter && wrong === 0 && visible.length === want.size, wrong ? `${wrong} name/category difference(s)` : '');

        // V3: no two live ratings share Replace All's key (a removed one isn't a duplicate, §3.3)
        const keys = new Set(); let dup = 0;
        for (const r of snap.skillObservations) { if (r.deletedAt) continue; const k = this.ratingKey(r); if (keys.has(k)) dup++; else keys.add(k); }
        const allKeys = new Set(); let removedShared = 0;
        for (const r of snap.skillObservations) { const k = this.ratingKey(r); if (allKeys.has(k)) removedShared++; else allKeys.add(k); }
        removedShared -= dup;
        check('V3', 'No two live ratings share student, skill, activity and time', dup === 0,
            [dup ? `${dup} shared` : '', removedShared ? `${removedShared} removed rating(s) share a key (not a duplicate)` : ''].filter(Boolean).join('; '));

        // V6: one live level per student on each target, equal to the highest carried-in level
        const lv = n => this.LEVELS[n] || 0;
        const mergedIds = new Set(mergedAway.map(s => s.id));
        let v6bad = 0, v6n = 0;
        for (const t of skills.filter(s => s.migration && s.migration.kind === 'merge-target')) {
            const oldIds = new Set((t.migration.mergedFrom || []).filter(x => x != null));
            const carried = new Map();     // student → highest carried-in value
            const hasOldLevel = new Set(); // "student|old skill" with a (marked) level
            const newest = new Map();
            for (const l of snap.skillLevels) {
                if (l.mergedInto !== t.id || !oldIds.has(l.skillId)) continue;
                const k = String(l.studentId) + '|' + l.skillId;
                const prev = newest.get(k);
                if (!prev || (l.updatedAt || l.createdAt || '') > (prev.updatedAt || prev.createdAt || '')) newest.set(k, l);
            }
            for (const [k, l] of newest) {
                hasOldLevel.add(k);
                const sid = String(l.studentId);
                carried.set(sid, Math.max(carried.get(sid) || 0, lv(l.level)));
            }
            for (const r of snap.skillObservations) {
                if (r.deletedAt || r.skillId !== t.id || r.premigrationSkillId == null) continue;   // live only, as the plan
                if (hasOldLevel.has(String(r.studentId) + '|' + r.premigrationSkillId)) continue;
                const sid = String(r.studentId);
                carried.set(sid, Math.max(carried.get(sid) || 0, lv(r.rating)));
            }
            for (const [sid, best] of carried) {
                v6n++;
                const live = snap.skillLevels.filter(l => String(l.studentId) === sid && l.skillId === t.id && !l.deletedAt);
                if (live.length !== 1 || lv(live[0].level) !== best) v6bad++;
            }
        }
        const liveOnMerged = snap.skillLevels.filter(l => !l.deletedAt && mergedIds.has(l.skillId)).length;
        check('V6', `Levels on merge targets: ${v6n} student(s) checked; 0 live levels on merged-away skills`, v6bad === 0 && liveOnMerged === 0,
            [v6bad ? `${v6bad} wrong` : '', liveOnMerged ? `${liveOnMerged} live on merged-away` : ''].filter(Boolean).join('; '));

        // V7: no live link on a hidden skill
        const liveLinksHidden = snap.activitySkills.filter(l => !l.deletedAt && mergedIds.has(l.skillId)).length;
        check('V7', '0 live activity links on merged-away skills', liveLinksHidden === 0, liveLinksHidden ? `${liveLinksHidden}` : '');

        // V8: skillsAssessed entries point at no merged-away skill, and names match
        const mergedNames = new Set(mergedAway.map(s => this.norm(s.name)));
        const byId = new Map(skills.map(s => [s.id, s]));
        let v8bad = 0;
        for (const a of snap.activities) for (const e of (a.skillsAssessed || [])) {
            if (!e || typeof e !== 'object') continue;
            if (mergedIds.has(e.skillId) || mergedNames.has(this.norm(e.skillName))) v8bad++;
            else if (e.skillId != null && byId.has(e.skillId) && byId.get(e.skillId).name !== e.skillName) v8bad++;
        }
        check('V8', 'skillsAssessed: 0 entries on merged-away skills; every name matches its skill', v8bad === 0, v8bad ? `${v8bad}` : '');

        // V9: skillsAssessable: 0 merged-away ids, no repeats
        let v9bad = 0;
        for (const c of snap.checkpoints) {
            const list = c.skillsAssessable || [];
            if (list.some(id => mergedIds.has(id)) || new Set(list).size !== list.length) v9bad++;
        }
        check('V9', 'Checkpoints: 0 merged-away ids, no repeated ids', v9bad === 0, v9bad ? `${v9bad} checkpoint(s)` : '');

        // V10: epoch; every visible category is in skill-categories
        const catRow = snap.settings.find(r => r.key === 'skill-categories');
        const cats = (catRow && Array.isArray(catRow.value)) ? catRow.value : [];
        const missingCat = [...new Set(visible.map(s => s.category))].filter(c => !cats.includes(c));
        check('V10', `Sync-epoch set; skill categories: ${cats.length}; every visible skill's category listed`,
            missingCat.length === 0 && cw.expectedCategories.every(c => cats.includes(c)), missingCat.length ? missingCat.join(', ') : '');

        return { migrated: true, items, ok: items.every(i => i.ok), at: epochRow.value.at };
    },

    // ── Report text (counts and ids only) ──
    reportText: function(p, mode, actual, verifyResult) {
        const s = p.stats;
        const L = [];
        L.push(`ShopFlow skills migration ${mode} · ${this.TOOL} · crosswalk ${this.crosswalk().crosswalkId} · ${syncThisDevice()} · ${new Date().toLocaleString('en-US')}`);
        if (mode === 'run') L.push(`Migration time (M): ${p.M}`);
        L.push('');
        if (p.refusals.length) { L.push('REFUSED — nothing would be changed:'); p.refusals.forEach(r => L.push('  ⛔ ' + r)); L.push(''); }
        if (p.warnings.length) { L.push('Warnings:'); p.warnings.forEach(w => L.push('  ⚠ ' + w)); L.push(''); }
        // Only the tables the migration writes are compared. The others are shown as they are (the
        // app itself adds to submissions, alerts and tasks), never marked ≠.
        const fmt = c => `${c.total}${c.deleted ? ` (${c.deleted} deleted)` : ''}`;
        L.push(actual ? 'Tables the migration changes (expected / actual):' : 'Tables the migration changes, expected after (Data check format):');
        for (const name of this.TABLES.slice().sort()) {
            const e = p.expected[name];
            if (!e) continue;
            const a = actual && actual[name];
            L.push(`  ${name}: ${fmt(e)}${a ? ` / ${fmt(a)}${(a.total !== e.total || a.deleted !== e.deleted) ? '  ≠' : ''}` : ''}`);
        }
        L.push(`Tables the migration doesn't change (${actual ? 'now' : 'at Preview'}; not compared, as the app can add to submissions, alerts and tasks by itself):`);
        for (const name of Object.keys(p.expected).sort()) {
            if (name === 'activityLog' || this.TABLES.includes(name)) continue;   // activityLog: this device only
            const now = actual && actual[name];
            L.push(`  ${name}: ${fmt(now || p.expected[name])}`);
        }
        L.push(`Expected iPad counts after the re-seed: PC counts minus ${p.dupeTotal} pre-existing duplicate key(s)` +
            (p.dupeTotal ? ` (${Object.entries(p.dupes).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`).join(', ')})` : '') + '.');
        L.push('');
        L.push(`Skills: ${s.created} created, ${s.renamed} renamed, ${s.recategorised} recategorised, ${s.mergedAway} merged away, ${s.retired} retired. Visible after: ${s.visibleAfter} (Draft 3: ${s.expectedVisible}).`);
        L.push('Per Draft 3 target (new skill id: ratings moved in / placeholders / levels written / old levels marked):');
        for (const t of p.newSkills) {
            const pt = p.perTarget.get(t.id);
            const moved = p.ratingsPerTarget[t.id] - p.placeholders.filter(x => x.skillId === t.id).length;
            L.push(`  ${t.id} ${t.name}: ${moved} / ${p.placeholders.filter(x => x.skillId === t.id).length} / ${pt.levelsWritten} / ${pt.oldLevelsMarked} (from skills ${t.migration.mergedFrom.join(', ')})`);
        }
        L.push(`Ratings moved: ${s.ratingsMoved}${s.ratingsMovedRemoved ? ` live + ${s.ratingsMovedRemoved} removed (moved too, not counted as ratings)` : ''} (${s.ratingsNudged} nudged by 1 ms). Placeholders (D4): ${s.placeholders}` +
            (s.placeholders ? ' — ' + Object.entries(s.placeholderKinds).map(([k, n]) => { const [sk, kind] = k.split('|'); return `skill ${sk} ${kind} ${n}`; }).join(', ') : '') + '.');
        L.push(`Levels: ${s.newLevels} written on targets, ${s.oldLevelsMarked} old marked merged.`);
        L.push(`activitySkills: ${s.linksRewritten} rewritten, ${s.linksFolded} folded. skillsAssessed: ${s.saActivitiesRewritten} activities rewritten, ${s.saFoldedLive + s.saFoldedDeleted} entries folded (${s.saFoldedLive} live, ${s.saFoldedDeleted} on deleted activities). skillsAssessable: ${s.checkpointsRewritten} checkpoints rewritten, ${s.checkpointDuplicatesDropped} repeats dropped.`);
        L.push('');
        L.push(`Folded skillsAssessed entries (Q1): the first entry's descriptors are shown for now; re-author these to ODE-aligned Draft 3 descriptors (${p.folded.length}):`);
        p.folded.forEach(f => L.push(`  activity ${f.activityId}${f.deletedActivity ? ' (deleted)' : ''}: target skill ${f.targetId}; kept skill ${f.keptSkillId}'s descriptors; folded skill ${f.foldedSkillId}`));
        if (verifyResult) {
            L.push('');
            L.push('Verify:');
            verifyResult.items.forEach(i => L.push(`  ${i.ok ? '✅' : '❌'} ${i.id} ${i.label}${i.detail ? ' — ' + i.detail : ''}`));
        }
        return L.join('\n');
    },

    currentCounts: async function() {
        const out = {};
        for (const table of db.tables) {
            const rows = await table.toArray();
            out[table.name] = { total: rows.length, deleted: rows.filter(r => r && r.deletedAt).length };
        }
        return out;
    },

    // ── UI ──
    _show: function(text, ok) {
        const el = document.getElementById('skills-migration-output');
        this._lastReport = text;
        if (el) {
            el.textContent = text;
            el.style.borderColor = ok === false ? 'var(--color-error)' : 'var(--color-border)';
        }
    },

    initCard: function() {
        const runBtn = document.getElementById('skills-migration-run-btn');
        if (runBtn) runBtn.style.display = syncThisDevice() === 'iPad' ? 'none' : '';
    },

    preview: async function() {
        const snap = await this.snapshot();
        const p = this.plan(snap, new Date().toISOString());
        const env = await this.environmentRefusals();
        let text = this.reportText(p, 'preview');
        if (env.length) text = `Run would also refuse on this device right now:\n${env.map(e => '  ⛔ ' + e).join('\n')}\n\n` + text;
        this._show(text, p.refusals.length === 0);
        return p;
    },

    run: async function() {
        const env = await this.environmentRefusals();
        const snap = await this.snapshot();
        const M = new Date().toISOString();
        const p = this.plan(snap, M);
        const refusals = env.concat(p.refusals);
        if (refusals.length) {
            this._show(`Not run — nothing was changed:\n${refusals.map(r => '  ⛔ ' + r).join('\n')}\n\n` + this.reportText(p, 'preview'), false);
            return { ok: false, refusals };
        }
        if (!confirm(`Run the Draft 3 skills migration on this PC now? ${p.stats.created} skills are created, ${p.stats.mergedAway} merged away and ${p.stats.retired} retired. Make sure you exported both devices first.`)) {
            return { ok: false, cancelled: true };
        }
        const started = Date.now();
        let done;
        try {
            done = await this._planAndWrite(snap, M);
        } catch (err) {
            console.error('Skills migration failed:', err);
            if (err && err.refused) {
                const again = this.plan(await this.snapshot(), M);
                this._show(`Not run — nothing was changed (the data changed after you pressed Run):\n${again.refusals.map(r => '  ⛔ ' + r).join('\n')}`, false);
                return { ok: false, refusals: again.refusals };
            }
            this._show(`❌ The migration stopped with an error, and nothing was changed.\n${err && err.message ? err.message : err}`, false);
            return { ok: false, error: String(err && err.message || err) };
        }
        const ran = done.p;
        await logAction('migrate', 'skills', null, `Draft 3 skills migration (${this.EPOCH_ID}): ${ran.stats.created} created, ${ran.stats.mergedAway} merged, ${ran.stats.retired} retired`);
        // The tables it wrote were counted inside the write; the others are counted now, for show only
        const actual = { ...(await this.currentCounts()), ...done.actual };
        const v = await this.verify();
        const text = `✅ Done in ${((Date.now() - started) / 1000).toFixed(1)} s.\n\n` + this.reportText(ran, 'run', actual, v);
        this._show(text, v.ok);
        if (typeof driveSync !== 'undefined') driveSync.updateSyncStatusUI();
        return { ok: true, verify: v, plan: ran };
    },

    runVerify: async function() {
        const v = await this.verify();
        if (!v.migrated) { this._show('Verify: not migrated — this device has no skills-migration epoch. Nothing to check.', null); return v; }
        this._show(`Verify (${syncThisDevice()}, ${new Date().toLocaleString('en-US')}) — migrated ${v.at}:\n` +
            v.items.map(i => `  ${i.ok ? '✅' : '❌'} ${i.id} ${i.label}${i.detail ? ' — ' + i.detail : ''}`).join('\n'), v.ok);
        return v;
    },

    copyReport: async function() {
        if (!this._lastReport) { ui.showToast('Run Preview or Verify first.', 'info'); return; }
        try {
            await navigator.clipboard.writeText(this._lastReport);
            ui.showToast('Report copied (counts and ids only)', 'success');
        } catch (e) {
            ui.showToast('Could not copy. Take a screenshot instead.', 'warning');
        }
    }
};
