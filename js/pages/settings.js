// ----------------------------------------
// SETTINGS PAGE
// ----------------------------------------
pages.settings = {
    render: async function() {
        // Load classes
        await this.renderClasses();
        // Load period mappings
        await this.loadPeriodMappings();
        // Load all webhook URLs
        this.loadWebhooks();
        // Load school calendar
        await this.loadSchoolCalendar();
        // Load bell schedules
        await this.loadBellSchedules();
        // Load auto-backup list
        await autoBackup.renderList('auto-backup-list');
        // Initialize Drive sync toggle (Sprint 8)
        this.initDriveSyncToggle();
        // Sprint 13.2: Load default period preference
        await this.loadDefaultPeriod();
        // Sprint 13.4: Load backup reminder preference
        await this.loadBackupReminderDays();
        // Sprint 13.3: Load quick actions preference
        await this.loadQuickActions();
        // Sprint 15: Load flex period name + end class steps
        await this.loadFlexPeriodName();
        await this.loadEndClassSteps();
    },

    setTab: function(tabId, btn) {
        // Hide all tab content
        document.querySelectorAll('.settings-content').forEach(content => {
            content.classList.add('hidden');
        });

        // Show the selected tab content
        const target = document.getElementById(`settings-tab-${tabId}`);
        if (target) target.classList.remove('hidden');

        // Update button styles
        const tabButtons = btn.parentElement.querySelectorAll('.tab-btn');
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Auto-render deleted items when that tab is opened
        if (tabId === 'deleted') this.renderDeletedItems();
        if (tabId === 'calendar') this.populateArchiveYearDropdown();
        if (tabId === 'data') { this.renderDataCheck(); this.renderActivityLog(); }
        if (tabId === 'preferences') {
            this.loadDefaultPeriod();
            this.loadBackupReminderDays();
            this.loadQuickActions();
            this.loadFlexPeriodName();
            this.loadEndClassSteps();
        }
    },

    loadDefaultPeriod: async function() {
        const select = document.getElementById('setting-default-period');
        if (!select) return;
        const enrollments = await db.enrollments.toArray();
        const periods = [...new Set(enrollments.map(e => String(e.period)))].sort((a, b) => {
            if (a === 'wildcat') return 1;
            if (b === 'wildcat') return -1;
            return Number(a) - Number(b);
        });
        let html = '<option value="">None (auto-detect)</option>';
        periods.forEach(p => {
            const label = p === 'wildcat' ? state.flexPeriodName : `Period ${p}`;
            html += `<option value="${escapeHtml(p)}">${label}</option>`;
        });
        select.innerHTML = html;
        const setting = await db.settings.get('default-period');
        if (setting && setting.value) {
            select.value = setting.value;
        }
    },

    saveDefaultPeriod: async function() {
        const value = document.getElementById('setting-default-period').value;
        await db.settings.put({ key: 'default-period', value: value });
        driveSync.markDirty();
        logAction('update', 'settings', null, 'Default period set to: ' + (value || 'none'));
        ui.showToast('Default period saved', 'success');
    },

    loadBackupReminderDays: async function() {
        const select = document.getElementById('setting-backup-reminder-days');
        if (!select) return;
        const setting = await db.settings.get('backup-reminder-days');
        select.value = setting ? String(setting.value) : '7';
    },

    saveBackupReminderDays: async function() {
        const value = parseInt(document.getElementById('setting-backup-reminder-days').value);
        await db.settings.put({ key: 'backup-reminder-days', value: value });
        driveSync.markDirty();
        logAction('update', 'settings', null, 'Backup reminder set to: ' + (value === 0 ? 'never' : value + ' days'));
        ui.showToast('Backup reminder updated', 'success');
    },

    loadQuickActions: async function() {
        const container = document.getElementById('setting-quick-actions-list');
        if (!container) return;

        const setting = await db.settings.get('dashboard-quick-actions');
        let actionConfig;
        if (setting && Array.isArray(setting.value)) {
            actionConfig = setting.value;
            QUICK_ACTION_REGISTRY.forEach(regAction => {
                if (!actionConfig.find(a => a.id === regAction.id)) {
                    actionConfig.push({ id: regAction.id, label: regAction.label, enabled: true });
                }
            });
            actionConfig = actionConfig.filter(a => QUICK_ACTION_REGISTRY.find(r => r.id === a.id));
        } else {
            actionConfig = QUICK_ACTION_REGISTRY.map(a => ({ id: a.id, label: a.label, enabled: true }));
        }

        container.innerHTML = actionConfig.map(action => `
            <div style="display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-background-secondary);" data-action-id="${escapeHtml(action.id)}">
                <button class="btn btn--secondary" style="padding: 4px 8px; min-width: 32px;" onclick="pages.settings.moveQuickAction('${action.id}', -1)" title="Move up">▲</button>
                <button class="btn btn--secondary" style="padding: 4px 8px; min-width: 32px;" onclick="pages.settings.moveQuickAction('${action.id}', 1)" title="Move down">▼</button>
                <label style="flex: 1; display: flex; align-items: center; gap: var(--space-sm); cursor: pointer;">
                    <input type="checkbox" ${action.enabled ? 'checked' : ''} onchange="pages.settings.toggleQuickAction('${action.id}', this.checked)">
                    <span>${escapeHtml(action.label)}</span>
                </label>
            </div>
        `).join('');
    },

    toggleQuickAction: async function(actionId, enabled) {
        const setting = await db.settings.get('dashboard-quick-actions');
        let config = setting?.value || QUICK_ACTION_REGISTRY.map(a => ({ id: a.id, label: a.label, enabled: true }));
        const item = config.find(a => a.id === actionId);
        if (item) item.enabled = enabled;
        await db.settings.put({ key: 'dashboard-quick-actions', value: config });
        driveSync.markDirty();
        ui.showToast('Quick actions updated', 'success');
    },

    moveQuickAction: async function(actionId, direction) {
        const setting = await db.settings.get('dashboard-quick-actions');
        let config = setting?.value || QUICK_ACTION_REGISTRY.map(a => ({ id: a.id, label: a.label, enabled: true }));
        const idx = config.findIndex(a => a.id === actionId);
        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= config.length) return;
        [config[idx], config[newIdx]] = [config[newIdx], config[idx]];
        await db.settings.put({ key: 'dashboard-quick-actions', value: config });
        driveSync.markDirty();
        this.loadQuickActions();
    },

    // --- Flex Period Name (Sprint 15) ---
    loadFlexPeriodName: async function() {
        const input = document.getElementById('setting-flex-period-name');
        if (!input) return;
        const setting = await db.settings.get('flex-period-name');
        input.value = setting?.value || 'Wildcat';
    },

    saveFlexPeriodName: async function() {
        const input = document.getElementById('setting-flex-period-name');
        const value = input.value.trim() || 'Wildcat';
        await db.settings.put({ key: 'flex-period-name', value: value });
        state.flexPeriodName = value;
        // Update all display labels throughout the app
        document.querySelectorAll('[data-flex-label]').forEach(el => {
            el.textContent = value;
        });
        driveSync.markDirty();
        logAction('update', 'settings', null, 'Flex period name set to: ' + value);
        ui.showToast('Flex period name saved', 'success');
    },

    // --- End Class Steps (Sprint 15) ---
    loadEndClassSteps: async function() {
        const container = document.getElementById('setting-end-class-steps');
        if (!container) return;
        const setting = await db.settings.get('end-class-steps');
        const steps = setting?.value || {
            stationCheckout: true,
            returnTools: true,
            pcRestart: true,
            absentNotifications: true,
            wildcatScheduling: true,
            hubSync: true
        };

        const stepLabels = {
            stationCheckout: 'Team Station Checkout',
            returnTools: 'Return Borrowed Tools',
            pcRestart: 'PC Restart Reminder',
            absentNotifications: 'Absent Student Notifications',
            wildcatScheduling: state.flexPeriodName + ' Period Scheduling',
            hubSync: 'Sync to Student Hub'
        };

        container.innerHTML = Object.entries(stepLabels).map(([key, label]) => `
            <label style="display: flex; align-items: center; gap: var(--space-sm); cursor: pointer; padding: var(--space-xs) 0;">
                <input type="checkbox" ${steps[key] !== false ? 'checked' : ''} onchange="pages.settings.toggleEndClassStep('${key}', this.checked)">
                <span>${escapeHtml(label)}</span>
            </label>
        `).join('');
    },

    toggleEndClassStep: async function(stepKey, enabled) {
        const setting = await db.settings.get('end-class-steps');
        const steps = setting?.value || {
            stationCheckout: true,
            returnTools: true,
            pcRestart: true,
            absentNotifications: true,
            wildcatScheduling: true,
            hubSync: true
        };
        steps[stepKey] = enabled;
        await db.settings.put({ key: 'end-class-steps', value: steps });
        driveSync.markDirty();
        logAction('update', 'settings', null, `End class step "${stepKey}" ${enabled ? 'enabled' : 'disabled'}`);
        ui.showToast('End of class steps updated', 'success');
    },

    initDriveSyncToggle: function() {
        const toggle = document.getElementById('drive-sync-toggle');
        const label = document.getElementById('drive-sync-toggle-label');
        const config = document.getElementById('drive-sync-config');
        const passwordInput = document.getElementById('drive-sync-password-input');

        if (!toggle) return;

        // Restore saved state
        const enabled = localStorage.getItem('drive-sync-enabled') === 'true';
        toggle.checked = enabled;
        label.textContent = enabled ? 'On' : 'Off';
        config.style.display = 'block';

        // Restore saved password
        const savedPassword = localStorage.getItem('drive-sync-password');
        if (savedPassword) passwordInput.value = savedPassword;

        // Update last push/pull times
        driveSync.updateSyncStatusUI();

        // Toggle handler
        toggle.addEventListener('change', function() {
            const automationsEnabled = localStorage.getItem('automations-enabled') === 'true';
            const webhookUrl = localStorage.getItem('webhook_absent') ||
                                localStorage.getItem('webhook_wildcat');

            if (toggle.checked && (!automationsEnabled || !webhookUrl)) {
                ui.showToast('Automations must be enabled and webhook URL set before enabling sync.', 'error', 5000);
                toggle.checked = false;
                return;
            }

            if (toggle.checked) {
                const pass = passwordInput.value.trim();
                if (!pass) {
                    ui.showToast('Enter a sync password first, then enable sync.', 'error', 5000);
                    toggle.checked = false;
                    return;
                }
                localStorage.setItem('drive-sync-password', pass);
                localStorage.setItem('drive-sync-enabled', 'true');
                label.textContent = 'On';
                config.style.display = 'block';
                ui.showToast('Drive sync enabled! First push in 30 seconds.', 'success');
                driveSync.markDirty();
            } else {
                localStorage.setItem('drive-sync-enabled', 'false');
                label.textContent = 'Off';
                ui.showToast('Drive sync disabled.', 'info');
            }
            driveSync.updateSyncStatusUI(); // Upload only shows only while sync is off (P16 N4)
        });
    },

    renderDeletedItems: async function() {
        const container = document.getElementById('deleted-items-list');
        if (!container) return;

        try {
            const deletedStudents = (await db.students.toArray()).filter(s => s.deletedAt && !s.permanentlyDeleted);
            const deletedTeams = (await db.teams.toArray()).filter(t => t.deletedAt && !t.permanentlyDeleted);
            const deletedActivities = (await db.activities.toArray()).filter(a => a.deletedAt && !a.permanentlyDeleted);
            const deletedInventory = (await db.inventory.toArray()).filter(i => i.deletedAt && !i.permanentlyDeleted);

            const total = deletedStudents.length + deletedTeams.length + deletedActivities.length + deletedInventory.length;

            if (total === 0) {
                container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">No deleted items.</p>';
                return;
            }

            let html = '';

            if (deletedStudents.length > 0) {
                html += '<h4 style="margin: var(--space-base) 0 var(--space-sm);">Students</h4>';
                deletedStudents.forEach(s => {
                    html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-md); margin-bottom: var(--space-xs);">
                        <div>
                            <span style="font-weight: 500;">${escapeHtml(displayName(s))}</span>
                            <span style="font-size: var(--font-size-body-small); color: var(--color-text-tertiary); margin-left: var(--space-sm);">Deleted ${new Date(s.deletedAt).toLocaleDateString()}</span>
                        </div>
                        <div style="display: flex; gap: var(--space-xs);">
                            <button class="btn btn--secondary" style="font-size: var(--font-size-body-small); padding: var(--space-xs) var(--space-sm);" onclick="pages.settings.restoreItem('students', ${s.id})">Restore</button>
                            <button class="btn btn--danger" style="font-size: var(--font-size-body-small); padding: var(--space-xs) var(--space-sm);" onclick="pages.settings.permanentlyDelete('students', ${s.id})">Permanently Delete</button>
                        </div>
                    </div>`;
                });
            }

            if (deletedTeams.length > 0) {
                html += '<h4 style="margin: var(--space-base) 0 var(--space-sm);">Teams</h4>';
                deletedTeams.forEach(t => {
                    html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-md); margin-bottom: var(--space-xs);">
                        <div>
                            <span style="font-weight: 500;">${escapeHtml(t.name)}</span>
                            <span style="font-size: var(--font-size-body-small); color: var(--color-text-tertiary); margin-left: var(--space-sm);">Deleted ${new Date(t.deletedAt).toLocaleDateString()}</span>
                        </div>
                        <div style="display: flex; gap: var(--space-xs);">
                            <button class="btn btn--secondary" style="font-size: var(--font-size-body-small); padding: var(--space-xs) var(--space-sm);" onclick="pages.settings.restoreItem('teams', ${t.id})">Restore</button>
                            <button class="btn btn--danger" style="font-size: var(--font-size-body-small); padding: var(--space-xs) var(--space-sm);" onclick="pages.settings.permanentlyDelete('teams', ${t.id})">Permanently Delete</button>
                        </div>
                    </div>`;
                });
            }

            if (deletedActivities.length > 0) {
                html += '<h4 style="margin: var(--space-base) 0 var(--space-sm);">Assignments</h4>';
                deletedActivities.forEach(a => {
                    html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-md); margin-bottom: var(--space-xs);">
                        <div>
                            <span style="font-weight: 500;">${escapeHtml(a.name)}</span>
                            <span style="font-size: var(--font-size-body-small); color: var(--color-text-tertiary); margin-left: var(--space-sm);">Deleted ${new Date(a.deletedAt).toLocaleDateString()}</span>
                        </div>
                        <div style="display: flex; gap: var(--space-xs);">
                            <button class="btn btn--secondary" style="font-size: var(--font-size-body-small); padding: var(--space-xs) var(--space-sm);" onclick="pages.settings.restoreItem('activities', ${a.id})">Restore</button>
                            <button class="btn btn--danger" style="font-size: var(--font-size-body-small); padding: var(--space-xs) var(--space-sm);" onclick="pages.settings.permanentlyDelete('activities', ${a.id})">Permanently Delete</button>
                        </div>
                    </div>`;
                });
            }

            if (deletedInventory.length > 0) {
                html += '<h4 style="margin: var(--space-base) 0 var(--space-sm);">Inventory</h4>';
                deletedInventory.forEach(i => {
                    html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-md); margin-bottom: var(--space-xs);">
                        <div>
                            <span style="font-weight: 500;">${escapeHtml(i.name)}</span>
                            <span style="font-size: var(--font-size-body-small); color: var(--color-text-tertiary); margin-left: var(--space-sm);">Deleted ${new Date(i.deletedAt).toLocaleDateString()}</span>
                        </div>
                        <div style="display: flex; gap: var(--space-xs);">
                            <button class="btn btn--secondary" style="font-size: var(--font-size-body-small); padding: var(--space-xs) var(--space-sm);" onclick="pages.settings.restoreItem('inventory', ${i.id})">Restore</button>
                            <button class="btn btn--danger" style="font-size: var(--font-size-body-small); padding: var(--space-xs) var(--space-sm);" onclick="pages.settings.permanentlyDelete('inventory', ${i.id})">Permanently Delete</button>
                        </div>
                    </div>`;
                });
            }

            container.innerHTML = html;
        } catch (err) {
            console.error('Error loading deleted items:', err);
            container.innerHTML = '<p style="color: var(--color-error);">Failed to load deleted items.</p>';
        }
    },

    // ── Data check (plan row 1-04): per-table counts and sync times, counts only ──
    _dataCheckText: '',

    renderDataCheck: async function() {
        const body = document.getElementById('data-check-body');
        if (!body) return;
        try {
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            const device = isIOS ? 'iPad' : 'PC';
            let appVersion = 'unknown';
            try {
                const names = (typeof caches !== 'undefined') ? await caches.keys() : [];
                const v = names.filter(n => /^esb-v\d+$/.test(n)).sort((a, b) => parseInt(b.slice(5)) - parseInt(a.slice(5)))[0];
                if (v) appVersion = v;
            } catch (e) { /* caches unavailable (private mode) */ }
            const when = key => {
                const iso = localStorage.getItem(key);
                if (!iso) return 'never';
                const d = new Date(iso);
                return isNaN(d) ? 'never' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            };
            const syncOn = localStorage.getItem('drive-sync-enabled') === 'true';
            // P16 C4.2: one line saying whether the skills migration has run on this device
            const epochRow = await db.settings.get('sync-epoch');
            const epochVal = epochRow && epochRow.value;
            const epochText = (epochVal && epochVal.id)
                ? `done ${new Date(epochVal.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${epochVal.id})`
                : 'not done';
            const pausedMsg = localStorage.getItem('drive-sync-paused') || '';
            // Tables the Drive sync never merges (driveSync.applyPulledData skips them)
            const localOnly = new Set(['activityLog']);

            const rows = [];
            for (const table of db.tables.slice().sort((a, b) => a.name.localeCompare(b.name))) {
                const records = await table.toArray();
                const deleted = records.filter(r => r && r.deletedAt).length;
                rows.push({ name: table.name, total: records.length, deleted, localOnly: localOnly.has(table.name) });
            }
            const grand = rows.filter(r => !r.localOnly).reduce((s, r) => s + r.total, 0);

            const lines = [
                `ShopFlow data check (counts only) · ${device} · ${new Date().toLocaleString('en-US')}`,
                `App version: ${appVersion} · Database version: ${db.verno} · Sync: ${syncOn ? 'on' : 'off'}`,
                `Last upload: ${when('last-drive-sync-push')} · Last download: ${when('last-drive-sync-received')}`,
                `Skills migration: ${epochText}`,
                ...(pausedMsg ? [pausedMsg] : []),
                '',
                ...rows.map(r => `${r.name}: ${r.total}${r.deleted ? ` (${r.deleted} deleted)` : ''}${r.localOnly ? ' [this device only]' : ''}`),
                '',
                `Total in synced tables: ${grand}`
            ];
            this._dataCheckText = lines.join('\n');

            body.innerHTML = `
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--space-sm); margin-bottom: var(--space-base); font-size: var(--font-size-body-small);">
                    <div><strong>This device:</strong> <span id="data-check-device">${device}</span></div>
                    <div><strong>App version:</strong> ${escapeHtml(appVersion)}</div>
                    <div><strong>Database version:</strong> ${db.verno}</div>
                    <div><strong>Sync:</strong> ${syncOn ? 'on' : 'off'}</div>
                    <div><strong>Last upload:</strong> <span id="data-check-last-upload">${escapeHtml(when('last-drive-sync-push'))}</span></div>
                    <div><strong>Last download:</strong> <span id="data-check-last-download">${escapeHtml(when('last-drive-sync-received'))}</span></div>
                    <div><strong>Skills migration:</strong> <span id="data-check-epoch">${escapeHtml(epochText)}</span></div>
                </div>
                ${pausedMsg ? `<p id="data-check-paused" style="color: var(--color-error); font-weight: 600; font-size: var(--font-size-body-small);">⛔ ${escapeHtml(pausedMsg)}</p>` : ''}
                <table class="data-check-table" style="width: 100%; border-collapse: collapse; font-size: var(--font-size-body-small);">
                    <thead><tr style="text-align: left; border-bottom: 1px solid var(--color-border);">
                        <th style="padding: 4px 6px;">Table</th>
                        <th style="padding: 4px 6px; text-align: right;">Records</th>
                        <th style="padding: 4px 6px; text-align: right;">Of which deleted</th>
                    </tr></thead>
                    <tbody>
                        ${rows.map(r => `<tr data-table="${r.name}" style="border-bottom: 1px solid var(--color-border);${r.localOnly ? ' color: var(--color-text-tertiary);' : ''}">
                            <td style="padding: 4px 6px;">${r.name}${r.localOnly ? ' <em>(this device only)</em>' : ''}</td>
                            <td class="data-check-total" style="padding: 4px 6px; text-align: right;">${r.total}</td>
                            <td style="padding: 4px 6px; text-align: right;">${r.deleted || ''}</td>
                        </tr>`).join('')}
                    </tbody>
                    <tfoot><tr><td style="padding: 6px; font-weight: 600;">Total in synced tables</td><td id="data-check-grand" style="padding: 6px; text-align: right; font-weight: 600;">${grand}</td><td></td></tr></tfoot>
                </table>`;
        } catch (e) {
            console.error('Data check failed:', e);
            body.innerHTML = '<p style="color: var(--color-error);">Could not read the counts. Close and reopen the app, then try again.</p>';
        }
    },

    copyDataCheck: async function() {
        if (!this._dataCheckText) await this.renderDataCheck();
        try {
            await navigator.clipboard.writeText(this._dataCheckText);
            ui.showToast('Counts copied (no names)', 'success');
        } catch (e) {
            ui.showToast('Could not copy. Take a screenshot of this screen instead.', 'warning');
        }
    },

    renderActivityLog: async function() {
        const container = document.getElementById('activity-log-list');
        if (!container) return;

        try {
            const logs = await db.activityLog.orderBy('id').reverse().toArray();

            if (logs.length === 0) {
                container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">No actions recorded yet.</p>';
                return;
            }

            const actionIcons = {
                create: '➕', update: '✏️', delete: '🗑️', archive: '📦',
                restore: '♻️', import: '📤', export: '📥', grade: '📝',
                attendance: '📋', undo: '↩️'
            };

            let html = '<div style="max-height: 400px; overflow-y: auto;">';
            for (const log of logs) {
                const icon = actionIcons[log.action] || '•';
                const timeAgo = formatTimeAgo(new Date(log.timestamp));
                html += `<div style="display: flex; gap: var(--space-sm); align-items: flex-start; padding: var(--space-sm) 0; border-bottom: 1px solid var(--color-border);">
                    <span style="flex-shrink: 0; font-size: 1.1em;">${icon}</span>
                    <div style="flex: 1; min-width: 0;">
                        <span style="font-size: var(--font-size-body-small);">${escapeHtml(log.description)}</span>
                        <div style="font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px;">${timeAgo}</div>
                    </div>
                </div>`;
            }
            html += '</div>';
            container.innerHTML = html;
        } catch (err) {
            console.error('Error loading activity log:', err);
            container.innerHTML = '<p style="color: var(--color-error);">Failed to load activity log.</p>';
        }
    },

    restoreItem: async function(table, id) {
        try {
            const updates = { deletedAt: null };
            if (table === 'students') updates.status = 'active';
            await db[table].update(id, updates);
            driveSync.markDirty(); await logAction('restore', table, id, `Restored ${table.slice(0, -1)} from Deleted Items`);
            ui.showToast('Item restored successfully', 'success');
            this.renderDeletedItems();
        } catch (err) {
            console.error('Error restoring item:', err);
            ui.showToast('Failed to restore item', 'error');
        }
    },

    permanentlyDelete: async function(table, id) {
        const record = await db[table].get(id);
        const name = record ? (table === 'students' ? displayName(record) : (record.name || 'this item')) : 'this item';
        if (!confirm(`Permanently delete "${name}"? This will remove all associated data and CANNOT be undone.`)) {
            return;
        }

        try {
            const now = new Date().toISOString();

            // Keep the main record as a tombstone so Drive sync propagates the deletion.
            // Only wipe associated data (natural-key tables that don't have this problem).
            if (table === 'students') {
                await db.students.update(id, {
                    deletedAt: now, status: 'deleted', permanentlyDeleted: true, updatedAt: now
                });
                await Promise.all([
                    db.enrollments.where('studentId').equals(id).delete(),
                    db.teamMembers.where('studentId').equals(id).delete(),
                    db.attendance.where('studentId').equals(String(id)).delete(),
                    db.checkpointCompletions.where('studentId').equals(id).delete(),
                    db.submissions.where('studentId').equals(id).delete(),
                    db.notes.where('entityType').equals('student').filter(n => n.entityId === id).delete(),
                ]);
                if (db.skillLevels) await db.skillLevels.where('studentId').equals(id).delete();
                if (db.skillObservations) await db.skillObservations.where('studentId').equals(id).delete();
                if (db.certifications) await db.certifications.where('studentId').equals(id).delete();
                if (db.checkouts) await db.checkouts.where('studentId').equals(id).delete();
            } else if (table === 'teams') {
                await db.teams.update(id, {
                    deletedAt: now, permanentlyDeleted: true, updatedAt: now
                });
                await db.teamMembers.where('teamId').equals(id).delete();
            } else if (table === 'activities') {
                const checkpointIds = (await db.checkpoints.where('activityId').equals(id).toArray()).map(cp => cp.id);
                await db.activities.update(id, {
                    deletedAt: now, permanentlyDeleted: true, updatedAt: now
                });
                await db.checkpoints.where('activityId').equals(id).delete();
                if (checkpointIds.length > 0) {
                    await db.checkpointCompletions.where('checkpointId').anyOf(checkpointIds).delete();
                }
            } else {
                await db[table].update(id, {
                    deletedAt: now, permanentlyDeleted: true, updatedAt: now
                });
            }

            ui.showToast('Permanently deleted', 'success');
            driveSync.markDirty();
            this.renderDeletedItems();
        } catch (err) {
            console.error('Error permanently deleting:', err);
            ui.showToast('Failed to permanently delete', 'error');
        }
    },
    
    renderClasses: async function() {
        const container = document.getElementById('classes-list');
        if (!container) return;
        try {
            const classes = await db.classes.toArray();
            if (classes.length === 0) {
                container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic; padding: var(--space-lg);">No classes added yet.</p>';
                return;
            }

            const active = classes.filter(c => c.status !== 'archived');
            const archived = classes.filter(c => c.status === 'archived');

            container.innerHTML = '';
            // 3-01: each active class shows its "Skills grading" switch
            const modes = {};
            for (const cls of active) modes[cls.id] = await getClassMasteryMode(cls.id);
            active.forEach(cls => this.renderClassCard(cls, container, false, modes[cls.id]));

            if (archived.length > 0) {
                const archivedHeader = document.createElement('div');
                archivedHeader.style.cssText = 'margin-top: var(--space-lg); margin-bottom: var(--space-sm); padding-top: var(--space-md); border-top: 1px solid var(--color-border);';
                archivedHeader.innerHTML = '<p style="color: var(--color-text-tertiary); font-size: var(--font-size-sm); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Archived</p>';
                container.appendChild(archivedHeader);
                archived.forEach(cls => this.renderClassCard(cls, container, true));
            }

        } catch (error) {
            console.error('Error rendering classes:', error);
        }
    },

    renderClassCard: function(cls, container, isArchived, masteryMode) {
        const periods = (cls.periods || []).map(p =>
            `<span class="badge" style="background-color: ${isArchived ? '#a3a3a3' : cls.color}; color: white;">
                ${p === 'wildcat' ? 'Wildcat' : 'P' + p}
            </span>`
        ).join('');

        const card = document.createElement('div');
        card.className = 'card';
        card.style.cssText = `display: flex; align-items: center; gap: var(--space-base); padding: var(--space-base); margin-bottom: var(--space-sm); ${isArchived ? 'opacity: 0.6;' : ''}`;
        card.innerHTML = `
            <div style="width: 32px; height: 32px; border-radius: 50%; background-color: ${isArchived ? '#a3a3a3' : escapeHtml(cls.color)}; flex-shrink: 0;"></div>
            <div style="flex: 1;">
                <div style="font-weight: 600; margin-bottom: var(--space-xs);">
                    ${escapeHtml(cls.name)}
                    ${isArchived ? '<span class="badge badge--secondary" style="margin-left: var(--space-xs);">Archived</span>' : ''}
                </div>
                <div style="display: flex; gap: var(--space-xs); flex-wrap: wrap;">${periods}</div>
                ${!isArchived ? `<label style="display: flex; align-items: center; gap: var(--space-xs); margin-top: var(--space-xs); font-size: var(--font-size-body-small); cursor: pointer;">
                    <input type="checkbox" class="class-skills-grading-toggle" data-class-id="${cls.id}" ${isSkillsGradedMode(masteryMode) ? 'checked' : ''}
                        onchange="pages.settings.toggleSkillsGrading(${cls.id}, this.checked)">
                    Skills grading <span style="color: var(--color-text-tertiary);">(grading tab shows skill observations and Professional Practice)</span>
                </label>` : ''}
            </div>
            <div style="display: flex; gap: var(--space-xs);">
                ${!isArchived ? `<button class="btn btn--secondary" onclick="pages.settings.showEditClassModal(${cls.id})">Edit</button>` : ''}
                ${!isArchived ? `<button class="btn btn--secondary" onclick="pages.settings.archiveClass(${cls.id})">Archive</button>` : ''}
                ${isArchived ? `<button class="btn btn--secondary" onclick="pages.settings.restoreClass(${cls.id})">Restore</button>` : ''}
            </div>
        `;
        container.appendChild(card);
    },

    // 3-01: the per-class "Skills grading" switch. On writes the spec's default scoring mode
    // (weighted-average, §3), unless the class already has a mode; off writes 'off'.
    toggleSkillsGrading: async function(classId, on) {
        try {
            const current = await getClassMasteryMode(classId);
            const mode = on ? (isSkillsGradedMode(current) ? current : 'weighted-average') : 'off';
            await setClassMasteryMode(classId, mode);
            const cls = await db.classes.get(classId);
            logAction('update', 'settings', classId, `Skills grading ${on ? 'on' : 'off'} for class ${classId}`);
            ui.showToast(`Skills grading ${on ? 'on' : 'off'} for ${cls ? cls.name : 'this class'}`, 'success');
        } catch (err) {
            console.error('Could not change skills grading:', err);
            ui.showToast('Could not change skills grading', 'error');
            this.renderClasses();
        }
    },

    showAddClassModal: async function() {
        state.editingClassId = null;
        document.getElementById('class-modal-title').textContent = 'Add Class';
        document.getElementById('class-name').value = '';
        document.getElementById('class-color').value = '#3b82f6';
        document.getElementById('delete-class-btn').style.display = 'none';
        await this.renderClassPeriodCheckboxes([]);
        ui.showModal('modal-class');
    },

    showEditClassModal: async function(id) {
        state.editingClassId = id;
        document.getElementById('class-modal-title').textContent = 'Edit Class';
        document.getElementById('delete-class-btn').style.display = 'inline-flex';
        const cls = await db.classes.get(id);
        document.getElementById('class-name').value = cls.name;
        document.getElementById('class-color').value = cls.color;
        await this.renderClassPeriodCheckboxes(cls.periods || []);
        ui.showModal('modal-class');
    },

    renderClassPeriodCheckboxes: async function(selectedPeriods) {
        const container = document.getElementById('class-period-checkboxes');
        const numPeriodsData = await db.settings.get('num-periods');
        const numPeriods = numPeriodsData?.value || 8;

        container.innerHTML = '';

        for (let i = 1; i <= numPeriods; i++) {
            const checked = selectedPeriods.includes(String(i)) ? 'checked' : '';
            const label = document.createElement('label');
            label.style.cssText = 'display: flex; align-items: center; gap: var(--space-xs); cursor: pointer; padding: var(--space-xs) var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-sm);';
            label.innerHTML = `<input type="checkbox" value="${escapeHtml(i)}" ${checked}> Period ${escapeHtml(i)}`;
            container.appendChild(label);
        }

        const wildcatChecked = selectedPeriods.includes('wildcat') ? 'checked' : '';
        const wildcatLabel = document.createElement('label');
        wildcatLabel.style.cssText = 'display: flex; align-items: center; gap: var(--space-xs); cursor: pointer; padding: var(--space-xs) var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-sm);';
        wildcatLabel.innerHTML = `<input type="checkbox" value="wildcat" ${wildcatChecked}> Wildcat`;
        container.appendChild(wildcatLabel);
    },

    hideClassModal: function() {
        ui.hideModal('modal-class');
        state.editingClassId = null;
    },

    saveClass: async function() {
        const name = document.getElementById('class-name').value.trim();
        const color = document.getElementById('class-color').value;

        if (!name) {
            ui.showToast('Class name is required', 'error');
            return;
        }

        const checkboxes = document.querySelectorAll('#class-period-checkboxes input[type="checkbox"]');
        const periods = Array.from(checkboxes)
            .filter(cb => cb.checked)
            .map(cb => cb.value);

        const data = { name, color, periods, createdAt: new Date().toISOString() };
            if (!state.editingClassId) {
                data.status = 'active';
            }

        try {
            if (state.editingClassId) {
                await db.classes.update(state.editingClassId, data);
                ui.showToast('Class updated', 'success');
            } else {
                await db.classes.add(data);
                ui.showToast('Class added', 'success');
            }
            this.hideClassModal();
            this.renderClasses();
        } catch (error) {
            console.error('Error saving class:', error);
            ui.showToast('Failed to save class', 'error');
        }
    },

    deleteClass: async function() {
        if (!state.editingClassId) return;

        // Check for linked records before allowing delete
        const linkedStudents = await db.students.where('classId').equals(state.editingClassId).count();
        const linkedTeams = await db.teams.where('classId').equals(state.editingClassId).count();
        const linkedActivities = await db.activities.where('classId').equals(state.editingClassId).count();

        if (linkedStudents > 0 || linkedTeams > 0 || linkedActivities > 0) {
            const parts = [];
            if (linkedStudents > 0) parts.push(`${linkedStudents} student${linkedStudents > 1 ? 's' : ''}`);
            if (linkedTeams > 0) parts.push(`${linkedTeams} team${linkedTeams > 1 ? 's' : ''}`);
            if (linkedActivities > 0) parts.push(`${linkedActivities} assignment${linkedActivities > 1 ? 's' : ''}`);
            ui.showToast(`Cannot delete — this class has ${parts.join(', ')} linked to it. Reassign or delete them first.`, 'error', 6000);
            return;
        }

        if (!confirm('Delete this class? This cannot be undone.')) return;

        try {
            await db.classes.delete(state.editingClassId);
            ui.showToast('Class deleted', 'success');
            this.hideClassModal();
            this.renderClasses();
        } catch (error) {
            console.error('Error deleting class:', error);
            ui.showToast('Failed to delete class', 'error');
        }
    },

    archiveClass: async function(id) {
        if (!confirm('Archive this class? It will be hidden from active dropdowns but all data will be preserved.')) return;
        try {
            await db.classes.update(id, { status: 'archived' });
            ui.showToast('Class archived', 'success');
            this.renderClasses();
        } catch (error) {
            console.error('Error archiving class:', error);
            ui.showToast('Failed to archive class', 'error');
        }
    },

    restoreClass: async function(id) {
        try {
            await db.classes.update(id, { status: 'active' });
            ui.showToast('Class restored', 'success');
            this.renderClasses();
        } catch (error) {
            console.error('Error restoring class:', error);
            ui.showToast('Failed to restore class', 'error');
        }
    },
    
    clearTodayAttendance: async function() {
        if (!confirm('Are you sure you want to delete ALL attendance records for today? This cannot be undone.')) {
            return;
        }
        
        try {
            const todayString = getTodayString();
            
            const recordsToDelete = await db.attendance.where('date').equals(todayString).toArray();
            const count = recordsToDelete.length;
            
            if (count === 0) {
                ui.showToast('No attendance records found for today', 'info');
                return;
            }
            
            await db.attendance.where('date').equals(todayString).delete();
            
            ui.showToast(`Deleted ${count} attendance record(s) for ${todayString}`, 'success');
            
            // Refresh dashboard if visible
            if (!document.getElementById('page-dashboard').classList.contains('hidden')) {
                pages.dashboard.render();
            }
            
        } catch (error) {
            console.error('Error clearing attendance:', error);
            ui.showToast('Failed to clear attendance', 'error');
        }
    },

    // Load all webhook URLs into their input fields and set toggle state
    loadWebhooks: function() {
        // Set toggle state from localStorage
        const enabled = localStorage.getItem('automations-enabled') === 'true';
        this.setAutomationsUI(enabled);

        // Load saved URLs
        const webhookTypes = ['wildcat', 'absent', 'token', 'widget-base'];
        webhookTypes.forEach(type => {
            const savedUrl = localStorage.getItem(`webhook_${type}`) || '';
            const urlInput = document.getElementById(`webhook-${type}`);
            if (urlInput) urlInput.value = savedUrl;
        });
        // Load auto-check times
        const time1 = localStorage.getItem('auto-check-time-1') || '';
        const time2 = localStorage.getItem('auto-check-time-2') || '';
        const input1 = document.getElementById('auto-check-time-1');
        const input2 = document.getElementById('auto-check-time-2');
        if (input1) input1.value = time1;
        if (input2) input2.value = time2;
    },

    // Called when the toggle is clicked
    handleAutomationsToggle: function(isChecked) {
        if (isChecked) {
            // Show FERPA agreement modal — don't enable yet
            ui.showModal('modal-ferpa-agreement');
            // Revert toggle visually until they agree
            this.setAutomationsUI(false);
        } else {
            // Turning off — no confirmation needed
            localStorage.setItem('automations-enabled', 'false');
            localStorage.removeItem('ferpa-webhook-acknowledged');
            this.setAutomationsUI(false);
            ui.showToast('Email automations disabled. No student data will be transmitted.', 'info');
        }
    },

    // User clicked "I Agree & Enable" in the FERPA modal
    acceptFerpa: function() {
        localStorage.setItem('automations-enabled', 'true');
        localStorage.setItem('ferpa-webhook-acknowledged', 'true');
        ui.hideModal('modal-ferpa-agreement');
        this.setAutomationsUI(true);
        ui.showToast('Email automations enabled.', 'success');
    },

    // User clicked "Cancel" in the FERPA modal
    declineFerpa: function() {
        ui.hideModal('modal-ferpa-agreement');
        this.setAutomationsUI(false);
        ui.showToast('Email automations remain disabled.', 'info');
    },

    // Update all UI elements to reflect enabled/disabled state
    setAutomationsUI: function(enabled) {
        const toggle = document.getElementById('automations-enabled-toggle');
        const track = document.getElementById('automations-toggle-track');
        const thumb = document.getElementById('automations-toggle-thumb');
        const label = document.getElementById('automations-toggle-label');
        const section = document.getElementById('webhook-config-section');

        if (toggle) toggle.checked = enabled;
        if (track) track.style.background = enabled ? 'var(--color-success)' : 'var(--color-border)';
        if (thumb) thumb.style.transform = enabled ? 'translateX(22px)' : 'translateX(0)';
        if (label) label.textContent = enabled ? 'On' : 'Off';
        if (section) section.style.display = enabled ? 'block' : 'none';
    },

    // Save a specific webhook URL
    saveWebhook: function(type) {
        const urlInput = document.getElementById(`webhook-${type}`);
        if (!urlInput) return;
        
        const url = urlInput.value.trim();
        
        if (url !== '') {
            localStorage.setItem(`webhook_${type}`, url);
            ui.showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} webhook saved!`, 'success');
        } else {
            localStorage.removeItem(`webhook_${type}`);
            ui.showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} webhook cleared.`, 'info');
        }
    },

    saveAutoCheckTimes: function() {
        const time1 = document.getElementById('auto-check-time-1').value || '';
        const time2 = document.getElementById('auto-check-time-2').value || '';
        localStorage.setItem('auto-check-time-1', time1);
        localStorage.setItem('auto-check-time-2', time2);
        ui.showToast(`Auto-check times saved${time1 ? ': ' + time1 : ''}${time2 ? ', ' + time2 : ''}`, 'success');
    },    

    // Shortest password accepted for an encrypted backup (plan row 1-02)
    EXPORT_PASSWORD_MIN: 8,

    exportData: async function() {
        try {
            // Typed twice (plan row 1-02): one typo would make the backup file unreadable
            const password = prompt(`🔒 Enter a password to encrypt this backup (at least ${this.EXPORT_PASSWORD_MIN} characters):`);
            if (!password) {
                ui.showToast('Export cancelled. Password required for security.', 'error');
                return;
            }
            if (password.length < this.EXPORT_PASSWORD_MIN) {
                ui.showToast(`That password is too short. Use at least ${this.EXPORT_PASSWORD_MIN} characters. Nothing was exported.`, 'error');
                return;
            }
            const confirmPassword = prompt('🔒 Type the same password again to confirm:');
            if (confirmPassword === null) {
                ui.showToast('Export cancelled.', 'error');
                return;
            }
            if (confirmPassword !== password) {
                ui.showToast("The two passwords didn't match. Nothing was exported. Please try again.", 'error');
                return;
            }

            const data = {};
            
            for (const table of db.tables) {
                data[table.name] = await table.toArray();
            }
            data.schemaVersion = db.verno;
            data.appVersion = '1.0';
            data.exportDate = new Date().toISOString();
            data.exportDevice = navigator.userAgent;
                                        
            data.webhooks = {};
            const webhookTypes = ['wildcat', 'absent'];
            webhookTypes.forEach(type => {
                const url = localStorage.getItem(`webhook_${type}`);
                if (url) data.webhooks[type] = url;
            });
            
            const rawJson = JSON.stringify(data);
            const encryptedJson = await secureStorage.encrypt(rawJson, password);
            
            const filename = `engineering-second-brain-SECURE-${getTodayString()}.json`;
            const blob = new Blob([encryptedJson], { type: 'application/json' });

            // Detect iPad/iOS
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

            if (isIOS) {
                // iPad: show overlay with a button that triggers navigator.share on tap (fresh user gesture)
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10000;';

                const shareBtn = document.createElement('button');
                shareBtn.textContent = '📥 Tap to Save Backup File';
                shareBtn.style.cssText = 'padding:16px 32px;background:#C8102E;color:white;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;max-width:320px;';
                shareBtn.onclick = async () => {
                    try {
                        const file = new File([blob], filename, { type: 'application/json' });
                        await navigator.share({ files: [file], title: 'Classroom Backup' });
                        overlay.remove();
                        await exportReminder.recordExport();
                        await logAction('export', 'settings', null, 'Exported JSON backup');
                        ui.showToast('Data safely encrypted and exported!', 'success');
                    } catch (err) {
                        if (err.name !== 'AbortError') {
                            console.error('Share failed:', err);
                            ui.showToast('Share failed. Try again.', 'error');
                        }
                    }
                };

                const closeBtn = document.createElement('button');
                closeBtn.textContent = 'Cancel';
                closeBtn.style.cssText = 'margin-top:12px;padding:10px 24px;background:white;border:1px solid #ccc;border-radius:8px;font-size:14px;cursor:pointer;';
                closeBtn.onclick = () => overlay.remove();

                overlay.appendChild(shareBtn);
                overlay.appendChild(closeBtn);
                document.body.appendChild(overlay);
            } else {
                // PC: programmatic download link
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                await exportReminder.recordExport();
                await logAction('export', 'settings', null, 'Exported JSON backup');
                ui.showToast('Data safely encrypted and exported!', 'success');
            }
        } catch (error) {
            console.error('Export error:', error);
            ui.showToast('Failed to export data safely.', 'error');
        }
    },

    exportStudentAnalytics: async function() {
        try {
            ui.showToast('Building analytics export...', 'info');

            // ========== GATHER ALL DATA ==========
            const activeYear = await getActiveSchoolYear();
            const [
                allStudents, allEnrollments, allClasses,
                allActivities, allCheckpoints, allCompletions,
                allSubmissions, allSkills, allSkillLevels,
                allCertifications, allInventory, allAttendance,
                allNotes, allTeams, allTeamMembers,
                allActivitySkills, niData
            ] = await Promise.all([
                db.students.toArray(),
                db.enrollments.toArray(),
                db.classes.toArray(),
                db.activities.toArray(),
                db.checkpoints.toArray(),
                db.checkpointCompletions.toArray(),
                db.submissions.toArray(),
                db.skills.toArray(),
                db.skillLevels.toArray(),
                db.certifications.toArray(),
                db.inventory.toArray(),
                db.attendance.toArray(),
                db.notes.toArray(),
                db.teams.toArray(),
                db.teamMembers.toArray(),
                db.activitySkills.toArray(),
                getActiveNonInstructionalDays()
            ]);

            // ========== SETUP LOOKUPS ==========
            const classMap = new Map(allClasses.map(c => [c.id, c]));
            const niDays = niData || [];
            const isNonInstructionalDay = (dateStr) => niDays.some(ni => {
                if (ni.end) return dateStr >= ni.date && dateStr <= ni.end;
                return ni.date === dateStr;
            });

            const students = allStudents.filter(s => !s.deletedAt && s.status !== 'archived');
            if (students.length === 0) {
                ui.showToast('No active students to export.', 'error');
                return;
            }

            const activities = excludeDeleted(allActivities).sort((a, b) =>
                (a.startDate || '').localeCompare(b.startDate || '')
            );

            // One column per visible skill; retired and merged-away skills are left out (P16 C3)
            const skills = allSkills.filter(s => !isSkillHidden(s)).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            const hiddenSkillIdSet = new Set(allSkills.filter(isSkillHidden).map(s => s.id));
            const inventoryMap = new Map(allInventory.map(i => [i.id, i]));
            const feedbackLogs = allNotes.filter(n => n.entityType === 'feedback-log');

            // ========== BUILD COLUMN HEADERS ==========
            const headers = [
                'Student ID',
                'Class',
                'Period',
                'Team',
                'Attend: Days Tracked',
                'Attend: Present',
                'Attend: Absent',
                'Attend: Late',
                'Attend: % Present',
            ];

            activities.forEach(a => {
                const safeName = (a.name || 'Activity').replace(/,/g, ' ');
                headers.push(`${safeName}: Status`);
                headers.push(`${safeName}: PP Rating`);
                headers.push(`${safeName}: PP %`);
                headers.push(`${safeName}: Skills Assessed`);
                headers.push(`${safeName}: Mastery %`);
                headers.push(`${safeName}: CP Done`);
                headers.push(`${safeName}: CP Total`);
                headers.push(`${safeName}: CP %`);
                headers.push(`${safeName}: Feedback Sent`);
            });

            skills.forEach(s => {
                headers.push(`Skill: ${(s.name || '').replace(/,/g, ' ')}`);
            });

            headers.push('Certifications: Count');
            headers.push('Certifications: Tools');

            // ========== BUILD ONE ROW PER STUDENT ==========
            const rows = [];

            for (const student of students) {
                const row = {};

                // --- Identity ---
                row['Student ID'] = student.anonId || '';

                // --- Class, Period, Team ---
                const enrollment = allEnrollments.find(e =>
                    e.studentId === student.id &&
                    (e.schoolYear === activeYear || !e.schoolYear)
                );
                const cls = student.classId ? classMap.get(student.classId) : null;
                row['Class'] = cls ? cls.name : '';
                row['Period'] = enrollment ? enrollment.period : '';

                const teamMembership = allTeamMembers.find(tm => tm.studentId === student.id);
                const team = teamMembership ? allTeams.find(t => t.id === teamMembership.teamId) : null;
                row['Team'] = team ? team.name : '';

                // --- Attendance ---
                const studentAttendance = allAttendance.filter(r =>
                    String(r.studentId) === String(student.id) &&
                    !isNonInstructionalDay(r.date)
                );
                const attendTotal = studentAttendance.length;
                const attendAbsent = studentAttendance.filter(r => (r.status || '').toLowerCase() === 'absent').length;
                const attendLate = studentAttendance.filter(r => (r.status || '').toLowerCase() === 'late').length;
                const attendPresent = attendTotal - attendAbsent - attendLate;
                const attendPct = attendTotal > 0 ? Math.round((attendPresent / attendTotal) * 1000) / 10 : '';

                row['Attend: Days Tracked'] = attendTotal;
                row['Attend: Present'] = attendPresent;
                row['Attend: Absent'] = attendAbsent;
                row['Attend: Late'] = attendLate;
                row['Attend: % Present'] = attendPct !== '' ? attendPct + '%' : '';

                // --- Per-Activity Data ---
                const studentSubmissions = allSubmissions.filter(s => s.studentId === student.id);
                const studentSubMap = new Map(studentSubmissions.map(s => [s.activityId, s]));
                const studentClassId = student.classId;

                const ratingToScore = { 'Beginning': 25, 'Developing': 50, 'Proficient': 75, 'Advanced': 100 };

                for (const activity of activities) {
                    const safeName = (activity.name || 'Activity').replace(/,/g, ' ');
                    const sub = studentSubMap.get(activity.id);
                    const actCheckpoints = allCheckpoints.filter(cp => cp.activityId === activity.id);
                    const isMyClass = activity.classId === studentClassId;

                    if (!isMyClass) {
                        row[`${safeName}: Status`] = '';
                        row[`${safeName}: PP Rating`] = '';
                        row[`${safeName}: PP %`] = '';
                        row[`${safeName}: Skills Assessed`] = '';
                        row[`${safeName}: Mastery %`] = '';
                        row[`${safeName}: CP Done`] = '';
                        row[`${safeName}: CP Total`] = '';
                        row[`${safeName}: CP %`] = '';
                        row[`${safeName}: Feedback Sent`] = '';
                        continue;
                    }

                    row[`${safeName}: Status`] = sub ? sub.status : 'not-started';

                    // PP Rating
                    const ppRating = sub?.professionalPractice || '';
                    row[`${safeName}: PP Rating`] = ppRating;
                    row[`${safeName}: PP %`] = ratingToScore[ppRating] != null ? ratingToScore[ppRating] + '%' : '';

                    // Skills mastery
                    const actSkills = allActivitySkills.filter(as => as.activityId === activity.id && !as.deletedAt && !hiddenSkillIdSet.has(as.skillId));
                    let skillTotal = 0, skillCount = 0;
                    for (const as of actSkills) {
                        const level = await db.skillLevels
                            .where('studentId').equals(student.id)
                            .filter(sl => sl.skillId === as.skillId && isLevelLive(sl))
                            .first();
                        if (level && ratingToScore[level.level] != null) {
                            skillTotal += ratingToScore[level.level];
                            skillCount++;
                        }
                    }
                    row[`${safeName}: Skills Assessed`] = skillCount > 0 ? skillCount : '';
                    row[`${safeName}: Mastery %`] = skillCount > 0 ? Math.round(skillTotal / skillCount) + '%' : '';

                    if (actCheckpoints.length > 0) {
                        const studentCpDone = allCompletions.filter(c =>
                            String(c.studentId) === String(student.id) &&
                            c.completed &&
                            actCheckpoints.some(cp => cp.id === c.checkpointId)
                        ).length;
                        row[`${safeName}: CP Done`] = studentCpDone;
                        row[`${safeName}: CP Total`] = actCheckpoints.length;
                        row[`${safeName}: CP %`] = Math.round((studentCpDone / actCheckpoints.length) * 100) + '%';
                    } else {
                        row[`${safeName}: CP Done`] = '';
                        row[`${safeName}: CP Total`] = 0;
                        row[`${safeName}: CP %`] = '';
                    }

                    const fbSent = feedbackLogs.some(log =>
                        log.entityId === student.id &&
                        (log.content || '').includes(activity.name)
                    );
                    row[`${safeName}: Feedback Sent`] = fbSent ? 'Yes' : 'No';
                }

                // --- Skills ---
                const calcSkillMap = await getCalculatedSkillLevels(student.id);
                const manualSkillMap = new Map(
                    allSkillLevels.filter(sl => sl.studentId === student.id && isLevelLive(sl)).map(sl => [sl.skillId, sl.level])
                );

                skills.forEach(skill => {
                    const colName = `Skill: ${(skill.name || '').replace(/,/g, ' ')}`;
                    const calc = calcSkillMap.get(String(skill.id));
                    const manual = manualSkillMap.get(skill.id);
                    if (calc) {
                        row[colName] = calc.level;
                    } else if (manual) {
                        row[colName] = manual;
                    } else {
                        row[colName] = '';
                    }
                });

                // --- Certifications ---
                const studentCerts = allCertifications.filter(c => c.studentId === student.id);
                row['Certifications: Count'] = studentCerts.length;
                row['Certifications: Tools'] = studentCerts.map(c => {
                    const item = inventoryMap.get(c.toolId);
                    return item ? item.name : 'Unknown';
                }).join('; ');

                rows.push(row);
            }

            // ========== BUILD CSV STRING ==========
            rows.sort((a, b) => (a['Student ID'] || '').localeCompare(b['Student ID'] || ''));

            let csv = headers.map(h => csvEscape(h)).join(',') + '\n';

            rows.forEach(row => {
                csv += headers.map(h => csvEscape(row[h] != null ? row[h] : '')).join(',') + '\n';
            });

            downloadCSV(csv, `Student_Analytics_FERPA_${activeYear}`);
            ui.showToast(`Analytics exported: ${rows.length} students, ${headers.length} columns.`, 'success');

        } catch (error) {
            console.error('Analytics export error:', error);
            ui.showToast('Failed to export analytics data.', 'error');
        }
    },

    // Staging area for import data — set by importData, read by executeImport
    _importStaged: null,

    // ── Import safety (plan row 1-01, DL3) ──
    // Tables a Replace All file must contain (every export has them, even when empty)
    _IMPORT_CORE_TABLES: ['students', 'classes', 'activities', 'enrollments', 'settings'],

    // Returns a plain-English reason the file can't be used in this mode, or null if it's fine.
    _validateImport: async function(data, mode) {
        for (const table of db.tables) {
            const v = data[table.name];
            if (v === undefined) continue;
            if (!Array.isArray(v)) return `"${table.name}" in this file is not a list of records.`;
            if (v.some(r => typeof r !== 'object' || r === null || Array.isArray(r))) return `"${table.name}" in this file contains something that isn't a record.`;
        }
        if (mode === 'replace' || mode === 'setup') {
            const need = mode === 'replace' ? this._IMPORT_CORE_TABLES : ['students', 'classes', 'activities'];
            const missing = need.filter(t => !Array.isArray(data[t]));
            if (missing.length) return `This file has no ${missing.join(', ')} table${missing.length > 1 ? 's' : ''}, so it isn't a full backup.`;
            const emptied = mode === 'replace' ? ['students', 'classes', 'activities'] : ['classes'];
            for (const t of emptied) {
                if (data[t].length === 0 && (await db.table(t).count()) > 0) {
                    return `This file has no ${t}, but this device has some. ${mode === 'replace' ? 'Replace All' : 'Sync Setup Only'} would remove them.`;
                }
            }
        }
        // P16 N6: a file from the other side of the skills migration can only come in by Replace All
        // (the re-seed and the undo); merging it would bring old skills back.
        if (mode === 'merge' || mode === 'setup') {
            const fileEpoch = syncEpochOf(data);
            const deviceEpoch = await localSyncEpoch();
            if (fileEpoch !== deviceEpoch) {
                return `This file is from ${epochSide(fileEpoch)} and this device is from ${epochSide(deviceEpoch)}. Only Replace All can bring it in.`;
            }
        }
        return null;
    },

    importData: async function(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const fileText = await file.text();

            const isEncryptedFile = fileText.includes('"isEncrypted":true');
            let decryptedText = fileText;

            if (isEncryptedFile) {
                const password = prompt("🔓 Enter the password to unlock this backup:");
                if (!password) {
                    ui.showToast('Import cancelled.', 'error');
                    event.target.value = '';
                    return;
                }
                decryptedText = await secureStorage.decrypt(fileText, password);
            }

            let data;
            try {
                data = JSON.parse(decryptedText);
            } catch (e) {
                ui.showToast('Invalid file — could not parse JSON.', 'error');
                event.target.value = '';
                return;
            }

            if (typeof data !== 'object' || Array.isArray(data) || data === null) {
                ui.showToast('Invalid backup file — unexpected format.', 'error');
                event.target.value = '';
                return;
            }

            const knownTables = db.tables.map(t => t.name);
            const hasKnownTable = knownTables.some(name => Array.isArray(data[name]));
            if (!hasKnownTable) {
                ui.showToast('Invalid backup file — no recognised data tables found.', 'error');
                event.target.value = '';
                return;
            }

            // Warn if from a newer schema
            if (data.schemaVersion && data.schemaVersion > db.verno) {
                if (!confirm('⚠️ This backup was made with a newer version of the app (schema v' + data.schemaVersion + ', yours is v' + db.verno + '). Some data may not import correctly. Continue anyway?')) {
                    event.target.value = '';
                    return;
                }
            }

            // Sanitize all string values
            const sanitizeRecord = (record) => {
                if (typeof record !== 'object' || record === null) return record;
                const clean = {};
                for (const [key, value] of Object.entries(record)) {
                    if (typeof value === 'string') {
                        clean[key] = value.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '').replace(/\0/g, '');
                    } else {
                        clean[key] = value;
                    }
                }
                return clean;
            };

            // Sanitize webhook URLs
            if (data.webhooks && typeof data.webhooks === 'object') {
                const cleanedWebhooks = {};
                Object.entries(data.webhooks).forEach(([type, url]) => {
                    if (typeof url === 'string' && url.startsWith('https://')) {
                        cleanedWebhooks[type] = url;
                    }
                });
                data.webhooks = cleanedWebhooks;
            }

            // Sanitize all table data
            for (const table of db.tables) {
                if (data[table.name] && Array.isArray(data[table.name])) {
                    data[table.name] = data[table.name].map(sanitizeRecord);
                }
            }

            // --- ANALYZE DIFFERENCES ---
            // Uses the same natural key logic as executeImport so the preview is accurate
            const analysisNaturalKeys = {
                attendance: ['studentId', 'date', 'period'],
                checkpointCompletions: ['checkpointId', 'studentId'],
                submissions: ['activityId', 'studentId'],
                skillLevels: ['studentId', 'skillId'],
                skillObservations: ['studentId', 'skillId', 'activityId', 'createdAt'],
                certifications: ['studentId', 'toolId'],
                wildcatSchedule: ['studentId', 'targetDate'],
                teamMembers: ['teamId', 'studentId'],
                enrollments: ['studentId', 'period', 'schoolYear'],
                settings: ['key'],
                activityStandards: ['activityId', 'standardId'],
                activitySkills: ['activityId', 'skillId']
            };

            const analysis = { tables: [] };
            let totalImportOnly = 0, totalLocalOnly = 0, totalConflicts = 0, totalIdentical = 0;

            for (const table of db.tables) {
                const tableName = table.name;
                if (tableName === 'activityLog') continue;
                const importRecords = data[tableName] || [];
                const localRecords = await table.toArray();

                if (importRecords.length === 0 && localRecords.length === 0) continue;

                const natKey = analysisNaturalKeys[tableName];
                const makeKey = natKey
                    ? (rec) => natKey.map(f => String(rec[f] ?? '')).join('|')
                    : (rec) => rec.id !== undefined ? String(rec.id) : null;

                const importMap = new Map();
                importRecords.forEach(r => {
                    const k = makeKey(r);
                    if (k !== null) importMap.set(k, r);
                });
                const localMap = new Map();
                localRecords.forEach(r => {
                    const k = makeKey(r);
                    if (k !== null) localMap.set(k, r);
                });

                let importOnly = 0, localOnly = 0, conflicts = 0, identical = 0;

                // Records only in import
                for (const [k] of importMap) {
                    if (!localMap.has(k)) importOnly++;
                }
                // Records only in local
                for (const [k] of localMap) {
                    if (!importMap.has(k)) localOnly++;
                }
                // Records in both — compare timestamps
                for (const [k, importRec] of importMap) {
                    if (localMap.has(k)) {
                        const localRec = localMap.get(k);
                        const importTime = importRec.updatedAt || importRec.createdAt || '';
                        const localTime = localRec.updatedAt || localRec.createdAt || '';
                        if (importTime === localTime) {
                            identical++;
                        } else {
                            conflicts++;
                        }
                    }
                }

                if (importOnly > 0 || localOnly > 0 || conflicts > 0) {
                    analysis.tables.push({ name: tableName, importOnly, localOnly, conflicts, identical, importCount: importRecords.length, localCount: localRecords.length });
                }
                totalImportOnly += importOnly;
                totalLocalOnly += localOnly;
                totalConflicts += conflicts;
                totalIdentical += identical;
            }

            // Stage the data for executeImport
            this._importStaged = data;

            // Build preview HTML
            const previewBody = document.getElementById('import-preview-body');
            let html = '';

            if (data.exportDate) {
                html += `<p style="margin-bottom: var(--space-base); color: var(--color-text-secondary);">Backup from: <strong>${new Date(data.exportDate).toLocaleString()}</strong>`;
                if (data.exportDevice) {
                    const device = data.exportDevice.includes('iPad') || data.exportDevice.includes('iPhone') ? 'iPad' : 'PC';
                    html += ` (${device})`;
                }
                html += `</p>`;
            }

            html += `<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-sm); margin-bottom: var(--space-lg);">
                <div class="card" style="padding: var(--space-base); text-align: center;">
                    <div style="font-size: var(--font-size-h2); font-weight: bold; color: var(--color-info);">${totalImportOnly}</div>
                    <div style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">New from backup</div>
                </div>
                <div class="card" style="padding: var(--space-base); text-align: center;">
                    <div style="font-size: var(--font-size-h2); font-weight: bold; color: var(--color-warning);">${totalConflicts}</div>
                    <div style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">Conflicts</div>
                </div>
                <div class="card" style="padding: var(--space-base); text-align: center;">
                    <div style="font-size: var(--font-size-h2); font-weight: bold; color: var(--color-error);">${totalLocalOnly}</div>
                    <div style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">Only in local</div>
                </div>
            </div>`;

            if (analysis.tables.length > 0) {
                html += `<div style="font-size: var(--font-size-body-small); border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden;">`;
                html += `<div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; padding: var(--space-sm) var(--space-base); background: var(--color-background-secondary); font-weight: 600;">
                    <span>Table</span><span style="text-align:center;">New</span><span style="text-align:center;">Conflicts</span><span style="text-align:center;">Local Only</span>
                </div>`;
                analysis.tables.forEach(t => {
                    html += `<div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; padding: var(--space-sm) var(--space-base); border-top: 1px solid var(--color-border);">
                        <span>${escapeHtml(t.name)}</span>
                        <span style="text-align:center; color: var(--color-info);">${t.importOnly || '—'}</span>
                        <span style="text-align:center; color: var(--color-warning);">${t.conflicts || '—'}</span>
                        <span style="text-align:center; color: var(--color-error);">${t.localOnly || '—'}</span>
                    </div>`;
                });
                html += `</div>`;
            } else {
                html += `<p style="color: var(--color-text-tertiary); text-align: center;">Databases appear identical — no differences found.</p>`;
            }

            html += `<div style="margin-top: var(--space-lg); font-size: var(--font-size-body-small); color: var(--color-text-secondary);">
                <p><strong>Replace All:</strong> Wipe current data and use backup data only.</p>
                <p><strong>Sync Setup Only:</strong> Import assignments, students, teams, skills, standards, and other setup data from the backup. Students, assignments and checkpoints are <em>merged</em> (newer wins) and never removed. <em>Never touches</em> attendance, submissions, or checkpoint completions — your daily classroom data stays safe.</p>
                <p><strong>Merge (Newer Wins):</strong> Keep all local records. Add new records from backup. For conflicts, keep whichever has the newer timestamp.</p>
            </div>`;

            // P16 N6: say which side of the skills migration the file and this device are on
            const fileEpoch = syncEpochOf(data);
            const deviceEpoch = await localSyncEpoch();
            if (fileEpoch || deviceEpoch) {
                const side = e => e ? 'after the skills migration' : 'before the skills migration';
                html += `<p id="import-epoch-line" style="margin-top: var(--space-sm); font-size: var(--font-size-body-small);"><strong>File:</strong> ${side(fileEpoch)} · <strong>This device:</strong> ${side(deviceEpoch)}</p>`;
            }

            // Import safety: switch off any button this file can't safely be used with, and say why
            const problems = [];
            for (const [mode, btnId, label] of [['replace', 'import-replace-btn', 'Replace All'], ['setup', 'import-setup-btn', 'Sync Setup Only'], ['merge', 'import-merge-btn', 'Merge']]) {
                const problem = await this._validateImport(data, mode);
                const btn = document.getElementById(btnId);
                if (btn) {
                    if (btn.dataset.defaultTitle === undefined) btn.dataset.defaultTitle = btn.title || '';
                    btn.disabled = !!problem;
                    btn.title = problem || btn.dataset.defaultTitle;
                }
                if (problem) problems.push(`<li><strong>${label} is switched off:</strong> ${escapeHtml(problem)}</li>`);
            }
            if (problems.length) {
                html = `<div id="import-safety-warning" style="margin-bottom: var(--space-base); padding: var(--space-sm) var(--space-base); border: 1px solid var(--color-warning); border-radius: var(--radius-md); font-size: var(--font-size-body-small);"><ul style="margin: 0; padding-left: 1.2em;">${problems.join('')}</ul></div>` + html;
            }
            html += `<p style="margin-top: var(--space-base); font-size: var(--font-size-body-small); color: var(--color-text-secondary);">Before anything is imported, the app saves a snapshot of this device's data. It's listed under Auto-Backups as "Before import", so you can restore it.</p>`;

            previewBody.innerHTML = html;
            ui.showModal('modal-import-preview');

        } catch (error) {
            console.error('Import error:', error);
            ui.showToast('Failed to read backup. Wrong password or invalid file.', 'error');
        }

        event.target.value = '';
    },

    executeImport: async function(mode) {
        const data = this._importStaged;
        if (!data) {
            ui.showToast('No import data staged.', 'error');
            return;
        }

        ui.hideModal('modal-import-preview');

        try {
            // Import safety (plan row 1-01): check the file, then snapshot this device, before changing anything
            const problem = await this._validateImport(data, mode);
            if (problem) {
                ui.showToast(`${problem} Nothing was changed.`, 'error');
                this._importStaged = null;
                return;
            }
            const modeLabel = { replace: 'Replace All', setup: 'Sync Setup Only', merge: 'Merge' }[mode] || mode;
            const snapshotId = await autoBackup.saveSafety(`Before import (${modeLabel})`);
            if (!snapshotId) {
                ui.showToast('Could not save a safety snapshot first, so nothing was imported.', 'error');
                this._importStaged = null;
                return;
            }

            // Restore webhook URLs
            if (data.webhooks) {
                Object.keys(data.webhooks).forEach(type => {
                    localStorage.setItem(`webhook_${type}`, data.webhooks[type]);
                });
            }
            if (data.webhookUrl !== undefined) {
                if (typeof data.webhookUrl === 'string' && data.webhookUrl.trim().startsWith('https://')) {
                    localStorage.setItem('webhook_wildcat', data.webhookUrl);
                }
            }

            if (mode === 'replace') {
                await db.transaction('rw', db.tables, async () => {
                    syncHooks.markBulk();   // 3-17: imported records keep the backup's timestamps
                  for (const table of db.tables) {
                        const tableName = table.name;
                        if (tableName === 'activityLog') continue; 
                        await table.clear();
                        if (data[tableName] && Array.isArray(data[tableName]) && data[tableName].length > 0) {
                            await table.bulkAdd(data[tableName]);
                        }
                    }
                });
                ui.showToast('Data replaced successfully! Refreshing...', 'success');

            } else if (mode === 'merge') {
                let added = 0, updated = 0, skipped = 0;

                // Natural keys for tables where both devices can independently
                // create records for the same logical entity.
                // Tables NOT listed here use the primary key (id) for matching.
                const naturalKeys = {
                    attendance: ['studentId', 'date', 'period'],
                    checkpointCompletions: ['checkpointId', 'studentId'],
                    submissions: ['activityId', 'studentId'],
                    skillLevels: ['studentId', 'skillId'],
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
                    syncHooks.markBulk();   // 3-17: imported records keep the backup's timestamps
                    for (const table of db.tables) {
                        const tableName = table.name;
                        const importRecords = data[tableName];
                        if (!importRecords || !Array.isArray(importRecords) || importRecords.length === 0) continue;

                        const primaryKey = table.schema.primKey.keyPath;
                        const natKey = naturalKeys[tableName];

                        if (natKey) {
                            // --- NATURAL KEY MATCHING ---
                            const localRecords = await table.toArray();
                            const makeNatKeyStr = (rec) => natKey.map(f => String(rec[f] ?? '')).join('|');
                            const localMap = new Map();
                            localRecords.forEach(r => localMap.set(makeNatKeyStr(r), r));

                            for (const importRec of importRecords) {
                                const natKeyStr = makeNatKeyStr(importRec);
                                const localRec = localMap.get(natKeyStr);

                                if (!localRec) {
                                    // New record — add it, strip id so Dexie auto-assigns
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
                            // --- PRIMARY KEY MATCHING (original logic) ---
                            for (const importRec of importRecords) {
                                const recKey = importRec[primaryKey];
                                if (recKey === undefined) continue;

                                const localRec = await table.get(recKey);

                                if (!localRec) {
                                    await table.put(importRec);
                                    added++;
                                } else {
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
                });
                ui.showToast(`Merged: ${added} added, ${updated} updated, ${skipped} unchanged. Refreshing...`, 'success');
            } else if (mode === 'setup') {
                // --- SETUP SYNC: Replace structural tables, skip operational tables ---
                const setupTables = [
                    'activities', 'checkpoints', 'assignmentTypes',
                    'skills', 'standards', 'activityStandards', 'activitySkills',
                    'classes', 'inventory', 'settings', 'scheduleConfig',
                    'events', 'students', 'teams', 'teamMembers',
                    'enrollments', 'teachers', 'alerts'
                ];

                // Never cleared (plan row 1-01, DL3): grades, attendance and completions point at these ids,
                // so clearing them and re-adding the backup's copies could leave daily data pointing at the wrong record.
                // They are merged by id instead (newer wins), and nothing already on this device is removed.
                const mergeNotClear = ['students', 'activities', 'checkpoints'];

                let replaced = 0;
                let tablesUpdated = 0;

                await db.transaction('rw', db.tables, async () => {
                    syncHooks.markBulk();   // 3-17: imported records keep the backup's timestamps
                    for (const table of db.tables) {
                        const tableName = table.name;
                        if (!setupTables.includes(tableName)) continue;
                        const importRecords = data[tableName];
                        if (!importRecords || !Array.isArray(importRecords)) continue;
                        if (mergeNotClear.includes(tableName)) {
                            for (const rec of importRecords) {
                                if (rec.id === undefined) continue;
                                const local = await table.get(rec.id);
                                const importTime = rec.updatedAt || rec.createdAt || '';
                                const localTime = local ? (local.updatedAt || local.createdAt || '') : '';
                                if (!local || importTime > localTime) { await table.put(rec); replaced++; }
                            }
                            tablesUpdated++;
                            continue;
                        }
                        await table.clear();
                        if (importRecords.length > 0) {
                            await table.bulkAdd(importRecords);
                            replaced += importRecords.length;
                        }
                        tablesUpdated++;
                    }
                });

                ui.showToast(`Setup synced: ${tablesUpdated} tables updated (${replaced} records). Daily data preserved. Refreshing...`, 'success');
            }

            // Post-merge cleanup: deduplicate ALL natural-key tables
            // For each table with natural keys, group records by their natural key,
            // and if duplicates exist, keep the one with the newest timestamp.
            try {
                const dedupeNaturalKeys = {
                    attendance: ['studentId', 'date', 'period'],
                    checkpointCompletions: ['checkpointId', 'studentId'],
                    submissions: ['activityId', 'studentId'],
                    skillLevels: ['studentId', 'skillId'],
                    skillObservations: ['studentId', 'skillId', 'activityId', 'createdAt'],
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
                        if (!groups.has(key)) {
                            groups.set(key, [rec]);
                        } else {
                            groups.get(key).push(rec);
                        }
                    }

                    for (const [, records] of groups) {
                        if (records.length <= 1) continue;

                        // Sort by timestamp descending — keep the newest
                        records.sort((a, b) => {
                            const timeA = a.updatedAt || a.createdAt || '';
                            const timeB = b.updatedAt || b.createdAt || '';
                            return timeB.localeCompare(timeA);
                        });

                        // Delete all but the first (newest)
                        for (let i = 1; i < records.length; i++) {
                            await table.delete(records[i].id);
                            totalDeduped++;
                        }
                    }
                }

                if (totalDeduped > 0) {
                    console.log(`Post-merge cleanup: removed ${totalDeduped} duplicate record(s) across all tables`);
                }
            } catch (e) {
                console.error('Post-merge deduplication error:', e);
            }

            driveSync.markDirty(); await logAction('import', 'settings', null, `Imported data (${mode} mode)`);
            this._importStaged = null;
            setTimeout(() => window.location.reload(), 1200);

        } catch (error) {
            console.error('Import error:', error);
            ui.showToast('Import failed. Your existing data was not changed.', 'error');
            this._importStaged = null;
        }
    },

    loadPeriodMappings: async function() {
        const container = document.getElementById('period-mapping-grid');
        if (!container) return;

        // Load current mapping and active classes
        const mapping = await db.settings.get('period-year-map');
        const currentMapping = mapping?.value || {};
        const classes = (await db.classes.toArray()).filter(c => c.status !== 'archived');

        // Get number of periods from settings
        const numPeriodsData = await db.settings.get('num-periods');
        const numPeriods = numPeriodsData?.value || 8;

        container.innerHTML = '';

        for (let period = 1; period <= numPeriods; period++) {
            const div = document.createElement('div');
            div.className = 'form-group';

            // Build options from active classes
            const options = classes.map(cls =>
                `<option value="${cls.id}" ${currentMapping[String(period)] == cls.id ? 'selected' : ''}>${escapeHtml(cls.name)}</option>`
            ).join('');

            div.innerHTML = `
                <label class="form-label">Period ${escapeHtml(period)}</label>
                <select id="period-${escapeHtml(period)}-mapping" class="form-select">
                    <option value="">None</option>
                    ${options}
                </select>
            `;
            container.appendChild(div);
        }

        // Add Wildcat
        const wildcatDiv = document.createElement('div');
        wildcatDiv.className = 'form-group';
        const wildcatOptions = classes.map(cls =>
            `<option value="${cls.id}" ${currentMapping['wildcat'] == cls.id ? 'selected' : ''}>${cls.name}</option>`
        ).join('');
        wildcatDiv.innerHTML = `
            <label class="form-label">Wildcat</label>
            <select id="period-wildcat-mapping" class="form-select">
                <option value="">None</option>
                ${wildcatOptions}
            </select>
        `;
        container.appendChild(wildcatDiv);
    },

    savePeriodMappings: async function() {
        const newMapping = {};
        
        // Collect values from all period dropdowns
        for (let period = 1; period <= 8; period++) {
            const select = document.getElementById(`period-${period}-mapping`);
            if (select && select.value) {
                newMapping[String(period)] = select.value;
            }
        }
        
        await db.settings.put({
            key: 'period-year-map',
            value: newMapping
        });
        
        driveSync.markDirty(); ui.showToast('Period mappings saved!', 'success');
    },

    // School Calendar functions
    loadSchoolCalendar: async function() {
        try {
            // Load school year dates
            const schoolYear = await db.settings.get('school-year');
            if (schoolYear && schoolYear.value) {
                document.getElementById('school-year-start').value = schoolYear.value.start || '';
                document.getElementById('school-year-end').value = schoolYear.value.end || '';
            }
            
            // Load non-instructional days
            this.renderNonInstructionalDays();
            this.loadActiveSchoolYearPicker();
            
        } catch (error) {
            console.error('Error loading school calendar:', error);
        }
    },

    renderNonInstructionalDays: async function() {
        const container = document.getElementById('non-instructional-days-list');
        
        try {
            const nonInstructionalDays = await db.settings.get('non-instructional-days');
            const allDays = nonInstructionalDays?.value || [];
            const activeYear = await getActiveSchoolYear();
            // Filter to active year but keep original indices for editing
            const days = allDays
                .map((day, originalIndex) => ({ ...day, _originalIndex: originalIndex }))
                .filter(d => !d.schoolYear || d.schoolYear === activeYear);
            
            if (days.length === 0) {
                container.innerHTML = '<p style="padding: var(--space-lg); text-align: center; color: var(--color-text-tertiary);">No non-instructional days added yet.</p>';
                return;
            }
            
            // Sort by start date
            days.sort((a, b) => new Date(a.start) - new Date(b.start));
            
            container.innerHTML = '';
            days.forEach((day, index) => {
                // Parse as local date to avoid timezone issues
                const startParts = day.start.split('-');
                const startDate = new Date(startParts[0], startParts[1] - 1, startParts[2]);
                const endDate = day.end ? (() => {
                    const endParts = day.end.split('-');
                    return new Date(endParts[0], endParts[1] - 1, endParts[2]);
                })() : null;
                const formattedStart = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const formattedEnd = endDate ? endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
                
                const typeLabels = {
                    'holiday': 'Holiday',
                    'break': 'Break',
                    'no-school': 'No School',
                    'delay-2hr': '2-Hour Delay',
                    'delay-3hr': '3-Hour Delay',
                    'early-dismissal': 'Early Dismissal'
                };
                
                const typeColors = {
                    'holiday': 'var(--color-success)',
                    'break': 'var(--color-info)',
                    'no-school': 'var(--color-text-secondary)',
                    'delay-2hr': 'var(--color-warning)',
                    'delay-3hr': 'var(--color-warning)',
                    'early-dismissal': 'var(--color-warning)'
                };
                
                const div = document.createElement('div');
                div.style.cssText = `padding: var(--space-sm); border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center;`;
                div.innerHTML = `
                    <div>
                        <div style="font-weight: 600;">${escapeHtml(day.name)}</div>
                        <div style="font-size: var(--font-size-body-small); color: var(--color-text-secondary); margin-top: var(--space-xs);">
                            <span style="color: ${escapeHtml(typeColors[day.type])};">${escapeHtml(typeLabels[day.type])}</span>
                            &nbsp;•&nbsp;
                            ${escapeHtml(formattedStart)}${escapeHtml(formattedEnd) ? ` - ${escapeHtml(formattedEnd)}` : ''}
                        </div>
                    </div>
                    <button class="btn btn--secondary btn--sm" onclick="pages.settings.editNonInstructionalDay(${day._originalIndex})">Edit</button>
                `;
                container.appendChild(div);
            });
            
        } catch (error) {
            console.error('Error rendering non-instructional days:', error);
            container.innerHTML = '<p style="color: var(--color-error); padding: var(--space-lg);">Failed to load days</p>';
        }
    },

    showAddNonInstructionalDay: function() {
        state.editingNonInstructionalIndex = null;
        document.getElementById('non-instructional-modal-title').textContent = 'Add Non-Instructional Day';
        document.getElementById('non-instructional-form').reset();
        document.getElementById('delete-non-instructional-btn').style.display = 'none';
        ui.showModal('modal-non-instructional-day');
    },

    editNonInstructionalDay: async function(index) {
        state.editingNonInstructionalIndex = index;
        document.getElementById('non-instructional-modal-title').textContent = 'Edit Non-Instructional Day';
        document.getElementById('delete-non-instructional-btn').style.display = 'inline-flex';
        
        try {
            const nonInstructionalDays = await db.settings.get('non-instructional-days');
            const day = nonInstructionalDays.value[index];
            
            document.getElementById('non-instructional-name').value = day.name;
            document.getElementById('non-instructional-type').value = day.type;
            document.getElementById('non-instructional-start').value = day.start;
            document.getElementById('non-instructional-end').value = day.end || '';
            
            ui.showModal('modal-non-instructional-day');
        } catch (error) {
            console.error('Error loading day:', error);
            ui.showToast('Failed to load day', 'error');
        }
    },

    hideNonInstructionalDayModal: function() {
        ui.hideModal('modal-non-instructional-day');
        document.getElementById('non-instructional-form').reset();
        state.editingNonInstructionalIndex = null;
    },

    saveNonInstructionalDay: async function() {
        const name = document.getElementById('non-instructional-name').value.trim();
        const type = document.getElementById('non-instructional-type').value;
        const start = document.getElementById('non-instructional-start').value;
        const end = document.getElementById('non-instructional-end').value;
        
        if (!name || !type || !start) {
            ui.showToast('Please fill in all required fields', 'error');
            return;
        }
        
        try {
            const nonInstructionalDays = await db.settings.get('non-instructional-days');
            const days = nonInstructionalDays?.value || [];
            
            const activeYear = await getActiveSchoolYear();
            const dayData = { name, type, start, end: end || null, schoolYear: activeYear };
            
            if (state.editingNonInstructionalIndex !== null) {
                // Update existing
                days[state.editingNonInstructionalIndex] = dayData;
            } else {
                // Add new
                days.push(dayData);
            }
            
            await db.settings.put({
                key: 'non-instructional-days',
                value: days
            });
            
            ui.showToast(state.editingNonInstructionalIndex !== null ? 'Day updated' : 'Day added', 'success');
            driveSync.markDirty();
            this.hideNonInstructionalDayModal();
            this.renderNonInstructionalDays();
            
        } catch (error) {
            console.error('Error saving day:', error);
            ui.showToast('Failed to save day', 'error');
        }
    },

    deleteNonInstructionalDay: async function() {
        if (!confirm('Delete this non-instructional day?')) return;
        
        try {
            const nonInstructionalDays = await db.settings.get('non-instructional-days');
            const days = nonInstructionalDays.value;
            
            days.splice(state.editingNonInstructionalIndex, 1);
            
            await db.settings.put({
                key: 'non-instructional-days',
                value: days
            });
            
            driveSync.markDirty(); ui.showToast('Day deleted', 'success');
            this.hideNonInstructionalDayModal();
            this.renderNonInstructionalDays();
            
        } catch (error) {
            console.error('Error deleting day:', error);
            ui.showToast('Failed to delete day', 'error');
        }
    },

    saveSchoolCalendar: async function() {
        const start = document.getElementById('school-year-start').value;
        const end = document.getElementById('school-year-end').value;
        
        if (!start || !end) {
            ui.showToast('Please set both start and end dates', 'error');
            return;
        }
        
        try {
            await db.settings.put({
                key: 'school-year',
                value: { start, end }
            });
            
            driveSync.markDirty(); ui.showToast('School calendar saved!', 'success');
        } catch (error) {
            console.error('Error saving school year:', error);
            ui.showToast('Failed to save school year', 'error');
        }
    },

    loadActiveSchoolYearPicker: async function() {
        const select = document.getElementById('active-school-year-select');
        if (!select) return;

        // Build a list of year options — current year and 4 surrounding years
        const currentYear = await getActiveSchoolYear();
        const now = new Date();
        const baseYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;

        select.innerHTML = '<option value="">Auto-detect from dates above</option>';
        for (let y = baseYear - 2; y <= baseYear + 2; y++) {
            const yearStr = `${y}-${y + 1}`;
            const option = document.createElement('option');
            option.value = yearStr;
            option.textContent = yearStr;
            if (yearStr === currentYear) option.selected = true;
            select.appendChild(option);
        }
    },

    saveActiveSchoolYear: async function() {
        const select = document.getElementById('active-school-year-select');
        const value = select.value;

        try {
            if (!value) {
                await db.settings.delete('active-school-year');
                ui.showToast('Active year set to auto-detect', 'success');driveSync.markDirty(); ui.showToast('Active year set to auto-detect', 'success');
            } else {
                await db.settings.put({ key: 'active-school-year', value });
                ui.showToast(`Active year set to ${value}`, 'success');
            }

            // Update header display
            const year = await getActiveSchoolYear();
            const el = document.getElementById('header-school-year');
            if (el) el.textContent = `📅 ${year}`;

        } catch (error) {
            console.error('Error saving active school year:', error);
            ui.showToast('Failed to save active year', 'error');
        }
    },

    populateArchiveYearDropdown: function() {
        const select = document.getElementById('archive-year-select');
        if (!select) return;

        const now = new Date();
        const baseYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;

        select.innerHTML = '';
        // Only show past years (not current) as archivable
        for (let y = baseYear - 3; y < baseYear; y++) {
            const yearStr = `${y}-${y + 1}`;
            const option = document.createElement('option');
            option.value = yearStr;
            option.textContent = yearStr;
            select.appendChild(option);
        }
    },

    archiveSchoolYear: async function() {
        const select = document.getElementById('archive-year-select');
        const yearToArchive = select.value;
        if (!yearToArchive) {
            ui.showToast('Please select a year to archive.', 'error');
            return;
        }

        const activeYear = await getActiveSchoolYear();
        if (yearToArchive === activeYear) {
            ui.showToast('Cannot archive the currently active school year.', 'error');
            return;
        }

        // Count what will be affected
        const allStudents = await db.students.toArray();
        const allEnrollments = await db.enrollments.toArray();

        // Find students who ONLY have enrollments in the archived year (not in any other year)
        const studentsToArchive = [];
        for (const student of allStudents) {
            if (student.status === 'archived' || student.deletedAt) continue;

            const studentEnrollments = allEnrollments.filter(e => e.studentId === student.id);
            const hasCurrentYearEnrollment = studentEnrollments.some(e => e.schoolYear && e.schoolYear !== yearToArchive);
            const hasArchivedYearEnrollment = studentEnrollments.some(e => e.schoolYear === yearToArchive);

            // If they only have enrollments in the archived year (or no year tag = legacy), archive them
            if (hasArchivedYearEnrollment && !hasCurrentYearEnrollment) {
                studentsToArchive.push(student);
            }
        }

        const msg = `Archive school year ${yearToArchive}?\n\n` +
            `• ${studentsToArchive.length} student(s) will be marked as archived (they have no enrollments in other years)\n` +
            `• Attendance, checkpoint, and submission data is preserved\n` +
            `• Archived students can be restored from the Students page\n\n` +
            `Export a backup first if you haven't already.`;

        if (!confirm(msg)) return;

        try {
            let archivedCount = 0;
            for (const student of studentsToArchive) {
                await db.students.update(student.id, {
                    status: 'archived',
                    archivedYear: yearToArchive,
                    updatedAt: new Date().toISOString()
                });
                archivedCount++;
            }

            ui.showToast(`Archived ${archivedCount} student(s) from ${yearToArchive}`, 'success');
        } catch (err) {
            console.error('Error archiving year:', err);
            ui.showToast('Failed to archive school year', 'error');
        }
    },

    // Bell Schedule functions
    currentScheduleTab: 'normal',
    isEditingSchedules: false,

    toggleScheduleEditing: function() {
        this.isEditingSchedules = !this.isEditingSchedules;
        
        const btn = document.getElementById('toggle-schedule-edit-btn');
        const numPeriodsSelect = document.getElementById('num-periods');
        
        if (this.isEditingSchedules) {
            // Enable editing
            btn.textContent = 'Finish Editing Bell Schedules';
            btn.className = 'btn btn--success';
            numPeriodsSelect.disabled = false;
        } else {
            // Disable editing and save
            btn.textContent = 'Edit Bell Schedules';
            btn.className = 'btn btn--primary';
            numPeriodsSelect.disabled = true;
            
            // Save current tab before locking
            this.saveCurrentScheduleTab();
        }
        
        // Update inputs to reflect edit state
        this.updatePeriodInputs();
    },

    switchScheduleTab: async function(schedule) {
        // Don't switch if we're already on this tab
        if (this.currentScheduleTab === schedule) return;
        
        // If editing, auto-save current tab before switching
        if (this.isEditingSchedules) {
            await this.saveCurrentScheduleTab();
        }
        
        this.currentScheduleTab = schedule;
        
        // Update button states
        document.querySelectorAll('.schedule-tab').forEach(btn => {
            if (btn.dataset.schedule === schedule) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        
        // Update indicator text
        const scheduleNames = {
            'normal': 'Normal Day',
            '2-hour-delay': '2-Hour Delay',
            '3-hour-delay': '3-Hour Delay',
            'early-dismissal': 'Early Dismissal'
        };
        document.getElementById('current-schedule-name').textContent = scheduleNames[schedule];
        
        // Reload inputs for this schedule
        this.updatePeriodInputs();
    },

    saveCurrentScheduleTab: async function() {
        const numPeriods = parseInt(document.getElementById('num-periods').value);
        const scheduleType = this.currentScheduleTab;
        
        try {
            // Load existing schedules
            const schedulesData = await db.settings.get('bell-schedules');
            const schedules = schedulesData?.value || {};
            
            // Initialize this schedule if it doesn't exist
            if (!schedules[scheduleType]) {
                schedules[scheduleType] = {};
            }
            
            // Save regular periods for current tab only
            for (let i = 1; i <= numPeriods; i++) {
                const startInput = document.getElementById(`period-${i}-start-${scheduleType}`);
                const endInput = document.getElementById(`period-${i}-end-${scheduleType}`);
                
                if (startInput && endInput) {
                    schedules[scheduleType][i] = {
                        start: startInput.value,
                        end: endInput.value
                    };
                }
            }
            
            // Save wildcat period
            const wildcatStart = document.getElementById(`period-wildcat-start-${scheduleType}`);
            const wildcatEnd = document.getElementById(`period-wildcat-end-${scheduleType}`);
            
            if (wildcatStart && wildcatEnd) {
                schedules[scheduleType]['wildcat'] = {
                    start: wildcatStart.value,
                    end: wildcatEnd.value
                };
            }
            
            // Set active periods
            schedules[scheduleType].activePeriods = [];
            
            if (scheduleType === 'normal') {
                for (let i = 1; i <= numPeriods; i++) {
                    schedules[scheduleType].activePeriods.push(String(i));
                }
                schedules[scheduleType].activePeriods.push('wildcat');
            } else {
                for (let i = 1; i <= numPeriods; i++) {
                    schedules[scheduleType].activePeriods.push(String(i));
                }
            }
            
            // Save to database
            await db.settings.put({
                key: 'bell-schedules',
                value: schedules
            });
            
            driveSync.markDirty(); ui.showToast('Schedule saved', 'success');
            
        } catch (error) {
            console.error('Error saving schedule tab:', error);
            ui.showToast('Failed to save schedule', 'error');
        }
    },

    updatePeriodInputs: async function() {
        const numPeriods = parseInt(document.getElementById('num-periods').value);
        const container = document.getElementById('bell-schedule-inputs');
        const schedule = this.currentScheduleTab;
        const disabled = !this.isEditingSchedules ? 'disabled' : '';
        
        // Load saved schedules
        const schedulesData = await db.settings.get('bell-schedules');
        const schedules = schedulesData?.value || {};
        const currentSchedule = schedules[schedule] || {};
        
        // Build period inputs
        let html = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: var(--space-base);">';
        
        for (let i = 1; i <= numPeriods; i++) {
            const period = currentSchedule[i] || { start: '', end: '' };
            html += `
                <div class="form-group">
                    <label class="form-label">Period ${i}</label>
                    <div style="display: flex; gap: var(--space-xs); align-items: center;">
                        <input type="time" id="period-${i}-start-${schedule}" class="form-input" value="${period.start}" placeholder="Start" style="flex: 1;" ${disabled}>
                        <span>to</span>
                        <input type="time" id="period-${i}-end-${schedule}" class="form-input" value="${period.end}" placeholder="End" style="flex: 1;" ${disabled}>
                    </div>
                </div>
            `;
        }
        
        // Wildcat period (only show for normal schedule)
        if (schedule === 'normal') {
            const wildcatPeriod = currentSchedule['wildcat'] || { start: '', end: '' };
            html += `
                <div class="form-group">
                    <label class="form-label">${escapeHtml(state.flexPeriodName)} Period</label>
                    <div style="display: flex; gap: var(--space-xs); align-items: center;">
                        <input type="time" id="period-wildcat-start-${schedule}" class="form-input" value="${wildcatPeriod.start}" placeholder="Start" style="flex: 1;" ${disabled}>
                        <span>to</span>
                        <input type="time" id="period-wildcat-end-${schedule}" class="form-input" value="${wildcatPeriod.end}" placeholder="End" style="flex: 1;" ${disabled}>
                    </div>
                </div>
            `;
        }
        
        html += '</div>';
        container.innerHTML = html;
    },

    loadBellSchedules: async function() {
        try {
            // Load number of periods
            const numPeriodsData = await db.settings.get('num-periods');
            const numPeriods = numPeriodsData?.value || 8;
            document.getElementById('num-periods').value = numPeriods;
            document.getElementById('num-periods').disabled = true; // Start disabled
            
            // Load schedule inputs
            await this.updatePeriodInputs();
            
        } catch (error) {
            console.error('Error loading bell schedules:', error);
        }
    },

    saveBellSchedules: async function() {
        const numPeriods = parseInt(document.getElementById('num-periods').value);
        
        try {
            // Save number of periods
            await db.settings.put({
                key: 'num-periods',
                value: numPeriods
            });
            
            // Load existing schedules
            const schedulesData = await db.settings.get('bell-schedules');
            const schedules = schedulesData?.value || {};
            
            // Save all four schedule types
            const scheduleTypes = ['normal', '2-hour-delay', '3-hour-delay', 'early-dismissal'];

            for (const scheduleType of scheduleTypes) {
                // Initialize if needed
                if (!schedules[scheduleType]) {
                    schedules[scheduleType] = {};
                }
                                    
                // Save regular periods
                for (let i = 1; i <= numPeriods; i++) {
                    const startInput = document.getElementById(`period-${i}-start-${scheduleType}`);
                    const endInput = document.getElementById(`period-${i}-end-${scheduleType}`);
                    
                    if (startInput && endInput) {
                        schedules[scheduleType][i] = {
                            start: startInput.value,
                            end: endInput.value
                        };
                    }
                }
                
                // Save wildcat period
                const wildcatStart = document.getElementById(`period-wildcat-start-${scheduleType}`);
                const wildcatEnd = document.getElementById(`period-wildcat-end-${scheduleType}`);
                
                if (wildcatStart && wildcatEnd) {
                    schedules[scheduleType]['wildcat'] = {
                        start: wildcatStart.value,
                        end: wildcatEnd.value
                    };
                }

                // Set which periods are active for this schedule
                schedules[scheduleType].activePeriods = [];

                if (scheduleType === 'normal') {
                    // Normal day: all periods including wildcat
                    for (let i = 1; i <= numPeriods; i++) {
                        schedules[scheduleType].activePeriods.push(String(i));
                    }
                    schedules[scheduleType].activePeriods.push('wildcat');
                } else {
                    // Delay/Early dismissal: only numbered periods (no wildcat)
                    for (let i = 1; i <= numPeriods; i++) {
                        schedules[scheduleType].activePeriods.push(String(i));
                    }
                }
            }
            
            // Save to database
            await db.settings.put({
                key: 'bell-schedules',
                value: schedules
            });
            
            driveSync.markDirty(); ui.showToast('Bell schedules saved!', 'success');
            
            // Reinitialize schedules in the app
            await initializePeriodYearMap();
            
        } catch (error) {
            console.error('Error saving bell schedules:', error);
            ui.showToast('Failed to save bell schedules', 'error');
        }
    },

    // ----------------------------------------
    // REFERENCE DATA IMPORTS
    // ----------------------------------------

    _readJsonFile: function(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try { resolve(JSON.parse(e.target.result)); }
                catch (err) { reject(new Error('Invalid JSON file')); }
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    },

    importSkillsLibrary: async function(event) {
        const file = event.target.files[0];
        if (!file) return;
        event.target.value = '';
        try {
            const data = await this._readJsonFile(file);
            if (!Array.isArray(data)) throw new Error('Expected a JSON array');
            const existing = await db.skills.toArray();
            const existingNames = new Set(existing.map(s => s.name.toLowerCase()));
            let imported = 0, skipped = 0;
            const categories = new Set();
            for (const item of data) {
                categories.add(item.category);
                if (existingNames.has(item.name.toLowerCase())) {
                    skipped++;
                    continue;
                }
                await db.skills.add({
                    name: item.name,
                    category: item.category,
                    description: item.description || '',
                    year: item.year || null,
                    createdAt: new Date().toISOString()
                });
                imported++;
            }
            // Update skill-categories setting
            await db.settings.put({ key: 'skill-categories', value: [...categories] });
            driveSync.markDirty();
            await logAction('import', 'skills', null, `Imported ${imported} skills from library`);
            ui.showToast(`Imported ${imported} skills (${skipped} skipped as duplicates)`, 'success');
        } catch (err) {
            console.error('Skills import error:', err);
            ui.showToast('Failed to import skills: ' + err.message, 'error');
        }
    },

    importEquipment: async function(event) {
        const file = event.target.files[0];
        if (!file) return;
        event.target.value = '';
        try {
            const data = await this._readJsonFile(file);
            if (!Array.isArray(data)) throw new Error('Expected a JSON array');
            const existing = await db.inventory.toArray();
            const existingNames = new Set(existing.map(i => i.name.toLowerCase()));
            let imported = 0, skipped = 0;
            for (const item of data) {
                if (existingNames.has(item.name.toLowerCase())) {
                    skipped++;
                    continue;
                }
                await db.inventory.add({
                    name: item.name,
                    category: item.category || '',
                    quantity: item.quantity || 0,
                    threshold: 0,
                    location: item.location || '',
                    itemNumber: item.itemNumber || '',
                    notes: item.notes || '',
                    createdAt: new Date().toISOString()
                });
                imported++;
            }
            driveSync.markDirty();
            await logAction('import', 'inventory', null, `Imported ${imported} equipment items`);
            ui.showToast(`Imported ${imported} equipment items (${skipped} skipped as duplicates)`, 'success');
        } catch (err) {
            console.error('Equipment import error:', err);
            ui.showToast('Failed to import equipment: ' + err.message, 'error');
        }
    },

    importStandards: async function(event) {
        const files = Array.from(event.target.files);
        if (!files.length) return;
        event.target.value = '';
        try {
            // Read and merge all selected files
            const allRecords = [];
            for (const file of files) {
                const data = await this._readJsonFile(file);
                if (!Array.isArray(data)) throw new Error(`${file.name} is not a JSON array`);
                allRecords.push(...data);
            }
            // Deduplicate by code — prefer records with more fields (E1 has weight/exam)
            const byCode = new Map();
            for (const rec of allRecords) {
                const code = rec.code;
                const existing = byCode.get(code);
                if (!existing) {
                    byCode.set(code, rec);
                } else {
                    // Prefer the one with weight/exam (E1 format)
                    if (rec.weight && !existing.weight) {
                        byCode.set(code, rec);
                    }
                }
            }
            // Normalize and import
            const existingStandards = await db.standards.toArray();
            const existingCodes = new Set(existingStandards.map(s => s.code));
            let imported = 0, skipped = 0;
            for (const [code, rec] of byCode) {
                if (existingCodes.has(code)) {
                    skipped++;
                    continue;
                }
                // Normalize: E1 has strand instead of category
                let category = rec.category || '';
                if (!category && rec.strand) {
                    category = rec.strand.replace(/^\d+\.\d+\s+/, '');
                }
                await db.standards.add({
                    code: code,
                    name: rec.name,
                    category: category,
                    description: '',
                    weight: rec.weight || null,
                    exam: rec.exam || null,
                    createdAt: new Date().toISOString()
                });
                imported++;
            }
            driveSync.markDirty();
            await logAction('import', 'standards', null, `Imported ${imported} standards`);
            ui.showToast(`Imported ${imported} standards (${skipped} skipped as duplicates)`, 'success');
        } catch (err) {
            console.error('Standards import error:', err);
            ui.showToast('Failed to import standards: ' + err.message, 'error');
        }
    },

    // --- Draft instruction steps from existing guide data ---
    generateInstructionSteps: function(guide) {
        const steps = [];

        const matList = (guide.requiredMaterials || [])
            .map(m => m.name + (m.quantity ? ' (' + m.quantity + ')' : ''))
            .join(', ');

        // Opening step — always present
        let readyBody = 'Set up your notebook and get your station ready before your team starts working.';
        if ((guide.getReadyTasks || []).length > 0) {
            readyBody += ' Your team needs to: ' + guide.getReadyTasks.join('; ') + '.';
        }

        steps.push({
            title: 'Get Ready',
            time: guide.getReadyTime || '5 min',
            body: readyBody,
            roles: {
                leader: 'Check that everyone on your team has their notebook open and dated.',
                recorder: 'Write the activity title and today\'s date at the top of your notebook page.',
                materials: matList ? 'Collect from the materials station: ' + matList + '.' : '',
                timekeeper: 'Get your team to the table and ready to work within ' + (guide.getReadyTime || '5 minutes') + '.'
            }
        });

        // One step per checkpoint
        (guide.checkpoints || []).forEach((cp, i) => {
            let body = cp.description || '';
            if (cp.lookFor) {
                body += (body ? ' ' : '') + 'You are done with this step when: ' + cp.lookFor;
            }

            steps.push({
                title: cp.title || ('Checkpoint ' + (i + 1)),
                time: cp.estimatedTime || '',
                body: body,
                roles: {
                    leader: 'Make sure your whole team agrees on the plan before anyone starts building.',
                    recorder: 'Record what your team decides and why in your notebook.',
                    materials: 'Keep your station organized and return anything your team is done using.',
                    timekeeper: cp.estimatedTime
                        ? 'This step should take about ' + cp.estimatedTime + '. Warn your team at the halfway point.'
                        : 'Watch the clock and tell your team how much time is left.'
                }
            });
        });

        // Closing step — only when there's a checklist to close against
        if ((guide.documentationChecklist || []).length > 0) {
            steps.push({
                title: 'Document and Submit',
                time: '10 min',
                body: 'Before you turn anything in, check that your notebook has all of these: '
                    + guide.documentationChecklist.join('; ') + '.',
                roles: {
                    leader: 'Check every teammate\'s notebook against the list before your team submits.',
                    recorder: 'Make sure every entry is dated and readable.',
                    materials: 'Return all materials and leave your station cleaner than you found it.',
                    timekeeper: 'Start cleanup with at least 10 minutes left in class.'
                }
            });
        }

        return steps;
    },

    // --- Contract Guide JSON Import Pipeline ---
    importContractGuide: async function(mode, event) {
        try {
            // ── Step 1: Read JSON ──
            let jsonText;
            if (mode === 'paste') {
                jsonText = document.getElementById('import-contract-json').value.trim();
                if (!jsonText) {
                    ui.showToast('Paste contract guide JSON into the text area first.', 'error');
                    return;
                }
            } else if (mode === 'file') {
                const file = event.target.files[0];
                if (!file) return;
                jsonText = await file.text();
                event.target.value = ''; // reset file input
            }

            let guide;
            try {
                guide = JSON.parse(jsonText);
            } catch (e) {
                ui.showToast('Invalid JSON — check for syntax errors.', 'error');
                return;
            }

            // Basic validation
            if (!guide.contractCode) {
                ui.showToast('JSON is missing "contractCode" field.', 'error');
                return;
            }

            const warnings = [];
            const timestamp = new Date().toISOString();
            const warningsBox = document.getElementById('import-contract-warnings');
            if (warningsBox) warningsBox.innerHTML = '';

            // ── Shape checks (plan row 1-12, B26/B27/X36): things students or Full Edit can't use.
            //    Warnings only; the guide is imported as written. ──
            if (Array.isArray(guide.assessmentQuestions)) {
                guide.assessmentQuestions.forEach((q, i) => {
                    if (typeof q === 'string') {
                        warnings.push(`Assessment question ${i + 1} is plain text, so students would see no question. Each question needs "question" and "optionA"–"optionD".`);
                    } else if (q && Array.isArray(q.options)) {
                        warnings.push(`Assessment question ${i + 1} lists its choices in "options", so students would see empty choices. Use "optionA"–"optionD".`);
                    }
                });
            } else if (guide.assessmentQuestions != null) {
                warnings.push('"assessmentQuestions" is not a list, so students would see no questions.');
            }
            for (const field of ['constraints', 'deliverables']) {
                const v = guide.contractBrief ? guide.contractBrief[field] : null;
                if (v != null && !Array.isArray(v)) {
                    warnings.push(`"contractBrief.${field}" is not a list. Full Edit will show it as a single item.`);
                }
            }

            // ── Step 2: Resolve skill names → skill IDs ──
            // Only visible skills can be linked. An old name that belongs to a retired or merged-away
            // skill gets a warning naming what happened to it, so the guide is fixed (P16 C3).
            const allSkills = await db.skills.toArray();
            const skillNameMap = new Map(allSkills.filter(s => !isSkillHidden(s)).map(s => [s.name.toLowerCase(), s]));
            const hiddenSkillNameMap = new Map(allSkills.filter(isSkillHidden).map(s => [s.name.toLowerCase(), s]));
            const skillByIdForWarn = new Map(allSkills.map(s => [s.id, s]));
            const skillMissingWarning = (name, where) => {
                const hidden = hiddenSkillNameMap.get(String(name).toLowerCase());
                const prefix = where ? `${where}: ` : '';
                if (hidden) {
                    const when = hidden.deletedAt || hidden.retiredAt;
                    const on = when ? ` on ${new Date(when).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}` : '';
                    if (hidden.mergedInto) {
                        const target = skillByIdForWarn.get(hidden.mergedInto);
                        return `${prefix}'${name}' was merged into '${target ? target.name : 'another skill'}'${on} — update the guide (not linked)`;
                    }
                    return `${prefix}'${name}' was retired${on} — update the guide (not linked)`;
                }
                return `${prefix}skill not found: "${name}"`;
            };

            const resolvedSkillIds = []; // For activitySkills junction records
            const resolvedSkillsAssessed = []; // For activity.skillsAssessed (with level descriptors)

            if (guide.skillsAssessed && Array.isArray(guide.skillsAssessed)) {
                for (const sa of guide.skillsAssessed) {
                    const match = skillNameMap.get(sa.skillName.toLowerCase());
                    if (match) {
                        resolvedSkillIds.push(match.id);
                        // Transform levelDescriptors keys to capitalized format for grading tab
                        const levels = {};
                        if (sa.levelDescriptors) {
                            if (sa.levelDescriptors.beginning) levels['Beginning'] = sa.levelDescriptors.beginning;
                            if (sa.levelDescriptors.developing) levels['Developing'] = sa.levelDescriptors.developing;
                            if (sa.levelDescriptors.proficient) levels['Proficient'] = sa.levelDescriptors.proficient;
                            if (sa.levelDescriptors.advanced) levels['Advanced'] = sa.levelDescriptors.advanced;
                        }
                        resolvedSkillsAssessed.push({
                            skillName: sa.skillName,
                            skillId: match.id,
                            checkpoints: sa.checkpoints || [],
                            levels: levels
                        });
                    } else {
                        const w = skillMissingWarning(sa.skillName, '');
                        warnings.push(w.startsWith('skill not found') ? `Skill not found: "${sa.skillName}"` : w);
                    }
                }
            }

            // ── Step 3: Resolve equipment names → tool IDs ──
            const allTools = await db.inventory.toArray();
            const toolNameMap = new Map(allTools.map(t => [t.name.toLowerCase(), t]));

            const resolvedCertsRequired = [];
            if (guide.certificationsRequired && Array.isArray(guide.certificationsRequired)) {
                for (const certName of guide.certificationsRequired) {
                    const match = toolNameMap.get(certName.toLowerCase());
                    if (match) {
                        resolvedCertsRequired.push({ name: certName, toolId: match.id });
                    } else {
                        warnings.push(`Equipment not found for certification: "${certName}"`);
                        resolvedCertsRequired.push({ name: certName, toolId: null });
                    }
                }
            }

            const resolvedCertsAvailable = [];
            if (guide.certificationsAvailable && Array.isArray(guide.certificationsAvailable)) {
                for (const certName of guide.certificationsAvailable) {
                    const match = toolNameMap.get(certName.toLowerCase());
                    if (match) {
                        resolvedCertsAvailable.push({ name: certName, toolId: match.id });
                    } else {
                        warnings.push(`Equipment not found for certification: "${certName}"`);
                        resolvedCertsAvailable.push({ name: certName, toolId: null });
                    }
                }
            }

            // ── Step 4: Resolve WebXam codes → standard IDs ──
            const allStandards = await db.standards.toArray();
            const standardCodeMap = new Map(allStandards.map(s => [s.code, s]));

            const resolvedStandardIds = [];
            if (guide.webxamCoverage && Array.isArray(guide.webxamCoverage)) {
                for (const code of guide.webxamCoverage) {
                    const match = standardCodeMap.get(code);
                    if (match) {
                        resolvedStandardIds.push(match.id);
                    } else {
                        warnings.push(`WebXam standard not found: "${code}"`);
                    }
                }
            }

            // ── Step 5: Build activity data object ──
            const activityData = {
                name: guide.contractCode + ': ' + (guide.contractBrief?.clientName ? guide.contractBrief.clientName.split('(')[0].trim() : guide.unit || 'Contract'),
                description: guide.contractBrief?.problemStatement || '',
                status: 'active',
                activityType: guide.activityType || 'Contract',
                phase: guide.phase || null,
                scaffoldingLevel: guide.scaffoldingLevel || null,
                classPeriods: guide.classPeriods || null,
                unit: guide.unit || null,
                lesson: guide.lesson || null,
                contractCode: guide.contractCode,
                contractBrief: guide.contractBrief || null,
                learningGoals: guide.learningGoals || [],
                fusionGoals: guide.fusionGoals || [],
                requiredTools: guide.requiredTools || [],
                requiredMaterials: guide.requiredMaterials || [],
                resourceLinks: guide.resourceLinks || [],
                slidesUrl: guide.slidesUrl || null,
                getReadyTime: guide.getReadyTime || null,
                getReadyTasks: guide.getReadyTasks || [],
                getReadyRoleTasks: guide.getReadyRoleTasks || null,
                instructionSteps: (guide.instructionSteps && guide.instructionSteps.length > 0)
                    ? guide.instructionSteps
                    : pages.settings.generateInstructionSteps(guide),
                conclusionQuestions: guide.conclusionQuestions || [],
                conclusionSubmissionMethod: guide.conclusionSubmissionMethod || null,
                assessmentQuestions: guide.assessmentQuestions || [],
                documentationChecklist: guide.documentationChecklist || [],
                appendixItems: guide.appendixItems || [],
                certificationsRequired: resolvedCertsRequired,
                certificationsAvailable: resolvedCertsAvailable,
                portfolioPrompts: guide.portfolioPrompts || [],
                pacingMilestones: guide.pacingMilestones || null,
                webxamCoverage: guide.webxamCoverage || [],
                skillsAssessed: resolvedSkillsAssessed,
                updatedAt: timestamp,
            };

            // ── Step 6: Detect existing activity or create new ──
            let activityId;
            const existingActivities = excludeDeleted(await db.activities.toArray());
            const existingMatch = existingActivities.find(a =>
                a.contractCode && a.contractCode.toLowerCase() === guide.contractCode.toLowerCase()
            );

            if (existingMatch) {
                // Update existing — preserve class, dates, scoring, and other manual settings
                activityId = existingMatch.id;
                // Never overwrite refined steps with a fresh template draft.
                if ((existingMatch.instructionSteps || []).length > 0
                    && !(guide.instructionSteps && guide.instructionSteps.length > 0)) {
                    delete activityData.instructionSteps;
                }
                // Preserve a manually renamed activity — the name is the Hub Sheet tab name.
                if (existingMatch.name) {
                    delete activityData.name;
                }
                // Don't let an absent JSON key blank a field that already has data.
                const preserveIfMissing = ['requiredTools', 'requiredMaterials', 'resourceLinks',
                    'slidesUrl', 'getReadyTasks', 'getReadyTime', 'getReadyRoleTasks',
                    'conclusionQuestions', 'conclusionSubmissionMethod', 'fusionGoals',
                    'documentationChecklist', 'appendixItems', 'portfolioPrompts', 'contractBrief',
                    'learningGoals', 'assessmentQuestions', 'pacingMilestones', 'webxamCoverage'];
                for (const field of preserveIfMissing) {
                    const incoming = guide[field];
                    const isEmpty = incoming === undefined || incoming === null
                        || (Array.isArray(incoming) && incoming.length === 0)
                        || (typeof incoming === 'string' && incoming.trim() === '')
                        || (typeof incoming === 'object' && !Array.isArray(incoming) && Object.keys(incoming).length === 0);
                    if (isEmpty) delete activityData[field];
                }
                await db.activities.update(activityId, activityData);
                await logAction('update', 'activity', activityId, `Contract guide import: updated ${guide.contractCode}`);
            } else {
                // Create new — teacher sets class and dates manually afterward
                activityData.startDate = getTodayString();
                activityData.endDate = getTodayString();
                activityData.classId = null;
                activityData.createdAt = timestamp;
                activityId = await db.activities.add(activityData);
                await logAction('create', 'activity', activityId, `Contract guide import: created ${guide.contractCode}`);
            }

            // ── Step 7: Create/update checkpoints ──
            let checkpointCount = 0;
            const checkpointIdMap = {}; // Maps "C1-CP1" → database ID for portfolioPrompt linking

            if (guide.checkpoints && Array.isArray(guide.checkpoints)) {
                // Match by position and update in place so checkpoint IDs — and the
                // completion records pointing at them — survive the import.
                const existingCps = (await db.checkpoints.where('activityId').equals(activityId).toArray())
                    .sort((a, b) => (a.number || 0) - (b.number || 0));

                for (let i = 0; i < guide.checkpoints.length; i++) {
                    const cp = guide.checkpoints[i];
                    // Resolve skillsAssessable names → IDs
                    const resolvedAssessable = [];
                    if (cp.skillsAssessable && Array.isArray(cp.skillsAssessable)) {
                        for (const skillName of cp.skillsAssessable) {
                            const match = skillNameMap.get(skillName.toLowerCase());
                            if (match) {
                                resolvedAssessable.push(match.id);
                            } else {
                                warnings.push(skillMissingWarning(skillName, `Checkpoint "${cp.title}"`));
                            }
                        }
                    }

                    // Resolve certificationDemos names → IDs
                    const resolvedCertDemos = [];
                    if (cp.certificationDemos && Array.isArray(cp.certificationDemos)) {
                        for (const certName of cp.certificationDemos) {
                            const match = toolNameMap.get(certName.toLowerCase());
                            if (match) {
                                resolvedCertDemos.push(match.id);
                            } else {
                                warnings.push(`Checkpoint "${cp.title}": equipment not found: "${certName}"`);
                            }
                        }
                    }

                    const cpData = {
                        activityId,
                        number: cp.number,
                        title: cp.title || '',
                        description: cp.description || '',
                        suggestedDate: cp.suggestedDate || null,
                        milestone: cp.milestone || '',
                        lookFor: cp.lookFor || '',
                        afterStep: (cp.afterStep === 0 || cp.afterStep) ? cp.afterStep : null,
                        skillsAssessable: resolvedAssessable,
                        certificationDemos: resolvedCertDemos,
                        questions: (cp.questions || []).map(q => ({
                            question: q.question || '',
                            expectedResponse: q.expectedResponse || ''
                        })),
                        createdAt: timestamp,
                        updatedAt: timestamp,
                    };

                    let newCpId;
                    if (existingCps[i]) {
                        newCpId = existingCps[i].id;
                        delete cpData.createdAt;   // keep the original creation timestamp
                        await db.checkpoints.update(newCpId, cpData);
                    } else {
                        newCpId = await db.checkpoints.add(cpData);
                    }
                    checkpointCount++;

                    // Map the JSON checkpoint ID to the database ID
                    if (cp.id) {
                        checkpointIdMap[cp.id] = newCpId;
                    }
                    checkpointIdMap[cp.number] = newCpId;
                }

                // Remove checkpoints the new guide no longer defines, and their completions.
                for (let x = guide.checkpoints.length; x < existingCps.length; x++) {
                    const staleId = existingCps[x].id;
                    const staleCompletions = await db.checkpointCompletions
                        .where('checkpointId').equals(staleId).toArray();
                    for (const c of staleCompletions) {
                        await db.checkpointCompletions.delete(c.id);
                    }
                    await db.checkpoints.delete(staleId);
                }
            }

            // ── Step 8: Create activitySkills junction records ──
            // Clear existing
            const existingSkillLinks = await db.activitySkills.where('activityId').equals(activityId).toArray();
            for (const link of existingSkillLinks) {
                await db.activitySkills.delete(link.id);
            }
            // Add resolved skills
            for (const skillId of resolvedSkillIds) {
                await db.activitySkills.add({
                    activityId,
                    skillId,
                    updatedAt: timestamp,
                });
            }

            // ── Step 9: Create activityStandards junction records ──
            // Clear existing
            const existingStdLinks = await db.activityStandards.where('activityId').equals(activityId).toArray();
            for (const link of existingStdLinks) {
                await db.activityStandards.delete(link.id);
            }
            // Add resolved standards
            for (const standardId of resolvedStandardIds) {
                await db.activityStandards.add({
                    activityId,
                    standardId,
                    updatedAt: timestamp,
                });
            }

            // ── Step 10: Mark dirty & report results ──
            driveSync.markDirty();

            // Build summary
            const parts = [
                `Imported Contract ${guide.contractCode}`,
                existingMatch ? '(updated existing)' : '(created new)',
                `${checkpointCount} checkpoints`,
                `${resolvedSkillIds.length} skills linked`,
                `${resolvedCertsRequired.length + resolvedCertsAvailable.length} certifications`,
                `${resolvedStandardIds.length} standards linked`,
            ];

            // Clear the textarea
            const textarea = document.getElementById('import-contract-json');
            if (textarea) textarea.value = '';

            // Show results
            ui.showToast(parts.join(' · '), 'success', 8000);

            if (warnings.length > 0) {
                console.warn('Contract guide import warnings:', warnings);
                // Listed on screen under the import box (the iPad has no console), plan row 1-12
                if (warningsBox) {
                    warningsBox.innerHTML = `<div style="padding: var(--space-sm) var(--space-base); border: 1px solid var(--color-warning); border-radius: var(--radius-md);">
                        <strong>${warnings.length} warning${warnings.length === 1 ? '' : 's'} for ${escapeHtml(guide.contractCode)}:</strong>
                        <ul class="import-contract-warning-list" style="margin: var(--space-xs) 0 0; padding-left: 1.2em;">${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
                    </div>`;
                }
                setTimeout(() => {
                    ui.showToast(`⚠️ ${warnings.length} warning(s), listed under the import box.`, 'warning', 8000);
                }, 1500);
            }

            console.log('Contract guide import complete:', {
                activityId,
                contractCode: guide.contractCode,
                checkpoints: checkpointCount,
                skills: resolvedSkillIds.length,
                certifications: resolvedCertsRequired.length + resolvedCertsAvailable.length,
                standards: resolvedStandardIds.length,
                warnings,
            });

        } catch (error) {
            console.error('Contract guide import error:', error);
            ui.showToast('Import failed: ' + error.message, 'error');
        }
    },
};
