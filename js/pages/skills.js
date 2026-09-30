// ----------------------------------------
// SKILLS & CERTIFICATIONS PAGE
// ----------------------------------------
pages.skills = {
    currentTab: 'library',
    editingSkillId: null,
    matrixClassFilter: null,

    render: function() {
        this.setTab(this.currentTab);
    },

    setTab: function(tabId, btn) {
        this.currentTab = tabId;
        ['library', 'matrix', 'certs', 'standards'].forEach(t => {
            const el = document.getElementById(`skills-tab-${t}`);
            if (el) el.classList.toggle('hidden', t !== tabId);
        });

        // Update button styles
        if (btn) {
            const tabButtons = btn.parentElement.querySelectorAll('.tab-btn');
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }

        if (tabId === 'library') this.renderLibrary();
        if (tabId === 'matrix') this.renderMatrix();
        if (tabId === 'certs') this.renderCertifications();
        if (tabId === 'standards') this.renderStandards();
    },

    // ---- SKILL LIBRARY TAB ----
    renderLibrary: async function() {
        const container = document.getElementById('skills-library-grid');
        const allSkills = await db.skills.toArray();
        // Hidden (merged-away or retired) skills are listed separately below the grid (P16 C3)
        const skills = allSkills.filter(s => !isSkillHidden(s)).sort((a, b) => {
            if (a.category !== b.category) return (a.category || '').localeCompare(b.category || '');
            return a.name.localeCompare(b.name);
        });
        const allLevels = (await db.skillLevels.toArray()).filter(isLevelLive);

        if (skills.length === 0) {
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic; padding: var(--space-lg);">No skills defined yet. Click "+ Add Skill" to create your first skill.</p>';
            this.renderHiddenSkillLists(container, allSkills);
            return;
        }

        container.innerHTML = '';
        const defaultColors = ['var(--color-error)', 'var(--color-warning)', 'var(--color-info)', '#8b5cf6', '#3b82f6', '#10b981', '#f97316', '#ec4899'];
        const categories = await getSkillCategories();
        const categoryColors = {};
        categories.forEach((cat, i) => {
            categoryColors[cat] = defaultColors[i % defaultColors.length];
        });

        skills.forEach(skill => {
            const levels = allLevels.filter(l => l.skillId === skill.id);
            const counts = { Beginning: 0, Developing: 0, Proficient: 0, Advanced: 0 };
            levels.forEach(l => { if (counts[l.level] !== undefined) counts[l.level]++; });
            const total = levels.length;

            const card = document.createElement('div');
            card.className = 'card';
            card.style.cssText = `cursor: pointer; border-left: 4px solid ${categoryColors[skill.category] || categoryColors.Other};`;
            card.innerHTML = `
                <div class="card__body" style="padding: var(--space-base);">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <h3 style="font-size: var(--font-size-h3);">${escapeHtml(skill.name)}</h3>
                        <span class="badge" style="background: ${categoryColors[skill.category] || categoryColors.Other}; color: white;">${escapeHtml(skill.category)}</span>
                    </div>
                    ${skill.description ? `<p style="font-size: var(--font-size-body-small); color: var(--color-text-secondary); margin-top: var(--space-xs);">${escapeHtml(skill.description)}</p>` : ''}
                    <div style="display: flex; gap: var(--space-sm); margin-top: var(--space-sm); font-size: var(--font-size-body-small);">
                        <span style="color: var(--color-text-tertiary);">${total} rated</span>
                        ${counts.Advanced > 0 ? `<span style="color: #f59e0b;">★ ${counts.Advanced} Advanced</span>` : ''}
                        ${counts.Proficient > 0 ? `<span style="color: var(--color-success);">${counts.Proficient} Proficient</span>` : ''}
                        ${counts.Developing > 0 ? `<span style="color: var(--color-info);">${counts.Developing} Developing</span>` : ''}
                    </div>
                </div>
            `;
            card.onclick = () => this.showEditSkillModal(skill.id);
            container.appendChild(card);
        });
        this.renderHiddenSkillLists(container, allSkills);
    },

    // Retired skills (with Restore) and merged-away skills, folded under the library grid (P16 C3, Q4).
    // Nothing shows until the skills migration has run.
    renderHiddenSkillLists: function(container, allSkills) {
        const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
        const byId = new Map(allSkills.map(s => [s.id, s]));
        const retired = allSkills.filter(s => s.retiredAt && !s.deletedAt).sort(byName);
        const merged = allSkills.filter(s => s.deletedAt && s.mergedInto).sort(byName);
        const box = (title, id, rowsHtml) => {
            const el = document.createElement('details');
            el.id = id;
            el.style.cssText = 'grid-column: 1 / -1; margin-top: var(--space-base); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-sm) var(--space-base);';
            el.innerHTML = `<summary style="cursor: pointer; font-weight: 600;">${escapeHtml(title)}</summary><div style="margin-top: var(--space-sm);">${rowsHtml}</div>`;
            container.appendChild(el);
        };
        if (retired.length > 0) {
            box(`Retired skills (${retired.length})`, 'skills-retired-list', retired.map(s => `
                <div style="display: flex; justify-content: space-between; align-items: center; gap: var(--space-sm); padding: var(--space-xs) 0; border-bottom: 1px solid var(--color-border);">
                    <div><strong>${escapeHtml(s.name)}</strong>${s.retiredNote ? `<br><span style="font-size: var(--font-size-body-small); color: var(--color-text-tertiary);">${escapeHtml(s.retiredNote)}</span>` : ''}</div>
                    <button type="button" class="btn btn--secondary btn--sm" onclick="pages.skills.restoreSkill(${s.id})">Restore</button>
                </div>`).join(''));
        }
        if (merged.length > 0) {
            box(`Merged into Draft 3 skills (${merged.length})`, 'skills-merged-list', merged.map(s => {
                const target = byId.get(s.mergedInto);
                return `<div style="padding: var(--space-xs) 0; border-bottom: 1px solid var(--color-border);">${escapeHtml(s.name)} → ${escapeHtml(target ? target.name : 'skill #' + s.mergedInto)}</div>`;
            }).join(''));
        }
    },

    // Undo a retirement: the skill, and its old ratings and levels, show again (P16 C3)
    restoreSkill: async function(skillId) {
        try {
            const skill = await db.skills.get(skillId);
            if (!skill || !skill.retiredAt || skill.deletedAt) return;
            await db.skills.update(skillId, { retiredAt: null, retiredNote: null, updatedAt: new Date().toISOString() });
            driveSync.markDirty();
            await logAction('restore', 'skill', skillId, `Restored retired skill "${skill.name}"`);
            ui.showToast(`"${skill.name}" restored`, 'success');
            this.renderLibrary();
        } catch (err) {
            console.error('Error restoring skill:', err);
            ui.showToast('Failed to restore the skill', 'error');
        }
    },

    showAddSkillModal: async function() {
        this.editingSkillId = null;
        document.getElementById('skill-modal-title').textContent = 'Add Skill';
        document.getElementById('skill-delete-btn').style.display = 'none';
        document.getElementById('skill-name').value = '';
        document.getElementById('skill-description').value = '';
        await this.populateCategoryDropdown();
        ui.showModal('modal-skill');
    },

    showEditSkillModal: async function(skillId) {
        const skill = await db.skills.get(skillId);
        if (!skill) return;
        this.editingSkillId = skillId;
        document.getElementById('skill-modal-title').textContent = 'Edit Skill';
        document.getElementById('skill-delete-btn').style.display = '';
        document.getElementById('skill-name').value = skill.name;
        document.getElementById('skill-description').value = skill.description || '';
        await this.populateCategoryDropdown(skill.category);
        ui.showModal('modal-skill');
    },

    populateCategoryDropdown: async function(selected = '') {
        const categories = (await getSkillCategories()).slice();
        const select = document.getElementById('skill-category');
        select.innerHTML = '';
        // i111: a skill whose category isn't in the list keeps it (it used to fall to the first
        // option, Safety, on any save; a Professional skill then counted as an Engineering one)
        const unlisted = selected && !categories.includes(selected);
        if (unlisted) categories.unshift(selected);
        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = (unlisted && cat === selected) ? `${cat} (not in the category list)` : cat;
            if (cat === selected) opt.selected = true;
            select.appendChild(opt);
        });
    },

    showCategoryManager: async function() {
        const categories = await getSkillCategories();
        const input = prompt(
            'Edit skill categories (comma-separated):\n\nCurrent categories will be updated everywhere.\nRemoving a category won\'t delete skills already using it.',
            categories.join(', ')
        );
        if (input === null) return; // cancelled

        const newCategories = input.split(',').map(c => c.trim()).filter(c => c);
        if (newCategories.length === 0) {
            ui.showToast('Need at least one category', 'error');
            return;
        }

        await db.settings.put({ key: 'skill-categories', value: newCategories });
        driveSync.markDirty(); ui.showToast('Categories updated', 'success');
        this.renderLibrary();
    },

    hideSkillModal: function() {
        ui.hideModal('modal-skill');
        this.editingSkillId = null;
    },

    saveSkill: async function() {
        const name = document.getElementById('skill-name').value.trim();
        const category = document.getElementById('skill-category').value;
        const description = document.getElementById('skill-description').value.trim();

        if (!name) {
            ui.showToast('Please enter a skill name', 'error');
            return;
        }

        try {
            // i111: no two skills share a name (trimmed, any capitals), retired and merged ones included.
            // An edit that keeps the skill's own name is always allowed.
            const norm = x => String(x || '').trim().toLowerCase();
            const all = await db.skills.toArray();
            const own = this.editingSkillId ? all.find(s => String(s.id) === String(this.editingSkillId)) : null;
            if (!own || norm(own.name) !== norm(name)) {
                const clash = all.find(s => !s.deletedAt && (!own || String(s.id) !== String(own.id)) && norm(s.name) === norm(name));
                if (clash) {
                    ui.showToast(`There is already a skill called "${clash.name}"${clash.retiredAt ? ' (in the Retired or Merged list)' : ''}. Use a different name. Nothing was saved.`, 'error', 8000);
                    return;
                }
            }
            if (this.editingSkillId) {
                await db.skills.update(this.editingSkillId, { name, category, description, updatedAt: new Date().toISOString() });
                driveSync.markDirty(); ui.showToast('Skill updated', 'success');
            } else {
                await db.skills.add({ name, category, description, createdAt: new Date().toISOString() });
                driveSync.markDirty(); ui.showToast('Skill added', 'success');
            }
            this.hideSkillModal();
            this.renderLibrary();
        } catch (err) {
            console.error('Error saving skill:', err);
            ui.showToast('Failed to save skill', 'error');
        }
    },

    deleteSkill: async function() {
        if (!this.editingSkillId) return;
        // A skill with any ratings, levels or activity links can't be deleted (P16 A4, C3): the
        // delete used to leave its ratings and links behind, and it came back from the other device.
        const skillId = this.editingSkillId;
        const [ratings, levels, links] = await Promise.all([
            db.skillObservations.where('skillId').equals(skillId).count(),
            db.skillLevels.where('skillId').equals(skillId).count(),
            db.activitySkills.where('skillId').equals(skillId).count()
        ]);
        if (ratings + levels + links > 0) {
            ui.showToast(`This skill can't be deleted: it has ${ratings} rating(s), ${levels} level(s) and ${links} activity link(s).`, 'error', 8000);
            return;
        }
        if (!confirm('Delete this skill? It has no ratings, levels or activity links.')) return;
        try {
            await db.skills.delete(this.editingSkillId);
            await db.skillLevels.where('skillId').equals(this.editingSkillId).delete();
            ui.showToast('Skill deleted', 'success');
            this.hideSkillModal();
            this.renderLibrary();
        } catch (err) {
            console.error('Error deleting skill:', err);
            ui.showToast('Failed to delete', 'error');
        }
    },

    // ---- STUDENT SKILLS MATRIX TAB ----
    renderMatrix: async function() {
        const container = document.getElementById('skills-matrix');
        const filtersContainer = document.getElementById('skills-class-filters');
        
        const skills = await getVisibleSkills();
        if (skills.length === 0) {
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic; padding: var(--space-lg);">No skills defined yet. Add skills in the Skill Library tab first.</p>';
            filtersContainer.innerHTML = '';
            return;
        }

        const classes = (await db.classes.toArray()).filter(c => c.status !== 'archived');
        const allStudents = excludeDeleted(await db.students.toArray()).filter(s => s.status === 'active');
        const allLevels = (await db.skillLevels.toArray()).filter(isLevelLive);

        // Pre-calculate skill levels from assignment scores for all students
        const allSubmissions = await db.submissions.toArray();
        const calcLevelsCache = new Map(); // studentId -> Map(skillId -> level)

        // Class filter buttons
        filtersContainer.innerHTML = '';
        classes.forEach(cls => {
            const btn = document.createElement('button');
            btn.className = `btn btn--secondary ${this.matrixClassFilter === cls.id ? 'active' : ''}`;
            btn.style.cssText = this.matrixClassFilter === cls.id ? `background: ${cls.color}; color: white; border-color: ${cls.color};` : `border-left: 4px solid ${cls.color};`;
            btn.textContent = cls.name;
            btn.onclick = () => {
                this.matrixClassFilter = this.matrixClassFilter === cls.id ? null : cls.id;
                this.renderMatrix();
            };
            filtersContainer.appendChild(btn);
        });

        // Filter students
        let students = allStudents;
        if (this.matrixClassFilter) {
            students = allStudents.filter(s => s.classId === this.matrixClassFilter);
        }
        students.sort(sortByStudentName);

        if (students.length === 0) {
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic; padding: var(--space-lg);">No students found for this filter.</p>';
            return;
        }

        const levelColors = {
            'Advanced': '#f59e0b',
            'Proficient': 'var(--color-success)',
            'Developing': 'var(--color-info)',
            'Beginning': 'var(--color-error)',
        };

        let html = '<table style="width: 100%; border-collapse: collapse; font-size: var(--font-size-body-small);">';
        html += '<thead><tr><th style="text-align: left; padding: var(--space-sm); border-bottom: 2px solid var(--color-border); position: sticky; left: 0; background: var(--color-background); z-index: 1;">Student</th>';
        skills.forEach(skill => {
            html += `<th style="text-align: center; padding: var(--space-sm); border-bottom: 2px solid var(--color-border); min-width: 90px;">${escapeHtml(skill.name)}</th>`;
        });
        html += '</tr></thead><tbody>';

        students.forEach(student => {
            html += `<tr><td style="padding: var(--space-sm); border-bottom: 1px solid var(--color-border); font-weight: 500; position: sticky; left: 0; background: var(--color-background); z-index: 1;">${escapeHtml(displayName(student))}</td>`;
            skills.forEach(skill => {
                const manualLevel = allLevels.find(l => l.studentId === student.id && l.skillId === skill.id);
                // Check for calculated level from assignment skill scores
                let calcLevel = '';
                const studentSubs = allSubmissions.filter(s => s.studentId === student.id && s.skillScores && s.skillScores[String(skill.id)]);
                if (studentSubs.length > 0) {
                    const levelValues = { 'Beginning': 1, 'Developing': 2, 'Proficient': 3, 'Advanced': 4 };
                    const valueLabels = { 1: 'Beginning', 2: 'Developing', 3: 'Proficient', 4: 'Advanced' };
                    studentSubs.sort((a, b) => (a.updatedAt || a.submittedAt || '').localeCompare(b.updatedAt || b.submittedAt || ''));
                    let totalWeight = 0, weightedSum = 0;
                    studentSubs.forEach((sub, idx) => {
                        const w = idx + 1;
                        const v = levelValues[sub.skillScores[String(skill.id)]];
                        if (v) { totalWeight += w; weightedSum += v * w; }
                    });
                    if (totalWeight > 0) {
                        const avg = weightedSum / totalWeight;
                        calcLevel = valueLabels[Math.max(1, Math.min(4, Math.round(avg)))];
                    }
                }
                const currentLevel = calcLevel || manualLevel?.level || '';
                const color = levelColors[currentLevel] || 'var(--color-border)';

                html += `<td style="text-align: center; padding: var(--space-xs); border-bottom: 1px solid var(--color-border);">
                    <select onchange="pages.skills.saveSkillLevel(${student.id}, ${skill.id}, this.value)"
                        style="padding: 2px 4px; border: 2px solid ${color}; border-radius: var(--radius-sm); font-size: var(--font-size-caption); background: var(--color-background); cursor: pointer; width: 85px; color: ${color}; font-weight: 600;">
                        <option value="" ${!currentLevel ? 'selected' : ''} style="color: var(--color-text-primary);">—</option>
                        <option value="Beginning" ${currentLevel === 'Beginning' ? 'selected' : ''} style="color: var(--color-text-primary);">Beginning</option>
                        <option value="Developing" ${currentLevel === 'Developing' ? 'selected' : ''} style="color: var(--color-text-primary);">Developing</option>
                        <option value="Proficient" ${currentLevel === 'Proficient' ? 'selected' : ''} style="color: var(--color-text-primary);">Proficient</option>
                        <option value="Advanced" ${currentLevel === 'Advanced' ? 'selected' : ''} style="color: var(--color-text-primary);">Advanced</option>
                    </select>
                </td>`;
            });
            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    },

    saveSkillLevel: async function(studentId, skillId, level) {
        try {
            // A merged-away or retired skill can't be given a level (P16 C3)
            if (isSkillHidden(await db.skills.get(skillId))) {
                ui.showToast("That skill is retired or merged, so it can't be given a level.", 'error');
                return;
            }
            const existing = await db.skillLevels
                .where('studentId').equals(studentId)
                .filter(l => l.skillId === skillId && isLevelLive(l))
                .first();

            if (!level) {
                if (existing) await db.skillLevels.delete(existing.id);
            } else if (existing) {
                await db.skillLevels.update(existing.id, { level, updatedAt: new Date().toISOString() });
            } else {
                await db.skillLevels.add({ studentId, skillId, level, createdAt: new Date().toISOString() });
            }
        } catch (err) {
            console.error('Error saving skill level:', err);
            ui.showToast('Failed to save', 'error');
        }
    },

    // ---- BULK UPDATE ----
    showBulkUpdateModal: async function() {
        const skillSelect = document.getElementById('bulk-skill-select');
        skillSelect.innerHTML = '';
        const skills = await getVisibleSkills();
        skills.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            skillSelect.appendChild(opt);
        });

        const targetSelect = document.getElementById('bulk-skill-target');
        targetSelect.innerHTML = '<option value="">Select...</option>';
        
        const classes = (await db.classes.toArray()).filter(c => c.status !== 'archived');
        classes.forEach(cls => {
            const opt = document.createElement('option');
            opt.value = `class-${cls.id}`;
            opt.textContent = `All ${cls.name} students`;
            targetSelect.appendChild(opt);
        });

        const teams = excludeDeleted(await db.teams.toArray());
        if (teams.length > 0) {
            const group = document.createElement('optgroup');
            group.label = 'Teams';
            teams.forEach(t => {
                const opt = document.createElement('option');
                opt.value = `team-${t.id}`;
                opt.textContent = t.name;
                group.appendChild(opt);
            });
            targetSelect.appendChild(group);
        }

        document.getElementById('bulk-skill-students').innerHTML = '';
        ui.showModal('modal-bulk-skill');
    },

    loadBulkTargetStudents: async function() {
        const container = document.getElementById('bulk-skill-students');
        const target = document.getElementById('bulk-skill-target').value;
        if (!target) { container.innerHTML = ''; return; }

        let students = [];
        const allStudents = excludeDeleted(await db.students.toArray()).filter(s => s.status === 'active');

        if (target.startsWith('class-')) {
            const classId = parseInt(target.split('-')[1]);
            students = allStudents.filter(s => s.classId === classId);
        } else if (target.startsWith('team-')) {
            const teamId = parseInt(target.split('-')[1]);
            const members = await db.teamMembers.where('teamId').equals(teamId).toArray();
            const memberIds = new Set(members.map(m => m.studentId));
            students = allStudents.filter(s => memberIds.has(s.id));
        }

        students.sort(sortByStudentName);
        container.innerHTML = students.map(s =>
            `<div style="padding: 2px 0;"><strong>${escapeHtml(displayName(s))}</strong></div>`
        ).join('');
        container.innerHTML += `<p style="margin-top: var(--space-sm); font-size: var(--font-size-body-small); color: var(--color-text-tertiary);">${students.length} student(s) will be updated</p>`;
    },

    saveBulkUpdate: async function() {
        const skillId = parseInt(document.getElementById('bulk-skill-select').value);
        const level = document.getElementById('bulk-skill-level').value;
        const target = document.getElementById('bulk-skill-target').value;

        if (!skillId || !level || !target) {
            ui.showToast('Please fill all fields', 'error');
            return;
        }

        try {
            const allStudents = excludeDeleted(await db.students.toArray()).filter(s => s.status === 'active');
            let students = [];

            if (target.startsWith('class-')) {
                const classId = parseInt(target.split('-')[1]);
                students = allStudents.filter(s => s.classId === classId);
            } else if (target.startsWith('team-')) {
                const teamId = parseInt(target.split('-')[1]);
                const members = await db.teamMembers.where('teamId').equals(teamId).toArray();
                const memberIds = new Set(members.map(m => m.studentId));
                students = allStudents.filter(s => memberIds.has(s.id));
            }

            let updated = 0;
            for (const student of students) {
                await this.saveSkillLevel(student.id, skillId, level);
                updated++;
            }

            ui.showToast(`Updated ${updated} student(s) to "${level}"`, 'success');
            ui.hideModal('modal-bulk-skill');
            this.renderMatrix();
        } catch (err) {
            console.error('Error in bulk update:', err);
            ui.showToast('Bulk update failed', 'error');
        }
    },

    // ---- CERTIFICATIONS TAB ----
    renderCertifications: async function() {
        const container = document.getElementById('certs-list');
        const items = excludeDeleted(await db.inventory.toArray())
            .filter(i => i.category === 'tools' || i.category === 'electronics' || i.category === 'safety');
        const allCerts = await db.certifications.toArray();
        const allStudents = excludeDeleted(await db.students.toArray());

        if (items.length === 0) {
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic; padding: var(--space-lg);">No tools or equipment found in inventory. Add items in the Inventory page first (categories: Tools, Electronics, or Safety Equipment).</p>';
            return;
        }

        container.innerHTML = '';
        items.forEach(item => {
            const certs = allCerts.filter(c => c.toolId === item.id);
            const certStudents = certs.map(c => {
                const student = allStudents.find(s => s.id === c.studentId);
                return student ? { ...c, studentName: student.name } : null;
            }).filter(Boolean);

            const card = document.createElement('div');
            card.className = 'card';
            card.style.cssText = 'padding: var(--space-base);';
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: var(--space-sm);">
                    <h3 style="font-size: var(--font-size-h3);">${escapeHtml(item.name)}</h3>
                    <span class="badge badge--${certs.length > 0 ? 'success' : 'warning'}">${certs.length} certified</span>
                </div>
                ${certStudents.length > 0 ? `
                    <div style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">
                        ${certStudents.map(c => `
                            <div style="display: flex; justify-content: space-between; padding: 2px 0; border-bottom: 1px solid var(--color-border);">
                                <span>${escapeHtml(c.studentName)}</span>
                                <span style="color: var(--color-text-tertiary);">${new Date(c.certifiedAt).toLocaleDateString()}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : '<p style="font-size: var(--font-size-body-small); color: var(--color-text-tertiary);">No students certified yet</p>'}
            `;
            container.appendChild(card);
        });
    },

    showCertifyModal: async function() {
        // Populate tool dropdown
        const toolSelect = document.getElementById('certify-tool');
        toolSelect.innerHTML = '';
        const items = excludeDeleted(await db.inventory.toArray())
            .filter(i => i.category === 'tools' || i.category === 'electronics' || i.category === 'safety');
        items.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = item.name;
            toolSelect.appendChild(opt);
        });

        // Class filter buttons
        const filterContainer = document.getElementById('certify-class-filter');
        filterContainer.innerHTML = '';
        const classes = (await db.classes.toArray()).filter(c => c.status !== 'archived');
        classes.forEach(cls => {
            const btn = document.createElement('button');
            btn.className = 'btn btn--secondary';
            btn.style.cssText = `font-size: var(--font-size-body-small); padding: var(--space-xs) var(--space-sm); border-left: 3px solid ${cls.color};`;
            btn.textContent = cls.name;
            btn.onclick = () => this.loadCertifyStudents(cls.id);
            filterContainer.appendChild(btn);
        });

        document.getElementById('certify-notes').value = '';
        document.getElementById('certify-students').innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic;">Select a class to load students</p>';
        ui.showModal('modal-certify');
    },

    loadCertifyStudents: async function(classId) {
        const container = document.getElementById('certify-students');
        const students = excludeDeleted(await db.students.toArray())
            .filter(s => s.classId === classId && s.status === 'active')
            .sort(sortByStudentName);

        const toolId = parseInt(document.getElementById('certify-tool').value);
        const existingCerts = await db.certifications.filter(c => c.toolId === toolId).toArray();
        const certifiedIds = new Set(existingCerts.map(c => c.studentId));

        container.innerHTML = '';
        students.forEach(s => {
            const alreadyCertified = certifiedIds.has(s.id);
            const div = document.createElement('div');
            div.style.cssText = 'display: flex; align-items: center; gap: var(--space-sm); padding: 4px 0;';
            div.innerHTML = `
                <input type="checkbox" class="certify-student-cb" value="${s.id}" ${alreadyCertified ? 'checked disabled' : ''} style="min-width: 20px;">
                <span ${alreadyCertified ? 'style="color: var(--color-text-tertiary);"' : ''}>${escapeHtml(displayName(s))} ${alreadyCertified ? '<em>(already certified)</em>' : ''}</span>
            `;
            container.appendChild(div);
        });
    },

    saveCertifications: async function() {
        const toolId = parseInt(document.getElementById('certify-tool').value);
        const notes = document.getElementById('certify-notes').value.trim();
        const checkboxes = document.querySelectorAll('.certify-student-cb:checked:not(:disabled)');

        if (checkboxes.length === 0) {
            ui.showToast('No new students selected', 'error');
            return;
        }

        try {
            let count = 0;
            for (const cb of checkboxes) {
                await db.certifications.add({
                    studentId: parseInt(cb.value),
                    toolId: toolId,
                    notes: notes,
                    certifiedAt: new Date().toISOString()
                });
                count++;
            }

            ui.showToast(`${count} student(s) certified!`, 'success');
            ui.hideModal('modal-certify');
            this.renderCertifications();
        } catch (err) {
            console.error('Error saving certifications:', err);
            ui.showToast('Failed to save certifications', 'error');
        }
    },

    // ---- STANDARDS TAB ----
    editingStandardId: null,

    renderStandards: async function() {
        const container = document.getElementById('standards-list');
        const standards = await db.standards.toArray();
        const allLinks = await db.activityStandards.toArray();
        const allActivities = await db.activities.toArray();

        if (standards.length === 0) {
            container.innerHTML = '<p style="color: var(--color-text-tertiary); font-style: italic; padding: var(--space-lg);">No standards defined yet. Click "+ Add Standard" to create your first standard.</p>';
            return;
        }

        const categoryColors = { 'NGSS': 'var(--color-info)', 'State': '#8b5cf6', 'Custom': 'var(--color-warning)' };

        container.innerHTML = '';
        standards.forEach(standard => {
            const links = allLinks.filter(l => l.standardId === standard.id);
            const linkedActivities = links.map(l => allActivities.find(a => a.id === l.activityId)).filter(Boolean);

            const card = document.createElement('div');
            card.className = 'card';
            card.style.cssText = `cursor: pointer; border-left: 4px solid ${categoryColors[standard.category] || 'var(--color-border)'};`;
            card.innerHTML = `
                <div class="card__body" style="padding: var(--space-base);">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div>
                            <strong style="font-size: var(--font-size-body-small); color: var(--color-text-secondary);">${escapeHtml(standard.code)}</strong>
                            <h3 style="font-size: var(--font-size-h3); margin-top: 2px;">${escapeHtml(standard.name)}</h3>
                        </div>
                        <span class="badge" style="background: ${categoryColors[standard.category] || '#888'}; color: white;">${escapeHtml(standard.category)}</span>
                    </div>
                    ${standard.description ? `<p style="font-size: var(--font-size-body-small); color: var(--color-text-secondary); margin-top: var(--space-xs);">${escapeHtml(standard.description).substring(0, 120)}${standard.description.length > 120 ? '...' : ''}</p>` : ''}
                    <div style="margin-top: var(--space-sm); font-size: var(--font-size-body-small);">
                        ${linkedActivities.length > 0 
                            ? `<span style="color: var(--color-text-secondary);">Linked to: ${linkedActivities.map(a => escapeHtml(a.name)).join(', ')}</span>`
                            : '<span style="color: var(--color-text-tertiary); font-style: italic;">No assignments linked</span>'}
                    </div>
                </div>
            `;
            card.onclick = () => this.showEditStandardModal(standard.id);
            container.appendChild(card);
        });
    },

    showAddStandardModal: function() {
        this.editingStandardId = null;
        document.getElementById('standard-modal-title').textContent = 'Add Standard';
        document.getElementById('standard-delete-btn').style.display = 'none';
        document.getElementById('standard-code').value = '';
        document.getElementById('standard-name').value = '';
        document.getElementById('standard-category').value = 'NGSS';
        document.getElementById('standard-description').value = '';
        ui.showModal('modal-standard');
    },

    showEditStandardModal: async function(standardId) {
        const standard = await db.standards.get(standardId);
        if (!standard) return;
        this.editingStandardId = standardId;
        document.getElementById('standard-modal-title').textContent = 'Edit Standard';
        document.getElementById('standard-delete-btn').style.display = '';
        document.getElementById('standard-code').value = standard.code || '';
        document.getElementById('standard-name').value = standard.name;
        document.getElementById('standard-category').value = standard.category || 'Custom';
        document.getElementById('standard-description').value = standard.description || '';
        ui.showModal('modal-standard');
    },

    hideStandardModal: function() {
        ui.hideModal('modal-standard');
        this.editingStandardId = null;
    },

    saveStandard: async function() {
        const code = document.getElementById('standard-code').value.trim();
        const name = document.getElementById('standard-name').value.trim();
        const category = document.getElementById('standard-category').value;
        const description = document.getElementById('standard-description').value.trim();

        if (!code || !name) {
            ui.showToast('Please enter a code and name', 'error');
            return;
        }

        try {
            if (this.editingStandardId) {
                await db.standards.update(this.editingStandardId, { code, name, category, description, updatedAt: new Date().toISOString() });
                driveSync.markDirty(); ui.showToast('Standard updated', 'success');
            } else {
                await db.standards.add({ code, name, category, description, createdAt: new Date().toISOString() });
                driveSync.markDirty(); ui.showToast('Standard added', 'success');
            }
            this.hideStandardModal();
            this.renderStandards();
        } catch (err) {
            console.error('Error saving standard:', err);
            ui.showToast('Failed to save standard', 'error');
        }
    },

    deleteStandard: async function() {
        if (!this.editingStandardId) return;
        if (!confirm('Delete this standard? Links to assignments will also be removed.')) return;
        try {
            await db.standards.delete(this.editingStandardId);
            await db.activityStandards.where('standardId').equals(this.editingStandardId).delete();
            ui.showToast('Standard deleted', 'success');
            this.hideStandardModal();
            this.renderStandards();
        } catch (err) {
            console.error('Error deleting standard:', err);
            ui.showToast('Failed to delete', 'error');
        }
    }
};
