// ============================================
// APP INITIALIZATION
// ============================================

//Encryption of data storage
const secureStorage = {
    // i239: the sync uploads write the encrypted bytes as base64 ("compact"). The old form writes
    // each byte as a JSON number (about 3.6 characters a byte), which took both devices' uploads to
    // Google's 50 MB limit. Export JSON keeps the old form, so any version can import an export.
    // decrypt reads both forms.
    NEWER_FORMAT_MESSAGE: "The other device's Drive copy was saved by a newer ShopFlow. Close and reopen ShopFlow on this device so it updates, then try again. Nothing was changed.",

    _toBase64(bytes) {
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
            s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return btoa(s);
    },

    _fromBase64(text) {
        const s = atob(text);
        const out = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out;
    },

    // options.compact: the base64 form (sync uploads only)
    async encrypt(text, password, options) {
        const enc = new TextEncoder();
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        
        const keyMaterial = await window.crypto.subtle.importKey(
            "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
        );
        const key = await window.crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
            keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
        );
        
        const encrypted = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv }, key, enc.encode(text)
        );
        
        // Return a package with the locked data and the "keyholes" (salt & iv) needed to unlock it
        if (options && options.compact) {
            return JSON.stringify({
                isEncrypted: true,
                encoding: 'base64',
                salt: secureStorage._toBase64(salt),
                iv: secureStorage._toBase64(iv),
                data: secureStorage._toBase64(new Uint8Array(encrypted))
            });
        }
        return JSON.stringify({
            isEncrypted: true,
            salt: Array.from(salt),
            iv: Array.from(iv),
            data: Array.from(new Uint8Array(encrypted))
        });
    },

    async decrypt(jsonString, password) {
        const parsed = JSON.parse(jsonString);
        
        // If it's an old, unencrypted backup, just return the data normally
        if (!parsed.isEncrypted) return jsonString; 
        
        let salt, iv, data;
        if (parsed.encoding === undefined) {
            salt = new Uint8Array(parsed.salt);
            iv = new Uint8Array(parsed.iv);
            data = new Uint8Array(parsed.data);
        } else if (parsed.encoding === 'base64') {
            salt = secureStorage._fromBase64(parsed.salt);
            iv = secureStorage._fromBase64(parsed.iv);
            data = secureStorage._fromBase64(parsed.data);
        } else {
            // A form a newer ShopFlow wrote: say so, rather than blame the password
            const err = new Error('Unknown encrypted form: ' + parsed.encoding);
            err.newerFormat = true;
            throw err;
        }
        
        const enc = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey(
            "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
        );
        const key = await window.crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
            keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
        );
        
        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv }, key, data
        );
        
        const dec = new TextDecoder();
        return dec.decode(decrypted);
    }
};
// ============================================
// AUTO-BACKUP SYSTEM
// Saves a snapshot at noon and 4pm each day.
// Keeps 14 snapshots (2 per day for 7 days).
// ============================================
const autoBackup = {
    MAX_BACKUPS: 14,

    async save(slot) {
        try {
            const data = {};
            for (const table of db.tables) {
                data[table.name] = await table.toArray();
            }
            data.exportDate = new Date().toISOString();

            const label = `${new Date().toLocaleDateString('en-US', { 
                weekday: 'short', month: 'short', day: 'numeric' 
            })} — ${slot === 'noon' ? '12:00 PM' : '4:00 PM'}`;

            await backupDb.backups.add({
                createdAt: new Date().toISOString(),
                localDate: getTodayString(),
                label: label,
                slot: slot,
                data: JSON.stringify(data)
            });

            const all = await backupDb.backups.orderBy('createdAt').toArray();
            if (all.length > this.MAX_BACKUPS) {
                const toDelete = all.slice(0, all.length - this.MAX_BACKUPS);
                for (const backup of toDelete) {
                    await backupDb.backups.delete(backup.id);
                }
            }

            console.log(`✅ Auto-backup saved: ${label}`);
            return true;
        } catch (err) {
            console.error('Auto-backup failed:', err);
            return false;
        }
    },

    // A labelled snapshot taken just before a risky change (plan row 1-01). Returns the new backup's id, or null.
    async saveSafety(what) {
        try {
            const data = {};
            for (const table of db.tables) {
                data[table.name] = await table.toArray();
            }
            data.exportDate = new Date().toISOString();
            const label = `${what} — ${new Date().toLocaleString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
            })}`;
            const id = await backupDb.backups.add({
                createdAt: new Date().toISOString(),
                localDate: getTodayString(),
                label: label,
                slot: 'safety',
                data: JSON.stringify(data)
            });
            const all = await backupDb.backups.orderBy('createdAt').toArray();
            if (all.length > this.MAX_BACKUPS) {
                for (const b of all.slice(0, all.length - this.MAX_BACKUPS)) {
                    if (b.id !== id) await backupDb.backups.delete(b.id);
                }
            }
            return id;
        } catch (err) {
            console.error('Safety snapshot failed:', err);
            return null;
        }
    },

    async alreadyRanToday(slot) {
        const today = getTodayString();
        const all = await backupDb.backups.toArray();
        // Compare local dates: createdAt is UTC, so after 8 PM Eastern it reads as tomorrow
        return all.some(b => b.slot === slot &&
            (b.localDate || formatDateString(new Date(b.createdAt))) === today);
    },

    async runIfDue() {
        const now = new Date();
        const hour = now.getHours();

        if (hour >= 12 && !(await this.alreadyRanToday('noon'))) {
            await this.save('noon');
        }

        if (hour >= 16 && !(await this.alreadyRanToday('4pm'))) {
            await this.save('4pm');
        }
    },

    async restore(backupId) {
        try {
            const backup = await backupDb.backups.get(backupId);
            if (!backup || !backup.data) {
                ui.showToast('Backup not found.', 'error');
                return;
            }

            const safetyData = {};
            for (const table of db.tables) {
                safetyData[table.name] = await table.toArray();
            }
            safetyData.exportDate = new Date().toISOString();

            const safetyLabel = `Before restore — ${new Date().toLocaleString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit'
            })}`;

            await backupDb.backups.add({
                createdAt: new Date().toISOString(),
                label: safetyLabel,
                slot: 'safety',
                data: JSON.stringify(safetyData)
            });

            const all = await backupDb.backups.orderBy('createdAt').toArray();
            if (all.length > this.MAX_BACKUPS) {
                const toDelete = all.slice(0, all.length - this.MAX_BACKUPS);
                for (const b of toDelete) {
                    await backupDb.backups.delete(b.id);
                }
            }

            const data = JSON.parse(backup.data);

            await db.transaction('rw', db.tables, async () => {
                for (const table of db.tables) {
                    await table.clear();
                    if (data[table.name] && Array.isArray(data[table.name])) {
                        await table.bulkAdd(data[table.name]);
                    }
                }
            });

            ui.showToast(`Restored to: ${backup.label}. Reloading...`, 'success');
            setTimeout(() => window.location.reload(), 1200);
        } catch (err) {
            console.error('Restore failed:', err);
            ui.showToast('Restore failed — backup may be corrupted.', 'error');
        }
    },

    async renderList(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const all = await backupDb.backups.orderBy('createdAt').reverse().toArray();

        if (all.length === 0) {
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">No auto-backups yet. Open the app at noon or after 4pm to generate one.</p>';
            return;
        }

        container.innerHTML = '';
        all.forEach(backup => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-md); margin-bottom: var(--space-xs);';
            row.innerHTML = `
                <div>
                    <span style="font-weight: 500;">${escapeHtml(backup.label)}</span>
                </div>
                <button class="btn btn--secondary" style="font-size: var(--font-size-body-small); padding: var(--space-xs) var(--space-sm);"
                    onclick="autoBackup.confirmRestore(${backup.id})">
                    Restore
                </button>
            `;
            container.appendChild(row);
        });
    },

    async confirmRestore(backupId) {
        const backup = await backupDb.backups.get(backupId);
        if (!backup) {
            ui.showToast('Backup not found.', 'error');
            return;
        }

        const confirmed = confirm(
            `⚠️ Restore to: "${backup.label}"?\n\n` +
            `This will REPLACE all current data with that snapshot.\n` +
            `Any changes made after that snapshot will be lost.\n\n` +
            `Your current data will be saved as a safety snapshot first, ` +
            `so you can undo this if needed.\n\n` +
            `Click OK to proceed.`
        );

        if (confirmed) {
            this.restore(backupId);
        }
    }
};

