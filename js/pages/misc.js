// ----------------------------------------
// INVENTORY PAGE
// ----------------------------------------
pages.inventory = {
    currentFilter: 'all',
    searchQuery: '',
    
    render: async function() {
        const grid = document.getElementById('inventory-grid');
        grid.innerHTML = '';
        
        // Set up search listener (only once)
        const searchInput = document.getElementById('inventory-search');
        if (searchInput && !searchInput.dataset.listenerAttached) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.toLowerCase().trim();
                this.render();
            });
            searchInput.dataset.listenerAttached = 'true';
        }
        
        try {
            let items = excludeDeleted(await db.inventory.toArray());
            
            // Apply search filter
            if (this.searchQuery) {
                items = items.filter(item => 
                    item.name.toLowerCase().includes(this.searchQuery) ||
                    (item.category && item.category.toLowerCase().includes(this.searchQuery)) ||
                    (item.location && item.location.toLowerCase().includes(this.searchQuery))
                );
            }
            
            // Apply category filter
            if (this.currentFilter === 'tools') {
                items = items.filter(i => i.category === 'tools');
            } else if (this.currentFilter === 'materials') {
                items = items.filter(i => i.category === 'materials');
            } else if (this.currentFilter === 'low-stock') {
                items = items.filter(i => i.quantity <= i.threshold);
            } else if (this.currentFilter === 'checked-out') {
                // Get all checkouts and filter for null returnedAt
                const allCheckouts = await db.checkouts.toArray();
                const activeCheckouts = allCheckouts.filter(c => !c.returnedAt);
                const checkedOutItemIds = [...new Set(activeCheckouts.map(c => c.itemId))];
                items = items.filter(i => checkedOutItemIds.includes(i.id));
            }
            
            if (items.length === 0) {
                const message = this.searchQuery 
                    ? `No items found matching "${this.searchQuery}"`
                    : 'No items found. Click "+ Add Item" to get started.';
                grid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--color-text-tertiary); padding: var(--space-2xl);">${escapeHtml(message)}</p>`;
                return;
            }
            
            // Sort alphabetically
            items.sort((a, b) => a.name.localeCompare(b.name));
            
            // Get active checkouts for all items
            const allCheckoutsTemp = await db.checkouts.toArray();
            const allCheckouts = allCheckoutsTemp.filter(c => !c.returnedAt);
            
            // Render item cards
            for (const item of items) {
                const card = await this.createItemCard(item, allCheckouts);
                grid.appendChild(card);
            }
            
            // Update filter button states
            document.querySelectorAll('.inventory-filter-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.filter === this.currentFilter);
            });
            
        } catch (error) {
            console.error('Error loading inventory:', error);
            grid.innerHTML = '<p style="color: var(--color-error);">Failed to load inventory.</p>';
        }
    },
    
    setFilter: function(filter) {
        this.currentFilter = filter;
        this.render();
    },
    
    createItemCard: async function(item, allCheckouts) {
        const card = document.createElement('div');
        card.className = 'card';
        
        const isLowStock = item.quantity <= item.threshold;
        const activeCheckouts = allCheckouts.filter(c => c.itemId === item.id);
        const checkedOutQty = activeCheckouts.length;
        const available = item.quantity - checkedOutQty;
        
        // Category icon
        const categoryIcons = {
            tools: '🔧',
            materials: '📦',
            electronics: '⚡',
            safety: '🦺',
            other: '📋'
        };
        const icon = categoryIcons[item.category] || '📋';
        
        card.innerHTML = `
            <div class="card__header">
                <div style="display: flex; align-items: center; gap: var(--space-sm);">
                    <span style="font-size: 24px;">${escapeHtml(icon)}</span>
                    <h3 class="card__title">${escapeHtml(item.name)}</h3>
                </div>
                ${isLowStock ? '<span class="badge badge--error">Low Stock</span>' : ''}
            </div>
            <div class="card__body">
                <p><strong>Category:</strong> ${escapeHtml(item.category).charAt(0).toUpperCase() + escapeHtml(item.category).slice(1)}</p>
                <p><strong>Total Quantity:</strong> ${escapeHtml(item.quantity)}</p>
                <p><strong>Available:</strong> ${escapeHtml(available)} ${checkedOutQty > 0 ? `(${escapeHtml(checkedOutQty)} checked out)` : ''}</p>
                ${escapeHtml(item.location) ? `<p><strong>Location:</strong> ${escapeHtml(item.location)}</p>` : ''}
                ${isLowStock ? `<p style="color: var(--color-error); margin-top: var(--space-sm);">⚠️ Below threshold of ${escapeHtml(item.threshold)}</p>` : ''}
            </div>
            <div class="card__footer">
                <button class="btn btn--primary" onclick="pages.inventory.showCheckoutModal(${item.id})">Check Out</button>
                <button class="btn btn--secondary" onclick="modals.showEditInventoryItem(${item.id})">Edit</button>
                <button class="btn btn--danger" onclick="pages.inventory.deleteItem(${item.id})">Delete</button>
            </div>
        `;
        
        return card;
    },
    
    showCheckoutModal: function(itemId) {
        modals.showCheckoutModal(itemId);
    },
    
    deleteItem: async function(id) {
        try {
            const item = await db.inventory.get(id);
            if (!item) return;

            await db.inventory.update(id, { deletedAt: new Date().toISOString() });
            driveSync.markDirty(); await logAction('delete', 'inventory', id, `Deleted inventory item ${item.name}`);
            this.render();

            ui.showUndoToast(`Item "${item.name}" deleted`, async () => {
                await db.inventory.update(id, { deletedAt: null });
                driveSync.markDirty(); await logAction('undo', 'inventory', id, `Undid delete of item ${item.name}`);
                this.render();
            });
        } catch (error) {
            console.error('Error deleting item:', error);
            ui.showToast('Failed to delete item', 'error');
        }
    },
};



