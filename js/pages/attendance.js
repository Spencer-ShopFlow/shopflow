// ----------------------------------------
// ATTENDANCE PAGE
// ----------------------------------------
pages.attendance = {
    pendingChanges: {},

    // Helper to keep date fetching DRY
    getToday: function() { 
        return getTodayString();
    },

    // Helper to securely handle the Webhook URL without GitHub seeing it
    getGoogleScriptUrl: function() {
        // Check automations are enabled before returning the URL
        const automationsEnabled = localStorage.getItem('automations-enabled') === 'true';
        if (!automationsEnabled) return null;

        let url = localStorage.getItem('webhook_wildcat');
        if (!url) {
            ui.showToast('Missing Webhook URL — add it in Settings → Email Automations.', 'error');
            return null; 
        }
        return url;
    },

    init: async function() {
        this.pendingChanges = {}; 
        
        const dateElement = document.getElementById('attendance-date');
        const periodSelect = document.getElementById('attendance-period');
        
        dateElement.value = this.getToday();
        
        await pages.dashboard.updateCurrentPeriod();
        if (state.currentPeriod && state.currentPeriod !== 'wildcat') {
            periodSelect.value = state.currentPeriod;
        }

        // Sprint 13.2: Fall back to default period if no auto-detection result
        if (!periodSelect.value || periodSelect.value === '') {
            const defaultPeriodSetting = await db.settings.get('default-period');
            if (defaultPeriodSetting && defaultPeriodSetting.value) {
                periodSelect.value = defaultPeriodSetting.value;
            }
        }

        await this.render();
    },

    render: async function() {
        const periodSelect = document.getElementById('attendance-period');
        const studentList = document.getElementById('attendance-student-list');
        const dateElement = document.getElementById('attendance-date');
        
        // Initialize Selectors & Attach Listeners cleanly
        if (!periodSelect.dataset.initialized && state.currentPeriod && state.currentPeriod !== 'wildcat') {
            periodSelect.value = state.currentPeriod;
            periodSelect.dataset.initialized = "true";
        }
        
        if (!periodSelect.dataset.listenerAttached) {
            periodSelect.addEventListener('change', () => { this.pendingChanges = {}; this.render(); });
            periodSelect.dataset.listenerAttached = "true";
        }

        if (!dateElement.dataset.listenerAttached) {
            dateElement.addEventListener('change', () => { this.pendingChanges = {}; this.render(); });
            dateElement.dataset.listenerAttached = "true";
        }
        
        // State & Validation setup
        const selectedPeriod = periodSelect.value;
        if (!dateElement.value) dateElement.value = this.getToday();
        const selectedDate = dateElement.value; 
      
        if (!selectedPeriod) {
            studentList.innerHTML = '<p style="text-align: center; color: var(--color-text-tertiary); padding: var(--space-2xl);">Please select a period to take attendance.</p>';
            return;
        }
      
        try {
            // Fetch Database Records
            const allStudents = excludeDeleted(await db.students.toArray());
            if (allStudents.length === 0) {
                studentList.innerHTML = '<p style="text-align: center; color: var(--color-text-secondary); padding: var(--space-2xl);">No students added yet. <a href="#" onclick="router.navigate(\'students\'); return false;" style="color: var(--color-primary); text-decoration: underline;">Go to Students</a> to add students, or import a CSV from <a href="#" onclick="router.navigate(\'settings\'); setTimeout(() => { const tab = document.querySelector(\'[data-tab=\\\'data\\\']\'); if (tab) tab.click(); }, 100); return false;" style="color: var(--color-primary); text-decoration: underline;">Settings → Data</a>.</p>';
                return;
            }
            
            const activeYear = await getActiveSchoolYear();
            const enrollments = (await db.enrollments
                .filter(e => String(e.period) === String(selectedPeriod) && (e.schoolYear === activeYear || !e.schoolYear))
                .toArray());
            const enrolledIdSet = new Set();
            let enrolledStudentIds = [];
            enrollments.forEach(e => {
                const sid = String(e.studentId);
                if (!enrolledIdSet.has(sid)) {
                    enrolledIdSet.add(sid);
                    enrolledStudentIds.push(sid);
                }
            });
            const attendanceRecords = await db.attendance.filter(r => r.date === selectedDate && String(r.period) === String(selectedPeriod)).toArray();
            const attendanceMap = attendanceRecords.reduce((acc, record) => {
                acc[String(record.studentId)] = record.status;
                return acc;
            }, {});
                                                                                                  
            // Wildcat Pre-Processing: create attendance records from wildcatSchedule
            if (selectedPeriod === 'wildcat') {
                await modals.createWildcatAttendanceRecords(selectedDate);

                // Refresh attendanceMap after pre-creation so new records are reflected
                const refreshedRecords = await db.attendance
                    .filter(r => r.date === selectedDate && r.period === 'wildcat')
                    .toArray();
                refreshedRecords.forEach(r => {
                    if (!attendanceMap[String(r.studentId)]) {
                        attendanceMap[String(r.studentId)] = r.status;
                    }
                });
            
                // Wildcat Pre-Processing: Merge permanent enrollments with session changes
                // 1. Start with everyone who is PERMANENTLY enrolled in Wildcat
                const expectedWildcatIds = new Set(enrolledStudentIds);

                // 2. Add anyone who is already in the attendance database for today
                Object.keys(attendanceMap).forEach(id => expectedWildcatIds.add(id));

                // 3. Apply UI overrides (The "Pending" logic)
                Object.keys(this.pendingChanges).forEach(id => {
                    if (this.pendingChanges[id] === 'unmarked') {
                        // If we clicked Red X, remove them from the "Expected" group
                        expectedWildcatIds.delete(id);
                    } else {
                        // If we manually marked them, ensure they are in the "Expected" group
                        expectedWildcatIds.add(id);
                    }
                });

                // 4. Update our list for the rest of the render function
                enrolledStudentIds = Array.from(expectedWildcatIds);
            }
            // Categorize & Sort Students
            const enrolledStudents = allStudents.filter(s => enrolledStudentIds.includes(String(s.id))).sort(sortByStudentName);
            const otherStudents = allStudents.filter(s => !enrolledStudentIds.includes(String(s.id))).sort(sortByStudentName);

            // Build DOM
            studentList.innerHTML = '';

            // Render "Save Attendance" Button at the TOP
            const saveContainer = document.createElement('div');
            saveContainer.style.cssText = 'padding-bottom: var(--space-md); text-align: right;';
            saveContainer.innerHTML = `<button style="background-color: var(--color-primary); color: white; border: none; padding: var(--space-sm) var(--space-lg); border-radius: 4px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">Save Attendance</button>`;
            saveContainer.querySelector('button').onclick = () => this.saveAttendance();
            studentList.appendChild(saveContainer);
            
            // Render Enrolled / Expected
            if (enrolledStudents.length > 0) {
                const header = document.createElement('div');
                header.style.cssText = 'padding: var(--space-md) var(--space-lg); background-color: var(--color-primary-light); font-weight: 600; color: var(--color-primary); border-bottom: 2px solid var(--color-primary);';
                header.textContent = selectedPeriod === 'wildcat' ? `Expected at ${state.flexPeriodName}` : `Enrolled in Period ${selectedPeriod}`;
                studentList.appendChild(header);
                
                enrolledStudents.forEach(student => {
                    const finalStatus = this.pendingChanges[String(student.id)] || attendanceMap[String(student.id)] || 'present';
                    
                    // Check: Is this student PERMANENTLY enrolled in Wildcat?
                    // We check if their ID exists in the original 'enrollments' array we fetched at the start of render()
                    const isPermanent = enrollments.some(e => String(e.studentId) === String(student.id));

                    studentList.appendChild(this.createAttendanceItem(student, finalStatus, true, isPermanent));
                });
            }
            
            // Render Drop-ins
            if (otherStudents.length > 0) {
                const header = document.createElement('div');
                header.style.cssText = 'padding: var(--space-md) var(--space-lg); background-color: var(--color-background-tertiary); font-weight: 600; color: var(--color-text-secondary); border-bottom: 1px solid var(--color-border); margin-top: var(--space-base);';
                header.textContent = 'Other Students (Drop-ins)';
                studentList.appendChild(header);
                
                otherStudents.forEach(student => {
                    const finalStatus = this.pendingChanges[String(student.id)] || attendanceMap[String(student.id)] || 'unmarked';
                    studentList.appendChild(this.createAttendanceItem(student, finalStatus, false));
                });
            }
            
        } catch (error) {
            console.error('Error loading attendance:', error);
            studentList.innerHTML = '<p style="color: var(--color-error); text-align: center; padding: var(--space-2xl);">Failed to load students. Check console for details.</p>';
        }
    },
    
    createAttendanceItem: function(student, status, isEnrolled, isPermanent = false) {
        const item = document.createElement('div');
        const selectedPeriod = document.getElementById('attendance-period').value;
        item.className = `attendance__student-item attendance__student-item--${status}`;
        item.dataset.studentId = String(student.id);

        const statusLabels = { present: 'Present', late: 'Late', absent: 'Absent', unmarked: 'Unmarked' };
        const statusBadgeClass = { present: 'badge--success', late: 'badge--warning', absent: 'badge--error', unmarked: '' };
        const studentName = escapeHtml(displayName(student));

        // Bucket 2 accessibility: role, tabindex, aria-label
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-label', `${displayName(student)}, ${statusLabels[status] || 'Unmarked'}. Tap to change.`);

        // Click handler — guarded against swipe false triggers
        item.onclick = () => {
            if (item._gestureState && item._gestureState.swipeOccurred) return;
            this.cycleStatus(student.id, status, isEnrolled);
        };

        // Keyboard handler for Enter/Space (accessibility)
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.cycleStatus(student.id, status, isEnrolled);
            }
        });

        // LOGIC: Only show Red X if:
        // 1. It's Wildcat period
        // 2. They are in the "Expected" list
        // 3. They are NOT a permanent student (they are a guest/accident)
        let removeBtn = '';
        if (selectedPeriod === 'wildcat' && isEnrolled && !isPermanent) {
            removeBtn = `
                <button class="attendance__remove-btn" title="Remove student from list" 
                    onclick="event.stopPropagation(); pages.attendance.removeWildcatStudent('${student.id}')">
                    &times;
                </button>
            `;
        }

        item.innerHTML = `
            <div class="attendance__name-container" style="display: flex; align-items: center; gap: var(--space-md);">
                ${removeBtn}
                <span class="attendance__student-name">${studentName}</span>
            </div>
            <span class="badge ${escapeHtml(statusBadgeClass[status]) || ''}">${escapeHtml(statusLabels[status]) || 'Unmarked'}</span>
        `;

        // Attach swipe gestures (touch devices only — PC skips via gestures utility)
        gestures.makeSwipeable(item, {
            onSwipeRight: () => this.setStatus(student.id, 'late', isEnrolled),
            onSwipeLeft: () => this.setStatus(student.id, 'absent', isEnrolled),
            rightColor: 'var(--color-warning)',
            leftColor: 'var(--color-error)',
            rightIcon: '🕐',
            leftIcon: '✗',
            ignoreSelector: '.attendance__remove-btn'
        });

        return item;
    },
    
    // Shared status write — used by both cycleStatus (tap) and swipe callbacks
    setStatus: function(studentId, newStatus, isEnrolled) {
        this.pendingChanges[String(studentId)] = newStatus;
        this.updateAttendanceRow(studentId, newStatus);

        // Log and mark dirty for drive sync
        const selectedPeriod = document.getElementById('attendance-period').value;
        const selectedDate = document.getElementById('attendance-date').value;
        logAction('attendance-change', 'student', studentId, `${selectedPeriod} ${selectedDate}: → ${newStatus}`);
        if (typeof driveSync !== 'undefined') driveSync.markDirty();
    },

    // In-place DOM update for a single row (avoids full re-render flicker)
    updateAttendanceRow: function(studentId, newStatus) {
        const statusLabels = { present: 'Present', late: 'Late', absent: 'Absent', unmarked: 'Unmarked' };
        const statusBadgeClass = { present: 'badge--success', late: 'badge--warning', absent: 'badge--error', unmarked: '' };

        const row = document.querySelector(`.attendance__student-item[data-student-id="${studentId}"]`);
        if (!row) return;

        // Update CSS class
        row.className = row.className.replace(/attendance__student-item--(present|late|absent|unmarked)/, `attendance__student-item--${newStatus}`);

        // Update aria-label
        const nameEl = row.querySelector('.attendance__student-name');
        const name = nameEl ? nameEl.textContent : '';
        row.setAttribute('aria-label', `${name}, ${statusLabels[newStatus] || 'Unmarked'}. Tap to change.`);

        // Update badge — find it inside .swipe-content if gestures wrapped it, or directly
        const badge = row.querySelector('.badge');
        if (badge) {
            badge.className = `badge ${statusBadgeClass[newStatus] || ''}`;
            badge.textContent = statusLabels[newStatus] || 'Unmarked';
        }
    },

    cycleStatus: function(studentId, originalStatus, isEnrolled) {
        const selectedPeriod = document.getElementById('attendance-period').value;
        // Read current status from pendingChanges (in-place updates don't re-create the closure)
        const currentStatus = this.pendingChanges[String(studentId)] !== undefined
            ? this.pendingChanges[String(studentId)]
            : originalStatus;
        let cycle;

        if (selectedPeriod === 'wildcat') {
            cycle = { unmarked: 'present', present: 'absent', absent: 'late', late: 'unmarked' };
        } else if (isEnrolled) {
            cycle = { present: 'absent', absent: 'late', late: 'present', unmarked: 'present' };
        } else {
            cycle = { unmarked: 'present', present: 'late', late: 'unmarked', absent: 'unmarked' };
        }

        const newStatus = cycle[currentStatus];
        this.setStatus(studentId, newStatus, isEnrolled);
    },
    
    removeWildcatStudent: async function(studentId) {
        this.pendingChanges[String(studentId)] = 'unmarked';

        // Also cancel in wildcatSchedule so they don't reappear on reload
        try {
            const selectedDate = document.getElementById('attendance-date').value;
            const records = await db.wildcatSchedule
                .filter(r => String(r.studentId) === String(studentId) && r.targetDate === selectedDate && r.status !== 'cancelled')
                .toArray();
            for (const record of records) {
                await db.wildcatSchedule.update(record.id, { status: 'cancelled', updatedAt: new Date().toISOString() });
            }

            // Also delete the unmarked attendance record immediately so Save isn't required
            const att = await db.attendance
                .where('[studentId+date+period]')
                .equals([String(studentId), selectedDate, 'wildcat'])
                .first();
            if (att && att.status === 'unmarked') {
                await db.attendance.delete(att.id);
            }
        } catch (e) { /* ignore */ }

        this.render();
        ui.showToast("Student removed from Wildcat list.", "success");
    },

    saveAttendance: async function() {
        const period = document.getElementById('attendance-period').value;
        const selectedDate = document.getElementById('attendance-date').value;
        
        try {
            // 1. Get all currently enrolled students
            const activeYear = await getActiveSchoolYear();
            const enrollments = (await db.enrollments
                .filter(e => String(e.period) === String(period) && (e.schoolYear === activeYear || !e.schoolYear))
                .toArray());
            const saveIdSet = new Set();
            const enrolledStudentIds = [];
            enrollments.forEach(e => {
                const sid = String(e.studentId);
                if (!saveIdSet.has(sid)) {
                    saveIdSet.add(sid);
                    enrolledStudentIds.push(sid);
                }
            });
            
            // 2. Add anyone in pendingChanges (Drop-ins or people we just changed)
            Object.keys(this.pendingChanges).forEach(id => {
                if (!enrolledStudentIds.includes(id)) {
                    enrolledStudentIds.push(id);
                }
            });

            // 3. For Wildcat, include anyone already in the DB for today
            if (period === 'wildcat') {
                const attendanceRecords = await db.attendance.filter(r => r.date === selectedDate && String(r.period) === String(period)).toArray();
                attendanceRecords.forEach(r => {
                    if (!enrolledStudentIds.includes(String(r.studentId))) {
                        enrolledStudentIds.push(String(r.studentId));
                    }
                });
            }
            
            for (const studentId of enrolledStudentIds) {
                // Find if they already exist in the DB (using compound index)
                const existing = await db.attendance
                    .where('[studentId+date+period]')
                    .equals([String(studentId), selectedDate, String(period)])
                    .first();
                
                // Determine status
                const status = this.pendingChanges[studentId] || (existing ? existing.status : 'present');
                
                // --- THE FIX IS HERE ---
                // If we are unmarking a student who was a drop-in/accidental addition:
                if (status === 'unmarked') {
                    if (existing) {
                        await db.attendance.delete(existing.id);
                    }
                    // Send a cancel action to Google if automations are enabled
                    if (period === 'wildcat') {
                        const webhookUrl = this.getGoogleScriptUrl();
                        if (webhookUrl) {
                            fetch(webhookUrl, {
                                method: "POST",
                                body: JSON.stringify({
                                    action: "cancel_absence",
                                    studentId: String(studentId),
                                    date: selectedDate,
                                    token: localStorage.getItem('webhook_token') || ''
                                })
                            }).catch(err => {
                                console.error("Cancel trigger failed:", err);
                                ui.showToast('Webhook failed — check console for details.', 'error');
                            });
                        }
                    }
                    continue; // Move to next student, DO NOT run the save/add logic below
                }
                // ------------------------

                // Handle updates/additions
                const timestamp = new Date().toISOString();
                const recordData = { status, lateTime: status === 'late' ? timestamp : null, updatedAt: timestamp };

                if (existing) {
                    await db.attendance.update(existing.id, recordData);
                } else {
                    await db.attendance.add({
                        studentId: String(studentId), date: selectedDate, period,
                        createdAt: timestamp, ...recordData
                    });
                }

                // WILDCAT AUTOMATION LOGIC (Only for students who weren't skipped above)
                if (period === 'wildcat') {
                    const isPermanent = enrollments.some(e => 
                        String(e.studentId) === String(studentId) && 
                        String(e.period) === 'wildcat'
                    );

                    if (isPermanent) continue;

                    const student = await db.students.get(parseInt(studentId));
                    if (!student) continue;

                    const webhookUrl = this.getGoogleScriptUrl();
                    if (!webhookUrl) continue;

                    const todayStr = getTodayString();
                    const isToday = (selectedDate === todayStr);
                    const now = new Date();
                    const targetTime = new Date();
                    targetTime.setHours(10, 50, 0, 0);

                    let action = "";
                    if (status === 'absent') {
                        if (!isToday) continue;
                        action = (now.getTime() > targetTime.getTime()) ? "send_immediate" : "queue_absence";
                    } else {
                        action = "cancel_absence";
                    }
                    
                    fetch(webhookUrl, {
                        method: "POST",
                        body: JSON.stringify({
                            action: action,
                            studentId: String(studentId),
                            studentName: displayName(student),
                            studentEmail: student.email, 
                            teacherEmail: student.wildcatTeacherEmail, 
                            date: selectedDate,
                            token: localStorage.getItem('webhook_token') || ''
                        })
                    }).catch(err => {
                        console.error("Webhook trigger failed:", err);
                        ui.showToast('Webhook failed — check console for details.', 'error');
                    });
                }
            }

            // Mark wildcat schedule records as processed after attendance save
            if (period === 'wildcat') {
                const scheduled = await db.wildcatSchedule
                    .where('targetDate').equals(selectedDate)
                    .filter(r => ['attendance-created', 'emailed'].includes(r.status))
                    .toArray();
                for (const record of scheduled) {
                    // Check if student was marked present or absent
                    const attendanceRecord = await db.attendance
                        .where('[studentId+date+period]')
                        .equals([String(record.studentId), selectedDate, 'wildcat'])
                        .first();
                    if (attendanceRecord) {
                        const newStatus = attendanceRecord.status === 'absent' ? 'noshow' : 'showed';
                        await db.wildcatSchedule.update(record.id, { status: newStatus, updatedAt: new Date().toISOString() });
                    }
                }
            }
      
            this.pendingChanges = {};
            driveSync.markDirty(); await logAction('attendance', 'attendance', null, `Saved attendance for Period ${period} on ${selectedDate}`);
            alert("Attendance saved successfully!");
            this.render();   
        } catch (error) {
            console.error('Error saving attendance:', error);
            alert('Failed to save attendance.');
        }
    },

    exportAttendanceCSV: async function(mode, ferpa) {
        try {
            const activeYear = await getActiveSchoolYear();
            const niData = await getActiveNonInstructionalDays();
            const niDays = niData || [];
            const isNonInstructionalDay = (dateStr) => niDays.some(ni => {
                if (ni.end) return dateStr >= ni.date && dateStr <= ni.end;
                return ni.date === dateStr;
            });

            const selectedPeriod = document.getElementById('attendance-period').value;
            const selectedDate = document.getElementById('attendance-date').value || getTodayString();

            const allEnrollments = await db.enrollments.toArray();
            const yearEnrollments = allEnrollments.filter(e =>
                (e.schoolYear === activeYear || !e.schoolYear) &&
                (!selectedPeriod || String(e.period) === String(selectedPeriod))
            );
            const studentIds = [...new Set(yearEnrollments.map(e => e.studentId))];

            const allStudents = excludeDeleted(await db.students.toArray());
            const studentMap = new Map(allStudents.map(s => [s.id, s]));

            const allAttendance = await db.attendance.toArray();
            const filteredAttendance = allAttendance.filter(r =>
                !isNonInstructionalDay(r.date) &&
                (!selectedPeriod || String(r.period) === String(selectedPeriod))
            );

            if (mode === 'daily') {
                const dateRecords = filteredAttendance.filter(r => r.date === selectedDate);
                const recordMap = new Map(dateRecords.map(r => [String(r.studentId), r]));

                const rows = [];
                studentIds.forEach(sid => {
                    const student = studentMap.get(sid);
                    if (!student) return;
                    const record = recordMap.get(String(sid));
                    const enrollment = yearEnrollments.find(e => e.studentId === sid);
                    rows.push({
                        lastName: student.lastName || '',
                        firstName: student.firstName || '',
                        anonId: student.anonId || '',
                        period: enrollment ? enrollment.period : '',
                        date: selectedDate,
                        status: record ? record.status : 'no-record',
                        notes: record ? (record.notes || '') : ''
                    });
                });

                rows.sort((a, b) => sortByStudentName(a, b));

                let csv;
                if (ferpa) {
                    csv = 'Anonymous ID,Period,Date,Status,Notes\n';
                } else {
                    csv = 'Last Name,First Name,Period,Date,Status,Notes\n';
                }

                rows.forEach(r => {
                    if (ferpa) {
                        csv += `${csvEscape(r.anonId)},${csvEscape(r.period)},${r.date},${csvEscape(r.status)},${csvEscape(r.notes)}\n`;
                    } else {
                        csv += `${csvEscape(r.lastName)},${csvEscape(r.firstName)},${csvEscape(r.period)},${r.date},${csvEscape(r.status)},${csvEscape(r.notes)}\n`;
                    }
                });

                const periodLabel = selectedPeriod ? `P${selectedPeriod}` : 'AllPeriods';
                const suffix = ferpa ? '_FERPA' : '';
                downloadCSV(csv, `Attendance_Daily_${periodLabel}_${selectedDate}${suffix}`);
                ui.showToast('Daily attendance exported.', 'success');

            } else if (mode === 'summary') {
                const statsMap = new Map();
                filteredAttendance.forEach(r => {
                    const key = String(r.studentId);
                    if (!statsMap.has(key)) {
                        statsMap.set(key, { present: 0, absent: 0, late: 0, total: 0 });
                    }
                    const s = statsMap.get(key);
                    s.total++;
                    const status = (r.status || '').toLowerCase();
                    if (status === 'absent') s.absent++;
                    else if (status === 'late') s.late++;
                    else s.present++;
                });

                const rows = [];
                studentIds.forEach(sid => {
                    const student = studentMap.get(sid);
                    if (!student) return;
                    const stats = statsMap.get(String(sid)) || { present: 0, absent: 0, late: 0, total: 0 };
                    const enrollment = yearEnrollments.find(e => e.studentId === sid);
                    const pct = stats.total > 0 ? Math.round((stats.present / stats.total) * 1000) / 10 : 0;
                    rows.push({
                        lastName: student.lastName || '',
                        firstName: student.firstName || '',
                        anonId: student.anonId || '',
                        period: enrollment ? enrollment.period : '',
                        present: stats.present,
                        absent: stats.absent,
                        late: stats.late,
                        total: stats.total,
                        pct: pct
                    });
                });

                rows.sort((a, b) => sortByStudentName(a, b));

                let csv;
                if (ferpa) {
                    csv = 'Anonymous ID,Period,Days Present,Days Absent,Days Late,Total Days,% Present\n';
                } else {
                    csv = 'Last Name,First Name,Period,Days Present,Days Absent,Days Late,Total Days,% Present\n';
                }

                rows.forEach(r => {
                    if (ferpa) {
                        csv += `${csvEscape(r.anonId)},${csvEscape(r.period)},${r.present},${r.absent},${r.late},${r.total},${r.pct}%\n`;
                    } else {
                        csv += `${csvEscape(r.lastName)},${csvEscape(r.firstName)},${csvEscape(r.period)},${r.present},${r.absent},${r.late},${r.total},${r.pct}%\n`;
                    }
                });

                const periodLabel = selectedPeriod ? `P${selectedPeriod}` : 'AllPeriods';
                const suffix = ferpa ? '_FERPA' : '';
                downloadCSV(csv, `Attendance_Summary_${periodLabel}_${activeYear}${suffix}`);
                ui.showToast('Attendance summary exported.', 'success');
            }
        } catch (error) {
            console.error('Attendance export error:', error);
            ui.showToast('Failed to export attendance data.', 'error');
        }
    },

};
