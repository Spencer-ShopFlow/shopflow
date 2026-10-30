// ===== Backup DB (separate Dexie database) =====
const backupDb = new Dexie("EngineeringSecondBrain_Backups");
backupDb.version(1).stores({
    backups: "++id, createdAt, label"
});
backupDb.version(2).stores({
    backups: "++id, createdAt, label, slot, data"
});
// v3 (8 Oct 2026): no index on `data`. Indexing it made every snapshot (a full copy of every
// table) an index key, and Chrome's database files grew to gigabytes until Chrome 154 could no
// longer open them. Nothing looks snapshots up by `data`: only by id, by createdAt, or all of them.
backupDb.version(3).stores({
    backups: "++id, createdAt, label, slot"
});

// ============================================
// DATABASE MODULE (IndexedDB with Dexie.js)
// ============================================

const db = new Dexie('EngineeringSecondBrain');

// Define database schema
db.version(1).stores({
    students: '++id, name, engYear, wildcatTeacher, status, createdAt',
    teachers: '++id, lastName, email',
    enrollments: '++id, studentId, period, createdAt',  
    teams: '++id, name, engYear, period, createdAt',
    teamMembers: '++id, teamId, studentId',
    attendance: '++id, [date+period], [studentId+date+period], studentId, date, period, status, createdAt',
    activities: '++id, name, engYear, startDate, endDate, status, createdAt',
    checkpoints: '++id, activityId, number, title, suggestedDate, createdAt',
    checkpointCompletions: '++id, [checkpointId+studentId], checkpointId, studentId, completed, createdAt',
    stationCheckouts: '++id, [date+teamId], date, period, teamId, status, notes, createdAt',
    submissions: '++id, activityId, studentId, status, submittedAt',
    skills: '++id, name, category, createdAt',
    skillLevels: '++id, studentId, skillId, level, createdAt',
    inventory: '++id, name, category, quantity, threshold, createdAt',
    checkouts: '++id, itemId, studentId, checkedOutAt, returnedAt',
    certifications: '++id, studentId, toolId, certifiedAt',
    tasks: '++id, description, dueDate, status, priority, type, createdAt',
    notes: '++id, entityType, entityId, content, createdAt',
    events: '++id, title, date, category, createdAt',
    scheduleConfig: '++id, name, isActive, periods, createdAt',
    settings: 'key, value'
});

db.version(2).stores({
    classes: '++id, name, color, createdAt'
});

db.version(3).stores({
    students: '++id, name, engYear, classId, status',
    teams: '++id, name, engYear, classId, period, createdAt',
    activities: '++id, name, engYear, classId, startDate, endDate, status, createdAt'
});

db.version(4).stores({
    students: '++id, name, classId, status',
    teams: '++id, name, classId, period, createdAt',
    activities: '++id, name, classId, startDate, endDate, status, createdAt'
});

db.version(5).stores({
    enrollments: '++id, studentId, period, schoolYear, createdAt'
});

db.version(6).stores({
    wildcatSchedule: '++id, studentId, targetDate, status, createdAt'
});

db.version(7).stores({
    assignmentTypes: '++id, classId, name, createdAt'
});

db.version(8).stores({
    standards: '++id, name, code, category, createdAt',
    activityStandards: '++id, activityId, standardId',
    activitySkills: '++id, activityId, skillId'
});

db.version(9).stores({
    alerts: '++id, alertKey, type, linkedEntityType, linkedEntityId, createdAt'
}).upgrade(tx => {
    // One-time cleanup: remove old auto-tasks that are now handled by the alerts system.
    // These old tasks had autoKeys starting with: cp-behind-, team-behind-, overdue-, absence-catchup-
    // The new system uses the alerts table for cp-behind/team-behind/overdue,
    // and absence-followup-{studentId} for the new absence follow-up tasks.
    return tx.table('tasks').toCollection().modify((task, ref) => {
        if (task.type === 'auto' && task.autoKey && !task.completed) {
            if (task.autoKey.startsWith('cp-behind-') ||
                task.autoKey.startsWith('team-behind-') ||
                task.autoKey.startsWith('overdue-') ||
                task.autoKey.startsWith('absence-catchup-')) {
                delete ref.value; // removes the record
            }
        }
    });
});
db.version(10).stores({
    activityLog: '++id, action, entityType, timestamp'
});
db.version(11).stores({
    students: '++id, classId, status, firstName, lastName, anonId, deletedAt'
}).upgrade(async tx => {
    // --- Part A: Migrate name → firstName + lastName ---
    await tx.table('students').toCollection().modify(student => {
        if (student.firstName && student.lastName) return; // Already migrated
        const name = student.name || '';
        if (name.includes(',')) {
            // "Smith, John" format
            const parts = name.split(',').map(s => s.trim());
            student.lastName = parts[0];
            student.firstName = parts.slice(1).join(' ');
        } else {
            // "John Smith" format (or single name)
            const parts = name.trim().split(/\s+/);
            if (parts.length === 1) {
                student.firstName = parts[0];
                student.lastName = '';
            } else {
                student.firstName = parts.slice(0, -1).join(' ');
                student.lastName = parts[parts.length - 1];
            }
        }
    });

    // --- Part B: Generate anonymous IDs for all existing students ---
    const allStudents = await tx.table('students').toArray();
    // Sort by ID to assign deterministic anon IDs
    allStudents.sort((a, b) => a.id - b.id);
    let counter = 1;
    for (const student of allStudents) {
        if (!student.anonId) {
            const padded = String(counter).padStart(4, '0');
            await tx.table('students').update(student.id, {
                anonId: `STU-${padded}`
            });
            counter++;
        }
    }

    // Store the counter so new students get the next number
    await tx.table('settings').put({
        key: 'anon-id-counter',
        value: counter
    });
});

