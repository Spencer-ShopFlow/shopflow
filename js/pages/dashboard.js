// ----------------------------------------
// DASHBOARD PAGE
// ----------------------------------------
pages.dashboard = {
    render: async function() {
        // Update the date displayed on the dashboard
        const dateElement = document.getElementById('dashboard-date');
        const today = new Date();
        dateElement.textContent = ui.formatDate(today);

        // Sprint 13.3: Render quick action buttons
        await this.renderQuickActions();

        // Onboarding: Show setup progress card if setup is incomplete
        await this.renderSetupCard();

        try {
            // Get today's date string in LOCAL timezone, not UTC
            const todayString = getTodayString();
            console.log('Dashboard looking for:', todayString);

            // Query the database for today's attendance records
            const attendanceRecords = await db.attendance
                .where('date')
                .equals(todayString)
                .toArray();

            // Get enrollments filtered to active school year + deduplicated
            // Exclude soft-deleted students so their orphaned enrollments don't inflate counts
            const activeYear = await getActiveSchoolYear();
            const periodYearMapSetting = await db.settings.get('period-year-map');
            const periodYearMap = periodYearMapSetting ? periodYearMapSetting.value : {};
            const allStudents = excludeDeleted(await db.students.toArray());
            const activeStudentIds = new Set(allStudents.map(s => s.id));
            const rawEnrollments = await db.enrollments.toArray();
            const enrollmentSeen = new Set();
            const allEnrollments = rawEnrollments.filter(e => {
                if (e.schoolYear && e.schoolYear !== activeYear) return false;
                if (!activeStudentIds.has(e.studentId)) return false;
                const key = `${e.studentId}-${e.period}`;
                if (enrollmentSeen.has(key)) return false;
                enrollmentSeen.add(key);
                return true;
            });

            // Build a Set of all enrolled studentId-period combos
            const enrolledCombos = new Set();
            allEnrollments.forEach(e => {
                enrolledCombos.add(`${e.studentId}-${e.period}`);
            });

            // Filter attendance to ONLY enrolled students in non-wildcat periods
            // and exclude unmarked records (not yet real attendance)
            const enrolledAttendance = attendanceRecords.filter(r => {
                return r.period !== 'wildcat'
                    && r.status !== 'unmarked'
                    && enrolledCombos.has(`${r.studentId}-${r.period}`);
            });

            // Determine which periods have had attendance taken today
            const periodsWithAttendance = new Set(enrolledAttendance.map(r => r.period));

            // Denominator = enrolled students in ONLY the periods where attendance was taken
            const enrolledInActivePeriods = allEnrollments.filter(e =>
                periodsWithAttendance.has(String(e.period))
            );
            const totalEnrolledSlots = enrolledInActivePeriods.length;

            // Count statuses
            const presentCount = enrolledAttendance.filter(r => r.status === 'present').length;
            const lateCount = enrolledAttendance.filter(r => r.status === 'late').length;
            const absentCount = enrolledAttendance.filter(r => r.status === 'absent').length;

            const totalPresent = presentCount + lateCount;

            // Percentage based on only periods with attendance taken
            const percentPresent = totalEnrolledSlots > 0
                ? Math.round((totalPresent / totalEnrolledSlots) * 100)
                : 0;

            document.getElementById('stats-present').textContent = `${percentPresent}%`;

            // Absent count = unique absent STUDENTS (not records), matching the name list
            const absentRecords = enrolledAttendance.filter(r => r.status === 'absent');
            const uniqueAbsentStudentIds = new Set(absentRecords.map(r => r.studentId));
            document.getElementById('stats-absent').textContent = uniqueAbsentStudentIds.size;

            // Display absent students (deduplicated by student ID)
            const absentListContainer = document.getElementById('dashboard-absent-list');

            if (uniqueAbsentStudentIds.size > 0) {
                absentListContainer.innerHTML = '';

                const absentStudentObjects = await db.students
                    .where('id').anyOf([...uniqueAbsentStudentIds].map(id => parseInt(id)))
                    .toArray();
                const absentStudentMap = new Map(absentStudentObjects.map(s => [String(s.id), s]));

                for (const studentId of uniqueAbsentStudentIds) {
                    const student = absentStudentMap.get(String(studentId));
                    // Find which periods this student is absent from
                    const absentPeriods = absentRecords
                        .filter(r => r.studentId === studentId)
                        .map(r => `P${r.period}`)
                        .join(', ');
                    const nameTag = document.createElement('div');
                    nameTag.className = 'badge badge--error';
                    nameTag.style.margin = '2px';
                    nameTag.textContent = student ? `${displayName(student)} (${absentPeriods})` : 'Unknown';
                    absentListContainer.appendChild(nameTag);
                }
            } else {
                absentListContainer.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic; padding: var(--space-md);">All students present!</p>';
            }

            const progressBar = document.getElementById('stats-progress');
            if (progressBar) {
                progressBar.style.width = `${percentPresent}%`;
            }
            
        } catch (error) {
        console.error('Dashboard Stats Error:', error);
    }

    // Fire all independent sections concurrently
    this.loadActiveSchedule();
    this.loadStationIssues();
    this.processWildcatSchedule().then(() => {
        this.loadWildcatRoster();
        this.loadWildcatTasks();
    });
    autoTasks.generate().then(() => this.loadTasks());
    this.loadActiveAssignments();
    this.startAutoCheckTimer();
    alertsEngine.refresh().then(() => this.loadAlerts());
    this.loadTodaysEvents();
    },

renderSetupCard: async function() {
    const card = document.getElementById('dashboard-setup-card');
    const checklist = document.getElementById('setup-checklist');
    const dismissBtn = document.getElementById('setup-card-dismiss');
    if (!card || !checklist) return;

    // If teacher already dismissed, hide and bail
    const completedFlag = await db.settings.get('setup-complete');
    if (completedFlag && completedFlag.value === true) {
        card.style.display = 'none';
        return;
    }

    // Run the four checks
    const classCount = await db.classes.count();
    const yearStart = await db.settings.get('school-year');
    const periodMap = await db.settings.get('period-year-map');
    const allStudents = excludeDeleted(await db.students.toArray());

    const steps = [
        {
            label: 'Create at least one class',
            done: classCount > 0,
            action: () => { router.navigate('settings'); setTimeout(() => { const tab = document.querySelector('[data-tab="classes"]'); if (tab) tab.click(); }, 100); }
        },
        {
            label: 'Set school year dates',
            done: !!(yearStart && yearStart.value && yearStart.value.start),
            action: () => { router.navigate('settings'); setTimeout(() => { const tab = document.querySelector('[data-tab="school-year"]'); if (tab) tab.click(); }, 100); }
        },
        {
            label: 'Map periods to classes',
            done: !!(periodMap && periodMap.value && Object.values(periodMap.value).some(v => v)),
            action: () => { router.navigate('settings'); setTimeout(() => { const tab = document.querySelector('[data-tab="classes"]'); if (tab) tab.click(); }, 100); }
        },
        {
            label: 'Add students',
            done: allStudents.length > 0,
            action: () => { router.navigate('students'); }
        }
    ];

    const allDone = steps.every(s => s.done);

    if (allDone) {
        // Show a dismissible "You're all set!" banner
        checklist.innerHTML = '';
        const banner = document.createElement('div');
        banner.className = 'setup-card__done-banner';
        banner.textContent = '✅ You\'re all set! Your classroom is configured.';
        checklist.appendChild(banner);
        dismissBtn.style.display = '';
        card.style.display = '';
        return;
    }

    // Build the checklist UI
    checklist.innerHTML = '';
    dismissBtn.style.display = 'none';

    steps.forEach(step => {
        const row = document.createElement('div');
        row.className = 'setup-card__item ' + (step.done ? 'setup-card__item--done' : 'setup-card__item--pending');

        const icon = document.createElement('span');
        icon.className = 'setup-card__icon';
        icon.textContent = step.done ? '☑' : '☐';

        const label = document.createElement('span');
        label.textContent = step.label;

        row.appendChild(icon);
        row.appendChild(label);

        if (!step.done) {
            row.onclick = step.action;
        }

        checklist.appendChild(row);
    });

    card.style.display = '';
},

dismissSetupCard: async function() {
    await db.settings.put({ key: 'setup-complete', value: true });
    const card = document.getElementById('dashboard-setup-card');
    if (card) card.style.display = 'none';
    ui.showToast('Setup card dismissed. You can always adjust settings later.', 'success');
},

initPullToRefresh: function() {
    // Only attach once
    if (this._pullInitialized) return;
    this._pullInitialized = true;

    const scrollContainer = document.querySelector('.main-content');
    if (!scrollContainer) return;

    // PC guard — no touch, no pull-to-refresh
    if (!('ontouchstart' in window)) return;

    let startY = 0;
    let pulling = false;
    let refreshing = false;
    const pullResistance = 0.4;
    const triggerThreshold = 60;
    const maxPull = 80;

    const indicator = document.getElementById('dashboard-pull-indicator');
    const dashboardPage = document.getElementById('page-dashboard');
    const iconEl = indicator ? indicator.querySelector('.pull-indicator__icon') : null;
    const textEl = indicator ? indicator.querySelector('.pull-indicator__text') : null;

    scrollContainer.addEventListener('touchstart', (e) => {
        // Only active on dashboard page
        if (dashboardPage.classList.contains('hidden')) return;
        if (refreshing) return;
        if (scrollContainer.scrollTop > 0) return;

        startY = e.touches[0].clientY;
        pulling = true;
    }, { passive: true });

    scrollContainer.addEventListener('touchmove', (e) => {
        if (!pulling || refreshing) return;
        if (dashboardPage.classList.contains('hidden')) { pulling = false; return; }

        const deltaY = e.touches[0].clientY - startY;
        if (deltaY <= 0) {
            // Scrolling up — cancel pull
            if (indicator) indicator.style.display = 'none';
            return;
        }

        // Check if we're still at the top
        if (scrollContainer.scrollTop > 0) {
            pulling = false;
            if (indicator) indicator.style.display = 'none';
            return;
        }

        e.preventDefault(); // Suppress native pull-to-refresh

        const pullDistance = Math.min(deltaY * pullResistance, maxPull);

        if (indicator) {
            indicator.style.display = 'flex';
            indicator.style.height = pullDistance + 'px';
        }

        if (pullDistance >= triggerThreshold) {
            if (iconEl) { iconEl.textContent = '↑'; iconEl.classList.add('pull-indicator__icon--flipped'); }
            if (textEl) textEl.textContent = 'Release to refresh';
        } else {
            if (iconEl) { iconEl.textContent = '↓'; iconEl.classList.remove('pull-indicator__icon--flipped'); }
            if (textEl) textEl.textContent = 'Pull to refresh';
        }
    }, { passive: false });

    const endPull = () => {
        if (!pulling || refreshing) return;
        pulling = false;

        const currentHeight = indicator ? parseInt(indicator.style.height) || 0 : 0;

        if (currentHeight >= triggerThreshold) {
            // Trigger refresh
            refreshing = true;
            if (iconEl) { iconEl.textContent = '↻'; iconEl.className = 'pull-indicator__icon pull-indicator__icon--spinning'; }
            if (textEl) textEl.textContent = 'Refreshing…';
            if (indicator) indicator.style.height = '40px';

            this.doPullRefresh().then(() => {
                // Ensure spinner shows for at least 300ms
                setTimeout(() => {
                    refreshing = false;
                    if (indicator) {
                        indicator.style.display = 'none';
                        indicator.style.height = '';
                    }
                    if (iconEl) iconEl.className = 'pull-indicator__icon';
                    ui.showToast('Dashboard refreshed', 'success');
                }, 300);
            });
        } else {
            // Spring back
            if (indicator) {
                indicator.style.transition = 'height 200ms ease-out';
                indicator.style.height = '0px';
                setTimeout(() => {
                    indicator.style.display = 'none';
                    indicator.style.transition = '';
                    indicator.style.height = '';
                }, 200);
            }
        }
    };

    scrollContainer.addEventListener('touchend', endPull);
    scrollContainer.addEventListener('touchcancel', endPull);
},

doPullRefresh: async function() {
    try {
        await this.render();
        // Also trigger drive sync pull if available
        if (typeof driveSyncPull !== 'undefined') {
            await driveSyncPull.checkOnLoad();
        }
    } catch (error) {
        console.error('Pull-to-refresh error:', error);
    }
},

updateHeaderPeriod: function() {
    const headerPeriod = document.getElementById('period-select');
    // If we have a detected period, set the header dropdown to match it
    if (headerPeriod && state.currentPeriod) {
        headerPeriod.value = state.currentPeriod;
    }
},

loadWildcatTasks: async function() {
    const container = document.getElementById('wildcat-tasks-list');
    const section = document.getElementById('dashboard-wildcat-tasks');
    
    const isAutomationEnabled = localStorage.getItem('automations-enabled') === 'true'; 
    if (isAutomationEnabled) {
        if (section) section.classList.add('hidden');
        return;
    }

    const today = new Date();
    const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    try {
        const allStudents = excludeDeleted(await db.students.toArray());
        container.innerHTML = '';
        let hasPendingTasks = false;

        // --- SIGN-UP EMAILS: scheduled students not yet emailed (today or future only) ---
        const pendingSchedules = await db.wildcatSchedule
            .filter(r => (r.status === 'pending' || r.status === 'attendance-created') && r.targetDate >= todayString)
            .toArray();

        pendingSchedules.forEach(record => {
            const student = allStudents.find(s => s.id === record.studentId);
            if (!student) return;

            hasPendingTasks = true;
            const div = document.createElement('div');
            div.style.cssText = 'display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-md); margin-bottom: var(--space-xs); background: var(--color-background);';
            div.id = `wildcat-task-signup-${record.id}`;
            div.innerHTML = `
                <input type="checkbox" id="wildcat-check-signup-${record.id}" onchange="pages.dashboard.markWildcatComplete(${record.id}, 'signup')">
                <label for="wildcat-check-signup-${record.id}" style="flex: 1; cursor: pointer;">
                    <strong>${escapeHtml(displayName(student))}</strong>${escapeHtml(student.wildcatTeacher) ? ` → ${escapeHtml(student.wildcatTeacher)}` : ''}
                    <div style="font-size: 0.8em; color: var(--color-text-tertiary);">Sign-up Notification · ${escapeHtml(state.flexPeriodName)} on ${escapeHtml(record.targetDate)}</div>
                </label>
                <span class="badge badge--warning">Email Needed</span>
                <button onclick="pages.dashboard.cancelWildcatSignup(${record.id})" style="margin-left: var(--space-xs); background: none; border: 1px solid var(--color-error); color: var(--color-error); border-radius: var(--radius-sm); padding: 2px 8px; cursor: pointer; font-size: 0.8em;">✕ Cancel</button>
            `;
            container.appendChild(div);
        });

        // --- NO-SHOW EMAILS: DROP-IN students absent at Wildcat today ---
        // Enrolled Wildcat students don't need no-show emails (they're YOUR students)
        const wildcatAttendance = await db.attendance
            .where('[date+period]')
            .equals([todayString, 'wildcat'])
            .toArray();
        
        const enrolledWildcatIds = await pages.dashboard.wildcatEnrolledIds();
        
        const absentees = wildcatAttendance.filter(a => a.status === 'absent' && !enrolledWildcatIds.has(String(a.studentId)));
        
        // Check which have already been marked as emailed in wildcatSchedule
        const noshowSchedules = await db.wildcatSchedule
            .filter(r => r.targetDate === todayString && r.status === 'noshow-emailed')
            .toArray();
        const emailedStudentIds = new Set(noshowSchedules.map(r => r.studentId));

        absentees.forEach(record => {
            if (emailedStudentIds.has(parseInt(record.studentId))) return;
            
            const student = allStudents.find(s => s.id === parseInt(record.studentId));
            if (!student) return;
            
            hasPendingTasks = true;
            const div = document.createElement('div');
            div.style.cssText = 'display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm); border: 1px solid var(--color-error); border-radius: var(--radius-md); margin-bottom: var(--space-xs); background: rgba(220, 38, 38, 0.05);';
            div.id = `wildcat-task-noshow-${record.studentId}`;
            div.innerHTML = `
                <input type="checkbox" id="wildcat-check-noshow-${record.studentId}" onchange="pages.dashboard.markWildcatComplete(${record.studentId}, 'noshow')">
                <label for="wildcat-check-noshow-${record.studentId}" style="flex: 1; cursor: pointer;">
                    <strong>${escapeHtml(displayName(student))}</strong>${escapeHtml(student.wildcatTeacher) ? ` → ${escapeHtml(student.wildcatTeacher)}` : ''}
                    <div style="font-size: 0.8em; color: var(--color-error);">No-Show Notification</div>
                </label>
                <span class="badge badge--error">Email Needed</span>
            `;
            container.appendChild(div);
        });

        // The dashboard-wildcat-tasks id was lost on 1 May (a5a645a) and restored later; keep the guard
        if (section) section.classList.remove('hidden');
        if (!hasPendingTasks) {
            container.innerHTML = `<p style="color: var(--color-text-tertiary); font-style: italic;">No pending ${escapeHtml(state.flexPeriodName)} emails</p>`;
        }

    } catch (error) {
        console.error('Error loading wildcat tasks:', error);
        container.innerHTML = '<p style="color: var(--color-error);">Error loading tasks</p>';
    }
},

cancelWildcatSignup: async function(scheduleId) {
    if (!confirm(`Remove this student from the ${state.flexPeriodName} signup list?`)) return;
    try {
        await db.wildcatSchedule.update(scheduleId, { status: 'cancelled', updatedAt: new Date().toISOString() });
        ui.showToast(`${state.flexPeriodName} signup cancelled`, 'success');
    } catch (e) {
        console.error('Error cancelling signup:', e);
    }
    this.loadWildcatTasks();
    this.loadWildcatRoster();
},

markWildcatComplete: async function(id, taskType) {
    const checkbox = document.getElementById(`wildcat-check-${taskType}-${id}`);
    const taskDiv = document.getElementById(`wildcat-task-${taskType}-${id}`);
    
    if (checkbox.checked) {
        taskDiv.style.opacity = '0.5';
        taskDiv.querySelector('.badge').className = 'badge badge--success';
        taskDiv.querySelector('.badge').textContent = 'Email Sent';
        
        setTimeout(async () => {
            if (taskType === 'signup') {
                // Mark as emailed in the schedule record
                await db.wildcatSchedule.update(id, { status: 'emailed', updatedAt: new Date().toISOString() });
            } else if (taskType === 'noshow') {
                // Find and update the schedule record for this student today
                const today = new Date();
                const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                const record = await db.wildcatSchedule
                    .filter(r => r.studentId === id && r.targetDate === todayString)
                    .first();
                if (record) {
                    await db.wildcatSchedule.update(record.id, { status: 'noshow-emailed', updatedAt: new Date().toISOString() });
                }
            }
            
            taskDiv.remove();
            
            const container = document.getElementById('wildcat-tasks-list');
            if (container.children.length === 0) {
                container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">No pending Wildcat emails</p>';
            }
        }, 1000);
    }
},

loadStationIssues: async function() {
    const container = document.getElementById('station-issues-list');
    
    try {
        const today = getTodayString();
        
        // Get today's checkouts with "needs-work" status
        const issueCheckouts = await db.stationCheckouts
            .where('date')
            .equals(today)
            .toArray();
        
        const needsWork = issueCheckouts.filter(c => c.status === 'needs-work');
        
        if (needsWork.length === 0) {
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">No station issues today</p>';
            return;
        }
        
        // Load team names
        const allTeams = await db.teams.toArray();
        
        container.innerHTML = '';
        for (const checkout of needsWork) {
            const team = allTeams.find(t => t.id === checkout.teamId);
            if (!team) continue;
            
            const div = document.createElement('div');
            div.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: var(--space-sm); border: 1px solid var(--color-warning); border-radius: var(--radius-md); margin-bottom: var(--space-xs); background: rgba(234, 88, 12, 0.1);';
            div.innerHTML = `
                <div>
                    <strong>${escapeHtml(team.name)}</strong>
                    <span style="color: var(--color-text-secondary); margin-left: var(--space-sm);">Period ${escapeHtml(checkout.period)}</span>
                </div>
                <button class="badge badge--warning" style="cursor: pointer; border: none;" onclick="pages.dashboard.resolveStationIssue(${checkout.id})">✓ Mark Resolved</button>
            `;
            container.appendChild(div);
        }
        
    } catch (error) {
        console.error('Error loading station issues:', error);
        container.innerHTML = '<p style="color: var(--color-error);">Error loading station issues</p>';
    }
},

// Check if today is a no-Wildcat day (delay/early dismissal) and cancel pending schedules
// Also pre-create attendance records for today's scheduled students
processWildcatSchedule: async function() {
    const todayString = getTodayString();

    try {
        // Check if today is a no-Wildcat schedule
        const activeSchedule = await this.autoDetectSchedule();
        const noWildcatSchedules = ['2-hour-delay', '3-hour-delay', 'early-dismissal'];

        if (noWildcatSchedules.includes(activeSchedule)) {
            // Cancel all pending Wildcat schedules for today (including already-emailed)
            const todayScheduled = await db.wildcatSchedule
                .where('targetDate').equals(todayString)
                .filter(r => r.status === 'pending' || r.status === 'attendance-created' || r.status === 'emailed')
                .toArray();

            if (todayScheduled.length > 0) {
                for (const record of todayScheduled) {
                    await db.wildcatSchedule.update(record.id, { status: 'cancelled', updatedAt: new Date().toISOString() });
                }
                // Also remove any unmarked attendance records created for these students
                for (const record of todayScheduled) {
                    const att = await db.attendance
                        .where('[studentId+date+period]')
                        .equals([String(record.studentId), todayString, 'wildcat'])
                        .first();
                    if (att && att.status === 'unmarked') {
                        await db.attendance.delete(att.id);
                    }
                }
                ui.showToast(`${todayScheduled.length} Wildcat signup(s) cancelled — no Wildcat today (${activeSchedule})`, 'warning', 5000);
            }
            return;
        }

        // Normal day — pre-create attendance records for today's scheduled students
        await modals.createWildcatAttendanceRecords(todayString);

    } catch (err) {
        console.error('Error processing Wildcat schedule:', err);
    }
},

// i132: the students permanently enrolled in Wildcat: an enrollment in the Wildcat period for the
// active school year (or with no year), not removed. The same rule as attendance's save, so a
// student whose only Wildcat enrollment is from an old year counts as a drop-in here too.
wildcatEnrolledIds: async function() {
    const activeYear = await getActiveSchoolYear();
    const rows = await db.enrollments
        .filter(e => String(e.period) === 'wildcat' && !e.deletedAt && (e.schoolYear === activeYear || !e.schoolYear))
        .toArray();
    return new Set(rows.map(e => String(e.studentId)));
},

loadWildcatRoster: async function() {
    const container = document.getElementById('wildcat-noshows-list');
    
    try {
        const todayString = getTodayString();
        
        // Get who's enrolled in Wildcat regularly (this school year only, i132)
        const enrolledStudentIds = await pages.dashboard.wildcatEnrolledIds();
        
        // Get today's Wildcat attendance
        const wildcatAttendance = await db.attendance
            .where('[date+period]')
            .equals([todayString, 'wildcat'])
            .toArray();
        
        // Filter to ONLY drop-ins (students NOT regularly enrolled)
        const dropInRecords = wildcatAttendance.filter(record => 
            !enrolledStudentIds.has(String(record.studentId))
        );

        // Also include pending students from wildcatSchedule for today
        const pendingStudentIds = [];
        try {
            const todayScheduled = await db.wildcatSchedule
                .where('targetDate').equals(todayString)
                .filter(r => ['pending', 'attendance-created', 'emailed'].includes(r.status))
                .toArray();
            todayScheduled.forEach(record => {
                const alreadyInRecords = dropInRecords.some(r => String(r.studentId) === String(record.studentId));
                const alreadyEnrolled = enrolledStudentIds.has(String(record.studentId));
                if (!alreadyInRecords && !alreadyEnrolled) {
                    pendingStudentIds.push(record.studentId);
                }
            });
        } catch (e) { /* ignore */ }

        if (dropInRecords.length === 0 && pendingStudentIds.length === 0) {
            container.innerHTML = `<p style="color: var(--color-text-tertiary); font-style: italic;">No ${escapeHtml(state.flexPeriodName)} drop-ins today</p>`;
            document.getElementById('btn-send-roster-emails').style.display = 'none';
            return;
        }

        // Show the Notify Teachers button if automations are enabled and webhook is set
        const rosterBtn = document.getElementById('btn-send-roster-emails');
        const automationsOn = localStorage.getItem('automations-enabled') === 'true';
        const webhookExists = !!localStorage.getItem('webhook_wildcat');
        rosterBtn.style.display = (automationsOn && webhookExists) ? 'inline-flex' : 'none';
        
        // Get student names
        const allStudents = excludeDeleted(await db.students.toArray());
        const renderedStudentIds = new Set();

        // Display drop-in roster
        container.innerHTML = '';
        dropInRecords.forEach(record => {
            const student = allStudents.find(s => s.id === parseInt(record.studentId));
            if (!student) return;
            if (renderedStudentIds.has(student.id)) return;
            renderedStudentIds.add(student.id);
            
            let statusText, badgeClass, borderColor, bgColor;
            
            // Check the three possible states:
            if (record.status === 'unmarked') {
                statusText = 'Pending';
                badgeClass = 'badge--warning'; 
                borderColor = '#f59e0b'; 
                bgColor = 'rgba(245, 158, 11, 0.1)';
            } else if (record.status === 'present' || record.status === 'late') {
                statusText = '✓ Showed Up';
                badgeClass = 'badge--success';
                borderColor = 'var(--color-success)';
                bgColor = 'rgba(22, 163, 74, 0.1)';
            } else {
                statusText = '✗ No-Show';
                badgeClass = 'badge--error';
                borderColor = 'var(--color-error)';
                bgColor = 'rgba(220, 38, 38, 0.1)';
            }
            
            const div = document.createElement('div');
            div.style.cssText = `display: flex; align-items: center; justify-content: space-between; padding: var(--space-sm); border: 1px solid ${borderColor}; border-radius: var(--radius-md); margin-bottom: var(--space-xs); background: ${bgColor};`;
            div.innerHTML = `
                <strong>${escapeHtml(displayName(student))}</strong>
                <span class="badge ${badgeClass}">${statusText}</span>
            `;
            container.appendChild(div);
        });

        // Render pending students (signed up but not yet pre-processed into attendance)
        const allStudents2 = allStudents; // already loaded above
        pendingStudentIds.forEach(id => {
            const student = allStudents2.find(s => s.id === parseInt(id));
            if (!student) return;
            if (renderedStudentIds.has(student.id)) return;
            renderedStudentIds.add(student.id);

            const div = document.createElement('div');
            div.style.cssText = `display: flex; align-items: center; justify-content: space-between; padding: var(--space-sm); border: 1px solid #f59e0b; border-radius: var(--radius-md); margin-bottom: var(--space-xs); background: rgba(245, 158, 11, 0.1);`;
            div.innerHTML = `
                <strong>${escapeHtml(displayName(student))}</strong>
                <span class="badge badge--warning">⏳ Expected (Pending)</span>
            `;
            container.appendChild(div);
        });
        
    } catch (error) {
        console.error('Error loading Wildcat roster:', error);
        container.innerHTML = '<p style="color: var(--color-error);">Error loading roster</p>';
    }
},

sendRosterNotifications: async function() {
    // Step 1: Check that automations are on and webhook exists
    const webhookUrl = localStorage.getItem('webhook_wildcat');
    const automationsEnabled = localStorage.getItem('automations-enabled') === 'true';

    if (!automationsEnabled || !webhookUrl) {
        ui.showToast('Email automations are not enabled. Turn them on in Settings.', 'error');
        return;
    }

    const todayString = getTodayString();

    try {
        // Step 2: Gather all drop-in students for today
        // (This mirrors the same logic loadWildcatRoster uses)
        const allStudents = excludeDeleted(await db.students.toArray());

        // Figure out who is PERMANENTLY enrolled in Wildcat this school year (we skip these)
        const enrolledStudentIds = await pages.dashboard.wildcatEnrolledIds();

        // Get today's Wildcat attendance records, keep only drop-ins
        const wildcatAttendance = await db.attendance
            .where('[date+period]')
            .equals([todayString, 'wildcat'])
            .toArray();
        const dropInRecords = wildcatAttendance.filter(r => !enrolledStudentIds.has(String(r.studentId)));

        // Also grab pending wildcatSchedule entries for today
        const todayScheduled = await db.wildcatSchedule
            .where('targetDate').equals(todayString)
            .filter(r => ['pending', 'attendance-created', 'emailed'].includes(r.status))
            .toArray();

        // Merge everything into one set of unique student IDs
        const dropInStudentIds = new Set();
        dropInRecords.forEach(r => dropInStudentIds.add(String(r.studentId)));
        todayScheduled.forEach(r => {
            if (!enrolledStudentIds.has(String(r.studentId))) {
                dropInStudentIds.add(String(r.studentId));
            }
        });

        if (dropInStudentIds.size === 0) {
            ui.showToast('No drop-in students to notify about.', 'info');
            return;
        }

        // Step 3: Group students by their Wildcat teacher email
        const teacherGroups = {};  // keyed by teacherEmail

        for (const sid of dropInStudentIds) {
            const student = allStudents.find(s => s.id === parseInt(sid));
            if (!student) continue;

            const teacherEmail = (student.wildcatTeacherEmail || '').trim();
            if (!teacherEmail) {
                // Can't notify a teacher if we don't have their email
                console.warn(`Student ${displayName(student)} has no Wildcat teacher email — skipping.`);
                continue;
            }

            // Create the teacher's group if it doesn't exist yet
            if (!teacherGroups[teacherEmail]) {
                teacherGroups[teacherEmail] = {
                    teacherName: student.wildcatTeacher || 'Teacher',
                    teacherEmail: teacherEmail,
                    students: []
                };
            }

            // Add this student to their teacher's group
            teacherGroups[teacherEmail].students.push({
                name: displayName(student),
                email: student.email || ''
            });
        }

        // Convert the object into an array of groups
        const groups = Object.values(teacherGroups);

        if (groups.length === 0) {
            ui.showToast('No students have Wildcat teacher emails assigned.', 'error');
            return;
        }

        // Step 4: Show confirmation so you can review before sending
        let summary = `Send Wildcat roster emails?\n\n`;
        groups.forEach(g => {
            summary += `${g.teacherName} (${g.teacherEmail}):\n`;
            g.students.forEach(s => { summary += `  • ${s.name}\n`; });
            summary += '\n';
        });
        summary += `This will send ${groups.length} email(s).`;

        if (!confirm(summary)) return;

        // Step 5: Send the grouped data to your webhook
        const btn = document.getElementById('btn-send-roster-emails');
        btn.disabled = true;
        btn.textContent = '⏳ Sending...';

        webhookFetch(webhookUrl, {
            method: 'POST',
            body: JSON.stringify({
                action: 'send_roster_notifications',
                groups: groups,
                date: todayString,
                token: localStorage.getItem('webhook_token') || ''
            })
        }).then(response => {
            // Google Apps Script redirects on POST, so we may not
            // be able to read the response due to CORS — that's OK,
            // the email still sends. Treat any completed fetch as success.
            ui.showToast(`✅ Roster emails sent to ${groups.length} teacher(s)!`, 'success');
            btn.textContent = '✅ Sent!';
            btn.style.background = 'var(--color-success)';
            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = '📧 Notify Teachers';
                btn.style.background = '';
            }, 5000);
        }).catch(err => {
            console.error('Roster notification error:', err);
            ui.showToast('Failed to send roster emails: ' + err.message, 'error');
            btn.disabled = false;
            btn.textContent = '📧 Notify Teachers';
        });

    } catch (err) {
        console.error('Roster notification error:', err);
        ui.showToast('Failed to send roster emails: ' + err.message, 'error');
        const btn = document.getElementById('btn-send-roster-emails');
        btn.disabled = false;
        btn.textContent = '📧 Notify Teachers';
    }
},

