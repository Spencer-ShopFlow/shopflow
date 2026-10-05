// ============================================
// UTILITY FUNCTIONS
// ============================================

async function getActiveSchoolYear() {
    // First check if there's a manually selected active year
    const activeYearSetting = await db.settings.get('active-school-year');
    if (activeYearSetting?.value) return activeYearSetting.value;

    // Otherwise derive from school-year start date
    const schoolYearSetting = await db.settings.get('school-year');
    if (schoolYearSetting?.value?.start) {
        const startYear = new Date(schoolYearSetting.value.start).getFullYear();
        return `${startYear}-${startYear + 1}`;
    }

    // Fallback: derive from current date (school year starts in August)
    const now = new Date();
    const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
    return `${year}-${year + 1}`;
}

// 3-16 (DL8): a save or delete that writes several tables runs in one Dexie read-write transaction:
// all of it is saved, or (on any error) none of it. The activity log (logAction) is always included.
// fn may only wait on database work: no webhook calls, timers or other promises inside it.
async function saveTogether(tableNames, fn) {
    const tables = [...new Set([...tableNames, 'activityLog'])].map(n => db.table(n));
    return db.transaction('rw', tables, fn);
}

async function ensureEnrollment(studentId, period, schoolYear) {
    try {
        const existing = await db.enrollments
            .where('[studentId+period+schoolYear]')
            .equals([studentId, period, schoolYear])
            .first();
        if (!existing) {
            await db.enrollments.add({
                studentId, period, schoolYear, createdAt: new Date().toISOString()
            });
        }
    } catch (err) {
        console.warn('ensureEnrollment index lookup failed, using fallback scan:', err.message);
        // Fallback: manual scan if compound index query fails due to type mismatch
        const all = await db.enrollments
            .where('studentId').equals(studentId)
            .toArray();
        const match = all.find(e =>
            String(e.period) === String(period) &&
            String(e.schoolYear) === String(schoolYear)
        );
        if (!match) {
            await db.enrollments.add({
                studentId, period, schoolYear, createdAt: new Date().toISOString()
            });
        }
    }
}

const utils = {
    // Timestamp helper
    timestamp: function() {
        return new Date().toISOString();
    }
};

// ============================================
// SECURITY UTILITIES
// ============================================

/**
 * Escapes user-supplied text before inserting into innerHTML.
 * Prevents XSS attacks from malicious student names, notes, etc.
 */
