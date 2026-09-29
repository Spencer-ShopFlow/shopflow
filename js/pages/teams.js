// ----------------------------------------
// TEAMS PAGE
// ----------------------------------------
pages.teams = {
    render: async function() {
        const grid = document.getElementById('teams-grid');
        grid.innerHTML = '';
        
        try {
            // Load all teams
            let teams = excludeDeleted(await db.teams.toArray());
            
            // Filter by period if selected
            const headerPeriod = document.getElementById('period-select')?.value;
            if (headerPeriod && headerPeriod !== 'all') {
                teams = teams.filter(t => t.period === headerPeriod);
            }
            
            if (teams.length === 0) {
                grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--color-text-tertiary); padding: var(--space-2xl);">No teams found. Click "+ Create Team" to get started.</p>';
                return;
            }
            
            // Load team members for all teams
            const teamMembers = await db.teamMembers.toArray();
            const allStudents = excludeDeleted(await db.students.toArray());
            
            // Create map of studentId to student
            const studentMap = {};
            allStudents.forEach(s => studentMap[s.id] = s);
            
            // Attach members to each team
            teams = teams.map(team => ({
                ...team,
                members: teamMembers
                    .filter(tm => tm.teamId === team.id)
                    .map(tm => studentMap[tm.studentId])
                    .filter(s => s) // Remove any undefined students
            }));
            
            // Sort teams alphabetically
            teams.sort((a, b) => a.name.localeCompare(b.name));
            
            // Render team cards
            teams.forEach(team => {
                const card = this.createTeamCard(team);
                grid.appendChild(card);
            });
            
        } catch (error) {
            console.error('Error loading teams:', error);
            grid.innerHTML = '<p style="color: var(--color-error);">Failed to load groups.</p>';
        }
    },
    
    createTeamCard: function(team) {
        const card = document.createElement('div');
        card.className = 'card';

        const membersList = team.members.length > 0
            ? team.members.map(m => m.name).join(', ')
            : 'No members';

        card.innerHTML = `
            <div class="card__header">
                <h3 class="card__title">${escapeHtml(team.name)}</h3>
                <span class="badge" id="team-class-badge-${team.id}" style="background-color: var(--color-primary); color: white;">Loading...</span>
            </div>
            <div class="card__body">
                <p><strong>Members (${escapeHtml(team.members.length)}):</strong></p>
                <p style="margin-top: var(--space-xs); color: var(--color-text-secondary);">${escapeHtml(membersList)}</p>
            </div>
            <div class="card__footer">
                <button class="btn btn--secondary" onclick="modals.showEditTeam(${team.id})">Edit</button>
                <button class="btn btn--primary" onclick="router.navigate('team-detail', ${team.id});">View Details</button>
                <button class="btn btn--danger" onclick="pages.teams.deleteTeam(${team.id})">Delete</button>
            </div>
        `;

        // Load class name and color asynchronously
        if (team.classId) {
            db.classes.get(team.classId).then(cls => {
                const badge = document.getElementById(`team-class-badge-${team.id}`);
                if (badge && cls) {
                    badge.textContent = cls.name;
                    badge.style.backgroundColor = cls.color;
                }
            });
        }

        return card;
    },
    
    deleteTeam: async function(id) {
        try {
            const team = await db.teams.get(id);
            if (!team) return;

            await db.teams.update(id, { deletedAt: new Date().toISOString() });
            driveSync.markDirty(); await logAction('delete', 'team', id, `Deleted group ${team.name}`);
            this.render();

            ui.showUndoToast(`Team "${team.name}" deleted`, async () => {
                await db.teams.update(id, { deletedAt: null });
                driveSync.markDirty(); await logAction('undo', 'team', id, `Undid delete of group ${team.name}`);
                this.render();
            });
        } catch (error) {
            console.error('Error deleting team:', error);
            ui.showToast('Failed to delete team', 'error');
        }
    },
};

