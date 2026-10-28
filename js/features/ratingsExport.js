// ============================================
// EXPORT RATINGS (CSV) — i263 / i299 (roadmap s170)
// The offline page ShopFlow_ratings_export_v1.html, as a button in the app. It reads this device's
// database directly (no exported file, no password) and gives one row per skill rating:
// Student, Skill, Date, Rating. The CSV is saved to this device only: nothing here writes to the
// database, marks the data for sync, uploads or calls the webhook.
// ============================================

const ratingsExport = {
    _rows: null,

    // A rating's date, in this device's own time zone, as YYYY-MM-DD (the page's localDate)
    localDate: function(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return formatDateString(d);
    },

    studentName: function(s, fmt) {
        const first = String(s.firstName || '').trim(), last = String(s.lastName || '').trim();
        if (!first && !last) return String(s.name || '').trim();
        if (fmt === 'last-first') return last && first ? last + ', ' + first : (last || first);
        return (first + ' ' + last).trim();
    },

    // The page's row builder. data: { students, skills, skillObservations } (deleted records included).
    // opts: { nameFmt: 'first-last'|'last-first', skillFmt: 'old'|'current', from: 'YYYY-MM-DD'|'', ratingFmt: 'letter'|'word' }
    buildRows: function(data, opts) {
        const students = new Map(data.students.map(s => [String(s.id), s]));
        const skills = new Map(data.skills.map(s => [String(s.id), s]));
        const useOld = opts.skillFmt === 'old';
        const skillName = id => {
            const s = skills.get(String(id));
            if (!s) return null;
            return useOld && s.previousName ? s.previousName : s.name;   // a renamed skill keeps its old name in previousName
        };
        const count = { all: data.skillObservations.length, removed: 0, placeholders: 0, removedStudent: 0, unknown: 0, beforeFrom: 0, noRating: 0 };
        const rows = [];
        const perSkill = new Map();
        for (const r of data.skillObservations) {
            if (r.deletedAt) { count.removed++; continue; }
            if (r.evidenceType === 'migrated') { count.placeholders++; continue; }   // migration placeholders aren't ratings
            const st = students.get(String(r.studentId));
            if (!st) { count.unknown++; continue; }
            if (st.deletedAt) { count.removedStudent++; continue; }
            // A rating moved by the migration remembers its old skill and its original time
            const sid = useOld && r.premigrationSkillId != null ? r.premigrationSkillId : r.skillId;
            const sk = skillName(sid);
            if (!sk) { count.unknown++; continue; }
            const when = (useOld && r.premigrationCreatedAt) || r.createdAt || r.updatedAt || '';
            const date = this.localDate(when);
            if (opts.from && date < opts.from) { count.beforeFrom++; continue; }
            const word = String(r.rating || '').trim();
            if (!word) { count.noRating++; continue; }
            const rating = opts.ratingFmt === 'letter' ? word.charAt(0).toUpperCase() : word;
            rows.push([this.studentName(st, opts.nameFmt), sk, date, rating]);
            perSkill.set(sk, (perSkill.get(sk) || 0) + 1);
        }
        rows.sort((a, b) => a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
        return { rows, count, perSkill };
    },

    summary: function(result, from) {
        const { rows, count, perSkill } = result;
        const L = [];
        L.push(`Rows made: ${rows.length}` + (from ? ` (ratings from ${from} on)` : ' (all ratings)'));
        L.push('');
        L.push("Ratings per skill (check these names match your sheet's list exactly):");
        for (const [k, n] of [...perSkill.entries()].sort((a, b) => a[0].localeCompare(b[0]))) L.push(`  ${k}: ${n}`);
        L.push('');
        L.push('Left out:');
        L.push(`  removed ratings: ${count.removed}`);
        L.push(`  ratings of removed students: ${count.removedStudent}`);
        if (count.placeholders) L.push(`  migration placeholders (levels carried over, not real ratings): ${count.placeholders}`);
        if (from) L.push(`  before ${from}: ${count.beforeFrom}`);
        if (count.unknown) L.push(`  student or skill not found: ${count.unknown}`);
        if (count.noRating) L.push(`  no rating value: ${count.noRating}`);
        L.push('');
        L.push("Date = the day the rating was first made (this device's time zone).");
        return L.join('\n');
    },

    // With a header row, each cell made safe for a spreadsheet (csvCell), and a byte-order mark so
    // Excel reads names with accents correctly (as the page's file)
    toCsv: function(rows) {
        return '﻿' + [['Student', 'Skill', 'Date', 'Rating'], ...rows].map(r => r.map(v => csvCell(v)).join(',')).join('\r\n');
    },

    // No header, tab-separated, for pasting into the sheet's first empty Student cell
    toTsv: function(rows) {
        return rows.map(r => r.map(v => { const t = String(v == null ? '' : v); return (/^[=+\-@]/.test(t) ? "'" + t : t).replace(/[\t\r\n]+/g, ' '); }).join('\t')).join('\r\n');
    },

    fileName: function() { return 'shopflow-skill-ratings-' + getTodayString() + '.csv'; },

    open: function() {
        this._rows = null;
        document.getElementById('ratings-export-out').textContent = '';
        document.getElementById('ratings-export-out').style.display = 'none';
        document.getElementById('ratings-export-actions').style.display = 'none';
        document.getElementById('ratings-export-status').textContent = '';
        ui.showModal('modal-ratings-export');
    },

    options: function() {
        const v = id => document.getElementById(id).value;
        return { nameFmt: v('ratings-export-name'), skillFmt: v('ratings-export-skill'), from: v('ratings-export-from'), ratingFmt: v('ratings-export-rating') };
    },

    make: async function() {
        const status = document.getElementById('ratings-export-status');
        const out = document.getElementById('ratings-export-out');
        status.textContent = 'Working…';
        this._rows = null;
        try {
            const opts = this.options();
            const [students, skills, skillObservations] = await Promise.all([db.students.toArray(), db.skills.toArray(), db.skillObservations.toArray()]);
            const result = this.buildRows({ students, skills, skillObservations }, opts);
            this._rows = result.rows;
            out.textContent = this.summary(result, opts.from);
            out.style.display = 'block';
            document.getElementById('ratings-export-actions').style.display = result.rows.length ? 'flex' : 'none';
            document.getElementById('ratings-export-fname').textContent = this.fileName();
            status.textContent = result.rows.length ? 'Done.' : 'No ratings matched.';
            return result;
        } catch (err) {
            console.error('Ratings export failed:', err);
            status.textContent = 'Could not make the rows: ' + (err && err.message ? err.message : err);
            return null;
        }
    },

    download: function() {
        if (!this._rows || !this._rows.length) return;
        const blob = new Blob([this.toCsv(this._rows)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.fileName();
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        ui.showToast(`Saved ${this._rows.length} rating row(s) to this device as ${this.fileName()}. It holds student names: delete it once it's in your sheet.`, 'success', 8000);
    },

    copy: async function() {
        if (!this._rows || !this._rows.length) return;
        const tsv = this.toTsv(this._rows);
        let ok = false;
        try { await navigator.clipboard.writeText(tsv); ok = true; } catch (e) { /* fall back below */ }
        if (!ok) {
            const t = document.createElement('textarea');
            t.value = tsv; t.style.position = 'fixed'; t.style.left = '-9999px';
            document.body.appendChild(t); t.select();
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            t.remove();
        }
        ui.showToast(ok ? `Copied ${this._rows.length} rows. Paste them into your sheet's first empty Student cell.` : "Copy didn't work here. Use Save as CSV instead.", ok ? 'success' : 'error');
        return ok;
    }
};