resolveStationIssue: async function(checkoutId) {
    try {
        // Update status to "resolved"
        await db.stationCheckouts.update(checkoutId, {
            status: 'resolved'
        });
        
        ui.showToast('Station issue resolved!', 'success');
        
        // Reload the issues list
        this.loadStationIssues();
        
    } catch (error) {
        console.error('Error resolving station issue:', error);
        ui.showToast('Failed to resolve issue', 'error');
    }
},

changeSchedule: async function() {
    const selectedSchedule = document.getElementById('schedule-selector').value;
    
    // Save manual override to localStorage (expires at midnight)
    const today = new Date();
    const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    localStorage.setItem('schedule-override', JSON.stringify({
        date: todayString,
        schedule: selectedSchedule
    }));

    const scheduleLabels = {
        'normal': 'Normal Day',
        '2-hour-delay': '2-Hour Delay',
        '3-hour-delay': '3-Hour Delay',
        'early-dismissal': 'Early Dismissal'
    };
    ui.showToast(`Schedule set to ${scheduleLabels[selectedSchedule] || selectedSchedule}`, 'success');
    this.updateCurrentPeriod();
},

updateCurrentPeriod: async function() {
    const indicator = document.getElementById('current-period-indicator');

    // Get the currently selected schedule from the dropdown
    const scheduleSelector = document.getElementById('schedule-selector');
    const activeScheduleName = scheduleSelector ? scheduleSelector.value : 'normal';

    // Load bell times from settings (user-editable schedules)
    let periodTimes = null;
    try {
        const bellSchedulesData = await db.settings.get('bell-schedules');
        if (bellSchedulesData && bellSchedulesData.value && bellSchedulesData.value[activeScheduleName]) {
            periodTimes = bellSchedulesData.value[activeScheduleName];
        }
    } catch (e) { /* fall through to legacy */ }

    // Fallback to legacy scheduleConfig if bell-schedules not set up yet
    if (!periodTimes) {
        const allSchedules = await db.scheduleConfig.toArray();
        const activeSchedule = allSchedules.find(s => s.name === activeScheduleName) 
            || allSchedules.find(s => s.isActive === true) 
            || allSchedules[0];
        if (!activeSchedule) {
            indicator.textContent = 'No schedule set';
            indicator.className = 'badge badge--secondary';
            return;
        }
        periodTimes = activeSchedule.periods;
    }

    if (!periodTimes) {
        indicator.textContent = 'No schedule set';
        indicator.className = 'badge badge--secondary';
        return;
    }

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    // Find ALL periods that overlap with the current time
    let possiblePeriods = [];
    for (const [period, times] of Object.entries(periodTimes)) {
        if (period === 'activePeriods') continue;
        if (times && times.start && times.end && currentTime >= times.start && currentTime <= times.end) {
            possiblePeriods.push(period);
        }
    }

    let finalPeriod = null;

    // Resolve conflicts (like 4th vs 5th overlap)
    if (possiblePeriods.length > 1) {
        // Get active year enrollments to see where the students are
        const activeYear = await getActiveSchoolYear();
        const allEnrollments = await db.enrollments.toArray();
        const enrollments = allEnrollments.filter(e => e.schoolYear === activeYear || !e.schoolYear);
        const enrolledPeriods = new Set(enrollments.map(e => String(e.period)));

        // Pick the first possible period that actually has students enrolled
        finalPeriod = possiblePeriods.find(p => enrolledPeriods.has(String(p)));
        
        // Fallback to the first one if no students found in either
        if (!finalPeriod) finalPeriod = possiblePeriods[0];
    } else if (possiblePeriods.length === 1) {
        finalPeriod = possiblePeriods[0];
    }

    // Update the UI
    if (finalPeriod) {
        const displayLabel = finalPeriod === 'wildcat' ? 'Wildcat' : `Period ${finalPeriod}`;
        indicator.textContent = `Now: ${displayLabel}`;
        indicator.className = 'badge badge--success';
        
        // Set state (ensure it's lowercase 'wildcat' or the period number)
        state.currentPeriod = finalPeriod.toLowerCase(); 
        this.updateHeaderPeriod();
    } else {
        indicator.textContent = 'Between Periods';
        indicator.className = 'badge badge--secondary';
        state.currentPeriod = null;
    }
},

