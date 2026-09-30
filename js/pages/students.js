// ----------------------------------------
// STUDENTS PAGE
// ----------------------------------------
pages.students = {
    // Keep track of what we are currently looking at
    currentFilter: 'active',

    // New function to handle the filter button clicks
    setFilter: function(filterType) {
        this.currentFilter = filterType;
        
        // Update button colors (make active button primary, others secondary)
        const buttons = document.querySelectorAll('.student-filter-btn');
        buttons.forEach(btn => {
            if (btn.dataset.filter === filterType) {
                btn.classList.remove('btn--secondary');
                btn.classList.add('btn--primary');
            } else {
                btn.classList.remove('btn--primary');
                btn.classList.add('btn--secondary');
            }
        });

        // Redraw the grid with the new filter
        this.render();
    },

    render: async function() {
        const grid = document.getElementById('students-grid');
        grid.innerHTML = '';
        
        try {
            // Load all students
            let students = excludeDeleted(await db.students.toArray());
            
            // --- CHANGE 1: Apply Status Filter ---
            if (this.currentFilter === 'all') {
                // "All" button: Show all UNARCHIVED students
                students = students.filter(s => (s.status || 'active') !== 'archived');
            } else {
                // Other buttons ('active', 'archived'): Filter exactly by status
                students = students.filter(s => (s.status || 'active') === this.currentFilter);
            }
            
            // Load all enrollments
            const enrollments = await db.enrollments.toArray();
            
            // Create a map of studentId to periods array
            const studentPeriods = {};
            enrollments.forEach(enroll => {
                if (!studentPeriods[enroll.studentId]) {
                    studentPeriods[enroll.studentId] = [];
                }
                studentPeriods[enroll.studentId].push(enroll.period);
            });
            
            // Add periods to each student
            students = students.map(student => ({
                ...student,
                periods: studentPeriods[student.id] || []
            }));
            
            // Get the selected period from the HEADER dropdown
            const headerPeriodSelect = document.getElementById('period-select');
            const selectedPeriod = headerPeriodSelect ? headerPeriodSelect.value : '';
            
            // --- CHANGE 2: Apply Period Filter ---
            // ONLY filter by the current period if the user is NOT on the "All" tab
            if (this.currentFilter !== 'all' && selectedPeriod && selectedPeriod !== '') {
                students = students.filter(s => s.periods.includes(selectedPeriod));
            }
            
            // Show message if no students
            if (students.length === 0) {
                grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--color-text-tertiary); padding: var(--space-2xl);">No students found for current filters.</p>';
                return;
            }

            // Sort alphabetically by name first
            students.sort(sortByStudentName);

            // Load all classes for grouping
            const allClasses = await db.classes.toArray();
            const classMap = {};
            allClasses.forEach(cls => classMap[cls.id] = cls);

            // Group students by classId
            const groups = {};
            allClasses.forEach(cls => groups[cls.id] = []);

            students.forEach(student => {
                const classId = student.classId;
                if (classId && groups[classId] !== undefined) {
                    groups[classId].push(student);
                } else {
                    // Uncategorized students
                    if (!groups['none']) groups['none'] = [];
                    groups['none'].push(student);
                }
            });

            // Render each group in class order
            allClasses.forEach(cls => {
                const groupStudents = groups[cls.id] || [];
                if (groupStudents.length === 0) return;

                // Add group header
                const header = document.createElement('div');
                header.style.cssText = `
                    grid-column: 1 / -1;
                    padding: var(--space-base) 0 var(--space-sm) 0;
                    font-size: var(--font-size-h3);
                    font-weight: 600;
                    color: var(--color-text-primary);
                    border-bottom: 2px solid ${cls.color};
                    margin-top: var(--space-lg);
                `;
                header.textContent = cls.name;
                grid.appendChild(header);

                groupStudents.forEach(student => {
                    const card = this.createStudentCard(student);
                    grid.appendChild(card);
                });
            });

            // Render uncategorized students if any
            if (groups['none'] && groups['none'].length > 0) {
                const header = document.createElement('div');
                header.style.cssText = `
                    grid-column: 1 / -1;
                    padding: var(--space-base) 0 var(--space-sm) 0;
                    font-size: var(--font-size-h3);
                    font-weight: 600;
                    color: var(--color-text-primary);
                    border-bottom: 2px solid var(--color-text-tertiary);
                    margin-top: var(--space-lg);
                `;
                header.textContent = 'Unassigned';
                grid.appendChild(header);
                groups['none'].forEach(student => {
                    const card = this.createStudentCard(student);
                    grid.appendChild(card);
                });
            }
        } catch (error) {
            console.error('Error loading students:', error);
            grid.innerHTML = '<p style="color: var(--color-error);">Failed to load students. Check console for details.</p>';
        }
    },
        
    createStudentCard: function(student) {
        const card = document.createElement('div');
        card.className = 'card student-card';

        const isArchived = student.status === 'archived';
        if (isArchived) {
            card.style.opacity = '0.7';
        }

        // Default color while class loads
        const defaultColor = isArchived ? '#9ca3af' : '#71717a';

        // Get first non-wildcat period number for display
        const displayPeriod = student.periods.find(p => p !== 'wildcat') || student.periods[0] || '?';

        // Display all periods as text
        const periodsDisplay = student.periods.length > 0
            ? student.periods.map(p => p === 'wildcat' ? 'Wildcat' : `Period ${p}`).join('<br>')
            : 'No periods assigned';

        const archiveBtnText = isArchived ? 'Unarchive' : 'Archive';

        card.innerHTML = `
            <div class="card__header student-card__header">
                <div class="student-card__avatar" id="avatar-${student.id}" style="background-color: ${defaultColor}20; color: ${defaultColor};">
                    ${escapeHtml(displayPeriod)}
                </div>
                <div class="student-card__info">
                    <h4>${escapeHtml(displayName(student))} ${isArchived ? '<span style="font-size: 0.8em; color: #dc2626;">(Archived)</span>' : ''}</h4>
                    <p>${periodsDisplay}</p>
                </div>
            </div>
            <div class="card__footer">
                <button class="btn btn--primary" onclick="window.viewStudent(${student.id})">View</button>
                <button class="btn btn--secondary" onclick="modals.showEditStudent(${student.id})">Edit</button>
                <button class="btn btn--secondary" onclick="pages.students.toggleArchiveStatus(${student.id}, '${escapeHtml(student.status) || 'active'}')">${escapeHtml(archiveBtnText)}</button>
                <button class="btn btn--danger" onclick="pages.students.deleteStudent(${student.id})">Delete</button>
            </div>
        `;

        // Load class color asynchronously
        if (student.classId && !isArchived) {
            db.classes.get(student.classId).then(cls => {
                const avatar = document.getElementById(`avatar-${student.id}`);
                if (avatar && cls) {
                    avatar.style.backgroundColor = cls.color + '20';
                    avatar.style.color = cls.color;
                }
            });
        }

        return card;
    },

    toggleArchiveStatus: async function(id, currentStatus) {
        try {
            const newStatus = currentStatus === 'active' ? 'archived' : 'active';
            await db.students.update(id, { 
                status: newStatus,
                updatedAt: new Date().toISOString()
            });
            ui.showToast(`Student ${newStatus} successfully!`, 'success');
            this.render(); // Re-render the grid to show changes
        } catch (error) {
            console.error('Error toggling student status:', error);
            ui.showToast('Failed to update student status', 'error');
        }
    },

    importFromCSV: async function(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const text = e.target.result;
                // Standardize line endings just in case it comes from a Mac/Windows mix
                const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');

                if (lines.length < 2) {
                    ui.showToast('CSV is empty or missing data.', 'error');
                    return;
                }

                const allClasses = await db.classes.toArray();
                const allEnrollments = await db.enrollments.toArray();

                let importCount = 0;
                let skipCount = 0;
                let enrollmentCount = 0;
                let classNotFound = [];

                // Starts at index 1 to skip the Header row
                // Proper CSV row parser — handles quoted fields like "Smith, John"
                const parseCSVRow = (line) => {
                    const fields = [];
                    let current = '';
                    let inQuotes = false;
                    for (let c = 0; c < line.length; c++) {
                        const char = line[c];
                        if (char === '"') {
                            inQuotes = !inQuotes;
                        } else if (char === ',' && !inQuotes) {
                            fields.push(current.trim());
                            current = '';
                        } else {
                            current += char;
                        }
                    }
                    fields.push(current.trim());
                    return fields;
                };

                // Sanitize a single CSV field value
                const sanitizeField = (value) => {
                    if (!value) return '';
                    return value
                        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
                        .replace(/[<>]/g, '')
                        .replace(/\0/g, '')
                        .trim()
                        .substring(0, 500); // Hard cap at 500 chars per field
                };

                // Detect format from header row
                const headerRow = parseCSVRow(lines[0]);
                const headerLower = headerRow.map(h => h.toLowerCase().trim());
                const isNewFormat = headerLower.includes('first name') && headerLower.includes('last name');

                for (let i = 1; i < lines.length; i++) {
                    const row = parseCSVRow(lines[i]);

                    let firstName, lastName, fullName, className, period, email, teacher;

                    if (isNewFormat) {
                        // NEW FORMAT: First Name, Last Name, Anonymous ID, Class, Period, Email, Wildcat Teacher
                        firstName = sanitizeField(row[0]);
                        lastName = sanitizeField(row[1]);
                        // row[2] is Anonymous ID — skip on import (auto-generated)
                        className = sanitizeField(row[3]);
                        period = sanitizeField(row[4]);
                        email = sanitizeField(row[5]);
                        teacher = sanitizeField(row[6]);
                        fullName = (firstName + ' ' + lastName).trim();
                    } else {
                        // LEGACY FORMAT: Name, Class, Period, Email, Wildcat Teacher
                        fullName = sanitizeField(row[0]);
                        className = sanitizeField(row[1]);
                        period = sanitizeField(row[2]);
                        email = sanitizeField(row[3]);
                        teacher = sanitizeField(row[4]);
                        // Split the legacy name
                        if (fullName.includes(',')) {
                            const parts = fullName.split(',').map(s => s.trim());
                            lastName = parts[0];
                            firstName = parts.slice(1).join(' ');
                        } else {
                            const parts = fullName.trim().split(/\s+/);
                            if (parts.length === 1) {
                                firstName = parts[0];
                                lastName = '';
                            } else {
                                firstName = parts.slice(0, -1).join(' ');
                                lastName = parts[parts.length - 1];
                            }
                        }
                    }

                    if (!firstName && !lastName) continue;

                    // Look up class by name (case-insensitive)
                    const matchedClass = allClasses.find(c =>
                        c.name.toLowerCase() === className.toLowerCase()
                    );

                    if (!matchedClass && className) {
                        classNotFound.push(`${firstName} ${lastName} (class: "${className}")`);
                        continue;
                    }

                    // 1. Create or Find the Student
                    let studentId;
                    const existingStudent = await db.students
                        .filter(s => {
                            const sFirst = (s.firstName || '').toLowerCase();
                            const sLast = (s.lastName || '').toLowerCase();
                            const sLegacy = (s.name || '').toLowerCase();
                            return (sFirst === firstName.toLowerCase() && sLast === lastName.toLowerCase()) ||
                                  sLegacy === fullName.toLowerCase();
                        })
                        .first();

                    if (!existingStudent) {
                        const anonId = await getNextAnonId();
                        studentId = await db.students.add({
                            firstName: firstName,
                            lastName: lastName,
                            name: firstName + ' ' + lastName,  // Backward compat
                            anonId: anonId,
                            classId: matchedClass ? matchedClass.id : null,
                            email: email,
                            wildcatTeacher: teacher,
                            status: 'active',
                            createdAt: new Date().toISOString()
                        });
                        importCount++;
                    } else {
                        studentId = existingStudent.id;

                        // Update existing student with any non-empty CSV fields
                        const updates = {};
                        if (email) updates.email = email;
                        if (firstName) updates.firstName = firstName;
                        if (lastName) updates.lastName = lastName;
                        if (firstName || lastName) updates.name = (firstName + ' ' + lastName).trim();
                        if (teacher) {
                            const allTeachers = await db.teachers.toArray();
                            const matchedTeacher = allTeachers.find(t =>
                                t.lastName.toLowerCase() === teacher.toLowerCase()
                            );
                            if (matchedTeacher) {
                                updates.wildcatTeacher = matchedTeacher.lastName;
                                updates.wildcatTeacherEmail = matchedTeacher.email;
                            }
                        }
                        if (matchedClass) updates.classId = matchedClass.id;
                        if (Object.keys(updates).length > 0) {
                            updates.updatedAt = new Date().toISOString();
                            await db.students.update(studentId, updates);
                        }

                        skipCount++;
                    }

                    // 2. Create the Enrollment Record
                    if (matchedClass && period) {
                        const csvActiveYear2 = await getActiveSchoolYear();
                        const existingEnrollment = allEnrollments.find(e =>
                            String(e.studentId) === String(studentId) &&
                            String(e.period) === String(period) &&
                            e.schoolYear === csvActiveYear2
                        );

                        if (!existingEnrollment) {
                            const csvActiveYear = await getActiveSchoolYear();
                            await db.enrollments.add({
                                studentId: studentId,
                                classId: matchedClass.id,
                                period: period,
                                schoolYear: csvActiveYear,
                                createdAt: new Date().toISOString()
                            });
                            enrollmentCount++;
                        }
                    }
                }

                event.target.value = ''; // Reset the file input
                this.render(); // Re-render the page

            } catch (error) {
                console.error("CSV Import Error:", error);
                ui.showToast("Failed to process CSV file.", "error");
            }
        };

        reader.readAsText(file);
    },                

    exportToCSV: async function(ferpa) {
        try {
            const students = await db.students.toArray();
            const enrollments = await db.enrollments.toArray();
            const classes = await db.classes.toArray();
            const classMap = {};
            classes.forEach(c => classMap[c.id] = c.name);
            // i167: an enrollment has a period, not a class; the period map says which class a period is
            const periodMapRow = await db.settings.get('period-year-map');
            const periodMap = (periodMapRow && periodMapRow.value) || {};

            let csvContent;
            if (ferpa) {
                csvContent = "Anonymous ID,Class,Period\n";
            } else {
                csvContent = "First Name,Last Name,Anonymous ID,Class,Period,Email,Wildcat Teacher\n";
            }

            students.filter(s => !s.deletedAt && s.status !== 'archived').forEach(student => {
                const studentEnrollments = enrollments.filter(e => e.studentId === student.id);
                const anonId = student.anonId || '';

                if (studentEnrollments.length > 0) {
                    studentEnrollments.forEach(enroll => {
                        const className = classMap[periodMap[enroll.period]] || classMap[student.classId] || '';
                        const period = enroll.period || '';
                        if (ferpa) {
                            csvContent += `${anonId},${className},${period}\n`;
                        } else {
                            const firstName = (student.firstName || '').replace(/"/g, '""');
                            const lastName = (student.lastName || '').replace(/"/g, '""');
                            csvContent += `"${firstName}","${lastName}",${anonId},${className},${period},${student.email || ''},${student.wildcatTeacher || ''}\n`;
                        }
                    });
                } else if (!ferpa) {
                    const legacyClassName = classMap[student.classId] || '';
                    const firstName = (student.firstName || '').replace(/"/g, '""');
                    const lastName = (student.lastName || '').replace(/"/g, '""');
                    csvContent += `"${firstName}","${lastName}",${anonId},${legacyClassName},,${student.email || ''},${student.wildcatTeacher || ''}\n`;
                }
            });

            const suffix = ferpa ? 'FERPA_Safe' : 'Full';
            downloadCSV(csvContent, `Students_Export_${suffix}`);
            ui.showToast(ferpa ? "FERPA-safe student data exported!" : "Student data exported!", "success");
        } catch (error) {
            console.error("Export Error:", error);
            ui.showToast("Failed to export student data.", "error");
        }
    },
    
    deleteStudent: async function(id) {
        try {
            // Capture the student's current state BEFORE soft-deleting
            const student = await db.students.get(id);
            if (!student) return;
            const previousStatus = student.status;

            // Perform the soft-delete immediately (no confirm dialog)
            await db.students.update(id, {
                deletedAt: new Date().toISOString(),
                status: 'deleted'
            });

            driveSync.markDirty(); await logAction('delete', 'student', id, `Deleted student ${displayName(student)}`);

            // Re-render the list so the student disappears immediately
            this.render();

            // Show undo toast
            ui.showUndoToast(`Student "${displayName(student)}" deleted`, async () => {
                await db.students.update(id, {
                    deletedAt: null,
                    status: previousStatus || 'active'
                });
                driveSync.markDirty(); await logAction('undo', 'student', id, `Undid delete of student ${displayName(student)}`);
                this.render();
            });
        } catch (error) {
            console.error('Error deleting student:', error);
            ui.showToast('Failed to delete student', 'error');
        }
    },
};

// ----------------------------------------
// STUDENT DETAIL PAGE
// ----------------------------------------
pages.studentDetail = {
    _data: null,
    _tabsRendered: {},

    setTab: function(tabId, btn) {
        ['overview', 'assignments', 'attendance', 'skills', 'standards', 'notes'].forEach(t => {
            const el = document.getElementById(`sd-tab-${t}`);
            if (el) el.classList.toggle('hidden', t !== tabId);
        });

        if (btn) {
            const tabButtons = btn.parentElement.querySelectorAll('.tab-btn');
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }

        if (this._data && !this._tabsRendered[tabId]) {
            this._tabsRendered[tabId] = true;
            if (tabId === 'assignments') this.renderAssignmentsTab();
            if (tabId === 'attendance') this.renderAttendanceTab();
            if (tabId === 'skills') this.renderSkillsPortfolio(this._data.student.id);
            if (tabId === 'notes') this.renderNotesTab();
            if (tabId === 'standards') this.renderStandardsTab();
        }
    },

    render: async function(studentId) {
        this._tabsRendered = { overview: true };
        this._data = null;

        // Reset to Overview tab visually
        ['overview', 'assignments', 'attendance', 'skills', 'standards', 'notes'].forEach(t => {
            const el = document.getElementById(`sd-tab-${t}`);
            if (el) el.classList.toggle('hidden', t !== 'overview');
        });
        document.querySelectorAll('#page-student-detail .tab-btn').forEach((b, i) => {
            b.classList.toggle('active', i === 0);
        });

        const student = await db.students.get(studentId);
        if (!student) { ui.showToast('Student not found.', 'error'); return; }

        let [
            allEnrollments, allClasses, allAttendance,
            allActivities, allSubmissions, allCheckpoints,
            allCompletions, allSkillLevels, allCertifications,
            allInventory, allSkills, allStandards,
            allActivityStandards, allActivitySkills, allTeamMembers,
            allTeams, niData, allNotes, allSkillObservations
        ] = await Promise.all([
            db.enrollments.toArray(),
            db.classes.toArray(),
            db.attendance.toArray(),
            db.activities.toArray(),
            db.submissions.toArray(),
            db.checkpoints.toArray(),
            db.checkpointCompletions.toArray(),
            db.skillLevels.toArray(),
            db.certifications.toArray(),
            db.inventory.toArray(),
            db.skills.toArray(),
            db.standards.toArray(),
            db.activityStandards.toArray(),
            db.activitySkills.toArray(),
            db.teamMembers.toArray(),
            db.teams.toArray(),
            getActiveNonInstructionalDays(),
            db.notes.toArray(),
            db.skillObservations.toArray()
        ]);

        const activeYear = await getActiveSchoolYear();
        let periodYearMap = {};
            try {
                const periodYearMapSetting = await db.settings.get('period-year-map');
                if (periodYearMapSetting && periodYearMapSetting.value) {
                    periodYearMap = periodYearMapSetting.value;
                }
            } catch(e) {
                console.warn('Could not load period-year-map', e);
            }
        const niDays = niData || [];
        const isNonInstructionalDay = (dateStr) => niDays.some(ni => {
            if (ni.end) return dateStr >= ni.date && dateStr <= ni.end;
            return ni.date === dateStr;
        });

        const studentAttendance = allAttendance.filter(r =>
            String(r.studentId) === String(student.id) &&
            !isNonInstructionalDay(r.date)
        );
        const total = studentAttendance.length;
        const absent = studentAttendance.filter(r => (r.status||'').toLowerCase() === 'absent').length;
        const late = studentAttendance.filter(r => (r.status||'').toLowerCase() === 'late').length;
        const present = total - absent - late;
        const pct = total > 0 ? Math.round((present/total)*100) : 0;

        const enrollments = allEnrollments.filter(e =>
            e.studentId === student.id &&
            (e.schoolYear === activeYear || !e.schoolYear)
        );
        const classMap = new Map(allClasses.map(c => [c.id, c]));

        const teamMembership = allTeamMembers.find(tm => tm.studentId === student.id);
        const team = teamMembership ? allTeams.find(t => t.id === teamMembership.teamId) : null;

        // Retired and merged-away skills, their links, ratings and marked levels are hidden (P16 C3)
        const hiddenSkillIds = new Set(allSkills.filter(isSkillHidden).map(s => s.id));
        allSkills = allSkills.filter(s => !isSkillHidden(s));
        allSkillLevels = allSkillLevels.filter(l => isLevelLive(l) && !hiddenSkillIds.has(l.skillId));
        allActivitySkills = allActivitySkills.filter(l => !l.deletedAt && !hiddenSkillIds.has(l.skillId));
        allSkillObservations = allSkillObservations.filter(o => !hiddenSkillIds.has(o.skillId));

        this._data = {
            student, enrollments, classMap, allAttendance,
            allActivities, allSubmissions, allCheckpoints,
            allCompletions, allSkillLevels, allCertifications,
            allInventory, allSkills, allStandards,
            allActivityStandards, allActivitySkills,
            allTeamMembers, allTeams, team, allNotes,
            allSkillObservations,
            activeYear, isNonInstructionalDay, periodYearMap,
            attendanceStats: { total, absent, late, present, pct }
        };

        // Render student header
        const headerEl = document.getElementById('student-detail-header');
        if (headerEl) {
            const cls = student.classId ? classMap.get(student.classId) : null;
            const statusColors = { active: 'var(--color-success)', inactive: 'var(--color-text-tertiary)', archived: 'var(--color-warning)' };
            headerEl.innerHTML = `
                <div class="card__body" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-sm);">
                    <div>
                        <h3 style="margin: 0 0 var(--space-xs) 0; font-size: var(--font-size-heading);">
                            ${escapeHtml(student.firstName || '')} ${escapeHtml(student.lastName || '')}
                        </h3>
                        <div style="display: flex; gap: var(--space-sm); flex-wrap: wrap; align-items: center;">
                            <span style="background: ${statusColors[student.status] || 'var(--color-text-tertiary)'}22; color: ${statusColors[student.status] || 'var(--color-text-tertiary)'}; padding: 2px 8px; border-radius: 12px; font-size: var(--font-size-body-small); font-weight: 600;">
                                ${student.status || 'active'}
                            </span>
                            ${cls ? `<span style="background: var(--color-surface-raised); padding: 2px 8px; border-radius: 12px; font-size: var(--font-size-body-small);">${escapeHtml(cls.name)}</span>` : ''}
                            ${student.anonId ? `<span style="color: var(--color-text-tertiary); font-size: var(--font-size-body-small);">ID: ${escapeHtml(student.anonId)}</span>` : ''}
                        </div>
                    </div>
                    <button class="btn btn--secondary" onclick="modals.showEditStudent(${student.id})">Edit</button>
                </div>
            `;
        }

        // Render Overview tab immediately
        await this.renderOverviewTab();
    },

    renderOverviewTab: async function() {
        const { student, enrollments, classMap, attendanceStats, team } = this._data;
        const { total, absent, late, present, pct } = attendanceStats;
        const container = document.getElementById('student-detail-content');
        if (!container) return;

        const allEnrollments = this._data.allEnrollments || enrollments;
        const pastEnrollments = (this._data.allEnrollments || []).filter(e =>
            e.studentId === student.id &&
            e.schoolYear && e.schoolYear !== this._data.activeYear
        );

        let html = `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--space-lg);">
                <div>
                    <h4 style="margin-bottom: var(--space-sm);">Attendance Summary</h4>
                    <div class="card" style="padding: var(--space-base);">
                        <div style="display: grid; grid-template-columns: repeat(4, 1fr); text-align: center; gap: var(--space-sm);">
                            <div><div style="font-size: 1.5em; font-weight: 700; color: var(--color-success);">${present}</div><div style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">Present</div></div>
                            <div><div style="font-size: 1.5em; font-weight: 700; color: var(--color-danger);">${absent}</div><div style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">Absent</div></div>
                            <div><div style="font-size: 1.5em; font-weight: 700; color: var(--color-warning);">${late}</div><div style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">Late</div></div>
                            <div><div style="font-size: 1.5em; font-weight: 700;">${pct}%</div><div style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">Rate</div></div>
                        </div>
                    </div>

                    <h4 style="margin: var(--space-lg) 0 var(--space-sm) 0;">Current Enrollments</h4>
                    ${enrollments.length > 0 ? (() => {
                        const periodMap = this._data.periodYearMap || {};
                        return enrollments.map(e => {
                            const classIdFromPeriod = periodMap[String(e.period)];
                            const cls = classMap.get(Number(classIdFromPeriod)) || classMap.get(classIdFromPeriod) || classMap.get(e.classId) || classMap.get(student.classId);
                            return `<div class="card" style="padding: var(--space-sm) var(--space-base); margin-bottom: var(--space-sm);">
                                ${cls ? escapeHtml(cls.name) : 'Unknown Class'} — Period ${e.period || '?'}
                            </div>`;
                        }).join('');
                    })() : '<p style="color: var(--color-text-tertiary);">No current enrollments.</p>'}

                    ${team ? `
                    <h4 style="margin: var(--space-lg) 0 var(--space-sm) 0;">Team</h4>
                    <div class="card" style="padding: var(--space-sm) var(--space-base);">${escapeHtml(team.name)}</div>
                    ` : ''}
                    <div id="student-team-history-container"></div>
                </div>

                <div>
                    ${pastEnrollments.length > 0 ? `
                    <details>
                        <summary style="cursor: pointer; font-weight: 600; margin-bottom: var(--space-sm);">Past Enrollments (${pastEnrollments.length})</summary>
                        ${pastEnrollments.map(e => {
                            const cls = classMap.get(e.classId);
                            return `<div class="card" style="padding: var(--space-sm) var(--space-base); margin-bottom: var(--space-sm);">
                                ${cls ? escapeHtml(cls.name) : 'Unknown'} — Period ${e.period || '?'} (${e.schoolYear || 'Unknown Year'})
                            </div>`;
                        }).join('')}
                    </details>
                    ` : ''}
                </div>
            </div>
        `;

        container.innerHTML = html;

        // Sprint 13.1: Load student team history
        try {
            const teamHistoryRecords = await db.teamHistory.where('studentId').equals(student.id).toArray();
            if (teamHistoryRecords.length > 0) {
                teamHistoryRecords.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
                const allTeamsForHistory = await db.teams.toArray();
                const teamMapForHistory = new Map(allTeamsForHistory.map(t => [t.id, t]));
                const historyHtml = teamHistoryRecords.map(record => {
                    const histTeam = teamMapForHistory.get(record.teamId);
                    const teamName = histTeam ? escapeHtml(histTeam.name) : 'Unknown Group';
                    const verb = record.action === 'joined' ? 'Joined' : 'Left';
                    const dateStr = record.timestamp ? new Date(record.timestamp).toLocaleDateString() : '';
                    return `<div style="padding: 2px 0; font-size: var(--font-size-body-small);">${verb} <strong>${teamName}</strong> — ${dateStr}</div>`;
                }).join('');

                const histContainer = document.getElementById('student-team-history-container');
                if (histContainer) {
                    histContainer.innerHTML = `
                        <h4 style="margin: var(--space-lg) 0 var(--space-sm) 0;">Team History</h4>
                        <div class="card" style="padding: var(--space-sm) var(--space-base);">${historyHtml}</div>
                    `;
                }
            }
        } catch (err) {
            console.error('Error loading student team history:', err);
        }
    },

    renderAttendanceTab: function() {
        const { student, allAttendance, isNonInstructionalDay } = this._data;
        const container = document.getElementById('student-attendance-content');
        if (!container) return;

        const records = allAttendance
            .filter(r => String(r.studentId) === String(student.id) && !isNonInstructionalDay(r.date))
            .sort((a, b) => b.date.localeCompare(a.date));

        if (records.length === 0) {
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">No attendance records found.</p>';
            return;
        }

        const statusColors = { present: 'var(--color-success)', absent: 'var(--color-danger)', late: 'var(--color-warning)' };

        let html = '<div style="overflow-x: auto;"><table style="width: 100%; border-collapse: collapse;">';
        html += '<thead><tr style="border-bottom: 2px solid var(--color-border);">';
        html += '<th style="text-align: left; padding: var(--space-sm);">Date</th>';
        html += '<th style="text-align: left; padding: var(--space-sm);">Period</th>';
        html += '<th style="text-align: left; padding: var(--space-sm);">Status</th>';
        html += '<th style="text-align: left; padding: var(--space-sm);">Notes</th>';
        html += '</tr></thead><tbody>';

        records.forEach(r => {
            const color = statusColors[(r.status||'').toLowerCase()] || 'var(--color-text-tertiary)';
            html += `<tr style="border-bottom: 1px solid var(--color-border);">
                <td style="padding: var(--space-sm);">${r.date}</td>
                <td style="padding: var(--space-sm);">${r.period || '—'}</td>
                <td style="padding: var(--space-sm); color: ${color}; font-weight: 600; text-transform: capitalize;">${r.status || '—'}</td>
                <td style="padding: var(--space-sm); color: var(--color-text-secondary);">${escapeHtml(r.notes || '')}</td>
            </tr>`;
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;
    },

    renderNotesTab: function() {
        const { student } = this._data;
        const saveBtn = document.getElementById('save-note-btn-student');
        if (saveBtn) {
            saveBtn.onclick = () => this.saveNote(student.id);
        }
        this.loadNotes(student.id);
    },

    saveNote: async function(studentId) {
        const input = document.getElementById('note-input-student');
        const text = input ? input.value.trim() : '';
        if (!text) return;
        await db.notes.add({
            entityType: 'student',
            entityId: studentId,
            content: text,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        driveSync.markDirty();
        if (input) input.value = '';
        this.loadNotes(studentId);
        ui.showToast('Note saved.', 'success');
    },

    loadNotes: async function(studentId) {
        const container = document.getElementById('notes-list-student');
        if (!container) return;
        const notes = await db.notes
            .where('entityType').equals('student')
            .filter(n => n.entityId === studentId)
            .toArray();
        notes.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        if (notes.length === 0) {
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">No notes yet.</p>';
            return;
        }
        container.innerHTML = notes.map(n => `
            <div class="card" style="padding: var(--space-sm) var(--space-base); margin-bottom: var(--space-sm);">
                <div style="font-size: var(--font-size-body-small); color: var(--color-text-tertiary); margin-bottom: 4px;">${new Date(n.createdAt).toLocaleDateString()}</div>
                <div>${escapeHtml(n.content)}</div>
            </div>
        `).join('');
    },

    renderAssignmentsTab: async function() {
        const { student, allActivities, allSubmissions, allCheckpoints, allCompletions, allSkills, allActivitySkills } = this._data;
        const container = document.getElementById('student-assignments-content');
        if (!container) return;

        container.innerHTML = '<p style="color: var(--color-text-tertiary);">Loading assignments...</p>';

        const studentClassId = student.classId;
        const activities = excludeDeleted(allActivities)
            .filter(a => a.classId === studentClassId)
            .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

        if (activities.length === 0) {
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">No assignments found for this student\'s class.</p>';
            return;
        }

        const studentSubs = allSubmissions.filter(s => s.studentId === student.id);
        const subMap = new Map(studentSubs.map(s => [s.activityId, s]));

        const today = getTodayString();
        let totalCount = 0, submittedCount = 0, missingCount = 0, gradedCount = 0;

        const rows = activities.map(activity => {
            const sub = subMap.get(activity.id);
            const status = sub ? sub.status : 'not-started';
            const actCheckpoints = allCheckpoints.filter(cp => cp.activityId === activity.id);
            const cpDone = actCheckpoints.length > 0 ? allCompletions.filter(c =>
                String(c.studentId) === String(student.id) &&
                c.completed &&
                actCheckpoints.some(cp => cp.id === c.checkpointId)
            ).length : 0;

            const maxPoints = activity.defaultPoints || 100;
            let scoreDisplay = '—';
            if (sub) {
                const scoringType = activity.scoringType || 'complete-incomplete';
                if ((activity.checkpointGradeWeight || 0) > 0 && actCheckpoints.length > 0) {
                    const result = calculateFinalGrade(activity, student.id, sub, actCheckpoints, allCompletions);
                    scoreDisplay = `${Math.round(result.finalScore * maxPoints * 10) / 10} / ${maxPoints}`;
                } else if (scoringType === 'points' && sub.score != null) {
                    scoreDisplay = `${sub.score} / ${maxPoints}`;
                } else if (scoringType === 'complete-incomplete') {
                    scoreDisplay = (status === 'graded' || status === 'submitted') ? `${maxPoints} / ${maxPoints}` : `0 / ${maxPoints}`;
                } else if (scoringType === 'rubric') {
                    scoreDisplay = status === 'graded' ? 'Graded' : '—';
                }
            }

            const isPastDue = activity.dueDate && activity.dueDate < today;
            const isMissing = isPastDue && (!sub || sub.status === 'not-started');
            if (isMissing) missingCount++;
            if (status === 'graded') gradedCount++;
            if (status === 'submitted' || status === 'graded') submittedCount++;
            totalCount++;

            const feedbackLogs = this._data.allNotes ? this._data.allNotes.filter(n =>
                n.entityType === 'feedback-log' &&
                n.entityId === student.id &&
                (n.content || '').includes(activity.name)
            ) : [];
            const feedbackStatus = feedbackLogs.length > 0 ? 'Sent' : (sub?.feedback ? 'Draft' : '—');

            const statusColors = { graded: 'var(--color-success)', submitted: '#3b82f6', 'in-progress': 'var(--color-warning)', 'not-started': 'var(--color-text-tertiary)' };
            const statusColor = isMissing ? 'var(--color-danger)' : (statusColors[status] || 'var(--color-text-tertiary)');
            const statusLabel = isMissing ? 'Missing' : status;

            return { activity, sub, status, statusColor, statusLabel, scoreDisplay, actCheckpoints, cpDone, feedbackStatus };
        });

        // Summary cards
        let html = `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--space-sm); margin-bottom: var(--space-lg);">
                <div class="card" style="padding: var(--space-sm); text-align: center;">
                    <div style="font-size: 1.4em; font-weight: 700;">${totalCount}</div>
                    <div style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">Total</div>
                </div>
                <div class="card" style="padding: var(--space-sm); text-align: center;">
                    <div style="font-size: 1.4em; font-weight: 700; color: var(--color-success);">${gradedCount}</div>
                    <div style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">Graded</div>
                </div>
                <div class="card" style="padding: var(--space-sm); text-align: center;">
                    <div style="font-size: 1.4em; font-weight: 700; color: var(--color-danger);">${missingCount}</div>
                    <div style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">Missing</div>
                </div>
            </div>
            <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse;">
                <thead><tr style="border-bottom: 2px solid var(--color-border);">
                    <th style="text-align: left; padding: var(--space-sm);">Assignment</th>
                    <th style="text-align: left; padding: var(--space-sm);">Status</th>
                    <th style="text-align: left; padding: var(--space-sm);">Score</th>
                    <th style="text-align: left; padding: var(--space-sm);">Checkpoints</th>
                    <th style="text-align: left; padding: var(--space-sm);">Feedback</th>
                </tr></thead>
                <tbody>
        `;

        rows.forEach(({ activity, sub, status, statusColor, statusLabel, scoreDisplay, actCheckpoints, cpDone, feedbackStatus }) => {
            const cpDisplay = actCheckpoints.length > 0
                ? `<div style="display: flex; align-items: center; gap: var(--space-xs);">
                    <div style="flex: 1; background: var(--color-border); border-radius: 4px; height: 6px; min-width: 60px;">
                        <div style="width: ${Math.round((cpDone/actCheckpoints.length)*100)}%; background: var(--color-success); height: 6px; border-radius: 4px;"></div>
                    </div>
                    <span style="font-size: var(--font-size-body-small); white-space: nowrap;">${cpDone}/${actCheckpoints.length}</span>
                  </div>`
                : '—';

            html += `<tr style="border-bottom: 1px solid var(--color-border); cursor: pointer;" onclick="state.selectedActivity = ${activity.id}; router.navigate('activity-detail');">
                <td style="padding: var(--space-sm); font-weight: 500;">${escapeHtml(activity.name || '')}</td>
                <td style="padding: var(--space-sm); color: ${statusColor}; font-weight: 600; text-transform: capitalize;">${statusLabel}${status === 'graded' && sub?.gradedAt ? `<div style="font-size: var(--font-size-body-small); color: var(--color-text-tertiary); font-weight: 400; text-transform: none;">Graded: ${new Date(sub.gradedAt).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'})}</div>` : ''}</td>
                <td style="padding: var(--space-sm);">${scoreDisplay}</td>
                <td style="padding: var(--space-sm); min-width: 120px;">${cpDisplay}</td>
                <td style="padding: var(--space-sm); color: var(--color-text-secondary);">${feedbackStatus}</td>
            </tr>`;
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;
    },

    renderStandardsTab: async function() {
        const container = document.getElementById('student-standards-content');
        if (!container || !this._data) return;

        const { student, allStandards, allActivityStandards, allActivities, allSubmissions } = this._data;
        container.innerHTML = '<p style="color: var(--color-text-tertiary);">Loading standards...</p>';

        if (allStandards.length === 0) {
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">No standards defined in the system.</p>';
            return;
        }

        const classActivities = excludeDeleted(allActivities).filter(a => a.classId === student.classId);
        const classActivityIds = new Set(classActivities.map(a => a.id));
        const relevantLinks = allActivityStandards.filter(as => classActivityIds.has(as.activityId));

        const standardData = [];
        for (const standard of allStandards) {
            const linkedActivityIds = relevantLinks
                .filter(as => as.standardId === standard.id)
                .map(as => as.activityId);

            if (linkedActivityIds.length === 0) continue;

            const activities = classActivities.filter(a => linkedActivityIds.includes(a.id));
            const studentSubs = allSubmissions.filter(s => s.studentId === student.id && linkedActivityIds.includes(s.activityId));

            let totalScore = 0, totalPossible = 0, gradedCount = 0;
            let lastDate = null;

            for (const activity of activities) {
                const sub = studentSubs.find(s => s.activityId === activity.id);
                if (!sub || sub.status !== 'graded') continue;

                const maxPoints = activity.defaultPoints || 100;
                let score = 0;

                if (activity.scoringType === 'points' && sub.score != null) {
                    score = sub.score;
                } else if (activity.scoringType === 'complete-incomplete') {
                    score = maxPoints;
                } else if (activity.scoringType === 'rubric' && sub.rubricScores) {
                    if (typeof calculateFinalGrade === 'function') {
                        const allCheckpoints = this._data.allCheckpoints || [];
                        const allCompletions = this._data.allCompletions || [];
                        const result = calculateFinalGrade(activity, student.id, sub, allCheckpoints.filter(cp => cp.activityId === activity.id), allCompletions);
                        score = result.finalScore * maxPoints;
                    }
                }

                totalScore += score;
                totalPossible += maxPoints;
                gradedCount++;

                const actDate = sub.gradedAt || sub.updatedAt || activity.endDate;
                if (!lastDate || actDate > lastDate) lastDate = actDate;
            }

            const avgPercent = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : null;

            standardData.push({
                standard,
                linkedCount: activities.length,
                gradedCount,
                avgPercent,
                lastDate
            });
        }

        if (standardData.length === 0) {
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">No standards linked to assignments for this student\'s class.</p>';
            return;
        }

        standardData.sort((a, b) => (a.standard.code || a.standard.name || '').localeCompare(b.standard.code || b.standard.name || ''));

        let html = `
            <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse;">
                <thead><tr style="border-bottom: 2px solid var(--color-border);">
                    <th style="text-align: left; padding: var(--space-sm); cursor: pointer;" onclick="pages.studentDetail.sortStandards('code')">Standard</th>
                    <th style="text-align: left; padding: var(--space-sm);">Assignments</th>
                    <th style="text-align: left; padding: var(--space-sm); cursor: pointer;" onclick="pages.studentDetail.sortStandards('avg')">Average</th>
                    <th style="text-align: left; padding: var(--space-sm);">Last Activity</th>
                </tr></thead>
                <tbody>
        `;

        standardData.forEach(sd => {
            const avgDisplay = sd.avgPercent != null ? `${sd.avgPercent}%` : '—';
            const avgColor = sd.avgPercent == null ? 'var(--color-text-tertiary)'
                : sd.avgPercent >= 80 ? 'var(--color-success)'
                : sd.avgPercent >= 60 ? 'var(--color-warning)'
                : 'var(--color-error)';
            const dateDisplay = sd.lastDate ? new Date(sd.lastDate).toLocaleDateString('en-US', {month: 'short', day: 'numeric'}) : '—';

            html += `<tr style="border-bottom: 1px solid var(--color-border);">
                <td style="padding: var(--space-sm);">
                    <strong>${escapeHtml(sd.standard.code || '')}</strong>
                    <div style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">${escapeHtml(sd.standard.name || '')}</div>
                </td>
                <td style="padding: var(--space-sm);">${sd.gradedCount} / ${sd.linkedCount}</td>
                <td style="padding: var(--space-sm); color: ${avgColor}; font-weight: 600;">${avgDisplay}</td>
                <td style="padding: var(--space-sm); color: var(--color-text-tertiary);">${dateDisplay}</td>
            </tr>`;
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;

        this._standardsData = standardData;
    },

    sortStandards: function(field) {
        if (!this._standardsData) return;
        if (field === 'avg') {
            this._standardsData.sort((a, b) => (b.avgPercent || 0) - (a.avgPercent || 0));
        } else {
            this._standardsData.sort((a, b) => (a.standard.code || a.standard.name || '').localeCompare(b.standard.code || b.standard.name || ''));
        }
        this._tabsRendered['standards'] = false;
        this._tabsRendered['standards'] = true;
        this.renderStandardsTab();
    },
    
    renderSkillsPortfolio: async function(studentId) {
        const container = document.getElementById('student-skills-portfolio');
        if (!container) return;
        const { allSkills, allSkillLevels, allCertifications, allInventory,
                allActivities, allSubmissions, allCheckpoints,
                allSkillObservations } = this._data;

        // --- Helpers ---
        const levelValues = { 'Beginning': 1, 'Developing': 2, 'Proficient': 3, 'Advanced': 4 };
        const levelPct = { 'Beginning': 25, 'Developing': 50, 'Proficient': 75, 'Advanced': 100 };
        const levelColors = {
            'Beginning': 'var(--color-error)',
            'Developing': 'var(--color-info)',
            'Proficient': 'var(--color-success)',
            'Advanced': '#f59e0b'
        };

        function getTrajectory(observations) {
            if (!observations || observations.length < 2) return null;
            const sorted = [...observations].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
            const latest = levelValues[sorted[0].rating] || 0;
            const prior = levelValues[sorted[1].rating] || 0;
            if (latest > prior) return 'improving';
            if (latest < prior) return 'declining';
            return 'stable';
        }

        function trajectoryIcon(t) {
            if (t === 'improving') return '<span class="sp-trajectory sp-trajectory--up">↑</span>';
            if (t === 'declining') return '<span class="sp-trajectory sp-trajectory--down">↓</span>';
            if (t === 'stable') return '<span class="sp-trajectory sp-trajectory--stable">→</span>';
            return '<span class="sp-trajectory sp-trajectory--none">—</span>';
        }

        function ratingBadge(level) {
            if (!level) return '';
            const color = levelColors[level] || 'var(--color-text-tertiary)';
            return `<span class="sp-rating-badge" style="background: ${color}22; color: ${color};">${escapeHtml(level)}</span>`;
        }

        function formatDate(dateStr) {
            if (!dateStr) return '—';
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }

        // --- Data lookups ---
        const studentLevels = allSkillLevels.filter(sl => sl.studentId === studentId);
        const levelMap = new Map(studentLevels.map(sl => [sl.skillId, sl]));
        const studentObs = allSkillObservations.filter(o => o.studentId === studentId);
        const obsBySkill = new Map();
        studentObs.forEach(o => {
            if (!obsBySkill.has(o.skillId)) obsBySkill.set(o.skillId, []);
            obsBySkill.get(o.skillId).push(o);
        });
        const activityMap = new Map(allActivities.map(a => [a.id, a]));
        const checkpointMap = new Map(allCheckpoints.map(cp => [cp.id, cp]));

        // --- Assessed vs unassessed skills ---
        const assessedSkills = allSkills.filter(s => levelMap.has(s.id));
        const unassessedSkills = allSkills.filter(s => !levelMap.has(s.id));

        // --- Summary bar ---
        let html = '';
        const counts = { 'Beginning': 0, 'Developing': 0, 'Proficient': 0, 'Advanced': 0 };
        let masterySum = 0;
        assessedSkills.forEach(s => {
            const lvl = levelMap.get(s.id);
            if (lvl && counts.hasOwnProperty(lvl.level)) {
                counts[lvl.level]++;
                masterySum += (levelPct[lvl.level] || 0);
            }
        });
        const masteryPct = assessedSkills.length > 0 ? Math.round(masterySum / assessedSkills.length) : 0;

        // Professional Practice average
        const studentSubs = allSubmissions.filter(sub => sub.studentId === studentId && sub.professionalPractice);
        let ppHtml = '';
        if (studentSubs.length > 0) {
            let ppSum = 0;
            studentSubs.forEach(sub => {
                ppSum += (levelPct[sub.professionalPractice] || 0);
            });
            const ppPct = Math.round(ppSum / studentSubs.length);
            ppHtml = `<div class="sp-summary-item">Professional Practice: <strong>${ppPct}%</strong></div>`;
        }

        if (assessedSkills.length > 0 || studentSubs.length > 0) {
            html += `<div class="sp-summary-bar">
                <div class="sp-summary-mastery">
                    <span class="sp-summary-pct">${masteryPct}%</span>
                    <span class="sp-summary-label">Skill Mastery</span>
                </div>
                <div class="sp-summary-counts">
                    ${counts['Advanced'] ? `<span class="sp-count-chip" style="background: ${levelColors['Advanced']}22; color: ${levelColors['Advanced']};">${counts['Advanced']} Advanced</span>` : ''}
                    ${counts['Proficient'] ? `<span class="sp-count-chip" style="background: ${levelColors['Proficient']}22; color: ${levelColors['Proficient']};">${counts['Proficient']} Proficient</span>` : ''}
                    ${counts['Developing'] ? `<span class="sp-count-chip" style="background: ${levelColors['Developing']}22; color: ${levelColors['Developing']};">${counts['Developing']} Developing</span>` : ''}
                    ${counts['Beginning'] ? `<span class="sp-count-chip" style="background: ${levelColors['Beginning']}22; color: ${levelColors['Beginning']};">${counts['Beginning']} Beginning</span>` : ''}
                </div>
                ${ppHtml}
            </div>`;
        }

        // --- Skills grouped by category ---
        if (assessedSkills.length > 0) {
            const categories = new Map();
            assessedSkills.forEach(skill => {
                const cat = skill.category || 'Uncategorized';
                if (!categories.has(cat)) categories.set(cat, []);
                categories.get(cat).push(skill);
            });

            categories.forEach((skills, catName) => {
                html += `<div class="sp-category-group">
                    <h4 class="sp-category-header">${escapeHtml(catName)}</h4>`;

                skills.forEach(skill => {
                    const lvl = levelMap.get(skill.id);
                    const obs = obsBySkill.get(skill.id) || [];
                    const trajectory = getTrajectory(obs);
                    const sortedObs = [...obs].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
                    const lastObs = sortedObs[0];
                    const lastActivity = lastObs ? activityMap.get(lastObs.activityId) : null;
                    const skillRowId = `sp-obs-${skill.id}`;

                    html += `<div class="sp-skill-row">
                        <div class="sp-skill-main" onclick="document.getElementById('${skillRowId}').classList.toggle('hidden')">
                            <span class="sp-skill-name">${escapeHtml(skill.name || '')}</span>
                            ${ratingBadge(lvl ? lvl.level : null)}
                            ${trajectoryIcon(trajectory)}
                            ${lastObs ? `<span class="sp-last-observed">${formatDate(lastObs.createdAt)}${lastActivity ? ' · ' + escapeHtml(lastActivity.title || '') : ''}</span>` : ''}
                            <span class="sp-expand-toggle">${obs.length > 0 ? '▶ History (' + obs.length + ')' : ''}</span>
                        </div>`;

                    // Expandable observation history
                    if (obs.length > 0) {
                        html += `<div id="${skillRowId}" class="sp-obs-history hidden">`;

                        // Progression dots
                        html += '<div class="sp-progression-dots">';
                        [...obs].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')).forEach(o => {
                            const color = levelColors[o.rating] || 'var(--color-text-tertiary)';
                            html += `<span class="sp-dot" style="background: ${color};" title="${escapeHtml(o.rating || '')}"></span>`;
                        });
                        html += '</div>';

                        sortedObs.forEach(o => {
                            const act = activityMap.get(o.activityId);
                            const cp = o.checkpointId ? checkpointMap.get(o.checkpointId) : null;
                            html += `<div class="sp-obs-entry">
                                <span class="sp-obs-date">${formatDate(o.createdAt)}</span>
                                <span class="sp-obs-activity">${escapeHtml(act ? (act.title || '') : '—')}</span>
                                ${cp ? `<span class="sp-obs-checkpoint">CP: ${escapeHtml(cp.title || '')}</span>` : ''}
                                ${ratingBadge(o.rating)}
                                ${o.evidenceType ? `<span class="sp-obs-evidence">${escapeHtml(o.evidenceType === 'migrated' ? 'Migrated' : o.evidenceType)}</span>` : ''}
                                ${o.note ? `<span class="sp-obs-note">${escapeHtml(o.note)}</span>` : ''}
                            </div>`;
                        });
                        html += '</div>';
                    }
                    html += '</div>';
                });
                html += '</div>';
            });
        }

        // --- Not Yet Assessed ---
        if (unassessedSkills.length > 0) {
            html += `<div class="sp-not-assessed">
                <h4 class="sp-category-header">Not Yet Assessed (${unassessedSkills.length})</h4>
                <div class="sp-unassessed-list">`;
            unassessedSkills.forEach(skill => {
                html += `<span class="sp-unassessed-chip">${escapeHtml(skill.name || '')}</span>`;
            });
            html += '</div></div>';
        }

        // --- Certifications (preserved from existing code) ---
        const studentCerts = allCertifications.filter(c => c.studentId === studentId);
        if (studentCerts.length > 0) {
            const inventoryMap = new Map(allInventory.map(i => [i.id, i]));
            html += '<div class="sp-certs-section">';
            html += '<h4 class="sp-category-header">Certifications</h4>';
            html += '<div style="display: flex; flex-wrap: wrap; gap: var(--space-sm);">';
            studentCerts.forEach(cert => {
                const item = inventoryMap.get(cert.toolId);
                html += `<div style="padding: var(--space-xs) var(--space-sm); border-radius: 12px; background: var(--color-success)22; color: var(--color-success); font-size: var(--font-size-body-small); font-weight: 600;">
                    ✓ ${escapeHtml(item ? item.name : 'Unknown Tool')}
                </div>`;
            });
            html += '</div></div>';
        }

        // --- Empty state ---
        if (!html) {
            html = '<p style="color: var(--color-text-tertiary); font-style: italic;">No skills or certifications recorded yet.</p>';
        }

        container.innerHTML = html;
    },
};