function escapeHtml(text) {
    if (text == null) return '';
    // Quotes are escaped too, so values are safe inside HTML attributes (value="...").
    // Note: escaping can't make a string safe inside an inline onclick="f('...')" handler;
    // pass ids there instead.
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Restored from commit b22d5c5^ (deleted 14 May 2026; its callers were left behind).
// Two fixes: a checkpoint completed ON its suggested date counts as on time (the old
// string compare treated it as late), and a one-level rubric no longer divides by zero.
function calculateFinalGrade(activity, studentId, submission, checkpoints, completions) {
    const cpWeight = (activity.checkpointGradeWeight || 0) / 100;
    const assignmentWeight = 1 - cpWeight;

    // Checkpoint score (0–1)
    let cpScore = 0;
    if (checkpoints.length > 0 && cpWeight > 0) {
        const studentCompletions = completions.filter(function(c) {
            return String(c.studentId) === String(studentId) && c.completed;
        });
        if (activity.checkpointGradeMode === 'timeliness') {
            let cpPoints = 0;
            checkpoints.forEach(function(cp) {
                const completion = studentCompletions.find(function(c) { return c.checkpointId === cp.id; });
                if (completion) {
                    const doneOn = completion.completedAt ? formatDateString(new Date(completion.completedAt)) : '';
                    const onTime = !cp.suggestedDate || (doneOn && doneOn <= String(cp.suggestedDate).slice(0, 10));
                    cpPoints += onTime ? 1 : 0.5;
                }
            });
            cpScore = cpPoints / checkpoints.length;
        } else {
            cpScore = studentCompletions.filter(function(c) {
                return checkpoints.some(function(cp) { return cp.id === c.checkpointId; });
            }).length / checkpoints.length;
        }
    }

    // Assignment score (0–1)
    let assignmentScore = 0;
    if (submission) {
        const scoringType = activity.scoringType || 'complete-incomplete';
        if (scoringType === 'rubric' && submission.rubricScores && activity.rubric) {
            const levels = activity.rubric.levels || [];
            const criteria = activity.rubric.criteria || [];
            let total = 0;
            criteria.forEach(function(c) {
                const idx = levels.indexOf(submission.rubricScores[c.name]);
                if (idx >= 0) {
                    total += levels.length > 1 ? (levels.length - 1 - idx) / (levels.length - 1) : 1;
                }
            });
            assignmentScore = criteria.length > 0 ? total / criteria.length : 0;
        } else if (scoringType === 'points' && submission.score != null) {
            const max = activity.defaultPoints || 100;
            assignmentScore = submission.score / max;
        } else if (scoringType === 'complete-incomplete') {
            assignmentScore = (submission.status === 'graded' || submission.status === 'submitted') ? 1 : 0;
        }
    }

    return {
        finalScore: (cpScore * cpWeight) + (assignmentScore * assignmentWeight),
        cpScore: cpScore,
        assignmentScore: assignmentScore,
        cpWeight: cpWeight,
        assignmentWeight: assignmentWeight
    };
}

function formatDateString(d) {
    if (!d) d = new Date();
    if (typeof d === 'string') d = new Date(d);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getTodayString() {
    return formatDateString(new Date());
}

// One CSV cell (SEC16, 3-08): a value starting with = + - @ (or a tab or return) gets a leading
// apostrophe so a spreadsheet shows it as text instead of running it as a formula; a value with a
// comma, quote or line break is quoted, with its quotes doubled.
function csvCell(value) {
    let s = value == null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvRow(values) {
    return values.map(csvCell).join(',') + '\n';
}

function downloadCSV(csvContent, filename) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}_${getTodayString()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function csvEscape(value) {
    if (value == null) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// The form's editor id from its URL, or null (i156). A students' link
// (.../forms/d/e/<published id>/viewform) has no editor id: the old pattern read
// "e" out of it, which the script can't open. With null, Check Submissions reads
// the form's response sheet instead.
function formIdFromUrl(url) {
    const match = /\/forms\/d\/([a-zA-Z0-9_-]+)/.exec(String(url || ''));
    if (!match || match[1] === 'e') return null;
    return match[1];
}

function excludeDeleted(records) {
    return records.filter(r => !r.deletedAt);
}

// ============================================
// STANDALONE FUNCTIONS
// ============================================

async function logAction(action, entityType, entityId, description) {
    try {
        await db.activityLog.add({
            action: action,
            entityType: entityType,
            entityId: entityId,
            description: description,
            timestamp: new Date().toISOString()
        });

        // Trim to 100 entries — delete oldest if over limit
        const count = await db.activityLog.count();
        if (count > 100) {
            const excess = await db.activityLog
                .orderBy('id')
                .limit(count - 100)
                .primaryKeys();
            await db.activityLog.bulkDelete(excess);
        }
    } catch (err) {
        // Activity logging should never break the app — fail silently
        console.warn('Activity log write failed:', err);
    }
}

function formatTimeAgo(date) {
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function displayName(student, format) {
    if (!student) return 'Unknown';
    format = format || 'first-last';
    const first = (student.firstName || '').trim();
    const last = (student.lastName || '').trim();
    // Fallback to legacy name field if migration hasn't run
    if (!first && !last) return student.name || 'Unknown';
    switch (format) {
        case 'last-first':
            return last ? (last + ', ' + first).trim() : first;
        case 'first-last':
        default:
            return (first + ' ' + last).trim() || 'Unknown';
    }
}

async function getNextAnonId() {
    // P20 (D-b): after the identity cutover, new students get a random anonId (both devices can add
    // students then); existing ones keep theirs. Before it, the counter as today.
    if (typeof identity !== 'undefined' && await identity.uidMode()) return identity.newAnonId();
    const setting = await db.settings.get('anon-id-counter');
    let counter = (setting && setting.value) ? setting.value : 1;
    const padded = String(counter).padStart(4, '0');
    const anonId = 'STU-' + padded;
    await db.settings.put({ key: 'anon-id-counter', value: counter + 1 });
    return anonId;
}

function sortByStudentName(a, b) {
    const lastCmp = (a.lastName || '').localeCompare(b.lastName || '');
    return lastCmp !== 0 ? lastCmp : (a.firstName || '').localeCompare(b.firstName || '');
}

function gradingSortStudents(students, submissionMap) {
    const statusRank = { 'not-started': 0, 'in-progress': 1, 'submitted': 2, 'graded': 3 };
    return students.slice().sort((a, b) => {
        const aStatus = submissionMap.get(a.id)?.status || 'not-started';
        const bStatus = submissionMap.get(b.id)?.status || 'not-started';
        const statusCmp = (statusRank[aStatus] || 0) - (statusRank[bStatus] || 0);
        if (statusCmp !== 0) return statusCmp;
        return sortByStudentName(a, b);
    });
}

function getSchoolDayPosition(todayStr, activityStartDate, activityEndDate, nonInstructionalDays) {
    // Only count no-school types (delays and early dismissals are still school days)
    const noSchoolTypes = ['holiday', 'break', 'no-school'];

    const isNoSchoolDay = (dateStr) => nonInstructionalDays.some(ni => {
        if (!noSchoolTypes.includes(ni.type)) return false;
        if (ni.end) return dateStr >= ni.start && dateStr <= ni.end;
        return ni.start === dateStr;
    });

    // Parse dates as local (avoiding timezone issues)
    const startParts = activityStartDate.split('-');
    const endParts = activityEndDate.split('-');
    const start = new Date(startParts[0], startParts[1] - 1, startParts[2]);
    const end = new Date(endParts[0], endParts[1] - 1, endParts[2]);

    // Check if today is within the activity's date range
    if (todayStr < activityStartDate || todayStr > activityEndDate) return null;

    let totalDays = 0;
    let currentDay = 0;
    const cursor = new Date(start);

    while (cursor <= end) {
        const cursorStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
        const dayOfWeek = cursor.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        if (!isWeekend && !isNoSchoolDay(cursorStr)) {
            totalDays++;
            if (cursorStr <= todayStr) {
                currentDay = totalDays;
            }
        }

        cursor.setDate(cursor.getDate() + 1);
    }

    if (currentDay === 0) return null; // today itself is a non-school day somehow
    return { currentDay, totalDays };
}

async function getActiveNonInstructionalDays() {
    const niData = await db.settings.get('non-instructional-days');
    const allDays = niData?.value || [];
    const activeYear = await getActiveSchoolYear();
    return allDays.filter(d => !d.schoolYear || d.schoolYear === activeYear);
}

async function getSkillCategories() {
    const setting = await db.settings.get('skill-categories');
    return setting?.value || ['Safety', 'Fabrication', 'Design', 'Measurement', 'Digital', 'Other'];
}

// This device's name in the Drive sync: 'iPad' or 'PC'
function syncThisDevice() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return isIOS ? 'iPad' : 'PC';
}

// ---- Sync epoch (skills migration, P16 design C4.2 N6) ----
// A one-off data change (the skills migration; later the identity cutover) writes the setting
// 'sync-epoch'. Data from the other side of it is never merged: a Drive copy is refused, and a
// backup can only come in by Replace All. Until such an event runs, every epoch is null.
function syncEpochOf(data) {
    const rows = data && Array.isArray(data.settings) ? data.settings : [];
    const row = rows.find(r => r && r.key === 'sync-epoch');
    // P20 (§9 finding 2): a format-2 file marks its epoch '<id>/f2', so code from before P20
    // (which compares the whole string) refuses it. This code compares the part before the mark.
    return (row && row.value && row.value.id) ? String(row.value.id).replace(/\/f2$/, '') : null;
}

async function localSyncEpoch() {
    const row = await db.settings.get('sync-epoch');
    return (row && row.value && row.value.id) ? row.value.id : null;
}

// "before"/"after" wording for a copy's epoch compared with this device's
function epochSide(epoch) {
    if (typeof identity !== 'undefined' && identity.isUidEpoch(epoch)) return 'after the identity cutover';   // P20
    return epoch ? 'after the skills migration' : 'before the skills migration';
}

// ---- Hidden skills (skills migration, P16 design C3) ----
// A skill merged away by the migration carries deletedAt (+ mergedInto); a retired skill carries
// retiredAt. Both are hidden everywhere a skill can be picked, rated, counted or exported; their
// records stay on file (full export, backups and sync carry them). Levels marked merged carry
// deletedAt and are ignored too. Until a migration runs, no skill or level has these fields.
function isSkillHidden(s) { return !!(s && (s.deletedAt || s.retiredAt)); }

function isLevelLive(l) { return !!(l && !l.deletedAt); }

async function getVisibleSkills() {
    return (await db.skills.toArray()).filter(s => !isSkillHidden(s));
}

async function getHiddenSkillIds() {
    return new Set((await db.skills.toArray()).filter(isSkillHidden).map(s => s.id));
}

// activitySkills rows that count: not marked merged, and not on a hidden skill
async function getLiveSkillLinks(activityId) {
    const hidden = await getHiddenSkillIds();
    return (await db.activitySkills.where('activityId').equals(activityId).toArray())
        .filter(l => !l.deletedAt && !hidden.has(l.skillId));
}

// ---- Skills grading per class (plan row 3-01, i152) ----
// One settings row per class, 'mastery-mode-{classId}' — the spec's per-class masteryMode (§3), which
// the grading engine (3-06) reads. 'weighted-average' or 'current-best': the class is graded by skills,
// and the grading tab shows the Skill Observations and Professional Practice panels. 'off', or no row:
// it isn't. The row carries updatedAt, so a change reaches the other device (settings merge newer-wins).
const MASTERY_MODES = ['weighted-average', 'current-best'];

function isSkillsGradedMode(mode) { return MASTERY_MODES.includes(mode); }

async function getClassMasteryMode(classId) {
    const row = await db.settings.get('mastery-mode-' + classId);
    return row && isSkillsGradedMode(row.value) ? row.value : 'off';
}

async function setClassMasteryMode(classId, mode) {
    const key = 'mastery-mode-' + classId;
    const value = isSkillsGradedMode(mode) ? mode : 'off';
    const now = new Date().toISOString();
    const existing = await db.settings.get(key);
    await db.settings.put({ key, value, createdAt: (existing && existing.createdAt) || now, updatedAt: now });
    driveSync.markDirty();
    return value;
}

async function getCalculatedSkillLevels(studentId) {
    // Returns a Map of skillId -> calculated level based on assignment rubric skill scores
    // Weighted toward recent: each score gets weight = index + 1 (most recent = highest weight)
    const levelValues = { 'Beginning': 1, 'Developing': 2, 'Proficient': 3, 'Advanced': 4 };
    const valueLabels = { 1: 'Beginning', 2: 'Developing', 3: 'Proficient', 4: 'Advanced' };

    const submissions = (await db.submissions.toArray())
        .filter(s => s.studentId === studentId && s.skillScores && Object.keys(s.skillScores).length > 0)
        .sort((a, b) => (a.updatedAt || a.submittedAt || '').localeCompare(b.updatedAt || b.submittedAt || ''));

    const skillScoresMap = new Map(); // skillId -> [{value, weight}]

    submissions.forEach((sub, idx) => {
        const weight = idx + 1; // later submissions get higher weight
        for (const [skillId, level] of Object.entries(sub.skillScores)) {
            if (!levelValues[level]) continue;
            if (!skillScoresMap.has(skillId)) skillScoresMap.set(skillId, []);
            skillScoresMap.get(skillId).push({ value: levelValues[level], weight });
        }
    });

    const result = new Map();
    for (const [skillId, scores] of skillScoresMap) {
        const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
        const weightedSum = scores.reduce((sum, s) => sum + s.value * s.weight, 0);
        const avg = weightedSum / totalWeight;
        // Round to nearest level
        const rounded = Math.round(avg);
        const clamped = Math.max(1, Math.min(4, rounded));
        result.set(skillId, { level: valueLabels[clamped], average: avg, count: scores.length });
    }
    return result;
}

// Returns the display label for a period value
function periodLabel(periodValue) {
    if (periodValue === 'wildcat') return state.flexPeriodName;
    return `Period ${periodValue}`;
}

// ============================================
// SHARED TASK CARD RENDERER
// ============================================
// Used by both dashboard.js and misc.js (Tasks page).
// Options:
//   compact:    true = dashboard row style, false = full card style (default false)
//   showDelete: true = show delete button (default false)
//   onComplete: function(taskId) — called when checkbox changes
//   onDelete:   function(taskId) — called when delete button clicked
//   onNavigate: function(taskId) — called when task body is tapped
//   refreshAll: function()       — called after swipe-complete or undo to refresh lists

function renderTaskCard(task, options = {}) {
    const {
        compact = false,
        showDelete = false,
        onComplete = null,
        onDelete = null,
        onNavigate = null,
        refreshAll = null
    } = options;

    const dueDate = task.dueDate ? new Date(task.dueDate) : null;
    const isOverdue = dueDate && dueDate < new Date() && !task.completed;
    const isAbsenceFollowUp = task.subtype === 'absence-followup';
    const isAuto = task.type === 'auto';

    const priorityColors = {
        high: 'var(--color-error)',
        medium: 'var(--color-warning)',
        low: 'var(--color-text-secondary)'
    };

    const priorityLabels = {
        high: 'High',
        medium: 'Medium',
        low: 'Low'
    };

    // --- Border / background styling ---
    let borderStyle = '';
    if (compact) {
        // Dashboard compact style: thin left border
        if (isAbsenceFollowUp) {
            borderStyle = 'border-left: 3px solid var(--color-warning);';
        } else if (isAuto) {
            borderStyle = 'border-left: 3px solid var(--color-info);';
        }
    } else {
        // Full card style: thicker left border
        if (isOverdue) {
            borderStyle = 'border-left: 4px solid var(--color-error); background: rgba(220, 38, 38, 0.05);';
        } else if (isAbsenceFollowUp) {
            borderStyle = 'border-left: 4px solid var(--color-warning);';
        }
    }

    const el = document.createElement('div');
    el.dataset.taskId = String(task.id);

    // --- Absence badge ---
    const absenceBadge = isAbsenceFollowUp && task.absenceDates && task.absenceDates.length > 1
        ? `<span style="display:inline-block; background: var(--color-warning); color: white; border-radius: 999px; padding: 0 ${compact ? '6px' : '8px'}; font-size: ${compact ? '11px' : '12px'}; font-weight: 600; margin-left: 4px;">${task.absenceDates.length} days${compact ? '' : ' absent'}</span>`
        : (isAbsenceFollowUp && !compact)
            ? '<span style="display:inline-block; background: var(--color-warning); color: white; border-radius: 999px; padding: 0 8px; font-size: 12px; font-weight: 600;">Absent</span>'
            : '';

    const labelPrefix = isAbsenceFollowUp ? '🏠 ' : '';

    if (compact) {
        // ── Dashboard compact row ──
        el.className = 'dashboard-task-row';
        el.style.cssText = `display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-md); margin-bottom: var(--space-xs); ${isOverdue ? 'background: rgba(220, 38, 38, 0.05); border-color: var(--color-error);' : ''} ${borderStyle}`;

        el.innerHTML = `
            <input type="checkbox" data-task-complete="${task.id}" style="cursor: pointer; min-width: 20px;">
            <div style="flex: 1; min-width: 0; cursor: ${task.linkedEntityType ? 'pointer' : 'default'};" data-task-navigate="${task.id}">
                <div style="font-weight: 500; ${isAuto ? 'font-size: var(--font-size-body-small);' : ''}">${labelPrefix}${escapeHtml(task.description)}${absenceBadge}</div>
                ${dueDate ? `<div style="font-size: 0.8em; color: ${isOverdue ? 'var(--color-error)' : 'var(--color-text-tertiary)'};">Due: ${escapeHtml(dueDate.toLocaleDateString())}</div>` : ''}
                ${isAbsenceFollowUp && !dueDate ? '<div style="font-size: 0.8em; color: var(--color-text-tertiary);">Follow up when student returns</div>' : ''}
            </div>
            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${priorityColors[task.priority] || priorityColors.medium}; flex-shrink: 0;"></span>
        `;
    } else {
        // ── Tasks page full card ──
        const followUpNote = isAbsenceFollowUp && !task.completed && !dueDate
            ? '<div style="font-size: var(--font-size-body-small); color: var(--color-text-secondary); margin-top: 2px;">Follow up when student returns</div>'
            : '';

        const snoozedNote = task.status === 'snoozed' && task.dueDate
            ? `<div style="font-size: var(--font-size-body-small); color: var(--color-info); font-style: italic; margin-top: 2px;">Snoozed to ${new Date(task.dueDate).toLocaleDateString()}</div>`
            : '';

        el.className = 'card';
        el.style.cssText = `${borderStyle} ${task.completed ? 'opacity: 0.6;' : ''} margin-bottom: var(--space-sm);`;

        el.innerHTML = `
            <div class="card__body" style="display: flex; align-items: start; gap: var(--space-base);">
                <input type="checkbox"
                    ${task.completed ? 'checked' : ''}
                    data-task-complete="${task.id}"
                    style="margin-top: 4px; cursor: pointer; width: 20px; height: 20px;">

                <div style="flex: 1;">
                    <div style="font-weight: 500; font-size: var(--font-size-body-large); ${task.completed ? 'text-decoration: line-through;' : ''} ${task.status === 'snoozed' ? 'color: var(--color-text-secondary); font-style: italic;' : ''}">
                        ${labelPrefix}${escapeHtml(task.description)} ${absenceBadge}
                    </div>
                    ${followUpNote}
                    ${snoozedNote}

                    <div style="display: flex; gap: var(--space-base); margin-top: var(--space-xs); font-size: var(--font-size-body-small); color: var(--color-text-secondary);">
                        ${dueDate && task.status !== 'snoozed' ? `
                            <span style="color: ${isOverdue ? 'var(--color-error)' : 'var(--color-text-secondary)'};">
                                ${dueDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            </span>
                        ` : ''}

                        <span style="display: flex; align-items: center; gap: 4px;">
                            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${escapeHtml(priorityColors[task.priority])};"></span>
                            ${escapeHtml(priorityLabels[task.priority])} Priority
                        </span>

                        ${task.completed ? `
                            <span>✓ Completed ${new Date(task.completedAt).toLocaleDateString()}</span>
                        ` : ''}
                    </div>
                </div>

                ${showDelete ? `<button class="btn btn--danger" style="padding: var(--space-xs) var(--space-sm);" data-task-delete="${task.id}">Delete</button>` : ''}
            </div>
        `;
    }

    // --- Wire up callbacks via event delegation on this element ---
    const checkbox = el.querySelector('[data-task-complete]');
    if (checkbox && onComplete) {
        checkbox.addEventListener('change', () => onComplete(task.id));
    }

    const navTarget = el.querySelector('[data-task-navigate]');
    if (navTarget && onNavigate) {
        navTarget.addEventListener('click', () => {
            if (el._gestureState && el._gestureState.swipeOccurred) return;
            onNavigate(task.id);
        });
    }

    const deleteBtn = el.querySelector('[data-task-delete]');
    if (deleteBtn && onDelete) {
        deleteBtn.addEventListener('click', () => onDelete(task.id));
    }

    // --- Swipe gestures (touch only, non-completed tasks) ---
    if (!task.completed) {
        gestures.makeSwipeable(el, {
            onSwipeRight: () => {
                // Auto-task dismissal tracking
                if (task.type === 'auto' && task.autoKey) {
                    db.settings.get('dismissed-auto-tasks').then(setting => {
                        const dismissed = setting ? setting.value : [];
                        dismissed.push(task.autoKey);
                        db.settings.put({ key: 'dismissed-auto-tasks', value: dismissed });
                    });
                }
                db.tasks.update(task.id, {
                    completed: true,
                    status: 'completed',
                    completedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }).then(() => {
                    logAction('task-complete', 'task', task.id, task.description);
                    if (typeof driveSync !== 'undefined') driveSync.markDirty();
                    ui.showUndoToast('Task completed!', () => {
                        db.tasks.update(task.id, {
                            completed: false,
                            status: 'pending',
                            completedAt: null,
                            updatedAt: new Date().toISOString()
                        }).then(() => {
                            if (typeof driveSync !== 'undefined') driveSync.markDirty();
                            if (refreshAll) refreshAll();
                        });
                    });
                    if (refreshAll) refreshAll();
                });
            },
            onSwipeLeft: () => {
                pages.tasks.showSnoozeUI(task.id, el);
            },
            rightColor: 'var(--color-success)',
            leftColor: 'var(--color-info)',
            rightIcon: '✓',
            leftIcon: '📅',
            ignoreSelector: compact
                ? 'input[type="checkbox"]'
                : 'input[type="checkbox"], .btn--danger'
        });
    }

    return el;
}
