// ==========================================
// NOTES SYSTEM
// ==========================================
const notesManager = {
    addNote: async function(entityType, entityId, inputId) {
        const inputElement = document.getElementById(inputId);
        if (!inputElement) return;
        
        const content = inputElement.value.trim();
        if (!content) return; 

        try {
            await db.notes.add({
                entityType: entityType,
                entityId: Number(entityId),
                content: content,
                createdAt: new Date().toISOString()
            });
            
            inputElement.value = ''; 
            ui.showToast('Note added!', 'success');
            
            this.loadNotes(entityType, entityId, `notes-list-${entityType}`);
        } catch (error) {
            console.error('Error adding note:', error);
            ui.showToast('Failed to save note', 'error');
        }
    },

    loadNotes: async function(entityType, entityId, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        try {
            const notes = await db.notes
                .where('entityType').equals(entityType)
                .filter(n => n.entityId === Number(entityId))
                .toArray();
            
            notes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            
            if (notes.length === 0) {
                container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic; font-size: 0.9em;">No notes yet. Add one above!</p>';
                return;
            }

            container.innerHTML = notes.map(note => `
                <div class="note-card" style="background: var(--color-background-alt); padding: 12px; border-radius: 6px; margin-bottom: 10px; border-left: 3px solid var(--color-primary);">
                    <p style="margin-bottom: 8px; white-space: pre-wrap; font-size: 0.95em; color: var(--color-text-primary);">${escapeHtml(note.content)}</p>
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8em; color: var(--color-text-tertiary);">
                        <span>${new Date(note.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                        <button onclick="notesManager.deleteNote(${note.id}, '${escapeHtml(entityType)}', ${escapeHtml(entityId)}, '${escapeHtml(containerId)}')" style="background: none; border: none; color: var(--color-error); cursor: pointer; padding: 4px;">Delete</button>
                    </div>
                </div>
            `).join('');
            
        } catch (error) {
            console.error('Error loading notes:', error);
            container.innerHTML = '<p style="color: var(--color-error);">Failed to load notes.</p>';
        }
    },

    deleteNote: async function(noteId, entityType, entityId, containerId) {
        if (!confirm('Are you sure you want to delete this note?')) return;
        
        try {
            await db.notes.delete(noteId);
            ui.showToast('Note deleted', 'success');
            this.loadNotes(entityType, entityId, containerId);
        } catch (error) {
            console.error('Error deleting note:', error);
            ui.showToast('Failed to delete note', 'error');
        }
    }
};

// ============================================
// GLOBAL SEARCH
// ============================================