// =============================================
// GOOGLE DRIVE AUTO-SYNC (Sprint 8)
// Pushes encrypted backup to Drive after data changes.
// Pulls from other device on app load — silently, no page refresh.
// =============================================

// A sync request that gives up after SYNC_TIMEOUT_MS instead of hanging, so Sync Now
// always reaches its result message (plan row 1-14, i077).
const SYNC_TIMEOUT_MS = 120000;
async function syncFetch(url, options) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS) : null;
    try {
        // 2-04: retries once when the reply is lost; a lost reply comes back as status 'error'
        return await webhookFetch(url, controller ? { ...options, signal: controller.signal } : options);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

const driveSync = {
    _dirty: false,
    _timer: null,
    _pushing: false,
    _pendingMerge: null, // Holds pulled data if a form is open
    _pendingMergeTs: null, // The other device's timestamp for that pending data
    _changeSeq: 0,       // Counts markDirty calls, so an edit made during an upload isn't lost (plan row 1-14)
    _retryMs: 0,         // Current wait before retrying a failed upload (grows, capped)
    DEBOUNCE_MS: 30000,  // 30 seconds after last change
    RETRY_MIN_MS: 60000,
    RETRY_MAX_MS: 15 * 60000,

    markDirty: function() {
        if (localStorage.getItem('drive-sync-enabled') !== 'true') return;
        this._dirty = true;
        this._changeSeq++;
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.push(), this.DEBOUNCE_MS);
    },

    // The file an upload sends: every table, schemaVersion, exportDate and the webhook addresses.
    // Upload only (P16 N4) sends exactly the same file.
    buildSyncFile: async function() {
        const data = {};
        for (const table of db.tables) {
            data[table.name] = await table.toArray();
        }
        data.schemaVersion = db.verno;
        data.appVersion = '1.0';
        data.exportDate = new Date().toISOString();
        data.exportDevice = navigator.userAgent;

        data.webhooks = {};
        ['wildcat', 'absent'].forEach(type => {
            const url = localStorage.getItem(`webhook_${type}`);
            if (url) data.webhooks[type] = url;
        });
        return data;
    },

    // P16 N6: the message when the other device's copy is from the other side of a sync epoch
    epochRefusalMessage: function(localEpoch, remoteEpoch) {
        const other = syncThisDevice() === 'iPad' ? 'PC' : 'iPad';
        if (localEpoch && !remoteEpoch) {
            return `Sync paused: the ${other}'s Drive copy is from before the skills migration. Nothing was changed. On that device, use Upload only (sync off) after it has been re-seeded.`;
        }
        if (!localEpoch && remoteEpoch) {
            return `Sync paused: the ${other}'s Drive copy is from after the skills migration, and this device is from before it. Nothing was changed. Re-seed this device from the migrated export (Import JSON → Replace All), then use Upload only (sync off).`;
        }
        return `Sync paused: the ${other}'s Drive copy (${remoteEpoch}) and this device (${localEpoch}) are from different sync events. Nothing was changed.`;
    },

    // Records (or clears) the "Sync paused" message, shown on the sync card and the Data check
    setSyncPaused: function(message) {
        if (message) localStorage.setItem('drive-sync-paused', message);
        else localStorage.removeItem('drive-sync-paused');
        this.updateSyncStatusUI();
    },

    // Returns true if this call uploaded successfully.
    push: async function() {
        if (!this._dirty || this._pushing) return false;
        if (!navigator.onLine) return false;

        const syncEnabled = localStorage.getItem('drive-sync-enabled') === 'true';
        const syncPassword = localStorage.getItem('drive-sync-password');
        if (!syncEnabled || !syncPassword) return false;

        const webhookUrl = localStorage.getItem('webhook_absent') ||
                            localStorage.getItem('webhook_wildcat');
        const webhookToken = localStorage.getItem('webhook_token');
        if (!webhookUrl || !webhookToken) return false;

        this._pushing = true;
        // Changes made after this point are not in this upload, so they must stay dirty (push race, DL13)
        const seqAtStart = this._changeSeq;
        let ok = false;

        try {
            const data = await this.buildSyncFile();
            const rawJson = JSON.stringify(data);
            const encryptedJson = await secureStorage.encrypt(rawJson, syncPassword, { compact: true });
            const deviceId = syncThisDevice();

            const response = await syncFetch(webhookUrl, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'save_to_drive',
                    token: webhookToken,
                    encryptedData: encryptedJson,
                    deviceId: deviceId,
                    timestamp: new Date().toISOString(),
                    schemaVersion: db.verno
                })
            });

            const result = await response.json();
            if (result.status === 'success') {
                ok = true;
                // Only clean if nothing changed while uploading; otherwise the next cycle uploads the newer data
                if (this._changeSeq === seqAtStart) this._dirty = false;
                localStorage.setItem('last-drive-sync-push', new Date().toISOString());
                this.updateSyncStatusUI();
                console.log('Drive sync: pushed successfully');
            } else {
                console.error('Drive sync push returned error:', result.message);
            }
        } catch (err) {
            console.error('Drive sync push failed:', err);
        } finally {
            this._pushing = false;
            // Anything still unsent gets another try: the normal delay after a success,
            // a growing delay (1 min, doubling, at most 15 min) after a failure.
            if (ok) this._retryMs = 0;
            else this._retryMs = Math.min(this.RETRY_MAX_MS, Math.max(this.RETRY_MIN_MS, this._retryMs * 2));
            if (this._dirty) {
                clearTimeout(this._timer);
                this._timer = setTimeout(() => this.push(), ok ? this.DEBOUNCE_MS : this._retryMs);
            }
        }
        return ok;
    },

    /**
     * Checks if a form is currently open/dirty.
     * Returns true if it's safe to apply pulled data.
     */
    isIdle: function() {
        // Check for any open modals or forms with unsaved data
        const openModal = document.querySelector('.modal-backdrop:not(.hidden)');
        if (openModal) return false;
        // Check for any focused input/textarea (user is actively typing)
        const focused = document.activeElement;
        if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.tagName === 'SELECT')) return false;
        return true;
    },

    /**
     * Apply pulled data silently — no page refresh.
     * Uses the same merge logic as executeImport.
     */
    // remoteTimestamp: the other device's own clock time for this data (plan row 1-14, pull clock)
    // Returns 'applied', 'refused' (the copy is from the other side of a sync epoch) or 'failed'.
    applyPulledData: async function(data, remoteTimestamp) {
        try {
            // P16 N6: never merge a copy from the other side of the skills migration. Change nothing,
            // keep the pull clock as it is, and drop any queued copy.
            const localEpoch = await localSyncEpoch();
            const remoteEpoch = syncEpochOf(data);
            if (localEpoch !== remoteEpoch) {
                this._pendingMerge = null;
                this._pendingMergeTs = null;
                const msg = this.epochRefusalMessage(localEpoch, remoteEpoch);
                this.setSyncPaused(msg);
                console.warn('Drive sync: ' + msg);
                return 'refused';
            }

            let added = 0, updated = 0, skipped = 0;

            const naturalKeys = {
                attendance: ['studentId', 'date', 'period'],
                checkpointCompletions: ['checkpointId', 'studentId'],
                submissions: ['activityId', 'studentId'],
                skillLevels: ['studentId', 'skillId'],
                // i162: ratings match on the same key Replace All and Merge import use, not on id.
                // Both devices hand out the same ids (after the re-seed, the same next id), so by
                // id one device's new rating could overwrite the other's (FF4).
                skillObservations: ['studentId', 'skillId', 'activityId', 'createdAt'],
                certifications: ['studentId', 'toolId'],
                wildcatSchedule: ['studentId', 'targetDate'],
                teamMembers: ['teamId', 'studentId'],
                enrollments: ['studentId', 'period', 'schoolYear'],
                settings: ['key'],
                activityStandards: ['activityId', 'standardId'],
                activitySkills: ['activityId', 'skillId']
            };

            await db.transaction('rw', db.tables, async () => {
                for (const table of db.tables) {
                    const tableName = table.name;
                    if (tableName === 'activityLog') continue;
                    const importRecords = data[tableName];
                    if (!importRecords || !Array.isArray(importRecords) || importRecords.length === 0) continue;

                    const primaryKey = table.schema.primKey.keyPath;
                    const natKey = naturalKeys[tableName];

                    if (natKey) {
                        const localRecords = await table.toArray();
                        const makeNatKeyStr = (rec) => natKey.map(f => String(rec[f] ?? '')).join('|');
                        const localMap = new Map();
                        localRecords.forEach(r => localMap.set(makeNatKeyStr(r), r));

                        for (const importRec of importRecords) {
                            const natKeyStr = makeNatKeyStr(importRec);
                            const localRec = localMap.get(natKeyStr);

                            if (!localRec) {
                                const recCopy = { ...importRec };
                                if (primaryKey === '++id' || table.schema.primKey.auto) {
                                    // i162: a rating keeps the other device's id when that id is free here,
                                    // so ids drift apart as little as possible (a device still on the old,
                                    // by-id code then overwrites less)
                                    const keepId = tableName === 'skillObservations' && recCopy.id != null && !(await table.get(recCopy.id));
                                    if (!keepId) delete recCopy.id;
                                }
                                await table.add(recCopy);
                                added++;
                            } else {
                                const importTime = importRec.updatedAt || importRec.createdAt || '';
                                const localTime = localRec.updatedAt || localRec.createdAt || '';
                                if (importTime > localTime) {
                                    const recCopy = { ...importRec };
                                    recCopy[primaryKey] = localRec[primaryKey];
                                    await table.put(recCopy);
                                    updated++;
                                } else {
                                    skipped++;
                                }
                            }
                        }
                    } else {
                        for (const importRec of importRecords) {
                            const recKey = importRec[primaryKey];
                            if (recKey === undefined) continue;
                            const localRec = await table.get(recKey);
                            if (!localRec) {
                                // Don't resurrect permanently-deleted records
                                if (importRec.deletedAt) {
                                    skipped++;
                                } else {
                                    await table.put(importRec);
                                    added++;
                                }
                            } else {
                                // Deletion is a one-way door: if either side has deletedAt, deleted wins
                                const localDeleted = !!localRec.deletedAt;
                                const importDeleted = !!importRec.deletedAt;
                                if (localDeleted && !importDeleted) {
                                    skipped++; // local is deleted, don't resurrect
                                } else if (!localDeleted && importDeleted) {
                                    await table.put(importRec); // propagate deletion from remote
                                    updated++;
                                } else {
                                    // Both alive or both deleted — normal timestamp wins
                                    const importTime = importRec.updatedAt || importRec.createdAt || '';
                                    const localTime = localRec.updatedAt || localRec.createdAt || '';
                                    if (importTime > localTime) {
                                        await table.put(importRec);
                                        updated++;
                                    } else {
                                        skipped++;
                                    }
                                }
                            }
                        }
                    }
                }
            });

            // Post-merge deduplication
            try {
                const dedupeNaturalKeys = {
                    attendance: ['studentId', 'date', 'period'],
                    checkpointCompletions: ['checkpointId', 'studentId'],
                    submissions: ['activityId', 'studentId'],
                    skillLevels: ['studentId', 'skillId'],
                    skillObservations: ['studentId', 'skillId', 'activityId', 'createdAt'],   // i162
                    certifications: ['studentId', 'toolId'],
                    wildcatSchedule: ['studentId', 'targetDate'],
                    teamMembers: ['teamId', 'studentId'],
                    enrollments: ['studentId', 'period', 'schoolYear'],
                    settings: ['key'],
                    activityStandards: ['activityId', 'standardId'],
                    activitySkills: ['activityId', 'skillId']
                };

                let totalDeduped = 0;
                for (const [tableName, keyFields] of Object.entries(dedupeNaturalKeys)) {
                    const table = db.table(tableName);
                    if (!table) continue;
                    const allRecords = await table.toArray();
                    if (allRecords.length === 0) continue;
                    const groups = new Map();
                    for (const rec of allRecords) {
                        const key = keyFields.map(f => String(rec[f] ?? '')).join('|');
                        if (!groups.has(key)) groups.set(key, [rec]);
                        else groups.get(key).push(rec);
                    }
                    for (const [, records] of groups) {
                        if (records.length <= 1) continue;
                        records.sort((a, b) => {
                            const timeA = a.updatedAt || a.createdAt || '';
                            const timeB = b.updatedAt || b.createdAt || '';
                            return timeB.localeCompare(timeA);
                        });
                        for (let i = 1; i < records.length; i++) {
                            await table.delete(records[i].id);
                            totalDeduped++;
                        }
                    }
                }
                if (totalDeduped > 0) {
                    console.log(`Drive sync: removed ${totalDeduped} duplicate record(s)`);
                }
            } catch (e) {
                console.error('Drive sync: deduplication error', e);
            }

            // Task-specific deduplication by autoKey
            // Auto-tasks can be independently generated on both devices with different IDs.
            // When synced, both copies exist. Dedupe by autoKey, keeping the newest (which
            // may be the completed version).
            try {
                const allTasks = await db.tasks.toArray();
                const autoKeyGroups = new Map();
                for (const task of allTasks) {
                    if (!task.autoKey) continue;
                    if (!autoKeyGroups.has(task.autoKey)) autoKeyGroups.set(task.autoKey, []);
                    autoKeyGroups.get(task.autoKey).push(task);
                }
                let taskDeduped = 0;
                for (const [, tasks] of autoKeyGroups) {
                    if (tasks.length <= 1) continue;
                    // Newest updatedAt wins — whether completed or pending
                    tasks.sort((a, b) => {
                        const timeA = a.updatedAt || a.createdAt || '';
                        const timeB = b.updatedAt || b.createdAt || '';
                        return timeB.localeCompare(timeA);
                    });
                    // Keep the first (winner), delete the rest
                    for (let i = 1; i < tasks.length; i++) {
                        await db.tasks.delete(tasks[i].id);
                        taskDeduped++;
                    }
                }
                if (taskDeduped > 0) {
                    console.log(`Drive sync: removed ${taskDeduped} duplicate auto-task(s) by autoKey`);
                }
            } catch (e) {
                console.error('Drive sync: task deduplication error', e);
            }

            localStorage.setItem('last-drive-sync-received', new Date().toISOString());
            if (remoteTimestamp) localStorage.setItem('last-drive-sync-remote-ts', remoteTimestamp);
            this._pendingMerge = null;
            this._pendingMergeTs = null;
            localStorage.removeItem('drive-sync-paused');
            this.updateSyncStatusUI();
            console.log(`Drive sync: applied pulled data — ${added} added, ${updated} updated, ${skipped} unchanged`);
            return 'applied';

        } catch (err) {
            console.error('Drive sync: failed to apply pulled data', err);
            return 'failed';
        }
    },

    /**
     * Called when user navigates between pages.
     * If there's a pending merge and we're now idle, apply it.
     */
    applyPendingIfIdle: function() {
        if (this._pendingMerge && this.isIdle()) {
            console.log('Drive sync: applying pending merge now that app is idle');
            this.applyPulledData(this._pendingMerge, this._pendingMergeTs);
        }
    },

    updateSyncStatusUI: function() {
        const lastPushEl = document.getElementById('drive-sync-last-push');
        const lastPullEl = document.getElementById('drive-sync-last-pull');
        if (lastPushEl) {
            const lastPush = localStorage.getItem('last-drive-sync-push');
            lastPushEl.textContent = lastPush ? formatTimeAgo(new Date(lastPush)) : 'Never';
        }
        if (lastPullEl) {
            const lastPull = localStorage.getItem('last-drive-sync-received');
            lastPullEl.textContent = lastPull ? formatTimeAgo(new Date(lastPull)) : 'Never';
        }
        // The last Sync Now result stays on screen, so it can't be missed (plan row 1-14, i077)
        const resultEl = document.getElementById('drive-sync-now-result');
        if (resultEl) resultEl.textContent = localStorage.getItem('last-sync-now-result') || '';
        // P16 N6: "Sync paused" stays on screen until a copy is applied again
        const pausedEl = document.getElementById('drive-sync-paused');
        if (pausedEl) {
            const paused = localStorage.getItem('drive-sync-paused') || '';
            pausedEl.textContent = paused ? '⛔ ' + paused : '';
            pausedEl.style.display = paused ? '' : 'none';
        }
        // P16 N4: Upload only is offered only while sync is off
        const uploadOnlyBtn = document.getElementById('drive-upload-only-btn');
        if (uploadOnlyBtn) uploadOnlyBtn.style.display = localStorage.getItem('drive-sync-enabled') === 'true' ? 'none' : '';
        const uploadOnlyEl = document.getElementById('drive-upload-only-result');
        if (uploadOnlyEl) uploadOnlyEl.textContent = localStorage.getItem('last-upload-only-result') || '';
    }
};

