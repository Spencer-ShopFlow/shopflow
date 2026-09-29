// ============================================
// MODAL MANAGEMENT
// ============================================

const modals = {
    showAddStudent: async function() { // Added 'async' here!
        state.editingStudentId = null;
        document.getElementById('student-modal-title').textContent = 'Add Student';
        document.getElementById('student-form').reset();
        document.getElementById('student-anon-id-group').style.display = 'none';
        
        // Populate Teacher Dropdown ---
        await this.fillTeacherSelect(document.getElementById('student-wp-teacher'), '', '');
        // Populate Class Dropdown
        const classSelect = document.getElementById('student-class-id');
        classSelect.innerHTML = '<option value="">Select Class...</option>';
        const activeClasses = (await db.classes.toArray()).filter(c => c.status !== 'archived');
        activeClasses.forEach(cls => {
            const option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name;
            classSelect.appendChild(option);
        });

        ui.showModal('modal-student');
    },
    
    showEditStudent: async function(studentId) {
        state.editingStudentId = studentId;
        document.getElementById('student-modal-title').textContent = 'Edit Student';
        
        try {
            // Fetch the student details
            const student = await db.students.get(studentId);
            
            // Fetch the student's period enrollments
            const activeYear = await getActiveSchoolYear();
            const enrollments = await db.enrollments.where('studentId').equals(studentId).toArray();
            const activeEnrollments = enrollments.filter(e => e.schoolYear === activeYear || !e.schoolYear);
            const studentPeriods = activeEnrollments.map(e => e.period);

            // Build enrollment history for display
            const historicEnrollments = enrollments.filter(e => e.schoolYear && e.schoolYear !== activeYear);
            const historyByYear = {};
            historicEnrollments.forEach(e => {
                if (!historyByYear[e.schoolYear]) historyByYear[e.schoolYear] = [];
                historyByYear[e.schoolYear].push(e.period);
            });

            if (student) {
                // Populate Teacher Dropdown (keeps a teacher who isn't in the list, 2-05)
                await this.fillTeacherSelect(document.getElementById('student-wp-teacher'), student.wildcatTeacherEmail, student.wildcatTeacher);

                // Fill the Name
                document.getElementById('student-first-name').value = student.firstName || '';
                document.getElementById('student-last-name').value = student.lastName || '';
                // Show the anonymous ID (read-only) when editing
                const anonGroup = document.getElementById('student-anon-id-group');
                if (student.anonId) {
                    document.getElementById('student-anon-id').value = student.anonId;
                    anonGroup.style.display = 'block';
                } else {
                    anonGroup.style.display = 'none';
                }
                
                // Fill the Student Email
                document.getElementById('student-email').value = student.email || '';
                
                // Populate and pre-select Class Dropdown
                const classSelect = document.getElementById('student-class-id');
                classSelect.innerHTML = '<option value="">Select Class...</option>';
                const activeClasses = (await db.classes.toArray()).filter(c => c.status !== 'archived');
                activeClasses.forEach(cls => {
                    const option = document.createElement('option');
                    option.value = cls.id;
                    option.textContent = cls.name;
                    classSelect.appendChild(option);
                });
                classSelect.value = student.classId || '';
                
                // Reset all period checkboxes first
                document.querySelectorAll('.student-period-checkbox').forEach(cb => {
                    cb.checked = false;
                });

                // Check the boxes for the periods the student is actually in
                studentPeriods.forEach(period => {
                    const checkbox = document.querySelector(`.student-period-checkbox[value="${period}"]`);
                    if (checkbox) checkbox.checked = true;
                });

                // Show enrollment history if any
                const historySection = document.getElementById('enrollment-history-section');
                const historyList = document.getElementById('enrollment-history-list');
                const historyYears = Object.keys(historyByYear).sort().reverse();

                if (historyYears.length > 0) {
                    historyList.innerHTML = historyYears.map(year => 
                        `<div><strong>${escapeHtml(year)}:</strong> Periods ${historyByYear[year].map(p => escapeHtml(String(p))).join(', ')}</div>`
                    ).join('');
                    historySection.style.display = 'block';
                } else {
                    historySection.style.display = 'none';
                }

                // Show the modal
                ui.showModal('modal-student');
            }
        } catch (error) {
            console.error('Error loading student:', error);
            ui.showToast('Failed to load student', 'error');
        }
    },
    
    hideStudentModal: function() {
        ui.hideModal('modal-student');
        document.getElementById('student-form').reset();
        state.editingStudentId = null;
    },
    
    saveStudent: async function() {
        const firstName = document.getElementById('student-first-name').value.trim();
        const lastName = document.getElementById('student-last-name').value.trim();
        
        // Get all checked periods
        const checkedBoxes = document.querySelectorAll('.student-period-checkbox:checked');
        const periods = Array.from(checkedBoxes).map(cb => cb.value);
        
        if (!firstName) {
            ui.showToast('Please enter a first name', 'error');
            return;
        }
        if (!lastName) {
            ui.showToast('Please enter a last name', 'error');
            return;
        }
        
        if (periods.length === 0) {
            ui.showToast('Please select at least one period', 'error');
            return;
        }
        
        try {
            const classId = parseInt(document.getElementById('student-class-id').value);

            if (!classId) {
                ui.showToast('Please select a class', 'error');
                return;
            }

            // Grab new fields ---
            const email = document.getElementById('student-email').value.trim();
            const teacherSelect = document.getElementById('student-wp-teacher');
            
            const selectedOption = teacherSelect.options[teacherSelect.selectedIndex];
            const teacherName = (selectedOption && selectedOption.value)
                                ? (selectedOption.dataset.name || '')
                                : "";

            const studentData = {
                firstName: firstName,
                lastName: lastName,
                name: firstName + ' ' + lastName,  // Backward compat (legacy field)
                classId: classId,
                email: email,
                wildcatTeacher: teacherName,
                wildcatTeacherEmail: teacherSelect.value,
                status: 'active'
            };;
            // --------------------------------

            let studentId;
            
            const activeYear = await getActiveSchoolYear();

            if (state.editingStudentId) {
                // FOR UPDATES
                studentData.updatedAt = new Date().toISOString();
                
                await db.students.update(state.editingStudentId, studentData);
                driveSync.markDirty(); await logAction('update', 'student', state.editingStudentId, `Updated student ${studentData.name}`);
                studentId = state.editingStudentId;
                
                // Only delete enrollments for the ACTIVE school year — preserve history
                const existingEnrollments = await db.enrollments
                    .where('studentId').equals(studentId).toArray();
                const activeYearEnrollments = existingEnrollments.filter(e => e.schoolYear === activeYear);
                for (const e of activeYearEnrollments) {
                    await db.enrollments.delete(e.id);
                }
                
                driveSync.markDirty(); ui.showToast('Student updated successfully', 'success');
            } else {
                // FOR NEW STUDENTS
                studentData.createdAt = new Date().toISOString();
                studentData.anonId = await getNextAnonId();
                
                studentId = await db.students.add(studentData);
                driveSync.markDirty(); await logAction('create', 'student', studentId, `Added student ${studentData.name}`);
                driveSync.markDirty(); ui.showToast('Student added successfully', 'success');
            }

            // Add new enrollments tagged with active school year (dedup at write time)
            for (const period of periods) {
                await ensureEnrollment(studentId, period, activeYear);
            }
            
            this.hideStudentModal();
            pages.students.render();
        } catch (error) {
            console.error('Error saving student:', error);
            ui.showToast('Failed to save student', 'error');
        }
    },

    // Removes an activity's skill links that the form shows, keeping links on retired or
    // merged-away skills (hidden history, P16 C3), before the ticked boxes are saved.
    clearVisibleSkillLinks: async function(activityId) {
        const hidden = await getHiddenSkillIds();
        const links = await db.activitySkills.where('activityId').equals(activityId).toArray();
        for (const link of links) {
            if (link.deletedAt || hidden.has(link.skillId)) continue;
            await db.activitySkills.delete(link.id);
        }
    },

    //Teacher Manager Logic
    showTeacherManager: async function() {
        ui.showModal('modal-teachers');
        await this.renderTeacherList();
    },

    hideTeacherManager: async function() {
        ui.hideModal('modal-teachers');
        document.getElementById('new-teacher-name').value = '';
        document.getElementById('new-teacher-email').value = '';
        
        // If the student modal is open, silently refresh the dropdown so the new teachers immediately appear without having to close the student modal!
        if (!document.getElementById('modal-student').classList.contains('hidden')) {
            const teacherSelect = document.getElementById('student-wp-teacher');
            const selected = teacherSelect.options[teacherSelect.selectedIndex];
            // Keep their previous selection, even if that teacher was just deleted
            await this.fillTeacherSelect(teacherSelect, teacherSelect.value, selected ? (selected.dataset.name || '') : '');
        }
    },

    // 2-05 (SEC12): the Wildcat teacher list shows name and email (two teachers can share
    // a last name), and keeps a teacher who isn't in the list instead of blanking them.
    fillTeacherSelect: async function(teacherSelect, keepEmail, keepName) {
        teacherSelect.innerHTML = '<option value="">Select a Teacher...</option>';
        let teachers = [];
        try {
            teachers = await db.teachers.orderBy('lastName').toArray();
        } catch (error) {
            console.error('Could not load teachers:', error);
        }
        teachers.forEach(teacher => {
            const option = document.createElement('option');
            option.value = teacher.email;
            option.textContent = `${teacher.lastName} — ${teacher.email}`;
            option.dataset.name = teacher.lastName;
            teacherSelect.appendChild(option);
        });
        const email = String(keepEmail || '').trim();
        const same = o => o.value && o.value.trim().toLowerCase() === email.toLowerCase();
        if (email && ![...teacherSelect.options].some(same)) {
            const option = document.createElement('option');
            option.value = email;
            option.textContent = `${keepName || 'Unknown teacher'} — ${email} (not in your teacher list)`;
            option.dataset.name = keepName || '';
            teacherSelect.appendChild(option);
        }
        const match = email ? [...teacherSelect.options].find(same) : null;
        teacherSelect.value = match ? match.value : '';
    },

    renderTeacherList: async function() {
        const listContainer = document.getElementById('teacher-list');
        listContainer.innerHTML = ''; 
        
        const teachers = await db.teachers.orderBy('lastName').toArray();
        
        if (teachers.length === 0) {
            listContainer.innerHTML = '<div style="padding: var(--space-sm); color: #666; text-align: center;">No teachers added yet.</div>';
            return;
        }

        teachers.forEach(teacher => {
            const row = document.createElement('div');
            row.id = `teacher-row-${teacher.id}`;
            row.style.cssText = 'display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; padding: var(--space-sm); border-bottom: 1px solid var(--color-border);';
            
            row.innerHTML = `
                <div>
                    <strong>${escapeHtml(teacher.lastName)}</strong><br>
                    <span style="font-size: 0.85em; color: #666;">${escapeHtml(teacher.email)}</span>
                </div>
                <button type="button" onclick="modals.deleteTeacher(${teacher.id})" style="background: none; border: none; color: #dc2626; cursor: pointer; font-size: 0.9em; padding: 5px;">Delete</button>
            `;
            listContainer.appendChild(row);
        });
    },

    addTeacher: async function() {
        const nameInput = document.getElementById('new-teacher-name');
        const emailInput = document.getElementById('new-teacher-email');
        
        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        
        if (!name || !email) {
            ui.showToast('Please provide both a name and an email', 'error');
            return;
        }
        
        try {
            await db.teachers.add({ lastName: name, email: email });
            driveSync.markDirty(); ui.showToast('Teacher added!', 'success');
            nameInput.value = '';
            emailInput.value = '';
            await this.renderTeacherList(); // Refresh the list instantly
        } catch (error) {
            console.error('Error saving teacher:', error);
            ui.showToast('Failed to save teacher', 'error');
        }
    },

    // 2-05 (SEC12): students whose Wildcat teacher is this teacher (compared by email)
    studentsWithWildcatTeacher: async function(email) {
        const e = String(email || '').trim().toLowerCase();
        if (!e) return [];
        return excludeDeleted(await db.students.toArray())
            .filter(s => String(s.wildcatTeacherEmail || '').trim().toLowerCase() === e);
    },

    deleteTeacher: async function(id) {
        const teacher = await db.teachers.get(id);
        if (!teacher) return;
        const affected = await this.studentsWithWildcatTeacher(teacher.email);
        if (affected.length === 0) {
            if (!confirm('Are you sure you want to delete this teacher?')) return;
            return this.confirmDeleteTeacher(id, null);
        }
        // 2-05 (SEC12): their students would keep emailing the old address, so ask who takes them over
        const others = (await db.teachers.orderBy('lastName').toArray()).filter(t => t.id !== id);
        const row = document.getElementById(`teacher-row-${id}`);
        if (!row) return;
        const panel = document.createElement('div');
        panel.className = 'teacher-reassign';
        panel.style.cssText = 'flex-basis: 100%; margin-top: var(--space-sm); padding: var(--space-sm); background: var(--color-background-warning, #fff8e1); border-radius: var(--radius-md);';
        panel.innerHTML = `
            <p style="margin: 0 0 var(--space-xs);">${affected.length} student(s) have this teacher as their Wildcat teacher. Move them to:</p>
            <select id="teacher-reassign-${id}" class="form-select" style="width: 100%; margin-bottom: var(--space-xs);">
                ${others.map(t => `<option value="${t.id}">${escapeHtml(t.lastName)} — ${escapeHtml(t.email)}</option>`).join('')}
                <option value="">Nobody for now (their no-show emails won't send until you choose)</option>
            </select>
            <button type="button" class="btn btn--primary btn--sm" onclick="modals.confirmDeleteTeacher(${id}, document.getElementById('teacher-reassign-${id}').value)">Move and delete</button>
            <button type="button" class="btn btn--secondary btn--sm" onclick="modals.renderTeacherList()">Cancel</button>
        `;
        row.querySelectorAll('.teacher-reassign').forEach(p => p.remove());
        row.appendChild(panel);
    },

    confirmDeleteTeacher: async function(id, newTeacherId) {
        try {
            const teacher = await db.teachers.get(id);
            if (!teacher) return;
            const target = newTeacherId ? await db.teachers.get(parseInt(newTeacherId)) : null;
            const affected = await this.studentsWithWildcatTeacher(teacher.email);
            const now = new Date().toISOString();
            await db.transaction('rw', db.students, db.teachers, async () => {
                for (const s of affected) {
                    await db.students.update(s.id, {
                        wildcatTeacher: target ? target.lastName : '',
                        wildcatTeacherEmail: target ? target.email : '',
                        updatedAt: now
                    });
                }
                await db.teachers.delete(id);
            });
            driveSync.markDirty();
            ui.showToast(affected.length
                ? `Teacher deleted; ${affected.length} student(s) moved to ${target ? target.lastName : 'no teacher'}`
                : 'Teacher deleted', 'success');
            await this.renderTeacherList(); // Refresh the list instantly
        } catch (error) {
            console.error('Error deleting teacher:', error);
            ui.showToast('Failed to delete teacher', 'error');
        }
    },

    // Team modal functions
    showAddTeam: async function() {
        state.editingTeamId = null;
        document.getElementById('team-modal-title').textContent = 'Create Team';
        document.getElementById('team-form').reset();
        document.getElementById('team-members-list').innerHTML = '';
        ui.showModal('modal-team');
        // Populate class dropdown
        const classSelect = document.getElementById('team-class-id');
        classSelect.innerHTML = '<option value="">Select Class...</option>';
        const activeClasses = (await db.classes.toArray()).filter(c => c.status !== 'archived');
        activeClasses.forEach(cls => {
            const option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name;
            classSelect.appendChild(option);
        });

        this.loadTeamMembersList();
    },

    showEditTeam: async function(teamId) {
        state.editingTeamId = teamId;
        document.getElementById('team-modal-title').textContent = 'Edit Team';
        
        try {
            const team = await db.teams.get(teamId);
            if (team) {
                document.getElementById('team-name').value = team.name;
                // Populate and pre-select class dropdown
                const classSelect = document.getElementById('team-class-id');
                classSelect.innerHTML = '<option value="">Select Class...</option>';
                const activeClasses = (await db.classes.toArray()).filter(c => c.status !== 'archived');
                activeClasses.forEach(cls => {
                    const option = document.createElement('option');
                    option.value = cls.id;
                    option.textContent = cls.name;
                    classSelect.appendChild(option);
                });
                classSelect.value = team.classId || '';
                
                // Load the member checkboxes, then check the right ones
                await this.loadTeamMembersList();
                
                const teamMembers = await db.teamMembers.where('teamId').equals(teamId).toArray();
                const memberIds = teamMembers.map(m => m.studentId);
                
                memberIds.forEach(studentId => {
                    const checkbox = document.querySelector(`.team-member-checkbox[value="${studentId}"]`);
                    if (checkbox) checkbox.checked = true;
                });
                
                ui.showModal('modal-team');
            }
        } catch (error) {
            console.error('Error loading team:', error);
            ui.showToast('Failed to load team', 'error');
        }
    },

    hideTeamModal: function() {
        ui.hideModal('modal-team');
        document.getElementById('team-form').reset();
        state.editingTeamId = null;
    },

    loadTeamMembersList: async function() {
        const container = document.getElementById('team-members-list');
        container.innerHTML = '';
        
        try {
            const students = excludeDeleted(await db.students.toArray());
            students.sort(sortByStudentName);
            
            if (students.length === 0) {
                container.innerHTML = '<p style="color: var(--color-text-tertiary); padding: var(--space-base);">No students available. Add students first.</p>';
                return;
            }
            
            students.forEach(student => {
                const label = document.createElement('label');
                label.style.cssText = 'display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-xs); cursor: pointer;';
                label.innerHTML = `
                    <input type="checkbox" class="team-member-checkbox" value="${student.id}">
                    ${escapeHtml(displayName(student))}
                `;
                container.appendChild(label);
            });
        } catch (error) {
            console.error('Error loading students:', error);
            container.innerHTML = '<p style="color: var(--color-error);">Failed to load students</p>';
        }
    },

    saveTeam: async function() {
        const name = document.getElementById('team-name').value.trim();
        const classId = parseInt(document.getElementById('team-class-id').value);

        const checkedBoxes = document.querySelectorAll('.team-member-checkbox:checked');
        const memberIds = Array.from(checkedBoxes).map(cb => parseInt(cb.value));

        if (!name) {
            ui.showToast('Please enter a team name', 'error');
            return;
        }

        if (!classId) {
            ui.showToast('Please select a class', 'error');
            return;
        }
        
        if (memberIds.length === 0) {
            ui.showToast('Please select at least one team member', 'error');
            return;
        }
        
        try {
            const teamData = {
                name: name,
                classId: classId,
            };

            if (state.editingTeamId) {
                teamData.updatedAt = new Date().toISOString();
            } else {
                teamData.createdAt = new Date().toISOString();
            }

            let teamId;

            if (state.editingTeamId) {
                // Update existing team
                await db.teams.update(state.editingTeamId, teamData);
                teamId = state.editingTeamId;

                // Sprint 13.1: Diff old vs new members for history tracking
                const oldMembers = await db.teamMembers.where('teamId').equals(teamId).toArray();
                const oldMemberIds = oldMembers.map(m => m.studentId);
                const addedIds = memberIds.filter(id => !oldMemberIds.includes(id));
                const removedIds = oldMemberIds.filter(id => !memberIds.includes(id));
                const now = new Date().toISOString();

                // Write history for removed members
                for (const studentId of removedIds) {
                    await db.teamHistory.add({
                        teamId: teamId,
                        studentId: studentId,
                        action: 'left',
                        timestamp: now,
                        updatedAt: now,
                        performedBy: 'manual'
                    });
                }

                // Delete old team members and re-add
                await db.teamMembers.where('teamId').equals(teamId).delete();

                // Add all current members
                for (const studentId of memberIds) {
                    await db.teamMembers.add({
                        teamId: teamId,
                        studentId: studentId,
                        createdAt: now
                    });
                }

                // Write history for added members
                for (const studentId of addedIds) {
                    await db.teamHistory.add({
                        teamId: teamId,
                        studentId: studentId,
                        action: 'joined',
                        timestamp: now,
                        updatedAt: now,
                        performedBy: 'manual'
                    });
                }

                driveSync.markDirty();
                ui.showToast('Team updated successfully', 'success');
            } else {
                // Add new team
                teamId = await db.teams.add(teamData);

                // Add team members
                const now = new Date().toISOString();
                for (const studentId of memberIds) {
                    await db.teamMembers.add({
                        teamId: teamId,
                        studentId: studentId,
                        createdAt: now
                    });
                    // Sprint 13.1: Write "joined" history for initial members
                    await db.teamHistory.add({
                        teamId: teamId,
                        studentId: studentId,
                        action: 'joined',
                        timestamp: now,
                        updatedAt: now,
                        performedBy: 'manual'
                    });
                }

                driveSync.markDirty();
                ui.showToast('Team created successfully', 'success');
            }

            // Auto-assign period based on team members
            await this.autoAssignTeamPeriod(teamId);

            this.hideTeamModal();
            pages.teams.render();
        } catch (error) {
            console.error('Error saving team:', error);
            ui.showToast('Failed to save team', 'error');
        }
    },

    autoAssignTeamPeriod: async function(teamId) {
        const teamMembers = await db.teamMembers.where('teamId').equals(teamId).toArray();
        const enrollments = await db.enrollments.toArray();
        
        // Get all students on this team
        const memberIds = teamMembers.map(tm => tm.studentId);
        
        // Get enrollments for these students
        const memberEnrollments = enrollments.filter(e => memberIds.includes(e.studentId));
        
        // Count which period appears most
        const periodCounts = {};
        memberEnrollments.forEach(e => {
            periodCounts[e.period] = (periodCounts[e.period] || 0) + 1;
        });
        
        // Find the most common period
        let mostCommonPeriod = null;
        let maxCount = 0;
        for (const [period, count] of Object.entries(periodCounts)) {
            if (count > maxCount) {
                maxCount = count;
                mostCommonPeriod = period;
            }
        }
        
        // Update team with period
        if (mostCommonPeriod) {
            await db.teams.update(teamId, { period: mostCommonPeriod });
        }
    },

    // Activity modal functions
    showAddActivity: async function() {
        state.editingActivityId = null;
        this._activityFormFor = { mode: 'create' }; // EP24
        document.getElementById('activity-modal-title').textContent = 'Create Assignment';
        document.getElementById('activity-form').reset();
        document.getElementById('checkpoints-list').innerHTML = '';

        // Populate class dropdown
        const classSelect = document.getElementById('activity-class-id');
        classSelect.innerHTML = '<option value="">Select Class...</option>';
        const activeClasses = (await db.classes.toArray()).filter(c => c.status !== 'archived');
        activeClasses.forEach(cls => {
            const option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name;
            classSelect.appendChild(option);
        });

        // Populate standards checkboxes
        const standardsContainer = document.getElementById('activity-standards-checkboxes');
        const allStandards = await db.standards.toArray();
        if (allStandards.length > 0) {
            standardsContainer.innerHTML = allStandards.map(s =>
                `<label style="display: flex; align-items: center; gap: var(--space-xs); padding: 2px 0; cursor: pointer;">
                    <input type="checkbox" class="activity-standard-cb" value="${s.id}">
                    <strong style="font-size: var(--font-size-body-small);">${escapeHtml(s.code)}</strong>
                    <span style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">${escapeHtml(s.name)}</span>
                </label>`
            ).join('');
        } else {
            standardsContainer.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic; font-size: var(--font-size-body-small);">No standards defined yet</p>';
        }

        // Populate skills checkboxes (visible skills only, P16 C3)
        const skillsContainer = document.getElementById('activity-skills-checkboxes');
        const allSkills = await getVisibleSkills();
        if (allSkills.length > 0) {
            skillsContainer.innerHTML = allSkills.map(s =>
                `<label style="display: flex; align-items: center; gap: var(--space-xs); padding: 2px 0; cursor: pointer;">
                    <input type="checkbox" class="activity-skill-cb" value="${s.id}">
                    <span style="font-size: var(--font-size-body-small);">${escapeHtml(s.name)}</span>
                    <span style="font-size: var(--font-size-caption); color: var(--color-text-tertiary);">(${escapeHtml(s.category)})</span>
                </label>`
            ).join('');
        } else {
            skillsContainer.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic; font-size: var(--font-size-body-small);">No skills defined yet</p>';
        }
        // Reset Google Classroom fields
        document.getElementById('activity-classroom-course').innerHTML = '<option value="">Not linked</option>';
        document.getElementById('activity-classroom-coursework').innerHTML = '<option value="">Select assignment...</option>';
        document.getElementById('classroom-coursework-group').style.display = 'none';
        state._classroomLinksTemp = {};
        state._classroomPendingCreate = {};
        ui.showModal('modal-activity');
        this.addCheckpointField();
    },

    showQuickEdit: async function(activityId) {
        if (!activityId) return;
        state._quickEditActivityId = activityId;
        const activity = await db.activities.get(activityId);
        if (!activity) return;

        document.getElementById('quick-edit-name').textContent = activity.name;
        document.getElementById('qe-start-date').value = activity.startDate || '';
        document.getElementById('qe-end-date').value = activity.endDate || '';

        ui.showModal('modal-quick-edit');
    },

    hideQuickEdit: function() {
        ui.hideModal('modal-quick-edit');
        state._quickEditActivityId = null;
    },

    saveQuickEdit: async function() {
        const activityId = state._quickEditActivityId;
        if (!activityId) return;

        const activity = await db.activities.get(activityId);
        if (!activity) return;

        const updates = {
            startDate: document.getElementById('qe-start-date').value,
            endDate: document.getElementById('qe-end-date').value,
            updatedAt: new Date().toISOString()
        };

        await db.activities.update(activityId, updates);
        logAction('update', 'activity', activityId, 'Quick edit: ' + activity.name);
        if (typeof driveSync !== 'undefined') driveSync.markDirty();

        modals.hideQuickEdit();
        ui.showToast('Assignment updated', 'success');

        // Re-render the Activity Detail page if we're on it
        if (state.selectedActivity === activityId) {
            pages.activityDetail.render(activityId);
        }
    },

    openFullEdit: function(activityId) {
        state.editingActivityId = activityId || null;
        router.navigate('activity-edit');
    },

    showEditActivity: async function(activityId) {
        state.editingActivityId = activityId;
        this._activityFormFor = null; // EP24: set below once the record is loaded
        document.getElementById('activity-modal-title').textContent = 'Edit Assignment';
        
        try {
            const activity = await db.activities.get(activityId);
            if (activity) {
                modals._activityFormFor = { mode: 'edit', id: activity.id, name: activity.name, contractCode: activity.contractCode || null }; // EP24
                document.getElementById('activity-name').value = activity.name;
                document.getElementById('activity-description').value = activity.description || '';
                // Populate and pre-select class dropdown
                const classSelect = document.getElementById('activity-class-id');
                classSelect.innerHTML = '<option value="">Select Class...</option>';
                const activeClasses = (await db.classes.toArray()).filter(c => c.status !== 'archived');
                activeClasses.forEach(cls => {
                    const option = document.createElement('option');
                    option.value = cls.id;
                    option.textContent = cls.name;
                    classSelect.appendChild(option);
                });
                classSelect.value = activity.classId || '';
                document.getElementById('activity-start-date').value = activity.startDate;
                document.getElementById('activity-end-date').value = activity.endDate;
                
                // Populate and check standards
                const standardsContainer = document.getElementById('activity-standards-checkboxes');
                const allStandards = await db.standards.toArray();
                const linkedStandards = (await db.activityStandards.where('activityId').equals(activityId).toArray()).map(l => l.standardId);
                if (allStandards.length > 0) {
                    standardsContainer.innerHTML = allStandards.map(s =>
                        `<label style="display: flex; align-items: center; gap: var(--space-xs); padding: 2px 0; cursor: pointer;">
                            <input type="checkbox" class="activity-standard-cb" value="${s.id}" ${linkedStandards.includes(s.id) ? 'checked' : ''}>
                            <strong style="font-size: var(--font-size-body-small);">${escapeHtml(s.code)}</strong>
                            <span style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">${escapeHtml(s.name)}</span>
                        </label>`
                    ).join('');
                } else {
                    standardsContainer.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic; font-size: var(--font-size-body-small);">No standards defined yet</p>';
                }

                // Populate and check skills
                const skillsContainer = document.getElementById('activity-skills-checkboxes');
                const allSkills = await getVisibleSkills();
                const linkedSkills = (await getLiveSkillLinks(activityId)).map(l => l.skillId);
                if (allSkills.length > 0) {
                    skillsContainer.innerHTML = allSkills.map(s =>
                        `<label style="display: flex; align-items: center; gap: var(--space-xs); padding: 2px 0; cursor: pointer;">
                            <input type="checkbox" class="activity-skill-cb" value="${s.id}" ${linkedSkills.includes(s.id) ? 'checked' : ''}>
                            <span style="font-size: var(--font-size-body-small);">${escapeHtml(s.name)}</span>
                            <span style="font-size: var(--font-size-caption); color: var(--color-text-tertiary);">(${escapeHtml(s.category)})</span>
                        </label>`
                    ).join('');
                } else {
                    skillsContainer.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic; font-size: var(--font-size-body-small);">No skills defined yet</p>';
                }
                
                // Load checkpoints
                const checkpoints = await db.checkpoints
                    .where('activityId')
                    .equals(activityId)
                    .toArray();
                
                checkpoints.sort((a, b) => a.number - b.number);
                
                document.getElementById('checkpoints-list').innerHTML = '';
                checkpoints.forEach(cp => {
                    this.addCheckpointField(cp.title, cp.questions, cp.suggestedDate || '');
                });
                
                // Add one empty field if no checkpoints
                if (checkpoints.length === 0) {
                    this.addCheckpointField();
                }
                // Populate Google Form fields
                document.getElementById('activity-form-url').value = activity.formUrl || '';
                document.getElementById('activity-form-spreadsheet').value = activity.formSpreadsheetId || '';

                // Populate Google Classroom fields (6.4b)
                const crsCourseSelect = document.getElementById('activity-classroom-course');
                const crsCwGroup = document.getElementById('classroom-coursework-group');
                const crsCwSelect = document.getElementById('activity-classroom-coursework');
                crsCourseSelect.innerHTML = '<option value="">Not linked</option>';
                crsCwSelect.innerHTML = '<option value="">Select assignment...</option>';
                crsCwGroup.style.display = 'none';

                // Store existing links so saveActivity() can preserve them
                state._classroomLinksTemp = activity.classroomLinks || {};
                state._classroomPendingCreate = {};
                // Show linked courses count if any exist
                const linkCount = Object.keys(state._classroomLinksTemp).length;
                if (linkCount > 0) {
                    // Add placeholder options for each linked course
                    Object.keys(state._classroomLinksTemp).forEach(function(cId) {
                        const opt = document.createElement('option');
                        opt.value = cId;
                        opt.textContent = 'Course ID: ' + cId + ' (click Load Courses for names)';
                        crsCourseSelect.appendChild(opt);
                    });
                }

                ui.showModal('modal-activity');
            }
        } catch (error) {
            console.error('Error loading activity:', error);
            ui.showToast('Failed to load activity', 'error');
        }
    },

    loadClassroomCourses: async function() {
        const webhook = localStorage.getItem('webhook_wildcat');
        if (!webhook) {
            ui.showToast('No webhook URL configured — check Settings → Automations', 'error');
            return;
        }

        const select = document.getElementById('activity-classroom-course');
        const currentVal = select.value;
        select.innerHTML = '<option value="">Loading courses...</option>';
        select.disabled = true;

        try {
            const resp = await webhookFetch(webhook, {
                method: 'POST',
                body: JSON.stringify({
                    token: localStorage.getItem('webhook_token') || '',
                    action: 'list_classroom_courses'
                })
            });
            const result = await resp.json();

            if (result.status === 'success' && result.courses) {
                select.innerHTML = '<option value="">Not linked</option>';
                result.courses.forEach(function(c) {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = c.name + (c.section ? ' — ' + c.section : '');
                    select.appendChild(opt);
                });

                // Re-select previous value if it still exists
                if (currentVal) select.value = currentVal;

                // Mark courses that already have links
                const links = state._classroomLinksTemp || {};
                Array.from(select.options).forEach(function(opt) {
                    if (opt.value && links[opt.value]) {
                        opt.textContent = '✅ ' + opt.textContent;
                    }
                });

                ui.showToast('Loaded ' + result.courses.length + ' courses (' + Object.keys(links).length + ' linked)', 'success');
            } else {
                select.innerHTML = '<option value="">Not linked</option>';
                ui.showToast('Failed to load courses: ' + (result.message || 'Unknown error'), 'error');
            }
        } catch (err) {
            select.innerHTML = '<option value="">Not linked</option>';
            ui.showToast('Could not reach webhook: ' + err.message, 'error');
        }

        select.disabled = false;

        // If a course is selected, load its coursework (passing saved ID to re-select)
        if (select.value) {
            const savedCwId = document.getElementById('activity-classroom-coursework').value;
            await this.loadClassroomCoursework();
            if (savedCwId) {
                document.getElementById('activity-classroom-coursework').value = savedCwId;
            }
        }
    },

    loadClassroomCoursework: async function() {
        const courseId = document.getElementById('activity-classroom-course').value;
        const cwGroup = document.getElementById('classroom-coursework-group');
        const cwSelect = document.getElementById('activity-classroom-coursework');
        const cwHelper = document.getElementById('classroom-coursework-helper');

        if (!courseId) {
            cwGroup.style.display = 'none';
            cwSelect.innerHTML = '<option value="">Select assignment...</option>';
            return;
        }

        cwGroup.style.display = '';
        cwSelect.innerHTML = '<option value="">Loading assignments...</option>';
        cwSelect.disabled = true;

        const webhook = localStorage.getItem('webhook_wildcat');

        try {
            const resp = await webhookFetch(webhook, {
                method: 'POST',
                body: JSON.stringify({
                    token: localStorage.getItem('webhook_token') || '',
                    action: 'list_classroom_coursework',
                    courseId: courseId
                })
            });
            const result = await resp.json();

            if (result.status === 'success' && result.coursework) {
                const currentVal = cwSelect.value;
                cwSelect.innerHTML = '<option value="">Select assignment...</option>';
                result.coursework.forEach(function(cw) {
                    const opt = document.createElement('option');
                    opt.value = cw.id;
                    let label = cw.title;
                    if (cw.maxPoints) label += ' (' + cw.maxPoints + ' pts)';
                    if (cw.state !== 'PUBLISHED') label += ' [' + cw.state + ']';
                    opt.textContent = label;
                    opt.dataset.maxPoints = cw.maxPoints || '';
                    cwSelect.appendChild(opt);
                });

                // Auto-select the saved coursework for this course
                const rawCwId = (state._classroomLinksTemp || {})[courseId];
                const savedCwId = (rawCwId && rawCwId !== 'PENDING_CREATE') ? rawCwId : null;
                if (savedCwId) {
                    cwSelect.value = savedCwId;
                } else if (currentVal) {
                    cwSelect.value = currentVal;
                }

                cwHelper.textContent = result.coursework.length + ' assignments found' + (savedCwId ? ' (linked assignment selected)' : '');

                // Show Update button if a link exists
                const updateBtn = document.getElementById('update-classroom-cw-btn');
                const createBtn = document.getElementById('create-classroom-cw-btn');
                if (savedCwId) {
                    updateBtn.style.display = '';
                    createBtn.style.display = 'none';
                } else {
                    updateBtn.style.display = 'none';
                    createBtn.style.display = '';
                }
            } else {
                cwSelect.innerHTML = '<option value="">Select assignment...</option>';
                cwHelper.textContent = 'Failed: ' + (result.message || 'Unknown error');
            }
        } catch (err) {
            cwSelect.innerHTML = '<option value="">Select assignment...</option>';
            cwHelper.textContent = 'Error: ' + err.message;
        }

        cwSelect.disabled = false;
    },

    toggleCheckpointGradingSection: function() {
        const cpFields = document.querySelectorAll('.checkpoint-field');
        const hasCheckpoints = Array.from(cpFields).some(function(f) {
            return f.querySelector('.checkpoint-title').value.trim() !== '';
        });
        // Show section if there's at least one checkpoint field (even if empty, since user might be filling it in)
        },

    createClassroomCoursework: function() {
        const courseId = document.getElementById('activity-classroom-course').value;
        if (!courseId) {
            ui.showToast('Select a Classroom course first', 'error');
            return;
        }

        const title = document.getElementById('activity-name').value.trim();
        if (!title) {
            ui.showToast('Enter an assignment name first', 'error');
            return;
        }

        const maxPoints = parseInt(document.getElementById('activity-classroom-max-points').value) || 100;

        // Mark this course as pending creation (will happen on Save)
        state._classroomPendingCreate = state._classroomPendingCreate || {};
        state._classroomPendingCreate[courseId] = { maxPoints: maxPoints };

        // Update the dropdown to show it's queued
        const cwSelect = document.getElementById('activity-classroom-coursework');
        cwSelect.innerHTML = '<option value="PENDING_CREATE" selected>Will be created on Save (' + maxPoints + ' pts)</option>';

        // Mark the course with a pending indicator
        const courseSelect = document.getElementById('activity-classroom-course');
        const selectedOpt = courseSelect.options[courseSelect.selectedIndex];
        if (selectedOpt && !selectedOpt.textContent.startsWith('⏳')) {
            selectedOpt.textContent = '⏳ ' + selectedOpt.textContent.replace(/^✅ /, '');
        }

        ui.showToast('Queued — will create in Classroom when you click Save', 'info');
    },

    updateClassroomCoursework: async function() {
        const courseId = document.getElementById('activity-classroom-course').value;
        const cwId = document.getElementById('activity-classroom-coursework').value;
        if (!courseId || !cwId || cwId === 'PENDING_CREATE') {
            ui.showToast('No linked Classroom assignment to update', 'error');
            return;
        }

        const title = document.getElementById('activity-name').value.trim();
        const maxPoints = parseInt(document.getElementById('activity-classroom-max-points').value) || 100;
        const endDate = document.getElementById('activity-end-date').value;
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

    hideActivityModal: function() {
        ui.hideModal('modal-activity');
        document.getElementById('activity-form').reset();
        state.editingActivityId = null;
        this._activityFormFor = null; // EP24
    },

    addCheckpointField: function(title = '', questions = '', suggestedDate = '') {
        const container = document.getElementById('checkpoints-list');
        const index = container.children.length + 1;
        
        // Parse questions — could be a string (legacy) or array of {question, expectedResponse}
        let qaPairs = [];
        if (Array.isArray(questions)) {
            qaPairs = questions;
        } else if (typeof questions === 'string' && questions.trim()) {
            // Legacy: treat each line as a question with no expected response
            qaPairs = questions.split('\n').filter(q => q.trim()).map(q => ({ question: q.trim(), expectedResponse: '' }));
        }
        
        const checkpointDiv = document.createElement('div');
        checkpointDiv.className = 'checkpoint-field';
        checkpointDiv.style.cssText = 'border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-sm); margin-bottom: var(--space-sm);';
        
        checkpointDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-sm);">
                <strong>Checkpoint ${index}</strong>
                <button type="button" class="btn--icon" onclick="this.parentElement.parentElement.remove(); modals.toggleCheckpointGradingSection();" style="color: var(--color-error);">✕</button>
            </div>
            <input type="text" class="form-input checkpoint-title" placeholder="Checkpoint title" value="${escapeHtml(title)}" style="margin-bottom: var(--space-xs);">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-sm); margin-bottom: var(--space-xs);">
                <div>
                    <label style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">Suggested Date</label>
                    <input type="date" class="form-input checkpoint-suggested-date" value="${suggestedDate}">
                </div>
            </div>
            <div class="checkpoint-qa-pairs" style="margin-top: var(--space-sm);">
                <label style="font-size: var(--font-size-body-small); color: var(--color-text-secondary); font-weight: 600;">Questions / Checks</label>
            </div>
            <button type="button" class="btn btn--secondary" style="font-size: var(--font-size-body-small); padding: var(--space-xs) var(--space-sm); margin-top: var(--space-xs);" onclick="modals.addQAPair(this)">+ Add Question</button>
        `;
        
        container.appendChild(checkpointDiv);

        // Add existing QA pairs or one empty one
        const qaContainer = checkpointDiv.querySelector('.checkpoint-qa-pairs');
        if (qaPairs.length > 0) {
            qaPairs.forEach(qa => this.addQAPairToContainer(qaContainer, qa.question, qa.expectedResponse));
        } else {
            this.addQAPairToContainer(qaContainer, '', '');
        }
        modals.toggleCheckpointGradingSection();
    },

    addQAPair: function(buttonEl) {
        const qaContainer = buttonEl.parentElement.querySelector('.checkpoint-qa-pairs');
        this.addQAPairToContainer(qaContainer, '', '');
    },

    addQAPairToContainer: function(container, question, response) {
        const div = document.createElement('div');
        div.className = 'checkpoint-qa-row';
        div.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr auto; gap: var(--space-xs); margin-top: var(--space-xs); align-items: start;';
        div.innerHTML = `
            <input type="text" class="form-input cp-question" placeholder="Teacher asks/checks..." value="${escapeHtml(question)}" style="font-size: var(--font-size-body-small);">
            <input type="text" class="form-input cp-expected-response" placeholder="Student should answer/demo..." value="${escapeHtml(response)}" style="font-size: var(--font-size-body-small);">
            <button type="button" class="btn--icon" onclick="this.parentElement.remove()" style="color: var(--color-error); font-size: 14px; padding: 4px;">✕</button>
        `;
        container.appendChild(div);
    },

    saveActivity: async function() {
        const name = document.getElementById('activity-name').value.trim();
        const description = document.getElementById('activity-description').value.trim();
        const classId = parseInt(document.getElementById('activity-class-id').value);
        const startDate = document.getElementById('activity-start-date').value;
        const endDate = document.getElementById('activity-end-date').value;

        if (!name || !classId || !startDate || !endDate) {
            ui.showToast('Please fill in all required fields', 'error');
            return;
        }
        
        // EP24 guard: write only to the record this modal was opened for; never fall back to creating.
        const formFor = this._activityFormFor;
        const blocked = (why) => ui.showToast('Save blocked — nothing was saved. ' + why + ' Close this window and open it again.', 'error', 10000);
        if (!formFor) { blocked('This form did not finish loading.'); return; }
        if (formFor.mode === 'edit') {
            if (!formFor.id) { blocked('The form lost track of which assignment it is editing.'); return; }
            const target = await db.activities.get(formFor.id);
            if (!target || target.name !== formFor.name || (target.contractCode || null) !== formFor.contractCode) {
                console.error('EP24 modal save blocked: record missing or changed', { formFor, target });
                blocked('The assignment on file no longer matches what this form loaded.');
                return;
            }
        } else if (formFor.mode !== 'create') {
            blocked('Unknown form mode.');
            return;
        }

        // Get checkpoint data
        const checkpointFields = document.querySelectorAll('.checkpoint-field');
        const checkpoints = [];
        checkpointFields.forEach((field, index) => {
            const title = field.querySelector('.checkpoint-title').value.trim();
            const suggestedDate = field.querySelector('.checkpoint-suggested-date').value;
            
            // Gather structured QA pairs

            const qaRows = field.querySelectorAll('.checkpoint-qa-row');
            const questions = [];
            qaRows.forEach(row => {
                const q = row.querySelector('.cp-question').value.trim();
                const r = row.querySelector('.cp-expected-response').value.trim();
                if (q || r) {
                    questions.push({ question: q, expectedResponse: r });
                }
            });
            
            if (title) {
                checkpoints.push({
                    number: index + 1,
                    title: title,
                    questions: questions,
                    suggestedDate: suggestedDate
                });
            }
        });
        
        // Checkpoints are optional (e.g., tests don't need them)

        // Warn if any dates fall on non-instructional days
        const niDays = await getActiveNonInstructionalDays();
        const isNonInstructional = (dateStr) => niDays.some(ni => {
            if (ni.end) return dateStr >= ni.date && dateStr <= ni.end;
            return ni.date === dateStr;
        });
        const badDates = [];
        if (isNonInstructional(startDate)) badDates.push('Start date');
        if (isNonInstructional(endDate)) badDates.push('Due date');
        checkpoints.forEach((cp, i) => {
            if (cp.suggestedDate && isNonInstructional(cp.suggestedDate)) {
                badDates.push(`Checkpoint ${i + 1} date`);
            }
        });
        if (badDates.length > 0) {
            ui.showToast(`⚠️ ${badDates.join(', ')} fall${badDates.length === 1 ? 's' : ''} on a non-instructional day`, 'warning');
        }

        // The Form fields: a Google Forms link, and the responses sheet's id (a pasted link is fine) (3-02).
        // Checked only when new or changed; an unchanged old value saves as it is (B7).
        const storedForForm = (formFor.mode === 'edit' && formFor.id) ? await db.activities.get(formFor.id) : null;
        const formFields = formImport.cleanFormFields(document.getElementById('activity-form-url').value, document.getElementById('activity-form-spreadsheet').value, storedForForm);
        if (formFields.error) { ui.showToast(formFields.error + ' Nothing was saved.', 'error', 8000); return; }

        try {
            const activityData = {
                name: name,
                description: description,
                classId: classId,
                startDate: startDate,
                endDate: endDate,
                status: 'active',
                scoringType: 'mastery',
                formUrl: formFields.formUrl,
                formSpreadsheetId: formFields.formSpreadsheetId,
                classroomLinks: (function() {
                    // Preserve existing links from the activity record
                    const existing = state._classroomLinksTemp || {};
                    const courseId = document.getElementById('activity-classroom-course').value;
                    const cwId = document.getElementById('activity-classroom-coursework').value;
                    if (courseId && cwId && cwId !== 'PENDING_CREATE') {
                        existing[courseId] = cwId;
                    }
                    return Object.keys(existing).length > 0 ? existing : null;
                    })(),
                    materials: this._materials || [],
                };

            // Handle pending Classroom creations (6.4 — deferred until Save)
            const pendingCreates = state._classroomPendingCreate || {};
            const pendingCourseIds = Object.keys(pendingCreates);
            if (pendingCourseIds.length > 0) {
                const webhook = localStorage.getItem('webhook_wildcat');
                const token = localStorage.getItem('webhook_token') || '';
                
                if (webhook) {
                    const links = activityData.classroomLinks || {};
                    
                    for (const courseId of pendingCourseIds) {
                        try {
                            const payload = {
                                token: token,
                                action: 'create_classroom_coursework',
                                courseId: courseId,
                                title: name,
                                maxPoints: pendingCreates[courseId].maxPoints
                            };
                            if (description) payload.description = description;
                            if (endDate && endDate > new Date().toISOString().split('T')[0]) payload.dueDate = endDate;

                            const resp = await webhookFetch(webhook, {
                                method: 'POST',
                                body: JSON.stringify(payload)
                            });
                            const result = await resp.json();

                            if (result.status === 'success') {
                                links[courseId] = result.courseworkId;
                                ui.showToast('✅ Created "' + result.title + '" in Classroom (' + result.maxPoints + ' pts)', 'success');
                            } else {
                                ui.showToast('Classroom create failed: ' + (result.message || 'Unknown error'), 'error');
                            }
                        } catch (err) {
                            ui.showToast('Classroom error: ' + err.message, 'error');
                        }
                    }
                    
                    activityData.classroomLinks = Object.keys(links).length > 0 ? links : null;
                }
                
                state._classroomPendingCreate = {};
            }

            if (formFor.mode === 'edit') {
                activityData.updatedAt = new Date().toISOString();
            } else {
                activityData.createdAt = new Date().toISOString();
            }
            
            let activityId;

            if (formFor.mode === 'edit') {
                // Update existing activity (EP24: only the record this modal was opened for)
                await db.activities.update(formFor.id, activityData);
                activityId = formFor.id;
                driveSync.markDirty();
                
                // Load existing checkpoints
                const existingCheckpoints = await db.checkpoints
                    .where('activityId')
                    .equals(activityId)
                    .toArray();
                
                // Update existing checkpoints or add new ones
                for (let i = 0; i < checkpoints.length; i++) {
                    const cpData = checkpoints[i];
                    if (existingCheckpoints[i]) {
                        // Update existing checkpoint (keeps same ID, preserves completion data)
                        await db.checkpoints.update(existingCheckpoints[i].id, {
                            number: cpData.number,
                            title: cpData.title,
                            questions: cpData.questions,
                            suggestedDate: cpData.suggestedDate
                        });
                    } else {
                        // Add new checkpoint (if more checkpoints were added)
                        await db.checkpoints.add({
                            activityId: activityId,
                            number: cpData.number,
                            title: cpData.title,
                            questions: cpData.questions,
                            suggestedDate: cpData.suggestedDate,
                            createdAt: new Date().toISOString()
                        });
                    }
                }
                
                // Delete extra checkpoints if count decreased
                if (existingCheckpoints.length > checkpoints.length) {
                    for (let i = checkpoints.length; i < existingCheckpoints.length; i++) {
                        await db.checkpoints.delete(existingCheckpoints[i].id);
                    }
                }
                
                // Save standards links
                await db.activityStandards.where('activityId').equals(activityId).delete();
                const checkedStandards = document.querySelectorAll('.activity-standard-cb:checked');
                for (const cb of checkedStandards) {
                    await db.activityStandards.add({ activityId, standardId: parseInt(cb.value), createdAt: new Date().toISOString() });
                }

                // Save skills links (links on hidden skills are kept, P16 C3)
                await this.clearVisibleSkillLinks(activityId);
                const checkedSkills = document.querySelectorAll('.activity-skill-cb:checked');
                for (const cb of checkedSkills) {
                    await db.activitySkills.add({ activityId, skillId: parseInt(cb.value), createdAt: new Date().toISOString() });
                }

                ui.showToast('Assignment updated successfully', 'success');
                this.hideActivityModal();
                pages.activities.render();
                return; 
            } else {
                // Add new activity
                activityId = await db.activities.add(activityData);
                ui.showToast('Assignment created successfully', 'success');
                driveSync.markDirty();
            }
            
            // Add checkpoints
            for (const checkpoint of checkpoints) {
                await db.checkpoints.add({
                    activityId: activityId,
                    number: checkpoint.number,
                    title: checkpoint.title,
                    questions: checkpoint.questions,
                    suggestedDate: checkpoint.suggestedDate,
                    createdAt: new Date().toISOString()
                });
            }
            
            // Save standards links
            await db.activityStandards.where('activityId').equals(activityId).delete();
            const checkedStandards2 = document.querySelectorAll('.activity-standard-cb:checked');
            for (const cb of checkedStandards2) {
                await db.activityStandards.add({ activityId, standardId: parseInt(cb.value), createdAt: new Date().toISOString() });
            }

            // Save skills links (links on hidden skills are kept, P16 C3)
            await this.clearVisibleSkillLinks(activityId);
            const checkedSkills2 = document.querySelectorAll('.activity-skill-cb:checked');
            for (const cb of checkedSkills2) {
                await db.activitySkills.add({ activityId, skillId: parseInt(cb.value), createdAt: new Date().toISOString() });
            }

            this.hideActivityModal();
            pages.activities.render();
        } catch (error) {
            console.error('Error saving activity:', error);
            ui.showToast('Failed to save assignment', 'error');
        }
    },

    showEndClass: async function() {
        // Load end-class step visibility from settings
        const stepsSetting = await db.settings.get('end-class-steps');
        const steps = stepsSetting?.value || {
            stationCheckout: true,
            returnTools: true,
            pcRestart: true,
            absentNotifications: true,
            wildcatScheduling: true,
            hubSync: true
        };

        // Show/hide each step card
        document.querySelectorAll('.end-class-step').forEach(card => {
            const stepKey = card.dataset.step;
            if (stepKey && steps[stepKey] === false) {
                card.style.display = 'none';
            } else if (stepKey !== 'hubSync') {
                // hubSync has its own display logic, don't override it here
                card.style.display = '';
            }
        });

        ui.showModal('modal-end-class');
        
        // Auto-select current period
        const period = state.currentPeriod;
        if (period && period !== 'wildcat') {
            document.getElementById('end-class-period').value = period;
            await this.loadEndClassTeams();
            await this.loadBorrowedTools();
        }
    },

    loadBorrowedTools: async function() {
        const container = document.getElementById('end-class-borrowed-tools');
        const periodSelect = document.getElementById('end-class-period');
        const selectedPeriod = periodSelect.value;
        
        if (!selectedPeriod) {
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">Select a period first</p>';
            return;
        }
        
        try {
            // Get all active checkouts for this period
            const allCheckouts = await db.checkouts.toArray();
            const activeCheckouts = allCheckouts.filter(c => 
                !c.returnedAt && 
                String(c.period) === String(selectedPeriod)
            );
            
            if (activeCheckouts.length === 0) {
                container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">No tools checked out this period 🎉</p>';
                return;
            }
            
            // Get student and item details
            const allStudents = excludeDeleted(await db.students.toArray());
            const allItems = await db.inventory.toArray();
            
            // Group by student
            const studentCheckouts = {};
            activeCheckouts.forEach(checkout => {
                if (!studentCheckouts[checkout.studentId]) {
                    studentCheckouts[checkout.studentId] = [];
                }
                studentCheckouts[checkout.studentId].push(checkout);
            });
            
            // Render
            container.innerHTML = '';
            
            // Add "Return All" button at top
            const returnAllBtn = document.createElement('button');
            returnAllBtn.className = 'btn btn--primary';
            returnAllBtn.textContent = `✓ Return All Tools (${activeCheckouts.length} items)`;
            returnAllBtn.style.marginBottom = 'var(--space-base)';
            returnAllBtn.onclick = () => this.returnAllTools(selectedPeriod);
            container.appendChild(returnAllBtn);
            
            // Render each student's borrowed tools
            for (const studentId of Object.keys(studentCheckouts)) {
                const student = allStudents.find(s => s.id === parseInt(studentId));
                if (!student) continue;
                
                const checkouts = studentCheckouts[studentId];
                
                const studentCard = document.createElement('div');
                studentCard.style.cssText = 'border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-sm); margin-bottom: var(--space-sm); background: var(--color-background);';
                
                const itemsList = checkouts.map(checkout => {
                    const item = allItems.find(i => i.id === checkout.itemId);
                    return item ? item.name : 'Unknown Item';
                }).join(', ');
                
                studentCard.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <strong>${escapeHtml(displayName(student))}</strong>
                            <p style="color: var(--color-text-secondary); margin-top: var(--space-xs); font-size: var(--font-size-body-small);">
                                ${itemsList}
                            </p>
                        </div>
                        <button class="btn btn--secondary btn--sm" onclick="modals.returnStudentTools(${studentId}, '${selectedPeriod}')">
                            ✓ Returned
                        </button>
                    </div>
                `;
                
                container.appendChild(studentCard);
            }
            
        } catch (error) {
            console.error('Error loading borrowed tools:', error);
            container.innerHTML = '<p style="color: var(--color-error);">Failed to load borrowed tools</p>';
        }
    },

    returnStudentTools: async function(studentId, period) {
        try {
            // Get all active checkouts for this student in this period
            const allCheckouts = await db.checkouts.toArray();
            const studentCheckouts = allCheckouts.filter(c => 
                !c.returnedAt && 
                c.studentId === parseInt(studentId) && 
                String(c.period) === String(period)
            );
            
            // Mark all as returned
            const now = new Date().toISOString();
            for (const checkout of studentCheckouts) {
                await db.checkouts.update(checkout.id, {
                    returnedAt: now
                });
            }
            
            ui.showToast(`${studentCheckouts.length} item(s) returned`, 'success');
            
            // Reload the list
            await this.loadBorrowedTools();
            
            // Refresh inventory page if visible
            if (!document.getElementById('page-inventory').classList.contains('hidden')) {
                pages.inventory.render();
            }
            
        } catch (error) {
            console.error('Error returning tools:', error);
            ui.showToast('Failed to return tools', 'error');
        }
    },

    returnAllTools: async function(period) {
        if (!confirm('Mark all borrowed tools as returned?')) {
            return;
        }
        
        try {
            // Get all active checkouts for this period
            const allCheckouts = await db.checkouts.toArray();
            const periodCheckouts = allCheckouts.filter(c => 
                !c.returnedAt && 
                String(c.period) === String(period)
            );
            
            // Mark all as returned
            const now = new Date().toISOString();
            for (const checkout of periodCheckouts) {
                await db.checkouts.update(checkout.id, {
                    returnedAt: now
                });
            }
            
            ui.showToast(`All ${periodCheckouts.length} tools returned!`, 'success');
            
            // Reload the list
            await this.loadBorrowedTools();
            
            // Refresh inventory page if visible
            if (!document.getElementById('page-inventory').classList.contains('hidden')) {
                pages.inventory.render();
            }
            
        } catch (error) {
            console.error('Error returning all tools:', error);
            ui.showToast('Failed to return tools', 'error');
        }
    },

    loadEndClassAbsences: async function() {
        const container = document.getElementById('end-class-absent-list');
        const period = document.getElementById('end-class-period').value;
        // 2-05 (X6): if the period changes while this list is loading, only the newest load may draw it
        const loadId = this._absenceLoadId = (this._absenceLoadId || 0) + 1;
        const stale = () => loadId !== this._absenceLoadId;
        if (!period || period === 'wildcat') {
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">Select a class period to see absences.</p>';
            return;
        }

        try {
            const todayStr = getTodayString();

            // Get today's absences for this period
            const todayAttendance = await db.attendance
                .where('[date+period]').equals([todayStr, period])
                .toArray();
            const absentRecords = todayAttendance.filter(a => a.status === 'absent');
            if (stale()) return;

            if (absentRecords.length === 0) {
                container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">No absences this period 🎉</p>';
                return;
            }

            // Load data for missed work summary
            const periodMap = await db.settings.get('period-year-map');
            const classPeriodsMap = periodMap?.value || {};
            const classId = parseInt(classPeriodsMap[period]);

            const activities = classId
                ? excludeDeleted(await db.activities.toArray()).filter(a => a.status === 'active' && a.classId === classId)
                : [];
            const allCheckpoints = await db.checkpoints.toArray();
            const niDays = await getActiveNonInstructionalDays();
            const allCompletions = await db.checkpointCompletions.toArray();
            const allTeamMembers = await db.teamMembers.toArray();
            const allTeams = excludeDeleted(await db.teams.toArray());

            // Check if emails were already sent today for these students
            const todayEmailLogs = await db.notes
                .where('entityType').equals('email-log')
                .filter(n => n.createdAt && n.createdAt.startsWith(todayStr))
                .toArray();
            const alreadyEmailedIds = new Set(todayEmailLogs.map(n => n.entityId));

            // Get completions made today
            const todayCompletions = allCompletions.filter(c =>
                c.completed && c.createdAt && c.createdAt.startsWith(todayStr)
            );

            const rows = document.createDocumentFragment();

            // Check if automations are enabled and webhook is configured
            const automationsEnabled = localStorage.getItem('automations-enabled') === 'true';
            const webhookUrl = localStorage.getItem('webhook_absent') || localStorage.getItem('webhook_wildcat');

            if (!automationsEnabled || !webhookUrl) {
                const notice = document.createElement('p');
                notice.style.cssText = 'font-size: var(--font-size-body-small); color: var(--color-text-warning); margin-bottom: var(--space-sm);';
                notice.textContent = automationsEnabled
                    ? '⚠️ No absence webhook URL configured. Set one in Settings → Email Automations.'
                    : '⚠️ Email automations are disabled. Enable in Settings → Email Automations.';
                rows.appendChild(notice);
            }

            for (const record of absentRecords) {
                const student = await db.students.get(parseInt(record.studentId));
                if (!student) continue;

                // Build missed work summary
                const missedItems = [];
                for (const activity of activities) {
                    const checkpoints = allCheckpoints.filter(cp => cp.activityId === activity.id);

                    // Calculate which school day of the activity this is
                    const dayPos = (activity.startDate && activity.endDate)
                        ? getSchoolDayPosition(todayStr, activity.startDate, activity.endDate, niDays)
                        : null;
                    const dayLabel = dayPos ? ` (Day ${dayPos.currentDay} of ${dayPos.totalDays})` : '';

                    // Find checkpoints completed today by the student's team
                    const studentTeam = allTeams.find(t =>
                        t.classId === classId &&
                        allTeamMembers.some(tm => tm.teamId === t.id && tm.studentId === student.id)
                    );
                    if (studentTeam) {
                        const teamMemberIds = allTeamMembers
                            .filter(tm => tm.teamId === studentTeam.id)
                            .map(tm => tm.studentId);
                        const cpsCompletedToday = checkpoints.filter(cp =>
                            todayCompletions.some(c =>
                                c.checkpointId === cp.id && teamMemberIds.includes(c.studentId)
                            )
                        );
                        if (cpsCompletedToday.length > 0) {
                            const cpNums = cpsCompletedToday.map(cp => cp.number).join(', ');
                            missedItems.push(`${activity.name}${dayLabel} — CP ${cpNums} completed by team`);
                        } else if (dayPos) {
                            // Activity is active today but no checkpoints completed — still mention it
                            missedItems.push(`${activity.name}${dayLabel} — no checkpoints completed today`);
                        }
                    } else if (dayPos) {
                        // Student has no team but activity is active today
                        missedItems.push(`${activity.name}${dayLabel}`);
                    }
                }

                const missedSummary = missedItems.length > 0
                    ? missedItems.join('; ')
                    : 'No active assignments today';

                const alreadySent = alreadyEmailedIds.has(student.id);
                const hasEmail = student.email && student.email.trim();

                const row = document.createElement('label');
                row.style.cssText = 'display: flex; align-items: flex-start; gap: var(--space-sm); padding: var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-md); margin-bottom: var(--space-xs); cursor: pointer;';
                row.innerHTML = `
                    <input type="checkbox" class="absent-email-checkbox"
                        data-period="${escapeHtml(String(period))}"
                        data-student-id="${student.id}"
                        data-student-name="${escapeHtml(displayName(student))}"
                        data-student-email="${escapeHtml(student.email || '')}"
                        data-missed="${escapeHtml(missedSummary)}"
                        ${alreadySent || !hasEmail || !automationsEnabled || !webhookUrl ? '' : 'checked'}
                        ${!hasEmail || !automationsEnabled || !webhookUrl ? 'disabled' : ''}
                        style="margin-top: 3px;">
                    <div style="flex: 1;">
                        <strong>${escapeHtml(displayName(student))}</strong>
                        ${alreadySent ? '<span style="background: var(--color-background-info); color: var(--color-text-info); padding: 1px 6px; border-radius: 4px; font-size: 11px; margin-left: 6px;">✉ Sent</span>' : ''}
                        ${!hasEmail ? '<span style="background: var(--color-background-warning); color: var(--color-text-warning); padding: 1px 6px; border-radius: 4px; font-size: 11px; margin-left: 6px;">No email</span>' : ''}
                        <p style="color: var(--color-text-secondary); font-size: var(--font-size-body-small); margin-top: 2px;">
                            Missed: ${escapeHtml(missedSummary)}
                        </p>
                    </div>
                `;
                rows.appendChild(row);
            }
            if (stale()) return;
            container.innerHTML = '';
            container.appendChild(rows);
        } catch (error) {
            console.error('Error loading absences for End Class:', error);
            container.innerHTML = '<p style="color: var(--color-error);">Failed to load absence data</p>';
        }
    },

    hideEndClassModal: function() {
        ui.hideModal('modal-end-class');
        document.getElementById('end-class-period').value = '';
        document.getElementById('end-class-teams-list').innerHTML = '';
        document.getElementById('end-class-absent-list').innerHTML = '';
        document.getElementById('end-class-wildcat-list').innerHTML = '';
    },

    loadEndClassTeams: async function() {
        const period = document.getElementById('end-class-period').value;
        if (!period) return;
        
        const teamsContainer = document.getElementById('end-class-teams-list');
        const wildcatContainer = document.getElementById('end-class-wildcat-list');
        
        try {
            // Load students enrolled in this period
            const allEnrollments = await db.enrollments.toArray();
            const periodEnrollments = allEnrollments.filter(e => e.period === period);
            const studentIds = periodEnrollments.map(e => e.studentId);
            
            const allStudents = excludeDeleted(await db.students.toArray());
            const periodStudents = allStudents
                .filter(s => studentIds.includes(s.id))
                .sort(sortByStudentName);
            
            // Load teams for this period (get teams with students in this period)
            const allTeams = await db.teams.toArray();
            const allTeamMembers = await db.teamMembers.toArray();
            
            const periodTeams = allTeams.filter(team => {
                const teamMembers = allTeamMembers.filter(tm => tm.teamId === team.id);
                const teamStudentIds = teamMembers.map(tm => tm.studentId);
                // Include team if any member is in this period
                return teamStudentIds.some(sid => studentIds.includes(sid));
            });
            
            // Render team checkout list
            if (periodTeams.length === 0) {
                teamsContainer.innerHTML = '<p style="color: var(--color-text-tertiary);">No teams in this period.</p>';
            } else {
                teamsContainer.innerHTML = '';
                periodTeams.forEach(team => {
                    const div = document.createElement('div');
                    div.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-md); margin-bottom: var(--space-xs);';
                    div.innerHTML = `
                        <span>${escapeHtml(team.name)}</span>
                        <div style="display: flex; gap: var(--space-xs);">
                            <button class="btn btn--success" style="padding: var(--space-xs) var(--space-sm);" onclick="modals.markStationStatus(${team.id}, 'good', this)">✓ Good</button>
                            <button class="btn btn--danger" style="padding: var(--space-xs) var(--space-sm);" onclick="modals.markStationStatus(${team.id}, 'needs-work', this)">✗ Needs Work</button>
                        </div>
                    `;
                    teamsContainer.appendChild(div);
                });
            }
            
            // Render wildcat student selection
            if (periodStudents.length === 0) {
                wildcatContainer.innerHTML = '<p style="color: var(--color-text-tertiary);">No students in this period.</p>';
            } else {
                wildcatContainer.innerHTML = '';
                wildcatContainer.style.cssText = 'max-height: 300px; overflow-y: auto;';
                
                periodStudents.forEach(student => {
                    const label = document.createElement('label');
                    label.style.cssText = 'display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-xs); cursor: pointer;';
                    label.innerHTML = `
                        <input type="checkbox" class="wildcat-student-checkbox" value="${student.id}">
                        ${escapeHtml(displayName(student))}
                    `;
                    wildcatContainer.appendChild(label);
                });
            }
        await this.loadBorrowedTools();
        await this.loadEndClassAbsences();
        await this.loadEndClassHubActivities(period);
        } catch (error) {
            console.error('Error loading end class data:', error);
            ui.showToast('Failed to load period data', 'error');
        }
    },

    markStationStatus: async function(teamId, status, buttonElement) {
        const period = document.getElementById('end-class-period').value;
        const today = getTodayString();
        
        try {
            // Check if checkout already exists for this team today
            const existing = await db.stationCheckouts
                .where('[date+teamId]')
                .equals([today, teamId])
                .first();
            
            if (existing) {
                // Update existing record
                await db.stationCheckouts.update(existing.id, {
                    status: status,
                    period: period
                });
            } else {
                // Create new record
                await db.stationCheckouts.add({
                    date: today,
                    period: period,
                    teamId: teamId,
                    status: status,
                    notes: '',
                    createdAt: new Date().toISOString()
                });
            }
            
            // Visual feedback
            const buttons = buttonElement.parentElement.querySelectorAll('button');
            buttons.forEach(btn => btn.style.opacity = '0.5');
            buttonElement.style.opacity = '1';
            
            if (status === 'needs-work') {
                ui.showToast('Marked as needs work - saved to history', 'warning');
            } else {
                ui.showToast('Station approved - saved!', 'success');
            }
        } catch (error) {
            console.error('Error saving station checkout:', error);
            ui.showToast('Failed to save checkout status', 'error');
        }
    },

    saveWildcatAttendees: async function() {
        const checkedBoxes = document.querySelectorAll('.wildcat-student-checkbox:checked');
        const studentIds = Array.from(checkedBoxes).map(cb => parseInt(cb.value));

        if (studentIds.length === 0) {
            ui.showToast('No students selected for Wildcat', 'info');
            return;
        }

        // Local date helper — avoids UTC offset bug
        const localDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        const now = new Date();
        const todayStr = localDateStr(now);
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        // Check if Wildcat has already happened today by comparing current time to bell schedule
        let wildcatAlreadyHappened = false;
        try {
            const bellData = await db.settings.get('bell-schedules');
            const scheduleSelector = document.getElementById('schedule-selector');
            const activeSchedule = scheduleSelector ? scheduleSelector.value : 'normal';
            const noWildcatSchedules = ['2-hour-delay', '3-hour-delay', 'early-dismissal'];

            if (noWildcatSchedules.includes(activeSchedule)) {
                wildcatAlreadyHappened = true;
            } else if (bellData?.value?.[activeSchedule]?.wildcat?.end) {
                wildcatAlreadyHappened = currentTime > bellData.value[activeSchedule].wildcat.end;
            }
        } catch (e) { /* if no bell schedule, assume Wildcat hasn't happened */ }

        // Find the next valid Wildcat day (skips weekends and non-instructional days)
        const findNextWildcatDay = async (fromDate) => {
            const niDays = await getActiveNonInstructionalDays();

            const isNonInstructional = (dateStr) => niDays.some(ni => {
                if (ni.end) return dateStr >= ni.start && dateStr <= ni.end;
                return ni.start === dateStr;
            });

            const candidate = new Date(fromDate);
            candidate.setDate(candidate.getDate() + 1);

            for (let i = 0; i < 14; i++) {
                const candidateStr = localDateStr(candidate);
                const dow = candidate.getDay();
                const isWeekend = dow === 0 || dow === 6;
                if (!isWeekend && !isNonInstructional(candidateStr)) {
                    return candidateStr;
                }
                candidate.setDate(candidate.getDate() + 1);
            }
            return localDateStr(candidate);
        };

        const targetDate = wildcatAlreadyHappened
            ? await findNextWildcatDay(now)
            : todayStr;

        // Save to IndexedDB — skip students already scheduled for this date
        let addedCount = 0;
        for (const studentId of studentIds) {
            const existing = await db.wildcatSchedule
                .where('studentId').equals(studentId)
                .filter(r => r.targetDate === targetDate && r.status !== 'cancelled')
                .first();
            if (!existing) {
                await db.wildcatSchedule.add({
                    studentId: studentId,
                    targetDate: targetDate,
                    status: 'pending',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
                addedCount++;
            }
        }

        // If target date is today, pre-create attendance records
        if (targetDate === todayStr) {
            await this.createWildcatAttendanceRecords(targetDate);
        }

        const dateLabel = targetDate === todayStr ? 'today' : targetDate;
        ui.showToast(`${addedCount} student(s) scheduled for Wildcat on ${dateLabel}`, 'success');
    },

    // Pre-create attendance records for scheduled Wildcat students
    createWildcatAttendanceRecords: async function(dateStr) {
        const scheduled = await db.wildcatSchedule
            .where('targetDate').equals(dateStr)
            .filter(r => ['pending', 'attendance-created', 'emailed'].includes(r.status))
            .toArray();

        for (const record of scheduled) {
            // Check if attendance record already exists
            const existing = await db.attendance
                .where('[studentId+date+period]')
                .equals([String(record.studentId), dateStr, 'wildcat'])
                .first();

            if (!existing) {
                await db.attendance.add({
                    studentId: String(record.studentId),
                    date: dateStr,
                    period: 'wildcat',
                    status: 'unmarked',
                    createdAt: new Date().toISOString()
                });
            }

            // Mark as attendance-created (but don't downgrade emailed records)
            if (record.status === 'pending') {
                await db.wildcatSchedule.update(record.id, { status: 'attendance-created', updatedAt: new Date().toISOString() });
            }
        }
    },

    loadEndClassHubActivities: async function(period) {
        const card = document.getElementById('end-class-hub-sync-card');
        const container = document.getElementById('end-class-hub-activities');
        
        const webhook = localStorage.getItem('webhook_wildcat');
        const stepsSetting = await db.settings.get('end-class-steps');
        if (!webhook || stepsSetting?.value?.hubSync === false) {
            card.style.display = 'none';
            container.innerHTML = '';
            return;
        }
        
        try {
            // Find which class is assigned to this period
            const periodMap = await db.settings.get('period-year-map');
            const classPeriodsMap = periodMap?.value || {};
            const classId = classPeriodsMap[period] ? parseInt(classPeriodsMap[period]) : null;
            
            if (!classId) {
                card.style.display = 'none';
                return;
            }
            
            // Get active activities for this class
            const allActivities = excludeDeleted(await db.activities.toArray());
            const classActivities = allActivities.filter(a => a.classId === classId && a.status !== 'archived');
            
            if (classActivities.length === 0) {
                card.style.display = 'none';
                return;
            }
            
            card.style.display = '';
            container.innerHTML = '';
            
            classActivities.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            
            for (const activity of classActivities) {
                const lastSync = activity.lastHubSync 
                    ? new Date(activity.lastHubSync).toLocaleString() 
                    : 'Never';
                
                const label = document.createElement('label');
                label.style.cssText = 'display: flex; align-items: flex-start; gap: var(--space-sm); padding: var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-md); margin-bottom: var(--space-xs); cursor: pointer;';
                label.innerHTML = `
                    <input type="checkbox" class="hub-sync-checkbox" value="${activity.id}" style="margin-top: 3px;">
                    <div style="flex: 1;">
                        <strong>${escapeHtml(activity.name)}</strong>
                        <p style="color: var(--color-text-tertiary); font-size: var(--font-size-body-small); margin-top: 2px;">Last synced: ${lastSync}</p>
                    </div>
                `;
                container.appendChild(label);
            }
        } catch (error) {
            console.error('Error loading hub activities:', error);
            card.style.display = 'none';
        }
    },

    completeEndClass: async function() {
        const period = document.getElementById('end-class-period').value;
        if (!period) {
            ui.showToast('Please select a period first', 'error');
            return;
        }
        
        try {
            // Save Wildcat attendees if any are selected
            await this.saveWildcatAttendees();
        } catch (err) {
            console.error('Error saving Wildcat attendees during End Class:', err);
            ui.showToast('Warning: Wildcat save failed — check console', 'error');
        }

        // Steps turned off in Settings are skipped, even if their boxes are ticked
        const endClassSteps = (await db.settings.get('end-class-steps'))?.value || {};
        const stepOn = key => endClassSteps[key] !== false;

        // Send absence notification emails for checked students (after confirming)
        // 2-05 (X6): only rows drawn for this period
        const checkedAbsent = stepOn('absentNotifications')
            ? [...document.querySelectorAll('.absent-email-checkbox:checked')].filter(cb => cb.dataset.period === String(period)) : [];
        if (checkedAbsent.length > 0 &&
            !confirm(`Send absence emails for ${checkedAbsent.length} student(s) now?`)) {
            ui.showToast('Absence emails not sent', 'info');
        } else if (checkedAbsent.length > 0) {
            const webhookUrl = localStorage.getItem('webhook_absent') || localStorage.getItem('webhook_wildcat');
            const automationsEnabled = localStorage.getItem('automations-enabled') === 'true';

            if (automationsEnabled && webhookUrl) {
                const todayStr = getTodayString();
                const teacherEmail = localStorage.getItem('teacher_email') || '';
                const absences = [];

                for (const cb of checkedAbsent) {
                    absences.push({
                        studentName: cb.dataset.studentName,
                        studentEmail: cb.dataset.studentEmail,
                        teacherEmail: teacherEmail,
                        date: todayStr,
                        missedItems: cb.dataset.missed
                    });
                }

                try {
                    const response = await webhookFetch(webhookUrl, {
                        method: 'POST',
                        body: JSON.stringify({
                            action: 'send_absence_summary',
                            absences: absences,
                            token: localStorage.getItem('webhook_token') || ''
                        })
                    });
                    const result = await response.json();

                    if (result.status === 'success') {
                        // Log each email in db.notes for dashboard badges (Task 4.4)
                        for (const cb of checkedAbsent) {
                            const studentId = parseInt(cb.dataset.studentId);
                            await db.notes.add({
                                entityType: 'email-log',
                                entityId: studentId,
                                content: `Absence notification sent for ${todayStr} (Period ${period}). Missed: ${cb.dataset.missed}`,
                                createdAt: new Date().toISOString()
                            });
                        }
                        ui.showToast(`✉ Sent ${absences.length} absence notification(s)`, 'success');
                    } else {
                        console.error('Absence email error:', result);
                        ui.showToast('Failed to send absence emails — check console', 'error');
                    }
                } catch (err) {
                    console.error('Absence email fetch failed:', err);
                    ui.showToast('Failed to send absence emails — check console', 'error');
                }
            }
        }
        // Sync checked activities to Student Hub
        const hubCheckboxes = stepOn('hubSync') ? document.querySelectorAll('.hub-sync-checkbox:checked') : [];
        if (hubCheckboxes.length > 0) {
            const webhook = localStorage.getItem('webhook_wildcat');
            const token = localStorage.getItem('webhook_token') || '';
            
            if (webhook) {
                let syncCount = 0;
                let syncErrors = 0;
                
                for (const cb of hubCheckboxes) {
                    const activityId = parseInt(cb.value);
                    try {
                        // Temporarily set editingActivityId and call syncToHub
                        const originalId = state.editingActivityId;
                        state.editingActivityId = activityId;
                        
                        const activity = await db.activities.get(activityId);
                        if (!activity) continue;
                        
                        // Load checkpoints
                        const checkpoints = await db.checkpoints.where('activityId').equals(activityId).toArray();
                        checkpoints.sort((a, b) => a.number - b.number);
                        
                        // Load students for this class
                        const periodMap = await db.settings.get('period-year-map');
                        const classPeriodsMap = periodMap?.value || {};
                        const periodsForClass = Object.entries(classPeriodsMap)
                            .filter(([p, cId]) => parseInt(cId) === activity.classId)
                            .map(([p]) => p);
                        
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
                        
                        // Load teams
                        const allTeams = excludeDeleted(await db.teams.toArray()).filter(t => t.classId === activity.classId);
                        const allTeamMembers = await db.teamMembers.toArray();
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
                                    classroomUrl = 'https://classroom.google.com/c/' + courseId + '/a/' + cwId;
                                }
                            }
                        }

                        // Build and send payload
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
                                // Contract Brief (student-facing) — kept in parity with the per-activity sync in activities.js
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
                        const resultText = await response.text();
                        console.log('Hub sync response:', response.status, resultText);
                        const result = JSON.parse(resultText);
                        
                        if (result.status === 'success') {
                            const now = new Date().toISOString();
                            await db.activities.update(activityId, { lastHubSync: now });
                            syncCount++;
                        } else {
                            syncErrors++;
                        }
                        
                        state.editingActivityId = originalId;
                    } catch (err) {
                        console.error('Hub sync error for activity ' + activityId + ':', err);
                        syncErrors++;
                    }
                }
                
                if (syncCount > 0) {
                    ui.showToast(`📤 Synced ${syncCount} activit${syncCount === 1 ? 'y' : 'ies'} to Student Hub`, 'success');
                }
                if (syncErrors > 0) {
                    ui.showToast(`⚠️ ${syncErrors} activit${syncErrors === 1 ? 'y' : 'ies'} failed to sync`, 'error');
                }
            }
        }
        ui.showToast('End of class checklist complete!', 'success');
        this.hideEndClassModal();
        
        // Refresh dashboard to show Wildcat tasks and email badges
        pages.dashboard.render();
    },  

    // Inventory modal functions
    showAddInventoryItem: function() {
        state.editingInventoryId = null;
        document.getElementById('inventory-modal-title').textContent = 'Add Inventory Item';
        document.getElementById('inventory-form').reset();
        ui.showModal('modal-inventory');
    },

    showEditInventoryItem: async function(itemId) {
        state.editingInventoryId = itemId;
        document.getElementById('inventory-modal-title').textContent = 'Edit Inventory Item';
        
        try {
            const item = await db.inventory.get(itemId);
            if (item) {
                document.getElementById('inventory-name').value = item.name;
                document.getElementById('inventory-category').value = item.category;
                document.getElementById('inventory-quantity').value = item.quantity;
                document.getElementById('inventory-threshold').value = item.threshold;
                document.getElementById('inventory-location').value = item.location || '';
                
                ui.showModal('modal-inventory');
            }
        } catch (error) {
            console.error('Error loading inventory item:', error);
            ui.showToast('Failed to load item', 'error');
        }
    },

    hideInventoryModal: function() {
        ui.hideModal('modal-inventory');
        document.getElementById('inventory-form').reset();
        state.editingInventoryId = null;
    },

    saveInventoryItem: async function() {
        const name = document.getElementById('inventory-name').value.trim();
        const category = document.getElementById('inventory-category').value;
        const quantity = parseInt(document.getElementById('inventory-quantity').value);
        const threshold = parseInt(document.getElementById('inventory-threshold').value);
        const location = document.getElementById('inventory-location').value.trim();
        
        if (!name || !category || isNaN(quantity) || isNaN(threshold)) {
            ui.showToast('Please fill in all required fields', 'error');
            return;
        }
        
        try {
            const itemData = {
                name: name,
                category: category,
                quantity: quantity,
                threshold: threshold,
                location: location,
            };

            if (state.editingInventoryId) {
                itemData.updatedAt = new Date().toISOString();
            } else {
                itemData.createdAt = new Date().toISOString();
            }
            
            if (state.editingInventoryId) {
                await db.inventory.update(state.editingInventoryId, itemData);
                ui.showToast('Item updated successfully', 'success');
                driveSync.markDirty();
            } else {
                await db.inventory.add(itemData);
                ui.showToast('Item added successfully', 'success');
                driveSync.markDirty();
            }
            
            this.hideInventoryModal();
            pages.inventory.render();
        } catch (error) {
            console.error('Error saving inventory item:', error);
            ui.showToast('Failed to save item', 'error');
        }
    },

    // Checkout modal functions
    showCheckoutModal: async function(itemId) {
        state.selectedInventoryItem = itemId;
        
        try {
            const item = await db.inventory.get(itemId);
            if (!item) {
                ui.showToast('Item not found', 'error');
                return;
            }
            
            // Show modal
            ui.showModal('modal-checkout');
            
            // Determine if this is a consumable material
            const isMaterial = item.category === 'materials';
            
            // Show/hide fields based on category
            document.getElementById('checkout-quantity-group').style.display = isMaterial ? 'block' : 'none';
            document.getElementById('checkout-duedate-group').style.display = isMaterial ? 'none' : 'block';
            
            // Update helper text
            const studentHelper = document.getElementById('checkout-students-helper');
            if (isMaterial) {
                studentHelper.textContent = 'Select students receiving materials. Set quantity below.';
            } else {
                studentHelper.textContent = 'Select students. Each will check out one item.';
            }
            
            // Populate item info
            const infoDiv = document.getElementById('checkout-item-info');
            infoDiv.innerHTML = `
                <h4>${escapeHtml(item.name)}</h4>
                <p>Category: ${item.category.charAt(0).toUpperCase() + item.category.slice(1)}</p>
                <p>Total Quantity: ${item.quantity}</p>
            `;
            
            // Load students with smart ordering
            const allStudents = excludeDeleted(await db.students.toArray());
            
            // Get current period from header dropdown
            const headerPeriodSelect = document.getElementById('period-select');
            const currentPeriod = headerPeriodSelect ? headerPeriodSelect.value : null;
            
            // Get enrollments to determine which students are in the current period
            const enrollments = await db.enrollments.toArray();
            const studentsInCurrentPeriod = new Set();
            
            if (currentPeriod) {
                enrollments.forEach(e => {
                    if (String(e.period) === String(currentPeriod)) {
                        studentsInCurrentPeriod.add(e.studentId);
                    }
                });
            }
            
            // Separate students into two groups
            const currentPeriodStudents = allStudents.filter(s => studentsInCurrentPeriod.has(s.id));
            const otherStudents = allStudents.filter(s => !studentsInCurrentPeriod.has(s.id));
            
            // Sort each group alphabetically
            currentPeriodStudents.sort(sortByStudentName);
            otherStudents.sort(sortByStudentName);
            
            // Render students list
            const studentsList = document.getElementById('checkout-students-list');
            studentsList.innerHTML = '';
            
            // Render current period students first (if any)
            if (currentPeriodStudents.length > 0) {
                const header = document.createElement('div');
                header.style.cssText = 'padding: var(--space-sm) var(--space-base); background-color: var(--color-primary-light); font-weight: 600; color: var(--color-primary); border-bottom: 2px solid var(--color-primary); margin-bottom: var(--space-xs);';
                header.textContent = currentPeriod === 'wildcat' ? 'Wildcat Students' : `Period ${currentPeriod} Students`;
                studentsList.appendChild(header);
                
                currentPeriodStudents.forEach(student => {
                    const div = document.createElement('div');
                    div.style.cssText = 'padding: var(--space-xs); border-bottom: 1px solid var(--color-border);';
                    div.innerHTML = `
                        <label style="display: flex; align-items: center; cursor: pointer; user-select: none;">
                            <input type="checkbox" class="checkout-student-checkbox" value="${student.id}" style="margin-right: var(--space-sm);">
                            <span>${escapeHtml(displayName(student))}</span>
                        </label>
                    `;
                    studentsList.appendChild(div);
                });
            }
            
            // Render other students
            if (otherStudents.length > 0) {
                const header = document.createElement('div');
                header.style.cssText = 'padding: var(--space-sm) var(--space-base); background-color: var(--color-background-tertiary); font-weight: 600; color: var(--color-text-secondary); border-bottom: 1px solid var(--color-border); margin-top: var(--space-base); margin-bottom: var(--space-xs);';
                header.textContent = 'Other Students';
                studentsList.appendChild(header);
                
                otherStudents.forEach(student => {
                    const div = document.createElement('div');
                    div.style.cssText = 'padding: var(--space-xs); border-bottom: 1px solid var(--color-border);';
                    div.innerHTML = `
                        <label style="display: flex; align-items: center; cursor: pointer; user-select: none;">
                            <input type="checkbox" class="checkout-student-checkbox" value="${student.id}" style="margin-right: var(--space-sm);">
                            <span>${escapeHtml(displayName(student))}</span>
                        </label>
                    `;
                    studentsList.appendChild(div);
                });
            }
            
            // Reset quantity field
            document.getElementById('checkout-quantity').value = '1';
            
            // Load active checkouts
            await this.loadActiveCheckouts(itemId);
            
        } catch (error) {
            console.error('Error loading checkout modal:', error);
            ui.showToast('Failed to load checkout modal', 'error');
        }
    },

    hideCheckoutModal: function() {
        ui.hideModal('modal-checkout');
        
        // Clear checkboxes
        const checkboxes = document.querySelectorAll('.checkout-student-checkbox');
        checkboxes.forEach(cb => cb.checked = false);
        
        // Clear form fields
        document.getElementById('checkout-due-date').value = '';
        document.getElementById('checkout-notes').value = '';
        document.getElementById('checkout-quantity').value = '1';
        
        state.selectedInventoryItem = null;
    },

    loadActiveCheckouts: async function(itemId) {
        const container = document.getElementById('checkouts-container');
        
        try {
            const checkouts = await db.checkouts
                .where('itemId')
                .equals(itemId)
                .and(c => !c.returnedAt)
                .toArray();
            
            if (checkouts.length === 0) {
                container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">No active checkouts</p>';
                return;
            }
            
            const allStudents = excludeDeleted(await db.students.toArray());
            
            container.innerHTML = '';
            for (const checkout of checkouts) {
                const student = allStudents.find(s => s.id === checkout.studentId);
                if (!student) continue;
                
                const checkedOutDate = new Date(checkout.checkedOutAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const isOverdue = checkout.dueDate && new Date(checkout.dueDate) < new Date();
                
                const div = document.createElement('div');
                div.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-md); margin-bottom: var(--space-xs);';
                div.innerHTML = `
                    <div>
                        <strong>${escapeHtml(displayName(student))}</strong>
                        <p style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">
                            Checked out ${checkedOutDate}
                            ${checkout.dueDate ? ` • Due ${new Date(checkout.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                        </p>
                        ${checkout.notes ? `<p style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">${escapeHtml(checkout.notes)}</p>` : ''}
                    </div>
                    <button class="btn btn--success" style="padding: var(--space-xs) var(--space-sm);" onclick="modals.checkIn(${checkout.id})">Check In</button>
                `;
                
                if (isOverdue) {
                    div.style.borderColor = 'var(--color-error)';
                    div.style.backgroundColor = 'rgba(220, 38, 38, 0.1)';
                }
                
                container.appendChild(div);
            }
        } catch (error) {
            console.error('Error loading checkouts:', error);
            container.innerHTML = '<p style="color: var(--color-error);">Failed to load checkouts</p>';
        }
    },

    submitCheckout: async function() {
        const itemId = state.selectedInventoryItem;
        const item = await db.inventory.get(itemId);
        const isMaterial = item.category === 'materials';
        
        const checkedBoxes = document.querySelectorAll('.checkout-student-checkbox:checked');
        const studentIds = Array.from(checkedBoxes).map(cb => parseInt(cb.value));
        const dueDate = document.getElementById('checkout-due-date').value;
        const notes = document.getElementById('checkout-notes').value.trim();
        const quantity = isMaterial ? parseInt(document.getElementById('checkout-quantity').value) : 1;
        
        // Get current period from header
        const headerPeriodSelect = document.getElementById('period-select');
        const currentPeriod = headerPeriodSelect ? headerPeriodSelect.value : null;
        
        if (studentIds.length === 0) {
            ui.showToast('Please select at least one student', 'error');
            return;
        }
        
        if (isMaterial && (!quantity || quantity < 1)) {
            ui.showToast('Please enter a valid quantity', 'error');
            return;
        }
        
        // Check certifications for tools/equipment (not materials)
        if (!isMaterial) {
            const allCerts = await db.certifications.filter(c => c.toolId === itemId).toArray();
            const certifiedIds = new Set(allCerts.map(c => c.studentId));
            const uncertified = [];
            for (const sid of studentIds) {
                if (!certifiedIds.has(sid)) {
                    const student = await db.students.get(sid);
                    if (student) uncertified.push(displayName(student));
                }
            }
            if (uncertified.length > 0) {
                const proceed = confirm(`⚠️ The following students are NOT certified on ${item.name}:\n\n${uncertified.join('\n')}\n\nCheck out anyway?`);
                if (!proceed) return;
            }
        }

        try {
            // For materials, check total quantity needed
            // For tools, check if enough individual items available
            if (isMaterial) {
                const totalNeeded = quantity * studentIds.length;
                if (item.quantity < totalNeeded) {
                    ui.showToast(`Not enough materials. Need ${totalNeeded}, only ${item.quantity} available.`, 'error');
                    return;
                }
                
                // Deduct from inventory immediately for materials
                await db.inventory.update(itemId, {
                    quantity: item.quantity - totalNeeded
                });
                
                // Create checkout records (materials are marked as returned immediately)
                for (const studentId of studentIds) {
                    await db.checkouts.add({
                        itemId: itemId,
                        studentId: studentId,
                        quantity: quantity,
                        checkedOutAt: new Date().toISOString(),
                        period: currentPeriod, // NEW: Track period
                        dueDate: null,
                        notes: notes,
                        returnedAt: new Date().toISOString(), // Materials are consumed
                        createdAt: new Date().toISOString()
                    });
                }
                
                ui.showToast(`${totalNeeded} units distributed to ${studentIds.length} student(s)`, 'success');
                
            } else {
                // Tools/Equipment - check availability
                const allCheckoutsTemp = await db.checkouts.toArray();
                const activeCheckouts = allCheckoutsTemp.filter(c => c.itemId === itemId && !c.returnedAt);
                const available = item.quantity - activeCheckouts.length;
                
                if (available < studentIds.length) {
                    ui.showToast(`Only ${available} items available. You selected ${studentIds.length} students.`, 'error');
                    return;
                }
                
                // Create checkout records for tools (one per student)
                for (const studentId of studentIds) {
                    await db.checkouts.add({
                        itemId: itemId,
                        studentId: studentId,
                        quantity: 1,
                        checkedOutAt: new Date().toISOString(),
                        period: currentPeriod, // NEW: Track period  
                        dueDate: dueDate || null,
                        notes: notes,
                        returnedAt: null,
                        createdAt: new Date().toISOString()
                    });
                }
                
                ui.showToast(`${studentIds.length} item(s) checked out successfully`, 'success');
            }
            
            // Reload active checkouts
            await this.loadActiveCheckouts(itemId);
            
            // Clear form
            document.querySelectorAll('.checkout-student-checkbox').forEach(cb => cb.checked = false);
            document.getElementById('checkout-due-date').value = '';
            document.getElementById('checkout-notes').value = '';
            document.getElementById('checkout-quantity').value = '1';
            
            // Refresh inventory page
            pages.inventory.render();
            
        } catch (error) {
            console.error('Error checking out item:', error);
            ui.showToast('Failed to check out item', 'error');
        }
    },

    checkIn: async function(checkoutId) {
        try {
            await db.checkouts.update(checkoutId, {
                returnedAt: new Date().toISOString()
            });
            
            ui.showToast('Item checked in successfully', 'success');
            
            // Reload active checkouts
            const checkout = await db.checkouts.get(checkoutId);
            await this.loadActiveCheckouts(checkout.itemId);
            
            // Refresh inventory page
            pages.inventory.render();
            
        } catch (error) {
            console.error('Error checking in item:', error);
            ui.showToast('Failed to check in item', 'error');
        }
    },

    onTaskLinkTypeChange: async function() {
        const type = document.getElementById('task-link-type').value;
        const entityGroup = document.getElementById('task-link-entity-group');
        const entitySelect = document.getElementById('task-link-entity-id');
        const entityLabel = document.getElementById('task-link-entity-label');

        if (!type) {
            entityGroup.style.display = 'none';
            entitySelect.innerHTML = '<option value="">-- Select --</option>';
            return;
        }

        entityGroup.style.display = '';
        let options = '<option value="">-- Select --</option>';

        switch (type) {
            case 'student': {
                entityLabel.textContent = 'student';
                const students = (await db.students.toArray()).filter(s => !s.deletedAt);
                students.sort(sortByStudentName);
                options += students.map(s =>
                    `<option value="${s.id}">${escapeHtml(displayName(s))}</option>`
                ).join('');
                break;
            }
            case 'activity': {
                entityLabel.textContent = 'assignment';
                const activities = (await db.activities.toArray()).filter(a => !a.deletedAt);
                activities.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
                options += activities.map(a =>
                    `<option value="${a.id}">${escapeHtml(a.name)}</option>`
                ).join('');
                break;
            }
            case 'inventory': {
                entityLabel.textContent = 'item';
                const items = await db.inventory.toArray();
                items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                options += items.map(i =>
                    `<option value="${i.id}">${escapeHtml(i.name)}</option>`
                ).join('');
                break;
            }
            case 'team': {
                entityLabel.textContent = 'group';
                const teams = await db.teams.toArray();
                teams.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                options += teams.map(t =>
                    `<option value="${t.id}">${escapeHtml(t.name)}</option>`
                ).join('');
                break;
            }
        }

        entitySelect.innerHTML = options;
    },

    // Task modal functions
    showAddTask: function() {
        ui.showModal('modal-add-task');
        
        // Set default due date to tomorrow at 8am
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(8, 0, 0, 0);
        const formatted = tomorrow.toISOString().slice(0, 16);
        document.getElementById('task-due-date').value = formatted;
    },

    hideAddTask: function() {
        ui.hideModal('modal-add-task');
        document.getElementById('task-description').value = '';
        document.getElementById('task-due-date').value = '';
        document.getElementById('task-priority').value = 'medium';
        // Sprint 13.6: Reset link fields
        document.getElementById('task-link-type').value = '';
        document.getElementById('task-link-entity-group').style.display = 'none';
        document.getElementById('task-link-entity-id').innerHTML = '<option value="">-- Select --</option>';
    },

    saveTask: async function() {
        const description = document.getElementById('task-description').value.trim();
        const dueDate = document.getElementById('task-due-date').value;
        const priority = document.getElementById('task-priority').value;

        if (!description) {
            ui.showToast('Please enter a task description', 'error');
            return;
        }

        const linkType = document.getElementById('task-link-type').value || null;
        const linkId = document.getElementById('task-link-entity-id').value ? parseInt(document.getElementById('task-link-entity-id').value) : null;

        try {
            const taskData = {
                description: description,
                dueDate: dueDate || null,
                priority: priority,
                status: 'pending',
                completed: false,
                type: 'manual',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            if (linkType && linkId) {
                taskData.linkedEntityType = linkType;
                taskData.linkedEntityId = linkId;
            }

            await db.tasks.add(taskData);

            driveSync.markDirty();
            logAction('create', 'task', null, description);
            ui.showToast('Task added!', 'success');
            this.hideAddTask();
            pages.dashboard.loadTasks();
        } catch (error) {
            console.error('Error saving task:', error);
            ui.showToast('Failed to save task', 'error');
        }
    },

    // Event modal functions
    showAddEvent: function(dateString = null) {
        state.editingEventId = null;
        document.getElementById('event-modal-title').textContent = 'Add Event';
        document.getElementById('event-form').reset();
        document.getElementById('delete-event-btn').style.display = 'none';
        
        // Pre-fill date if provided (from calendar click)
        if (dateString) {
            document.getElementById('event-date').value = dateString;
        } else {
            // Default to today
            const today = new Date();
            const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            document.getElementById('event-date').value = todayString;
        }
        
        ui.showModal('modal-event');
    },

    showEditEvent: async function(eventId) {
        state.editingEventId = eventId;
        document.getElementById('event-modal-title').textContent = 'Edit Event';
        document.getElementById('delete-event-btn').style.display = 'inline-flex';
        
        try {
            const event = await db.events.get(eventId);
            if (event) {
                document.getElementById('event-title').value = event.title;
                document.getElementById('event-date').value = event.date;
                document.getElementById('event-category').value = event.category || 'general';
                document.getElementById('event-description').value = event.description || '';
                
                ui.showModal('modal-event');
            }
        } catch (error) {
            console.error('Error loading event:', error);
            ui.showToast('Failed to load event', 'error');
        }
    },

    hideEventModal: function() {
        ui.hideModal('modal-event');
        document.getElementById('event-form').reset();
        state.editingEventId = null;
    },

    saveEvent: async function() {
        const title = document.getElementById('event-title').value.trim();
        const date = document.getElementById('event-date').value;
        const category = document.getElementById('event-category').value;
        const description = document.getElementById('event-description').value.trim();
        
        if (!title || !date) {
            ui.showToast('Please fill in all required fields', 'error');
            return;
        }
        
        try {
            const eventData = {
                title: title,
                date: date,
                category: category,
                description: description,
            };

            if (state.editingEventId) {
                eventData.updatedAt = new Date().toISOString();
            } else {
                eventData.createdAt = new Date().toISOString();
            }
            
            if (state.editingEventId) {
                // Update existing event
                await db.events.update(state.editingEventId, eventData);
                ui.showToast('Event updated successfully', 'success');
            } else {
                // Add new event
                await db.events.add(eventData);
                ui.showToast('Event created successfully', 'success');
            }
            
            this.hideEventModal();
            
            // Refresh calendar if visible
            if (!document.getElementById('page-calendar').classList.contains('hidden')) {
                pages.calendar.render();
            }
            
            // Refresh dashboard if visible
            if (!document.getElementById('page-dashboard').classList.contains('hidden')) {
                pages.dashboard.loadTodaysEvents();
            }
            
        } catch (error) {
            console.error('Error saving event:', error);
            ui.showToast('Failed to save event', 'error');
        }
    },

    deleteEvent: async function() {
        if (!confirm('Are you sure you want to delete this event?')) {
            return;
        }
        
        try {
            await db.events.delete(state.editingEventId);
            ui.showToast('Event deleted successfully', 'success');
            this.hideEventModal();
            
            // Refresh calendar if visible
            if (!document.getElementById('page-calendar').classList.contains('hidden')) {
                pages.calendar.render();
            }
            
            // Refresh dashboard if visible
            if (!document.getElementById('page-dashboard').classList.contains('hidden')) {
                pages.dashboard.loadTodaysEvents();
            }
            
        } catch (error) {
            console.error('Error deleting event:', error);
            ui.showToast('Failed to delete event', 'error');
        }
    },

}; 
