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

// Open the database
db.open().then(() => {
    console.log('Database initialized successfully');

}).catch((err) => {
    console.error('Failed to open database:', err);
});