// Re-push when coming back online if there are pending changes
window.addEventListener('online', () => {
    if (driveSync._dirty) {
        console.log('Drive sync: back online, pushing pending changes');
        driveSync.push();
    }
});
async function driveSyncNow() {
    ui.showToast('Syncing...', 'info');
    const resultEl = document.getElementById('drive-sync-now-result');
    if (resultEl) resultEl.textContent = 'Syncing…';

    // ── Download first (plan row 1-14, i093): on a device with older data, uploading first
    //    would put that older copy on Drive before fetching the newer one. ──
    let pullMsg;
    let pullOk = true;
    try {
        const pullResult = await driveSyncPull.checkOnLoad();
        if (pullResult === 'applied') {
            pullMsg = '✅ Downloaded updates';
        } else if (pullResult === 'none') {
            pullMsg = '✅ Nothing new to download';
        } else if (pullResult === 'queued') {
            pullMsg = '⏳ Update received — applies when you close this form';
        } else if (pullResult === 'refused') {
            const other = syncThisDevice() === 'iPad' ? 'PC' : 'iPad';
            pullMsg = `⛔ Download refused: the ${other}'s copy is from the other side of the skills migration`;
            pullOk = false;
        } else if (pullResult === 'disabled') {
            pullMsg = '❌ Download skipped — sync not configured';
            pullOk = false;
        } else {
            pullMsg = '❌ Download failed';
            pullOk = false;
        }
    } catch (err) {
        console.error('Sync Now: pull threw', err);
        pullMsg = '❌ Download failed';
        pullOk = false;
    }

    // ── Then upload, so Drive gets this device's data including anything just downloaded ──
    // Auto-sync may already be uploading. Wait for it (it can't take longer than its time limit).
    const waitStart = Date.now();
    while (driveSync._pushing && Date.now() - waitStart < SYNC_TIMEOUT_MS + 5000) {
        await new Promise(r => setTimeout(r, 500));
    }
    driveSync._dirty = true;
    const pushOk = await driveSync.push();
    const pushMsg = pushOk ? '✅ Uploaded' : '❌ Upload failed';

    const allOk = pushOk && pullOk;
    const when = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    localStorage.setItem('last-sync-now-result', `Last Sync Now (${when}): ${pullMsg} · ${pushMsg}`);
    driveSync.updateSyncStatusUI();
    ui.showToast(pullMsg + ' · ' + pushMsg, allOk ? 'success' : 'error', 8000);
}

