// ============================================
// STUDENT HUB SYNC: one payload builder (Master Plan 5-02, first half; her request, 1 Oct)
// Used by Full Edit's 📤 Sync to Student Hub, the 📤 Sync to Hub button on each assignment
// card, and End Class. The payload is what Full Edit and End Class sent before, with one
// agreed change (META, 1 Oct): resourceLinks also carries the Classroom materials' links, so
// the widget's 🔗 Links section shows every link. With no Classroom materials, it's unchanged.
// ============================================

const hubSync = {
    // A link's identity for de-duplication: a YouTube video or a Drive file by its id, else the URL
    linkKey: function(url) {
        const s = String(url || '').trim();
        if (!s) return '';
        const yt = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
        if (yt) return 'yt:' + yt[1];
        const drive = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([A-Za-z0-9_-]+)/);
        if (drive) return 'drive:' + drive[1];
        return s;
    },

    // The web address of one Classroom material (link, Drive file or YouTube video)
    materialUrl: function(m) {
        if (!m) return '';
        if (m.type === 'driveFile' && m.driveFileId) return 'https://drive.google.com/file/d/' + m.driveFileId + '/view';
        if (m.type === 'youtubeVideo' && m.youtubeId) return 'https://www.youtube.com/watch?v=' + m.youtubeId;
        return String(m.url || '').trim();
    },

    // The links the widget shows: resourceLinks as stored, then each Classroom material's link
    // that isn't already there. With no Classroom materials this is exactly what was sent before.
    widgetLinks: function(activity) {
        const materials = Array.isArray(activity.materials) ? activity.materials : [];
        if (materials.length === 0) return activity.resourceLinks || [];
        const out = (Array.isArray(activity.resourceLinks) ? activity.resourceLinks : []).slice();
        const seen = new Set(out.map(l => this.linkKey(l && l.url)).filter(Boolean));
        for (const m of materials) {
            const url = this.materialUrl(m);
            const key = this.linkKey(url);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push({ url, title: (m && m.title) || url });
        }
        return out;
    },

    // Classroom materials for a new assignment: the Site page, the Classroom materials list (each
    // URL once, as before), then the resource links that aren't already there (as plain links).
    classroomMaterials: function(sitePageUrl, name, materials, resourceLinks) {
        const out = [];
        if (sitePageUrl) {
            out.push({ type: 'link', url: sitePageUrl, title: (name || 'Assignment') + ' — Assignment Guide' });
        }
        for (const m of (materials || [])) {
            if (m && m.url && out.some(x => x.url === m.url)) continue;
            out.push(m);
        }
        const seen = new Set(out.map(x => this.linkKey(this.materialUrl(x))).filter(Boolean));
        for (const l of (resourceLinks || [])) {
            const url = String((l && l.url) || '').trim();
            if (!/^https?:\/\//i.test(url)) continue;
            const key = this.linkKey(url);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ type: 'link', url, title: (l && l.title) || url });
        }
        return out;
    },

    // Classroom refuses a new assignment with more than 20 attachments (CourseWork allows at most
    // 20 material items), so a create sends the first 20: the Site page and the Classroom materials
    // come first, then the resource links. The rest stay in the widget's 🔗 Links. ↑ Update is not
    // capped: it attaches nothing, and the webhook (P29f) lists the missing links in the description.
    MAX_CREATE_MATERIALS: 20,
    forCreate: function(materials) {
        const list = Array.isArray(materials) ? materials : [];
        return { materials: list.slice(0, this.MAX_CREATE_MATERIALS), left: Math.max(0, list.length - this.MAX_CREATE_MATERIALS) };
    },
    leftNote: function(left) {
        return left > 0 ? ' · ' + left + ' link' + (left === 1 ? '' : 's') + ' not attached (Classroom allows 20; students see them in 🔗 Links)' : '';
    },

    // The sync_to_hub_sheet payload for one activity (moved unchanged from Full Edit's syncToHub).
    // opts.classroomDetails: Full Edit's link ends in /details; End Class's never did.
    buildPayload: async function(activity, token, opts) {
        const activityId = activity.id;
        opts = opts || {};

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
                    classroomUrl = 'https://classroom.google.com/c/' + courseId + '/a/' + cwId + (opts.classroomDetails ? '/details' : '');
                }
            }
        }

        // Assemble payload
        return {
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
                resourceLinks: this.widgetLinks(activity),
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
    },

    // The card's 📤 Sync to Hub: the same sync as Full Edit's button, for a saved assignment
    syncFromCard: async function(activityId, btn) {
        const webhook = localStorage.getItem('webhook_wildcat');
        if (!webhook) { ui.showToast('Webhook not configured', 'error'); return; }
        if (this._busy) return;
        this._busy = true;
        const label = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }
        try {
            const activity = await db.activities.get(activityId);
            if (!activity) { ui.showToast('Activity not found', 'error'); return; }
            const token = localStorage.getItem('webhook_token') || '';
            const payload = await this.buildPayload(activity, token, { classroomDetails: true });
            const response = await webhookFetch(webhook, { method: 'POST', body: JSON.stringify(payload) });
            const result = await response.json();
            if (result.status !== 'success') throw new Error(result.message || 'Sync failed');
            const now = new Date().toISOString();
            await db.activities.update(activityId, { lastHubSync: now });
            ui.showToast('📤 Synced to Student Hub', 'success');
            logAction('hub-sync', 'activity', activityId, 'Synced to Student Hub');
            if (typeof driveSync !== 'undefined') driveSync.markDirty();
            const line = document.getElementById('hub-sync-line-' + activityId);
            if (line) line.textContent = 'Hub: synced ' + new Date(now).toLocaleString();
        } catch (err) {
            console.error('Hub sync error:', err);
            ui.showToast('Sync failed: ' + err.message, 'error');
        } finally {
            this._busy = false;
            if (btn) { btn.disabled = false; btn.textContent = label; }
        }
    }
};
