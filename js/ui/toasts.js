// ============================================
// UI UTILITIES
// ============================================

const ui = {
    showToast: function(message, type = 'info', duration = null) {
        if (duration === null) duration = (type === 'error') ? 5000 : 3000;
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.textContent = message;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 300ms';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    showUndoToast: function(message, undoCallback, duration = 8000) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast toast--warning';
        toast.style.display = 'flex';
        toast.style.alignItems = 'center';
        toast.style.justifyContent = 'space-between';
        toast.style.gap = 'var(--space-base)';

        const msgSpan = document.createElement('span');
        msgSpan.textContent = message;

        const undoBtn = document.createElement('button');
        undoBtn.textContent = 'Undo';
        undoBtn.style.cssText = 'background: none; border: 2px solid #f59e0b; color: #f59e0b; padding: 4px 12px; border-radius: var(--radius-sm); font-weight: 600; cursor: pointer; white-space: nowrap; font-size: var(--font-size-body-small);';

        let dismissed = false;

        const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 300ms';
            setTimeout(() => toast.remove(), 300);
        };

        undoBtn.addEventListener('click', async () => {
            if (dismissed) return;
            dismissed = true;
            try {
                await undoCallback();
                toast.remove();
                ui.showToast('↩️ Action undone', 'success');
            } catch (err) {
                console.error('Undo failed:', err);
                ui.showToast('Failed to undo — check Deleted Items', 'error');
                toast.remove();
            }
        });

        toast.appendChild(msgSpan);
        toast.appendChild(undoBtn);
        container.appendChild(toast);

        // Auto-dismiss after duration
        setTimeout(dismiss, duration);
    },
    
    showModal: function(modalId) {
        const modal = document.getElementById(modalId);
        modal._previousFocus = document.activeElement;
        modal.classList.remove('hidden');

        // Move focus to first focusable element inside the modal
        const focusable = modal.querySelectorAll(
            'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
            setTimeout(() => focusable[0].focus(), 50);
        }
    },

    hideModal: function(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.add('hidden');

        // Return focus to the element that triggered the modal
        if (modal._previousFocus) {
            modal._previousFocus.focus();
            modal._previousFocus = null;
        }
    },
    
    formatDate: function(date) {
        if (!date) return '';
        const d = new Date(date);
        return d.toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
    }
};
