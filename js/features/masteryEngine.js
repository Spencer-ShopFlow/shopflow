// ============================================
// MASTERY ENGINE — plan row 3-06, the amended grading spec
// (§3 config, §4 weighted average, §5 recompute from history, §6 opportunity set,
//  Amendments 4 and 5: two category averages and the two flags)
//
// CALCULATE AND EXPORT ONLY (D6): nothing in this file writes to the database. Scores are
// rebuilt from skillObservations every time; skillLevels is neither read for grades nor written.
// Ids are compared as text, so a record from the other device matches whatever its id type.
// Removed ratings (deletedAt) are skipped. Retired and merged-away skills are skipped.
// The conclusion-question conversion (§7, spec tests 10–11) is row 5-13, not here.
// ============================================

const MASTERY_DEFAULTS = {
    levelValues: { beginning: 50, developing: 70, proficient: 85, advanced: 100 },
    weights: { up: 0.65, down: 0.40 },
    unassessedPolicy: 'countAsBeginning',   // §6: opportunity with no evidence counts as Beginning
    mcq: { minQuestions: 2, levelCap: 'proficient' },   // §7, for 5-13
    professionalCategories: ['Professional'],           // Amendment 4: the rest are technical
    minProfessionalSkills: 4,                           // Amendment 5b
    // Amendment 6 (3-05) slots in here: skills that are in every class's opportunity set all year
    alwaysOpenSkillIds: []
};