db.version(12).stores({}).upgrade(tx => {
    return tx.table('activities').toCollection().modify(activity => {
        if (!activity.materials) {
            activity.materials = [];
        }
    });
});

db.version(13).stores({
    teamHistory: '++id, teamId, studentId, action, timestamp'
});

db.version(14).stores({
    enrollments: '++id, studentId, period, schoolYear, [studentId+period+schoolYear], createdAt'
});

db.version(15).stores({
    skillObservations: '++id, [studentId+skillId], studentId, skillId, activityId'
}).upgrade(tx => {
    // Sprint 19.1: Rename "Novice" → "Beginning" in all existing skillLevels records
    return tx.table('skillLevels').toCollection().modify(record => {
        if (record.level === 'Novice') {
            record.level = 'Beginning';
        }
    });
});

// P20 (plan row 3-24): a plain `uid` index on every synced table except settings (identified by
// its key) and activityLog (local only). Index only: no .upgrade(), so no row is rewritten. Rows
// without a uid simply aren't in the index; the cutover tool fills them in on the PC.
db.version(16).stores({
    students: '++id, classId, status, firstName, lastName, anonId, deletedAt, uid',
    teachers: '++id, lastName, email, uid',
    enrollments: '++id, studentId, period, schoolYear, [studentId+period+schoolYear], createdAt, uid',
    teams: '++id, name, classId, period, createdAt, uid',
    teamMembers: '++id, teamId, studentId, uid',
    attendance: '++id, [date+period], [studentId+date+period], studentId, date, period, status, createdAt, uid',
    activities: '++id, name, classId, startDate, endDate, status, createdAt, uid',
    checkpoints: '++id, activityId, number, title, suggestedDate, createdAt, uid',
    checkpointCompletions: '++id, [checkpointId+studentId], checkpointId, studentId, completed, createdAt, uid',
    stationCheckouts: '++id, [date+teamId], date, period, teamId, status, notes, createdAt, uid',
    submissions: '++id, activityId, studentId, status, submittedAt, uid',
    skills: '++id, name, category, createdAt, uid',
    skillLevels: '++id, studentId, skillId, level, createdAt, uid',
    inventory: '++id, name, category, quantity, threshold, createdAt, uid',
    checkouts: '++id, itemId, studentId, checkedOutAt, returnedAt, uid',
    certifications: '++id, studentId, toolId, certifiedAt, uid',
    tasks: '++id, description, dueDate, status, priority, type, createdAt, uid',
    notes: '++id, entityType, entityId, content, createdAt, uid',
    events: '++id, title, date, category, createdAt, uid',
    scheduleConfig: '++id, name, isActive, periods, createdAt, uid',
    classes: '++id, name, color, createdAt, uid',
    wildcatSchedule: '++id, studentId, targetDate, status, createdAt, uid',
    assignmentTypes: '++id, classId, name, createdAt, uid',
    standards: '++id, name, code, category, createdAt, uid',
    activityStandards: '++id, activityId, standardId, uid',
    activitySkills: '++id, activityId, skillId, uid',
    alerts: '++id, alertKey, type, linkedEntityType, linkedEntityId, createdAt, uid',
    teamHistory: '++id, teamId, studentId, action, timestamp, uid',
    skillObservations: '++id, [studentId+skillId], studentId, skillId, activityId, uid'
});

// Open the database
db.open().then(() => {
    console.log('Database initialized successfully');

}).catch((err) => {
    console.error('Failed to open database:', err);
});

// ===== Who Notify Teachers has emailed, per day (i314) =====
// One settings row per day: { key: 'wildcat-notified-<YYYY-MM-DD>', value: { date, studentIds: ['12', …] } }.
// Student ids only, no names or emails. It syncs like every settings row (updatedAt, matched on key),
// except that two copies of the same day are merged by joining their lists (driveSync.applyPulledData):
// a student emailed from either device counts as emailed. Ids are only ever added, never removed.
const rosterNotified = {
    PREFIX: 'wildcat-notified-',

    key: function(date) { return this.PREFIX + date; },

    isKey: function(key) { return typeof key === 'string' && key.startsWith(this.PREFIX); },

    idsOf: function(rec) {
        const ids = rec && rec.value && Array.isArray(rec.value.studentIds) ? rec.value.studentIds : [];
        return ids.map(String);
    },

    // The ids already emailed on that day (a Set of strings)
    get: async function(date) {
        return new Set(this.idsOf(await db.settings.get(this.key(date))));
    },

    // Adds ids to the day's record; re-reads it first, so ids a sync brought in meanwhile stay
    add: async function(date, ids) {
        await db.transaction('rw', db.settings, async () => {
            const key = this.key(date);
            const all = new Set(this.idsOf(await db.settings.get(key)));
            ids.forEach(id => all.add(String(id)));
            await db.settings.put({ key, value: { date, studentIds: [...all].sort() }, updatedAt: new Date().toISOString() });
        });
    },

    // Sync: the same day's record from both devices. Returns the joined record (newest updatedAt,
    // both lists), or null when the local one already holds everything.
    merge: function(localRec, importRec) {
        const local = this.idsOf(localRec);
        const all = new Set(local);
        this.idsOf(importRec).forEach(id => all.add(id));
        if (all.size === local.length) return null;
        const localTime = localRec.updatedAt || '';
        const importTime = importRec.updatedAt || '';
        const date = (localRec.value && localRec.value.date) || (importRec.value && importRec.value.date) || localRec.key.slice(this.PREFIX.length);
        return { key: localRec.key, value: { date, studentIds: [...all].sort() }, updatedAt: importTime > localTime ? importTime : localTime };
    }
};