const globalSearch = {
    debounceTimer: null,

    run: function(term) {
        clearTimeout(this.debounceTimer);
        const resultsDiv = document.getElementById('search-results');

        if (!term || term.trim().length < 2) {
            resultsDiv.classList.add('hidden');
            resultsDiv.innerHTML = '';
            return;
        }

        this.debounceTimer = setTimeout(() => this.query(term.trim().toLowerCase()), 250);
    },

    query: async function(term) {
        const resultsDiv = document.getElementById('search-results');

        try {
            const [students, teams, activities, inventoryItems, tasks] = await Promise.all([
                db.students.filter(s => !s.deletedAt && s.status !== 'archived' &&
                    ((s.firstName || '') + ' ' + (s.lastName || '')).toLowerCase().includes(term)
                ).limit(5).toArray(),
                db.teams.filter(t => !t.deletedAt && t.name.toLowerCase().includes(term)).limit(5).toArray(),
                db.activities.filter(a => !a.deletedAt && a.name.toLowerCase().includes(term)).limit(5).toArray(),
                db.inventory.filter(i => !i.deletedAt && i.name.toLowerCase().includes(term)).limit(5).toArray(),
                db.tasks.filter(t => t.status !== 'completed' && t.description.toLowerCase().includes(term)).limit(5).toArray(),
            ]);

            const totalResults = students.length + teams.length + activities.length + inventoryItems.length + tasks.length;

            if (totalResults === 0) {
                resultsDiv.innerHTML = '<div style="padding: var(--space-base); color: var(--color-text-tertiary); text-align: center;">No results found</div>';
                resultsDiv.classList.remove('hidden');
                return;
            }

            let html = '';

            if (students.length > 0) {
                html += `<div style="padding: var(--space-sm) var(--space-base); font-size: var(--font-size-body-small); font-weight: 600; color: var(--color-text-secondary); background: var(--color-background-secondary);">Students (${students.length})</div>`;
                students.forEach(s => {
                    html += `<div class="search-result-item" onclick="globalSearch.close(); viewStudent(${s.id})" style="padding: var(--space-sm) var(--space-base); cursor: pointer; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-border);">
                        <span>${escapeHtml(displayName(s))}</span>
                    </div>`;
                });
            }

            if (teams.length > 0) {
                html += `<div style="padding: var(--space-sm) var(--space-base); font-size: var(--font-size-body-small); font-weight: 600; color: var(--color-text-secondary); background: var(--color-background-secondary);">Groups (${teams.length})</div>`;
                teams.forEach(t => {
                    html += `<div class="search-result-item" onclick="globalSearch.close(); router.navigate('team-detail', ${t.id});" style="padding: var(--space-sm) var(--space-base); cursor: pointer; border-bottom: 1px solid var(--color-border);">
                        <span>${escapeHtml(t.name)}</span>
                    </div>`;
                });
            }

            if (activities.length > 0) {
                html += `<div style="padding: var(--space-sm) var(--space-base); font-size: var(--font-size-body-small); font-weight: 600; color: var(--color-text-secondary); background: var(--color-background-secondary);">Assignments (${activities.length})</div>`;
                activities.forEach(a => {
                    html += `<div class="search-result-item" onclick="globalSearch.close(); state.selectedActivity = ${a.id}; router.navigate('activity-detail'); pages.activityDetail.render(${a.id});" style="padding: var(--space-sm) var(--space-base); cursor: pointer; border-bottom: 1px solid var(--color-border);">
                        <span>${escapeHtml(a.name)}</span>
                    </div>`;
                });
            }

            if (inventoryItems.length > 0) {
                html += `<div style="padding: var(--space-sm) var(--space-base); font-size: var(--font-size-body-small); font-weight: 600; color: var(--color-text-secondary); background: var(--color-background-secondary);">Inventory (${inventoryItems.length})</div>`;
                inventoryItems.forEach(i => {
                    html += `<div class="search-result-item" onclick="globalSearch.close(); router.navigate('inventory');" style="padding: var(--space-sm) var(--space-base); cursor: pointer; border-bottom: 1px solid var(--color-border);">
                        <span>${escapeHtml(i.name)}</span>
                    </div>`;
                });
            }

            if (tasks.length > 0) {
                html += `<div style="padding: var(--space-sm) var(--space-base); font-size: var(--font-size-body-small); font-weight: 600; color: var(--color-text-secondary); background: var(--color-background-secondary);">Tasks (${tasks.length})</div>`;
                tasks.forEach(t => {
                    html += `<div class="search-result-item" onclick="globalSearch.close(); router.navigate('tasks'); pages.tasks.render();" style="padding: var(--space-sm) var(--space-base); cursor: pointer; border-bottom: 1px solid var(--color-border);">
                        <span>${escapeHtml(t.description.substring(0, 60))}${t.description.length > 60 ? '...' : ''}</span>
                    </div>`;
                });
            }

            resultsDiv.innerHTML = html;
            resultsDiv.classList.remove('hidden');
        } catch (err) {
            console.error('Search error:', err);
            resultsDiv.classList.add('hidden');
        }
    },

    close: function() {
        const resultsDiv = document.getElementById('search-results');
        resultsDiv.classList.add('hidden');
        resultsDiv.innerHTML = '';
        document.getElementById('global-search').value = '';
    }
};

// Close search results when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.header__search')) {
        const resultsDiv = document.getElementById('search-results');
        if (resultsDiv) {
            resultsDiv.classList.add('hidden');
        }
    }
});

// ============================================
// GESTURE UTILITIES
// ============================================

