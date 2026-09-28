// ============================================
// APP INITIALIZATION
// ============================================

//Encryption of data storage
const secureStorage = {
    async encrypt(text, password) {
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
        
        const salt = new Uint8Array(parsed.salt);
        const iv = new Uint8Array(parsed.iv);
        const data = new Uint8Array(parsed.data);
        
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

const driveSync = {
    _dirty: false,
    _timer: null,
    _pushing: false,
    _pendingMerge: null, // Holds pulled data if a form is open
    DEBOUNCE_MS: 30000,  // 30 seconds after last change

    markDirty: function() {
        if (localStorage.getItem('drive-sync-enabled') !== 'true') return;
        this._dirty = true;
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.push(), this.DEBOUNCE_MS);
    },

    push: async function() {
        if (!this._dirty || this._pushing) return;
        if (!navigator.onLine) return;

        const syncEnabled = localStorage.getItem('drive-sync-enabled') === 'true';
        const syncPassword = localStorage.getItem('drive-sync-password');
        if (!syncEnabled || !syncPassword) return;

        const webhookUrl = localStorage.getItem('webhook_absent') ||
                            localStorage.getItem('webhook_wildcat');
        const webhookToken = localStorage.getItem('webhook_token');
        if (!webhookUrl || !webhookToken) return;

        this._pushing = true;

        try {
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

            const rawJson = JSON.stringify(data);
            const encryptedJson = await secureStorage.encrypt(rawJson, syncPassword);

            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            const deviceId = isIOS ? 'iPad' : 'PC';

            const response = await fetch(webhookUrl, {
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
                this._dirty = false;
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
        }
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
    applyPulledData: async function(data) {
        try {
            let added = 0, updated = 0, skipped = 0;

            const naturalKeys = {
                attendance: ['studentId', 'date', 'period'],
                checkpointCompletions: ['checkpointId', 'studentId'],
                submissions: ['activityId', 'studentId'],
                skillLevels: ['studentId', 'skillId'],
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
                                    delete recCopy.id;
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
            this._pendingMerge = null;
            this.updateSyncStatusUI();
            console.log(`Drive sync: applied pulled data — ${added} added, ${updated} updated, ${skipped} unchanged`);

        } catch (err) {
            console.error('Drive sync: failed to apply pulled data', err);
        }
    },

    /**
     * Called when user navigates between pages.
     * If there's a pending merge and we're now idle, apply it.
     */
    applyPendingIfIdle: function() {
        if (this._pendingMerge && this.isIdle()) {
            console.log('Drive sync: applying pending merge now that app is idle');
            this.applyPulledData(this._pendingMerge);
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

    // ── Push first ──
    const pushBefore = localStorage.getItem('last-drive-sync-push');

    // Auto-sync may already be pushing. Wait for it rather than calling it a failure.
    const waitStart = Date.now();
    while (driveSync._pushing && Date.now() - waitStart < 180000) {
        await new Promise(r => setTimeout(r, 500));
    }

    let pushAfter = localStorage.getItem('last-drive-sync-push');
    if (!pushAfter || pushAfter === pushBefore) {
        driveSync._dirty = true;
        await driveSync.push();
        pushAfter = localStorage.getItem('last-drive-sync-push');
    }
    const pushOk = pushAfter && pushAfter !== pushBefore;
    const pushMsg = pushOk ? '✅ Uploaded' : '❌ Upload failed';
    // ── Then pull, using the same path as Check for Updates ──
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

    driveSync.updateSyncStatusUI();
    const allOk = pushOk && pullOk;
    ui.showToast(pushMsg + ' · ' + pullMsg, allOk ? 'success' : 'error', 8000);
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

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const deviceId = isIOS ? 'iPad' : 'PC';

        try {
            const response = await fetch(webhookUrl, {
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

            // Compare timestamps — only pull if remote is newer
            const lastReceived = localStorage.getItem('last-drive-sync-received');
            if (lastReceived && result.timestamp <= lastReceived) {
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
                ui.showToast('⚠️ Sync data found but decryption failed. Check that both devices use the same sync password.', 'error', 8000);
                return 'failed';
            }

            // Apply silently if idle, queue if a form is open
            if (driveSync.isIdle()) {
                console.log('Drive sync: app is idle, applying pulled data silently');
                await driveSync.applyPulledData(decryptedData);
                return 'applied';
            } else {
                console.log('Drive sync: form is open, queuing pulled data for later');
                driveSync._pendingMerge = decryptedData;
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