// ----------------------------------------
// TEAM DETAIL PAGE
// ----------------------------------------
pages.teamDetail = {
    render: async function(teamId) {
        // Grab the containers from the HTML
        const titleEl = document.getElementById('team-detail-title');
        const membersListEl = document.getElementById('team-detail-members-list');
        const progressContentEl = document.getElementById('team-detail-progress-content');
        
        if (!titleEl || !membersListEl || !progressContentEl) return;
        
        // Show loading states
        titleEl.textContent = 'Loading...';
        membersListEl.innerHTML = '<p style="color: var(--color-text-tertiary);">Loading members...</p>';
        progressContentEl.innerHTML = '';

        try {
            // Fetch the Team
            const id = parseInt(teamId);
            const team = await db.teams.get(id);

            if (!team) {
                titleEl.textContent = 'Team Not Found';
                membersListEl.innerHTML = '<p class="error">Could not load team data.</p>';
                return;
            }

            // Set the Header & Edit Button
            titleEl.textContent = team.name;
            
            const editBtn = document.getElementById('edit-team-btn');
            if (editBtn) {
                // Assuming you have a modal to edit teams (like modals.showEditTeam)
                editBtn.onclick = () => {
                    if (typeof modals !== 'undefined' && typeof modals.showEditTeam === 'function') {
                        modals.showEditTeam(team.id);
                    } else {
                        ui.showToast('Edit team function not linked yet.', 'warning');
                    }
                };
            }

            // Fetch and Draw the Team Members
            const memberships = await db.teamMembers.where('teamId').equals(id).toArray();
            const studentIds = memberships.map(m => m.studentId);
            
            // Fetch all the actual student records at once
            const students = await Promise.all(
                studentIds.map(studentId => db.students.get(studentId))
            );
            
            // Filter out undefined in case a student was deleted but the membership wasn't
            const validStudents = students.filter(s => s);

            if (validStudents.length === 0) {
                membersListEl.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">No students assigned to this group yet.</p>';
            } else {
                // Draw nice little cards for each student
                membersListEl.innerHTML = validStudents.map(student => `
                    <div class="card student-badge" style="padding: 10px 15px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-background-secondary); display: flex; align-items: center; gap: 10px; cursor: pointer; transition: transform 0.1s ease;" 
                        onmouseover="this.style.transform='translateY(-2px)'" 
                        onmouseout="this.style.transform='translateY(0)'"
                        onclick="router.navigate('student-detail', ${student.id})">
                        <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--color-primary); color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1.1em;">
                            ${escapeHtml(displayName(student)).charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <strong style="display: block; color: var(--color-text-primary); font-size: 0.95em;">${escapeHtml(displayName(student))}</strong>
                            <span style="font-size: 0.8em; color: var(--color-text-tertiary);" id="team-student-class-${student.id}">Loading...</span>
                        </div>
                    </div>
                `).join('');

                // Load class names for each student badge
                validStudents.forEach(student => {
                    if (student.classId) {
                        db.classes.get(student.classId).then(cls => {
                            const el = document.getElementById(`team-student-class-${student.id}`);
                            if (el && cls) el.textContent = cls.name;
                        });
                    }
                });
            }

            // --- START ACTIVITY PROGRESS LOGIC ---
            const now = getTodayString();
            
            // Find the current activity for this team's Eng Year
            const allActivities = await db.activities.toArray();
            const activities = allActivities.filter(a => a.classId === team.classId);
                
            // Find activity where 'today' is between start and end date
            const currentActivity = activities.find(a => now >= a.startDate && now <= a.endDate) || activities[activities.length - 1];

            if (!currentActivity) {
                progressContentEl.innerHTML = `<p class="text-center p-4 tertiary">No active activity found for this class.</p>`;
            } else {
                // Get Checkpoints for this activity
                const checkpoints = await db.checkpoints
                    .where('activityId').equals(currentActivity.id)
                    .sortBy('number');

                // Get all completions for these students on these checkpoints
                const completions = await db.checkpointCompletions
                    .where('studentId').anyOf(studentIds)
                    .toArray();

                // Calculate Group Progress
                // A checkpoint is "Group Complete" only if EVERY member has finished it.
                let completedCheckpoints = 0;
                const checklistHtml = checkpoints.map(cp => {
                    const studentCompletions = completions.filter(c => c.checkpointId === cp.id && c.completed);
                    const isFullyDone = studentCompletions.length === validStudents.length;
                    
                    if (isFullyDone) completedCheckpoints++;
                    
                    return `
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px; opacity: ${isFullyDone ? '1' : '0.6'}">
                            <span style="font-size: 1.2em;">${isFullyDone ? '✅' : '⬜'}</span>
                            <div style="flex-grow: 1;">
                                <div style="font-weight: 500; font-size: 0.95em;">CP ${escapeHtml(cp.number)}: ${escapeHtml(cp.title)}</div>
                                ${!isFullyDone ? `<small style="color: var(--color-text-tertiary);">${studentCompletions.length}/${validStudents.length} members finished</small>` : ''}
                            </div>
                        </div>
                    `;
                }).join('');

                const percent = checkpoints.length > 0 ? Math.round((completedCheckpoints / checkpoints.length) * 100) : 0;

                // Render the UI
                progressContentEl.innerHTML = `
                    <div class="progress-container">
                        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 10px;">
                            <div>
                                <h4 style="margin: 0; color: var(--color-primary);">${escapeHtml(currentActivity.name)}</h4>
                                <p style="margin: 0; font-size: 0.85em; color: var(--color-text-tertiary);">Team Completion: ${percent}%</p>
                            </div>
                            <span class="badge" style="background: ${percent === 100 ? '#27ae60' : 'var(--color-primary)'}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.8em;">
                                ${percent === 100 ? 'COMPLETED' : 'IN PROGRESS'}
                            </span>
                        </div>
                        
                        <div style="width: 100%; height: 12px; background: var(--color-border); border-radius: 6px; overflow: hidden; margin-bottom: 20px;">
                            <div style="width: ${escapeHtml(percent)}%; height: 100%; background: var(--color-primary); transition: width 0.5s ease;"></div>
                        </div>

                        <div class="checkpoint-list" style="background: var(--color-background-secondary); padding: 15px; border-radius: 8px;">
                            ${checklistHtml}
                        </div>
                    </div>
                `;
            }

            // Hook up the Notes System!
            notesManager.loadNotes('team', id, 'notes-list-team');
            
            const saveBtn = document.getElementById('save-note-btn-team');
            if (saveBtn) {
                saveBtn.onclick = () => notesManager.addNote('team', id, 'note-input-team');
            }

            // --- Team History (Sprint 13.1) ---
            const historyListEl = document.getElementById('team-detail-history-list');
            if (historyListEl) {
                try {
                    const history = await db.teamHistory.where('teamId').equals(id).toArray();
                    if (history.length === 0) {
                        historyListEl.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">No history recorded yet.</p>';
                    } else {
                        history.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
                        const allStudentsForHistory = await db.students.toArray();
                        const studentMapForHistory = new Map(allStudentsForHistory.map(s => [s.id, s]));
                        historyListEl.innerHTML = history.map(record => {
                            const student = studentMapForHistory.get(record.studentId);
                            const name = student ? escapeHtml(displayName(student)) : 'Unknown Student';
                            const color = record.action === 'joined' ? 'var(--color-success)' : 'var(--color-error)';
                            const dateStr = record.timestamp ? new Date(record.timestamp).toLocaleDateString() : '';
                            return `<div style="display: flex; justify-content: space-between; align-items: center; padding: var(--space-xs) 0; border-bottom: 1px solid var(--color-border);">
                                <span><strong>${name}</strong> <span style="color: ${color};">${escapeHtml(record.action)}</span></span>
                                <span style="color: var(--color-text-tertiary);">${dateStr}</span>
                            </div>`;
                        }).join('');
                    }
                } catch (err) {
                    console.error('Error loading team history:', err);
                    historyListEl.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">Could not load history.</p>';
                }
            }

        } catch (error) {
            console.error("Error loading team details:", error);
            titleEl.textContent = 'Error';
            membersListEl.innerHTML = '<p class="error">There was an error loading the team data.</p>';
        }
    }
};
