// ============================================
// GUARDS (plan row 3-15: STR3, DL7, STR8, DL15, DL16, X16)
// - One busy-button helper: each save and send action runs once at a time. A second tap while
//   it runs does nothing (the tapped button is marked aria-busy; its own enabled/disabled state
//   is left to the action, as some actions manage it). A double tap used to save twice
//   (duplicate students, teams, checkouts, Classroom assignments, emails).
// - Enter in a form field no longer submits the form (it used to reload the app).
// - Unsaved changes: a modal closed with × or Escape, and Full Edit or the checkpoint page left
//   by navigation (Full Edit's own Cancel included), ask first when something was typed or
//   changed there. A modal's Cancel button still closes at once, and a successful save never
//   asks. Controls that only change the view carry data-no-dirty and don't count.
// ============================================

const guards = {
    _busy: new Map(),
    _lastButton: null,
    _lastButtonAt: 0,
    _userClick: false,
    _dirty: new Set(),

    // The page areas whose unsaved changes are guarded on navigation
    PAGES: { 'page-activity-edit': 'Full Edit', 'page-checkpoint': 'the checkpoint page' },

    // A run that never finishes (a lost network reply) frees its key after this long
    BUSY_MAX_MS: 90000,

    // ── Busy helper ──
    // Runs fn once per key at a time. Returns fn's result, or undefined if one was already running.
    run: async function(key, fn, btn) {
        if (this._busy.has(key)) return undefined;
        const token = {};
        this._busy.set(key, token);
        const button = btn || null;
        if (button) button.setAttribute('aria-busy', 'true');
        const release = () => {
            if (this._busy.get(key) === token) this._busy.delete(key);
            if (button) button.removeAttribute('aria-busy');
        };
        const timer = setTimeout(release, this.BUSY_MAX_MS);
        try {
            return await fn();
        } finally {
            clearTimeout(timer);
            release();
        }
    },

    isBusy: function(key) { return this._busy.has(key); },

    // The button the user is tapping right now (iPad Safari doesn't focus buttons, so it's tracked here)
    tappedButton: function() {
        if (this._userClick && this._lastButton && this._lastButton.isConnected && Date.now() - this._lastButtonAt < 2000) return this._lastButton;
        return null;
    },

    // Wraps obj[name] for each name so it runs once at a time per set of plain arguments
    // (the same save twice is refused; saving two different records at once is still allowed).
    wrapBusy: function(obj, label, names) {
        if (!obj) { console.warn('guards: nothing to wrap for ' + label); return; }
        for (const name of names) {
            const orig = obj[name];
            if (orig && orig.__busyGuarded) continue;
            if (typeof orig !== 'function') { console.warn('guards: ' + label + '.' + name + ' is not a function'); continue; }
            const self = this;
            const wrapped = function(...args) {
                const plain = args.filter(a => a === null || ['string', 'number', 'boolean'].includes(typeof a));
                const key = label + '.' + name + (plain.length ? ':' + JSON.stringify(plain) : '');
                const btn = args.find(a => a && a.nodeType === 1 && a.tagName === 'BUTTON') || self.tappedButton();
                return self.run(key, () => orig.apply(this, args), btn);
            };
            wrapped.__busyGuarded = true;
            wrapped.__original = orig;
            obj[name] = wrapped;
        }
    },

    // ── Unsaved-changes tracking ──
    markDirty: function(scopeId) { if (scopeId) this._dirty.add(scopeId); },
    markClean: function(scopeId) { this._dirty.delete(scopeId); },
    isDirty: function(scopeId) { return this._dirty.has(scopeId); },

    // The modal or guarded page an element belongs to
    scopeOf: function(el) {
        if (!el || !el.closest) return null;
        const modal = el.closest('.modal-backdrop');
        if (modal) return modal.id || null;
        for (const id of Object.keys(this.PAGES)) if (el.closest('#' + id)) return id;
        return null;
    },

    // Close a modal the way × and Escape do: ask first if something was changed in it
    requestHideModal: function(modalId) {
        if (this.isDirty(modalId) && !confirm('Close without saving? What you changed here will be lost.')) return false;
        ui.hideModal(modalId);
        return true;
    },

    // Called by the router (and Full Edit's Cancel) before it leaves a page. False = stay.
    confirmLeave: function() {
        const current = document.querySelector('.page:not(.hidden)');
        const id = current && current.id;
        if (!id || !this.PAGES[id] || !this.isDirty(id)) return true;
        if (!confirm(`Leave ${this.PAGES[id]} without saving? What you changed there will be lost.`)) return false;
        this.markClean(id);
        return true;
    },

    anyUnsaved: function() {
        if (this._dirty.size === 0) return false;
        for (const id of this._dirty) {
            const el = document.getElementById(id);
            if (!el) continue;
            if (!el.classList.contains('hidden')) return true;
        }
        return false;
    },

    // Marks a page dirty after a list-editing method runs from a tap (add, remove or move a row)
    wrapDirtying: function(obj, scopeId, names) {
        if (!obj) return;
        for (const name of names) {
            const orig = obj[name];
            if (typeof orig !== 'function' || orig.__dirtyGuarded) continue;
            const self = this;
            const wrapped = function(...args) {
                const fromTap = self._userClick;
                const result = orig.apply(this, args);
                if (fromTap) self.markDirty(scopeId);
                return result;
            };
            wrapped.__dirtyGuarded = true;
            obj[name] = wrapped;
        }
    },

    // Marks a page clean before (when) or after (otherwise) a method runs: a fresh form or list
    wrapCleaning: function(obj, scopeId, names, when) {
        if (!obj) return;
        for (const name of names) {
            const orig = obj[name];
            if (typeof orig !== 'function' || orig.__cleanGuarded) continue;
            const self = this;
            const wrapped = when === 'before'
                ? function(...args) { self.markClean(scopeId); return orig.apply(this, args); }
                : async function(...args) { try { return await orig.apply(this, args); } finally { self.markClean(scopeId); } };
            wrapped.__cleanGuarded = true;
            obj[name] = wrapped;
        }
    },

    init: function() {
        // The tapped button, and whether a tap is being handled right now
        document.addEventListener('click', e => {
            if (!e.isTrusted) return;
            this._userClick = true;
            setTimeout(() => { this._userClick = false; }, 0);   // over once the tap's handlers have run
            const b = e.target && e.target.closest ? e.target.closest('button') : null;
            if (b) { this._lastButton = b; this._lastButtonAt = Date.now(); }
        }, true);

        // A modal's × button: its own onclick closes the modal, so the question is asked here,
        // before that runs. "Cancel" stops the click; "OK" lets it close as before.
        document.addEventListener('click', e => {
            const x = e.target && e.target.closest ? e.target.closest('.modal__close') : null;
            const modal = x && x.closest('.modal-backdrop');
            if (!modal || !this.isDirty(modal.id)) return;
            if (confirm('Close without saving? What you changed here will be lost.')) { this.markClean(modal.id); return; }
            e.preventDefault();
            e.stopImmediatePropagation();
        }, true);

        // Typing or changing a field marks its modal or guarded page
        const onEdit = e => {
            if (!e.isTrusted) return;
            const t = e.target;
            if (!t || t.closest && t.closest('[data-no-dirty]')) return;
            this.markDirty(this.scopeOf(t));
        };
        document.addEventListener('input', onEdit, true);
        document.addEventListener('change', onEdit, true);

        // DL15: Enter in a field never submits a form (that reloaded the app)
        document.addEventListener('submit', e => { e.preventDefault(); }, true);

        // Closing the tab or reloading with unsaved changes asks too (where the browser allows)
        window.addEventListener('beforeunload', e => {
            const attendance = typeof pages !== 'undefined' && pages.attendance && pages.attendance.hasUnsavedChanges && pages.attendance.hasUnsavedChanges();
            if (this.anyUnsaved() || attendance) { e.preventDefault(); e.returnValue = ''; }
        });

        // Opening or closing a modal starts it clean
        const show = ui.showModal, hide = ui.hideModal;
        ui.showModal = function(modalId) { guards.markClean(modalId); return show.apply(this, arguments); };
        ui.hideModal = function(modalId) { guards.markClean(modalId); return hide.apply(this, arguments); };
    }
};