// ----------------------------------------
// CALENDAR PAGE
// ----------------------------------------
pages.calendar = {
    currentMonth: new Date().getMonth(),
    currentYear: new Date().getFullYear(),
    
    render: async function() {
        await this.renderCalendar();
    },
    
    previousMonth: function() {
        this.currentMonth--;
        if (this.currentMonth < 0) {
            this.currentMonth = 11;
            this.currentYear--;
        }
        this.renderCalendar();
    },
    
    nextMonth: function() {
        this.currentMonth++;
        if (this.currentMonth > 11) {
            this.currentMonth = 0;
            this.currentYear++;
        }
        this.renderCalendar();
    },
    
    goToToday: function() {
        const today = new Date();
        this.currentMonth = today.getMonth();
        this.currentYear = today.getFullYear();
        this.renderCalendar();
    },
    
    navigateToActivity: function(activityId) {
        state.selectedActivity = activityId;
        router.navigate('activity-detail');
    },

    renderCalendar: async function() {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        
        // Update month/year display
        document.getElementById('calendar-month-year').textContent = `${monthNames[this.currentMonth]} ${this.currentYear}`;
        
        // Get first day of month and number of days
        const firstDay = new Date(this.currentYear, this.currentMonth, 1);
        const lastDay = new Date(this.currentYear, this.currentMonth + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startingDayOfWeek = firstDay.getDay(); // 0 = Sunday
        
        // Load activities, checkpoints, events, and non-instructional days
        const activities = await db.activities.toArray();
        const checkpoints = await db.checkpoints.toArray();
        const events = await db.events.toArray();
        const allClasses = await db.classes.toArray();
        const classColorMap = {};
        allClasses.forEach(cls => classColorMap[cls.id] = cls.color);
        const nonInstructionalDays = await getActiveNonInstructionalDays();
        
        // Load school year
        const schoolYearSettings = await db.settings.get('school-year');
        const schoolYear = schoolYearSettings?.value || null;

        // Build calendar grid
        const container = document.getElementById('calendar-grid');
        let html = '<table style="width: 100%; border-collapse: collapse;"><thead><tr>';
        
        // Day headers
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        dayNames.forEach(day => {
            html += `<th style="padding: var(--space-sm); border: 1px solid var(--color-border); background-color: var(--color-background-tertiary); text-align: center;">${day}</th>`;
        });
        html += '</tr></thead><tbody><tr>';
        
        // Empty cells before first day
        for (let i = 0; i < startingDayOfWeek; i++) {
            html += '<td style="border: 1px solid var(--color-border); background-color: var(--color-background-secondary);"></td>';
        }
        
        // Calendar days
        for (let day = 1; day <= daysInMonth; day++) {
            const dateString = `${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = dateString === getTodayString();
            
            // Find events for this day
            const dayActivities = activities.filter(a => a.startDate === dateString || a.endDate === dateString);
            const dayCheckpoints = checkpoints.filter(cp => cp.suggestedDate === dateString);
            const dayEvents = events.filter(e => e.date === dateString);

            // Check if this day is non-instructional
            const dayNonInstructional = nonInstructionalDays.filter(ni => {
                if (ni.end) {
                    // Multi-day break
                    return dateString >= ni.start && dateString <= ni.end;
                } else {
                    // Single day
                    return dateString === ni.start;
                }
            });
            
            // Cell styling
            let cellStyle = 'border: 1px solid var(--color-border); padding: var(--space-xs); vertical-align: top; min-height: 100px; width: 14%;';

            // Check if weekend
            const dayOfWeek = new Date(this.currentYear, this.currentMonth, day).getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

            // Check if outside school year
            const isOutsideSchoolYear = schoolYear && (dateString < schoolYear.start || dateString > schoolYear.end);

            // Only gray out actual no-school days, not delays or early dismissals
            const isNoSchool = dayNonInstructional.some(ni => 
                ['holiday', 'break', 'no-school'].includes(ni.type)
            );

            if (isNoSchool || isWeekend || isOutsideSchoolYear) {
                cellStyle += ' background-color: #f5f5f5; opacity: 0.7;';
            } else if (isToday) {
                cellStyle += ' background-color: var(--color-primary-light); border: 2px solid var(--color-primary);';
            }
            
            html += `<td style="${cellStyle}">`;
            html += `<div style="font-weight: ${isToday ? 'bold' : 'normal'}; margin-bottom: var(--space-xs);">${day}</div>`;
            
            // Add non-instructional day labels
            dayNonInstructional.forEach(ni => {
                const typeColors = {
                    'holiday': '#16a34a',
                    'break': '#0891b2',
                    'no-school': '#71717a',
                    'delay-2hr': '#ea580c',
                    'delay-3hr': '#ea580c',
                    'early-dismissal': '#ea580c'
                };
                const color = typeColors[ni.type] || '#71717a';
                
                html += `<div style="background-color: ${color}; color: white; padding: 2px 4px; margin-bottom: 2px; font-size: 10px; border-radius: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600;">${escapeHtml(ni.name)}</div>`;
            });

            // Add activities
            dayActivities.forEach(activity => {
                const isStart = activity.startDate === dateString;
                const isEnd = activity.endDate === dateString;
                const label = isStart ? '▶' : (isEnd ? '◀' : '');
                const color = classColorMap[activity.classId] || '#71717a';
                
                html += `<div style="background-color: ${color}; color: white; padding: 2px 4px; margin-bottom: 2px; font-size: 10px; border-radius: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;" title="${escapeHtml(activity.name)}" onclick="pages.calendar.navigateToActivity(${activity.id});">${label} ${activity.name.substring(0, 15)}...</div>`;
            });
            
            // Add checkpoints (color-coded by their activity's Engineering Year)
            for (const cp of dayCheckpoints) {
                const activity = activities.find(a => a.id === cp.activityId);
                if (activity) {
                    const color = classColorMap[activity.classId] || '#71717a';
                    
                    // Abbreviate activity name inline
                    let activityAbbrev = activity.name.substring(0, 8);
                    const match = activity.name.match(/^(Activity|Project|Problem)\s+(\d+)\.(\d+)\.(\d+)/i);
                    if (match) {
                        const typeCode = match[1].toLowerCase() === 'project' ? 'PJ' : 
                                        match[1].toLowerCase() === 'problem' ? 'PB' : 'A';
                        activityAbbrev = typeCode + match[2] + match[3] + match[4];
                    }
                    
                    html += `<div style="background-color: ${color}; color: white; padding: 2px 4px; margin-bottom: 2px; font-size: 10px; border-radius: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;" title="${activity.name} - ${escapeHtml(cp.title)}" onclick="pages.calendar.navigateToActivity(${cp.activityId});">📌 ${activityAbbrev} CP${cp.number}</div>`;
                }
            }
            
            // Add events
            dayEvents.forEach(event => {
                const categoryColors = {
                    'field-trip': '#0891b2',
                    'assembly': '#ea580c',
                    'testing': '#dc2626',
                    'no-school': '#71717a',
                    'holiday': '#16a34a',
                    'general': '#C8102E',
                    'other': '#525252'
                };
                const color = categoryColors[event.category] || '#C8102E';
                
                html += `<div style="background-color: ${color}; color: white; padding: 2px 4px; margin-bottom: 2px; font-size: 10px; border-radius: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;" title="${escapeHtml(event.title)}" onclick="modals.showEditEvent(${event.id})">📅 ${event.title.substring(0, 12)}...</div>`;
            });

            html += '</td>';
            
            // New row on Sunday
            if ((startingDayOfWeek + day) % 7 === 0 && day !== daysInMonth) {
                html += '</tr><tr>';
            }
        }
        
        // Empty cells after last day
        const remainingCells = 7 - ((startingDayOfWeek + daysInMonth) % 7);
        if (remainingCells < 7) {
            for (let i = 0; i < remainingCells; i++) {
                html += '<td style="border: 1px solid var(--color-border); background-color: var(--color-background-secondary);"></td>';
            }
        }
        
        html += '</tr></tbody></table>';
        container.innerHTML = html;
    }
};

// ----------------------------------------
// TASKS PAGE
// ----------------------------------------
pages.tasks = {
    currentFilter: 'all',
    
    render: async function() {
        // Hook up the Add Task button
        const addBtn = document.getElementById('add-task-btn');
        if (addBtn && !addBtn.dataset.listenerAttached) {
            addBtn.onclick = () => modals.showAddTask();
            addBtn.dataset.listenerAttached = 'true';
        }
        
        // Hook up filter buttons
        document.querySelectorAll('.tasks-filters button').forEach(btn => {
            btn.onclick = () => this.setFilter(btn.dataset.filter);
        });
        
        // Load and render tasks
        await this.loadTasks();
    },
    
    setFilter: function(filter) {
        this.currentFilter = filter;
        
        // Update active button
        document.querySelectorAll('.tasks-filters button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        
        this.loadTasks();
    },
    
    loadTasks: async function() {
        const container = document.querySelector('.tasks-list');
        
        try {
            let tasks = await db.tasks.toArray();
            
            // Apply filter
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const todayEnd = new Date(todayStart);
            todayEnd.setDate(todayEnd.getDate() + 1);
            
            if (this.currentFilter === 'today') {
                tasks = tasks.filter(t => {
                    if (!t.dueDate || t.completed) return false;
                    const dueDate = new Date(t.dueDate);
                    return dueDate >= todayStart && dueDate < todayEnd;
                });
            } else if (this.currentFilter === 'overdue') {
                tasks = tasks.filter(t => {
                    if (!t.dueDate || t.completed) return false;
                    return new Date(t.dueDate) < now;
                });
            } else if (this.currentFilter === 'completed') {
                tasks = tasks.filter(t => t.completed);
            } else {
                // 'all' - show all tasks
            }
            
            // Sort by due date (soonest first), completed tasks last
            tasks.sort((a, b) => {
                // Completed tasks go to the bottom
                if (a.completed && !b.completed) return 1;
                if (!a.completed && b.completed) return -1;
                
                // Then sort by due date
                if (!a.dueDate) return 1;
                if (!b.dueDate) return -1;
                return new Date(a.dueDate) - new Date(b.dueDate);
            });
            
            // Render tasks
            if (tasks.length === 0) {
                container.innerHTML = `<p style="text-align: center; color: var(--color-text-tertiary); padding: var(--space-2xl);">No ${this.currentFilter === 'all' ? '' : escapeHtml(this.currentFilter) + ' '}tasks found.</p>`;
                return;
            }
            
            container.innerHTML = '';
            tasks.forEach(task => {
                const card = this.createTaskCard(task);
                container.appendChild(card);
            });
            
        } catch (error) {
            console.error('Error loading tasks:', error);
            container.innerHTML = '<p style="color: var(--color-error);">Failed to load tasks</p>';
        }
    },
    
    createTaskCard: function(task) {
        const refreshAll = () => {
            pages.tasks.loadTasks();
            if (!document.getElementById('page-dashboard').classList.contains('hidden')) {
                pages.dashboard.loadTasks();
            }
        };

        return renderTaskCard(task, {
            compact: false,
            showDelete: true,
            onComplete: (id) => this.toggleComplete(id),
            onDelete: (id) => this.deleteTask(id),
            refreshAll: refreshAll
        });
    },
    
    toggleComplete: async function(taskId) {
        try {
            const task = await db.tasks.get(taskId);
            
            await db.tasks.update(taskId, {
                completed: !task.completed,
                status: !task.completed ? 'completed' : 'pending',
                completedAt: !task.completed ? new Date().toISOString() : null,
                updatedAt: new Date().toISOString()
            });
            
            if (typeof driveSync !== 'undefined') driveSync.markDirty();
            ui.showToast(task.completed ? 'Task reopened' : 'Task completed!', 'success');
            this.loadTasks();
            
            // Also refresh dashboard if it's visible
            if (!document.getElementById('page-dashboard').classList.contains('hidden')) {
                pages.dashboard.loadTasks();
            }
        } catch (error) {
            console.error('Error toggling task:', error);
            ui.showToast('Failed to update task', 'error');
        }
    },
    
    deleteTask: async function(taskId) {
        if (!confirm('Are you sure you want to delete this task?')) {
            return;
        }
        
        try {
            // If it's an auto-task, remember its key so it doesn't regenerate
            // 3-16: the dismissal and the delete happen together, or not at all
            await saveTogether(['tasks', 'settings'], async () => {
            const task = await db.tasks.get(taskId);
            if (task && task.type === 'auto' && task.autoKey) {
                const dismissedSetting = await db.settings.get('dismissed-auto-tasks');
                const dismissed = dismissedSetting ? dismissedSetting.value : [];
                dismissed.push(task.autoKey);
                await db.settings.put({ key: 'dismissed-auto-tasks', value: dismissed });
            }
            await db.tasks.delete(taskId);
            });
            ui.showToast('Task deleted', 'success');
            this.loadTasks();
            
            // Also refresh dashboard if it's visible
            if (!document.getElementById('page-dashboard').classList.contains('hidden')) {
                pages.dashboard.loadTasks();
            }
        } catch (error) {
            console.error('Error deleting task:', error);
            ui.showToast('Failed to delete task', 'error');
        }
    },

    snoozeTask: async function(taskId, newDate) {
        try {
            await db.tasks.update(taskId, {
                dueDate: newDate,
                status: 'snoozed',
                snoozedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
            logAction('task-snooze', 'task', taskId, `Snoozed to ${newDate}`);
            if (typeof driveSync !== 'undefined') driveSync.markDirty();
            ui.showToast(`Task snoozed to ${new Date(newDate).toLocaleDateString()}`, 'info');

            // Refresh whichever surface is visible
            this.loadTasks();
            if (!document.getElementById('page-dashboard').classList.contains('hidden')) {
                pages.dashboard.loadTasks();
            }
        } catch (error) {
            console.error('Error snoozing task:', error);
            ui.showToast('Failed to snooze task', 'error');
        }
    },

    showSnoozeUI: function(taskId, rowElement) {
        // Close any existing snooze UI first
        const existing = document.querySelector('.snooze-ui');
        if (existing) existing.remove();

        // Calculate tomorrow's date for default and min
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        // Calculate next Monday
        const nextMonday = new Date();
        const dayOfWeek = nextMonday.getDay();
        const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
        nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
        const nextMondayStr = nextMonday.toISOString().split('T')[0];

        const snoozeDiv = document.createElement('div');
        snoozeDiv.className = 'snooze-ui';
        snoozeDiv.innerHTML = `
            <input type="date" value="${tomorrowStr}" min="${tomorrowStr}" style="flex: 1;">
            <button style="background: var(--color-info); color: white;" onclick="pages.tasks.snoozeTask(${taskId}, this.parentElement.querySelector('input').value); this.parentElement.remove();">Snooze</button>
            <button style="background: var(--color-background-tertiary); color: var(--color-text-primary);" onclick="this.parentElement.remove();">Cancel</button>
            <button style="background: var(--color-background-tertiary); color: var(--color-text-primary); font-size: var(--font-size-body-small);" onclick="this.parentElement.querySelector('input').value='${tomorrowStr}'; pages.tasks.snoozeTask(${taskId}, '${tomorrowStr}'); this.parentElement.remove();">Tomorrow</button>
            <button style="background: var(--color-background-tertiary); color: var(--color-text-primary); font-size: var(--font-size-body-small);" onclick="pages.tasks.snoozeTask(${taskId}, '${nextMondayStr}'); this.parentElement.remove();">Mon</button>
        `;

        // Insert after the row element
        rowElement.parentNode.insertBefore(snoozeDiv, rowElement.nextSibling);
    }
};
                      
// ----------------------------------------
// PROGRESS PAGE
// ----------------------------------------
pages.progress = {
    selectedClassId: null,

    render: async function() {
        // Load active classes and build filter buttons dynamically
        const classes = (await db.classes.toArray()).filter(c => c.status !== 'archived');
        const container = document.getElementById('progress-class-filters');

        if (classes.length === 0) {
            container.innerHTML = '<p style="color: var(--color-text-tertiary);">No classes found. Add classes in Settings.</p>';
            return;
        }

        container.innerHTML = '';
        classes.forEach((cls, index) => {
            const btn = document.createElement('button');
            btn.className = 'btn btn--secondary progress-year-btn' + (index === 0 ? ' active' : '');
            btn.dataset.classId = cls.id;
            btn.textContent = cls.name;
            btn.style.cssText = index === 0 ? `border-color: ${cls.color}; color: ${cls.color};` : '';
            btn.onclick = () => this.selectClass(cls);
            container.appendChild(btn);
        });

        // Auto-select first class
        if (classes.length > 0) {
            await this.selectClass(classes[0]);
        }
    },

    selectClass: async function(cls) {
        this.selectedClassId = cls.id;

        // Update active button styles
        document.querySelectorAll('.progress-year-btn').forEach(btn => {
            const isActive = parseInt(btn.dataset.classId) === cls.id;
            btn.classList.toggle('active', isActive);
            btn.style.cssText = isActive ? `border-color: ${cls.color}; color: ${cls.color};` : '';
        });

        await this.renderChart(cls);
    },

    renderChart: async function(cls) {
        const container = document.getElementById('progress-chart');

        try {
            // Load all students in this class
            const allStudents = excludeDeleted(await db.students.toArray());
            const students = allStudents
                .filter(s => s.classId === cls.id && (s.status || 'active') === 'active')
                .sort(sortByStudentName);

            // Load all activities for this class
            const allActivities = await db.activities.toArray();
            const classActivities = allActivities.filter(a => a.classId === cls.id);

            // Filter to only started activities
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const activities = classActivities.filter(a => {
                const startParts = a.startDate.split('-');
                const startDate = new Date(startParts[0], startParts[1] - 1, startParts[2]);
                return startDate <= today;
            });

            // Sort by most recent first
            activities.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

            // Load all checkpoints and completions
            const allCheckpoints = await db.checkpoints.toArray();
            const allCompletions = await db.checkpointCompletions.toArray();

            if (students.length === 0 || activities.length === 0) {
                container.innerHTML = '<p style="color: var(--color-text-tertiary); padding: var(--space-2xl); text-align: center;">No data to display. Add students and activities to see progress.</p>';
                return;
            }

            // Build the chart
            let html = '<table style="width: 100%; border-collapse: collapse; min-width: 600px;"><thead><tr>';
            html += '<th style="padding: var(--space-sm); border: 1px solid var(--color-border); background-color: var(--color-background-tertiary); text-align: left; position: sticky; left: 0; z-index: 2;">Student</th>';

            activities.forEach(activity => {
                const abbreviated = this.abbreviateActivityName(activity.name);
                html += `<th style="padding: var(--space-sm); border: 1px solid var(--color-border); background-color: var(--color-background-tertiary); text-align: center; min-width: 100px;" title="${escapeHtml(activity.name)}">${escapeHtml(abbreviated)}</th>`;
            });
            html += '</tr></thead><tbody>';

            students.forEach(student => {
                html += '<tr>';
                html += `<td style="padding: var(--space-sm); border: 1px solid var(--color-border); font-weight: 500; position: sticky; left: 0; background-color: var(--color-background); z-index: 1;">${escapeHtml(displayName(student))}</td>`;

                activities.forEach(activity => {
                    const activityCheckpoints = allCheckpoints.filter(cp => cp.activityId === activity.id);

                    if (activityCheckpoints.length === 0) {
                        html += '<td style="padding: var(--space-sm); border: 1px solid var(--color-border); text-align: center; color: var(--color-text-tertiary);">—</td>';
                        return;
                    }

                    const completedCheckpoints = activityCheckpoints.filter(cp => {
                        return allCompletions.some(comp =>
                            comp.checkpointId === cp.id &&
                            comp.studentId === student.id &&
                            comp.completed
                        );
                    });

                    const isComplete = completedCheckpoints.length === activityCheckpoints.length;

                    if (isComplete) {
                        const completionDates = completedCheckpoints.map(cp => {
                            const comp = allCompletions.find(c =>
                                c.checkpointId === cp.id &&
                                c.studentId === student.id &&
                                c.completed
                            );
                            return comp ? new Date(comp.completedAt) : null;
                        }).filter(d => d);

                        const latestDate = completionDates.length > 0
                            ? new Date(Math.max(...completionDates))
                            : null;

                        const formattedDate = latestDate
                            ? latestDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
                            : '';

                        html += `<td style="padding: var(--space-sm); border: 1px solid var(--color-border); text-align: center; color: var(--color-success);">✅<br><small>${formattedDate}</small></td>`;
                    } else {
                        const ratio = `${completedCheckpoints.length}/${activityCheckpoints.length}`;
                        html += `<td style="padding: var(--space-sm); border: 1px solid var(--color-border); text-align: center; color: var(--color-error);">❌<br><small>${ratio}</small></td>`;
                    }
                });

                html += '</tr>';
            });

            html += '</tbody></table>';
            container.innerHTML = html;

        } catch (error) {
            console.error('Error rendering progress chart:', error);
            container.innerHTML = '<p style="color: var(--color-error);">Failed to load progress data.</p>';
        }
    },

    abbreviateActivityName: function(name) {
        const match = name.match(/^(Activity|Project|Problem)\s+(\d+)\.(\d+)\.(\d+)/i);

        if (match) {
            const typeCode = match[1].toLowerCase() === 'project' ? 'PJ' :
                            match[1].toLowerCase() === 'problem' ? 'PB' : 'A';
            const nums = match[2] + match[3] + match[4];
            return typeCode + nums;
        }

        return name.substring(0, 10);
    }
};