loadActiveSchedule: async function() {
    // Step 1: Auto-detect schedule from school calendar
    const autoDetectedSchedule = await this.autoDetectSchedule();

    // Step 2: Check for a user manual override (expires at midnight)
    const today = new Date();
    const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    let scheduleToUse = autoDetectedSchedule;
    let wasAutoDetected = true;

    const overrideRaw = localStorage.getItem('schedule-override');
    if (overrideRaw) {
        try {
            const override = JSON.parse(overrideRaw);
            if (override.date === todayString) {
                scheduleToUse = override.schedule;
                wasAutoDetected = false;
            } else {
                // Override is from a previous day — clear it
                localStorage.removeItem('schedule-override');
            }
        } catch (e) {
            localStorage.removeItem('schedule-override');
        }
    }

    // Step 3: Set the dropdown
    const selector = document.getElementById('schedule-selector');
    if (selector) {
        selector.value = scheduleToUse;
    }

    // Step 4: Show a toast if a non-normal schedule was auto-detected
    if (wasAutoDetected && scheduleToUse !== 'normal') {
        const scheduleLabels = {
            '2-hour-delay': '2-Hour Delay',
            '3-hour-delay': '3-Hour Delay',
            'early-dismissal': 'Early Dismissal'
        };
        ui.showToast(`Auto-detected: ${scheduleLabels[scheduleToUse] || scheduleToUse} schedule`, 'info');
    }

    this.updateCurrentPeriod();
    
    // Update period indicator every minute
    setInterval(() => {
        this.updateCurrentPeriod();
    }, 60000);
},

