// ============================================
// FORM IMPORT — one function for Check Submissions (plan row 3-02, O10; DUP2 DL11 X13 B12)
// Used by the activity page's Check Form Submissions and by the dashboard's Check Submissions
// (button and the scheduled 8:00 / 12:00 checks). Before this, the two had drifted apart.
//
// The rules (decision D2):
// - Graded work is never changed, unless the form response is LATER than the graded one.
//   Then the graded version is kept as an earlier attempt, and the new response starts ungraded.
// - The form's own feedback goes in its own field (formFeedback). Her written feedback
//   (feedback) is never touched by an import.
// - Question numbers in the form feedback are the questions' places in the form (Q3 is the
//   third question), not a count of the questions that happened to have feedback.
// - Auto-scored work (her rule, i023): once a student's form (conclusion questions) is in and
//   every skill linked to the activity has been rated for them on this activity, the work is
//   marked graded. Work with portfolio prompts always waits for her (B12).
// ============================================

const formImport = {
    // The form data kept on a submission (compared without importedAt, so an unchanged
    // response isn't rewritten on every check)
    buildFormResponses: function(sub, now) {
        return {
            answers: (sub.answers || []).map(a => ({
                question: a.question,
                answer: a.answer,
                score: a.score != null ? a.score : null,
                maxPoints: a.maxPoints != null ? a.maxPoints : null,
                autoFeedback: a.autoFeedback || null,
                // The question's place in the form (0-based), from the P29c v3 script. The answers
                // stay in the order the script sends them: the Form → Rubric mapping counts on it.
                ...(Number.isInteger(a.formIndex) ? { formIndex: a.formIndex } : {})
            })),
            totalScore: sub.totalScore != null ? sub.totalScore : null,
            totalPossible: sub.totalPossible != null ? sub.totalPossible : null,
            autoFeedback: sub.autoFeedback || null,
            importedAt: now
        };
    },

    sameResponses: function(a, b) {
        if (!a || !b) return false;
        const strip = r => JSON.stringify({ answers: r.answers || [], totalScore: r.totalScore ?? null, totalPossible: r.totalPossible ?? null, autoFeedback: r.autoFeedback || null });
        return strip(a) === strip(b);
    },

    // The form's feedback, each item labelled with the question's number in the form (X13).
    // The script (P29c v3) sends each answer's place in the form; older replies don't, so their
    // numbers follow the order sent, which matches the form only when every question is graded.
    formFeedbackText: function(formResponses) {
        const items = (formResponses.answers || [])
            .map((ans, i) => ({ ans, n: Number.isInteger(ans.formIndex) ? ans.formIndex + 1 : i + 1 }))
            .filter(x => x.ans.autoFeedback)
            .sort((a, b) => a.n - b.n);
        const parts = items.map(({ ans, n }) => `Q${n} — ${ans.question || 'Question'}:\n  ${ans.autoFeedback}`);
        if (formResponses.autoFeedback) parts.push(formResponses.autoFeedback);
        return parts.length ? parts.join('\n\n') : null;
    },

    toIso: function(ts) {
        if (!ts) return null;
        const d = new Date(ts);
        return isNaN(d) ? null : d.toISOString();
    },

    // Enrolled students of the activity's class this year, by lower-case email
    emailMap: async function(activity) {
        const periodMap = await db.settings.get('period-year-map');
        const classPeriodsMap = periodMap?.value || {};
        const periodsForClass = Object.entries(classPeriodsMap)
            .filter(([, classId]) => parseInt(classId) === activity.classId)
            .map(([period]) => period);
        const activeYear = await getActiveSchoolYear();
        const enrolled = new Set((await db.enrollments.toArray())
            .filter(e => periodsForClass.includes(String(e.period)) && (!e.schoolYear || e.schoolYear === activeYear))
            .map(e => e.studentId));
        return new Map(excludeDeleted(await db.students.toArray())
            .filter(s => s.email && enrolled.has(s.id))
            .map(s => [s.email.toLowerCase().trim(), s]));
    },

    // Asks the webhook for the form's responses. Throws with the script's own message on failure.
    fetchResponses: async function(activity, webhookUrl) {
        const payload = {
            action: 'check_form_submissions',
            spreadsheetId: activity.formSpreadsheetId,
            token: localStorage.getItem('webhook_token') || ''
        };
        // The form's editor id, if formUrl is an edit link; a students' link gives null (i156)
        const formId = formIdFromUrl(activity.formUrl);
        if (formId) payload.formId = formId;
        // 2-04: retried once if the reply is lost (check_form_submissions is retry-safe)
        const response = await webhookFetch(webhookUrl, { method: 'POST', body: JSON.stringify(payload) });
        const result = await response.json();
        if (result.status !== 'success') throw new Error(result.message || 'unknown error');
        return result;
    },

    // Applies one student's (de-duplicated) form response. Returns 'new', 'updated',
    // 'new-attempt' or 'unchanged'.
    applyResponse: async function(activity, studentId, sub, existing) {
        const now = new Date().toISOString();
        const formResponses = this.buildFormResponses(sub, now);
        const formFeedback = this.formFeedbackText(formResponses);
        const ts = this.toIso(sub.timestamp);

        if (!existing) {
            await db.submissions.add({
                activityId: activity.id, studentId, status: 'submitted',
                formResponses, formFeedback, submittedAt: ts || now, updatedAt: now
            });
            return 'new';
        }

        const isNewer = !!(ts && existing.submittedAt && new Date(ts).getTime() > new Date(existing.submittedAt).getTime());

        if (existing.status === 'graded') {
            if (!isNewer) return 'unchanged';   // graded work is never changed otherwise (D2)
            const attempts = (existing.attempts || []).slice();
            attempts.push({
                attemptNumber: attempts.length + 1,
                submittedAt: existing.submittedAt,
                status: existing.status,
                score: existing.score ?? null,
                maxPoints: existing.maxPoints ?? null,
                totalScore: existing.totalScore ?? null,
                totalPossible: existing.totalPossible ?? null,
                rubricScores: existing.rubricScores || {},
                feedback: existing.feedback || '',
                formFeedback: existing.formFeedback || null,
                formResponses: existing.formResponses || null,
                raceScores: existing.raceScores || null,
                gradedAt: existing.gradedAt || null,
                gradedBy: existing.gradedBy || null,
                archivedAt: now
            });
            await db.submissions.update(existing.id, {
                attempts, status: 'submitted', gradedAt: null, gradedBy: null, statusSetBy: null,
                score: null, rubricScores: {}, feedback: '',
                formResponses, formFeedback, submittedAt: ts, updatedAt: now
            });
            return 'new-attempt';
        }

        const updates = {};
        if (!existing.status || existing.status === 'not-started' || existing.status === 'in-progress') {
            updates.status = 'submitted';
            updates.submittedAt = ts || now;
            updates.statusSetBy = null;   // the form is new evidence
        } else if (isNewer) {
            updates.submittedAt = ts;
        }
        if (!this.sameResponses(existing.formResponses, formResponses)) updates.formResponses = formResponses;
        if ((existing.formFeedback || null) !== formFeedback) updates.formFeedback = formFeedback;
        if (Object.keys(updates).length === 0) return 'unchanged';
        updates.updatedAt = now;
        await db.submissions.update(existing.id, updates);
        return 'updated';
    },

    // Activity skill links that count (visible skills only, once the skills migration code is in)
    liveLinks: async function(activityId) {
        if (typeof window.getLiveSkillLinks === 'function') return window.getLiveSkillLinks(activityId);
        return (await db.activitySkills.where('activityId').equals(activityId).toArray()).filter(l => !l.deletedAt);
    },

    // Her rule (i023, B12). Returns the reason it can't be auto-graded, or null when it can.
    autoGradeBlocker: async function(activity, sub) {
        if (!sub) return 'no submission';
        if (sub.status !== 'submitted') return 'not submitted';
        if (sub.statusSetBy === 'teacher') return 'status set by the teacher';
        if (!sub.formResponses) return 'no conclusion questions';
        if (Array.isArray(activity.portfolioPrompts) && activity.portfolioPrompts.length > 0) return 'needs portfolio review';
        const links = await this.liveLinks(activity.id);
        if (links.length === 0) return 'no linked skills';
        const rated = new Set((await db.skillObservations.where('activityId').equals(activity.id).toArray())
            .filter(o => o.studentId === sub.studentId && !o.deletedAt)   // a removed rating (3-03) doesn't count
            .map(o => o.skillId));
        const missing = links.filter(l => !rated.has(l.skillId)).length;
        return missing ? `${missing} skill(s) not rated yet` : null;
    },

    // Marks the work graded when her rule is met. Returns true if it did.
    autoGradeIfReady: async function(activity, sub) {
        if (await this.autoGradeBlocker(activity, sub)) return false;
        const now = new Date().toISOString();
        await db.submissions.update(sub.id, { status: 'graded', gradedAt: now, gradedBy: 'auto', updatedAt: now });
        sub.status = 'graded';
        return true;
    },

    // The whole import for one activity. Returns counts only.
    importForActivity: async function(activity, webhookUrl) {
        const result = await this.fetchResponses(activity, webhookUrl);
        const emailToStudent = await this.emailMap(activity);
        const counts = { new: 0, updated: 0, 'new-attempt': 0, unchanged: 0, unmatched: 0, autoGraded: 0 };
        for (const sub of pages.activityDetail.deduplicateFormSubmissions(result.submissions)) {
            if (!sub.email) continue;
            const student = emailToStudent.get(sub.email);
            if (!student) { counts.unmatched++; continue; }
            const existing = await db.submissions.where('activityId').equals(activity.id)
                .filter(s => s.studentId === student.id).first();
            counts[await this.applyResponse(activity, student.id, sub, existing)]++;
            const current = await db.submissions.where('activityId').equals(activity.id)
                .filter(s => s.studentId === student.id).first();
            if (await this.autoGradeIfReady(activity, current)) counts.autoGraded++;
        }
        counts.changed = counts.new + counts.updated + counts['new-attempt'];
        return counts;
    },

    // ── Feedback emails ──
    // "Already sent today" is per activity and by this device's local date (BUG8)
    feedbackSentToday: async function(activity) {
        const today = getTodayString();
        const logs = await db.notes.where('entityType').equals('feedback-log').toArray();
        return new Set(logs.filter(n => {
            const sameActivity = n.activityId != null ? n.activityId === activity.id
                : (typeof n.content === 'string' && n.content.includes(`"${activity.name}"`));
            const day = n.localDate || (n.createdAt ? formatDateString(new Date(n.createdAt)) : '');
            return sameActivity && day === today;
        }).map(n => n.entityId));
    },

    feedbackLog: function(activity, studentId) {
        const today = getTodayString();
        return { entityType: 'feedback-log', entityId: studentId, activityId: activity.id, localDate: today,
            content: `Feedback sent for "${activity.name}" on ${today}`, createdAt: new Date().toISOString() };
    },

    // The written feedback an email carries: the form's feedback, then hers. Older records kept
    // both in one field ("Q1 — …" then "---"); that older form part is left out when the
    // form's feedback is stored separately, so it isn't sent twice.
    emailFeedback: function(sub) {
        let teacher = (sub.feedback || '').trim();
        if (sub.formFeedback && /^Q\d+ — /.test(teacher)) {
            const i = teacher.indexOf('\n\n---\n\n');
            teacher = i >= 0 ? teacher.slice(i + 7).trim() : '';
        }
        return [sub.formFeedback, teacher].filter(Boolean).join('\n\n---\n\n');
    },

    // The form's feedback, shown read-only above her feedback box (it's sent with it)
    formFeedbackHtml: function(sub) {
        if (!sub || !sub.formFeedback) return '';
        return `<details class="form-feedback-box" style="margin-bottom: 4px; font-size: var(--font-size-body-small);"><summary style="cursor: pointer; color: var(--color-text-secondary);">Form feedback (sent with yours)</summary><div style="white-space: pre-wrap; padding: var(--space-xs); background: var(--color-background-secondary); border-radius: var(--radius-sm);">${escapeHtml(sub.formFeedback)}</div></details>`;
    },

    // ── The Form fields in Full Edit and the quick edit ──
    // Form URL: a Google Forms link (the students' link is fine, i156). Responses sheet: an id,
    // or a Google Sheets link that the id is taken from. Returns { error } or the cleaned values.
    cleanFormFields: function(formUrlRaw, sheetRaw) {
        const formUrl = String(formUrlRaw || '').trim();
        let sheet = String(sheetRaw || '').trim();
        if (formUrl && !/^https:\/\/(docs\.google\.com\/forms\/|forms\.gle\/)/.test(formUrl)) {
            return { error: 'The Google Form URL must be a Google Forms link (https://docs.google.com/forms/… or https://forms.gle/…).' };
        }
        const m = /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(sheet);
        if (m) sheet = m[1];
        if (sheet && !/^[a-zA-Z0-9_-]{20,}$/.test(sheet)) {
            return { error: 'The Form Responses Spreadsheet ID should be the long id from the sheet\'s link (between /d/ and /edit), or the whole link.' };
        }
        return { formUrl: formUrl || null, formSpreadsheetId: sheet || null };
    }
};
