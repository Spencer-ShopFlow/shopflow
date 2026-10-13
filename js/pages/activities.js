// ----------------------------------------
// ACTIVITIES PAGE
// ----------------------------------------
pages.activities = {
    currentFilter: 'active',
    
    render: async function() {
        this.loadAssignmentProgressCards();
        const grid = document.getElementById('activities-grid');
        grid.innerHTML = '';
        
        try {
            // Load all activities
            let activities = excludeDeleted(await db.activities.toArray());
            
            // Filter by class based on header period selection
            const headerPeriod = document.getElementById('period-select')?.value;
            if (headerPeriod && headerPeriod !== 'all') {
                const allClasses = await db.classes.toArray();
                const matchingClass = allClasses.find(cls => 
                    (cls.periods || []).includes(String(headerPeriod))
                );
                if (matchingClass) {
                    activities = activities.filter(a => a.classId === matchingClass.id);
                }
            }
            
            // Apply status filter
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (this.currentFilter !== 'all') {
                activities = activities.filter(activity => {
                    const startParts = activity.startDate.split('-');
                    const endParts = activity.endDate.split('-');
                    const startDate = new Date(startParts[0], startParts[1] - 1, startParts[2]);
                    const endDate = new Date(endParts[0], endParts[1] - 1, endParts[2]);
                    
                    if (this.currentFilter === 'active') {
                        return today >= startDate && today <= endDate;
                    } else if (this.currentFilter === 'past') {
                        return today > endDate;
                    } else if (this.currentFilter === 'upcoming') {
                        return today < startDate;
                    }
                    return true;
                });
            }
            
            if (activities.length === 0) {
                grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--color-text-tertiary); padding: var(--space-2xl);">No assignments found. Click "+ Create Assignment" to get started.</p>';
                return;
            }
            
            // Sort by due date (earliest first)
            activities.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
            
            // Load checkpoints for all activities
            const allCheckpoints = await db.checkpoints.toArray();
            
            // Attach checkpoints to activities
            activities = activities.map(activity => ({
                ...activity,
                checkpoints: allCheckpoints.filter(cp => cp.activityId === activity.id).sort((a, b) => a.number - b.number)
            }));
            
            // Render activity cards
            activities.forEach(activity => {
                const card = this.createActivityCard(activity);
                grid.appendChild(card);
            });
            
            // Update segmented toggle states
            document.querySelectorAll('.activity-filter-btn').forEach(btn => {
                if (btn.dataset.filter === this.currentFilter) {
                    btn.classList.add('active');
                    btn.style.background = 'var(--color-primary)';
                    btn.style.color = 'white';
                } else {
                    btn.classList.remove('active');
                    btn.style.background = 'var(--color-background)';
                    btn.style.color = 'var(--color-text)';
                }
            });
            
        } catch (error) {
            console.error('Error loading activities:', error);
            grid.innerHTML = '<p style="color: var(--color-error);">Failed to load assignments.</p>';
        }
    },
    
    createActivityCard: function(activity) {
        const card = document.createElement('div');
        card.className = 'card';
        
        // Parse the date as local time (not UTC) to avoid timezone issues
        const startParts = activity.startDate.split('-');
        const endParts = activity.endDate.split('-');
        const startDate = new Date(startParts[0], startParts[1] - 1, startParts[2]);
        const endDate = new Date(endParts[0], endParts[1] - 1, endParts[2]);
        const formattedStart = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const formattedEnd = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        // Determine activity status
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isActive = today >= startDate && today <= endDate;
        const isPast = today > endDate;
        const isUpcoming = today < startDate;

        const statusBadge = isActive ? 'badge--success' : isPast ? 'badge--error' : 'badge--warning';
        const statusText = isActive ? 'Active' : isPast ? 'Past' : 'Upcoming';
        
        const checkpointsList = activity.checkpoints.length > 0
            ? activity.checkpoints.map(cp => `${escapeHtml(cp.number)}. ${escapeHtml(cp.title)}`).join('<br>')
            : 'No checkpoints';
        
        card.innerHTML = `
            <div class="card__header">
                <div>
                    <h3 class="card__title">${escapeHtml(activity.name)}</h3>
                    ${escapeHtml(activity.description) ? `<p style="color: var(--color-text-secondary); font-size: var(--font-size-body-small); margin-top: var(--space-xs);">${escapeHtml(activity.description)}</p>` : ''}
                </div>
                <span class="badge" id="class-badge-${activity.id}" style="background-color: var(--color-primary); color: white;">Loading...</span>
            </div>
            <div class="card__body">
                <p><strong>Start:</strong> ${escapeHtml(formattedStart)} &nbsp;|&nbsp; <strong>End:</strong> ${escapeHtml(formattedEnd)} &nbsp; <span class="badge ${statusBadge}">${escapeHtml(statusText)}</span></p>
                <p style="margin-top: var(--space-sm);"><strong>Checkpoints (${escapeHtml(activity.checkpoints.length)}):</strong></p>
                <p style="margin-top: var(--space-xs); color: var(--color-text-secondary); font-size: var(--font-size-body-small);">${checkpointsList}</p>
            </div>
            <div class="card__footer">
                <button class="btn btn--primary" onclick="pages.activityDetail.open(${activity.id})">View Detail</button>
                <button class="btn btn--primary" onclick="state.updateCurrentPage('checkpoint')">Mark Checkpoints</button>
                <button class="btn btn--secondary" onclick="modals.openFullEdit(${activity.id})">Full Edit</button>
                <button class="btn btn--danger" onclick="pages.activities.deleteActivity(${activity.id})">Delete</button>
            </div>
        `;
        
        // Load and display class name
        if (activity.classId) {
            db.classes.get(activity.classId).then(cls => {
                const badge = document.getElementById(`class-badge-${activity.id}`);
                if (badge && cls) {
                    badge.textContent = cls.name;
                    badge.style.backgroundColor = cls.color;
                }
            });
        }

        return card;
    },
    
    setFilter: function(filter) {
        this.currentFilter = filter;
        this.render();
        this.loadAssignmentProgressCards();
    },

    loadAssignmentProgressCards: async function() {
        const container = document.getElementById('activities-progress-cards');
        if (!container) return;

        try {
            const todayStr = getTodayString();
            const niDays = await getActiveNonInstructionalDays();
            const activeYear = await getActiveSchoolYear();

            // Get all activities, then filter by current tab
            const allActivities = excludeDeleted(await db.activities.toArray());
            const filtered = allActivities.filter(a => {
                if (!a.startDate || !a.endDate) return false;
                if (this.currentFilter === 'active') return todayStr >= a.startDate && todayStr <= a.endDate;
                if (this.currentFilter === 'past') return todayStr > a.endDate;
                if (this.currentFilter === 'upcoming') return todayStr < a.startDate;
                return false;
            });

            // Apply period/class filter
            let activities = filtered;
            const headerPeriod = document.getElementById('period-select')?.value;
            if (headerPeriod && headerPeriod !== 'all') {
                const allClasses = await db.classes.toArray();
                const matchingClass = allClasses.find(cls =>
                    (cls.periods || []).includes(String(headerPeriod))
                );
                if (matchingClass) {
                    activities = activities.filter(a => a.classId === matchingClass.id);
                }
            }

            if (activities.length === 0) {
                const labels = { active: 'active', past: 'past', upcoming: 'upcoming' };
                container.innerHTML = `<p style="color: var(--color-text-tertiary); font-style: italic;">No ${labels[this.currentFilter] || ''} assignments right now.</p>`;
                return;
            }

            // Preload shared data
            const allClasses = await db.classes.toArray();
            const classMap = new Map(allClasses.map(c => [c.id, c]));
            const allCheckpoints = await db.checkpoints.toArray();
            const allCompletions = await db.checkpointCompletions.toArray();
            const allTeams = excludeDeleted(await db.teams.toArray());
            const allTeamMembers = await db.teamMembers.toArray();
            const allStudents = excludeDeleted(await db.students.toArray()).filter(s => (s.status || 'active') === 'active');
            const studentMap = new Map(allStudents.map(s => [s.id, s]));
            const allEnrollments = await db.enrollments.toArray();
            const periodMap = await db.settings.get('period-year-map');
            const classPeriodsMap = periodMap?.value || {};

            // Sort by class then name
            activities.sort((a, b) => {
                const classA = classMap.get(a.classId)?.name || '';
                const classB = classMap.get(b.classId)?.name || '';
                if (classA !== classB) return classA.localeCompare(classB);
                return (a.name || '').localeCompare(b.name || '');
            });

            const isUpcoming = this.currentFilter === 'upcoming';
            const isPast = this.currentFilter === 'past';
            let html = '';

            for (const activity of activities) {
                const cls = classMap.get(activity.classId);
                const className = cls ? escapeHtml(cls.name) : 'Unknown Class';
                const activityId = activity.id;

                // Day progress bar logic
                let dayPercent, dayLabel, dayBarColor;

                if (isPast) {
                    dayPercent = 100;
                    dayLabel = 'Complete';
                    dayBarColor = 'var(--color-success)';
                } else if (isUpcoming) {
                    dayPercent = 0;
                    const startParts = activity.startDate.split('-');
                    const startDate = new Date(startParts[0], startParts[1] - 1, startParts[2]);
                    const formatted = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    dayLabel = `Starts ${formatted}`;
                    dayBarColor = 'var(--color-text-tertiary)';
                } else {
                    const dayPos = getSchoolDayPosition(todayStr, activity.startDate, activity.endDate, niDays);
                    dayPercent = dayPos ? Math.round((dayPos.currentDay / dayPos.totalDays) * 100) : 0;
                    dayLabel = dayPos ? `Day ${dayPos.currentDay} of ${dayPos.totalDays}` : '';
                    dayBarColor = 'var(--color-info)';
                    if (dayPercent > 90) dayBarColor = 'var(--color-error)';
                    else if (dayPercent > 75) dayBarColor = 'var(--color-warning)';
                }

                // Build expand section for active and past (not upcoming)
                let expandSection = '';
                if (!isUpcoming) {
                    const checkpoints = allCheckpoints.filter(cp => cp.activityId === activity.id).sort((a, b) => a.number - b.number);
                    const totalCps = checkpoints.length;

                    const periodsForClass = Object.entries(classPeriodsMap)
                        .filter(([period, cId]) => parseInt(cId) === activity.classId)
                        .map(([period]) => period);

                    const enrolledStudentIds = [...new Set(
                        allEnrollments
                            .filter(e => periodsForClass.includes(String(e.period)) && (!e.schoolYear || e.schoolYear === activeYear))
                            .map(e => e.studentId)
                    )].filter(sid => studentMap.has(sid));

                    const classTeams = allTeams.filter(t => t.classId === activity.classId);
                    const teamsData = [];
                    const studentsOnTeams = new Set();

                    for (const team of classTeams) {
                        const memberIds = allTeamMembers
                            .filter(tm => tm.teamId === team.id)
                            .map(tm => tm.studentId)
                            .filter(sid => enrolledStudentIds.includes(sid) && studentMap.has(sid));

                        if (memberIds.length === 0) continue;
                        memberIds.forEach(sid => studentsOnTeams.add(sid));

                        let teamCompletedCps = 0;
                        const memberProgress = [];

                        for (const sid of memberIds) {
                            const student = studentMap.get(sid);
                            let studentCompleted = 0;
                            for (const cp of checkpoints) {
                                const done = allCompletions.some(c => c.checkpointId === cp.id && c.studentId === sid && c.completed);
                                if (done) studentCompleted++;
                            }
                            memberProgress.push({ student, completed: studentCompleted });
                        }

                        for (const cp of checkpoints) {
                            const allDone = memberIds.every(sid =>
                                allCompletions.some(c => c.checkpointId === cp.id && c.studentId === sid && c.completed)
                            );
                            if (allDone) teamCompletedCps++;
                        }

                        memberProgress.sort((a, b) => sortByStudentName(a.student, b.student));
                        teamsData.push({ team, memberIds, teamCompletedCps, memberProgress });
                    }

                    const unaffiliatedIds = enrolledStudentIds.filter(sid => !studentsOnTeams.has(sid));
                    const unaffiliatedProgress = [];
                    for (const sid of unaffiliatedIds) {
                        const student = studentMap.get(sid);
                        if (!student) continue;
                        let studentCompleted = 0;
                        for (const cp of checkpoints) {
                            const done = allCompletions.some(c => c.checkpointId === cp.id && c.studentId === sid && c.completed);
                            if (done) studentCompleted++;
                        }
                        unaffiliatedProgress.push({ student, completed: studentCompleted });
                    }
                    unaffiliatedProgress.sort((a, b) => sortByStudentName(a.student, b.student));

                    expandSection = `
                    <div id="act-assign-expand-${activityId}" style="display: none; margin-top: var(--space-sm); padding-left: 24px;">
                        ${this._renderProgressLevel2(teamsData, unaffiliatedProgress, totalCps, activityId)}
                    </div>`;
                }

                // Chevron + click only for active/past
                const chevronHtml = !isUpcoming
                    ? `<span id="act-assign-chevron-${activityId}" style="font-size: 0.8em; color: var(--color-text-tertiary); transition: transform 0.2s; width: 16px;">▶</span>`
                    : `<span style="width: 16px;"></span>`;

                const clickAttr = !isUpcoming
                    ? `cursor: pointer;" onclick="pages.activities.toggleProgressExpand(${activityId})`
                    : `cursor: default;`;

                html += `
                <div class="card" style="margin-bottom: var(--space-sm); padding: var(--space-sm) var(--space-base);">
                    <div style="display: flex; align-items: center; gap: var(--space-sm); ${clickAttr}">
                        ${chevronHtml}
                        <div style="flex: 1; min-width: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-sm);">
                                <strong style="font-size: var(--font-size-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(activity.name)}</strong>
                                <span style="font-size: var(--font-size-body-small); color: var(--color-text-tertiary); white-space: nowrap;">${className}</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: var(--space-sm); margin-top: 4px;">
                                <div style="flex: 1; height: 6px; background: var(--color-background-secondary); border-radius: 3px; overflow: hidden;">
                                    <div style="width: ${dayPercent}%; height: 100%; background: ${dayBarColor}; border-radius: 3px; transition: width 0.3s;"></div>
                                </div>
                                <span style="font-size: 11px; color: var(--color-text-tertiary); white-space: nowrap;">${dayLabel}</span>
                            </div>
                        </div>
                    </div>
                    ${expandSection}
                </div>`;
            }

            container.innerHTML = html;

        } catch (err) {
            console.error('Error loading assignment progress cards:', err);
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">Could not load assignment progress.</p>';
        }
    },

    _renderProgressLevel2: function(teamsData, unaffiliatedProgress, totalCps, activityId) {
        let html = '';

        for (const td of teamsData) {
            const teamPercent = totalCps > 0 ? Math.round((td.teamCompletedCps / totalCps) * 100) : 0;
            const teamId = td.team.id;

            html += `
            <div style="margin-bottom: var(--space-xs);">
                <div style="display: flex; align-items: center; gap: var(--space-sm); cursor: pointer; padding: 4px 0;"
                      onclick="pages.activities.toggleProgressTeamExpand(${activityId}, ${teamId})">
                    <span id="act-team-chevron-${activityId}-${teamId}" style="font-size: 0.7em; color: var(--color-text-tertiary); width: 14px;">▶</span>
                    <span style="font-size: var(--font-size-body-small); font-weight: 500; min-width: 80px;">${escapeHtml(td.team.name)}</span>
                    <div style="flex: 1; height: 5px; background: var(--color-background-secondary); border-radius: 3px; overflow: hidden;">
                        <div style="width: ${teamPercent}%; height: 100%; background: var(--color-primary); border-radius: 3px;"></div>
                    </div>
                    <span style="font-size: 11px; color: var(--color-text-tertiary); white-space: nowrap;">${td.teamCompletedCps}/${totalCps}</span>
                </div>

                <div id="act-team-expand-${activityId}-${teamId}" style="display: none; padding-left: 22px;">
                    ${td.memberProgress.map(mp => {
                        const pct = totalCps > 0 ? Math.round((mp.completed / totalCps) * 100) : 0;
                        return `
                        <div style="display: flex; align-items: center; gap: var(--space-sm); padding: 2px 0;">
                            <span style="font-size: var(--font-size-body-small); width: 100px; flex-shrink: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(displayName(mp.student))}</span>
                            <div style="flex: 1; height: 4px; background: var(--color-background-secondary); border-radius: 2px; overflow: hidden;">
                                <div style="width: ${pct}%; height: 100%; background: var(--color-success); border-radius: 2px;"></div>
                            </div>
                            <span style="font-size: 10px; color: var(--color-text-tertiary); white-space: nowrap;">${mp.completed}/${totalCps}</span>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        if (unaffiliatedProgress.length > 0) {
            html += `<div style="margin-top: var(--space-xs); padding-top: var(--space-xs); border-top: 1px solid var(--color-border);">
                <div style="font-size: var(--font-size-body-small); font-weight: 500; color: var(--color-text-secondary); margin-bottom: 4px;">Individual Students</div>`;

            for (const sp of unaffiliatedProgress) {
                const pct = totalCps > 0 ? Math.round((sp.completed / totalCps) * 100) : 0;
                html += `
                <div style="display: flex; align-items: center; gap: var(--space-sm); padding: 2px 0;">
                    <span style="font-size: var(--font-size-body-small); width: 100px; flex-shrink: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(displayName(sp.student))}</span>
                    <div style="flex: 1; height: 4px; background: var(--color-background-secondary); border-radius: 2px; overflow: hidden;">
                        <div style="width: ${pct}%; height: 100%; background: var(--color-success); border-radius: 2px;"></div>
                    </div>
                    <span style="font-size: 10px; color: var(--color-text-tertiary); white-space: nowrap;">${sp.completed}/${totalCps}</span>
                </div>`;
            }

            html += `</div>`;
        }

        if (html === '') {
            html = '<p style="font-size: var(--font-size-body-small); color: var(--color-text-tertiary); font-style: italic;">No teams or students found for this assignment.</p>';
        }

        return html;
    },

    toggleProgressExpand: function(activityId) {
        const expandEl = document.getElementById(`act-assign-expand-${activityId}`);
        const chevron = document.getElementById(`act-assign-chevron-${activityId}`);
        if (!expandEl) return;
        const isHidden = expandEl.style.display === 'none';
        expandEl.style.display = isHidden ? '' : 'none';
        if (chevron) chevron.textContent = isHidden ? '▼' : '▶';
    },

    toggleProgressSection: function() {
        const cards = document.getElementById('activities-progress-cards');
        const btn = document.getElementById('activities-progress-toggle');
        if (!cards || !btn) return;
        const isHidden = cards.style.display === 'none';
        cards.style.display = isHidden ? '' : 'none';
        btn.textContent = isHidden ? 'Minimize' : 'Expand';
    },

    toggleProgressTeamExpand: function(activityId, teamId) {
        const expandEl = document.getElementById(`act-team-expand-${activityId}-${teamId}`);
        const chevron = document.getElementById(`act-team-chevron-${activityId}-${teamId}`);
        if (!expandEl) return;
        const isHidden = expandEl.style.display === 'none';
        expandEl.style.display = isHidden ? '' : 'none';
        if (chevron) chevron.textContent = isHidden ? '▼' : '▶';
    },
    
    deleteActivity: async function(id) {
        try {
            const activity = await db.activities.get(id);
            if (!activity) return;

            await db.activities.update(id, { deletedAt: new Date().toISOString() });
            driveSync.markDirty(); await logAction('delete', 'activity', id, `Deleted assignment ${activity.name}`);
            this.render();

            ui.showUndoToast(`Assignment "${activity.name}" deleted`, async () => {
                await db.activities.update(id, { deletedAt: null });
                driveSync.markDirty(); await logAction('undo', 'activity', id, `Undid delete of assignment ${activity.name}`);
                this.render();
            });
        } catch (error) {
            console.error('Error deleting assignment:', error);
            ui.showToast('Failed to delete assignment', 'error');
        }
    },
};

