// ============================================
// PROGRESSBOOK EXPORTS — plan row 3-08 (spec Amendments 1 and 4)
// Two CSVs per class: Engineering Skills (technical) and Professional Practice. Each has exactly
// four columns: Student Number (no leading zeros), First Name, Last Name, Mark. Progressbook applies
// the 70/30 weighting. The marks come from the mastery engine (3-06), which writes nothing; this file
// writes nothing either: it shows a preview, then downloads the file she picks.
// A student with no Progressbook number (3-04), or no grade yet in that category, is left out of that
// file and listed in the preview. Every cell goes through csvCell (a name starting with = is text).
// q10 (grade-gap finder): before either file is saved, the preview lists what would make the export
// wrong or incomplete, using the export's own rows and the engine's own result. It reads only.
// ============================================

const progressbookExport = {
    CATEGORIES: {
        technical: { label: 'Engineering Skills', file: 'Engineering_Skills' },
        professional: { label: 'Professional Practice', file: 'Professional_Practice' }
    },
    _last: null,   // { classId, className, result, rows, gaps }

    // "00123" → "123" (Amendment 1: no leading zeros); '' when there's no number
    studentNumber: function(raw) {
        const s = String(raw == null ? '' : raw).replace(/\s+/g, '');
        if (!/^\d+$/.test(s)) return '';
        return s.replace(/^0+(?=\d)/, '');
    },

    // Two decimals, no trailing zeros ("72.75", "50", "54.6")
    mark: function(grade) {
        return grade == null ? '' : String(Math.round(grade * 100) / 100);
    },

    // Pure: one row per class student, sorted by last name, from the engine's result
    rowsFor: function(result, studentsById) {
        return result.students.map(st => {
            const s = studentsById.get(String(st.studentId)) || {};
            return {
                studentId: String(st.studentId),
                first: s.firstName || '', last: s.lastName || '',
                name: typeof displayName === 'function' ? displayName(s) : `${s.firstName || ''} ${s.lastName || ''}`.trim(),
                number: this.studentNumber(s.progressbookId),
                technical: st.technical.grade, professional: st.professional.grade
            };
        }).sort((a, b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
    },

    // Pure: the CSV text for one category
    buildCsv: function(rows, category) {
        let out = csvRow(['Student Number', 'First Name', 'Last Name', 'Mark']);
        for (const r of rows) {
            if (!r.number || r[category] == null) continue;
            out += csvRow([r.number, r.first, r.last, this.mark(r[category])]);
        }
        return out;
    },

    open: async function(classId) {
        try {
            const cls = await db.classes.get(classId);
            const mode = await getClassMasteryMode(classId);
            if (!isSkillsGradedMode(mode)) {
                ui.showToast('Skills grading is off for this class, so it has no skills grades to export.', 'info');
                return;
            }
            const result = await masteryEngine.recomputeAll(classId);
            const students = await db.students.toArray();
            const byId = new Map(students.map(s => [String(s.id), s]));
            const rows = this.rowsFor(result, byId);
            this._last = { classId, className: cls ? cls.name : 'Class', result, rows, gaps: null };
            try { this._last.gaps = await this.findGaps(classId, result, rows); }
            catch (gapErr) { console.error('Progressbook export: gap check failed', gapErr); }
            await this.render();
            ui.showModal('modal-progressbook-export');
        } catch (err) {
            console.error('Progressbook export: preview failed', err);
            ui.showToast('Failed to build the Progressbook preview', 'error');
        }
    },

    close: function() {
        ui.hideModal('modal-progressbook-export');
    },

    render: async function() {
        const L = this._last;
        const body = document.getElementById('progressbook-export-body');
        if (!L || !body) return;
        const f = L.result.flags;
        const skills = await db.skills.toArray();
        const skillName = new Map(skills.map(s => [String(s.id), s.name]));
        const acts = await db.activities.toArray();
        const actName = new Map(acts.map(a => [String(a.id), a.name]));
        const noNumber = L.rows.filter(r => !r.number).length;
        const counted = cat => L.rows.filter(r => r.number && r[cat] != null).length;
        const flagLines = [];
        if (f.professionalFloor && f.professionalFloor.flagged) {
            flagLines.push(`Only ${f.professionalFloor.count} professional skill(s) are open for this class (at least ${f.professionalFloor.min} expected), so each professional rating moves the grade a lot.`);
        }
        for (const m of f.missingProfessional) {
            flagLines.push(`${escapeHtml(actName.get(m.activityId) || 'Activity ' + m.activityId)}: ${m.missing} student(s) have no rating for ${escapeHtml(skillName.get(m.skillId) || 'skill ' + m.skillId)}.`);
        }
        const fmt = g => (g == null ? '<span style="color: var(--color-text-tertiary);">—</span>' : escapeHtml(this.mark(g)));
        body.innerHTML = `
            <p style="margin-bottom: var(--space-xs);"><strong>${escapeHtml(L.className)}</strong> · worked out ${escapeHtml(L.result.today)} · ${L.rows.length} student(s)</p>
            <p class="form-helper" style="margin-bottom: var(--space-sm);">Nothing is saved or changed. Each file has Student Number, First Name, Last Name and Mark. In Progressbook, import each into its own assignment with "Override existing marks" = Yes. Tap ▸ beside a name to see how that student's marks are worked out.</p>
            ${flagLines.length ? `<div id="progressbook-export-flags" style="border: 1px solid var(--color-warning); border-radius: var(--radius-md); padding: var(--space-sm); margin-bottom: var(--space-sm); font-size: var(--font-size-body-small);"><strong>Check before exporting:</strong><ul style="margin: 4px 0 0; padding-left: 1.2em;">${flagLines.map(x => `<li>${x}</li>`).join('')}</ul></div>` : ''}
            ${this.gapsHtml(L)}
            ${noNumber ? `<p id="progressbook-export-missing" style="color: var(--color-error); font-size: var(--font-size-body-small); margin-bottom: var(--space-sm);">${noNumber} student(s) have no Progressbook number and are left out of both files. Add them on the Students page (🔢 Progressbook numbers).</p>` : ''}
            <div style="max-height: 45vh; overflow-y: auto;">
            <table class="data-check-table" style="width: 100%; border-collapse: collapse; font-size: var(--font-size-body-small);">
                <thead><tr style="text-align: left; border-bottom: 1px solid var(--color-border);">
                    <th style="padding: 4px 6px;">Student</th><th style="padding: 4px 6px;">Number</th>
                    <th style="padding: 4px 6px; text-align: right;">${this.CATEGORIES.technical.label}</th>
                    <th style="padding: 4px 6px; text-align: right;">${this.CATEGORIES.professional.label}</th>
                </tr></thead>
                <tbody>${L.rows.map((r, i) => `<tr class="progressbook-export-row" style="border-bottom: 1px solid var(--color-border);">
                    <td style="padding: 4px 6px;"><button type="button" class="progressbook-workings-toggle" id="progressbook-workings-toggle-${i}" aria-expanded="false" aria-controls="progressbook-workings-${i}" title="Show workings" onclick="progressbookExport.toggleWorkings(${i})" style="background: none; border: none; padding: 0 4px 0 0; cursor: pointer; color: inherit; font-size: inherit;">▸</button>${escapeHtml(r.name)}</td>
                    <td style="padding: 4px 6px;">${r.number ? escapeHtml(r.number) : '<span style="color: var(--color-error);">none: left out</span>'}</td>
                    <td style="padding: 4px 6px; text-align: right;">${fmt(r.technical)}</td>
                    <td style="padding: 4px 6px; text-align: right;">${fmt(r.professional)}</td>
                </tr>
                <tr class="progressbook-export-workings" id="progressbook-workings-${i}" hidden>
                    <td colspan="4" style="padding: 4px 6px 8px 22px; background: var(--color-background-secondary);">${this.workingsHtml(this.workingsFor(r.studentId))}</td>
                </tr>`).join('')}</tbody>
            </table></div>
            <div style="display: flex; gap: var(--space-sm); flex-wrap: wrap; margin-top: var(--space-sm);">
                <button type="button" class="btn btn--primary" onclick="progressbookExport.download('technical')">📥 ${this.CATEGORIES.technical.label} CSV (${counted('technical')})</button>
                <button type="button" class="btn btn--primary" onclick="progressbookExport.download('professional')">📥 ${this.CATEGORIES.professional.label} CSV (${counted('professional')})</button>
            </div>`;
    },

    // ── q10: the grade-gap finder. Reads only; the CSV code above is unchanged. ──
    // Pure: what would make this class's export wrong or incomplete. `result` and `rows` are the
    // ones the CSVs are built from, so the finder and the files can't disagree:
    //  number     a class student with no Progressbook number (buildCsv leaves them out)
    //  unrated    an open skill a student has no rating on (the engine counts it as Beginning)
    //  checkpoint a completed checkpoint with skills to rate and no rating on it from that student
    //  ungraded   submitted work not yet graded (status 'submitted', as the "Grade:" task counts it)
    // d: { activities, checkpoints, completions, observations, submissions, teams, teamMembers, skills }
    gapsFor: function(classId, result, rows, d) {
        const S = x => String(x);
        const byName = (a, b) => String(a).localeCompare(String(b));
        const inClass = new Set(result.students.map(st => S(st.studentId)));
        const skillById = new Map(d.skills.filter(s => !isSkillHidden(s)).map(s => [S(s.id), s]));
        const acts = d.activities.filter(a => !a.deletedAt && S(a.classId) === S(classId));
        const actById = new Map(acts.map(a => [S(a.id), a]));
        const today = result.today;
        const due = date => !!date && String(date) < today;
        const lines = [];

        // 1. No Progressbook number: the rows buildCsv skips
        const noNumber = rows.filter(r => !r.number);
        for (const r of noNumber) {
            lines.push({ kind: 'number', count: 1, text: `${r.name}: no Progressbook number, so left out of both files.`, open: { screen: 'student', studentId: r.studentId } });
        }

        // 2. Open skills with no rating: the engine's "not rated" lines, one line per skill
        const unrated = new Map();   // skillId → { name, category, n }
        let unratedCount = 0;
        for (const st of result.students) {
            for (const [cat, label] of [['technical', 'Engineering'], ['professional', 'Professional']]) {
                for (const sk of st[cat].skills) {
                    if (sk.assessed) continue;
                    unratedCount++;
                    if (!unrated.has(sk.skillId)) unrated.set(sk.skillId, { name: sk.name, category: label, n: 0 });
                    unrated.get(sk.skillId).n++;
                }
            }
        }
        // Where she rates it: the due assignment that lists it, else the due checkpoint's assignment
        const listing = skillId => {
            const direct = acts.filter(a => due(a.endDate) && masteryEngine.activitySkillIds({ activitySkills: d.activitySkills || [] }, a).has(skillId));
            if (direct.length) return direct.sort((x, y) => byName(x.endDate, y.endDate) || byName(x.name, y.name))[0];
            const viaCp = d.checkpoints.filter(c => !c.deletedAt && actById.has(S(c.activityId))
                && due(c.suggestedDate || actById.get(S(c.activityId)).endDate) && (c.skillsAssessable || []).map(S).includes(skillId));
            return viaCp.length ? actById.get(S(viaCp[0].activityId)) : null;
        };
        const beginning = result.config.levelValues.beginning;
        [...unrated.entries()]
            .sort((a, b) => (a[1].category === b[1].category ? 0 : a[1].category === 'Engineering' ? -1 : 1) || byName(a[1].name, b[1].name))
            .forEach(([skillId, u]) => {
                const a = listing(skillId);
                lines.push({
                    kind: 'unrated', count: u.n,
                    text: `${u.name} (${u.category}): ${u.n} student(s) not rated, each counts as ${beginning}.`,
                    open: a ? { screen: 'activity', activityId: a.id, label: a.name } : { screen: 'skills' }
                });
            });

        // 3. Completed checkpoints with no rating on them
        const rated = new Set();   // "student|checkpoint|skill" with a live rating
        for (const o of d.observations) {
            if (o.deletedAt || o.checkpointId == null || !masteryEngine.LEVEL_KEYS[o.rating]) continue;
            rated.add(S(o.studentId) + '|' + S(o.checkpointId) + '|' + S(o.skillId));
        }
        const teams = d.teams.filter(t => !t.deletedAt && S(t.classId) === S(classId)).sort((x, y) => byName(x.name, y.name));
        const teamOf = new Map();   // studentId → team (first by name)
        for (const t of teams) {
            for (const m of d.teamMembers) {
                if (m.deletedAt || S(m.teamId) !== S(t.id)) continue;
                if (!teamOf.has(S(m.studentId))) teamOf.set(S(m.studentId), t);
            }
        }
        const cpById = new Map(d.checkpoints.filter(c => !c.deletedAt && actById.has(S(c.activityId))).map(c => [S(c.id), c]));
        const cpGroups = new Map();   // "checkpoint|team" → { cp, team, n }
        let checkpointCount = 0;
        const seen = new Set();
        for (const c of d.completions) {
            if (c.deletedAt || !c.completed || !inClass.has(S(c.studentId))) continue;
            const cp = cpById.get(S(c.checkpointId));
            if (!cp) continue;
            const skills = (cp.skillsAssessable || []).map(S).filter(id => skillById.has(id));
            if (!skills.length) continue;
            const pair = S(c.studentId) + '|' + S(cp.id);
            if (seen.has(pair)) continue;
            seen.add(pair);
            if (skills.some(id => rated.has(pair + '|' + id))) continue;
            checkpointCount++;
            const team = teamOf.get(S(c.studentId)) || null;
            const k = S(cp.id) + '|' + (team ? S(team.id) : '');
            if (!cpGroups.has(k)) cpGroups.set(k, { cp, team, n: 0 });
            cpGroups.get(k).n++;
        }
        [...cpGroups.values()]
            .sort((x, y) => byName(actById.get(S(x.cp.activityId)).name, actById.get(S(y.cp.activityId)).name)
                || (Number(x.cp.number) || 0) - (Number(y.cp.number) || 0)
                || (x.team ? 0 : 1) - (y.team ? 0 : 1) || byName(x.team ? x.team.name : '', y.team ? y.team.name : ''))
            .forEach(g => {
                const a = actById.get(S(g.cp.activityId));
                lines.push({
                    kind: 'checkpoint', count: g.n,
                    text: `${a.name}, checkpoint ${g.cp.number}${g.cp.title ? ' (' + g.cp.title + ')' : ''}, ${g.team ? g.team.name : 'no group'}: ${g.n} student(s) marked complete with no skill rating.`,
                    open: { screen: 'checkpoint', classId: a.classId, activityId: a.id, teamId: g.team ? g.team.id : null, checkpointId: g.cp.id }
                });
            });

        // 4. Submitted work not graded
        const subsBy = new Map();   // activityId → n
        let ungradedCount = 0;
        for (const sub of d.submissions) {
            if (sub.deletedAt || sub.status !== 'submitted' || !inClass.has(S(sub.studentId)) || !actById.has(S(sub.activityId))) continue;
            ungradedCount++;
            subsBy.set(S(sub.activityId), (subsBy.get(S(sub.activityId)) || 0) + 1);
        }
        [...subsBy.entries()]
            .sort((x, y) => byName(actById.get(x[0]).name, actById.get(y[0]).name))
            .forEach(([actId, n]) => {
                const a = actById.get(actId);
                lines.push({ kind: 'ungraded', count: n, text: `${a.name}: ${n} submitted, not graded yet.`, open: { screen: 'activity', activityId: a.id, label: a.name } });
            });

        return {
            counts: { number: noNumber.length, unrated: unratedCount, checkpoint: checkpointCount, ungraded: ungradedCount },
            lines
        };
    },

    // Reads (toArray only) what gapsFor needs. Writes nothing.
    findGaps: async function(classId, result, rows) {
        const [activities, checkpoints, completions, observations, submissions, teams, teamMembers, skills, activitySkills] = await Promise.all([
            db.activities.toArray(), db.checkpoints.toArray(), db.checkpointCompletions.toArray(), db.skillObservations.toArray(),
            db.submissions.toArray(), db.teams.toArray(), db.teamMembers.toArray(), db.skills.toArray(), db.activitySkills.toArray()
        ]);
        return this.gapsFor(classId, result, rows, { activities, checkpoints, completions, observations, submissions, teams, teamMembers, skills, activitySkills });
    },

    gapsHtml: function(L) {
        const g = L.gaps;
        if (!g) return `<p id="progressbook-gaps" class="form-helper" style="margin-bottom: var(--space-sm);">Couldn't check this class for missing grades. The files below are not affected.</p>`;
        const c = g.counts;
        const total = c.number + c.unrated + c.checkpoint + c.ungraded;
        const summary = `<strong>${escapeHtml(L.className)}:</strong> ${c.number} with no Progressbook number · ${c.unrated} open skill rating(s) missing · ${c.checkpoint} completed checkpoint(s) not rated · ${c.ungraded} submitted, not graded`;
        if (!total) return `<div id="progressbook-gaps" style="margin-bottom: var(--space-sm); font-size: var(--font-size-body-small);"><p id="progressbook-gaps-summary" style="margin: 0;">${summary}</p><p class="form-helper" style="margin: 2px 0 0;">Nothing missing: these files are complete.</p></div>`;
        const where = o => o.screen === 'student' ? 'Open student' : o.screen === 'checkpoint' ? 'Open checkpoint' : o.screen === 'skills' ? 'Open Skills page' : 'Open assignment';
        return `<div id="progressbook-gaps" style="border: 1px solid var(--color-warning); border-radius: var(--radius-md); padding: var(--space-sm); margin-bottom: var(--space-sm); font-size: var(--font-size-body-small);">
                <p style="margin: 0 0 2px;"><strong>Before you export, what's missing:</strong></p>
                <p id="progressbook-gaps-summary" style="margin: 0 0 4px;">${summary}</p>
                <ul id="progressbook-gaps-list" style="margin: 0; padding-left: 1.2em; max-height: 25vh; overflow-y: auto;">${g.lines.map((x, i) => `<li class="progressbook-gap-line" data-kind="${x.kind}" style="margin-bottom: 2px;">${escapeHtml(x.text)} <button type="button" class="btn btn--secondary progressbook-gap-open" id="progressbook-gap-open-${i}" onclick="progressbookExport.openGap(${i})" style="padding: 0 6px; font-size: inherit;">${where(x.open)}</button></li>`).join('')}</ul>
                <p class="form-helper" style="margin: 4px 0 0;">Nothing here changes the files. Fix what you need, then open this preview again.</p>
            </div>`;
    },

    // Opens the screen where line i is fixed. Closes the preview first; changes nothing itself.
    openGap: async function(i) {
        const L = this._last;
        const x = L && L.gaps && L.gaps.lines[i];
        if (!x) return;
        const o = x.open;
        this.close();
        if (o.screen === 'student') {
            const id = (await db.students.toArray()).map(s => s.id).find(id => String(id) === String(o.studentId));
            if (id !== undefined) await modals.showEditStudent(id);
        } else if (o.screen === 'activity') pages.activityDetail.open(o.activityId);
        else if (o.screen === 'checkpoint') await pages.checkpoint.openAt(o.classId, o.activityId, o.teamId, o.checkpointId);
        else router.navigate('skills');
    },

    // Pure: one student's open skills from the engine's result (i192, "show workings").
    // Engineering first, then Professional; each sorted by name. Read-only: uses the preview's result.
    workingsFor: function(studentId) {
        const L = this._last;
        const st = L && L.result.students.find(x => String(x.studentId) === String(studentId));
        if (!st) return [];
        const byName = (a, b) => String(a.name).localeCompare(String(b.name));
        const line = (s, category) => ({ skillId: s.skillId, name: s.name, category, assessed: s.assessed, score: s.score });
        return [
            ...st.technical.skills.slice().sort(byName).map(s => line(s, 'Engineering')),
            ...st.professional.skills.slice().sort(byName).map(s => line(s, 'Professional'))
        ];
    },

    workingsHtml: function(lines) {
        if (!lines.length) return '<span class="progressbook-workings-empty" style="color: var(--color-text-tertiary);">No open skills yet.</span>';
        const beginning = this._last.result.config.levelValues.beginning;
        return `<table class="progressbook-workings-table" style="width: 100%; border-collapse: collapse;">
                        <thead><tr style="text-align: left; color: var(--color-text-secondary);"><th style="padding: 2px 6px; font-weight: normal;">Skill</th><th style="padding: 2px 6px; font-weight: normal;">Category</th><th style="padding: 2px 6px; font-weight: normal; text-align: right;">Score</th></tr></thead>
                        <tbody>${lines.map(x => `<tr class="progressbook-workings-line">
                            <td style="padding: 2px 6px;">${escapeHtml(x.name)}</td>
                            <td style="padding: 2px 6px;">${x.category}</td>
                            <td style="padding: 2px 6px; text-align: right;">${x.assessed ? escapeHtml(String(x.score)) : `<span style="color: var(--color-text-tertiary);">not rated (counts as ${escapeHtml(String(beginning))})</span>`}</td>
                        </tr>`).join('')}</tbody>
                    </table>
                    <p class="form-helper" style="margin: 4px 0 0;">Each mark is the average of that category's scores (worked out before rounding).</p>`;
    },

    toggleWorkings: function(i) {
        const row = document.getElementById('progressbook-workings-' + i);
        const btn = document.getElementById('progressbook-workings-toggle-' + i);
        if (!row || !btn) return;
        const open = row.hidden;
        row.hidden = !open;
        btn.textContent = open ? '▾' : '▸';
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.title = open ? 'Hide workings' : 'Show workings';
    },

    download: function(category) {
        const L = this._last;
        if (!L || !this.CATEGORIES[category]) return;
        const csv = this.buildCsv(L.rows, category);
        const lines = csv.trim().split('\n').length - 1;
        if (!lines) { ui.showToast('No student has both a Progressbook number and a grade in this category. Nothing was downloaded.', 'error'); return; }
        const safeClass = String(L.className).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Class';
        downloadCSV(csv, `Progressbook_${safeClass}_${this.CATEGORIES[category].file}`);
        logAction('export', 'progressbook', L.classId, `${this.CATEGORIES[category].label} CSV: ${lines} row(s)`);
        ui.showToast(`${this.CATEGORIES[category].label}: ${lines} student(s) exported.`, 'success');
    }
};
