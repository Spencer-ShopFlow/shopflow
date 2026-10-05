// ----------------------------------------
// CHECKPOINT MARKING PAGE
// ----------------------------------------
pages.checkpoint = {
    selectedClass: null,
    selectedActivity: null,
    selectedTeam: null,
    selectedCheckpoint: null,
    teamMembers: [],
    activityFilter: 'active',
    _preloadedData: null,
    _preloadPromise: null,        // DL5: the activity's saved progress, loading
    _renderedCheckpointId: null,  // DL5: the checkpoint whose student list is drawn from loaded data
    _saving: false,               // DL5: one save at a time
    _loadedSkillRatings: {},      // DL6: the ratings as saved, to compare against on Save
    _selectedPacing: null,
    _pendingSkillRatings: {},   // { `${studentId}-${skillId}`: rating }
    _pendingCertDemos: {},      // { `${studentId}-${toolId}`: true/false }

    render: async function() {
        this.reset();
        await this.renderClassButtons();
        await this.autoSelect();
    },

    renderClassButtons: async function() {
        const container = document.getElementById('checkpoint-class-buttons');
        if (!container) return;

        const classes = (await db.classes.toArray()).filter(c => c.status !== 'archived');
        container.innerHTML = '';

        if (classes.length === 0) {
            container.innerHTML = '<p style="color: var(--color-text-secondary); padding: var(--space-base);">No classes found. <a href="#" onclick="router.navigate(\'settings\'); setTimeout(() => { const tab = document.querySelector(\'[data-tab=\\\'classes\\\']\'); if (tab) tab.click(); }, 100); return false;" style="color: var(--color-primary); text-decoration: underline;">Go to Settings → Classes</a> to create your first class.</p>';
            return;
        }

        classes.forEach(cls => {
            const btn = document.createElement('button');
            btn.className = 'btn btn--secondary checkpoint-year-btn';
            btn.dataset.classId = cls.id;
            btn.textContent = cls.name;
            btn.onclick = () => pages.checkpoint.selectClass(cls);
            container.appendChild(btn);
        });
    },

    autoSelect: async function() {
        await pages.dashboard.updateCurrentPeriod();

        if (!state.currentPeriod || state.currentPeriod === 'wildcat') return;

        try {
            // Find class that owns the current period
            const allClasses = (await db.classes.toArray()).filter(c => c.status !== 'archived');
            const matchingClass = allClasses.find(cls =>
                (cls.periods || []).includes(String(state.currentPeriod))
            );

            if (!matchingClass) return;

            await this.selectClass(matchingClass);

            // Auto-select active activity for this class
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const allActivities = await db.activities.toArray();
            const classActivities = allActivities.filter(a => a.classId === matchingClass.id);

            const activeActivity = classActivities.find(a => {
                const startParts = a.startDate.split('-');
                const endParts = a.endDate.split('-');
                const startDate = new Date(startParts[0], startParts[1] - 1, startParts[2]);
                const endDate = new Date(endParts[0], endParts[1] - 1, endParts[2]);
                return today >= startDate && today <= endDate;
            });

            if (activeActivity) {
                await this.selectActivity(activeActivity);
            }

        } catch (error) {
            console.error('Error auto-selecting:', error);
        }
    },

    reset: function() {
        this.selectedClass = null;
        this.selectedActivity = null;
        this.selectedTeam = null;
        this.selectedCheckpoint = null;
        this.teamMembers = [];
        this._preloadedData = null;
        this._preloadPromise = null;
        this._renderedCheckpointId = null;
        this._selectedPacing = null;
        this._pendingSkillRatings = {};
        this._loadedSkillRatings = {};
        this._pendingCertDemos = {};

        document.getElementById('checkpoint-step-year').classList.remove('hidden');
        document.getElementById('checkpoint-step-activity').classList.add('hidden');
        document.getElementById('checkpoint-step-team').classList.add('hidden');
        document.getElementById('checkpoint-step-checkpoint').classList.add('hidden');
        document.getElementById('checkpoint-step-students').classList.add('hidden');

        document.querySelectorAll('.checkpoint-year-btn').forEach(btn => btn.classList.remove('active'));
    },

    selectClass: async function(cls) {
        this.selectedClass = cls;
        this.selectedActivity = null;
        this.selectedTeam = null;
        this.selectedCheckpoint = null;

        document.getElementById('checkpoint-step-team').classList.add('hidden');
        document.getElementById('checkpoint-step-checkpoint').classList.add('hidden');
        document.getElementById('checkpoint-step-students').classList.add('hidden');

        // Highlight selected button
        document.querySelectorAll('.checkpoint-year-btn').forEach(btn => {
            const isActive = parseInt(btn.dataset.classId) === cls.id;
            btn.classList.toggle('active', isActive);
        });

        // Load activities for this class
        try {
            const allActivities = await db.activities.toArray();
            const classActivities = allActivities.filter(a => a.classId === cls.id);

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            let filteredActivities = classActivities;

            if (this.activityFilter !== 'all') {
                filteredActivities = classActivities.filter(a => {
                    const startParts = a.startDate.split('-');
                    const endParts = a.endDate.split('-');
                    const startDate = new Date(startParts[0], startParts[1] - 1, startParts[2]);
                    const endDate = new Date(endParts[0], endParts[1] - 1, endParts[2]);

                    if (this.activityFilter === 'active') return today >= startDate && today <= endDate;
                    if (this.activityFilter === 'past') return today > endDate;
                    if (this.activityFilter === 'upcoming') return today < startDate;
                    return true;
                });
            }

            const container = document.getElementById('checkpoint-activities-list');
            container.innerHTML = '';

            if (filteredActivities.length === 0) {
                container.innerHTML = '<p style="color: var(--color-text-tertiary);">No assignments found for this class.</p>';
            } else {
                filteredActivities.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
                filteredActivities.forEach(activity => {
                    const btn = document.createElement('button');
                    btn.className = 'btn btn--secondary checkpoint-activity-btn';
                    btn.style.marginRight = 'var(--space-sm)';
                    btn.style.marginBottom = 'var(--space-sm)';
                    btn.textContent = activity.name;
                    btn.dataset.activityId = activity.id;
                    btn.onclick = () => pages.checkpoint.selectActivity(activity);
                    container.appendChild(btn);
                });
            }

            document.getElementById('checkpoint-step-activity').classList.remove('hidden');

        } catch (error) {
            console.error('Error loading activities:', error);
            ui.showToast('Failed to load activities', 'error');
        }
    },

    filterActivities: function(filter) {
        this.activityFilter = filter;

        document.querySelectorAll('.checkpoint-activity-filter').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });

        if (this.selectedClass) {
            this.selectClass(this.selectedClass);
        }
    },

    selectActivity: async function(activity) {
        this.selectedActivity = activity;
        this.selectedTeam = null;
        this.selectedCheckpoint = null;
        this._renderedCheckpointId = null;
        // DL5: start loading saved progress now; a checkpoint waits for it before drawing its list
        this._preloadedData = null;
        this._preloadPromise = this._preloadActivityData(activity);

        document.getElementById('checkpoint-step-checkpoint').classList.add('hidden');
        document.getElementById('checkpoint-step-students').classList.add('hidden');

        document.querySelectorAll('.checkpoint-activity-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.activityId == activity.id);
        });

        // Load teams for this class
        try {
            const allTeams = await db.teams.toArray();
            const teams = allTeams
                .filter(t => !t.deletedAt && t.classId === this.selectedClass.id)
                .sort((a, b) => a.name.localeCompare(b.name));

            const container = document.getElementById('checkpoint-teams-list');
            container.innerHTML = '';

            if (teams.length === 0) {
                container.innerHTML = '<p style="color: var(--color-text-tertiary);">No groups found for this class.</p>';
            } else {
                teams.forEach(team => {
                    const btn = document.createElement('button');
                    btn.className = 'btn btn--secondary checkpoint-team-btn';
                    btn.style.marginRight = 'var(--space-sm)';
                    btn.style.marginBottom = 'var(--space-sm)';
                    btn.textContent = team.name;
                    btn.dataset.teamId = team.id;
                    btn.onclick = () => pages.checkpoint.selectTeam(team);
                    container.appendChild(btn);
                });
            }

            document.getElementById('checkpoint-step-team').classList.remove('hidden');

            // Sprint 19.2: Pre-load all skill/cert/completion data for this activity (started above)
            await this._preloadPromise;

        } catch (error) {
            console.error('Error loading teams:', error);
            ui.showToast('Failed to load teams', 'error');
        }
    },

    selectTeam: async function(team) {
        this.selectedTeam = team;
        this.selectedCheckpoint = null;
        this._renderedCheckpointId = null;
        document.getElementById('checkpoint-step-students').classList.add('hidden');

        document.querySelectorAll('.checkpoint-team-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.teamId == team.id);
        });

        try {
            const teamMemberRecords = await db.teamMembers.where('teamId').equals(team.id).toArray();
            const allStudents = excludeDeleted(await db.students.toArray());
            this.teamMembers = allStudents
                .filter(s => teamMemberRecords.map(tm => tm.studentId).includes(s.id))
                .sort(sortByStudentName);

            const checkpoints = await db.checkpoints
                .where('activityId')
                .equals(this.selectedActivity.id)
                .toArray();
            checkpoints.sort((a, b) => a.number - b.number);

            const container = document.getElementById('checkpoint-checkpoints-list');
            container.innerHTML = '';

            if (checkpoints.length === 0) {
                container.innerHTML = '<p style="color: var(--color-text-tertiary);">No checkpoints for this assignment.</p>';
            } else {
                checkpoints.forEach(cp => {
                    const btn = document.createElement('button');
                    btn.className = 'btn btn--secondary checkpoint-checkpoint-btn';
                    btn.style.marginRight = 'var(--space-sm)';
                    btn.style.marginBottom = 'var(--space-sm)';
                    btn.textContent = `${cp.number}. ${cp.title}`;
                    btn.dataset.checkpointId = cp.id;
                    btn.onclick = () => pages.checkpoint.selectCheckpoint(cp);
                    container.appendChild(btn);
                });
            }

            document.getElementById('checkpoint-step-checkpoint').classList.remove('hidden');

        } catch (error) {
            console.error('Error loading checkpoints:', error);
            ui.showToast('Failed to load checkpoints', 'error');
        }
    },

    selectCheckpoint: async function(checkpoint) {
        this.selectedCheckpoint = checkpoint;
        this._renderedCheckpointId = null;

        // DL5: draw the list only from this activity's saved progress. Tapped too early, the list
        // showed everyone as not done, and Save then marked finished students incomplete.
        if (this._preloadPromise) await this._preloadPromise;
        if (!this._preloadedData || this._preloadedData.activityId !== this.selectedActivity.id) {
            this._preloadPromise = this._preloadActivityData(this.selectedActivity);
            await this._preloadPromise;
        }
        if (this.selectedCheckpoint !== checkpoint) return;   // another checkpoint was tapped meanwhile
        if (!this._preloadedData) {
            document.getElementById('checkpoint-step-students').classList.add('hidden');
            ui.showToast("Couldn't load this assignment's saved progress. Tap the checkpoint again.", 'error');
            return;
        }

        this._selectedPacing = null;
        this._pendingSkillRatings = {};
        this._loadedSkillRatings = {};
        this._pendingCertDemos = {};

        document.querySelectorAll('.checkpoint-checkpoint-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.checkpointId == checkpoint.id);
        });

        document.getElementById('checkpoint-current-title').textContent =
            `${this.selectedTeam.name} — ${this.selectedActivity.name} — Checkpoint ${checkpoint.number}: ${checkpoint.title}`;

        // ── Milestone display ──
        const milestoneDiv = document.getElementById('checkpoint-milestone');
        if (checkpoint.milestone && checkpoint.milestone.trim()) {
            milestoneDiv.textContent = '🎯 Milestone: ' + checkpoint.milestone;
            milestoneDiv.style.display = '';
        } else {
            milestoneDiv.style.display = 'none';
        }

        // ── LookFor collapsible ──
        const lookForEl = document.getElementById('checkpoint-lookfor');
        if (checkpoint.lookFor && checkpoint.lookFor.trim()) {
            document.getElementById('checkpoint-lookfor-body').textContent = checkpoint.lookFor;
            lookForEl.style.display = '';
            lookForEl.removeAttribute('open');
        } else {
            lookForEl.style.display = 'none';
        }

        // ── Questions ──
        const questionsDiv = document.getElementById('checkpoint-questions');
        if (checkpoint.questions && (Array.isArray(checkpoint.questions) ? checkpoint.questions.length > 0 : checkpoint.questions.trim())) {
            if (Array.isArray(checkpoint.questions)) {
                let qaHtml = `<table style="width: 100%; border-collapse: collapse; font-size: var(--font-size-body-small);">
                    <thead><tr>
                        <th style="text-align: left; padding: var(--space-xs) var(--space-sm); border-bottom: 2px solid var(--color-border); width: 40px;"></th>
                        <th style="text-align: left; padding: var(--space-xs) var(--space-sm); border-bottom: 2px solid var(--color-border);">Teacher Asks / Checks</th>
                        <th style="text-align: left; padding: var(--space-xs) var(--space-sm); border-bottom: 2px solid var(--color-border);">Student Should Answer / Demo</th>
                    </tr></thead><tbody>`;
                checkpoint.questions.forEach((qa, i) => {
                    qaHtml += `<tr>
                        <td style="padding: var(--space-xs) var(--space-sm); border-bottom: 1px solid var(--color-border); vertical-align: top;">
                            <input type="checkbox" style="cursor: pointer;" title="Visual reference only" data-no-dirty>
                        </td>
                        <td style="padding: var(--space-xs) var(--space-sm); border-bottom: 1px solid var(--color-border); vertical-align: top;">${escapeHtml(qa.question || '')}</td>
                        <td style="padding: var(--space-xs) var(--space-sm); border-bottom: 1px solid var(--color-border); vertical-align: top; color: var(--color-text-secondary);">${escapeHtml(qa.expectedResponse || '')}</td>
                    </tr>`;
                });
                qaHtml += '</tbody></table>';
                questionsDiv.innerHTML = qaHtml;
            } else {
                questionsDiv.innerHTML = `<strong>Questions/Criteria:</strong><p style="margin-top: var(--space-xs);">${escapeHtml(checkpoint.questions)}</p>`;
            }
        } else {
            questionsDiv.innerHTML = '';
        }

        // ── Pacing: restore previous value if it exists ──
        document.querySelectorAll('.checkpoint__pacing-btn').forEach(b => b.classList.remove('active'));
        const preloaded = this._preloadedData || {};
        const existingCompletions = (preloaded.completions || []).filter(c => c.checkpointId === checkpoint.id);
        const completedStudentIds = existingCompletions.filter(c => c.completed).map(c => c.studentId);

        // Read pacing from any existing completion for this team
        const teamMemberIds = this.teamMembers.map(s => s.id);
        const teamCompletion = existingCompletions.find(c => teamMemberIds.includes(c.studentId) && c.pacing);
        if (teamCompletion && teamCompletion.pacing) {
            this._selectedPacing = teamCompletion.pacing;
            const pacingBtn = document.querySelector(`.checkpoint__pacing-btn[data-pacing="${teamCompletion.pacing}"]`);
            if (pacingBtn) pacingBtn.classList.add('active');
        }

        // ── Determine assessable skills for this checkpoint ──
        const skillsAssessable = checkpoint.skillsAssessable || [];
        const allSkills = preloaded.skills || [];
        const assessableSkills = allSkills.filter(s => skillsAssessable.includes(s.id));

        // ── Determine certification demos for this checkpoint ──
        const certDemoToolIds = checkpoint.certificationDemos || [];
        const allTools = preloaded.tools || [];
        const certTools = allTools.filter(t => certDemoToolIds.includes(t.id));

        // ── Build student list ──
        const container = document.getElementById('checkpoint-students-list');
        container.innerHTML = '';

        try {
            this.teamMembers.forEach(student => {
                const isComplete = completedStudentIds.includes(student.id);
                const wrapper = document.createElement('div');
                wrapper.className = `checkpoint__student-wrapper ${isComplete ? 'checkpoint__student-wrapper--complete' : ''}`;
                wrapper.id = `checkpoint-student-${student.id}`;

                // ── Main row: checkbox + name + badge + assess button ──
                let actionsHtml = '';
                if (assessableSkills.length > 0) {
                    actionsHtml += `<button type="button" class="checkpoint__assess-btn" id="assess-btn-${student.id}" onclick="pages.checkpoint.toggleSkillsPanel(${student.id})">Assess Skills</button>`;
                }
                actionsHtml += isComplete
                    ? '<span class="badge badge--success">Complete</span>'
                    : '<span class="badge badge--warning">Pending</span>';

                let mainHtml = `
                    <div class="checkpoint__student-main">
                        <input type="checkbox"
                            id="check-${student.id}"
                            ${isComplete ? 'checked' : ''}
                            onchange="pages.checkpoint.toggleStudent(${student.id}, this.checked)">
                        <label for="check-${student.id}" class="checkpoint__student-name">
                            ${escapeHtml(displayName(student))}
                        </label>
                        <div class="checkpoint__student-actions">
                            ${actionsHtml}
                        </div>
                    </div>
                `;

                // ── Quick note ──
                mainHtml += `<input type="text" class="checkpoint__quick-note" id="note-${student.id}" placeholder="Quick note..." maxlength="200">`;

                // ── Skills panel (collapsed by default) ──
                if (assessableSkills.length > 0) {
                    let skillsHtml = `<div class="checkpoint__skills-panel" id="skills-panel-${student.id}">`;
                    assessableSkills.forEach(skill => {
                        // Find current level from preloaded skillLevels
                        const currentLevel = (preloaded.skillLevels || []).find(
                            sl => sl.studentId === student.id && sl.skillId === skill.id
                        );
                        const levelText = currentLevel ? currentLevel.level : 'Not Assessed';
                        const levelColor = this._getLevelColor(currentLevel ? currentLevel.level : null);

                        // Check for existing observation for this checkpoint
                        const existingObs = (preloaded.skillObservations || []).find(
                            o => o.studentId === student.id && o.skillId === skill.id && o.checkpointId === checkpoint.id
                        );
                        const activeRating = existingObs ? existingObs.rating : null;
                        if (existingObs) {
                            this._pendingSkillRatings[`${student.id}-${skill.id}`] = existingObs.rating;
                            this._loadedSkillRatings[`${student.id}-${skill.id}`] = existingObs.rating;
                        }

                        // Look up level descriptors from activity.skillsAssessed
                        const skillAssessedInfo = (this.selectedActivity.skillsAssessed || []).find(
                            sa => sa.skillId === skill.id
                        );
                        const hasRubric = skillAssessedInfo && skillAssessedInfo.levels && Object.keys(skillAssessedInfo.levels).length > 0;
                        const rubricId = `rubric-${student.id}-${skill.id}`;

                        skillsHtml += `
                            <div class="checkpoint__skill-row-wrapper">
                                <div class="checkpoint__skill-row">
                                    <span class="checkpoint__skill-name ${hasRubric ? 'checkpoint__skill-name--tappable' : ''}" ${hasRubric ? `onclick="pages.checkpoint.toggleRubric('${rubricId}')"` : ''}>
                                        ${hasRubric ? '<span class="checkpoint__rubric-chevron" id="chevron-' + rubricId + '">▶</span> ' : ''}${escapeHtml(skill.name)}
                                    </span>
                                    <span class="checkpoint__skill-current" style="background: ${levelColor}15; color: ${levelColor};" id="skill-current-${student.id}-${skill.id}">${escapeHtml(levelText)}</span>
                                    <div class="checkpoint__skill-buttons">
                                        ${['Beginning', 'Developing', 'Proficient', 'Advanced'].map(r => {
                                            const abbr = r.charAt(0);
                                            const isActive = activeRating === r ? ' active' : '';
                                            return `<button type="button"
                                                class="checkpoint__skill-btn checkpoint__skill-btn--${abbr}${isActive}"
                                                id="skill-btn-${student.id}-${skill.id}-${abbr}"
                                                title="${r}"
                                                onclick="pages.checkpoint.setSkillRating(${student.id}, ${skill.id}, '${r}')">${abbr}</button>`;
                                        }).join('')}
                                    </div>
                                </div>
                                ${hasRubric ? `
                                <div class="checkpoint__rubric" id="${rubricId}">
                                    ${['Beginning', 'Developing', 'Proficient', 'Advanced'].map(level => {
                                        const desc = skillAssessedInfo.levels[level];
                                        if (!desc) return '';
                                        const abbr = level.charAt(0);
                                        const color = this._getLevelColor(level);
                                        return `<div class="checkpoint__rubric-level">
                                            <span class="checkpoint__rubric-badge checkpoint__skill-btn--${abbr}" style="background: ${color}20; color: ${color}; border-color: ${color};">${abbr}</span>
                                            <span class="checkpoint__rubric-label" style="color: ${color}; font-weight: 600;">${level}:</span>
                                            <span class="checkpoint__rubric-desc">${escapeHtml(desc)}</span>
                                        </div>`;
                                    }).join('')}
                                </div>` : ''}
                            </div>
                        `;
                    });
                    skillsHtml += '</div>';
                    mainHtml += skillsHtml;
                }

                // ── Certification demo toggles ──
                if (certTools.length > 0) {
                    certTools.forEach(tool => {
                        const existingCert = (preloaded.certifications || []).find(
                            c => c.studentId === student.id && c.toolId === tool.id
                        );
                        const isChecked = existingCert ? true : false;
                        if (isChecked) {
                            this._pendingCertDemos[`${student.id}-${tool.id}`] = true;
                        }
                        mainHtml += `
                            <div class="checkpoint__cert-row">
                                <label>
                                    <input type="checkbox" id="cert-${student.id}-${tool.id}"
                                        ${isChecked ? 'checked' : ''}
                                        onchange="pages.checkpoint.setCertDemo(${student.id}, ${tool.id}, this.checked)">
                                    🏅 ${escapeHtml(tool.name)} Certification Demo
                                </label>
                            </div>
                        `;
                    });
                }

                wrapper.innerHTML = mainHtml;

                // Attach swipe gestures to the main row
                const mainRow = wrapper.querySelector('.checkpoint__student-main');
                gestures.makeSwipeable(mainRow, {
                    onSwipeRight: () => {
                        const cb = document.getElementById(`check-${student.id}`);
                        if (cb && !cb.checked) {
                            cb.checked = true;
                            pages.checkpoint.toggleStudent(student.id, true);
                        }
                    },
                    onSwipeLeft: () => {
                        const cb = document.getElementById(`check-${student.id}`);
                        if (cb && cb.checked) {
                            cb.checked = false;
                            pages.checkpoint.toggleStudent(student.id, false);
                        }
                    },
                    rightColor: 'var(--color-success)',
                    leftColor: 'var(--color-warning)',
                    rightIcon: '✓',
                    leftIcon: '↩',
                    ignoreSelector: 'input[type="checkbox"], button, .checkpoint__assess-btn'
                });

                container.appendChild(wrapper);
            });

            document.getElementById('checkpoint-step-students').classList.remove('hidden');
            this._renderedCheckpointId = checkpoint.id;

        } catch (error) {
            console.error('Error loading completions:', error);
            ui.showToast('Failed to load student progress', 'error');
        }
    },

    toggleStudent: function(studentId, isChecked) {
        const wrapper = document.getElementById(`checkpoint-student-${studentId}`);
        if (!wrapper) return;
        if (isChecked) {
            wrapper.classList.add('checkpoint__student-wrapper--complete');
            wrapper.querySelector('.badge').className = 'badge badge--success';
            wrapper.querySelector('.badge').textContent = 'Complete';
        } else {
            wrapper.classList.remove('checkpoint__student-wrapper--complete');
            wrapper.querySelector('.badge').className = 'badge badge--warning';
            wrapper.querySelector('.badge').textContent = 'Pending';
        }
    },

    markAllComplete: function() {
        this.teamMembers.forEach(student => {
            const checkbox = document.getElementById(`check-${student.id}`);
            if (checkbox && !checkbox.checked) {
                checkbox.checked = true;
                this.toggleStudent(student.id, true);
            }
        });
    },

    saveProgress: async function() {
        // DL5: one save at a time — a double-tap wrote every row twice
        if (this._saving) return;
        const checkpoint = this.selectedCheckpoint;
        const activity = this.selectedActivity;
        // DL5: never save a list that wasn't drawn from the saved progress
        if (!checkpoint || !activity || this._renderedCheckpointId !== checkpoint.id) {
            ui.showToast('Still loading — wait for the student list, then save', 'warning');
            return;
        }
        const saveBtn = document.getElementById('checkpoint-save-btn');
        this._saving = true;
        if (saveBtn) saveBtn.disabled = true;

        try {
            const checkpointId = checkpoint.id;
            const activityId = activity.id;
            const now = new Date().toISOString();
            const pacing = this._selectedPacing;
            const logs = [];
            let completionCount = 0;
            let skillObsCount = 0;
            let removedCount = 0;
            let certCount = 0;
            let noteCount = 0;

            // Read the screen once, before any waiting
            const marks = this.teamMembers.map(student => {
                const checkbox = document.getElementById(`check-${student.id}`);
                const noteInput = document.getElementById(`note-${student.id}`);
                return {
                    studentId: student.id,
                    isComplete: checkbox ? checkbox.checked : false,
                    noteInput,
                    note: noteInput ? noteInput.value.trim() : ''
                };
            });
            const certs = Object.entries(this._pendingCertDemos)
                .filter(([, passed]) => passed)
                .map(([key]) => key.split('-').map(n => parseInt(n)));

            // DL6: only ratings that changed since the list was drawn; a deselected rating is removed
            const toSet = [];
            const toRemove = [];
            for (const [key, rating] of Object.entries(this._pendingSkillRatings)) {
                if (this._loadedSkillRatings[key] !== rating) toSet.push({ key, rating });
            }
            for (const key of Object.keys(this._loadedSkillRatings)) {
                if (!(key in this._pendingSkillRatings)) toRemove.push(key);
            }
            const ids = key => key.split('-').map(n => parseInt(n));

            // DL6: ask about lowering current levels once, before saving, not once per student mid-save
            const levelValues = { 'Beginning': 1, 'Developing': 2, 'Proficient': 3, 'Advanced': 4 };
            let downgrades = 0;
            for (const { key, rating } of toSet) {
                const [studentId, skillId] = ids(key);
                const current = await db.skillLevels.where('studentId').equals(studentId).and(sl => sl.skillId === skillId).first();
                if (current && (levelValues[rating] || 0) < (levelValues[current.level] || 0)) downgrades++;
            }
            let lowerLevels = false;
            if (downgrades > 0) {
                lowerLevels = confirm(
                    `${downgrades} rating${downgrades !== 1 ? 's are' : ' is'} below the student's current level. ` +
                    `Lower the current level to match? This is unusual — current best normally only goes up.\n\n` +
                    `OK: lower it. Cancel: keep the current level. The ratings are saved either way.`
                );
            }

            const badges = [];
            await db.transaction('rw', [db.checkpointCompletions, db.skillObservations, db.skillLevels, db.certifications, db.notes], async () => {
                // ── 1. Completions + pacing (DL5: a finished student keeps the date they finished) ──
                for (const m of marks) {
                    if (m.isComplete) completionCount++;
                    const rows = await db.checkpointCompletions
                        .where('[checkpointId+studentId]')
                        .equals([checkpointId, m.studentId])
                        .toArray();
                    if (rows.length === 0) {
                        await db.checkpointCompletions.add({
                            checkpointId: checkpointId,
                            studentId: m.studentId,
                            completed: m.isComplete,
                            completedAt: m.isComplete ? now : null,
                            pacing: pacing,
                            createdAt: now,
                            updatedAt: now
                        });
                        continue;
                    }
                    // Older double-saves may have left two rows; keep them in step
                    for (const row of rows) {
                        const completedAt = m.isComplete ? ((row.completed && row.completedAt) ? row.completedAt : now) : null;
                        if (!!row.completed === m.isComplete && (row.completedAt || null) === completedAt &&
                            (row.pacing || null) === (pacing || null)) continue;   // nothing changed
                        await db.checkpointCompletions.update(row.id, {
                            completed: m.isComplete,
                            completedAt: completedAt,
                            pacing: pacing,
                            updatedAt: now
                        });
                    }
                }

                // ── 2. Skill ratings: changed ones only ──
                for (const { key, rating } of toSet) {
                    const [studentId, skillId] = ids(key);
                    const badge = await this._saveSkillObservation(studentId, skillId, activityId, checkpointId, rating, now, lowerLevels);
                    if (badge) badges.push(badge);
                    logs.push(['create', 'skillObservation', skillId, `Rated student ${studentId} as ${rating} on skill ${skillId}`]);
                    skillObsCount++;
                }
                // Deselected: marked deleted, so the removal reaches the other device (deleted wins in sync)
                for (const key of toRemove) {
                    const [studentId, skillId] = ids(key);
                    const rows = (await db.skillObservations.where('[studentId+skillId]').equals([studentId, skillId]).toArray())
                        .filter(o => o.checkpointId === checkpointId && !o.deletedAt);
                    for (const o of rows) await db.skillObservations.update(o.id, { deletedAt: now, updatedAt: now });
                    if (rows.length) {
                        removedCount++;
                        logs.push(['delete', 'skillObservation', skillId, `Removed a checkpoint rating for student ${studentId} on skill ${skillId}`]);
                    }
                }

                // ── 3. Certification demos ──
                for (const [studentId, toolId] of certs) {
                    const existingCert = await db.certifications
                        .where('studentId').equals(studentId)
                        .and(c => c.toolId === toolId)
                        .first();
                    if (!existingCert) {
                        await db.certifications.add({
                            studentId: studentId,
                            toolId: toolId,
                            certifiedAt: now,
                            activityId: activityId,
                            checkpointId: checkpointId,
                            createdAt: now,
                            updatedAt: now
                        });
                        certCount++;
                        logs.push(['create', 'certification', toolId, `Certified student ${studentId} on tool ${toolId} at checkpoint`]);
                    }
                }

                // ── 4. Quick notes (cleared once saved, below) ──
                for (const m of marks) {
                    if (!m.note) continue;
                    await db.notes.add({
                        entityType: 'checkpoint-observation',
                        entityId: m.studentId,
                        content: m.note,
                        activityId: activityId,
                        checkpointId: checkpointId,
                        createdAt: now,
                        updatedAt: now
                    });
                    noteCount++;
                    logs.push(['create', 'note', m.studentId, `Checkpoint note for student ${m.studentId}`]);
                }
            });

            // Saved. DL5: a note is saved once — clear its box so the next Save doesn't add it again
            marks.forEach(m => { if (m.note && m.noteInput && m.noteInput.value.trim() === m.note) m.noteInput.value = ''; });
            // The screen's ratings are now the saved ones
            // META 29 Sep: removing a rating doesn't change the current level. Say so when the
            // removed rating is the one that set it (same level, from this assignment).
            const levelsKept = [];
            for (const key of toRemove) {
                const [studentId, skillId] = ids(key);
                const level = await db.skillLevels.where('studentId').equals(studentId).and(sl => sl.skillId === skillId).first();
                if (level && level.demonstratedIn === activityId && level.level === this._loadedSkillRatings[key]) levelsKept.push(level.level);
            }
            this._loadedSkillRatings = { ...this._pendingSkillRatings };
            badges.forEach(b => this._showLevelBadge(b.studentId, b.skillId, b.level));

            // ── 5. Write discipline: markDirty ──
            driveSync.markDirty();

            // ── 6. Summary toast ──
            const parts = [`${completionCount} completion${completionCount !== 1 ? 's' : ''}`];
            if (pacing) parts.push(`pacing: ${pacing}`);
            if (skillObsCount > 0) parts.push(`${skillObsCount} skill rating${skillObsCount !== 1 ? 's' : ''}`);
            if (removedCount > 0) parts.push(`${removedCount} rating${removedCount !== 1 ? 's' : ''} removed`);
            if (certCount > 0) parts.push(`${certCount} cert demo${certCount !== 1 ? 's' : ''}`);
            if (noteCount > 0) parts.push(`${noteCount} note${noteCount !== 1 ? 's' : ''}`);
            ui.showToast(`Saved: ${parts.join(', ')}`, 'success');
            if (levelsKept.length === 1) {
                ui.showToast(`The level stays at ${levelsKept[0]}; change it on the Skills page if needed.`, 'info', 8000);
            } else if (levelsKept.length > 1) {
                ui.showToast(`${levelsKept.length} removed ratings had set a current level. The levels stay as they are; change them on the Skills page if needed.`, 'info', 8000);
            }

            if (typeof guards !== 'undefined') guards.markClean('page-checkpoint');   // 3-15: saved, so leaving doesn't ask
            for (const l of logs) await logAction(...l);
            await logAction('update', 'checkpointCompletions', checkpointId,
                `Saved checkpoint ${checkpoint.number}: ${parts.join(', ')}`);

            // ── 7. Refresh preloaded data and alerts ──
            await this._preloadActivityData(activity);
            alertsEngine.refresh().then(() => {
                if (typeof pages !== 'undefined' && pages.dashboard && pages.dashboard.loadAlerts) {
                    pages.dashboard.loadAlerts();
                }
            });

        } catch (error) {
            console.error('Error saving progress:', error);
            ui.showToast('Failed to save progress — nothing was saved. Try again.', 'error');
        } finally {
            this._saving = false;
            if (saveBtn) saveBtn.disabled = false;
        }
    },

    // ═══════════════════════════════════════════
    // Sprint 19.2: New helper methods
    // ═══════════════════════════════════════════

    setPacing: function(pacing) {
        this._selectedPacing = pacing;
        document.querySelectorAll('.checkpoint__pacing-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.pacing === pacing);
        });
    },

   toggleRubric: function(rubricId) {
        const rubric = document.getElementById(rubricId);
        const chevron = document.getElementById('chevron-' + rubricId);
        if (!rubric) return;
        const isOpen = rubric.classList.contains('open');
        rubric.classList.toggle('open', !isOpen);
        if (chevron) chevron.textContent = isOpen ? '▶' : '▼';
    }, 

    toggleSkillsPanel: function(studentId) {
        const panel = document.getElementById(`skills-panel-${studentId}`);
        const btn = document.getElementById(`assess-btn-${studentId}`);
        if (!panel) return;

        const isOpen = panel.classList.contains('open');
        panel.classList.toggle('open', !isOpen);
        if (btn) btn.classList.toggle('active', !isOpen);
    },

    setSkillRating: function(studentId, skillId, rating) {
        const key = `${studentId}-${skillId}`;
        const currentPending = this._pendingSkillRatings[key];

        // If tapping the same rating, deselect it
        if (currentPending === rating) {
            delete this._pendingSkillRatings[key];
            // Clear all buttons for this skill
            ['B', 'D', 'P', 'A'].forEach(a => {
                const b = document.getElementById(`skill-btn-${studentId}-${skillId}-${a}`);
                if (b) b.classList.remove('active');
            });
            return;
        }

        this._pendingSkillRatings[key] = rating;

        // Update button highlights
        ['B', 'D', 'P', 'A'].forEach(a => {
            const b = document.getElementById(`skill-btn-${studentId}-${skillId}-${a}`);
            if (b) b.classList.toggle('active', a === rating.charAt(0));
        });
    },

    setCertDemo: function(studentId, toolId, checked) {
        this._pendingCertDemos[`${studentId}-${toolId}`] = checked;
    },

    _getLevelColor: function(level) {
        const colors = {
            'Beginning': 'var(--color-error)',
            'Developing': 'var(--color-info)',
            'Proficient': 'var(--color-success)',
            'Advanced': '#f59e0b'
        };
        return colors[level] || 'var(--color-text-tertiary)';
    },

    _preloadActivityData: async function(activity) {
        try {
            const activityId = activity.id;
            const classId = this.selectedClass.id;

            // All checkpoint IDs for this activity
            const checkpoints = await db.checkpoints.where('activityId').equals(activityId).toArray();
            const checkpointIds = checkpoints.map(c => c.id);

            // All students in this class
            const allStudents = excludeDeleted(await db.students.toArray());
            const classStudents = allStudents.filter(s => s.classId === classId);
            const studentIds = classStudents.map(s => s.id);

            // Completions for all checkpoints in this activity
            const allCompletions = await db.checkpointCompletions.toArray();
            const completions = allCompletions.filter(c => checkpointIds.includes(c.checkpointId));

            // Skill levels for class students
            const allSkillLevels = (await db.skillLevels.toArray()).filter(isLevelLive);
            const skillLevels = allSkillLevels.filter(sl => studentIds.includes(sl.studentId));

            // Skill observations for this activity
            // DL6: a removed rating is kept with deletedAt (so the removal syncs) and never shown
            const allSkillObs = excludeDeleted(await db.skillObservations.where('activityId').equals(activityId).toArray());

            // Visible skills only: a retired or merged-away skill is never offered for rating (P16 C3)
            const skills = await getVisibleSkills();

            // Certifications for class students
            const allCerts = await db.certifications.toArray();
            const certifications = allCerts.filter(c => studentIds.includes(c.studentId));

            // Tools (for cert demo names)
            let tools = [];
            if (typeof db.tools !== 'undefined') {
                try { tools = await db.tools.toArray(); } catch(e) { /* tools table may not exist */ }
            }

            // A slower load for an activity she has since left must not replace the current one's
            if (this.selectedActivity && this.selectedActivity.id !== activityId) return;
            this._preloadedData = {
                activityId,
                completions,
                skillLevels,
                skillObservations: allSkillObs,
                skills,
                certifications,
                tools
            };
        } catch (error) {
            console.error('Error preloading activity data:', error);
            // DL5: no stand-in empty data — an empty list would show finished students as not done
            this._preloadedData = null;
        }
    },

    // Runs inside Save's transaction: no dialogs and no other tables here. Returns the level to
    // show on the student's badge, or null if their current level stays as it is.
    _saveSkillObservation: async function(studentId, skillId, activityId, checkpointId, rating, now, lowerLevels) {
        // The live observation for this student + skill + checkpoint, if any
        const existing = (await db.skillObservations
            .where('[studentId+skillId]')
            .equals([studentId, skillId])
            .toArray()
        ).find(o => o.checkpointId === checkpointId && !o.deletedAt);

        if (existing) {
            await db.skillObservations.update(existing.id, {
                rating: rating,
                evidenceType: 'checkpoint_conversation',
                updatedAt: now
            });
        } else {
            // A removed rating is never brought back (deleted wins in sync); a new rating is a new row
            await db.skillObservations.add({
                studentId: studentId,
                skillId: skillId,
                activityId: activityId,
                checkpointId: checkpointId,
                rating: rating,
                evidenceType: 'checkpoint_conversation',
                originalRating: rating,
                createdAt: now,
                updatedAt: now
            });
        }

        // ── Current-best logic for skillLevels ──
        const currentLevel = await db.skillLevels
            .where('studentId').equals(studentId)
            .and(sl => sl.skillId === skillId && isLevelLive(sl))
            .first();

        const levelValues = { 'Beginning': 1, 'Developing': 2, 'Proficient': 3, 'Advanced': 4 };
        const newValue = levelValues[rating] || 0;
        const currentValue = currentLevel ? (levelValues[currentLevel.level] || 0) : 0;

        // Same or higher: update automatically. Lower: only if she agreed before the save.
        if (newValue < currentValue && !lowerLevels) return null;
        if (currentLevel) {
            await db.skillLevels.update(currentLevel.id, {
                level: rating,
                demonstratedIn: activityId,
                demonstratedAt: now,
                updatedAt: now
            });
        } else {
            await db.skillLevels.add({
                studentId: studentId,
                skillId: skillId,
                level: rating,
                demonstratedIn: activityId,
                demonstratedAt: now,
                createdAt: now,
                updatedAt: now
            });
        }
        return { studentId, skillId, level: rating };
    },

    _showLevelBadge: function(studentId, skillId, level) {
        const badge = document.getElementById(`skill-current-${studentId}-${skillId}`);
        if (!badge) return;
        const color = this._getLevelColor(level);
        badge.textContent = level;
        badge.style.background = color + '15';
        badge.style.color = color;
    }
};
