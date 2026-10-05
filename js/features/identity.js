// ============================================
// P20: RECORD IDENTITY (plan row 3-24; design: claude/P20_identity_design_v4.md)
// ============================================
// Every row of every synced table (except settings, which are identified by their key) carries a
// `uid`: 22 random characters made on the device that creates the row. The local numeric `id`
// stays the local key, so pages, queries and indexes don't change. Ids no longer have to match
// between the two devices: the receiving device translates every reference (studentId,
// activityId, …) from the sender's ids to its own, through the uids.
//
// INERT UNTIL THE CUTOVER. Everything here that changes how data moves between the devices runs
// only in "uid mode", which starts when the cutover tool (identityMigration.js) sets the
// sync-epoch to identity-uid-…. Before that ("id mode") the old code paths run exactly as now:
// applyPulledData, Merge import, Sync Setup Only and their previews. The one thing that happens
// from this release on is that every row made on this device gets a uid (syncHooks, non-bulk
// writes only); rows arriving by sync or import keep exactly what they bring.

const identity = {
    EPOCH_PREFIX: 'identity-uid-',
    FORMAT: 2,                 // syncFormat of a sync file or export made in uid mode
    MARK: '/f2',               // appended to the epoch id in a format-2 file (design §9 finding 2, §10.2)
    NO_UID_TABLES: ['settings', 'activityLog'],     // settings: by key; activityLog: local only
    LOCAL_IN_UID_MODE: ['activityLog', 'alerts'],   // D-a, D-d: neither uploaded nor received in uid mode

    // ── The uid ──
    // 16 random bytes as 22 characters of base64url. crypto.getRandomValues (already used for the
    // sync encryption) works on every iPad Safari the app runs on; crypto.randomUUID doesn't.
    newUid: function() {
        const b = new Uint8Array(16);
        crypto.getRandomValues(b);
        let s = '';
        for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },

    carriesUid: function(tableName) { return !this.NO_UID_TABLES.includes(tableName); },

    uidTableNames: function() { return db.tables.map(t => t.name).filter(n => this.carriesUid(n)); },

    // ── The epoch ──
    isUidEpoch: function(epoch) { return typeof epoch === 'string' && epoch.startsWith(this.EPOCH_PREFIX); },

    stripMark: function(epoch) { return typeof epoch === 'string' ? epoch.replace(/\/f2$/, '') : epoch; },

    uidMode: async function() { return this.isUidEpoch(await localSyncEpoch()); },

    // A file's settings rows with any /f2 suffix taken off the sync-epoch row (Replace All, §10.2):
    // a local database never stores the marked form.
    stripEpochRow: function(settingsRows) {
        if (!Array.isArray(settingsRows)) return settingsRows;
        return settingsRows.map(r => (r && r.key === 'sync-epoch' && r.value && typeof r.value.id === 'string' && /\/f2$/.test(r.value.id))
            ? { ...r, value: { ...r.value, id: this.stripMark(r.value.id) } } : r);
    },

    // ── Random anonymous ids for new students (D-b; uid mode only) ──
    ANON_ALPHABET: '0123456789ABCDEFGHJKMNPQRSTVWXYZ',   // Crockford base32
    newAnonId: async function() {
        const taken = new Set((await db.students.toArray()).map(s => s.anonId));
        for (let attempt = 0; attempt < 50; attempt++) {
            const b = new Uint8Array(6);
            crypto.getRandomValues(b);
            let id = 'STU-';
            for (let i = 0; i < b.length; i++) id += this.ANON_ALPHABET[b[i] & 31];
            if (!taken.has(id)) return id;
        }
        throw new Error('Could not make a new anonymous id');
    },

    // ── The reference registry (design §2): every place one record points at another ──
    // Plain fields: table → { field: target table }
    REFS: {
        students: { classId: 'classes' },
        teams: { classId: 'classes' },
        activities: { classId: 'classes' },
        assignmentTypes: { classId: 'classes' },
        enrollments: { studentId: 'students', classId: 'classes' },
        teamMembers: { teamId: 'teams', studentId: 'students' },
        teamHistory: { teamId: 'teams', studentId: 'students' },
        attendance: { studentId: 'students' },
        checkpoints: { activityId: 'activities' },
        checkpointCompletions: { checkpointId: 'checkpoints', studentId: 'students' },
        stationCheckouts: { teamId: 'teams' },
        submissions: { activityId: 'activities', studentId: 'students' },
        skillLevels: { studentId: 'students', skillId: 'skills', demonstratedIn: 'activities', mergedInto: 'skills' },
        skillObservations: { studentId: 'students', skillId: 'skills', activityId: 'activities', checkpointId: 'checkpoints', premigrationSkillId: 'skills' },
        checkouts: { itemId: 'inventory', studentId: 'students' },
        certifications: { studentId: 'students', toolId: 'inventory', activityId: 'activities', checkpointId: 'checkpoints' },
        wildcatSchedule: { studentId: 'students' },
        activityStandards: { activityId: 'activities', standardId: 'standards' },
        activitySkills: { activityId: 'activities', skillId: 'skills', mergedInto: 'skills', premigrationSkillId: 'skills' },
        notes: { activityId: 'activities', checkpointId: 'checkpoints' },
        skills: { mergedInto: 'skills' }
    },

    // Typed references: the type field says which table the id field points at
    TYPED: {
        notes: { typeField: 'entityType', idField: 'entityId', types: {
            'student': 'students', 'activity': 'activities', 'team': 'teams',
            'email-log': 'students', 'checkpoint-observation': 'students',
            'classroom-push-log': 'activities', 'feedback-log': 'students' } },
        tasks: { typeField: 'linkedEntityType', idField: 'linkedEntityId', types: {
            'student': 'students', 'team': 'teams', 'inventory': 'inventory', 'activity': 'activities' } },
        alerts: { typeField: 'linkedEntityType', idField: 'linkedEntityId', types: {
            'student': 'students', 'team': 'teams', 'inventory': 'inventory', 'activity': 'activities' } }
    },

    // Ids inside arrays and objects. '[]' = each element of an array; '{}' = each key of an object.
    NESTED: {
        activities: [
            ['skillsAssessed.[].skillId', 'skills'],
            ['skillsAssessed.[].mergedFrom.[].skillId', 'skills'],
            ['certificationsRequired.[].toolId', 'inventory'],
            ['certificationsAvailable.[].toolId', 'inventory']
        ],
        checkpoints: [['skillsAssessable.[]', 'skills'], ['certificationDemos.[]', 'inventory']],
        skills: [['migration.mergedFrom.[]', 'skills']],
        skillLevels: [
            ['migration.fromSkillIds.[]', 'skills'],
            ['migration.carriedFromSkillId', 'skills'],
            ['migration.carriedFromLevelId', 'skillLevels']
        ],
        skillObservations: [['migration.fromSkillId', 'skills'], ['migration.fromLevelId', 'skillLevels']],
        submissions: [['skillScores.{}', 'skills']]
    },

    // Ids inside strings: { field, patterns: [[regex, [target per captured id], rebuild(ids)]] }
    KEYS: {
        tasks: { field: 'autoKey', patterns: [
            [/^absence-followup-(\d+)$/, ['students'], i => `absence-followup-${i[0]}`],
            [/^low-inv-(\d+)$/, ['inventory'], i => `low-inv-${i[0]}`],
            [/^overdue-co-(\d+)$/, ['checkouts'], i => `overdue-co-${i[0]}`],
            [/^grading-needed-(\d+)$/, ['activities'], i => `grading-needed-${i[0]}`]
        ] },
        alerts: { field: 'alertKey', patterns: [
            [/^cp-behind-(\d+)-(\d+)$/, ['students', 'activities'], i => `cp-behind-${i[0]}-${i[1]}`],
            [/^team-behind-(\d+)-(\d+)$/, ['teams', 'activities'], i => `team-behind-${i[0]}-${i[1]}`],
            [/^overdue-(\d+)-(\d+)$/, ['students', 'activities'], i => `overdue-${i[0]}-${i[1]}`]
        ] }
    },

    // Settings that hold ids in their key or value (design §3.4)
    SETTINGS_KEYS: [
        [/^mastery-mode-(\d+)$/, 'classes'],
        [/^mastery-config-(\d+)$/, 'classes'],
        [/^mastery-opportunity-(\d+)$/, 'classes']
    ],

    // Property names that look like record references but aren't stored ones: external ids (Google),
    // display ids, page state and values worked out while running. For the registry test (§8.2.3).
    // alwaysOpenSkillIds lives inside a mastery-config setting and is translated there (SETTINGS_KEYS).
    NOT_RECORD_IDS: ['anonId', 'progressbookId', 'editingStudentId', 'editingSkillId', 'editingStandardId',
        'selectedClassId', '_savedActivityId', '_renderedCheckpointId', 'recordId', 'wildcatEnrolledIds',
        'studentIds', 'classStudentIds', 'activitySkillIds', 'oldIds', 'alwaysOpenSkillIds', 'courseId', 'courseWorkId', 'courseworkId', 'driveFileId', 'youtubeId', 'formSpreadsheetId',
        'topicId', 'gradeCategoryId', 'crosswalkId', 'deviceId', 'requestingDevice', 'userId', 'formId',
        'folderId', 'fileId', 'spreadsheetId', 'sheetId', 'submissionId', 'videoId', 'keptSkillId', 'foldedSkillId',
        'targetId', 'snapshotId', 'backupId', 'safetyId', 'linkedCheckpoint', 'webhookId', 'scheduleId',
        'cwId', 'materialId', 'alternateLinkId', 'eventId', 'messageId', 'threadId', 'classroomId'],

    // The same natural keys the merge and de-duplication use today (driveSync.applyPulledData)
    NATURAL_KEYS: {
        attendance: ['studentId', 'date', 'period'],
        checkpointCompletions: ['checkpointId', 'studentId'],
        submissions: ['activityId', 'studentId'],
        skillLevels: ['studentId', 'skillId'],
        skillObservations: ['studentId', 'skillId', 'activityId', 'createdAt'],
        certifications: ['studentId', 'toolId'],
        wildcatSchedule: ['studentId', 'targetDate'],
        teamMembers: ['teamId', 'studentId'],
        teamHistory: ['teamId', 'studentId', 'action', 'timestamp'],
        enrollments: ['studentId', 'period', 'schoolYear'],
        activityStandards: ['activityId', 'standardId'],
        activitySkills: ['activityId', 'skillId']
    },

    // ── Reference slots: every reference position in one row ──
    // Returns [{ path, target, get(), set(v) }]. Paths are dotted ('skillsAssessed.2.skillId'),
    // the same form _unresolved uses. Object-key slots ('{}') rename the key on set.
    slots: function(tableName, row) {
        const out = [];
        if (!row || typeof row !== 'object') return out;
        const plain = this.REFS[tableName] || {};
        for (const f of Object.keys(plain)) {
            if (!(f in row)) continue;
            out.push({ path: f, target: plain[f], get: () => row[f], set: v => { row[f] = v; } });
        }
        const typed = this.TYPED[tableName];
        if (typed) {
            const target = typed.types[row[typed.typeField]];
            if (target && (typed.idField in row)) {
                const f = typed.idField;
                out.push({ path: f, target, get: () => row[f], set: v => { row[f] = v; } });
            }
        }
        for (const [spec, target] of (this.NESTED[tableName] || [])) {
            this._walk(row, spec.split('.'), '', target, out);
        }
        return out;
    },

    _walk: function(obj, segs, prefix, target, out) {
        if (obj === null || typeof obj !== 'object') return;
        const [seg, ...rest] = segs;
        const join = k => (prefix ? prefix + '.' : '') + k;
        if (seg === '[]') {
            if (!Array.isArray(obj)) return;
            for (let i = 0; i < obj.length; i++) {
                if (rest.length === 0) out.push({ path: join(i), target, get: () => obj[i], set: v => { obj[i] = v; } });
                else this._walk(obj[i], rest, join(i), target, out);
            }
        } else if (seg === '{}') {
            if (Array.isArray(obj)) return;
            for (const k of Object.keys(obj)) {
                out.push({ path: join(k), target, key: true, get: () => k,
                    set: v => { if (v === null) return; const val = obj[k]; delete obj[k]; obj[String(v)] = val; } });
            }
        } else {
            if (!(seg in obj)) return;
            if (rest.length === 0) out.push({ path: join(seg), target, get: () => obj[seg], set: v => { obj[seg] = v; } });
            else this._walk(obj[seg], rest, join(seg), target, out);
        }
    },

    // ── Maps ──
    // idToUid / uidToId per table, keyed by String(id) (§9 finding 7: ids are stored as strings
    // and numbers).
    mapsFromRows: function(rowsByTable) {
        const idToUid = {}, uidToId = {};
        for (const [t, rows] of Object.entries(rowsByTable)) {
            if (!this.carriesUid(t)) continue;
            const a = new Map(), b = new Map();
            for (const r of rows || []) {
                if (!r || r.id == null || !r.uid) continue;
                a.set(String(r.id), r.uid);
                if (!b.has(r.uid)) b.set(r.uid, r.id);
            }
            idToUid[t] = a; uidToId[t] = b;
        }
        return { idToUid, uidToId };
    },

    // The device a file came from: 'PC' or 'iPad'
    fileDevice: function(data) {
        if (data && (data.syncDevice === 'PC' || data.syncDevice === 'iPad')) return data.syncDevice;
        const ua = String((data && data.exportDevice) || '');
        return /iPad|iPhone|iPod|Macintosh/.test(ua) && !/Windows/.test(ua) ? 'iPad' : 'PC';
    },

    time: function(r) { return String((r && (r.updatedAt || r.createdAt)) || ''); },

    // The survivor of two rows made independently for one thing: newer updatedAt, then smaller uid
    survives: function(a, b) {
        const ta = this.time(a), tb = this.time(b);
        if (ta !== tb) return ta > tb;
        return String(a.uid || '') < String(b.uid || '');
    },

    // Newer wins, with deletion one-way unless a restore is newer (#34's rule, kept)
    importWins: function(imp, loc) {
        const li = !!loc.deletedAt, ii = !!imp.deletedAt;
        if (li && !ii) return !!(imp.restoredAt && imp.restoredAt > loc.deletedAt);
        if (!li && ii) return !(loc.restoredAt && loc.restoredAt > imp.deletedAt);
        return this.time(imp) > this.time(loc);
    },

    // A reference value as a uid, or '?<device>:<id>' when it can't be resolved. side: the maps of
    // the device whose ids the value is in. Returns '' for an empty reference.
    _refUid: function(value, target, maps, device) {
        if (value === null || value === undefined || value === '') return '';
        const m = maps.idToUid[target];
        const uid = m && m.get(String(value));
        return uid || ('?' + device + ':' + String(value));
    },

    // A row's natural key in uid terms. maps/device: whose ids the row's references are in. A
    // null field with an _unresolved marker uses the marker (so orphans never collapse into one
    // key); a marker from `localDevice` is a raw id of that device. { key, unresolved }
    naturalKey: function(tableName, row, maps, device, localDevice, localMaps) {
        const fields = this.NATURAL_KEYS[tableName];
        if (!fields) return null;
        const plain = this.REFS[tableName] || {};
        let unresolved = false;
        const parts = fields.map(f => {
            const target = plain[f];
            if (!target) return String(row[f] ?? '');
            let v = row[f], m = maps, dev = device;
            if ((v === null || v === undefined) && row._unresolved && row._unresolved[f]) {
                const mk = row._unresolved[f];
                v = mk.id;
                if (mk.device === localDevice && localMaps) { m = localMaps; dev = localDevice; } else { dev = mk.device; m = { idToUid: {} }; }
            }
            const u = this._refUid(v, target, m, dev);
            if (u.startsWith('?')) unresolved = true;
            return u;
        });
        return { key: parts.join('|'), unresolved };
    },

    // Translates one row's references from the sender's ids to this device's (in place, on a copy
    // the caller owns). Unresolvable → null in the live field, raw value in _unresolved (§10.1);
    // a marker naming this device gets its raw id back. Returns the count still unresolved.
    translateRow: function(tableName, row, ctx) {
        let unresolved = 0;
        const marks = (row._unresolved && typeof row._unresolved === 'object') ? { ...row._unresolved } : {};
        for (const slot of this.slots(tableName, row)) {
            const v = slot.get();
            if (v === null || v === undefined || v === '') {
                const mk = marks[slot.path];
                if (mk && mk.device === ctx.thisDevice) { slot.set(mk.id); delete marks[slot.path]; }
                else if (mk) unresolved++;
                continue;
            }
            const local = this._resolve(v, slot.target, ctx);
            if (local !== null) {
                slot.set(typeof v === 'string' ? String(local) : local);
                delete marks[slot.path];
            } else {
                if (slot.key) {   // an object key can't be null: the entry is kept under its raw key
                    marks[slot.path] = { device: ctx.senderDevice, id: v };
                } else {
                    slot.set(null);
                    marks[slot.path] = { device: ctx.senderDevice, id: v };
                }
                unresolved++;
            }
        }
        unresolved += this._translateKey(tableName, row, marks, ctx);
        if (Object.keys(marks).length) row._unresolved = marks; else delete row._unresolved;
        return unresolved;
    },

    // sender id → uid → (survivor) → local id, or null
    _resolve: function(value, target, ctx) {
        const m = ctx.sender.idToUid[target];
        let uid = m && m.get(String(value));
        if (!uid) return null;
        const seen = new Set();
        while (ctx.survivorOf.has(uid) && !seen.has(uid)) { seen.add(uid); uid = ctx.survivorOf.get(uid); }
        const local = ctx.local.uidToId[target] && ctx.local.uidToId[target].get(uid);
        return local === undefined || local === null ? null : local;
    },

    // autoKey / alertKey
    _translateKey: function(tableName, row, marks, ctx) {
        const spec = this.KEYS[tableName];
        if (!spec) return 0;
        const v = row[spec.field];
        if (v === null || v === undefined || v === '') {
            const mk = marks[spec.field];
            if (mk && mk.device === ctx.thisDevice) { row[spec.field] = mk.id; delete marks[spec.field]; return 0; }
            return mk ? 1 : 0;
        }
        const out = this.translateKeyString(String(v), spec.patterns, ctx);
        if (out === undefined) return 0;          // not a pattern with ids: left as it is
        if (out === null) { row[spec.field] = null; marks[spec.field] = { device: ctx.senderDevice, id: v }; return 1; }
        row[spec.field] = out;
        delete marks[spec.field];
        return 0;
    },

    // Returns the translated string, null if an id in it can't be resolved, or undefined if the
    // string matches no pattern.
    translateKeyString: function(s, patterns, ctx) {
        for (const [re, targets, rebuild] of patterns) {
            const m = re.exec(s);
            if (!m) continue;
            const locals = m.slice(1).map((id, i) => this._resolve(id, targets[i], ctx));
            if (locals.some(x => x === null)) return null;
            return rebuild(locals);
        }
        return undefined;
    },

    // A settings row from the sender, translated. Returns { row, unresolved } or null to skip it.
    translateSetting: function(row, ctx) {
        const r = JSON.parse(JSON.stringify(row));
        let unresolved = 0;
        for (const [re, target] of this.SETTINGS_KEYS) {
            const m = re.exec(String(r.key));
            if (!m) continue;
            const local = this._resolve(m[1], target, ctx);
            if (local === null) return null;       // a class this device doesn't have: nothing to set
            r.key = String(r.key).slice(0, m.index + m[0].length - m[1].length) + String(local);
        }
        const v = r.value;
        const tr = (id, target) => { const l = this._resolve(id, target, ctx); if (l === null) { unresolved++; return null; } return typeof id === 'string' ? String(l) : l; };
        const trList = (list, target) => Array.isArray(list) ? list.map(id => tr(id, target)).filter(x => x !== null) : list;
        if (r.key === 'period-year-map' && v && typeof v === 'object') {
            for (const p of Object.keys(v)) {
                if (v[p] === null || v[p] === undefined || v[p] === '') continue;
                const l = tr(v[p], 'classes');
                v[p] = l;
            }
        } else if (/^mastery-config-/.test(r.key) && v && typeof v === 'object') {
            if (Array.isArray(v.alwaysOpenSkillIds)) v.alwaysOpenSkillIds = trList(v.alwaysOpenSkillIds, 'skills');
        } else if (/^mastery-opportunity-/.test(r.key) && v && typeof v === 'object') {
            if (Array.isArray(v.open)) v.open = trList(v.open, 'skills');
            if (Array.isArray(v.closed)) v.closed = trList(v.closed, 'skills');
            if (v.students && typeof v.students === 'object') {
                const out = {};
                for (const sid of Object.keys(v.students)) {
                    const l = tr(sid, 'students');
                    if (l === null) continue;
                    const so = v.students[sid] || {};
                    out[String(l)] = { ...so, open: trList(so.open, 'skills'), closed: trList(so.closed, 'skills') };
                }
                v.students = out;
            }
        } else if (r.key === 'dismissed-auto-tasks' && Array.isArray(v)) {
            r.value = v.map(k => {
                const t = this.translateKeyString(String(k), this.KEYS.tasks.patterns, ctx);
                if (t === undefined) return k;
                if (t === null) { unresolved++; return null; }
                return t;
            }).filter(x => x !== null);
        }
        return { row: r, unresolved };
    },

    // ── Uids for rows that have none (the tool's Run; before each upload; before a merge) ──
    // Runs in its own transaction under markBulk, so nothing is stamped and no upload is queued.
    // Returns the number of rows that got one.
    fillMissingUids: async function() {
        let filled = 0;
        const tables = db.tables.filter(t => this.carriesUid(t.name));
        await db.transaction('rw', tables, async () => {
            syncHooks.markBulk();
            for (const t of tables) {
                const missing = await t.filter(r => !r.uid).toArray();
                for (const r of missing) {
                    await t.update(r.id, { uid: this.newUid() });
                    filled++;
                }
            }
        });
        return filled;
    },

    // ── Format 2 (uid mode): what an upload sends ──
    // syncFormat 2, this device's name, the epoch marker; no activityLog and no alerts (D-a, D-d).
    markSyncFile: function(data) {
        this.markExport(data);
        delete data.activityLog;
        delete data.alerts;
        return data;
    },

    // An Export JSON in uid mode: the same marker (§10.2), everything else as today
    markExport: function(data) {
        data.syncFormat = this.FORMAT;
        data.syncDevice = syncThisDevice();
        if (Array.isArray(data.settings)) {
            data.settings = data.settings.map(r => (r && r.key === 'sync-epoch' && r.value && this.isUidEpoch(r.value.id) && !/\/f2$/.test(r.value.id))
                ? { ...r, value: { ...r.value, id: r.value.id + this.MARK } } : r);
        }
        return data;
    },

    // ── The merge (uid mode only): pull and Merge import (design §3.3, §9 finding 9, §10) ──
    // Translate references, then match by uid, then by natural key (survivor rule), then add.
    // A remote tombstone for a row this device never had is stored (D-c). Rows without a uid are
    // skipped and counted. Settings: by key, translated; sync-epoch and device-only settings are
    // never taken from a file. Returns a summary.
    merge: async function(data, options) {
        const mode = (options && options.mode) || 'pull';
        const thisDevice = syncThisDevice();
        const senderDevice = this.fileDevice(data);
        const s = { mode, added: 0, updated: 0, skipped: 0, unresolved: 0, skippedNoUid: 0, tombstonesStored: 0, deduped: 0, settings: 0 };
        await this.fillMissingUids();
        const uidTables = db.tables.filter(t => this.carriesUid(t.name) && !this.LOCAL_IN_UID_MODE.includes(t.name));

        await db.transaction('rw', db.tables, async () => {
            syncHooks.markBulk();   // the other device's rows keep their own timestamps
            // The sender's maps, from the file itself; this device's maps
            const fileRows = {}, localRows = {};
            for (const t of uidTables) {
                fileRows[t.name] = (Array.isArray(data[t.name]) ? data[t.name] : []).filter(r => r && typeof r === 'object');
                localRows[t.name] = await t.toArray();
            }
            const sender = this.mapsFromRows(fileRows);
            const local = this.mapsFromRows(localRows);
            const survivorOf = new Map();
            const ctx = { sender, local, survivorOf, thisDevice, senderDevice };

            // Phase A: decide, per row, without writing
            const plan = [];   // { table, rec, localId (null = new), kind }
            for (const t of uidTables) {
                const name = t.name;
                const byUid = new Map(localRows[name].filter(r => r.uid).map(r => [r.uid, r]));
                const natFields = this.NATURAL_KEYS[name];
                let byNat = null;
                if (natFields) {
                    byNat = new Map();
                    for (const r of localRows[name]) {
                        const k = this.naturalKey(name, r, local, thisDevice, thisDevice, local);
                        if (k && !k.unresolved && !byNat.has(k.key)) byNat.set(k.key, r);
                    }
                }
                const seen = new Set();
                for (const rec of fileRows[name]) {
                    if (!rec.uid) { s.skippedNoUid++; continue; }
                    if (seen.has(rec.uid)) { s.skipped++; continue; }
                    seen.add(rec.uid);
                    const loc = byUid.get(rec.uid);
                    if (loc) {
                        if (this.importWins(rec, loc)) plan.push({ table: name, rec, localId: loc.id, kind: 'updated' });
                        else s.skipped++;
                        continue;
                    }
                    if (byNat) {
                        const k = this.naturalKey(name, rec, sender, senderDevice, thisDevice, local);
                        const other = k && !k.unresolved ? byNat.get(k.key) : null;
                        if (other) {
                            // Two rows made independently for one thing: the survivor is the same on both devices
                            if (this.survives(rec, other)) {
                                survivorOf.set(other.uid, rec.uid);
                                local.uidToId[name].set(rec.uid, other.id);
                                plan.push({ table: name, rec, localId: other.id, kind: 'updated' });
                                byNat.set(k.key, { ...rec, id: other.id });
                            } else {
                                survivorOf.set(rec.uid, other.uid);
                                s.skipped++;
                            }
                            continue;
                        }
                    }
                    // New here (two new rows for one thing within the file are settled by dedupe below)
                    plan.push({ table: name, rec, localId: null, kind: 'added' });
                }
            }

            // Phase B: new rows get a local id first (a placeholder holding only the uid), so rows
            // that point at each other resolve in any order
            for (const p of plan) {
                if (p.localId !== null) continue;
                p.localId = await db.table(p.table).add({ uid: p.rec.uid });
                local.uidToId[p.table].set(p.rec.uid, p.localId);
                if (p.rec.deletedAt) s.tombstonesStored++;
            }

            // Phase C: translate and write
            for (const p of plan) {
                const row = JSON.parse(JSON.stringify(p.rec));
                s.unresolved += this.translateRow(p.table, row, ctx);
                row.id = p.localId;
                await db.table(p.table).put(row);
                s[p.kind]++;
            }

            // Settings: by key, translated (§3.4)
            const deviceOnly = (typeof syncHooks !== 'undefined' && syncHooks.DEVICE_SETTINGS) || [];
            for (const rec of (Array.isArray(data.settings) ? data.settings : [])) {
                if (!rec || typeof rec.key !== 'string') continue;
                if (rec.key === 'sync-epoch' || deviceOnly.includes(rec.key)) continue;
                const tr = this.translateSetting(rec, ctx);
                if (!tr) { s.skipped++; s.unresolved++; continue; }
                s.unresolved += tr.unresolved;
                const loc = await db.settings.get(tr.row.key);
                if (!loc || this.time(tr.row) > this.time(loc)) { await db.settings.put(tr.row); s.settings++; }
                else s.skipped++;
            }
        });

        s.deduped = await this.dedupe();
        try { if (typeof driveSync !== 'undefined') await driveSync.reconcileTeamMembers(); } catch (e) { console.error('Identity merge: team removals error', e); }
        return s;
    },

    // ── De-duplication in uid terms (§9 finding 9) ──
    // Natural-key tables: rows with the same key (references as uids) → the survivor stays, the rest
    // are deleted on this device. A row whose key has an unresolved part is never touched (§9
    // finding 3). Auto-tasks: by autoKey, same survivor rule. Returns the number deleted.
    dedupe: async function() {
        let removed = 0;
        const thisDevice = syncThisDevice();
        const all = {};
        for (const t of db.tables) if (this.carriesUid(t.name)) all[t.name] = await t.toArray();
        const local = this.mapsFromRows(all);
        await db.transaction('rw', db.tables, async () => {
            syncHooks.markBulk();
            for (const name of Object.keys(this.NATURAL_KEYS)) {
                if (!all[name]) continue;
                const groups = new Map();
                for (const r of all[name]) {
                    const k = this.naturalKey(name, r, local, thisDevice, thisDevice, local);
                    if (!k || k.unresolved) continue;
                    if (!groups.has(k.key)) groups.set(k.key, []);
                    groups.get(k.key).push(r);
                }
                for (const [, rows] of groups) {
                    if (rows.length < 2) continue;
                    let best = rows[0];
                    for (const r of rows.slice(1)) if (this.survives(r, best)) best = r;
                    for (const r of rows) if (r !== best) { await db.table(name).delete(r.id); removed++; }
                }
            }
            const byKey = new Map();
            for (const task of (all.tasks || [])) {
                if (!task.autoKey) continue;
                if (!byKey.has(task.autoKey)) byKey.set(task.autoKey, []);
                byKey.get(task.autoKey).push(task);
            }
            for (const [, tasks] of byKey) {
                if (tasks.length < 2) continue;
                let best = tasks[0];
                for (const t of tasks.slice(1)) if (this.survives(t, best)) best = t;
                for (const t of tasks) if (t !== best) { await db.tasks.delete(t.id); removed++; }
            }
        });
        return removed;
    },

    // ── Counts for Preview, Verify and the Data check (design §4, §8.1 D-b, §9 finding 8) ──
    unresolvedCount: async function() {
        let n = 0;
        for (const t of db.tables) {
            if (!this.carriesUid(t.name)) continue;
            await t.each(r => { if (r._unresolved && typeof r._unresolved === 'object') n += Object.keys(r._unresolved).length; });
        }
        return n;
    },

    standingCounts: async function() {
        const live = rows => rows.filter(r => !r.deletedAt);
        const dupes = (rows, keyOf) => {
            const seen = new Map();
            for (const r of rows) { const k = keyOf(r); if (!k) continue; seen.set(k, (seen.get(k) || 0) + 1); }
            let n = 0; for (const c of seen.values()) if (c > 1) n += c;
            return n;
        };
        const norm = s => String(s || '').trim().toLowerCase();
        const acts = live(await db.activities.toArray());
        return {
            contractCodes: dupes(acts, a => norm(a.contractCode)),
            skillNames: dupes(live(await db.skills.toArray()).filter(s => !s.retiredAt), s => norm(s.name)),
            inventoryNames: dupes(live(await db.inventory.toArray()), i => norm(i.name)),
            anonIds: dupes(live(await db.students.toArray()), s => s.anonId || '')
        };
    },

    standingLines: async function() {
        const c = await this.standingCounts();
        return [
            `Live activities sharing a contract code: ${c.contractCodes}`,
            `Skills sharing a name: ${c.skillNames}`,
            `Inventory items sharing a name: ${c.inventoryNames}`,
            `Students sharing an anonId: ${c.anonIds}`
        ];
    }
};
