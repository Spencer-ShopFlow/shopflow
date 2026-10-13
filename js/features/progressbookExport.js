// ============================================
// PROGRESSBOOK EXPORTS — plan row 3-08 (spec Amendments 1 and 4)
// Two CSVs per class: Engineering Skills (technical) and Professional Practice. Each has exactly
// four columns: Student Number (no leading zeros), First Name, Last Name, Mark. Progressbook applies
// the 70/30 weighting. The marks come from the mastery engine (3-06), which writes nothing; this file
// writes nothing either: it shows a preview, then downloads the file she picks.
// A student with no Progressbook number (3-04), or no grade yet in that category, is left out of that
// file and listed in the preview. Every cell goes through csvCell (a name starting with = is text).
// ============================================

const progressbookExport = {
    CATEGORIES: {
        technical: { label: 'Engineering Skills', file: 'Engineering_Skills' },
        professional: { label: 'Professional Practice', file: 'Professional_Practice' }
    },
    _last: null,   // { classId, className, result, rows }

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
            this._last = { classId, className: cls ? cls.name : 'Class', result, rows };
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