const gestures = {
    makeSwipeable: function(el, opts) {
        // PC fallback — no touch support, skip entirely
        if (!('ontouchstart' in window)) return;

        opts = opts || {};
        const threshold = opts.threshold || 80;
        const maxDisplacement = 150;
        const allowRight = opts.allowRightSwipe !== false;
        const allowLeft = opts.allowLeftSwipe !== false;

        // Wrap element contents for swipe visual structure
        const wrapper = document.createElement('div');
        wrapper.className = 'swipe-wrapper';

        const bgDiv = document.createElement('div');
        bgDiv.className = 'swipe-bg';
        bgDiv.style.display = 'none';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'swipe-content';

        // Move all children into contentDiv
        while (el.firstChild) {
            contentDiv.appendChild(el.firstChild);
        }

        wrapper.appendChild(bgDiv);
        wrapper.appendChild(contentDiv);
        el.appendChild(wrapper);

        // Gesture state
        let startX = 0, startY = 0;
        let _swiping = false, _scrolling = false, _decided = false;
        let _touchId = null;
        let _swipeOccurred = false;

        // Expose _swipeOccurred flag on the element so click handlers can check it
        el._gestureState = { get swipeOccurred() { return _swipeOccurred; } };

        el.addEventListener('touchstart', function(e) {
            // If touch starts on an ignored element, bail out
            if (opts.ignoreSelector && e.target.closest(opts.ignoreSelector)) return;

            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            _touchId = touch.identifier;
            _swiping = false;
            _scrolling = false;
            _decided = false;
            _swipeOccurred = false;

            contentDiv.classList.add('swiping');
        }, { passive: true });

        el.addEventListener('touchmove', function(e) {
            if (_scrolling || _touchId === null) return;

            const touch = Array.from(e.touches).find(t => t.identifier === _touchId);
            if (!touch) return;

            const deltaX = touch.clientX - startX;
            const deltaY = touch.clientY - startY;

            // Dead zone — decide scroll vs swipe
            if (!_decided) {
                const dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                if (dist < 10) return; // Still in dead zone

                if (Math.abs(deltaY) > Math.abs(deltaX)) {
                    _scrolling = true;
                    contentDiv.classList.remove('swiping');
                    return;
                } else {
                    _swiping = true;
                    _decided = true;
                }
            }

            if (!_swiping) return;

            e.preventDefault(); // Prevent scroll jank during swipe

            // Clamp to allowed directions
            let clampedDelta = deltaX;
            if (!allowRight && clampedDelta > 0) clampedDelta = 0;
            if (!allowLeft && clampedDelta < 0) clampedDelta = 0;

            // Clamp to max displacement
            clampedDelta = Math.max(-maxDisplacement, Math.min(maxDisplacement, clampedDelta));

            contentDiv.style.transform = `translateX(${clampedDelta}px)`;

            // Show appropriate background
            if (clampedDelta > 0 && allowRight) {
                bgDiv.style.display = 'flex';
                bgDiv.className = 'swipe-bg swipe-bg--right';
                bgDiv.style.backgroundColor = opts.rightColor || 'var(--color-success)';
                const icon = opts.rightIcon || '✓';
                const scale = Math.abs(clampedDelta) >= threshold ? 1.3 : 1;
                bgDiv.innerHTML = `<span style="transform: scale(${scale}); transition: transform 150ms ease;">${icon}</span>`;
            } else if (clampedDelta < 0 && allowLeft) {
                bgDiv.style.display = 'flex';
                bgDiv.className = 'swipe-bg swipe-bg--left';
                bgDiv.style.backgroundColor = opts.leftColor || 'var(--color-error)';
                const icon = opts.leftIcon || '✗';
                const scale = Math.abs(clampedDelta) >= threshold ? 1.3 : 1;
                bgDiv.innerHTML = `<span style="transform: scale(${scale}); transition: transform 150ms ease;">${icon}</span>`;
            } else {
                bgDiv.style.display = 'none';
            }
        }, { passive: false });

        function onTouchEndOrCancel(e) {
            if (_touchId === null) return;

            if (e.type === 'touchend') {
                const ended = Array.from(e.changedTouches).find(t => t.identifier === _touchId);
                if (!ended) return;
            }

            contentDiv.classList.remove('swiping');

            if (!_swiping) {
                _touchId = null;
                return;
            }

            const currentTransform = contentDiv.style.transform;
            const match = currentTransform.match(/translateX\((-?[\d.]+)px\)/);
            const finalDelta = match ? parseFloat(match[1]) : 0;

            if (Math.abs(finalDelta) >= threshold && e.type !== 'touchcancel') {
                // Swipe succeeded — slide out
                _swipeOccurred = true;
                contentDiv.style.transition = 'transform 200ms ease-in';
                contentDiv.style.transform = `translateX(${finalDelta > 0 ? '100%' : '-100%'})`;

                contentDiv.addEventListener('transitionend', function handler() {
                    contentDiv.removeEventListener('transitionend', handler);
                    contentDiv.style.transition = '';
                    contentDiv.style.transform = 'translateX(0)';
                    bgDiv.style.display = 'none';

                    if (finalDelta > 0 && opts.onSwipeRight) {
                        opts.onSwipeRight(el);
                    } else if (finalDelta < 0 && opts.onSwipeLeft) {
                        opts.onSwipeLeft(el);
                    }
                });

                // Safety timeout in case transitionend doesn't fire
                setTimeout(() => {
                    contentDiv.style.transition = '';
                    contentDiv.style.transform = 'translateX(0)';
                    bgDiv.style.display = 'none';
                }, 300);
            } else {
                // Swipe failed — spring back
                contentDiv.style.transition = 'transform 150ms ease-out';
                contentDiv.style.transform = 'translateX(0)';

                contentDiv.addEventListener('transitionend', function handler() {
                    contentDiv.removeEventListener('transitionend', handler);
                    contentDiv.style.transition = '';
                    bgDiv.style.display = 'none';
                });

                setTimeout(() => {
                    contentDiv.style.transition = '';
                    bgDiv.style.display = 'none';
                }, 200);
            }

            setTimeout(() => { _swipeOccurred = false; }, 300);
            _touchId = null;
        }

        el.addEventListener('touchend', onTouchEndOrCancel);
        el.addEventListener('touchcancel', onTouchEndOrCancel);
    }
};

// Initialize default schedules if they don't exist
async function initializePeriodYearMap() {
    
    // Initialize period-year mapping if it doesn't exist
    // Teacher configures this in Settings → Periods
    const existingMapping = await db.settings.get('period-year-map');
    if (!existingMapping) {
        await db.settings.put({ 
            key: 'period-year-map', 
            value: {}
        });
        console.log('✅ Period-year mapping initialized (empty — configure in Settings → Periods)');
    }
}
