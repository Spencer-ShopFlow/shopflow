// ----------------------------------------
// RELEASE CHECK (i304, roadmap q03)
// Records every table's count just before the update bar reloads the app, and again just after
// the reload, so Settings → Data can say line by line whether anything changed in the update.
// Table names and counts only, never names. Kept in this device's localStorage only: never
// synced, not in Export JSON or the Hub, no table of its own and no schema change.
// ----------------------------------------
const releaseCheck = {
    STORAGE_KEY: 'release-check',
    // Tables the app rebuilds by itself, so their counts can move across a reload
    EXPECTED_TO_CHANGE: ['activityLog', 'alerts'],
    // The longest the update bar waits for the counts before reloading anyway
    RECORD_TIMEOUT_MS: 3000,

    // The version this page was loaded with (the newest app cache when it started)
    _loadedVersion: null,

    _versions: async function() {
        try {
            const names = (typeof caches !== 'undefined') ? await caches.keys() : [];
            return names.filter(n => /^esb-v\d+$/.test(n)).sort((a, b) => parseInt(a.slice(5)) - parseInt(b.slice(5)));
        } catch (e) { return []; }   // caches unavailable (private mode)
    },

    _newestVersion: async function() {
        const v = await this._versions();
        return v.length ? v[v.length - 1] : 'unknown';
    },

    _read: function() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            const data = raw ? JSON.parse(raw) : null;
            return (data && typeof data === 'object') ? data : {};
        } catch (e) { return {}; }
    },

    _write: function(data) {
        try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
    },

    // The Data check's per-table counts (all records, deleted ones included). Reads only.
    countTables: async function() {
        if (!db.isOpen()) await db.open();
        const counts = {};
        for (const table of db.tables) counts[table.name] = await table.count();
        return counts;
    },

    _snapshot: async function(reason) {
        const loaded = this._loadedVersion || await this._newestVersion();
        const newest = await this._newestVersion();
        return {
            at: new Date().toISOString(),
            version: loaded,
            newVersion: newest !== loaded ? newest : null,
            reason,
            counts: await this.countTables()
        };
    },

    // Called by the update bar (index.html, i255) once the unsaved-work check has passed and
    // sync has closed, just before the reload. Never holds the reload for long, never throws.
    recordBeforeReload: async function() {
        try {
            let timer;
            const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), this.RECORD_TIMEOUT_MS); });
            const before = await Promise.race([this._snapshot('update'), timeout]);
            clearTimeout(timer);
            if (!before) return false;
            return this._write({ before, after: null, pendingAfter: true });
        } catch (e) {
            console.warn('Release check: could not record the counts before the reload', e);
            return false;
        }
    },

    // The "Record now" button: a manual check. The next start of the app records the after counts.
    recordNow: async function() {
        try {
            const before = await this._snapshot('manual');
            if (!this._write({ before, after: null, pendingAfter: true })) throw new Error('localStorage unavailable');
            ui.showToast('Counts recorded (no names)', 'success');
        } catch (e) {
            console.error('Release check failed:', e);
            ui.showToast('Could not record the counts. Close and reopen the app, then try again.', 'warning');
        }
        await this.render();
    },

    // On start-up after a recording: the after counts, taken before the app's own start-up work
    recordAfterIfPending: async function() {
        const data = this._read();
        if (!data.pendingAfter || !data.before) return false;
        try {
            const counts = await this.countTables();
            data.after = { at: new Date().toISOString(), version: await this._newestVersion(), counts };
            data.pendingAfter = false;
            return this._write(data);
        } catch (e) {
            console.warn('Release check: could not record the counts after the reload', e);
            return false;
        }
    },

    // One line per table: before, after, and Same / Changed / Expected to change
    compare: function(beforeCounts, afterCounts) {
        const names = [...new Set([...Object.keys(beforeCounts || {}), ...Object.keys(afterCounts || {})])].sort((a, b) => a.localeCompare(b));
        return names.map(name => {
            const before = (beforeCounts && name in beforeCounts) ? beforeCounts[name] : null;
            const after = (afterCounts && name in afterCounts) ? afterCounts[name] : null;
            const result = this.EXPECTED_TO_CHANGE.includes(name) ? 'expected' : (before === after ? 'same' : 'changed');
            return { name, before, after, result };
        });
    },

    render: async function() {
        const body = document.getElementById('release-check-body');
        if (!body) return;
        const fmt = iso => {
            const d = new Date(iso);
            return isNaN(d) ? 'unknown time' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        };
        try {
            const data = this._read();
            if (!data.before || !data.before.counts) {
                body.innerHTML = '<p style="color: var(--color-text-tertiary);">Nothing recorded yet. The next update records the counts by itself, or tap Record now.</p>';
                return;
            }
            const before = data.before;
            const hasAfter = !!(data.after && data.after.counts);
            const afterCounts = hasAfter ? data.after.counts : await this.countTables();
            const rows = this.compare(before.counts, afterCounts);
            const changed = rows.filter(r => r.result === 'changed');
            const why = before.reason === 'update' ? 'recorded when the update bar reloaded the app' : 'recorded with Record now';
            const fromTo = before.newVersion ? `${before.version}, updating to ${before.newVersion}` : before.version;
            const afterLabel = hasAfter ? 'After' : 'Now';
            const afterLine = hasAfter
                ? `<div><strong>After:</strong> <span id="release-check-after-meta">${escapeHtml(fmt(data.after.at))} · ${escapeHtml(data.after.version || 'unknown')} · recorded when the app started again</span></div>`
                : '<div><strong>Now:</strong> <span id="release-check-after-meta">the counts at this moment (the app has not restarted since the recording)</span></div>';
            const word = { same: 'Same', changed: 'Changed', expected: 'Expected to change' };
            const colour = { same: 'var(--color-success)', changed: 'var(--color-error)', expected: 'var(--color-text-tertiary)' };
            const summary = changed.length === 0
                ? '<p id="release-check-summary" style="color: var(--color-success); font-weight: 600; font-size: var(--font-size-body-small);">Every line Same.</p>'
                : `<p id="release-check-summary" style="color: var(--color-error); font-weight: 600; font-size: var(--font-size-body-small);">Changed: ${changed.length} table${changed.length === 1 ? '' : 's'} (${escapeHtml(changed.map(r => r.name).join(', '))}). Check them before carrying on.</p>`;
            const num = n => (n === null || n === undefined) ? 'none' : n;
            body.innerHTML = `
                <div style="display: grid; gap: var(--space-xs); margin-bottom: var(--space-base); font-size: var(--font-size-body-small);">
                    <div><strong>Before:</strong> <span id="release-check-before-meta">${escapeHtml(fmt(before.at))} · ${escapeHtml(fromTo || 'unknown')} · ${why}</span></div>
                    ${afterLine}
                </div>
                ${summary}
                <table class="data-check-table" style="width: 100%; border-collapse: collapse; font-size: var(--font-size-body-small);">
                    <thead><tr style="text-align: left; border-bottom: 1px solid var(--color-border);">
                        <th style="padding: 4px 6px;">Table</th>
                        <th style="padding: 4px 6px; text-align: right;">Before</th>
                        <th style="padding: 4px 6px; text-align: right;">${afterLabel}</th>
                        <th style="padding: 4px 6px;">Result</th>
                    </tr></thead>
                    <tbody>
                        ${rows.map(r => `<tr data-table="${escapeHtml(r.name)}" data-result="${r.result}" style="border-bottom: 1px solid var(--color-border);">
                            <td style="padding: 4px 6px;">${escapeHtml(r.name)}</td>
                            <td class="release-check-before" style="padding: 4px 6px; text-align: right;">${num(r.before)}</td>
                            <td class="release-check-after" style="padding: 4px 6px; text-align: right;">${num(r.after)}</td>
                            <td class="release-check-result" style="padding: 4px 6px; color: ${colour[r.result]}; font-weight: 600;">${word[r.result]}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>`;
        } catch (e) {
            console.error('Release check failed:', e);
            body.innerHTML = '<p style="color: var(--color-error);">Could not read the counts. Close and reopen the app, then try again.</p>';
        }
    }
};

// At start-up: note this page's version, then take the after counts if a recording is waiting
releaseCheck._newestVersion().then(v => { releaseCheck._loadedVersion = v; });
releaseCheck.recordAfterIfPending();
