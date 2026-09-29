// ============================================
// ROUTER / PAGE NAVIGATION
// ============================================

const router = {
    navigate: function(page, id) {
        // 2-05 (FF12): unsaved attendance marks ask before they're thrown away
        if (typeof pages !== 'undefined' && pages.attendance && pages.attendance.hasUnsavedChanges()) {
            if (!pages.attendance.confirmDiscard()) return;
            pages.attendance.pendingChanges = {};
        }

        // Detail pages take the id of the record to show
        if (id !== undefined && id !== null) {
            if (page === 'student-detail') state.selectedStudent = id;
            if (page === 'team-detail') state.selectedTeam = id;
        }

        // Apply any pending Drive sync if app is now idle (Sprint 8)
        driveSync.applyPendingIfIdle();

        // Hide all pages
        document.querySelectorAll('.page').forEach(p => {
            p.classList.add('hidden');
        });
        
        // Show selected page
        const pageElement = document.getElementById(`page-${page}`);
        if (pageElement) {
            pageElement.classList.remove('hidden');
        }
        
        // Update active nav item
        document.querySelectorAll('.sidebar__nav-item').forEach(item => {
            item.classList.remove('sidebar__nav-item--active');
        });
        // Map detail pages to their parent sidebar item
        const sidebarPage = {
            'student-detail': 'students',
            'team-detail': 'teams',
            'activity-detail': 'activities',
            'activity-edit': 'activities',
        }[page] || page;
        const activeNavItem = document.querySelector(`[data-page="${sidebarPage}"]`)?.parentElement;
        if (activeNavItem) {
            activeNavItem.classList.add('sidebar__nav-item--active');
        }
        
        // Render page content
        this.renderPage(page);
    },
    
    renderPage: function(page) {
    // Scroll to top on navigation
    window.scrollTo(0, 0);

    // Call appropriate render function based on page
    switch(page) {
        case 'dashboard':        pages.dashboard.render(); pages.dashboard.initPullToRefresh(); break;
        case 'students':         pages.students.render(); break;
        case 'student-detail':   pages.studentDetail.render(state.selectedStudent); break;
        case 'attendance':       pages.attendance.init(); break;
        case 'teams':            pages.teams.render(); break;
        case 'team-detail':      pages.teamDetail.render(state.selectedTeam); break;
        case 'activities':       pages.activities.render(); break;
        case 'activity-detail':  pages.activityDetail.render(state.selectedActivity); break;
        case 'activity-edit':    pages.activityEdit.render(state.editingActivityId); break;
        case 'checkpoint':       pages.checkpoint.render(); break;
        case 'inventory':        pages.inventory.render(); break;
        case 'inventory-detail': pages.inventory.render(); break;
        case 'calendar':         pages.calendar.render(); break;
        case 'tasks':            pages.tasks.render(); break;
        case 'progress':         pages.progress.render(); break;
        case 'skills':           pages.skills.render(); break;
        case 'settings':         pages.settings.render(); break;
    }
},

handlePeriodChange: function() {
    const selectedPeriod = document.getElementById('period-select').value;
    state.setPeriod(selectedPeriod);
    
    const currentPage = document.querySelector('.page:not(.hidden)')?.id;
    
    if (currentPage === 'page-activities') {
        pages.activities.render();
    } else if (currentPage === 'page-teams') {
        pages.teams.render();
    } else if (currentPage === 'page-students') {
        pages.students.render();
    }
},
};
