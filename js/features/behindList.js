// ============================================
// BEHIND LIST (i335 / i375a) — who is behind, per class period, and on what
// Her request: "I often learn a few days late that students are behind."
// Two kinds of entry, computed from the tables the app already keeps. This file writes nothing to
// the database and adds no alerts; the only thing it stores is, in this device's localStorage,
// which periods' pop-ups were already shown today (device-only, never synced or backed up).
//  missing   a GRADED assignment past its due date (endDate) and no turn-in recorded in the app (no
//            submission, or one still 'not-started' / 'in-progress'), or, on an assignment with a
//            Google Form (conclusion questions), no form response imported by Check Submissions
//  team      a team whose checkpoint target date (suggestedDate) has passed with no tick: no member
//            has that checkpoint marked complete (checkpointCompletions). Open assignments only;
//            once an assignment is past due its missing work shows instead.
// Lateness counts school days only (getSchoolDayPosition and the no-school calendar), so a
// checkpoint due Friday is 1 school day late on Monday. Students absent today (attendance) and
// archived students are skipped. The app has no "excused" status today; an attendance status of
// 'excused' is skipped too, should one ever be recorded.
// ============================================

const behindList = {
    POPUP_KEY: 'behind-popup-shown',   // localStorage: { date, periods: [...] } — this device only

    // A graded assignment: one with points, a rubric, a Google Form or a Classroom link. A
    // complete/incomplete in-class activity with none of these is not graded and never listed.
    isGradedActivity: function(a) {
        if (!a || a.deletedAt || a.status === 'archived') return false;
        if (a.scoringType === 'points' || a.scoringType === 'rubric') return true;
        if (Number(a.defaultPoints) > 0) return true;
        if (this.hasForm(a)) return true;
        return this.hasClassroomLinks(a);
    },

    hasClassroomLinks: function(a) {
        return !!(a && a.classroomLinks && Object.keys(a.classroomLinks).length > 0);
    },

    hasForm: function(a) {
        return !!(a && (a.formUrl || a.formSpreadsheetId));
    },

    // School days after `due`, up to and including today (0 when not late)
    schoolDaysLate: function(due, today, niDays) {
        if (!due || String(due) >= today) return 0;
        const p = String(due).slice(0, 10).split('-');
        const next = formatDateString(new Date(p[0], p[1] - 1, Number(p[2]) + 1));
        if (next > today) return 0;
        const pos = getSchoolDayPosition(today, next, today, niDays || []);
        return pos ? pos.currentDay : 0;
    },

    isSchoolDay: function(day, niDays) {
        return !!getSchoolDayPosition(day, day, day, niDays || []);
    },

    // Pure. d: { periodYearMap, classes, students, enrollments, activities, checkpoints, completions,
    // submissions, teams, teamMembers, attendanceToday, activeYear, yearStart? }
    // Returns one entry per class period that has a class, in period order:
    // { period, classId, className, missing: [...], teams: [...], counts: { missing, students, teams } }
    compute: function(d, today, niDays) {
        const S = x => String(x);
        const live = r => r && !r.deletedAt;
        const classById = new Map((d.classes || []).filter(live).map(c => [S(c.id), c]));
        const studentById = new Map((d.students || []).filter(s => live(s) && (s.status || 'active') !== 'archived').map(s => [S(s.id), s]));
        const away = new Set((d.attendanceToday || [])
            .filter(a => live(a) && a.date === today && a.period !== 'wildcat' && (a.status === 'absent' || a.status === 'excused'))
            .map(a => S(a.studentId)));
        const subBy = new Map();   // "activity|student" → the latest live submission
        for (const s of (d.submissions || [])) {
            if (!live(s)) continue;
            const k = S(s.activityId) + '|' + S(s.studentId);
            const prev = subBy.get(k);
            if (!prev || String(s.updatedAt || s.submittedAt || '') > String(prev.updatedAt || prev.submittedAt || '')) subBy.set(k, s);
        }
        const turnedIn = sub => !!sub && (sub.status === 'submitted' || sub.status === 'graded');
        const ticked = new Set((d.completions || []).filter(c => live(c) && c.completed).map(c => S(c.checkpointId) + '|' + S(c.studentId)));
        const name = s => (typeof displayName === 'function' ? displayName(s) : `${s.firstName || ''} ${s.lastName || ''}`.trim());
        const periods = Object.keys(d.periodYearMap || {}).filter(p => p !== 'wildcat' && classById.has(S(d.periodYearMap[p])))
            .sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b));
        const out = [];
        for (const period of periods) {
            const cls = classById.get(S(d.periodYearMap[period]));
            const seen = new Set();
            const roster = [];
            for (const e of (d.enrollments || [])) {
                if (!live(e) || S(e.period) !== S(period) || (e.schoolYear && d.activeYear && e.schoolYear !== d.activeYear)) continue;
                const s = studentById.get(S(e.studentId));
                if (!s || seen.has(S(s.id))) continue;
                seen.add(S(s.id));
                roster.push(s);
            }
            roster.sort(sortByStudentName);
            const acts = (d.activities || []).filter(a => live(a) && a.status !== 'archived' && S(a.classId) === S(cls.id));

            // 1. Missing graded work
            const missing = [];
            const graded = acts.filter(a => this.isGradedActivity(a) && a.endDate && (!d.yearStart || a.endDate >= d.yearStart))
                .map(a => ({ a, late: this.schoolDaysLate(a.endDate, today, niDays) }))
                .filter(x => x.late > 0)
                .sort((x, y) => S(x.a.endDate).localeCompare(S(y.a.endDate)) || S(x.a.name).localeCompare(S(y.a.name)));
            for (const s of roster) {
                if (away.has(S(s.id))) continue;
                for (const { a, late } of graded) {
                    const sub = subBy.get(S(a.id) + '|' + S(s.id));
                    let reason = null;
                    // The app can't see Classroom turn-ins, so the words say what it knows: no turn-in
                    // recorded here. A Classroom-only assignment (links, no Form) says Classroom wasn't checked.
                    if (!turnedIn(sub)) reason = 'no turn-in recorded' + (this.hasClassroomLinks(a) && !this.hasForm(a) ? ' (Classroom not checked)' : '');
                    else if (this.hasForm(a) && sub.status !== 'graded' && !sub.formResponses) reason = 'no form response';
                    if (!reason) continue;
                    missing.push({ studentId: s.id, name: name(s), activityId: a.id, activityName: a.name || 'Assignment', dueDate: a.endDate, daysLate: late, reason });
                }
            }

            // 2. Teams late on a checkpoint (open assignments only)
            const teams = [];
            const periodTeams = (d.teams || []).filter(t => live(t) && S(t.classId) === S(cls.id) && (t.period == null || t.period === '' || S(t.period) === S(period)))
                .sort((x, y) => S(x.name).localeCompare(S(y.name)));
            for (const a of acts) {
                if (a.endDate && a.endDate < today) continue;
                const cps = (d.checkpoints || []).filter(c => live(c) && S(c.activityId) === S(a.id) && c.suggestedDate)
                    .map(c => ({ c, late: this.schoolDaysLate(String(c.suggestedDate).slice(0, 10), today, niDays) }))
                    .filter(x => x.late > 0)
                    .sort((x, y) => (Number(x.c.number) || 0) - (Number(y.c.number) || 0));
                if (!cps.length) continue;
                for (const t of periodTeams) {
                    const members = (d.teamMembers || []).filter(m => live(m) && S(m.teamId) === S(t.id))
                        .map(m => studentById.get(S(m.studentId))).filter(Boolean);
                    const here = members.filter(s => !away.has(S(s.id)));
                    if (!here.length) continue;   // the whole team is away today
                    if (members.every(s => turnedIn(subBy.get(S(a.id) + '|' + S(s.id))))) continue;   // work is in
                    const lateCps = cps.filter(x => !members.some(s => ticked.has(S(x.c.id) + '|' + S(s.id))));
                    if (!lateCps.length) continue;
                    const first = lateCps[0];
                    teams.push({
                        teamId: t.id, teamName: t.name || 'Team', activityId: a.id, activityName: a.name || 'Assignment',
                        checkpointId: first.c.id, number: first.c.number, title: first.c.title || '',
                        dueDate: String(first.c.suggestedDate).slice(0, 10), daysLate: first.late, moreLate: lateCps.length - 1
                    });
                }
            }
            out.push({
                period: S(period), classId: cls.id, className: cls.name || '',
                missing, teams,
                counts: { missing: missing.length, students: new Set(missing.map(m => S(m.studentId))).size, teams: new Set(teams.map(t => S(t.teamId))).size }
            });
        }
        return out;
    },

    // Reads the tables and runs compute (reads only)
    load: async function(today) {
        today = today || getTodayString();
        const [periodMap, classes, students, enrollments, activities, checkpoints, completions, submissions, teams, teamMembers, attendanceToday, activeYear, niDays, yearSetting] = await Promise.all([
            db.settings.get('period-year-map'), db.classes.toArray(), db.students.toArray(), db.enrollments.toArray(),
            db.activities.toArray(), db.checkpoints.toArray(), db.checkpointCompletions.toArray(), db.submissions.toArray(),
            db.teams.toArray(), db.teamMembers.toArray(), db.attendance.where('date').equals(today).toArray(),
            getActiveSchoolYear(), getActiveNonInstructionalDays(), db.settings.get('school-year')
        ]);
        const yearStart = yearSetting && yearSetting.value && yearSetting.value.start ? String(yearSetting.value.start).slice(0, 10) : null;
        const d = { periodYearMap: (periodMap && periodMap.value) || {}, classes, students, enrollments, activities, checkpoints, completions, submissions, teams, teamMembers, attendanceToday, activeYear, yearStart };
        return { today, niDays, periods: this.compute(d, today, niDays) };
    },

    // ---- Words ----
    plural: function(n, one, many) { return `${n} ${n === 1 ? one : many}`; },

    countsText: function(p) {
        const parts = [];
        if (p.counts.missing) parts.push(`${p.counts.missing} missing`);
        if (p.counts.teams) parts.push(this.plural(p.counts.teams, 'team late', 'teams late'));
        return parts.length ? parts.join(', ') : 'nobody behind';
    },

    // "Tue" within the last week, else "Oct 28"
    dayLabel: function(dateStr, today) {
        const p = String(dateStr).split('-');
        const d = new Date(p[0], p[1] - 1, p[2]);
        const t = String(today).split('-');
        const days = Math.round((new Date(t[0], t[1] - 1, t[2]) - d) / 86400000);
        return days >= 0 && days < 7
            ? d.toLocaleDateString('en-US', { weekday: 'short' })
            : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },

    lateText: function(n) { return this.plural(n, 'school day late', 'school days late'); },

    missingLine: function(m, today) {
        return `${m.name}: ${m.activityName} (${m.reason}; due ${this.dayLabel(m.dueDate, today)}, ${this.lateText(m.daysLate)})`;
    },

    teamLine: function(t, today) {
        const more = t.moreLate ? ` (+${t.moreLate} more late)` : '';
        return `${t.teamName}: ${t.activityName}, CP ${t.number}${t.title ? ' ' + t.title : ''} was due ${this.dayLabel(t.dueDate, today)}: ${this.lateText(t.daysLate)}${more}`;
    },

    // One period's block. Names only when showNames (her screen may be projected).
    periodHtml: function(p, today, showNames) {
        const head = `<div class="behind-period__head"><strong>Period ${escapeHtml(p.period)}</strong>${p.className ? ' · ' + escapeHtml(p.className) : ''}: <span class="behind-period__counts">${escapeHtml(this.countsText(p))}</span></div>`;
        if (!showNames || (!p.missing.length && !p.teams.length)) return `<div class="behind-period" data-period="${escapeHtml(p.period)}">${head}</div>`;
        const items = [
            ...p.missing.map(m => `<li class="behind-item behind-item--missing">${escapeHtml(this.missingLine(m, today))}</li>`),
            ...p.teams.map(t => `<li class="behind-item behind-item--team">${escapeHtml(this.teamLine(t, today))}</li>`)
        ].join('');
        return `<div class="behind-period" data-period="${escapeHtml(p.period)}">${head}<ul class="behind-period__list">${items}</ul></div>`;
    },

    // ---- Pop-up memory (this device only) ----
    popupShown: function(today, period) {
        try {
            const v = JSON.parse(localStorage.getItem(this.POPUP_KEY) || 'null');
            return !!(v && v.date === today && Array.isArray(v.periods) && v.periods.includes(String(period)));
        } catch (e) { return false; }
    },

    markPopupShown: function(today, period) {
        let v = null;
        try { v = JSON.parse(localStorage.getItem(this.POPUP_KEY) || 'null'); } catch (e) { v = null; }
        if (!v || v.date !== today || !Array.isArray(v.periods)) v = { date: today, periods: [] };
        if (!v.periods.includes(String(period))) v.periods.push(String(period));
        try { localStorage.setItem(this.POPUP_KEY, JSON.stringify(v)); } catch (e) { /* storage full: shows again */ }
    }
};