const driveSyncPull = {
    /**
     * Called on app load. Checks Drive for newer data from the other device.
     * Applies silently if app is idle, queues it if a form is open.
     */
    checkOnLoad: async function() {
        const syncEnabled = localStorage.getItem('drive-sync-enabled') === 'true';
        const syncPassword = localStorage.getItem('drive-sync-password');
        if (!syncEnabled || !syncPassword || !navigator.onLine) return 'disabled';

        const webhookUrl = localStorage.getItem('webhook_absent') ||
                            localStorage.getItem('webhook_wildcat');
        const webhookToken = localStorage.getItem('webhook_token');
        if (!webhookUrl || !webhookToken) return 'disabled';

        const deviceId = syncThisDevice();

        try {
            const response = await syncFetch(webhookUrl, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'load_from_drive',
                    token: webhookToken,
                    requestingDevice: deviceId
                })
            });

            const result = await response.json();
            if (result.status !== 'success') {
                if (result.status === 'no_data') {
                    console.log('Drive sync: no data from other device yet');
                    return 'none';
                }
                console.warn('Drive sync pull issue:', result.message);
                return 'failed';
            }

            // Only pull if remote is newer. Compare like with like (plan row 1-14, X29): the other
            // device's timestamp against the last timestamp we applied *from that device*, never
            // against this device's own clock. Until one has been recorded, apply (the merge is
            // newer-wins, so applying the same data twice changes nothing).
            const lastRemote = localStorage.getItem('last-drive-sync-remote-ts');
            if (lastRemote && result.timestamp && result.timestamp <= lastRemote) {
                console.log('Drive sync: remote data is not newer, skipping');
                return 'none';
            }

            // Decrypt and validate before doing anything
            let decryptedData;
            try {
                const decryptedText = await secureStorage.decrypt(result.encryptedData, syncPassword);
                decryptedData = JSON.parse(decryptedText);
            } catch (decryptErr) {
                console.error('Drive sync: decryption failed — password mismatch?', decryptErr);
                const failMsg = decryptErr && decryptErr.newerFormat ? '⚠️ ' + secureStorage.NEWER_FORMAT_MESSAGE : '⚠️ Sync data found but decryption failed. Check that both devices use the same sync password.';
                ui.showToast(failMsg, 'error', 8000);
                return 'failed';
            }

            // P16 N6: a copy from the other side of the skills migration is never queued or merged
            const localEpoch = await localSyncEpoch();
            const remoteEpoch = syncEpochOf(decryptedData);
            if (localEpoch !== remoteEpoch) {
                const msg = driveSync.epochRefusalMessage(localEpoch, remoteEpoch);
                driveSync.setSyncPaused(msg);
                ui.showToast('⛔ ' + msg, 'error', 12000);
                return 'refused';
            }

            // Apply silently if idle, queue if a form is open
            if (driveSync.isIdle()) {
                console.log('Drive sync: app is idle, applying pulled data silently');
                return await driveSync.applyPulledData(decryptedData, result.timestamp);
            } else {
                console.log('Drive sync: form is open, queuing pulled data for later');
                driveSync._pendingMerge = decryptedData;
                driveSync._pendingMergeTs = result.timestamp || null;
                driveSync.updateSyncStatusUI();
                return 'queued';
            }

        } catch (err) {
            console.error('Drive sync pull failed:', err);
            // Fail silently — don't interrupt app load
            return 'failed';
        }
    }
};