autoDetectSchedule: async function() {
    try {
        const today = new Date();
        const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        const days = await getActiveNonInstructionalDays();
        if (days.length === 0) return 'normal';
        const match = days.find(day => {
            if (day.end) {
                // Multi-day range (breaks, etc.)
                return todayString >= day.start && todayString <= day.end;
            } else {
                return day.start === todayString;
            }
        });

        if (!match) return 'normal';

        // Map non-instructional day type to schedule key
        const typeToSchedule = {
            'delay-2hr': '2-hour-delay',
            'delay-3hr': '3-hour-delay',
            'early-dismissal': 'early-dismissal'
        };

        return typeToSchedule[match.type] || 'normal';
    } catch (e) {
        console.error('Error auto-detecting schedule:', e);
        return 'normal';
    }
},

renderQuickActions: async function() {
    const container = document.getElementById('dashboard-quick-actions-container');
    if (!container) return;

    const setting = await db.settings.get('dashboard-quick-actions');
    let actionConfig;

    if (setting && Array.isArray(setting.value)) {
        actionConfig = setting.value;
        // Merge in any new actions from registry not in saved config
        QUICK_ACTION_REGISTRY.forEach(regAction => {
            if (!actionConfig.find(a => a.id === regAction.id)) {
                actionConfig.push({ id: regAction.id, label: regAction.label, enabled: true });
            }
        });
        // Remove saved actions that no longer exist in registry
        actionConfig = actionConfig.filter(a => QUICK_ACTION_REGISTRY.find(r => r.id === a.id));
    } else {
        actionConfig = QUICK_ACTION_REGISTRY.map(a => ({ id: a.id, label: a.label, enabled: true }));
    }

    const enabledActions = actionConfig.filter(a => a.enabled);
    let html = '';
    enabledActions.forEach(action => {
        const reg = QUICK_ACTION_REGISTRY.find(r => r.id === action.id);
        if (!reg) return;
        html += `<button class="btn ${reg.btnClass}" onclick="${reg.onclick}" style="${reg.style || ''}">${escapeHtml(reg.label)}</button>`;
    });

    if (html === '') {
        html = '<p style="color: var(--color-text-tertiary); font-style: italic;">No quick actions enabled. Configure in Settings → Preferences.</p>';
    }

    container.innerHTML = html;
},