// ── Which actions are guarded ──
// [object, label, method names]: each must exist (a test checks every one is wrapped)
guards.BUSY = [
    [() => (typeof modals !== 'undefined' ? modals : null), 'modals', ['saveStudent', 'saveTeam', 'saveActivity', 'saveQuickEdit', 'saveInventoryItem', 'submitCheckout', 'checkIn',
        'saveTask', 'saveEvent', 'completeEndClass', 'addTeacher', 'updateClassroomCoursework']],
    [() => pages.activityEdit, 'activityEdit', ['save', 'syncToHub', 'updateCoursework', 'createSkillAssignments', 'createPPAssignment', 'createTopic']],
    [() => pages.activityDetail, 'activityDetail', ['sendAllFeedback', 'sendStudentFeedback', 'pushToClassroom', 'checkFormSubmissions', 'saveFormMapping']],
    [() => pages.attendance, 'attendance', ['saveAttendance']],
    [() => pages.students, 'students', ['importFromCSV']],
    [() => pages.studentDetail, 'studentDetail', ['saveNote']],
    [() => pages.settings, 'settings', ['saveClass', 'saveNonInstructionalDay', 'importContractGuide', 'importData', 'importEquipment', 'importSkillsLibrary', 'importStandards', 'archiveSchoolYear']],
    [() => pages.skills, 'skills', ['saveSkill', 'saveStandard', 'saveBulkUpdate', 'saveCertifications']],
    [() => (typeof notesManager !== 'undefined' ? notesManager : null), 'notes', ['addNote']],
    [() => (typeof hubSync !== 'undefined' ? hubSync : null), 'hubSync', ['syncFromCard']]
];
for (const [get, label, names] of guards.BUSY) guards.wrapBusy(get(), label, names);

if (typeof pages !== 'undefined') {
    // Full Edit's list editors (add, remove or move a row) and the Classroom "create on save" choice
    if (pages.activityEdit) {
        const listEditors = Object.keys(pages.activityEdit).filter(k => /^(add|remove|move)[A-Z]/.test(k) && typeof pages.activityEdit[k] === 'function');
        guards.wrapDirtying(pages.activityEdit, 'page-activity-edit', listEditors.concat(['createCoursework', 'syncMaxPointsToPoints']));
    }
    // Full Edit starts clean once its form is filled in
    guards.wrapCleaning(pages.activityEdit, 'page-activity-edit', ['render'], 'after');
    // The checkpoint page's taps that change what Save will write; picking another class, team,
    // assignment or checkpoint draws a fresh list (unsaved marks were always dropped there)
    guards.wrapDirtying(pages.checkpoint, 'page-checkpoint', ['markAllComplete', 'setSkillRating', 'setCertDemo', 'setPacing']);
    guards.wrapCleaning(pages.checkpoint, 'page-checkpoint', ['render', 'reset', 'selectClass', 'selectActivity', 'selectTeam', 'selectCheckpoint'], 'before');
}