// ── P16 N4: "Upload only: replace this device's Drive copy" (sync off only) ──
// Sends exactly the file a normal upload sends. Nothing is downloaded or merged, sync stays off,
// and the pull clock isn't touched. Used on the skills-migration day before sync goes back on.
async function driveSyncUploadOnly() {
    const device = syncThisDevice();
    const stamp = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const show = msg => { localStorage.setItem('last-upload-only-result', msg); driveSync.updateSyncStatusUI(); };
    const refuse = msg => { ui.showToast(msg, 'error', 8000); return 'refused'; };

    if (localStorage.getItem('drive-sync-enabled') === 'true') return refuse('Turn sync off first; Sync Now already uploads.');
    const syncPassword = localStorage.getItem('drive-sync-password');
    if (!syncPassword) return refuse('No sync password is saved on this device.');
    const webhookUrl = localStorage.getItem('webhook_absent') || localStorage.getItem('webhook_wildcat');
    const webhookToken = localStorage.getItem('webhook_token');
    if (!webhookUrl || !webhookToken) return refuse('No webhook address or token on this device.');
    if (!navigator.onLine) return refuse('This device is offline.');
    if (driveSync._pushing || driveSync._uploadOnlyRunning) return refuse('An upload is already running. Wait for it to finish.');
    if (driveSync._pendingMerge) return refuse('A downloaded update is still waiting to be applied. Close any open form, then try again.');
    if (!confirm(`This replaces the ${device} copy on Google Drive with this device's data. The other device receives it the next time it syncs. Continue?`)) return 'cancelled';

    driveSync._uploadOnlyRunning = true;
    show('Upload only: uploading…');
    try {
        const data = await driveSync.buildSyncFile();
        const epoch = syncEpochOf(data);
        const encryptedJson = await secureStorage.encrypt(JSON.stringify(data), syncPassword, { compact: true });
        let result = null;
        try {
            const response = await syncFetch(webhookUrl, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'save_to_drive',
                    token: webhookToken,
                    encryptedData: encryptedJson,
                    deviceId: device,
                    timestamp: new Date().toISOString(),
                    schemaVersion: db.verno
                })
            });
            result = await response.json();
        } catch (err) {
            console.error('Upload only: no reply', err);
            result = null;
        }
        if (result && result.status === 'success') {
            localStorage.setItem('last-drive-sync-push', new Date().toISOString());
            show(`Upload only (${stamp()}): ✅ ${device} copy replaced · sync-epoch: ${epoch || 'none'}`);
            return 'uploaded';
        }
        // 2-04: a lost reply (after webhookFetch's retry) comes back as replyLost; it isn't a refusal
        if (result && result.status === 'error' && !result.replyLost) {
            show(`Upload only (${stamp()}): ❌ Not replaced: ${result.message || 'the script refused it'}`);
            return 'failed';
        }
        // Timeout or a non-JSON reply (i137): the upload may still have worked
        show(`Upload only (${stamp()}): ❓ No reply. The upload may still have worked. Check it from the other device with "Look at the other device's Drive copy".`);
        return 'unknown';
    } finally {
        driveSync._uploadOnlyRunning = false;
    }
}