// ----------------------------------------
// ACTIVITY EDIT PAGE
// ----------------------------------------
pages.activityEdit = {
    _data: null,
    _materials: [],
    _formFor: null,      // EP24: the record this form was opened for (set by render)
    _renderToken: 0,     // EP24: lets an older, slower render know it was replaced

    render: async function(activityId) {
        const renderToken = ++this._renderToken;
        this._formFor = null; // EP24: saving is blocked until this render finishes
        this._data = {};
        this._materials = [];

        // Helper: safely set a property on an element by ID (no-op if missing).
        function safeSet(id, prop, val) {
            const el = document.getElementById(id);
            if (el) {
                el[prop] = val;
            } else {
                console.warn(`safeSet: element not found: ${id}`);
            }
        }

        // Helper: hides an element by ID. style.display can't be written as a dotted path.
        function safeHide(id) {
            const el = document.getElementById(id);
            if (el) {
                el.style.display = 'none';
            } else {
                console.warn(`safeHide: element not found: ${id}`);
            }
        }

        // Clears the Classroom section back to "Not linked". Used for create AND edit (plan row 1-11, FF11):
        // before, edit mode kept the previous assignment's course and coursework selected, so Save could
        // link this assignment to the other one's Classroom coursework.
        function resetClassroomSection() {
            safeSet('fe-classroom-course', 'innerHTML', '<option value="">Not linked</option>');
            safeHide('fe-cw-group');
            // Reset all Classroom sub-fields
            safeHide('fe-topic-group');
            safeHide('fe-publish-group');
            safeHide('fe-grade-cat-group');
            safeHide('fe-assignees-group');
            safeHide('fe-materials-group');
            safeHide('fe-rubric-sync-group');
            safeSet('fe-classroom-cw', 'innerHTML', '<option value="">Select assignment...</option>');
            safeSet('fe-classroom-topic', 'innerHTML', '<option value="">No topic</option>');
            safeSet('fe-student-checklist', 'innerHTML', '');
            safeSet('fe-materials-list', 'innerHTML', '');
            safeSet('fe-sync-rubric', 'checked', false);
            safeSet('fe-classroom-max-points', 'value', '100');
            const publishRadio = document.querySelector('input[name="fe-publish-mode"][value="PUBLISHED"]');
            if (publishRadio) publishRadio.checked = true;
            const assigneeRadio = document.querySelector('input[name="fe-assignee-mode"][value="ALL_STUDENTS"]');
            if (assigneeRadio) assigneeRadio.checked = true;
        }

        // Populate class dropdown
        const classes = await db.classes.toArray();
        if (renderToken !== this._renderToken) return; // EP24: a newer open replaced this one
        const classSelect = document.getElementById('fe-class-id');
        classSelect.innerHTML = '<option value="">Select Class...</option>';
        classes.forEach(c => {
            classSelect.innerHTML += `<option value="${c.id}">${escapeHtml(c.name)}</option>`;
        });

        // Populate standards checkboxes
        const standards = await db.standards.toArray();
        if (renderToken !== this._renderToken) return; // EP24
        const standardsDiv = document.getElementById('fe-standards-checkboxes');
        standardsDiv.innerHTML = standards.length === 0 ? '<p class="form-helper">No standards defined</p>' :
            standards.map(s => `<label style="display: block; padding: 2px 0;"><input type="checkbox" value="${s.id}" class="fe-standard-cb"> ${escapeHtml(s.code)} — ${escapeHtml(s.description)}</label>`).join('');

        // Populate skills checkboxes (retired and merged-away skills are hidden, P16 C3)
        const skills = await getVisibleSkills();
        if (renderToken !== this._renderToken) return; // EP24
        const skillsDiv = document.getElementById('fe-skills-checkboxes');
        skillsDiv.innerHTML = skills.length === 0 ? '<p class="form-helper">No skills defined</p>' :
            skills.map(s => `<label style="display: block; padding: 2px 0;"><input type="checkbox" value="${s.id}" class="fe-skill-cb"> ${escapeHtml(s.name)}</label>`).join('');

        if (activityId) {
            // --- EDIT MODE ---
            document.getElementById('activity-edit-title').textContent = 'Edit Assignment';
            // Start the Classroom section clean; this assignment's own links load below (FF11)
            resetClassroomSection();
            const activity = await db.activities.get(activityId);
            if (renderToken !== this._renderToken) return; // EP24
            if (!activity) { router.navigate('activities'); return; }
            this._data.activity = activity;

            // Populate fields
            document.getElementById('fe-name').value = activity.name || '';
            document.getElementById('fe-description').value = activity.description || '';
            document.getElementById('fe-class-id').value = activity.classId || '';
            document.getElementById('fe-start-date').value = activity.startDate || '';
            document.getElementById('fe-end-date').value = activity.endDate || '';
            safeSet('fe-scoring-type', 'value', activity.scoringType || 'complete-incomplete');
            safeSet('fe-points', 'value', activity.defaultPoints || '');
            // Keep Classroom Max Points in sync with the saved defaultPoints value
            const feMaxPts = document.getElementById('fe-classroom-max-points');
            if (feMaxPts) feMaxPts.value = activity.defaultPoints || 100;
            document.getElementById('fe-form-url').value = activity.formUrl || '';
            document.getElementById('fe-form-spreadsheet').value = activity.formSpreadsheetId || '';

            if (activity.assignmentTypeId) {
                safeSet('fe-type-select', 'value', activity.assignmentTypeId);
            }

            // Scoring field visibility
            this.toggleScoringFields();

            // Rubric levels + criteria
            if (activity.rubric) {
                safeSet('fe-rubric-levels', 'value', (activity.rubric.levels || []).join(', '));
                const criteriaDiv = document.getElementById('fe-rubric-criteria');
                if (criteriaDiv) {
                    criteriaDiv.innerHTML = '';
                    (activity.rubric.criteria || []).forEach(c => this.addRubricCriterion(c.name));
                }
            }

            // Checkpoint grade weight
            if (activity.checkpointGradeWeight > 0) {
                safeSet('fe-cp-weight', 'value', activity.checkpointGradeWeight);
                safeSet('fe-cp-weight-display', 'textContent', activity.checkpointGradeWeight + '%');
            }
            if (activity.checkpointGradeMode === 'timeliness') {
                const radio = document.querySelector('input[name="fe-cp-grade-mode"][value="timeliness"]');
                if (radio) radio.checked = true;
            }

            // Load checkpoints
            const checkpoints = await db.checkpoints.where('activityId').equals(activityId).toArray();
            if (renderToken !== this._renderToken) return; // EP24
            checkpoints.sort((a, b) => a.number - b.number);
            this._data.checkpoints = checkpoints;
            this.renderCheckpoints(checkpoints);

            // Check linked standards
            const linkedStandards = await db.activityStandards.where('activityId').equals(activityId).toArray();
            if (renderToken !== this._renderToken) return; // EP24
            linkedStandards.forEach(ls => {
                const cb = standardsDiv.querySelector(`input[value="${ls.standardId}"]`);
                if (cb) cb.checked = true;
            });

            // Check linked skills
            const linkedSkills = await getLiveSkillLinks(activityId);
            if (renderToken !== this._renderToken) return; // EP24
            linkedSkills.forEach(ls => {
                const cb = skillsDiv.querySelector(`input[value="${ls.skillId}"]`);
                if (cb) cb.checked = true;
            });

            // Classroom links
            state._classroomLinksTemp = activity.classroomLinks || {};
            state._classroomPendingCreate = {};

            // Load saved materials (Sprint 11.5.3)
            this._materials = activity.materials || [];
            this.renderMaterialsList();

            // Load Student Guide fields (Sprint 17)
            document.getElementById('fe-student-guide-text').value = activity.studentGuideText || '';
            document.getElementById('fe-site-page-url').value = activity.sitePageUrl || '';
            this._resourceLinks = activity.resourceLinks || [];
            this.renderResourceLinks();

            // Load Activity Guide fields
            document.getElementById('fe-unit').value = activity.unit || '';
            document.getElementById('fe-lesson').value = activity.lesson || '';
            document.getElementById('fe-activity-type').value = activity.activityType || '';
            document.getElementById('fe-phase').value = activity.phase || '';
            document.getElementById('fe-scaffolding').value = activity.scaffoldingLevel || '';
            document.getElementById('fe-class-periods').value = activity.classPeriods || '';

            this._learningGoals = activity.learningGoals || [];
            this.renderLearningGoals();
            this._fusionGoals = activity.fusionGoals || [];
            this.renderFusionGoals();

            this._requiredTools = activity.requiredTools || [];
            this.renderRequiredTools();
            this._requiredMaterials = activity.requiredMaterials || [];
            this.renderRequiredMaterials();

            document.getElementById('fe-slides-url').value = activity.slidesUrl || '';
            this._instructionSteps = activity.instructionSteps || [];
            this.renderInstructionSteps();

            document.getElementById('fe-get-ready-time').value = activity.getReadyTime || '';
            this._getReadyTasks = activity.getReadyTasks || [];
            this.renderGetReadyTasks();
            document.getElementById('fe-get-ready-role-tasks').value = activity.getReadyRoleTasks || '';

            this._conclusionQuestions = activity.conclusionQuestions || [];
            this.renderConclusionQuestions();
            document.getElementById('fe-conclusion-method').value = activity.conclusionSubmissionMethod || '';
            this._assessmentQuestions = activity.assessmentQuestions || [];
            this.renderAssessmentQuestions();

            this._documentationChecklist = activity.documentationChecklist || [];
            this.renderDocumentationChecklist();

            this._appendixItems = activity.appendixItems || [];
            this.renderAppendixItems();

            // Contract Brief fields
            document.getElementById('fe-contract-code').value = activity.contractCode || '';
            document.getElementById('fe-contract-client').value = activity.contractBrief?.clientName || '';
            document.getElementById('fe-contract-problem').value = activity.contractBrief?.problemStatement || '';
            // A guide can store these as plain text instead of a list; show it as one item instead of crashing (X36, plan row 1-12)
            const asList = v => Array.isArray(v) ? v : (v == null || v === '' ? [] : [String(v)]);
            this._contractConstraints = asList(activity.contractBrief?.constraints);
            this.renderContractConstraints();
            this._contractDeliverables = asList(activity.contractBrief?.deliverables);
            this.renderContractDeliverables();

            // Certifications
            this._certsRequired = activity.certificationsRequired || [];
            this.renderCertsRequired();
            this._certsAvailable = activity.certificationsAvailable || [];
            this.renderCertsAvailable();

            // Portfolio Prompts
            this._portfolioPrompts = activity.portfolioPrompts || [];
            this.renderPortfolioPrompts();

            // Pacing Milestones
            document.getElementById('fe-pacing-ahead').value = activity.pacingMilestones?.ahead || '';
            document.getElementById('fe-pacing-on-time').value = activity.pacingMilestones?.onTime || '';
            document.getElementById('fe-pacing-behind').value = activity.pacingMilestones?.behind || '';

            // WebXam Coverage
            this._webxamCoverage = activity.webxamCoverage || [];
            this.renderWebxamCoverage();

            // Hub sync status
            const syncStatusEl = document.getElementById('hub-sync-status');
            if (syncStatusEl) {
                syncStatusEl.textContent = activity.lastHubSync
                    ? 'Last synced: ' + new Date(activity.lastHubSync).toLocaleString()
                    : 'Not synced yet';
            }
            if (activity.lastHubSync) {
                pages.activityEdit.updateWidgetUrls();
            }

            // Update section summaries
            this.updateAllSummaries();

            // Show the checkpoint grading section if checkpoints exist
            const cpGradingSection = document.getElementById('fe-cp-grading-section');
            if (cpGradingSection) cpGradingSection.style.display = checkpoints.length > 0 ? '' : 'none';

        } else {
            // --- CREATE MODE ---
            document.getElementById('activity-edit-title').textContent = 'Create Assignment';
            this._data.activity = null;

            // Helper: sets a property on an element by ID, logs a warning if the element is missing.
            // Prevents one missing ID from silently aborting the rest of the reset block.
            function safeSet(id, prop, val) {
                const el = document.getElementById(id);
                if (el) {
                    el[prop] = val;
                } else {
                    console.warn(`safeSet: element not found: ${id}`);
                }
            }

            // Helper: hides an element by ID. Separate from safeSet because
            // style.display can't be written as a dotted property path.
            function safeHide(id) {
                const el = document.getElementById(id);
                if (el) {
                    el.style.display = 'none';
                } else {
                    console.warn(`safeHide: element not found: ${id}`);
                }
            }

            // Clear all fields
            safeSet('fe-name', 'value', '');
            safeSet('fe-description', 'value', '');
            safeSet('fe-class-id', 'value', '');
            safeSet('fe-start-date', 'value', '');
            safeSet('fe-end-date', 'value', '');
            safeSet('fe-scoring-type', 'value', 'complete-incomplete');
            safeSet('fe-points', 'value', '');
            safeSet('fe-form-url', 'value', '');
            safeSet('fe-form-spreadsheet', 'value', '');
            safeSet('fe-rubric-criteria', 'innerHTML', '');
            safeSet('fe-checkpoints-list', 'innerHTML', '');
            safeSet('fe-cp-weight', 'value', 0);
            safeSet('fe-cp-weight-display', 'textContent', '0%');
            safeHide('fe-cp-grading-section');

            state._classroomLinksTemp = {};
            state._classroomPendingCreate = {};
            this._data.checkpoints = [];
            this._materials = [];
            this._resourceLinks = [];
            safeSet('fe-student-guide-text', 'value', '');
            safeSet('fe-site-page-url', 'value', '');
            document.getElementById('fe-resource-links-list').innerHTML = '';
            safeSet('hub-sync-status', 'textContent', 'Not synced yet');

            // Reset Activity Guide fields
            safeSet('fe-unit', 'value', '');
            safeSet('fe-lesson', 'value', '');
            safeSet('fe-activity-type', 'value', '');
            safeSet('fe-phase', 'value', '');
            safeSet('fe-scaffolding', 'value', '');
            safeSet('fe-class-periods', 'value', '');

            this._learningGoals = [];
            document.getElementById('fe-learning-goals-list').innerHTML = '';
            this._fusionGoals = [];
            document.getElementById('fe-fusion-goals-list').innerHTML = '';

            this._requiredTools = [];
            document.getElementById('fe-required-tools-list').innerHTML = '';
            this._requiredMaterials = [];
            document.getElementById('fe-required-materials-list').innerHTML = '';

            safeSet('fe-slides-url', 'value', '');
            this._instructionSteps = [];
            document.getElementById('fe-instruction-steps-list').innerHTML = '';

            safeSet('fe-get-ready-time', 'value', '');
            this._getReadyTasks = [];
            document.getElementById('fe-get-ready-tasks-list').innerHTML = '';
            safeSet('fe-get-ready-role-tasks', 'value', '');

            this._conclusionQuestions = [];
            document.getElementById('fe-conclusion-questions-list').innerHTML = '';
            safeSet('fe-conclusion-method', 'value', '');
            this._assessmentQuestions = [];
            document.getElementById('fe-assessment-questions-list').innerHTML = '';

            this._documentationChecklist = [];
            document.getElementById('fe-documentation-checklist-list').innerHTML = '';

            this._appendixItems = [];
            document.getElementById('fe-appendix-items-list').innerHTML = '';

            // Reset Contract Brief fields
            safeSet('fe-contract-code', 'value', '');
            safeSet('fe-contract-client', 'value', '');
            safeSet('fe-contract-problem', 'value', '');
            this._contractConstraints = [];
            document.getElementById('fe-contract-constraints-list').innerHTML = '';
            this._contractDeliverables = [];
            document.getElementById('fe-contract-deliverables-list').innerHTML = '';

            // Reset Certifications
            this._certsRequired = [];
            document.getElementById('fe-certs-required-list').innerHTML = '';
            this._certsAvailable = [];
            document.getElementById('fe-certs-available-list').innerHTML = '';

            // Reset Portfolio Prompts
            this._portfolioPrompts = [];
            document.getElementById('fe-portfolio-prompts-list').innerHTML = '';

            // Reset Pacing Milestones
            safeSet('fe-pacing-ahead', 'value', '');
            safeSet('fe-pacing-on-time', 'value', '');
            safeSet('fe-pacing-behind', 'value', '');

            // Reset WebXam Coverage
            this._webxamCoverage = [];
            document.getElementById('fe-webxam-coverage-list').innerHTML = '';

            this.toggleScoringFields();

            // Uncheck all standards/skills
            standardsDiv.querySelectorAll('input').forEach(cb => cb.checked = false);
            skillsDiv.querySelectorAll('input').forEach(cb => cb.checked = false);

            // Reset Classroom section
            resetClassroomSection();
            this.updateAllSummaries();
        }

        // Collapse all sections except Basic Info
        document.querySelectorAll('.edit-section').forEach(section => {
            if (section.id === 'edit-section-basic') {
                section.classList.add('edit-section--open');
                section.querySelector('.edit-section__body').style.display = '';
            } else if (section.style.display !== 'none') {
                section.classList.remove('edit-section--open');
                section.querySelector('.edit-section__body').style.display = 'none';
            }
        });

        // EP24: if a newer open replaced this one while it loaded, the screen may be mixed. Block saving.
        if (renderToken !== this._renderToken) {
            this._formFor = null;
            return;
        }
        // EP24: create vs edit is decided here, and the form remembers exactly which record it shows.
        this._formFor = activityId
            ? { mode: 'edit', id: this._data.activity.id, name: this._data.activity.name, contractCode: this._data.activity.contractCode || null }
            : { mode: 'create' };

        // If editing and has Classroom links, auto-expand that section
        if (activityId) {
            const activity = this._data.activity;
            if (activity.classroomLinks && Object.keys(activity.classroomLinks).length > 0) {
                this.expandSection('classroom');
            }
        }
    },

    toggleSection: function(sectionName) {
        const section = document.getElementById('edit-section-' + sectionName);
        if (!section) return;
        const body = section.querySelector('.edit-section__body');
        const isOpen = section.classList.contains('edit-section--open');

        if (isOpen) {
            section.classList.remove('edit-section--open');
            body.style.display = 'none';
        } else {
            section.classList.add('edit-section--open');
            body.style.display = '';
        }
    },

    expandSection: function(sectionName) {
        const section = document.getElementById('edit-section-' + sectionName);
        if (!section) return;
        section.classList.add('edit-section--open');
        section.querySelector('.edit-section__body').style.display = '';
    },

    updateAllSummaries: function() {
        const scoringType = document.getElementById('fe-scoring-type')?.value || '';
        const points = document.getElementById('fe-points')?.value || '';
        const endDate = document.getElementById('fe-end-date')?.value || '';
        const ptsLabel = points ? ` · ${points} pts` : '';
        let scoringSummary = scoringType === 'points' ? `Points${points ? ` · ${points} pts` : ' · ? pts'}` :
                            scoringType === 'rubric' ? `Rubric${ptsLabel}` :
                            `Complete/Incomplete${ptsLabel}`;
        if (endDate) scoringSummary += ` · Due ${endDate}`;
        document.getElementById('edit-summary-scoring').textContent = scoringSummary;

        const cpCount = document.getElementById('fe-checkpoints-list').children.length;
        document.getElementById('edit-summary-checkpoints').textContent =
            cpCount > 0 ? `${cpCount} checkpoint${cpCount !== 1 ? 's' : ''}` : 'No checkpoints';

        const linkCount = Object.keys(state._classroomLinksTemp || {}).length;
        const pendingCount = Object.keys(state._classroomPendingCreate || {}).length;
        if (linkCount > 0 || pendingCount > 0) {
            document.getElementById('edit-summary-classroom').textContent = `Linked to ${linkCount + pendingCount} course${(linkCount + pendingCount) !== 1 ? 's' : ''}`;
        } else {
            document.getElementById('edit-summary-classroom').textContent = 'Not linked';
        }

        const skillCount = document.querySelectorAll('.fe-skill-cb:checked').length;
        const standardCount = document.querySelectorAll('.fe-standard-cb:checked').length;
        const parts = [];
        if (skillCount > 0) parts.push(`${skillCount} skill${skillCount !== 1 ? 's' : ''}`);
        if (standardCount > 0) parts.push(`${standardCount} standard${standardCount !== 1 ? 's' : ''}`);
        document.getElementById('edit-summary-skills').textContent = parts.length > 0 ? parts.join(', ') : 'None linked';

        // Activity Guide summary
        const guideParts = [];
        const goalCount = (this._learningGoals || []).length;
        if (goalCount > 0) guideParts.push(`${goalCount} goal${goalCount !== 1 ? 's' : ''}`);
        const matCount = (this._requiredMaterials || []).length + (this._requiredTools || []).length;
        if (matCount > 0) guideParts.push(`${matCount} material${matCount !== 1 ? 's' : ''}`);
        const aqCount = (this._assessmentQuestions || []).length;
        if (aqCount > 0) guideParts.push(`${aqCount} assessment Q${aqCount !== 1 ? 's' : ''}`);
        const apxCount = (this._appendixItems || []).length;
        if (apxCount > 0) guideParts.push(`${apxCount} appendix`);
        document.getElementById('edit-summary-student-guide').textContent =
            guideParts.length > 0 ? guideParts.join(', ') : 'Not configured';
    },

    toggleScoringFields: function() {
        const typeEl = document.getElementById('fe-scoring-type');
        if (!typeEl) return;
        const type = typeEl.value;
        // Total Points is always visible — it's the Classroom max-points value for every scoring type
        const pointsGroup = document.getElementById('fe-points-group');
        if (pointsGroup) pointsGroup.style.display = '';
        const rubricGroup = document.getElementById('fe-rubric-group');
        if (rubricGroup) rubricGroup.style.display = type === 'rubric' ? '' : 'none';
    },

    // Keep fe-points and fe-classroom-max-points in sync — they represent the same value.
    // activity.defaultPoints (from fe-points) is the single source of truth on save.
    syncPointsToMaxPoints: function() {
        const val = document.getElementById('fe-points').value;
        const maxPtsEl = document.getElementById('fe-classroom-max-points');
        if (maxPtsEl && val) maxPtsEl.value = val;
        this.updateAllSummaries();
    },

    syncMaxPointsToPoints: function() {
        const val = document.getElementById('fe-classroom-max-points').value;
        const pointsEl = document.getElementById('fe-points');
        if (pointsEl && val) pointsEl.value = val;
        this.updateAllSummaries();
    },

    addRubricCriterion: function(name) {
        const div = document.getElementById('fe-rubric-criteria');
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; gap: var(--space-sm); align-items: center; margin-bottom: var(--space-xs);';
        row.innerHTML = `
            <input type="text" class="form-input fe-rubric-criterion-name" value="${escapeHtml(name || '')}" placeholder="Criterion name" style="flex: 1;">
            <button type="button" class="btn btn--secondary" style="padding: 4px 8px;" onclick="this.parentElement.remove()">✕</button>
        `;
        div.appendChild(row);
    },

    renderCheckpoints: function(checkpoints) {
        const list = document.getElementById('fe-checkpoints-list');
        list.innerHTML = '';
        (checkpoints || []).forEach((cp, idx) => {
            this.addCheckpointRow(cp, idx);
        });
    },

    addCheckpoint: function() {
        const list = document.getElementById('fe-checkpoints-list');
        const nextNum = list.children.length + 1;
        this.addCheckpointRow({ number: nextNum, title: '', description: '', suggestedDate: '' });
        document.getElementById('fe-cp-grading-section').style.display = '';
    },

    addCheckpointRow: function(cp, idx) {
        const list = document.getElementById('fe-checkpoints-list');
        const row = document.createElement('div');
        row.className = 'fe-checkpoint-row';
        row.style.cssText = 'border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-sm); margin-bottom: var(--space-sm);';
        row.dataset.cpId = cp.id || '';

        const qaPairsHtml = (cp.questions || []).map(qa => `
            <div class="checkpoint-qa-row" style="display: grid; grid-template-columns: 1fr 1fr auto; gap: var(--space-xs); margin-top: var(--space-xs); align-items: start;">
                <input type="text" class="form-input cp-question" placeholder="Teacher asks/checks..." value="${escapeHtml(qa.question || '')}" style="font-size: var(--font-size-body-small);">
                <input type="text" class="form-input cp-expected-response" placeholder="Student should answer/demo..." value="${escapeHtml(qa.expectedResponse || '')}" style="font-size: var(--font-size-body-small);">
                <button type="button" class="btn--icon" onclick="this.parentElement.remove()" style="color: var(--color-error); font-size: 14px; padding: 4px;">✕</button>
            </div>
        `).join('');

        row.innerHTML = `
            <div style="display: flex; gap: var(--space-sm); align-items: center; margin-bottom: var(--space-xs);">
                <strong style="min-width: 20px;">#${cp.number || (list.children.length + 1)}</strong>
                <input type="text" class="form-input fe-cp-title" value="${escapeHtml(cp.title || '')}" placeholder="Checkpoint title" style="flex: 1;">
                <button type="button" class="btn btn--secondary" style="padding: 4px 8px;" onclick="this.closest('.fe-checkpoint-row').remove(); pages.activityEdit.renumberCheckpoints();">✕</button>
            </div>
            <div style="display: flex; gap: var(--space-sm); margin-bottom: var(--space-xs);">
                <input type="text" class="form-input fe-cp-desc" value="${escapeHtml(cp.description || '')}" placeholder="Description (optional)" style="flex: 1;">
                <input type="date" class="form-input fe-cp-date" value="${cp.suggestedDate || ''}" style="width: 150px;">
            </div>
            <div style="margin-bottom: var(--space-xs);">
                <input type="text" class="form-input fe-cp-milestone" value="${escapeHtml(cp.milestone || '')}" placeholder="Milestone — what this checkpoint means for students (student-facing)" style="font-size: var(--font-size-body-small);">
            </div>
            <div style="margin-bottom: var(--space-xs);">
                <textarea class="form-input fe-cp-lookfor" rows="2" placeholder="Teacher Notes — what to look for when checking this CP (not visible to students)" style="font-size: var(--font-size-body-small);">${escapeHtml(cp.lookFor || '')}</textarea>
            </div>
            <div class="fe-cp-qa-container">${qaPairsHtml}</div>
            <button type="button" class="btn btn--secondary" style="margin-top: var(--space-xs); font-size: var(--font-size-body-small); padding: 4px 8px;" onclick="pages.activityEdit.addQAPair(this.previousElementSibling)">+ Add Q&A Pair</button>
        `;
        list.appendChild(row);
    },

    addQAPair: function(container) {
        const div = document.createElement('div');
        div.className = 'checkpoint-qa-row';
        div.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr auto; gap: var(--space-xs); margin-top: var(--space-xs); align-items: start;';
        div.innerHTML = `
            <input type="text" class="form-input cp-question" placeholder="Teacher asks/checks..." value="" style="font-size: var(--font-size-body-small);">
            <input type="text" class="form-input cp-expected-response" placeholder="Student should answer/demo..." value="" style="font-size: var(--font-size-body-small);">
            <button type="button" class="btn--icon" onclick="this.parentElement.remove()" style="color: var(--color-error); font-size: 14px; padding: 4px;">✕</button>
        `;
        container.appendChild(div);
    },

    renumberCheckpoints: function() {
        const rows = document.querySelectorAll('.fe-checkpoint-row');
        rows.forEach((row, i) => {
            row.querySelector('strong').textContent = '#' + (i + 1);
        });
        if (rows.length === 0) {
            document.getElementById('fe-cp-grading-section').style.display = 'none';
        }
    },

    cancel: function() {
        state.editingActivityId = null;
        state._classroomPendingCreate = {};
        state._classroomLinksTemp = {};
        if (this._data?.activity) {
            state.selectedActivity = this._data.activity.id;
            router.navigate('activity-detail');
        } else {
            router.navigate('activities');
        }
    },
    save: async function() {
        const name = document.getElementById('fe-name').value.trim();
        const description = document.getElementById('fe-description').value.trim();
        const classId = parseInt(document.getElementById('fe-class-id').value);
        const startDate = document.getElementById('fe-start-date').value;
        const endDate = document.getElementById('fe-end-date').value;

        if (!name) { ui.showToast('Assignment name is required', 'error'); return; }
        if (!classId) { ui.showToast('Please select a class', 'error'); return; }
        if (!startDate || !endDate) { ui.showToast('Start and end dates are required', 'error'); return; }
        // The Form fields: a Google Forms link, and the responses sheet's id (a pasted link is fine) (3-02).
        // Checked only when new or changed; an unchanged old value saves as it is (B7).
        const storedForForm = (this._formFor && this._formFor.mode === 'edit' && this._formFor.id) ? await db.activities.get(this._formFor.id) : null;
        const formFields = formImport.cleanFormFields(document.getElementById('fe-form-url').value, document.getElementById('fe-form-spreadsheet').value, storedForForm);
        if (formFields.error) { ui.showToast(formFields.error + ' Nothing was saved.', 'error', 8000); return; }

        // EP24 guard: write only to the record this form was opened for; never fall back to creating.
        const formFor = this._formFor;
        const blocked = (why) => ui.showToast('Save blocked — nothing was saved. ' + why + ' Close this form and open Full Edit again.', 'error', 10000);
        if (!formFor) { blocked('This form did not finish loading.'); return; }
        if (formFor.mode === 'edit') {
            if (!formFor.id) { blocked('The form lost track of which assignment it is editing.'); return; }
            const target = await db.activities.get(formFor.id);
            if (!target || target.name !== formFor.name || (target.contractCode || null) !== formFor.contractCode) {
                console.error('EP24 save blocked: record missing or changed', { formFor, target });
                blocked('The assignment on file no longer matches what this form loaded.');
                return;
            }
            const targetCpIds = new Set((await db.checkpoints.where('activityId').equals(formFor.id).toArray()).map(cp => cp.id));
            const foreignRow = Array.from(document.querySelectorAll('.fe-checkpoint-row'))
                .some(row => { const cpId = parseInt(row.dataset.cpId); return cpId && !targetCpIds.has(cpId); });
            if (foreignRow) {
                console.error('EP24 save blocked: checkpoint rows belong to another assignment', { formFor });
                blocked('The checkpoints on screen belong to a different assignment.');
                return;
            }
        } else if (formFor.mode !== 'create') {
            blocked('Unknown form mode.');
            return;
        }
        try {
            const activityData = {
                name,
                description,
                classId,
                startDate,
                endDate,
                status: 'active',
                scoringType: 'mastery',
                formUrl: formFields.formUrl,
                formSpreadsheetId: formFields.formSpreadsheetId,
                classroomLinks: (function() {
                    const existing = state._classroomLinksTemp || {};
                    const courseId = document.getElementById('fe-classroom-course').value;
                    const cwId = document.getElementById('fe-classroom-cw').value;
                    if (courseId && cwId && cwId !== 'PENDING_CREATE') {
                        existing[courseId] = cwId;
                    }
                    return Object.keys(existing).length > 0 ? existing : null;
            })(),
            materials: this._materials || [],
            studentGuideText: document.getElementById('fe-student-guide-text').value.trim() || null,
            sitePageUrl: document.getElementById('fe-site-page-url').value.trim() || null,
            resourceLinks: this._resourceLinks || [],

            // Activity Guide — Classification
            unit: document.getElementById('fe-unit').value.trim() || null,
            lesson: document.getElementById('fe-lesson').value.trim() || null,
            activityType: document.getElementById('fe-activity-type').value || null,
            phase: document.getElementById('fe-phase').value || null,
            scaffoldingLevel: document.getElementById('fe-scaffolding').value || null,
            classPeriods: document.getElementById('fe-class-periods').value.trim() || null,

            // Activity Guide — Learning Goals
            learningGoals: this._learningGoals || [],
            fusionGoals: this._fusionGoals || [],

            // Activity Guide — Materials & Tools
            requiredTools: this._requiredTools || [],
            requiredMaterials: this._requiredMaterials || [],

            // Activity Guide — Student Instructions
            slidesUrl: document.getElementById('fe-slides-url').value.trim() || null,
            instructionSteps: this._instructionSteps || [],

            // Activity Guide — Get Ready
            getReadyTime: document.getElementById('fe-get-ready-time').value.trim() || null,
            getReadyTasks: this._getReadyTasks || [],
            getReadyRoleTasks: document.getElementById('fe-get-ready-role-tasks').value.trim() || null,

            // Activity Guide — Conclusion & Assessment
            conclusionQuestions: this._conclusionQuestions || [],
            conclusionSubmissionMethod: document.getElementById('fe-conclusion-method').value.trim() || null,
            assessmentQuestions: this._assessmentQuestions || [],

            // Activity Guide — Submission
            documentationChecklist: this._documentationChecklist || [],

            // Activity Guide — Appendix
            appendixItems: this._appendixItems || [],

            // Activity Guide — Contract Brief
            contractCode: document.getElementById('fe-contract-code').value.trim() || null,
            contractBrief: {
                clientName: document.getElementById('fe-contract-client').value.trim() || '',
                problemStatement: document.getElementById('fe-contract-problem').value.trim() || '',
                constraints: this._contractConstraints || [],
                deliverables: this._contractDeliverables || [],
            },

            // Activity Guide — Certifications
            certificationsRequired: this._certsRequired || [],
            certificationsAvailable: this._certsAvailable || [],

            // Activity Guide — Portfolio Prompts
            portfolioPrompts: this._portfolioPrompts || [],

            // Activity Guide — Pacing Milestones (teacher-facing)
            pacingMilestones: {
                ahead: document.getElementById('fe-pacing-ahead').value.trim() || '',
                onTime: document.getElementById('fe-pacing-on-time').value.trim() || '',
                behind: document.getElementById('fe-pacing-behind').value.trim() || '',
            },

            // Activity Guide — WebXam Coverage (teacher-facing)
            webxamCoverage: this._webxamCoverage || [],
        };

            // --- Handle pending Classroom creations ---
            await this._processPendingClassroomCreates(activityData, name, description, endDate);

            // --- Save the activity ---
            let activityId;
            if (formFor.mode === 'edit') {
                activityData.updatedAt = new Date().toISOString();
                await db.activities.update(formFor.id, activityData);
                activityId = formFor.id;
                logAction('update', 'activity', activityId, 'Full edit: ' + name);
            } else {
                activityData.createdAt = new Date().toISOString();
                activityData.updatedAt = activityData.createdAt;
                activityId = await db.activities.add(activityData);
                logAction('create', 'activity', activityId, name);
            }

            // --- Save checkpoints ---
            await this._saveCheckpoints(activityId);

            // --- Save linked standards ---
            await this._saveLinkedStandards(activityId);

            // --- Save linked skills ---
            await this._saveLinkedSkills(activityId);

            if (typeof driveSync !== 'undefined') driveSync.markDirty();
            state._classroomPendingCreate = {};
            state._classroomLinksTemp = {};

            ui.showToast(formFor.mode === 'edit' ? 'Assignment updated' : 'Assignment created', 'success');
            this._formFor = null;
            state.editingActivityId = null;
            state.selectedActivity = activityId;
            router.navigate('activity-detail');

        } catch (err) {
            console.error('Save activity error:', err);
            ui.showToast('Error saving: ' + err.message, 'error');
        }
    },

    // ── Resource Links helpers (Sprint 17) ──
    _resourceLinks: [],

    addResourceLink: function(url, title) {
        this._resourceLinks.push({ url: url || '', title: title || '' });
        this.renderResourceLinks();
    },

    removeResourceLink: function(index) {
        this._resourceLinks.splice(index, 1);
        this.renderResourceLinks();
    },

    renderResourceLinks: function() {
        const container = document.getElementById('fe-resource-links-list');
        if (!container) return;
        container.innerHTML = '';
        this._resourceLinks.forEach((link, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; gap: var(--space-xs); align-items: center; margin-bottom: var(--space-xs);';
            row.innerHTML = `
                <input type="url" class="form-input fe-resource-url" data-index="${i}" placeholder="https://..." value="${escapeHtml(link.url || '')}" style="flex: 2;" onchange="pages.activityEdit._resourceLinks[${i}].url = this.value">
                <input type="text" class="form-input fe-resource-title" data-index="${i}" placeholder="Link title" value="${escapeHtml(link.title || '')}" style="flex: 1;" onchange="pages.activityEdit._resourceLinks[${i}].title = this.value">
                <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.removeResourceLink(${i})">✕</button>
            `;
            container.appendChild(row);
        });
    },

    // ── Learning Goals helpers ──
    _learningGoals: [],

    addLearningGoal: function(val) {
        this._learningGoals.push(val || '');
        this.renderLearningGoals();
    },

    removeLearningGoal: function(index) {
        this._learningGoals.splice(index, 1);
        this.renderLearningGoals();
    },

    renderLearningGoals: function() {
        const container = document.getElementById('fe-learning-goals-list');
        if (!container) return;
        container.innerHTML = '';
        this._learningGoals.forEach((goal, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; gap: var(--space-xs); align-items: center; margin-bottom: var(--space-xs);';
            row.innerHTML = `
                <input type="text" class="form-input" placeholder="e.g., Practice the engineering design process" value="${escapeHtml(goal)}" style="flex: 1;" onchange="pages.activityEdit._learningGoals[${i}] = this.value">
                <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.removeLearningGoal(${i})">✕</button>
            `;
            container.appendChild(row);
        });
    },

    // ── Fusion 360 Goals helpers ──
    _fusionGoals: [],

    addFusionGoal: function(val) {
        this._fusionGoals.push(val || '');
        this.renderFusionGoals();
    },

    removeFusionGoal: function(index) {
        this._fusionGoals.splice(index, 1);
        this.renderFusionGoals();
    },

    renderFusionGoals: function() {
        const container = document.getElementById('fe-fusion-goals-list');
        if (!container) return;
        container.innerHTML = '';
        this._fusionGoals.forEach((goal, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; gap: var(--space-xs); align-items: center; margin-bottom: var(--space-xs);';
            row.innerHTML = `
                <input type="text" class="form-input" placeholder="e.g., Create a fully constrained sketch" value="${escapeHtml(goal)}" style="flex: 1;" onchange="pages.activityEdit._fusionGoals[${i}] = this.value">
                <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.removeFusionGoal(${i})">✕</button>
            `;
            container.appendChild(row);
        });
    },

    // ── Required Tools helpers ──
    _requiredTools: [],

    addRequiredTool: function(name, quantity) {
        this._requiredTools.push({ name: name || '', quantity: quantity || '' });
        this.renderRequiredTools();
    },

    removeRequiredTool: function(index) {
        this._requiredTools.splice(index, 1);
        this.renderRequiredTools();
    },

    renderRequiredTools: function() {
        const container = document.getElementById('fe-required-tools-list');
        if (!container) return;
        container.innerHTML = '';
        this._requiredTools.forEach((tool, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; gap: var(--space-xs); align-items: center; margin-bottom: var(--space-xs);';
            row.innerHTML = `
                <input type="text" class="form-input" placeholder="e.g., Engineering notebook" value="${escapeHtml(tool.name || '')}" style="flex: 2;" onchange="pages.activityEdit._requiredTools[${i}].name = this.value">
                <input type="text" class="form-input" placeholder="e.g., 1 per student" value="${escapeHtml(tool.quantity || '')}" style="flex: 1;" onchange="pages.activityEdit._requiredTools[${i}].quantity = this.value">
                <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.removeRequiredTool(${i})">✕</button>
            `;
            container.appendChild(row);
        });
    },

    // ── Required Materials helpers ──
    _requiredMaterials: [],

    addRequiredMaterial: function(name, quantity) {
        this._requiredMaterials.push({ name: name || '', quantity: quantity || '' });
        this.renderRequiredMaterials();
    },

    removeRequiredMaterial: function(index) {
        this._requiredMaterials.splice(index, 1);
        this.renderRequiredMaterials();
    },

    renderRequiredMaterials: function() {
        const container = document.getElementById('fe-required-materials-list');
        if (!container) return;
        container.innerHTML = '';
        this._requiredMaterials.forEach((mat, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; gap: var(--space-xs); align-items: center; margin-bottom: var(--space-xs);';
            row.innerHTML = `
                <input type="text" class="form-input" placeholder="e.g., Copy paper" value="${escapeHtml(mat.name || '')}" style="flex: 2;" onchange="pages.activityEdit._requiredMaterials[${i}].name = this.value">
                <input type="text" class="form-input" placeholder="e.g., 10 sheets per team" value="${escapeHtml(mat.quantity || '')}" style="flex: 1;" onchange="pages.activityEdit._requiredMaterials[${i}].quantity = this.value">
                <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.removeRequiredMaterial(${i})">✕</button>
            `;
            container.appendChild(row);
        });
    },

    // ── Instruction Steps helpers ──
    _instructionSteps: [],

    addInstructionStep: function() {
        this._instructionSteps.push({
            title: '', time: '', body: '',
            roles: { leader: '', recorder: '', materials: '', timekeeper: '' }
        });
        this.renderInstructionSteps();
    },

    removeInstructionStep: function(index) {
        this._instructionSteps.splice(index, 1);
        this.renderInstructionSteps();
    },

    moveInstructionStep: function(index, delta) {
        const target = index + delta;
        if (target < 0 || target >= this._instructionSteps.length) return;
        const item = this._instructionSteps.splice(index, 1)[0];
        this._instructionSteps.splice(target, 0, item);
        this.renderInstructionSteps();
    },

    renderInstructionSteps: function() {
        const container = document.getElementById('fe-instruction-steps-list');
        if (!container) return;
        container.innerHTML = '';

        this._instructionSteps.forEach((step, i) => {
            if (!step.roles) step.roles = {};
            const row = document.createElement('div');
            row.className = 'card';
            row.style.cssText = 'padding: var(--space-sm); margin-bottom: var(--space-sm);';
            row.innerHTML = `
                <div style="display:flex; gap:var(--space-xs); align-items:center; margin-bottom:var(--space-xs);">
                    <strong style="flex:0 0 auto; color:var(--color-text-muted);">${i + 1}</strong>
                    <input type="text" class="form-input" placeholder="Step title" value="${escapeHtml(step.title || '')}" style="flex:3;"
                        onchange="pages.activityEdit._instructionSteps[${i}].title = this.value">
                    <input type="text" class="form-input" placeholder="e.g., 15 min" value="${escapeHtml(step.time || '')}" style="flex:1;"
                        onchange="pages.activityEdit._instructionSteps[${i}].time = this.value">
                    <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.moveInstructionStep(${i}, -1)">↑</button>
                    <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.moveInstructionStep(${i}, 1)">↓</button>
                    <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.removeInstructionStep(${i})">✕</button>
                </div>
                <textarea class="form-input" rows="3" placeholder="What students do in this step"
                    style="width:100%; margin-bottom:var(--space-xs);"
                    onchange="pages.activityEdit._instructionSteps[${i}].body = this.value">${escapeHtml(step.body || '')}</textarea>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:var(--space-xs);">
                    <input type="text" class="form-input" placeholder="Team Leader — leave blank to hide" value="${escapeHtml(step.roles.leader || '')}"
                        onchange="pages.activityEdit._instructionSteps[${i}].roles.leader = this.value">
                    <input type="text" class="form-input" placeholder="Recorder — leave blank to hide" value="${escapeHtml(step.roles.recorder || '')}"
                        onchange="pages.activityEdit._instructionSteps[${i}].roles.recorder = this.value">
                    <input type="text" class="form-input" placeholder="Materials Manager — leave blank to hide" value="${escapeHtml(step.roles.materials || '')}"
                        onchange="pages.activityEdit._instructionSteps[${i}].roles.materials = this.value">
                    <input type="text" class="form-input" placeholder="Timekeeper — leave blank to hide" value="${escapeHtml(step.roles.timekeeper || '')}"
                        onchange="pages.activityEdit._instructionSteps[${i}].roles.timekeeper = this.value">
                </div>
            `;
            container.appendChild(row);
        });
    },

    // ── Get Ready Tasks helpers ──
    _getReadyTasks: [],

    addGetReadyTask: function(val) {
        this._getReadyTasks.push(val || '');
        this.renderGetReadyTasks();
    },

    removeGetReadyTask: function(index) {
        this._getReadyTasks.splice(index, 1);
        this.renderGetReadyTasks();
    },

    renderGetReadyTasks: function() {
        const container = document.getElementById('fe-get-ready-tasks-list');
        if (!container) return;
        container.innerHTML = '';
        this._getReadyTasks.forEach((task, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; gap: var(--space-xs); align-items: center; margin-bottom: var(--space-xs);';
            row.innerHTML = `
                <input type="text" class="form-input" placeholder="e.g., Open your engineering notebook to the first blank page" value="${escapeHtml(task)}" style="flex: 1;" onchange="pages.activityEdit._getReadyTasks[${i}] = this.value">
                <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.removeGetReadyTask(${i})">✕</button>
            `;
            container.appendChild(row);
        });
    },

    // ── Conclusion Questions helpers ──
    _conclusionQuestions: [],

    addConclusionQuestion: function(val) {
        this._conclusionQuestions.push(val || '');
        this.renderConclusionQuestions();
    },

    removeConclusionQuestion: function(index) {
        this._conclusionQuestions.splice(index, 1);
        this.renderConclusionQuestions();
    },

    renderConclusionQuestions: function() {
        const container = document.getElementById('fe-conclusion-questions-list');
        if (!container) return;
        container.innerHTML = '';
        this._conclusionQuestions.forEach((q, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; gap: var(--space-xs); align-items: center; margin-bottom: var(--space-xs);';
            row.innerHTML = `
                <input type="text" class="form-input" placeholder="e.g., Why did your team's design change between attempts?" value="${escapeHtml(q)}" style="flex: 1;" onchange="pages.activityEdit._conclusionQuestions[${i}] = this.value">
                <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.removeConclusionQuestion(${i})">✕</button>
            `;
            container.appendChild(row);
        });
    },

    // ── Assessment Questions helpers ──
    _assessmentQuestions: [],

    addAssessmentQuestion: function() {
        this._assessmentQuestions.push({
            question: '',
            optionA: '',
            optionB: '',
            optionC: '',
            optionD: '',
            correctAnswer: '',
            explanation: ''
        });
        this.renderAssessmentQuestions();
    },

    removeAssessmentQuestion: function(index) {
        this._assessmentQuestions.splice(index, 1);
        this.renderAssessmentQuestions();
    },

    renderAssessmentQuestions: function() {
        const container = document.getElementById('fe-assessment-questions-list');
        if (!container) return;
        container.innerHTML = '';
        this._assessmentQuestions.forEach((aq, i) => {
            const block = document.createElement('div');
            block.style.cssText = 'border: 1px solid var(--color-border); border-radius: var(--radius-base); padding: var(--space-sm); margin-bottom: var(--space-sm);';
            block.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-xs);">
                    <strong style="font-size: var(--font-sm);">Question ${i + 1}</strong>
                    <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.removeAssessmentQuestion(${i})">✕ Remove</button>
                </div>
                <textarea class="form-input" rows="2" placeholder="Question text" style="margin-bottom: var(--space-xs);" onchange="pages.activityEdit._assessmentQuestions[${i}].question = this.value">${escapeHtml(aq.question || '')}</textarea>
                <input type="text" class="form-input" placeholder="Option A" style="margin-bottom: var(--space-xs);" value="${escapeHtml(aq.optionA || '')}" onchange="pages.activityEdit._assessmentQuestions[${i}].optionA = this.value">
                <input type="text" class="form-input" placeholder="Option B" style="margin-bottom: var(--space-xs);" value="${escapeHtml(aq.optionB || '')}" onchange="pages.activityEdit._assessmentQuestions[${i}].optionB = this.value">
                <input type="text" class="form-input" placeholder="Option C" style="margin-bottom: var(--space-xs);" value="${escapeHtml(aq.optionC || '')}" onchange="pages.activityEdit._assessmentQuestions[${i}].optionC = this.value">
                <input type="text" class="form-input" placeholder="Option D" style="margin-bottom: var(--space-xs);" value="${escapeHtml(aq.optionD || '')}" onchange="pages.activityEdit._assessmentQuestions[${i}].optionD = this.value">
                <div style="display: flex; gap: var(--space-xs); margin-bottom: var(--space-xs);">
                    <select class="form-input" style="flex: 0 0 auto; width: 120px;" onchange="pages.activityEdit._assessmentQuestions[${i}].correctAnswer = this.value">
                        <option value="">Answer</option>
                        <option value="A" ${aq.correctAnswer === 'A' ? 'selected' : ''}>A</option>
                        <option value="B" ${aq.correctAnswer === 'B' ? 'selected' : ''}>B</option>
                        <option value="C" ${aq.correctAnswer === 'C' ? 'selected' : ''}>C</option>
                        <option value="D" ${aq.correctAnswer === 'D' ? 'selected' : ''}>D</option>
                    </select>
                    <input type="text" class="form-input" placeholder="Brief explanation" style="flex: 1;" value="${escapeHtml(aq.explanation || '')}" onchange="pages.activityEdit._assessmentQuestions[${i}].explanation = this.value">
                </div>
            `;
            container.appendChild(block);
        });
    },

    // ── Documentation Checklist helpers ──
    _documentationChecklist: [],

    addDocumentationItem: function(val) {
        this._documentationChecklist.push(val || '');
        this.renderDocumentationChecklist();
    },

    removeDocumentationItem: function(index) {
        this._documentationChecklist.splice(index, 1);
        this.renderDocumentationChecklist();
    },

    renderDocumentationChecklist: function() {
        const container = document.getElementById('fe-documentation-checklist-list');
        if (!container) return;
        container.innerHTML = '';
        this._documentationChecklist.forEach((item, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; gap: var(--space-xs); align-items: center; margin-bottom: var(--space-xs);';
            row.innerHTML = `
                <input type="text" class="form-input" placeholder="e.g., Design sketch in engineering notebook" value="${escapeHtml(item)}" style="flex: 1;" onchange="pages.activityEdit._documentationChecklist[${i}] = this.value">
                <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.removeDocumentationItem(${i})">✕</button>
            `;
            container.appendChild(row);
        });
    },

    // ── Appendix Items helpers ──
    _appendixItems: [],

    addAppendixItem: function() {
        this._appendixItems.push({ title: '', content: '' });
        this.renderAppendixItems();
    },

    removeAppendixItem: function(index) {
        this._appendixItems.splice(index, 1);
        this.renderAppendixItems();
    },

    renderAppendixItems: function() {
        const container = document.getElementById('fe-appendix-items-list');
        if (!container) return;
        container.innerHTML = '';
        this._appendixItems.forEach((item, i) => {
            const block = document.createElement('div');
            block.style.cssText = 'border: 1px solid var(--color-border); border-radius: var(--radius-base); padding: var(--space-sm); margin-bottom: var(--space-sm);';
            block.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-xs);">
                    <strong style="font-size: var(--font-sm);">Appendix Item ${i + 1}</strong>
                    <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.removeAppendixItem(${i})">✕ Remove</button>
                </div>
                <input type="text" class="form-input" placeholder="e.g., Key Terms and Definitions" style="margin-bottom: var(--space-xs);" value="${escapeHtml(item.title || '')}" onchange="pages.activityEdit._appendixItems[${i}].title = this.value">
                <textarea class="form-input" rows="4" placeholder="Reference content, definitions, examples..." onchange="pages.activityEdit._appendixItems[${i}].content = this.value">${escapeHtml(item.content || '')}</textarea>
            `;
            container.appendChild(block);
        });
    },

    // ── Contract Constraints helpers ──
    _contractConstraints: [],

    addContractConstraint: function(val) {
        this._contractConstraints.push(val || '');
        this.renderContractConstraints();
    },

    removeContractConstraint: function(index) {
        this._contractConstraints.splice(index, 1);
        this.renderContractConstraints();
    },

    renderContractConstraints: function() {
        const container = document.getElementById('fe-contract-constraints-list');
        if (!container) return;
        container.innerHTML = '';
        this._contractConstraints.forEach((item, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; gap: var(--space-xs); align-items: center; margin-bottom: var(--space-xs);';
            row.innerHTML = `
                <input type="text" class="form-input" placeholder="e.g., Must use only recycled materials" value="${escapeHtml(item)}" style="flex: 1;" onchange="pages.activityEdit._contractConstraints[${i}] = this.value">
                <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.removeContractConstraint(${i})">✕</button>
            `;
            container.appendChild(row);
        });
    },

    // ── Contract Deliverables helpers ──
    _contractDeliverables: [],

    addContractDeliverable: function(val) {
        this._contractDeliverables.push(val || '');
        this.renderContractDeliverables();
    },

    removeContractDeliverable: function(index) {
        this._contractDeliverables.splice(index, 1);
        this.renderContractDeliverables();
    },

    renderContractDeliverables: function() {
        const container = document.getElementById('fe-contract-deliverables-list');
        if (!container) return;
        container.innerHTML = '';
        this._contractDeliverables.forEach((item, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; gap: var(--space-xs); align-items: center; margin-bottom: var(--space-xs);';
            row.innerHTML = `
                <input type="text" class="form-input" placeholder="e.g., Working prototype" value="${escapeHtml(item)}" style="flex: 1;" onchange="pages.activityEdit._contractDeliverables[${i}] = this.value">
                <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.removeContractDeliverable(${i})">✕</button>
            `;
            container.appendChild(row);
        });
    },

    // ── Certifications Required helpers ──
    _certsRequired: [],

    // Imported certifications are { name, toolId }; typed ones are plain text (plan row 1-12).
    _certName: function(item) {
        return (item && typeof item === 'object') ? (item.name || '') : (item || '');
    },

    // Editing a name keeps the record's shape. A changed name no longer matches its tool, so the
    // tool link is cleared rather than left pointing at the wrong tool.
    setCertName: function(which, index, val) {
        const list = which === 'available' ? this._certsAvailable : this._certsRequired;
        const cur = list[index];
        list[index] = (cur && typeof cur === 'object')
            ? { ...cur, name: val, toolId: val === cur.name ? cur.toolId : null }
            : val;
    },

    addCertRequired: function(val) {
        this._certsRequired.push(val || '');
        this.renderCertsRequired();
    },

    removeCertRequired: function(index) {
        this._certsRequired.splice(index, 1);
        this.renderCertsRequired();
    },

    renderCertsRequired: function() {
        const container = document.getElementById('fe-certs-required-list');
        if (!container) return;
        container.innerHTML = '';
        this._certsRequired.forEach((item, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; gap: var(--space-xs); align-items: center; margin-bottom: var(--space-xs);';
            row.innerHTML = `
                <input type="text" class="form-input" placeholder="e.g., Band Saw" value="${escapeHtml(this._certName(item))}" style="flex: 1;" onchange="pages.activityEdit.setCertName('required', ${i}, this.value)">
                <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.removeCertRequired(${i})">✕</button>
            `;
            container.appendChild(row);
        });
    },

    // ── Certifications Available helpers ──
    _certsAvailable: [],

    addCertAvailable: function(val) {
        this._certsAvailable.push(val || '');
        this.renderCertsAvailable();
    },

    removeCertAvailable: function(index) {
        this._certsAvailable.splice(index, 1);
        this.renderCertsAvailable();
    },

    renderCertsAvailable: function() {
        const container = document.getElementById('fe-certs-available-list');
        if (!container) return;
        container.innerHTML = '';
        this._certsAvailable.forEach((item, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; gap: var(--space-xs); align-items: center; margin-bottom: var(--space-xs);';
            row.innerHTML = `
                <input type="text" class="form-input" placeholder="e.g., Drill Press" value="${escapeHtml(this._certName(item))}" style="flex: 1;" onchange="pages.activityEdit.setCertName('available', ${i}, this.value)">
                <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.removeCertAvailable(${i})">✕</button>
            `;
            container.appendChild(row);
        });
    },

    // ── Portfolio Prompts helpers ──
    _portfolioPrompts: [],

    addPortfolioPrompt: function() {
        this._portfolioPrompts.push({ title: '', promptText: '', linkedCheckpoint: '' });
        this.renderPortfolioPrompts();
    },

    removePortfolioPrompt: function(index) {
        this._portfolioPrompts.splice(index, 1);
        this.renderPortfolioPrompts();
    },

    renderPortfolioPrompts: function() {
        const container = document.getElementById('fe-portfolio-prompts-list');
        if (!container) return;
        container.innerHTML = '';
        this._portfolioPrompts.forEach((prompt, i) => {
            const block = document.createElement('div');
            block.style.cssText = 'border: 1px solid var(--color-border); border-radius: var(--radius-base); padding: var(--space-sm); margin-bottom: var(--space-sm);';
            block.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-xs);">
                    <strong style="font-size: var(--font-sm);">Prompt ${i + 1}</strong>
                    <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.removePortfolioPrompt(${i})">✕ Remove</button>
                </div>
                <input type="text" class="form-input" placeholder="Prompt title (e.g., Progress Photo)" style="margin-bottom: var(--space-xs);" value="${escapeHtml(prompt.title || '')}" onchange="pages.activityEdit._portfolioPrompts[${i}].title = this.value">
                <textarea class="form-input" rows="2" placeholder="What should students capture or document?" style="margin-bottom: var(--space-xs);" onchange="pages.activityEdit._portfolioPrompts[${i}].promptText = this.value">${escapeHtml(prompt.promptText || '')}</textarea>
                <input type="text" class="form-input" placeholder="Linked checkpoint # (optional, e.g., 3)" value="${escapeHtml(prompt.linkedCheckpoint || '')}" onchange="pages.activityEdit._portfolioPrompts[${i}].linkedCheckpoint = this.value">
            `;
            container.appendChild(block);
        });
    },

    // ── WebXam Coverage helpers ──
    _webxamCoverage: [],

    addWebxamCode: function(val) {
        this._webxamCoverage.push(val || '');
        this.renderWebxamCoverage();
    },

    removeWebxamCode: function(index) {
        this._webxamCoverage.splice(index, 1);
        this.renderWebxamCoverage();
    },

    renderWebxamCoverage: function() {
        const container = document.getElementById('fe-webxam-coverage-list');
        if (!container) return;
        container.innerHTML = '';
        this._webxamCoverage.forEach((code, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; gap: var(--space-xs); align-items: center; margin-bottom: var(--space-xs);';
            row.innerHTML = `
                <input type="text" class="form-input" placeholder="e.g., 3.1.2" value="${escapeHtml(code)}" style="flex: 1;" onchange="pages.activityEdit._webxamCoverage[${i}] = this.value">
                <button type="button" class="btn btn--ghost btn--sm" onclick="pages.activityEdit.removeWebxamCode(${i})">✕</button>
            `;
            container.appendChild(row);
        });
    },

    // ── Sync to Hub (Sprint 17) ──
    syncToHub: async function() {
        const activityId = this._formFor?.mode === 'edit' ? this._formFor.id : null; // EP24
        if (!activityId) { ui.showToast('Save the activity first', 'error'); return; }

        const webhook = localStorage.getItem('webhook_wildcat');
        if (!webhook) { ui.showToast('Webhook not configured', 'error'); return; }
        const token = localStorage.getItem('webhook_token') || '';

        const statusEl = document.getElementById('hub-sync-status');
        if (statusEl) statusEl.textContent = 'Syncing...';

        try {
            const activity = await db.activities.get(activityId);
            if (!activity) { ui.showToast('Activity not found', 'error'); return; }

            // Load checkpoints
            const checkpoints = await db.checkpoints.where('activityId').equals(activityId).toArray();
            checkpoints.sort((a, b) => a.number - b.number);

            // Load students for this class (same pattern as activityDetail)
            const periodMap = await db.settings.get('period-year-map');
            const classPeriodsMap = periodMap?.value || {};
            const periodsForClass = Object.entries(classPeriodsMap)
                .filter(([period, classId]) => parseInt(classId) === activity.classId)
                .map(([period]) => period);

            const activeYear = await getActiveSchoolYear();
            const allEnrollments = await db.enrollments.toArray();
            const enrolledStudentIds = new Set(
                allEnrollments
                    .filter(e => periodsForClass.includes(String(e.period)) && (!e.schoolYear || e.schoolYear === activeYear))
                    .map(e => e.studentId)
            );

            const allStudents = excludeDeleted(await db.students.toArray())
                .filter(s => (s.status || 'active') === 'active' && (s.classId === activity.classId || enrolledStudentIds.has(s.id)))
                .sort(sortByStudentName);

            // Load teams and team members
            const allTeams = excludeDeleted(await db.teams.toArray()).filter(t => t.classId === activity.classId);
            const allTeamMembers = await db.teamMembers.toArray();

            // Build team lookup: studentId → teamName
            const studentTeamMap = {};
            allTeams.forEach(team => {
                const members = allTeamMembers.filter(tm => tm.teamId === team.id);
                members.forEach(m => { studentTeamMap[m.studentId] = team.name; });
            });

            // Load submissions
            const allSubmissions = await db.submissions.where('activityId').equals(activityId).toArray();
            const subByStudent = {};
            allSubmissions.forEach(s => { subByStudent[s.studentId] = s; });

            // Load checkpoint completions
            const checkpointIds = checkpoints.map(cp => cp.id);
            const allCompletions = await db.checkpointCompletions.toArray();
            const relevantCompletions = allCompletions.filter(c => checkpointIds.includes(c.checkpointId));

            // Build completion lookup: checkpointId-studentId → completion
            const compLookup = {};
            relevantCompletions.forEach(c => { compLookup[c.checkpointId + '-' + c.studentId] = c; });

            // Assemble student rows
            const studentRows = allStudents.map(s => {
                const first = (s.firstName || '').trim();
                const last = (s.lastName || '').trim();
                const dName = last ? first + ' ' + last.charAt(0) + '.' : first || 'Unknown';

                const sub = subByStudent[s.id];
                const submissionStatus = sub ? (sub.status || 'submitted') : 'missing';
                const graded = sub ? sub.status === 'graded' : false;

                const cpCompletions = checkpoints.map(cp => {
                    const comp = compLookup[cp.id + '-' + s.id];
                    return {
                        completed: comp ? !!comp.completed : false,
                        completedAt: comp ? comp.completedAt || comp.createdAt : null
                    };
                });

                const completedCount = cpCompletions.filter(c => c.completed).length;
                const cpPercent = checkpoints.length > 0 ? Math.round((completedCount / checkpoints.length) * 100) : 0;

                return {
                    displayName: dName,
                    teamName: studentTeamMap[s.id] || '',
                    submissionStatus,
                    graded,
                    checkpointCompletions: cpCompletions,
                    cpPercentComplete: cpPercent
                };
            });

            // Look up inventory locations for tools and materials
            const allInventory = await db.inventory.toArray();
            const inventoryByName = {};
            allInventory.forEach(item => {
                inventoryByName[item.name.toLowerCase().trim()] = item.location || 'Unknown';
            });

            const toolsWithLocation = (activity.requiredTools || []).map(t => ({
                name: t.name || '',
                quantity: t.quantity || '',
                location: inventoryByName[(t.name || '').toLowerCase().trim()] || 'Unknown'
            }));

            const materialsWithLocation = (activity.requiredMaterials || []).map(m => ({
                name: m.name || '',
                quantity: m.quantity || '',
                location: inventoryByName[(m.name || '').toLowerCase().trim()] || 'Unknown'
            }));

            // Construct Classroom URL from classroomLinks
            let classroomUrl = '';
            if (activity.classroomLinks) {
                const entries = Object.entries(activity.classroomLinks);
                if (entries.length > 0) {
                    const [courseId, cwId] = entries[0];
                    if (courseId && cwId && cwId !== 'PENDING_CREATE') {
                        classroomUrl = 'https://classroom.google.com/c/' + courseId + '/a/' + cwId + '/details';
                    }
                }
            }

            // Assemble payload
            const payload = {
                action: 'sync_to_hub_sheet',
                token,
                activities: [{
                    name: activity.name,
                    classroomUrl: classroomUrl,
                    title: activity.name,
                    description: activity.description || '',
                    studentGuideText: activity.studentGuideText || '',
                    startDate: activity.startDate || '',
                    endDate: activity.endDate || '',
                    dueDate: activity.endDate || '',
                    scoringType: activity.scoringType || '',
                    formUrl: activity.formUrl || '',
                    resourceLinks: activity.resourceLinks || [],
                    // Activity Guide fields
                    unit: activity.unit || '',
                    lesson: activity.lesson || '',
                    activityType: activity.activityType || '',
                    phase: activity.phase || '',
                    scaffoldingLevel: activity.scaffoldingLevel || '',
                    classPeriods: activity.classPeriods || '',
                    learningGoals: activity.learningGoals || [],
                    fusionGoals: activity.fusionGoals || [],
                    requiredTools: toolsWithLocation,
                    requiredMaterials: materialsWithLocation,
                    slidesUrl: activity.slidesUrl || '',
                    instructionSteps: activity.instructionSteps || [],
                    getReadyTime: activity.getReadyTime || '',
                    getReadyTasks: activity.getReadyTasks || [],
                    getReadyRoleTasks: activity.getReadyRoleTasks || '',
                    conclusionQuestions: activity.conclusionQuestions || [],
                    conclusionSubmissionMethod: activity.conclusionSubmissionMethod || '',
                    assessmentQuestions: activity.assessmentQuestions || [],
                    documentationChecklist: activity.documentationChecklist || [],
                    appendixItems: activity.appendixItems || [],
                    // Contract Brief (student-facing)
                    contractCode: activity.contractCode || '',
                    contractBrief: activity.contractBrief || {},
                    certificationsRequired: activity.certificationsRequired || [],
                    certificationsAvailable: activity.certificationsAvailable || [],
                    portfolioPrompts: activity.portfolioPrompts || [],
                    checkpoints: checkpoints.map(cp => ({
                        number: cp.number,
                        title: cp.title || '',
                        description: cp.description || '',
                        suggestedDate: cp.suggestedDate || '',
                        milestone: cp.milestone || '',
                        afterStep: (cp.afterStep === 0 || cp.afterStep) ? cp.afterStep : null,
                        questions: cp.questions || []
                    })),
                    students: studentRows
                }]
            };

            const response = await webhookFetch(webhook, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.status === 'success') {
                const now = new Date().toISOString();
                await db.activities.update(activityId, { lastHubSync: now });
                if (statusEl) statusEl.textContent = 'Last synced: ' + new Date(now).toLocaleString();
                ui.showToast('📤 Synced to Student Hub', 'success');
                pages.activityEdit.updateWidgetUrls();
                logAction('hub-sync', 'activity', activityId, 'Synced to Student Hub');
                if (typeof driveSync !== 'undefined') driveSync.markDirty();
            } else {
                throw new Error(result.message || 'Sync failed');
            }

        } catch (err) {
            console.error('Hub sync error:', err);
            ui.showToast('Sync failed: ' + err.message, 'error');
            if (statusEl) statusEl.textContent = 'Sync failed';
        }
    },

    copyWidgetUrl: function(inputId) {
        const input = document.getElementById(inputId);
        if (!input || !input.value) return;
        navigator.clipboard.writeText(input.value).then(() => {
            ui.showToast('URL copied!', 'success');
        }).catch(() => {
            input.select();
            ui.showToast('Select All + Copy manually', 'info');
        });
    },

    updateWidgetUrls: function() {
        const baseUrl = localStorage.getItem('webhook_widget-base');
        const activityName = document.getElementById('fe-name').value.trim();
        const urlBlock = document.getElementById('hub-widget-urls');

        if (!baseUrl || !activityName || !urlBlock) return;

        const encoded = encodeURIComponent(activityName);
        document.getElementById('hub-progress-url').value =
            baseUrl + '?activity=' + encoded;
        document.getElementById('hub-assignment-url').value =
            baseUrl + '?mode=assignment&activity=' + encoded;

        urlBlock.style.display = '';
    },

    loadCourses: async function() {
        const select = document.getElementById('fe-classroom-course');
        select.innerHTML = '<option value="">Loading...</option>';
        select.disabled = true;

        try {
            const webhook = localStorage.getItem('webhook_wildcat');
            const token = localStorage.getItem('webhook_token') || '';
            const resp = await webhookFetch(webhook, {
                method: 'POST',
                body: JSON.stringify({ token, action: 'list_classroom_courses' })
            });
            const result = await resp.json();

            select.innerHTML = '<option value="">Not linked</option>';
            if (result.status === 'success' && result.courses) {
                this._courseData = {};
                result.courses.forEach(c => {
                    this._courseData[c.id] = c;
                    select.innerHTML += `<option value="${c.id}">${escapeHtml(c.name)}${c.section ? ' — ' + escapeHtml(c.section) : ''}</option>`;
                });

                // Restore previously selected course
                const links = state._classroomLinksTemp || {};
                const existingCourseId = Object.keys(links)[0];
                if (existingCourseId) {
                    select.value = existingCourseId;
                    this.loadCoursework();
                }
            }
        } catch (err) {
            select.innerHTML = '<option value="">Error loading courses</option>';
            ui.showToast('Could not load courses: ' + err.message, 'error');
        } finally {
            select.disabled = false;
        }
    },

    loadCoursework: async function() {
        const courseId = document.getElementById('fe-classroom-course').value;
        const cwGroup = document.getElementById('fe-cw-group');
        const topicGroup = document.getElementById('fe-topic-group');
        const publishGroup = document.getElementById('fe-publish-group');
        const gradeCatGroup = document.getElementById('fe-grade-cat-group');
        const assigneesGroup = document.getElementById('fe-assignees-group');
        const materialsGroup = document.getElementById('fe-materials-group');
        if (!courseId) {
            [cwGroup, topicGroup, publishGroup, gradeCatGroup, assigneesGroup, materialsGroup].forEach(el => el.style.display = 'none');
            document.getElementById('fe-skill-link-status').style.display = 'none';
            return;
        }

        // Show all sub-fields
        [cwGroup, topicGroup, publishGroup, gradeCatGroup, assigneesGroup, materialsGroup].forEach(el => el.style.display = '');

        // Set smart default for publish mode
        const startDate = document.getElementById('fe-start-date').value;
        const today = new Date().toISOString().split('T')[0];
        const publishMode = startDate && startDate > today ? 'ON_START_DATE' : 'PUBLISHED';
        const publishRadio = document.querySelector(`input[name="fe-publish-mode"][value="${publishMode}"]`);
        if (publishRadio) publishRadio.checked = true;
        this.toggleScheduleField();

        // Load coursework, topics, and students in parallel
        await Promise.all([
            this._loadCourseworkDropdown(courseId),
            this._loadTopics(courseId),
            this._loadStudentChecklist(courseId)
        ]);

        // Update skill/PP link status for this course
        this.updateSkillLinkStatus();
    },

    _loadCourseworkDropdown: async function(courseId) {
        const cwSelect = document.getElementById('fe-classroom-cw');
        const cwHelper = document.getElementById('fe-cw-helper');
        cwSelect.innerHTML = '<option value="">Loading...</option>';
        cwSelect.disabled = true;

        try {
            const webhook = localStorage.getItem('webhook_wildcat');
            const token = localStorage.getItem('webhook_token') || '';
            const resp = await webhookFetch(webhook, {
                method: 'POST',
                body: JSON.stringify({ token, action: 'list_classroom_coursework', courseId })
            });
            const result = await resp.json();

            cwSelect.innerHTML = '<option value="">Select assignment...</option>';
            if (result.status === 'success' && result.coursework) {
                result.coursework.forEach(cw => {
                    cwSelect.innerHTML += `<option value="${cw.id}">${escapeHtml(cw.title)} (${cw.maxPoints || '?'} pts)</option>`;
                });

                // Restore linked coursework
                const savedCwId = (state._classroomLinksTemp || {})[courseId];
                if (savedCwId) {
                    cwSelect.value = savedCwId;
                    cwHelper.textContent = 'Linked to this assignment';
                    document.getElementById('fe-update-cw-btn').style.display = '';
                    document.getElementById('fe-create-cw-btn').style.display = 'none';
                }
            }
        } catch (err) {
            cwSelect.innerHTML = '<option value="">Error loading</option>';
        } finally {
            cwSelect.disabled = false;
        }
    },

    _loadTopics: async function(courseId) {
        const topicSelect = document.getElementById('fe-classroom-topic');
        topicSelect.innerHTML = '<option value="">Loading...</option>';

        try {
            const webhook = localStorage.getItem('webhook_wildcat');
            const token = localStorage.getItem('webhook_token') || '';
            const resp = await webhookFetch(webhook, {
                method: 'POST',
                body: JSON.stringify({ token, action: 'list_classroom_topics', courseId })
            });
            const result = await resp.json();

            topicSelect.innerHTML = '<option value="">No topic</option>';
            if (result.status === 'success' && result.topics) {
                result.topics.forEach(t => {
                    topicSelect.innerHTML += `<option value="${t.topicId}">${escapeHtml(t.name)}</option>`;
                });
            }
        } catch (err) {
            topicSelect.innerHTML = '<option value="">Error loading topics</option>';
        }
    },

    createTopic: async function() {
        const topicName = prompt('Enter new topic name:');
        if (!topicName || !topicName.trim()) return;

        const courseId = document.getElementById('fe-classroom-course').value;
        if (!courseId) { ui.showToast('Select a course first', 'error'); return; }

        try {
            const webhook = localStorage.getItem('webhook_wildcat');
            const token = localStorage.getItem('webhook_token') || '';
            const resp = await webhookFetch(webhook, {
                method: 'POST',
                body: JSON.stringify({ token, action: 'create_classroom_topic', courseId, name: topicName.trim() })
            });
            const result = await resp.json();

            if (result.status === 'success') {
                ui.showToast('Topic created: ' + result.name, 'success');
                const select = document.getElementById('fe-classroom-topic');
                const option = document.createElement('option');
                option.value = result.topicId;
                option.textContent = result.name;
                select.appendChild(option);
                select.value = result.topicId;
            } else {
                ui.showToast('Error: ' + result.message, 'error');
            }
        } catch (err) {
            ui.showToast('Network error: ' + err.message, 'error');
        }
    },

    toggleScheduleField: function() {
        const mode = document.querySelector('input[name="fe-publish-mode"]:checked')?.value;
        document.getElementById('fe-schedule-datetime').style.display = mode === 'SCHEDULED' ? '' : 'none';
    },

    toggleAssigneeList: function() {
        const mode = document.querySelector('input[name="fe-assignee-mode"]:checked')?.value;
        document.getElementById('fe-student-checklist').style.display = mode === 'INDIVIDUAL_STUDENTS' ? '' : 'none';
    },

    _loadStudentChecklist: async function(courseId) {
        const checklist = document.getElementById('fe-student-checklist');
        checklist.innerHTML = '<p style="color: var(--color-text-secondary);">Loading students...</p>';

        const classId = parseInt(document.getElementById('fe-class-id').value);
        if (!classId) {
            checklist.innerHTML = '<p class="form-helper">Select a class first to see students</p>';
            return;
        }

        // Find which periods belong to this class
        const cls = await db.classes.get(classId);
        if (!cls || !cls.periods || cls.periods.length === 0) {
            checklist.innerHTML = '<p class="form-helper">No periods assigned to this class</p>';
            return;
        }

        const activeYear = await getActiveSchoolYear();
        const allEnrollments = await db.enrollments.toArray();
        const matchingEnrollments = allEnrollments.filter(e => 
            cls.periods.includes(String(e.period)) && (e.schoolYear || '') === activeYear
        );
        const studentIds = [...new Set(matchingEnrollments.map(e => e.studentId))];

        const students = [];
        for (const sid of studentIds) {
            const s = await db.students.get(parseInt(sid));
            if (s && s.status !== 'archived' && s.email) {
                students.push(s);
            }
        }
        students.sort(sortByStudentName);

        if (students.length === 0) {
            checklist.innerHTML = '<p class="form-helper">No students with email addresses found in this class</p>';
            return;
        }

        checklist.innerHTML = students.map(s => `
            <label style="display: block; padding: 4px 0;">
                <input type="checkbox" class="fe-assignee-cb" value="${escapeHtml(s.email)}" checked>
                ${escapeHtml(displayName(s))} <span style="color: var(--color-text-secondary); font-size: var(--font-size-body-small);">(${escapeHtml(s.email)})</span>
            </label>
        `).join('');
    },

    addMaterial: function(type) {
        if (type === 'link') {
            const url = prompt('Enter URL:');
            if (!url || !url.trim()) return;
            const title = prompt('Display title (optional):') || '';
            this._materials.push({ type: 'link', url: url.trim(), title: title.trim() });
        } else if (type === 'driveFile') {
            const fileId = prompt('Enter Google Drive file ID:\n(The part between /d/ and /edit in the URL)');
            if (!fileId || !fileId.trim()) return;
            const title = prompt('Display title (optional):') || 'Drive file';
            this._materials.push({ type: 'driveFile', driveFileId: fileId.trim(), title: title.trim() });
        } else if (type === 'youtubeVideo') {
            const input = prompt('Enter YouTube video URL or ID:');
            if (!input || !input.trim()) return;
            let videoId = input.trim();
            const urlMatch = videoId.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
            if (urlMatch) videoId = urlMatch[1];
            const title = prompt('Display title (optional):') || 'YouTube video';
            this._materials.push({ type: 'youtubeVideo', youtubeId: videoId, title: title.trim() });
        }
        this.renderMaterialsList();
    },

    moveMaterial: function(index, direction) {
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= this._materials.length) return;
        const item = this._materials.splice(index, 1)[0];
        this._materials.splice(newIndex, 0, item);
        this.renderMaterialsList();
        this.updateAllSummaries();
    },

    removeMaterial: function(index) {
        this._materials.splice(index, 1);
        this.renderMaterialsList();
    },

    renderMaterialsList: function() {
        const container = document.getElementById('fe-materials-list');
        if (this._materials.length === 0) {
            container.innerHTML = '<p class="form-helper" style="margin: 0;">No attachments added</p>';
            return;
        }

        container.innerHTML = this._materials.map((m, i) => {
            const icon = m.type === 'link' ? '🔗' : m.type === 'driveFile' ? '📄' : '▶️';
            const label = m.title || m.url || m.driveFileId || m.youtubeId;
            const upDisabled = i === 0 ? 'disabled' : '';
            const downDisabled = i === this._materials.length - 1 ? 'disabled' : '';
            return `
                <div class="fe-material-row">
                    <span class="fe-material-icon">${icon}</span>
                    <span class="fe-material-label">${escapeHtml(label)}</span>
                    <button type="button" class="fe-material-reorder" ${upDisabled} onclick="pages.activityEdit.moveMaterial(${i}, -1)" title="Move up">▲</button>
                    <button type="button" class="fe-material-reorder" ${downDisabled} onclick="pages.activityEdit.moveMaterial(${i}, 1)" title="Move down">▼</button>
                    <button type="button" class="fe-material-remove" onclick="pages.activityEdit.removeMaterial(${i})">✕</button>
                </div>
            `;
        }).join('');
    },

    createCoursework: function() {
        const courseId = document.getElementById('fe-classroom-course').value;
        if (!courseId) { ui.showToast('Select a course first', 'error'); return; }

        const maxPoints = parseInt(document.getElementById('fe-classroom-max-points').value) || 100;
        const topicId = document.getElementById('fe-classroom-topic').value || null;
        const publishMode = document.querySelector('input[name="fe-publish-mode"]:checked')?.value || 'PUBLISHED';
        const scheduledTime = publishMode === 'SCHEDULED' ? document.getElementById('fe-scheduled-time').value : null;
        const assigneeMode = document.querySelector('input[name="fe-assignee-mode"]:checked')?.value || 'ALL_STUDENTS';

        // Collect selected student emails if assigning individually
        let studentEmails = [];
        if (assigneeMode === 'INDIVIDUAL_STUDENTS') {
            studentEmails = Array.from(document.querySelectorAll('.fe-assignee-cb:checked')).map(cb => cb.value);
        }

        // Handle On Start Date mode (Opus suggestion)
        let finalPublishState = publishMode;
        let finalScheduledTime = scheduledTime;
        if (publishMode === 'ON_START_DATE') {
            const startDate = document.getElementById('fe-start-date').value;
            const now = new Date();
            const startDateTime = startDate ? new Date(startDate + 'T06:00:00-05:00') : null;
            if (startDate && startDateTime > now) {
                finalPublishState = 'SCHEDULED';
                finalScheduledTime = startDateTime.toISOString();
            } else {
                // Start date is today or past — publish immediately instead
                finalPublishState = 'PUBLISHED';
                finalScheduledTime = null;
            }
        }

        state._classroomPendingCreate = state._classroomPendingCreate || {};
        state._classroomPendingCreate[courseId] = {
            maxPoints,
            topicId,
            publishState: finalPublishState,
            scheduledTime: finalScheduledTime,
            assigneeMode,
            studentEmails,
        };

        // Show visual confirmation
        const cwSelect = document.getElementById('fe-classroom-cw');
        cwSelect.innerHTML = '<option value="PENDING_CREATE" selected>⏳ Will create on Save</option>';
        document.getElementById('fe-create-cw-btn').style.display = 'none';

        ui.showToast('Assignment will be created in Classroom when you save', 'info');
        this.updateAllSummaries();
    },

    updateCoursework: async function() {
        const courseId = document.getElementById('fe-classroom-course').value;
        const cwId = document.getElementById('fe-classroom-cw').value;
        if (!courseId || !cwId || cwId === 'PENDING_CREATE') {
            ui.showToast('No linked Classroom assignment to update', 'error');
            return;
        }

        const title = document.getElementById('fe-name').value.trim();
        const maxPoints = parseInt(document.getElementById('fe-classroom-max-points').value) || 100;
        const endDate = document.getElementById('fe-end-date').value;
        const webhook = localStorage.getItem('webhook_wildcat');
        const token = localStorage.getItem('webhook_token') || '';

        if (!webhook) {
            ui.showToast('No webhook configured', 'error');
            return;
        }

        try {
            const payload = {
                token: token,
                action: 'update_classroom_coursework',
                courseId: courseId,
                courseWorkId: cwId,
                title: title,
                maxPoints: maxPoints
            };
            if (endDate && endDate > new Date().toISOString().split('T')[0]) payload.dueDate = endDate;
            if (this._materials.length > 0) payload.materials = this._materials;

            const resp = await webhookFetch(webhook, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            const result = await resp.json();

            if (result.status === 'success') {
                ui.showToast('✅ Updated in Classroom: ' + result.title + ' (' + result.maxPoints + ' pts)', 'success');
            } else {
                ui.showToast('Update failed: ' + (result.message || 'Unknown error'), 'error');
            }
        } catch (err) {
            ui.showToast('Classroom error: ' + err.message, 'error');
        }
    },

    _processPendingClassroomCreates: async function(activityData, name, description, endDate) {
        const pendingCreates = state._classroomPendingCreate || {};
        const pendingCourseIds = Object.keys(pendingCreates);
        if (pendingCourseIds.length === 0) return;

        const webhook = localStorage.getItem('webhook_wildcat');
        const token = localStorage.getItem('webhook_token') || '';
        if (!webhook) return;

        const links = activityData.classroomLinks || {};

        for (const courseId of pendingCourseIds) {
            try {
                const pending = pendingCreates[courseId];
                const payload = {
                    token,
                    action: 'create_classroom_coursework',
                    courseId,
                    title: name,
                    maxPoints: pending.maxPoints
                };
                if (description) payload.description = description;
                if (endDate && endDate > getTodayString()) payload.dueDate = endDate;

                // Sprint 11 additions
                if (pending.topicId) payload.topicId = pending.topicId;
                if (pending.publishState) payload.publishState = pending.publishState;
                if (pending.scheduledTime) payload.scheduledTime = pending.scheduledTime;
                if (pending.gradeCategory) payload.gradeCategory = pending.gradeCategory;
                if (pending.assigneeMode === 'INDIVIDUAL_STUDENTS' && pending.studentEmails?.length > 0) {
                    payload.assigneeMode = 'INDIVIDUAL_STUDENTS';
                    payload.studentEmails = pending.studentEmails;
                }
                // Site Page URL from the form (so a new assignment gets it too, X15), and each link
                // only once: Classroom rejects duplicate materials (plan row 1-12, backlog #5)
                const materialsToSend = [];
                const sitePageUrl = activityData.sitePageUrl || this._data?.activity?.sitePageUrl || null;
                if (sitePageUrl) {
                    materialsToSend.push({ type: 'link', url: sitePageUrl, title: (name || 'Assignment') + ' — Assignment Guide' });
                }
                for (const m of (this._materials || [])) {
                    if (m && m.url && materialsToSend.some(x => x.url === m.url)) continue;
                    materialsToSend.push(m);
                }
                if (materialsToSend.length > 0) {
                    payload.materials = materialsToSend;
                }

                const resp = await webhookFetch(webhook, { method: 'POST', body: JSON.stringify(payload) });
                const result = await resp.json();

                if (result.status === 'success') {
                    links[courseId] = result.courseworkId;
                    ui.showToast('✅ Created "' + result.title + '" in Classroom', 'success');
                } else {
                    ui.showToast('Classroom create failed: ' + (result.message || 'Unknown error'), 'error');
                    // Reset UI so teacher can retry on next save
                    const cwSelect = document.getElementById('fe-classroom-cw');
                    if (cwSelect) cwSelect.innerHTML = '<option value="">Select assignment...</option>';
                    const createBtn = document.getElementById('fe-create-cw-btn');
                    if (createBtn) createBtn.style.display = '';
                }
            } catch (err) {
                ui.showToast('Classroom error: ' + err.message, 'error');
                // Reset UI so teacher can retry on next save
                const cwSelect = document.getElementById('fe-classroom-cw');
                if (cwSelect) cwSelect.innerHTML = '<option value="">Select assignment...</option>';
                const createBtn = document.getElementById('fe-create-cw-btn');
                if (createBtn) createBtn.style.display = '';
            }
        }

        activityData.classroomLinks = Object.keys(links).length > 0 ? links : null;
    },

    _saveCheckpoints: async function(activityId) {
        const cpRows = document.querySelectorAll('.fe-checkpoint-row');
        const existingCps = await db.checkpoints.where('activityId').equals(activityId).toArray();
        const existingIds = new Set(existingCps.map(cp => cp.id));
        const keptIds = new Set();

        for (let i = 0; i < cpRows.length; i++) {
            const row = cpRows[i];
            const cpData = {
                activityId,
                number: i + 1,
                title: row.querySelector('.fe-cp-title').value.trim(),
                description: row.querySelector('.fe-cp-desc').value.trim(),
                suggestedDate: row.querySelector('.fe-cp-date').value || null,
                milestone: row.querySelector('.fe-cp-milestone')?.value.trim() || '',
                lookFor: row.querySelector('.fe-cp-lookfor')?.value.trim() || '',
                questions: Array.from(row.querySelectorAll('.checkpoint-qa-row')).map(qaRow => ({
                    question: qaRow.querySelector('.cp-question').value.trim(),
                    expectedResponse: qaRow.querySelector('.cp-expected-response').value.trim()
                })).filter(qa => qa.question || qa.expectedResponse),
                updatedAt: new Date().toISOString()
            };

            const existingId = parseInt(row.dataset.cpId);
            if (existingId && existingIds.has(existingId)) {
                // Carry forward fields that have no UI inputs (set via JSON import)
                const existingCp = existingCps.find(cp => cp.id === existingId);
                if (existingCp) {
                    if (existingCp.skillsAssessable) cpData.skillsAssessable = existingCp.skillsAssessable;
                    if (existingCp.certificationDemos) cpData.certificationDemos = existingCp.certificationDemos;
                }
                await db.checkpoints.update(existingId, cpData);
                keptIds.add(existingId);
            } else if (cpData.title) {
                cpData.createdAt = new Date().toISOString();
                await db.checkpoints.add(cpData);
            }
        }

        for (const id of existingIds) {
            if (!keptIds.has(id)) {
                await db.checkpoints.delete(id);
            }
        }
    },

    _saveLinkedStandards: async function(activityId) {
        const existing = await db.activityStandards.where('activityId').equals(activityId).toArray();
        for (const link of existing) {
            await db.activityStandards.delete(link.id);
        }
        const checked = document.querySelectorAll('.fe-standard-cb:checked');
        for (const cb of checked) {
            await db.activityStandards.add({
                activityId,
                standardId: parseInt(cb.value),
                updatedAt: new Date().toISOString()
            });
        }
    },

    _saveLinkedSkills: async function(activityId) {
        // Links on retired or merged-away skills aren't shown here, so they're kept as they are
        // (hidden history, P16 C3); only the visible links are replaced by the ticked boxes.
        const hidden = await getHiddenSkillIds();
        const existing = await db.activitySkills.where('activityId').equals(activityId).toArray();
        for (const link of existing) {
            if (link.deletedAt || hidden.has(link.skillId)) continue;
            await db.activitySkills.delete(link.id);
        }
        const checked = document.querySelectorAll('.fe-skill-cb:checked');
        for (const cb of checked) {
            await db.activitySkills.add({
                activityId,
                skillId: parseInt(cb.value),
                updatedAt: new Date().toISOString()
            });
        }
    },

    _pushRubricToClassroom: async function(activityId, activityData, rubric) {
      if (!activityData.classroomLinks) return;

      const webhook = localStorage.getItem('webhook_wildcat');
      const token = localStorage.getItem('webhook_token') || '';
      if (!webhook) return;

      const links = activityData.classroomLinks;
      const levels = rubric.levels || [];
      const pointsPerLevel = levels.map((_, i) => levels.length - i);

      const criteria = (rubric.criteria || []).map(c => ({
          title: c.name,
          description: '',
          levels: levels.map((levelName, i) => ({
              title: levelName,
              description: c.descriptions?.[i] || '',
              points: pointsPerLevel[i]
          }))
      }));

      for (const courseId of Object.keys(links)) {
          const courseWorkId = links[courseId];
          if (!courseWorkId || courseWorkId === 'PENDING_CREATE') continue;

          try {
              const resp = await webhookFetch(webhook, {
                  method: 'POST',
                  body: JSON.stringify({
                      token, action: 'create_classroom_rubric',
                      courseId, courseWorkId, criteria
                  })
              });
              const result = await resp.json();

              if (result.status === 'success') {
                  ui.showToast('Rubric synced to Classroom', 'success');
              } else {
                  console.warn('Rubric push failed:', result.message);
                  if (result.message && result.message.includes('UserIneligibleToModifyRubrics')) {
                      ui.showToast('Rubric sync requires a premium Google Workspace for Education license', 'warning');
                  } else if (result.message && result.message.includes('not found')) {
                      ui.showToast('Rubric push not available — may require Google Developer Preview enrollment', 'warning');
                  } else {
                      ui.showToast('Rubric sync error: ' + result.message, 'error');
                  }
              }
          } catch (err) {
              console.error('Rubric push error:', err);
          }
      }
  },

    // i106: the saved assignment this form shows (EP24's _formFor); null for a new, unsaved one.
    // (The old code read an id property that nothing ever set, so the Skill & PP box never showed.)
    _savedActivityId: function() {
        return this._formFor && this._formFor.mode === 'edit' ? this._formFor.id : null;
    },

    updateSkillLinkStatus: async function() {
        const courseId = document.getElementById('fe-classroom-course').value;
        const activityId = this._savedActivityId();
        const statusContainer = document.getElementById('fe-skill-link-status');
        const listContainer = document.getElementById('fe-skill-link-list');
        const summaryEl = document.getElementById('fe-skill-link-summary');

        if (!courseId || !activityId) {
            if (statusContainer) statusContainer.style.display = 'none';
            return;
        }

        statusContainer.style.display = '';
        const activitySkills = await getLiveSkillLinks(activityId);
        const skillIds = activitySkills.map(as => as.skillId);
        const skills = (await db.skills.bulkGet(skillIds)).filter(s => s && !isSkillHidden(s));

        // Check which skills have Classroom links for this course
        let linkedCount = 0;
        let html = '';
        for (const skill of skills) {
            const links = skill.classroomLinks || {};
            const isLinked = !!links[courseId];
            if (isLinked) linkedCount++;
            html += `<div style="display: flex; align-items: center; gap: var(--space-xs); padding: 2px 0;">
                <span style="color: ${isLinked ? 'var(--color-success)' : 'var(--color-text-tertiary)'};">${isLinked ? '✅' : '⬜'}</span>
                <span>${escapeHtml(skill.name)}</span>
            </div>`;
        }

        // PP status: its own link (ppClassroomLinks), never the assignment's own classroomLinks,
        // which Push to Classroom sends grades to
        const activity = await db.activities.get(activityId);
        const ppLinked = !!(activity && activity.ppClassroomLinks && activity.ppClassroomLinks[courseId]);
        html += `<div style="display: flex; align-items: center; gap: var(--space-xs); padding: 2px 0; margin-top: var(--space-xs); border-top: 1px solid var(--color-border); padding-top: var(--space-xs);">
            <span style="color: ${ppLinked ? 'var(--color-success)' : 'var(--color-text-tertiary)'};">${ppLinked ? '✅' : '⬜'}</span>
            <span style="font-weight: 600;">Professional Practice</span>
        </div>`;

        listContainer.innerHTML = html;
        summaryEl.textContent = `${linkedCount}/${skills.length} skills linked${ppLinked ? ', PP linked' : ''}`;

        // Hide/show buttons based on what's already linked
        const createSkillBtn = document.getElementById('fe-create-skill-assignments-btn');
        const createPPBtn = document.getElementById('fe-create-pp-assignment-btn');
        if (createSkillBtn) createSkillBtn.style.display = linkedCount < skills.length ? '' : 'none';
        if (createPPBtn) createPPBtn.style.display = ppLinked ? 'none' : '';

        // Populate grade category dropdowns from course data
        const courseData = (this._courseData || {})[courseId];
        const skillsCatSelect = document.getElementById('fe-skills-grade-category');
        const ppCatSelect = document.getElementById('fe-pp-grade-category');
        if (courseData && courseData.gradeCategories && courseData.gradeCategories.length > 0) {
            const cats = courseData.gradeCategories;
            const savedSkillsCat = localStorage.getItem('classroom-skills-category-' + courseId) || '';
            const savedPPCat = localStorage.getItem('classroom-pp-category-' + courseId) || '';

            skillsCatSelect.innerHTML = '<option value="">None (no category)</option>';
            ppCatSelect.innerHTML = '<option value="">None (no category)</option>';
            cats.forEach(cat => {
                const weightPct = cat.weight ? (cat.weight / 10000).toFixed(0) + '%' : '';
                const label = escapeHtml(cat.name) + (weightPct ? ' (' + weightPct + ')' : '');
                skillsCatSelect.innerHTML += '<option value="' + cat.id + '" data-name="' + escapeHtml(cat.name) + '">' + label + '</option>';
                ppCatSelect.innerHTML += '<option value="' + cat.id + '" data-name="' + escapeHtml(cat.name) + '">' + label + '</option>';
            });

            // Restore saved selections, or auto-match by name
            if (savedSkillsCat) {
                skillsCatSelect.value = savedSkillsCat;
            } else {
                const autoSkill = cats.find(c => /skill/i.test(c.name));
                if (autoSkill) skillsCatSelect.value = autoSkill.id;
            }
            if (savedPPCat) {
                ppCatSelect.value = savedPPCat;
            } else {
                const autoPP = cats.find(c => /profess|practice|pp/i.test(c.name));
                if (autoPP) ppCatSelect.value = autoPP.id;
            }

            // Auto-save the initial selection
            this.saveGradeCategorySelection();
        }
    },

    saveGradeCategorySelection: function() {
        const courseId = document.getElementById('fe-classroom-course').value;
        if (!courseId) return;
        const skillsCatId = document.getElementById('fe-skills-grade-category').value;
        const ppCatId = document.getElementById('fe-pp-grade-category').value;
        if (skillsCatId) localStorage.setItem('classroom-skills-category-' + courseId, skillsCatId);
        else localStorage.removeItem('classroom-skills-category-' + courseId);
        if (ppCatId) localStorage.setItem('classroom-pp-category-' + courseId, ppCatId);
        else localStorage.removeItem('classroom-pp-category-' + courseId);
    },

    createSkillAssignments: async function() {
        const courseId = document.getElementById('fe-classroom-course').value;
        const activityId = this._savedActivityId();
        if (!courseId) {
            ui.showToast('Select a Classroom course first', 'warning');
            return;
        }
        if (!activityId) {
            ui.showToast('Save the assignment first, then create its Classroom assignments.', 'warning');
            return;
        }

        const webhookUrl = localStorage.getItem('webhook_wildcat');
        const token = localStorage.getItem('webhook_token') || '';
        const skillsCatId = localStorage.getItem('classroom-skills-category-' + courseId) || '';
        const skillsCatName = document.getElementById('fe-skills-grade-category')?.selectedOptions?.[0]?.dataset?.name || 'Skills';

        if (!webhookUrl) {
            ui.showToast('No webhook URL configured', 'error');
            return;
        }

        const activitySkills = await getLiveSkillLinks(activityId);
        const skillIds = activitySkills.map(as => as.skillId);
        const skills = (await db.skills.bulkGet(skillIds)).filter(s => s && !isSkillHidden(s));

        // Only create for skills not yet linked to this course
        const toCreate = skills.filter(s => !(s.classroomLinks || {})[courseId]);
        if (toCreate.length === 0) {
            ui.showToast('All skills already linked to this course', 'info');
            return;
        }

        if (!confirm(`Create ${toCreate.length} skill assignment(s) in Classroom?`)) return;

        const btn = document.getElementById('fe-create-skill-assignments-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

        let created = 0;
        for (const skill of toCreate) {
            try {
                const payload = {
                    token: token,
                    action: 'create_classroom_coursework',
                    courseId: courseId,
                    title: skill.name,
                    description: 'Skill mastery assessment — scored by most recent observation',
                    maxPoints: 100,
                    publishState: 'PUBLISHED'
                };
                if (skillsCatId) {
                    payload.gradeCategory = { id: skillsCatId, name: skillsCatName };
                }

                const resp = await webhookFetch(webhookUrl, { method: 'POST', body: JSON.stringify(payload) });
                const result = await resp.json();

                if (result.status === 'success') {
                    // Store link on skill record
                    const links = { ...(skill.classroomLinks || {}) };
                    links[courseId] = result.courseworkId;
                    await db.skills.update(skill.id, { classroomLinks: links, updatedAt: new Date().toISOString() });   // updatedAt: reaches the other device
                    created++;
                } else {
                    ui.showToast(`Failed to create "${skill.name}": ${result.message}`, 'error');
                }
            } catch (err) {
                ui.showToast(`Error creating "${skill.name}": ${err.message}`, 'error');
            }
        }

        if (btn) { btn.disabled = false; btn.textContent = 'Create Skill Assignments'; }
        ui.showToast(`✅ Created ${created}/${toCreate.length} skill assignments in Classroom`, 'success');
        driveSync.markDirty();
        this.updateSkillLinkStatus();
    },

    createPPAssignment: async function() {
        const courseId = document.getElementById('fe-classroom-course').value;
        const activityId = this._savedActivityId();
        if (!courseId) {
            ui.showToast('Select a Classroom course first', 'warning');
            return;
        }
        if (!activityId) {
            ui.showToast('Save the assignment first, then create its Classroom assignments.', 'warning');
            return;
        }

        const activity = await db.activities.get(activityId);
        if (!activity) return;

        // Check if already linked (its own field: classroomLinks is the assignment's own Classroom link)
        if (activity.ppClassroomLinks && activity.ppClassroomLinks[courseId]) {
            ui.showToast('PP assignment already linked to this course', 'info');
            return;
        }

        const webhookUrl = localStorage.getItem('webhook_wildcat');
        const token = localStorage.getItem('webhook_token') || '';
        const ppCatId = localStorage.getItem('classroom-pp-category-' + courseId) || '';
        const ppCatName = document.getElementById('fe-pp-grade-category')?.selectedOptions?.[0]?.dataset?.name || 'Professional Practice';

        if (!webhookUrl) {
            ui.showToast('No webhook URL configured', 'error');
            return;
        }

        // The activity's contract code (i106); older activities without one: the name's code, or the name
        const contractCode = String(activity.contractCode || '').trim() || activity.name?.match(/^[A-Z]\d+/)?.[0] || activity.name || 'Activity';

        const btn = document.getElementById('fe-create-pp-assignment-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

        try {
            const payload = {
                token: token,
                action: 'create_classroom_coursework',
                courseId: courseId,
                title: `${contractCode}: Professional Practice`,
                description: 'Holistic assessment of checkpoint completion, pacing, deliverables, and teamwork',
                maxPoints: 100,
                publishState: 'PUBLISHED'
            };
            if (ppCatId) {
                payload.gradeCategory = { id: ppCatId, name: ppCatName };
            }

            const resp = await webhookFetch(webhookUrl, { method: 'POST', body: JSON.stringify(payload) });
            const result = await resp.json();

            if (result.status === 'success') {
                const links = { ...(activity.ppClassroomLinks || {}) };
                links[courseId] = result.courseworkId;
                await db.activities.update(activity.id, { ppClassroomLinks: links, updatedAt: new Date().toISOString() });
                ui.showToast(`✅ Created PP assignment in Classroom`, 'success');
                driveSync.markDirty();
            } else {
                ui.showToast('Failed: ' + (result.message || 'Unknown error'), 'error');
            }
        } catch (err) {
            ui.showToast('Error: ' + err.message, 'error');
        }

        if (btn) { btn.disabled = false; btn.textContent = 'Create PP Assignment'; }
        this.updateSkillLinkStatus();
    },
};
