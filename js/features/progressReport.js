// ============================================
// PROGRESS REPORT — item i334: a printable progress page for one student
// Built and printed inside the app (window.print with the print stylesheet in css/pages.css), so the
// student's name never leaves this device. READ-ONLY: nothing in this file writes to the database.
// The teacher's one-line comment lives only in the text box on screen; it is not stored anywhere.
//  - Each rated skill: its current level (the grading engine's level for that skill, from the same
//    replay of the ratings the marks use) and the trend, oldest rating first, with dates.
//  - The two category marks: masteryEngine.recomputeAll(classId), the call the Progressbook export
//    makes, and that export's own mark() rounding, so the printout and the CSVs can't disagree.
//  - The three lowest rated skills (lowest engine score first; ties by skill name A-Z, then skill id),
//    each with what the next level needs: that level's descriptor for the skill, found by skill id in
//    an assignment's skillsAssessed (this class's newest assignment first). No descriptor: a fixed line.
// ============================================

const progressReport = {
    LEVELS: ['Beginning', 'Developing', 'Proficient', 'Advanced'],
    FALLBACK: 'No description of this level is written for this skill yet. Ask your teacher what it looks like.',
    TOP: 'Already at Advanced, the top level. Keep showing it.',
    _state: null,   // { studentId, options: [{ classId, name }], classId }

    // "2026-10-02" or an ISO time → "Oct 2" (local time)
    shortDate: function(at) {
        const s = String(at || '');
        if (!s) return '';
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },

    // One line, at most 200 characters
    cleanComment: function(text) {
        return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, 200);
    },

    // The descriptor for `level` on this skill: by skill id, in this class's assignments first,
    // newest due date first (then highest id); '' when none has one.
    descriptorFor: function(activities, skillId, level, classId) {
        const S = x => String(x);
        const want = String(level).toLowerCase();
        const list = (activities || []).filter(a => a && !a.deletedAt && Array.isArray(a.skillsAssessed)).slice().sort((a, b) =>
            ((S(b.classId) === S(classId)) - (S(a.classId) === S(classId)))
            || String(b.endDate || '').localeCompare(String(a.endDate || ''))
            || S(b.id).localeCompare(S(a.id), undefined, { numeric: true }));
        for (const a of list) {
            for (const sa of a.skillsAssessed) {
                if (!sa || sa.skillId == null || S(sa.skillId) !== S(skillId) || !sa.levels || typeof sa.levels !== 'object') continue;
                const key = Object.keys(sa.levels).find(k => String(k).trim().toLowerCase() === want);
                const text = key ? String(sa.levels[key] || '').trim() : '';
                if (text) return text;
            }
        }
        return '';
    },

    // Pure: the report for one student. d: { student, classId, className, skills, observations,
    // activities, result (the engine's compute() result for the class, or null when the class isn't
    // graded by skills), config, mode, today, comment }.
    build: function(d) {
        const S = x => String(x);
        const cfg = (d.result && d.result.config) || d.config || masteryEngine.mergeConfig(null);
        const histMode = (d.result ? d.result.mode : d.mode) === 'current-best' ? 'current-best' : 'weighted-average';
        const sid = S(d.student.id);
        const obsBy = new Map();
        for (const o of d.observations || []) {
            if (!o || o.deletedAt || S(o.studentId) !== sid) continue;
            if (!obsBy.has(S(o.skillId))) obsBy.set(S(o.skillId), []);
            obsBy.get(S(o.skillId)).push(o);
        }
        const skills = [];
        for (const sk of (d.skills || []).filter(s => !isSkillHidden(s))) {
            const h = masteryEngine.scoreHistory(obsBy.get(S(sk.id)) || [], cfg, histMode);
            if (h.raw === null) continue;   // not rated
            const trend = h.steps.map(st => ({ rating: st.rating, date: this.shortDate(st.at) }));
            skills.push({
                skillId: S(sk.id), name: sk.name || '', category: masteryEngine.isProfessional(sk, cfg) ? 'professional' : 'technical',
                raw: h.raw, score: h.score, level: h.level, trend,
                trendText: trend.map(t => t.date ? `${t.rating} (${t.date})` : t.rating).join(' → ')
            });
        }
        const byName = (a, b) => a.name.localeCompare(b.name) || a.skillId.localeCompare(b.skillId, undefined, { numeric: true });
        skills.sort(byName);

        const st = d.result && d.result.students.find(x => S(x.studentId) === sid);
        const mark = cat => (st && st[cat].grade != null ? progressbookExport.mark(st[cat].grade) : '');
        const marks = {
            graded: !!d.result,
            technical: { label: progressbookExport.CATEGORIES.technical.label, mark: mark('technical') },
            professional: { label: progressbookExport.CATEGORIES.professional.label, mark: mark('professional') }
        };

        const lowest = skills.slice().sort((a, b) => a.raw - b.raw || byName(a, b)).slice(0, 3).map(s => {
            const i = this.LEVELS.indexOf(s.level);
            const next = i >= 0 && i < this.LEVELS.length - 1 ? this.LEVELS[i + 1] : null;
            if (!next) return { skillId: s.skillId, name: s.name, level: s.level, next: null, text: this.TOP, fromDescriptor: false };
            const desc = this.descriptorFor(d.activities, s.skillId, next, d.classId);
            return { skillId: s.skillId, name: s.name, level: s.level, next, text: desc || this.FALLBACK, fromDescriptor: !!desc };
        });

        return {
            studentId: sid,
            name: typeof displayName === 'function' ? displayName(d.student) : `${d.student.firstName || ''} ${d.student.lastName || ''}`.trim(),
            className: d.className || '',
            today: d.today || '',
            technical: skills.filter(s => s.category === 'technical'),
            professional: skills.filter(s => s.category === 'professional'),
            marks, lowest,
            comment: this.cleanComment(d.comment)
        };
    },

    // Pure: the printable sheet
    html: function(r) {
        const E = escapeHtml;
        const date = r.today ? this.shortDate(r.today) + ', ' + String(r.today).slice(0, 4) : '';
        const markCell = m => (m.mark ? E(m.mark) : '—');
        const skillRows = list => list.map(s => `<tr class="progress-report__skill" data-skill-id="${E(s.skillId)}">
                <td>${E(s.name)}</td><td class="progress-report__level">${E(s.level)}</td><td class="progress-report__trend">${E(s.trendText)}</td></tr>`).join('');
        const section = (title, list) => `<h3 class="progress-report__h3">${E(title)}</h3>${list.length
            ? `<table class="progress-report__table"><thead><tr><th>Skill</th><th>Current level</th><th>Ratings so far (oldest first)</th></tr></thead><tbody>${skillRows(list)}</tbody></table>`
            : '<p class="progress-report__none">No skills rated yet.</p>'}`;
        return `<header class="progress-report__head">
                <h2 class="progress-report__name">${E(r.name)}</h2>
                <div class="progress-report__meta">Progress report${r.className ? ' · ' + E(r.className) : ''}${date ? ' · ' + E(date) : ''}</div>
            </header>
            <section class="progress-report__marks" aria-label="Category marks">
                <div class="progress-report__mark" id="progress-report-mark-technical"><span>${E(r.marks.technical.label)}</span><strong>${markCell(r.marks.technical)}</strong></div>
                <div class="progress-report__mark" id="progress-report-mark-professional"><span>${E(r.marks.professional.label)}</span><strong>${markCell(r.marks.professional)}</strong></div>
            </section>
            ${r.marks.graded ? '' : '<p class="progress-report__none">This class is not graded by skills, so there are no category marks.</p>'}
            ${section(r.marks.technical.label, r.technical)}
            ${section(r.marks.professional.label, r.professional)}
            <h3 class="progress-report__h3">Next steps</h3>
            ${r.lowest.length ? `<ol class="progress-report__next">${r.lowest.map(x => `<li class="progress-report__next-item" data-skill-id="${E(x.skillId)}"><strong>${E(x.name)}</strong> (now ${E(x.level)})${x.next ? `, to reach ${E(x.next)}` : ''}: ${E(x.text)}</li>`).join('')}</ol>`
                : '<p class="progress-report__none">No skills rated yet.</p>'}
            <div class="progress-report__comment${r.comment ? '' : ' hidden'}" id="progress-report-comment-block"><strong>Teacher comment:</strong> <span id="progress-report-comment-text">${E(r.comment)}</span></div>`;
    },

    // ── Reading the database (toArray/get only; writes nothing) ──
    // The classes the student is in (masteryEngine.classStudentIds, as the grades use), skills-graded first.
    classOptions: async function(student) {
        const S = x => String(x);
        const classes = (await db.classes.toArray()).filter(c => !c.deletedAt);
        const out = [];
        for (const c of classes) {
            const ids = (await masteryEngine.classStudentIds(c.id)).map(S);
            if (!ids.includes(S(student.id))) continue;
            out.push({ classId: c.id, name: c.name || 'Class', graded: isSkillsGradedMode(await getClassMasteryMode(c.id)) });
        }
        if (!out.length && student.classId != null) {
            const c = classes.find(x => S(x.id) === S(student.classId));
            if (c) out.push({ classId: c.id, name: c.name || 'Class', graded: isSkillsGradedMode(await getClassMasteryMode(c.id)) });
        }
        return out.sort((a, b) => (b.graded - a.graded) || String(a.name).localeCompare(String(b.name)));
    },

    gather: async function(studentId, classId, comment) {
        const student = await db.students.get(studentId);
        if (!student) return null;
        const cls = classId != null ? await db.classes.get(classId) : null;
        const mode = classId != null ? await getClassMasteryMode(classId) : 'off';
        const result = classId != null && isSkillsGradedMode(mode) ? await masteryEngine.recomputeAll(classId) : null;
        const [skills, observations, activities, config] = await Promise.all([
            db.skills.toArray(), db.skillObservations.toArray(), db.activities.toArray(),
            classId != null ? masteryEngine.configFor(classId) : masteryEngine.mergeConfig(null)
        ]);
        return this.build({ student, classId, className: cls ? cls.name : '', skills, observations, activities, result, config, mode, today: getTodayString(), comment });
    },

    // ── The screen (inside #app, so the PIN lock hides it with the rest of the app) ──
    open: async function(studentId) {
        try {
            const student = await db.students.get(studentId);
            if (!student) { ui.showToast('Student not found.', 'error'); return; }
            const options = await this.classOptions(student);
            this._state = { studentId, options, classId: options.length ? options[0].classId : null };
            let el = document.getElementById('progress-report-screen');
            if (!el) {
                el = document.createElement('div');
                el.id = 'progress-report-screen';
                el.className = 'progress-report-screen';
                el.setAttribute('role', 'dialog');
                el.setAttribute('aria-modal', 'true');
                el.setAttribute('aria-label', 'Progress report');
                (document.getElementById('app') || document.body).appendChild(el);
            }
            el.innerHTML = `<div class="progress-report__toolbar">
                    <div class="progress-report__toolbar-row">
                        <strong>Progress report</strong>
                        ${options.length > 1 ? `<label>Class <select id="progress-report-class" onchange="progressReport.changeClass(this.value)">${options.map((o, i) => `<option value="${i}">${escapeHtml(o.name)}</option>`).join('')}</select></label>` : ''}
                        <span style="flex: 1;"></span>
                        <button type="button" class="btn btn--primary" id="progress-report-print" onclick="progressReport.print()">🖨️ Print</button>
                        <button type="button" class="btn btn--secondary" id="progress-report-close" onclick="progressReport.close()">Close</button>
                    </div>
                    <label class="progress-report__comment-label" for="progress-report-comment">Comment for this printout (optional, one line, not saved)</label>
                    <input type="text" id="progress-report-comment" class="form-input" maxlength="200" autocomplete="off" oninput="progressReport.setComment(this.value)">
                    <p class="form-helper" style="margin: 4px 0 0;">Nothing here is saved or changed. Students will see this page.</p>
                </div>
                <div class="progress-report__sheet" id="progress-report-sheet"></div>`;
            document.body.classList.add('progress-report-open');
            await this.renderSheet();
        } catch (err) {
            console.error('Progress report failed', err);
            ui.showToast('Failed to build the progress report', 'error');
        }
    },

    renderSheet: async function() {
        const st = this._state;
        const sheet = document.getElementById('progress-report-sheet');
        if (!st || !sheet) return;
        const input = document.getElementById('progress-report-comment');
        const r = await this.gather(st.studentId, st.classId, input ? input.value : '');
        sheet.innerHTML = r ? this.html(r) : '<p>Student not found.</p>';
    },

    changeClass: async function(i) {
        const o = this._state && this._state.options[Number(i)];
        if (!o) return;
        this._state.classId = o.classId;
        await this.renderSheet();
    },

    setComment: function(text) {
        const c = this.cleanComment(text);
        const span = document.getElementById('progress-report-comment-text');
        const block = document.getElementById('progress-report-comment-block');
        if (span) span.textContent = c;
        if (block) block.classList.toggle('hidden', !c);
    },

    print: function() { window.print(); },

    close: function() {
        const el = document.getElementById('progress-report-screen');
        if (el) el.remove();   // the comment goes with it
        document.body.classList.remove('progress-report-open');
        this._state = null;
    }
};