// ── P16 N5: "Look at the other device's Drive copy (changes nothing)" ──
// Downloads and decrypts the other device's copy and only shows it: never merges, never queues,
// never sets a sync time. Works with sync on or off.
const driveSyncLook = {
    _text: '',

    run: async function() {
        const out = document.getElementById('drive-look-result');
        const show = html => { if (out) out.innerHTML = html; };
        const note = msg => { show(`<p style="font-weight: 600;">${escapeHtml(msg)}</p>`); return msg; };
        const syncPassword = localStorage.getItem('drive-sync-password');
        const webhookUrl = localStorage.getItem('webhook_absent') || localStorage.getItem('webhook_wildcat');
        const webhookToken = localStorage.getItem('webhook_token');
        if (!syncPassword) return note('No sync password is saved on this device. Nothing was changed.');
        if (!webhookUrl || !webhookToken) return note('No webhook address or token on this device. Nothing was changed.');
        if (!navigator.onLine) return note('This device is offline. Nothing was changed.');

        const device = syncThisDevice();
        const other = device === 'iPad' ? 'PC' : 'iPad';
        show('<p>Fetching the ' + other + "'s copy…</p>");
        let result;
        try {
            const response = await syncFetch(webhookUrl, {
                method: 'POST',
                body: JSON.stringify({ action: 'load_from_drive', token: webhookToken, requestingDevice: device })
            });
            result = await response.json();
        } catch (err) {
            return note('❓ No reply from Google. Nothing was changed. Try again in a minute.');
        }
        if (result.replyLost) return note('❓ No reply from Google. Nothing was changed. Try again in a minute.');
        if (result.status === 'no_data') return note(`The ${other} has no Drive copy yet. Nothing was changed.`);
        if (result.status !== 'success') return note(`Couldn't fetch it: ${result.message || 'unknown error'}. Nothing was changed.`);

        let data;
        try {
            data = JSON.parse(await secureStorage.decrypt(result.encryptedData, syncPassword));
        } catch (err) {
            if (err && err.newerFormat) return note(secureStorage.NEWER_FORMAT_MESSAGE);
            return note("Couldn't read it (different sync password?). Nothing was changed.");
        }

        const fmt = iso => { const d = new Date(iso); return iso && !isNaN(d) ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'unknown'; };
        const remoteEpoch = syncEpochOf(data);
        const localEpoch = await localSyncEpoch();
        const mayDiffer = new Set(['alerts', 'tasks']);
        const rows = [];
        for (const table of db.tables.slice().sort((a, b) => a.name.localeCompare(b.name))) {
            if (table.name === 'activityLog') continue;
            const here = await table.count();
            const there = Array.isArray(data[table.name]) ? data[table.name].length : 0;
            rows.push({ name: table.name, here, there, same: here === there, mayDiffer: mayDiffer.has(table.name) });
        }
        const mark = r => r.same ? '✓' : (r.mayDiffer ? '≠ (may differ)' : '≠');
        const lines = [
            `ShopFlow: the ${other}'s Drive copy (counts only) · looked at from the ${device} · ${new Date().toLocaleString('en-US')}`,
            `Whose copy: ${result.deviceId || other} · Uploaded: ${fmt(result.timestamp)} · Exported: ${fmt(data.exportDate)} · Database version: ${data.schemaVersion ?? 'unknown'}`,
            `Sync-epoch: ${remoteEpoch || 'none: from before the skills migration'} · This device: ${localEpoch || 'none'}`,
            '',
            ...rows.map(r => `${r.name}: this device ${r.here} · their copy ${r.there} ${mark(r)}`)
        ];
        this._text = lines.join('\n');
        show(`
            <div style="font-size: var(--font-size-body-small); margin-bottom: var(--space-sm);">
                <div><strong>Whose copy:</strong> ${escapeHtml(result.deviceId || other)}</div>
                <div><strong>Uploaded:</strong> ${escapeHtml(fmt(result.timestamp))} · <strong>Exported:</strong> ${escapeHtml(fmt(data.exportDate))} · <strong>Database version:</strong> ${escapeHtml(String(data.schemaVersion ?? 'unknown'))}</div>
                <div id="drive-look-epoch"><strong>Sync-epoch:</strong> ${escapeHtml(remoteEpoch || 'none: from before the skills migration')}${remoteEpoch !== localEpoch ? ' <strong>(differs from this device)</strong>' : ''}</div>
                <div style="color: var(--color-text-secondary);">Nothing was changed on this device.</div>
            </div>
            <table class="drive-look-table" style="width: 100%; border-collapse: collapse; font-size: var(--font-size-body-small);">
                <thead><tr style="text-align: left; border-bottom: 1px solid var(--color-border);">
                    <th style="padding: 4px 6px;">Table</th><th style="padding: 4px 6px; text-align: right;">This device</th>
                    <th style="padding: 4px 6px; text-align: right;">Their copy</th><th style="padding: 4px 6px;"></th>
                </tr></thead>
                <tbody>${rows.map(r => `<tr data-table="${r.name}" style="border-bottom: 1px solid var(--color-border);">
                    <td style="padding: 4px 6px;">${r.name}</td><td style="padding: 4px 6px; text-align: right;">${r.here}</td>
                    <td class="drive-look-there" style="padding: 4px 6px; text-align: right;">${r.there}</td><td class="drive-look-mark" style="padding: 4px 6px;">${mark(r)}</td>
                </tr>`).join('')}</tbody>
            </table>
            <button class="btn btn--secondary btn--sm" style="margin-top: var(--space-sm);" onclick="driveSyncLook.copy()">Copy</button>`);
        return 'shown';
    },

    copy: async function() {
        try {
            await navigator.clipboard.writeText(this._text);
            ui.showToast('Copied (counts only)', 'success');
        } catch (e) {
            ui.showToast('Could not copy. Take a screenshot instead.', 'warning');
        }
    }
};
