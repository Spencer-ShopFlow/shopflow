// ============================================
// P20: THE IDENTITY CUTOVER TOOL (design §4; the skills migration's shape)
// ============================================
// Preview (changes nothing), Run (PC only), Verify (changes nothing). Its card on the Data tab
// stays hidden until this device's localStorage has identity-tool-enabled = 'true' (set by the
// run sheet on the day, as P18's tool was). Run fills in every missing uid and sets the sync-epoch
// to identity-uid-<date>-<6 random characters> in one transaction (markBulk: nothing is stamped,
// no upload is queued). It writes no other field. Reports carry counts, table names and ids only.

const identityMigration = {
    TOOL: 'identityMigration v1',
    EXPORT_MAX_AGE_MS: 2 * 60 * 60 * 1000,
    _lastReport: '',
    _previewRefCounts: null,

    // A new epoch id per Run (§9 finding 5): identity-uid-<YYYY-MM-DD>-<6 random characters>
    newEpochId: function() {
        const b = new Uint8Array(6);
        crypto.getRandomValues(b);
        let r = '';
        for (let i = 0; i < b.length; i++) r += identity.ANON_ALPHABET[b[i] & 31].toLowerCase();
        return identity.EPOCH_PREFIX + getTodayString() + '-' + r;
    },

    // ── Counts ──
    // Rows without a uid, per uid table
    missingUids: async function() {
        const out = {};
        for (const t of db.tables) {
            if (!identity.carriesUid(t.name)) continue;
            const n = await t.filter(r => !r.uid).count();
            if (n) out[t.name] = n;
        }
        return out;
    },

    // References per registry field ('table.path' with array positions as []), and how many point at
    // a record this device doesn't have (her data's baseline, e.g. 5-19's orphaned completions)
    referenceCounts: async function() {
        const ids = {};
        for (const t of db.tables) if (identity.carriesUid(t.name)) ids[t.name] = new Set((await t.toArray()).map(r => String(r.id)));
        const counts = {};
        for (const t of db.tables) {
            if (!identity.carriesUid(t.name)) continue;
            for (const r of await t.toArray()) {
                for (const slot of identity.slots(t.name, r)) {
                    const v = slot.get();
                    if (v === null || v === undefined || v === '') continue;
                    const key = t.name + '.' + slot.path.replace(/\.\d+(?=\.|$)/g, '.[]').replace(/^(skillScores)\..*$/, '$1.{}');
                    const c = counts[key] || (counts[key] = { refs: 0, unresolved: 0 });
                    c.refs++;
                    if (!ids[slot.target] || !ids[slot.target].has(String(v))) c.unresolved++;
                }
            }
        }
        return counts;
    },

    // Uids that appear more than once in one table
    duplicateUids: async function() {
        const out = {};
        for (const t of db.tables) {
            if (!identity.carriesUid(t.name)) continue;
            const seen = new Set();
            let n = 0;
            await t.each(r => { if (!r.uid) return; if (seen.has(r.uid)) n++; else seen.add(r.uid); });
            if (n) out[t.name] = n;
        }
        return out;
    },

    // ── Pre-cutover reconciliation (§8.2.6): the other device's Drive copy, compared by id ──
    // Rows with the same id on both devices but a different createdAt (or, for students, a
    // different name) were made separately on each. Students: STOP. Others: a warning.
    // Returns { ok, reason?, collisions: { table: [ids] } }. Changes nothing.
    reconcile: async function() {
        const syncPassword = localStorage.getItem('drive-sync-password');
        const webhookUrl = localStorage.getItem('webhook_absent') || localStorage.getItem('webhook_wildcat');
        const webhookToken = localStorage.getItem('webhook_token');
        if (!syncPassword || !webhookUrl || !webhookToken) return { ok: false, reason: 'no sync password, webhook address or token on this device' };
        if (!navigator.onLine) return { ok: false, reason: 'this device is offline' };
        let result, data;
        try {
            const response = await syncFetch(webhookUrl, { method: 'POST', body: JSON.stringify({ action: 'load_from_drive', token: webhookToken, requestingDevice: syncThisDevice() }) });
            result = await response.json();
        } catch (e) { return { ok: false, reason: 'no reply from Google' }; }
        if (!result || result.status !== 'success') return { ok: false, reason: result && result.status === 'no_data' ? 'the other device has no Drive copy' : 'the other device\'s copy could not be fetched' };
        try { data = JSON.parse(await secureStorage.decrypt(result.encryptedData, syncPassword)); } catch (e) { return { ok: false, reason: 'the other device\'s copy could not be read' }; }
        const collisions = {};
        for (const t of db.tables) {
            if (!identity.carriesUid(t.name) || identity.LOCAL_IN_UID_MODE.includes(t.name)) continue;
            const theirs = new Map((Array.isArray(data[t.name]) ? data[t.name] : []).filter(r => r && r.id != null).map(r => [String(r.id), r]));
            const list = [];
            for (const r of await t.toArray()) {
                const o = theirs.get(String(r.id));
                if (!o) continue;
                const differ = (o.createdAt && r.createdAt && o.createdAt !== r.createdAt) ||
                    (t.name === 'students' && ((o.firstName || '') !== (r.firstName || '') || (o.lastName || '') !== (r.lastName || '')));
                if (differ) list.push(r.id);
            }
            if (list.length) collisions[t.name] = list;
        }
        return { ok: true, collisions, otherDevice: result.deviceId || (syncThisDevice() === 'iPad' ? 'PC' : 'iPad') };
    },

    // ── Refusals that depend on this device (as the skills migration's) ──
    environmentRefusals: async function() {
        const out = [];
        if (await identity.uidMode()) out.push('This device has already been through the identity cutover (sync-epoch ' + (await localSyncEpoch()) + ').');
        if (localStorage.getItem('drive-sync-enabled') === 'true') out.push('Turn Drive sync off first.');
        if (syncThisDevice() === 'iPad') out.push('The cutover runs on the PC only.');
        const exp = await db.settings.get('last-manual-export');
        const t = exp && exp.value ? new Date(exp.value).getTime() : 0;
        if (!t || Date.now() - t > this.EXPORT_MAX_AGE_MS) out.push('Export JSON first: the last export is more than 2 hours old (or there is none).');
        if (driveSync._pendingMerge) out.push('A downloaded update is still waiting to be applied. Close and reopen the app with sync off.');
        return out;
    },

    _refLines: function(counts) {
        return Object.keys(counts).sort().map(k => `  ${k}: ${counts[k].refs}${counts[k].unresolved ? ` (${counts[k].unresolved} to records this device doesn't have)` : ''}`);
    },

    // ── Preview (changes nothing) ──
    preview: async function(options) {
        const missing = await this.missingUids();
        const refs = await this.referenceCounts();
        this._previewRefCounts = refs;
        const env = await this.environmentRefusals();
        const L = [`Identity cutover: Preview (${syncThisDevice()}, ${new Date().toLocaleString('en-US')}). Nothing was changed.`];
        if (env.length) L.push('Run would refuse on this device right now:', ...env.map(e => '  ⛔ ' + e));
        const totalMissing = Object.values(missing).reduce((a, b) => a + b, 0);
        L.push('', `Rows without a uid: ${totalMissing}`, ...Object.keys(missing).sort().map(k => `  ${k}: ${missing[k]}`));
        L.push('', 'References (field: count):', ...this._refLines(refs));
        L.push('', ...(await identity.standingLines()));
        let stop = false;
        if (!(options && options.skipReconcile)) {
            const rc = await this.reconcile();
            L.push('');
            if (!rc.ok) L.push(`Reconciliation with the other device's Drive copy: not run (${rc.reason}).`);
            else {
                const tables = Object.keys(rc.collisions);
                if (!tables.length) L.push(`Reconciliation with the ${rc.otherDevice}'s Drive copy: no rows made separately on both devices with the same id.`);
                else {
                    L.push(`Reconciliation with the ${rc.otherDevice}'s Drive copy: rows with the same id made separately on each device:`);
                    for (const t of tables.sort()) {
                        if (t === 'students') { stop = true; L.push(`  ⛔ STOP students: ids ${rc.collisions[t].join(', ')} (P19's roster repair first)`); }
                        else L.push(`  ⚠️ ${t}: ids ${rc.collisions[t].join(', ')} (the PC's version is kept at the re-seed)`);
                    }
                }
            }
        }
        this._show(L.join('\n'), !stop && env.length === 0);
        return { missing, refs, env, stop };
    },

    // ── Run (PC only): one transaction, fills uids and sets the epoch ──
    run: async function() {
        const env = await this.environmentRefusals();
        if (env.length) {
            this._show(`Not run — nothing was changed:\n${env.map(r => '  ⛔ ' + r).join('\n')}`, false);
            return { ok: false, refusals: env };
        }
        const missing = await this.missingUids();
        const totalMissing = Object.values(missing).reduce((a, b) => a + b, 0);
        if (!confirm(`Run the identity cutover on this PC now? ${totalMissing} rows get a uid and the sync-epoch changes. Nothing else is written. Make sure you exported both devices first.`)) {
            return { ok: false, cancelled: true };
        }
        const before = await this.referenceCounts();
        const M = new Date().toISOString();
        const epochId = this.newEpochId();
        let filled = 0;
        try {
            await db.transaction('rw', db.tables, async () => {
                syncHooks.markBulk();
                for (const t of db.tables) {
                    if (!identity.carriesUid(t.name)) continue;
                    const rows = await t.filter(r => !r.uid).toArray();
                    for (const r of rows) { await t.update(r.id, { uid: identity.newUid() }); filled++; }
                }
                await db.settings.put({ key: identity.SPACE_KEY, value: identity.newSpaceToken() });   // this database's id space
                const prev = await db.settings.get('sync-epoch');
                await db.settings.put({ key: 'sync-epoch', value: { id: epochId, at: M, tool: this.TOOL, previous: (prev && prev.value && prev.value.id) || null }, createdAt: M, updatedAt: M });
            });
        } catch (err) {
            console.error('Identity cutover failed:', err);
            this._show(`❌ The cutover stopped with an error, and nothing was changed.\n${err && err.message ? err.message : err}`, false);
            return { ok: false, error: String(err && err.message || err) };
        }
        await logAction('migrate', 'identity', null, `Identity cutover (${epochId}): ${filled} uids filled`);
        this._previewRefCounts = this._previewRefCounts || before;
        const v = await this.verify();
        this._show(`✅ Done: ${filled} uids filled · sync-epoch ${epochId}.\nNext (run sheet): Export JSON now; that export is the iPad's re-seed file.\n\n` + this.verifyText(v), v.ok);
        if (typeof driveSync !== 'undefined') driveSync.updateSyncStatusUI();
        return { ok: true, filled, epochId, verify: v };
    },

    // ── Verify (changes nothing) ──
    verify: async function() {
        const items = [];
        const add = (id, label, ok, detail) => items.push({ id, label, ok, detail });
        const epoch = await localSyncEpoch();
        add('V1', 'the sync-epoch is an identity epoch', identity.isUidEpoch(epoch), epoch || 'none');
        const missing = await this.missingUids();
        add('V2', 'every row in every synced table has a uid', Object.keys(missing).length === 0, Object.keys(missing).map(k => `${k} ${missing[k]}`).join(', '));
        const dup = await this.duplicateUids();
        add('V3', 'uids are unique per table', Object.keys(dup).length === 0, Object.keys(dup).map(k => `${k} ${dup[k]}`).join(', '));
        const refs = await this.referenceCounts();
        if (this._previewRefCounts) {
            const a = JSON.stringify(this._previewRefCounts), b = JSON.stringify(refs);
            add('V4', 'reference counts equal Preview\'s', a === b, a === b ? '' : 'they differ: run Preview and Verify again and compare the reports');
        } else add('V4', 'reference counts equal Preview\'s', true, 'no Preview in this session to compare with (skipped)');
        // V5: a new row gets a uid (made and rolled back; nothing is kept). The add marks the data
        // for upload; that is undone too when nothing else was waiting (review finding 9).
        let newRowUid = false;
        const wasDirty = driveSync._dirty;
        try {
            await db.transaction('rw', db.events, async () => {
                const id = await db.events.add({ title: 'Identity check (rolled back)', date: getTodayString(), category: 'check' });
                const row = await db.events.get(id);
                newRowUid = !!(row && typeof row.uid === 'string' && row.uid.length === 22);
                throw new Error('rollback');
            });
        } catch (e) { /* rolled back on purpose */ }
        if (!wasDirty) { clearTimeout(driveSync._timer); driveSync._dirty = false; }
        add('V5', 'a new row gets a 22-character uid (tested in a rolled-back transaction)', newRowUid);
        const unresolved = await identity.unresolvedCount();
        const standing = await identity.standingCounts();
        const ok = items.every(i => i.ok);
        return { ok, items, refs, unresolved, standing, epoch };
    },

    verifyText: function(v) {
        return `Verify (${syncThisDevice()}, ${new Date().toLocaleString('en-US')}):\n` +
            v.items.map(i => `  ${i.ok ? '✅' : '❌'} ${i.id} ${i.label}${i.detail ? ' — ' + i.detail : ''}`).join('\n') +
            `\n  Unresolved references: ${v.unresolved}\n  Live activities sharing a contract code: ${v.standing.contractCodes} · Skills sharing a name: ${v.standing.skillNames} · Inventory items sharing a name: ${v.standing.inventoryNames} · Students sharing an anonId: ${v.standing.anonIds}`;
    },

    runVerify: async function() {
        const v = await this.verify();
        this._show(this.verifyText(v), v.ok);
        return v;
    },

    // ── UI ──
    _show: function(text, ok) {
        this._lastReport = text;
        const el = document.getElementById('identity-migration-output');
        if (el) {
            el.textContent = text;
            el.style.borderColor = ok === false ? 'var(--color-error)' : 'var(--color-border)';
        }
    },

    initCard: function() {
        const card = document.getElementById('identity-migration-card');
        if (card) card.style.display = localStorage.getItem('identity-tool-enabled') === 'true' ? '' : 'none';
        const runBtn = document.getElementById('identity-migration-run-btn');
        if (runBtn) runBtn.style.display = syncThisDevice() === 'iPad' ? 'none' : '';
    },

    copyReport: async function() {
        if (!this._lastReport) { ui.showToast('Run Preview or Verify first.', 'info'); return; }
        try {
            await navigator.clipboard.writeText(this._lastReport);
            ui.showToast('Report copied (counts and ids only)', 'success');
        } catch (e) {
            ui.showToast('Could not copy. Take a screenshot instead.', 'warning');
        }
    }
};