loadActiveAssignments: async function() {
    const container = document.getElementById('dashboard-active-assignments');
    if (!container) return;

    try {
        const todayStr = getTodayString();
        const niDays = await getActiveNonInstructionalDays();
        const activeYear = await getActiveSchoolYear();

        // Get all active-by-date activities
        const allActivities = excludeDeleted(await db.activities.toArray());
        const activeActivities = allActivities.filter(a =>
            a.startDate && a.endDate && todayStr >= a.startDate && todayStr <= a.endDate
        );

        if (activeActivities.length === 0) {
            const totalActivities = allActivities.length;
            if (totalActivities === 0) {
                container.innerHTML = '<p style="color: var(--color-text-secondary); padding: var(--space-sm);">No assignments yet. <a href="#" onclick="router.navigate(\'activities\'); return false;" style="color: var(--color-primary); text-decoration: underline;">Go to Assignments</a> in the sidebar to create your first one.</p>';
            } else {
                container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">No active assignments right now.</p>';
            }
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

        // Sort activities by class then name
        activeActivities.sort((a, b) => {
            const classA = classMap.get(a.classId)?.name || '';
            const classB = classMap.get(b.classId)?.name || '';
            if (classA !== classB) return classA.localeCompare(classB);
            return (a.name || '').localeCompare(b.name || '');
        });

        let html = '';

        for (const activity of activeActivities) {
            const cls = classMap.get(activity.classId);
            const className = cls ? escapeHtml(cls.name) : 'Unknown Class';
            const dayPos = getSchoolDayPosition(todayStr, activity.startDate, activity.endDate, niDays);
            const dayPercent = dayPos ? Math.round((dayPos.currentDay / dayPos.totalDays) * 100) : 0;
            const dayLabel = dayPos ? `Day ${dayPos.currentDay} of ${dayPos.totalDays}` : '';

            // Get checkpoints for this activity
            const checkpoints = allCheckpoints.filter(cp => cp.activityId === activity.id).sort((a, b) => a.number - b.number);
            const totalCps = checkpoints.length;

            // Get students enrolled in this activity's class
            const periodsForClass = Object.entries(classPeriodsMap)
                .filter(([period, cId]) => parseInt(cId) === activity.classId)
                .map(([period]) => period);

            const enrolledStudentIds = [...new Set(
                allEnrollments
                    .filter(e => periodsForClass.includes(String(e.period)) && (!e.schoolYear || e.schoolYear === activeYear))
                    .map(e => e.studentId)
            )].filter(sid => studentMap.has(sid));

            // Get teams for this class
            const classTeams = allTeams.filter(t => t.classId === activity.classId);

            // Build team data
            const teamsData = [];
            const studentsOnTeams = new Set();

            for (const team of classTeams) {
                const memberIds = allTeamMembers
                    .filter(tm => tm.teamId === team.id)
                    .map(tm => tm.studentId)
                    .filter(sid => enrolledStudentIds.includes(sid) && studentMap.has(sid));

                if (memberIds.length === 0) continue;

                memberIds.forEach(sid => studentsOnTeams.add(sid));

                // Team checkpoint progress: a checkpoint is "team complete" when ALL members have completed it
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

                teamsData.push({
                    team,
                    memberIds,
                    teamCompletedCps,
                    memberProgress
                });
            }

            // Unaffiliated students (enrolled but not on any team)
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

            // Day progress bar color — use warning if past 75%, error if past 90%
            let dayBarColor = 'var(--color-info)';
            if (dayPercent > 90) dayBarColor = 'var(--color-error)';
            else if (dayPercent > 75) dayBarColor = 'var(--color-warning)';

            const activityId = activity.id;

            html += `
            <div class="card" style="margin-bottom: var(--space-sm); padding: var(--space-sm) var(--space-base);">
                <div style="display: flex; align-items: center; gap: var(--space-sm); cursor: pointer;"
                      onclick="pages.dashboard.toggleAssignmentExpand(${activityId})">
                    <span id="assign-chevron-${activityId}" style="font-size: 0.8em; color: var(--color-text-tertiary); transition: transform 0.2s; width: 16px;">▶</span>
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

                <div id="assign-expand-${activityId}" style="display: none; margin-top: var(--space-sm); padding-left: 24px;">
                    ${this._renderAssignmentLevel2(teamsData, unaffiliatedProgress, totalCps, activityId)}
                </div>
            </div>`;
        }

        container.innerHTML = html;

    } catch (err) {
        console.error('Error loading active assignments:', err);
        container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">Could not load active assignments.</p>';
    }
},

_renderAssignmentLevel2: function(teamsData, unaffiliatedProgress, totalCps, activityId) {
    let html = '';

    // Render teams
    for (const td of teamsData) {
        const teamPercent = totalCps > 0 ? Math.round((td.teamCompletedCps / totalCps) * 100) : 0;
        const teamId = td.team.id;

        html += `
        <div style="margin-bottom: var(--space-xs);">
            <div style="display: flex; align-items: center; gap: var(--space-sm); cursor: pointer; padding: 4px 0;"
                  onclick="pages.dashboard.toggleTeamExpand(${activityId}, ${teamId})">
                <span id="team-chevron-${activityId}-${teamId}" style="font-size: 0.7em; color: var(--color-text-tertiary); width: 14px;">▶</span>
                <span style="font-size: var(--font-size-body-small); font-weight: 500; min-width: 80px;">${escapeHtml(td.team.name)}</span>
                <div style="flex: 1; height: 5px; background: var(--color-background-secondary); border-radius: 3px; overflow: hidden;">
                    <div style="width: ${teamPercent}%; height: 100%; background: var(--color-primary); border-radius: 3px;"></div>
                </div>
                <span style="font-size: 11px; color: var(--color-text-tertiary); white-space: nowrap;">${td.teamCompletedCps}/${totalCps}</span>
            </div>

            <div id="team-expand-${activityId}-${teamId}" style="display: none; padding-left: 22px;">
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

    // Render unaffiliated students
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

toggleAssignmentExpand: function(activityId) {
    const expandEl = document.getElementById(`assign-expand-${activityId}`);
    const chevron = document.getElementById(`assign-chevron-${activityId}`);
    if (!expandEl) return;
    const isHidden = expandEl.style.display === 'none';
    expandEl.style.display = isHidden ? '' : 'none';
    if (chevron) chevron.textContent = isHidden ? '▼' : '▶';
},

toggleTeamExpand: function(activityId, teamId) {
    const expandEl = document.getElementById(`team-expand-${activityId}-${teamId}`);
    const chevron = document.getElementById(`team-chevron-${activityId}-${teamId}`);
    if (!expandEl) return;
    const isHidden = expandEl.style.display === 'none';
    expandEl.style.display = isHidden ? '' : 'none';
    if (chevron) chevron.textContent = isHidden ? '▼' : '▶';
},

loadTasks: async function() {
    const container = document.getElementById('dashboard-tasks-list');
    
    try {
        const allTasks = await db.tasks.toArray();
        const pendingTasks = allTasks.filter(t => !t.completed);
        
        // Sort: overdue first, then by due date, then by created date
        const now = new Date();
        pendingTasks.sort((a, b) => {
            const aOverdue = a.dueDate && new Date(a.dueDate) < now ? 0 : 1;
            const bOverdue = b.dueDate && new Date(b.dueDate) < now ? 0 : 1;
            if (aOverdue !== bOverdue) return aOverdue - bOverdue;
            if (!a.dueDate && !b.dueDate) {
                return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
            }
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return new Date(a.dueDate) - new Date(b.dueDate);
        });
        
        if (pendingTasks.length === 0) {
            const classCount = await db.classes.count();
            if (classCount === 0) {
                container.innerHTML = '<p style="color: var(--color-text-secondary); padding: var(--space-sm);">No classes configured yet. <a href="#" onclick="router.navigate(\'settings\'); setTimeout(() => { const tab = document.querySelector(\'[data-tab=\\\'classes\\\']\'); if (tab) tab.click(); }, 100); return false;" style="color: var(--color-primary); text-decoration: underline;">Go to Settings → Classes</a> to create your first class.</p>';
            } else {
                container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">All caught up!</p>';
            }
            return;
        }

        // Split into 3 groups
        const manualTasks = pendingTasks.filter(t => t.type !== 'auto');
        const absenceFollowUps = pendingTasks.filter(t => t.type === 'auto' && t.subtype === 'absence-followup');
        const otherAutoTasks = pendingTasks.filter(t => t.type === 'auto' && t.subtype !== 'absence-followup');
        
        container.innerHTML = '';

        // Render manual tasks directly (always visible)
        if (manualTasks.length > 0) {
            manualTasks.forEach(task => {
                container.appendChild(this.renderTaskRow(task));
            });
        }

        // Render absence follow-ups in a collapsible accordion (open by default — urgent)
        if (absenceFollowUps.length > 0) {
            const details = document.createElement('details');
            details.className = 'action-accordion';
            details.open = true;
            details.innerHTML = `<summary>🏠 Absence Follow-Ups <span class="action-accordion__count action-accordion__count--warning">${absenceFollowUps.length}</span></summary>`;
            const content = document.createElement('div');
            absenceFollowUps.forEach(task => {
                content.appendChild(this.renderTaskRow(task));
            });
            details.appendChild(content);
            container.appendChild(details);
        }

        // Render other auto-tasks in a collapsible accordion (closed by default)
        if (otherAutoTasks.length > 0) {
            const details = document.createElement('details');
            details.className = 'action-accordion';
            details.innerHTML = `<summary>⚡ Auto-Generated <span class="action-accordion__count">${otherAutoTasks.length}</span></summary>`;
            const content = document.createElement('div');
            otherAutoTasks.forEach(task => {
                content.appendChild(this.renderTaskRow(task));
            });
            details.appendChild(content);
            container.appendChild(details);
        }
        
    } catch (error) {
        console.error('Error loading tasks:', error);
        container.innerHTML = '<p style="color: var(--color-error);">Failed to load tasks</p>';
    }
},

renderTaskRow: function(task) {
    return renderTaskCard(task, {
        compact: true,
        showDelete: false,
        onComplete: (id) => this.completeTask(id),
        onNavigate: (id) => this.navigateToTask(id),
        refreshAll: () => pages.dashboard.loadTasks()
    });
},

completeTask: async function(taskId) {
    try {
        await db.tasks.update(taskId, {
            completed: true,
            status: 'completed',
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        
        if (typeof driveSync !== 'undefined') driveSync.markDirty();
        ui.showToast('Task completed!', 'success');
        this.loadTasks();
    } catch (error) {
        console.error('Error completing task:', error);
        ui.showToast('Failed to complete task', 'error');
    }
},

navigateToTask: async function(taskId) {
    try {
        const task = await db.tasks.get(taskId);
        if (!task || !task.linkedEntityType) return;

        if (task.linkedEntityType === 'activity' && task.linkedEntityId) {
            state.selectedActivity = task.linkedEntityId;
            // If it's a grading task, jump straight to the Grading tab
            if (task.subtype === 'grading-needed') {
                state.activityDetailInitialTab = 'grading';
            }
            router.navigate('activity-detail');
        } else if (task.linkedEntityType === 'student' && task.linkedEntityId) {
            router.navigate('student-detail', task.linkedEntityId);
        } else if (task.linkedEntityType === 'inventory' && task.linkedEntityId) {
            router.navigate('inventory');
        } else if (task.linkedEntityType === 'team' && task.linkedEntityId) {
            router.navigate('team-detail', task.linkedEntityId);
        }
    } catch (err) {
        console.error('Task navigation failed:', err);
    }
},

checkAllFormSubmissions: async function(btn) {
    const automationsEnabled = localStorage.getItem('automations-enabled') === 'true';
    const webhookUrl = localStorage.getItem('webhook_absent') || localStorage.getItem('webhook_wildcat');
    if (!automationsEnabled || !webhookUrl) {
        ui.showToast('Email automations must be enabled in Settings', 'error');
        return;
    }

    // Find all active assignments with a linked form spreadsheet
    const activities = excludeDeleted(await db.activities.toArray())
        .filter(a => a.formSpreadsheetId);

    if (activities.length === 0) {
        ui.showToast('No assignments have linked Google Forms', 'info');
        return;
    }

    // Disable button and show progress
    const originalText = btn.textContent;
    btn.disabled = true;

    let totalMatched = 0;
    let totalUnmatched = 0;
    let totalAutoGraded = 0;
    let assignmentsUpdated = 0;
    let errors = 0;
    let firstError = '';  // shown in the summary, so a failure says why (i156)

    for (let i = 0; i < activities.length; i++) {
        const activity = activities[i];
        btn.textContent = `⏳ Checking ${i + 1} of ${activities.length}...`;

        try {
            // One import for both Check Submissions buttons (plan row 3-02)
            const c = await formImport.importForActivity(activity, webhookUrl);
            if (c.changed > 0) assignmentsUpdated++;
            totalMatched += c.changed;
            totalUnmatched += c.unmatched;
            totalAutoGraded += c.autoGraded;
        } catch (err) {
            console.error(`Form check failed for ${activity.name}:`, err);
            if (!firstError) firstError = `${activity.name}: ${err && err.message ? err.message : 'unknown error'}`;
            errors++;
        }
    }

    // Restore button
    btn.disabled = false;
    btn.textContent = originalText;

    // Show summary
    let msg = `✅ ${totalMatched} new submission${totalMatched !== 1 ? 's' : ''} across ${assignmentsUpdated} assignment${assignmentsUpdated !== 1 ? 's' : ''}`;
    if (totalAutoGraded > 0) msg += ` · ${totalAutoGraded} auto-graded`;
    if (totalUnmatched > 0) msg += ` (${totalUnmatched} unmatched emails)`;
    if (errors > 0) msg += ` — ${errors} assignment${errors !== 1 ? 's' : ''} failed (${firstError})`;
    ui.showToast(msg, totalMatched > 0 ? 'success' : 'info', 8000);
    driveSync.markDirty();

    // Re-run auto-tasks so grading tasks appear immediately
    const existingTasks = await db.tasks.toArray();
    await autoTasks.checkGradingNeeded(existingTasks);
    this.loadTasks();
},

startAutoCheckTimer: function() {
    // Clear any existing timer
    if (this._autoCheckInterval) clearInterval(this._autoCheckInterval);

    this._autoCheckFiredToday = this._autoCheckFiredToday || new Set();

    // Reset the fired set at midnight
    
    const todayKey = getTodayString();
    if (this._autoCheckDate !== todayKey) {
        this._autoCheckFiredToday = new Set();
        this._autoCheckDate = todayKey;
    }

    this._autoCheckInterval = setInterval(() => {
        const automationsEnabled = localStorage.getItem('automations-enabled') === 'true';
        if (!automationsEnabled) return;

        const time1 = localStorage.getItem('auto-check-time-1') || '';
        const time2 = localStorage.getItem('auto-check-time-2') || '';
        if (!time1 && !time2) return;

        const now = new Date();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const todayKey = getTodayString();

        // Reset fired set if day changed
        if (this._autoCheckDate !== todayKey) {
            this._autoCheckFiredToday = new Set();
            this._autoCheckDate = todayKey;
        }

        // Fires once the time has come, not only on its exact minute (BUG21); if the app was
        // closed at 8:00 and 12:00, one check covers both.
        const checkTimes = [time1, time2].filter(t => t);
        const due = checkTimes.filter(t => currentTime >= t && !this._autoCheckFiredToday.has(`${todayKey}-${t}`));
        if (due.length > 0) {
            due.forEach(t => this._autoCheckFiredToday.add(`${todayKey}-${t}`));
            const scheduled = due[due.length - 1];
            {
                console.log(`⏰ Scheduled auto-check firing (${due.join(', ')})`);
                ui.showToast(`⏰ Auto-checking form submissions (${scheduled})...`, 'info', 5000);

                // Use a fake button object so checkAllFormSubmissions can update it
                const fakeBtn = { 
                    textContent: '', 
                    disabled: false, 
                    _original: '📋 Check Submissions' 
                };
                this.checkAllFormSubmissions(fakeBtn).then(() => {
                    ui.showToast('⏰ Scheduled submission check complete!', 'success', 5000);
                });
            }
        }
    }, 60000); // Check every 60 seconds
},

loadAlerts: async function() {
    const container = document.getElementById('dashboard-alerts-accordion');
    if (!container) return;

    try {
        const alerts = await db.alerts.toArray();

        if (alerts.length === 0) {
            container.innerHTML = '';
            return;
        }

        // Build accordion
        const details = document.createElement('details');
        details.className = 'action-accordion';
        details.innerHTML = `<summary>📡 Live Alerts <span class="action-accordion__count${alerts.length > 10 ? ' action-accordion__count--urgent' : ''}">${alerts.length}</span></summary>`;

        // Sort alerts by type
        const typeOrder = ['overdue', 'team', 'checkpoint'];
        const typeLabels = { checkpoint: '⚠️', team: '🏁', overdue: '🔴' };

        alerts.sort((a, b) => {
            const ai = typeOrder.indexOf(a.type);
            const bi = typeOrder.indexOf(b.type);
            if (ai !== bi) return ai - bi;
            return (a.title || '').localeCompare(b.title || '');
        });

        const content = document.createElement('div');

        // Show first 8, collapse the rest
        const visibleCount = 8;
        alerts.forEach((alert, i) => {
            const hasLink = (alert.linkedEntityType === 'student' || alert.linkedEntityType === 'team') && alert.linkedEntityId;
            const row = document.createElement(hasLink ? 'button' : 'div');
            row.className = 'alert-row';
            if (i >= visibleCount) row.style.display = 'none';
            row.classList.add('alert-board-row');

            if (hasLink) {
                row.type = 'button';
                row.setAttribute('aria-label', alert.title);
                row.style.cssText = 'cursor: pointer; background: none; border: none; width: 100%; text-align: left; font: inherit;';
                row.onclick = () => {
                    if (alert.linkedEntityType === 'student') {
                        router.navigate('student-detail', alert.linkedEntityId);
                    } else if (alert.linkedEntityType === 'team') {
                        router.navigate('team-detail', alert.linkedEntityId);
                    }
                };
            }

            const iconEmoji = typeLabels[alert.type] || '⚠️';

            row.innerHTML = `
                <div class="alert-row__icon">${iconEmoji}</div>
                <div class="alert-row__body">
                    <div class="alert-row__title">${escapeHtml(alert.title)}</div>
                    <div class="alert-row__detail">${escapeHtml(alert.detail || '')}</div>
                </div>
            `;

            content.appendChild(row);
        });

        if (alerts.length > visibleCount) {
            const showMore = document.createElement('button');
            showMore.className = 'btn btn--secondary';
            showMore.style.cssText = 'font-size: var(--font-size-body-small); padding: var(--space-xs) var(--space-sm); margin: var(--space-sm) 0;';
            showMore.textContent = `Show All ${alerts.length} Alerts`;
            showMore.onclick = () => {
                content.querySelectorAll('.alert-board-row').forEach(r => r.style.display = '');
                showMore.remove();
            };
            content.appendChild(showMore);
        }

        details.appendChild(content);
        container.innerHTML = '';
        container.appendChild(details);

    } catch (error) {
        console.error('Error loading alerts:', error);
        container.innerHTML = '';
    }
},

loadTodaysEvents: async function() {
    const container = document.getElementById('dashboard-events-list');
    
    try {
        const today = new Date();
        const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        
        // Get events for today
        const allEvents = await db.events.toArray();
        const todaysEvents = allEvents.filter(e => e.date === todayString);
        
        if (todaysEvents.length === 0) {
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic; padding: var(--space-md);">No events scheduled for today.</p>';
            return;
        }
        
        // Display events
        container.innerHTML = '';
        todaysEvents.forEach(event => {
            const categoryColors = {
                'field-trip': 'var(--color-info)',
                'assembly': 'var(--color-warning)',
                'testing': 'var(--color-error)',
                'no-school': 'var(--color-text-tertiary)',
                'holiday': 'var(--color-success)',
                'general': 'var(--color-primary)',
                'other': 'var(--color-text-secondary)'
            };
            
            const color = categoryColors[event.category] || 'var(--color-primary)';
            
            const div = document.createElement('div');
            div.style.cssText = `padding: var(--space-sm); border-left: 4px solid ${color}; background: rgba(0,0,0,0.02); border-radius: var(--radius-sm); margin-bottom: var(--space-xs); cursor: pointer;`;
            div.onclick = () => modals.showEditEvent(event.id);
            div.innerHTML = `
                <div style="font-weight: 600;">${escapeHtml(event.title)}</div>
                ${escapeHtml(event.description) ? `<div style="font-size: var(--font-size-body-small); color: var(--color-text-secondary); margin-top: var(--space-xs);">${escapeHtml(event.description)}</div>` : ''}
            `;
            container.appendChild(div);
        });
        
    } catch (error) {
        console.error('Error loading today\'s events:', error);
        container.innerHTML = '<p style="color: var(--color-error);">Failed to load events</p>';
    }
},
};