const masteryEngine = {
    LEVEL_KEYS: { Beginning: 'beginning', Developing: 'developing', Proficient: 'proficient', Advanced: 'advanced' },
    LEVEL_NAMES: { beginning: 'Beginning', developing: 'Developing', proficient: 'Proficient', advanced: 'Advanced' },

    // ── §3: per-class config. Stored as the setting mastery-config-{classId}; anything missing
    //    takes the spec's default. Nothing is hardcoded outside MASTERY_DEFAULTS. ──
    mergeConfig: function(value) {
        const v = (value && typeof value === 'object') ? value : {};
        const pick = (obj, key) => (obj && typeof obj[key] === 'object' && obj[key] !== null ? obj[key] : {});
        return {
            ...MASTERY_DEFAULTS, ...v,
            levelValues: { ...MASTERY_DEFAULTS.levelValues, ...pick(v, 'levelValues') },
            weights: { ...MASTERY_DEFAULTS.weights, ...pick(v, 'weights') },
            mcq: { ...MASTERY_DEFAULTS.mcq, ...pick(v, 'mcq') },
            professionalCategories: Array.isArray(v.professionalCategories) ? v.professionalCategories : MASTERY_DEFAULTS.professionalCategories,
            alwaysOpenSkillIds: Array.isArray(v.alwaysOpenSkillIds) ? v.alwaysOpenSkillIds : MASTERY_DEFAULTS.alwaysOpenSkillIds
        };
    },

    configFor: async function(classId) {
        const row = await db.settings.get('mastery-config-' + classId);
        return this.mergeConfig(row && row.value);
    },

    // ── §4: one observation applied to the running score ──
    valueOf: function(rating, cfg) {
        const key = this.LEVEL_KEYS[rating];
        return key ? cfg.levelValues[key] : null;
    },

    clamp: function(x, cfg) {
        return Math.min(cfg.levelValues.advanced, Math.max(cfg.levelValues.beginning, x));
    },

    // The time an observation counts from: observedAt (a back-dated correction), else createdAt
    observedTime: function(o) { return String(o.observedAt || o.createdAt || o.updatedAt || ''); },

    // §5 ordering: by observedAt, ties by createdAt (then id, so the order is always the same)
    ordered: function(observations) {
        return observations
            .filter(o => o && !o.deletedAt && this.LEVEL_KEYS[o.rating])
            .slice()
            .sort((a, b) => this.observedTime(a).localeCompare(this.observedTime(b))
                || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
                || String(a.id ?? '').localeCompare(String(b.id ?? ''), undefined, { numeric: true }));
    },

    // §5: replay one student's observations on one skill from nothing. Full precision throughout;
    // `score` is rounded to one decimal for storage and display, `raw` is what averages use.
    // mode 'current-best' keeps the highest value instead (the class's other skills mode).
    scoreHistory: function(observations, cfg, mode) {
        const steps = [];
        let raw = null;
        for (const o of this.ordered(observations)) {
            const value = this.valueOf(o.rating, cfg);
            let direction;
            if (raw === null) { raw = value; direction = 'first'; }
            else if (mode === 'current-best') { direction = value > raw ? 'up' : 'kept'; raw = Math.max(raw, value); }
            else {
                const w = value >= raw ? cfg.weights.up : cfg.weights.down;
                direction = value >= raw ? 'up' : 'down';
                raw = (w * value) + ((1 - w) * raw);
            }
            raw = this.clamp(raw, cfg);
            steps.push({ id: o.id, at: this.observedTime(o), rating: o.rating, value, direction, score: this.round1(raw) });
        }
        return { raw, score: raw === null ? null : this.round1(raw), level: raw === null ? null : this.levelFor(raw, cfg), steps };
    },

    round1: function(x) { return Math.round(x * 10) / 10; },
    round2: function(x) { return Math.round(x * 100) / 100; },

    // The level a score shows as: the nearest level value (ties go up), so 80.3 is Proficient (§10)
    levelFor: function(score, cfg) {
        let best = null;
        for (const key of ['beginning', 'developing', 'proficient', 'advanced']) {
            const d = Math.abs(score - cfg.levelValues[key]);
            if (best === null || d <= best.d) best = { key, d };
        }
        return this.LEVEL_NAMES[best.key];
    },

    isProfessional: function(skill, cfg) {
        return !!skill && cfg.professionalCategories.includes(skill.category);
    },

    // ── §6: the skills an activity or checkpoint puts in the opportunity set ──
    // A skill enters for the whole class when an activity listing it (skillsAssessed, or a live
    // activity link) passes its due date (endDate), or a checkpoint listing it (skillsAssessable)
    // passes its own date (suggestedDate, else the activity's endDate). "Passes" = before today.
    activitySkillIds: function(snap, activity) {
        const ids = new Set();
        for (const e of (Array.isArray(activity.skillsAssessed) ? activity.skillsAssessed : [])) if (e && e.skillId != null) ids.add(String(e.skillId));
        for (const l of snap.activitySkills) if (!l.deletedAt && String(l.activityId) === String(activity.id)) ids.add(String(l.skillId));
        return ids;
    },

    // compute(snap, classId, { today, config, mode, overrides }) — pure: the same snapshot gives the
    // same result. snap: { skills, skillObservations, activities, activitySkills, checkpoints,
    // studentIds (the class's students) }. overrides (setting mastery-opportunity-{classId}):
    // { open: [skillIds], closed: [skillIds], students: { [studentId]: { open: [], closed: [] } } }.
    compute: function(snap, classId, opts) {
        const cfg = opts.config || this.mergeConfig(null);
        const mode = opts.mode || 'weighted-average';
        const today = opts.today;
        const ov = opts.overrides || {};
        const S = x => String(x);
        if (mode !== 'weighted-average' && mode !== 'current-best') {
            return { classId, mode: 'off', off: true, config: cfg, today, opportunity: [], students: [], flags: { professionalFloor: null, missingProfessional: [] } };
        }

        const skillById = new Map(snap.skills.filter(s => !isSkillHidden(s)).map(s => [S(s.id), s]));
        const activities = snap.activities.filter(a => !a.deletedAt && S(a.classId) === S(classId));
        const due = date => !!date && String(date) < today;

        // The class's opportunity set
        const classOpen = new Set();
        const dueActivities = [];
        for (const a of activities) {
            if (due(a.endDate)) {
                dueActivities.push(a);
                for (const id of this.activitySkillIds(snap, a)) classOpen.add(id);
            }
        }
        const actById = new Map(activities.map(a => [S(a.id), a]));
        for (const c of snap.checkpoints) {
            const a = actById.get(S(c.activityId));
            if (!a || c.deletedAt) continue;
            if (due(c.suggestedDate || a.endDate)) for (const id of (c.skillsAssessable || [])) classOpen.add(S(id));
        }
        for (const id of cfg.alwaysOpenSkillIds) classOpen.add(S(id));
        for (const id of (ov.open || [])) classOpen.add(S(id));
        for (const id of (ov.closed || [])) classOpen.delete(S(id));
        for (const id of [...classOpen]) if (!skillById.has(id)) classOpen.delete(id);   // hidden or unknown

        // Each student's observations, by skill (live ratings on live skills only)
        const students = snap.studentIds.map(S);
        const inClass = new Set(students);
        const obsBy = new Map();   // "student|skill" → observations
        for (const o of snap.skillObservations) {
            if (o.deletedAt || !inClass.has(S(o.studentId)) || !skillById.has(S(o.skillId))) continue;
            const k = S(o.studentId) + '|' + S(o.skillId);
            if (!obsBy.has(k)) obsBy.set(k, []);
            obsBy.get(k).push(o);
        }

        const out = [];
        for (const sid of students) {
            const so = (ov.students && ov.students[sid]) || {};
            const closed = new Set([...(ov.closed || []), ...(so.closed || [])].map(S));
            const set = new Set(classOpen);
            for (const id of (so.open || [])) if (skillById.has(S(id))) set.add(S(id));
            for (const [k] of obsBy) { const [st, sk] = k.split('|'); if (st === sid) set.add(sk); }   // assessed skills count (§6)
            for (const id of closed) set.delete(id);
            const cats = { technical: [], professional: [] };
            for (const skillId of [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
                const skill = skillById.get(skillId);
                const h = this.scoreHistory(obsBy.get(sid + '|' + skillId) || [], cfg, mode);
                let raw = h.raw, assessed = true;
                if (raw === null) {
                    assessed = false;
                    if (cfg.unassessedPolicy !== 'countAsBeginning') continue;   // any other policy: left out
                    raw = cfg.levelValues.beginning;
                }
                cats[this.isProfessional(skill, cfg) ? 'professional' : 'technical'].push({
                    skillId, name: skill.name, raw, score: this.round1(raw), level: this.levelFor(raw, cfg), assessed, steps: h.steps
                });
            }
            const mean = list => list.length ? list.reduce((s, x) => s + x.raw, 0) / list.length : null;
            const cat = list => { const m = mean(list); return { mean: m, grade: m === null ? null : this.round2(m), count: list.length, skills: list }; };
            out.push({ studentId: sid, technical: cat(cats.technical), professional: cat(cats.professional) });
        }

        // Amendment 5b: fewer than the minimum professional skills in the class's opportunity set
        const profOpen = [...classOpen].filter(id => this.isProfessional(skillById.get(id), cfg));
        const professionalFloor = { count: profOpen.length, min: cfg.minProfessionalSkills, flagged: profOpen.length < cfg.minProfessionalSkills };

        // Amendment 5c: a due activity with a professional skill that a student has no rating for on it
        const missingProfessional = [];
        for (const a of dueActivities.slice().sort((x, y) => S(x.id).localeCompare(S(y.id), undefined, { numeric: true }))) {
            for (const skillId of this.activitySkillIds(snap, a)) {
                const skill = skillById.get(skillId);
                if (!this.isProfessional(skill, cfg)) continue;
                const missing = [];
                for (const sid of students) {
                    const so = (ov.students && ov.students[sid]) || {};
                    if ((ov.closed || []).map(S).includes(skillId) || (so.closed || []).map(S).includes(skillId)) continue;
                    const rated = (obsBy.get(sid + '|' + skillId) || []).some(o => S(o.activityId) === S(a.id));
                    if (!rated) missing.push(sid);
                }
                if (missing.length) missingProfessional.push({ activityId: S(a.id), skillId, missing: missing.length, studentIds: missing });
            }
        }

        return { classId: S(classId), mode, config: cfg, today, opportunity: [...classOpen], students: out, flags: { professionalFloor, missingProfessional } };
    },

    // ── Reading the database (still writes nothing) ──
    // The class's students: active and not deleted, enrolled this school year in a period mapped
    // to the class; if the class has no mapped periods, the students whose classId is the class.
    classStudentIds: async function(classId) {
        const S = x => String(x);
        const activeYear = await getActiveSchoolYear();
        const mapRow = await db.settings.get('period-year-map');
        const map = (mapRow && mapRow.value) || {};
        const periods = Object.entries(map).filter(([, c]) => S(c) === S(classId)).map(([p]) => S(p));
        const students = (await db.students.toArray()).filter(s => !s.deletedAt && (s.status || 'active') !== 'archived');
        if (!periods.length) return students.filter(s => S(s.classId) === S(classId)).map(s => s.id);
        const enrolled = new Set((await db.enrollments.toArray())
            .filter(e => !e.deletedAt && periods.includes(S(e.period)) && (!e.schoolYear || e.schoolYear === activeYear))
            .map(e => S(e.studentId)));
        return students.filter(s => enrolled.has(S(s.id))).map(s => s.id);
    },

    snapshot: async function(classId) {
        return {
            skills: await db.skills.toArray(),
            skillObservations: await db.skillObservations.toArray(),
            activities: await db.activities.toArray(),
            activitySkills: await db.activitySkills.toArray(),
            checkpoints: await db.checkpoints.toArray(),
            studentIds: await this.classStudentIds(classId)
        };
    },

    overridesFor: async function(classId) {
        const row = await db.settings.get('mastery-opportunity-' + classId);
        return (row && row.value && typeof row.value === 'object') ? row.value : {};
    },

    // §5: the whole class, rebuilt from history (spec name). Returns compute()'s result.
    recomputeAll: async function(classId, today) {
        const [snap, config, mode, overrides] = await Promise.all([
            this.snapshot(classId), this.configFor(classId), getClassMasteryMode(classId), this.overridesFor(classId)
        ]);
        return this.compute(snap, classId, { today: today || getTodayString(), config, mode, overrides });
    },

    // §5: one student's score on one skill, rebuilt from history (spec name). Uses the class's config.
    recomputeSkillScore: async function(studentId, skillId, classId) {
        const [config, mode] = await Promise.all([this.configFor(classId), getClassMasteryMode(classId)]);
        const obs = (await db.skillObservations.toArray()).filter(o => String(o.studentId) === String(studentId) && String(o.skillId) === String(skillId));
        return this.scoreHistory(obs, config, mode === 'current-best' ? 'current-best' : 'weighted-average');
    }
};
