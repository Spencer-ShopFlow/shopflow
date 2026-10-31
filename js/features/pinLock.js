// ============================================
        // PIN LOCK SYSTEM
        // ============================================
        const pinLock = {
            INACTIVITY_MINUTES: 15,
            _inactivityTimer: null,

            // Hash a string using SHA-256 via WebCrypto
            async hash(text) {
                const input = text.toLowerCase().trim();

                // Use Web Crypto if available (HTTPS), otherwise use a simple hash
                if (window.crypto && window.crypto.subtle) {
                    try {
                        const encoder = new TextEncoder();
                        const data = encoder.encode(input);
                        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                        const hashArray = Array.from(new Uint8Array(hashBuffer));
                        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                    } catch (e) {
                        console.warn('PIN hash: crypto.subtle failed, using fallback hash. This PIN may not match across contexts.', e);
                        // Fall through to simple hash
                    }
                }

                // Simple hash fallback for HTTP contexts
                let hash = 0;
                for (let i = 0; i < input.length; i++) {
                    const char = input.charCodeAt(i);
                    hash = ((hash << 5) - hash) + char;
                    hash = hash & hash; // Convert to 32-bit integer
                }
                return 'simple-' + Math.abs(hash).toString(16).padStart(8, '0');
            },

            // Check if a PIN has been set
            isConfigured() {
                return !!localStorage.getItem('pin-hash');
            },

            // Show the lock screen with a specific panel
            showPanel(panel) {
                const screen = document.getElementById('pin-lock-screen');
                screen.style.display = 'flex';
                document.getElementById('app').style.display = 'none';
                // 1-16 (s390): until now only the PIN screen could show (index.html, html.pin-pending)
                document.documentElement.classList.remove('pin-pending');

                // Hide all panels
                ['unlock', 'setup', 'forgot', 'reset'].forEach(p => {
                    const el = document.getElementById(`pin-panel-${p}`);
                    if (el) el.style.display = 'none';
                });

                // Show requested panel
                const target = document.getElementById(`pin-panel-${panel}`);
                if (target) target.style.display = 'block';

                // Clear inputs and errors for the shown panel
                const inputs = target.querySelectorAll('input');
                inputs.forEach(i => i.value = '');
                const err = target.querySelector('[id$="-error"], [id$="-msg"]');
                if (err) err.textContent = '';

                // Focus first input
                const first = target.querySelector('input');
                if (first) setTimeout(() => first.focus(), 100);
            },

            // Unlock the app
            unlock() {
                document.getElementById('pin-lock-screen').style.display = 'none';
                document.getElementById('app').style.display = '';
                document.documentElement.classList.remove('pin-pending');
                this.resetInactivityTimer();
            },

            // Check on app load — show setup or lock screen
            async init() {
                if (!this.isConfigured()) {
                    this.showPanel('setup');
                } else {
                    this.showPanel('unlock');
                }
                this.startInactivityWatcher();
            },

            // Attempt to unlock with entered PIN
            async attemptUnlock() {
                const input = document.getElementById('pin-input').value;
                const errorEl = document.getElementById('pin-error-msg');

                if (input.length !== 4) {
                    errorEl.textContent = 'PIN must be 4 digits.';
                    return;
                }

                const inputHash = await this.hash(input);
                const storedHash = localStorage.getItem('pin-hash');

                if (inputHash === storedHash) {
                    errorEl.textContent = '';
                    this.unlock();
                } else {
                    errorEl.textContent = 'Incorrect PIN. Try again.';
                    document.getElementById('pin-input').value = '';
                    document.getElementById('pin-input').focus();
                }
            },

            // Save PIN for the first time
            async saveNewPin() {
                const pin = document.getElementById('pin-setup-pin').value;
                const confirmPin = document.getElementById('pin-setup-confirm').value;
                const recovery = document.getElementById('pin-setup-recovery').value.trim();
                const errorEl = document.getElementById('pin-setup-error');

                if (!/^\d{4}$/.test(pin)) {
                    errorEl.textContent = 'PIN must be exactly 4 digits.';
                    return;
                }
                if (pin !== confirmPin) {
                    errorEl.textContent = 'PINs do not match.';
                    return;
                }
                if (recovery.length < 3) {
                    errorEl.textContent = 'Recovery phrase must be at least 3 characters.';
                    return;
                }

                localStorage.setItem('pin-hash', await this.hash(pin));
                localStorage.setItem('pin-recovery-hash', await this.hash(recovery));

                errorEl.textContent = '';
                this.unlock();
            },

            // Verify recovery phrase on forgot PIN screen
            async verifyRecovery() {
                const input = document.getElementById('pin-recovery-input').value;
                const errorEl = document.getElementById('pin-recovery-error');
                const inputHash = await this.hash(input);
                const storedHash = localStorage.getItem('pin-recovery-hash');

                if (inputHash === storedHash) {
                    errorEl.textContent = '';
                    this.showPanel('reset');
                } else {
                    errorEl.textContent = 'Recovery phrase incorrect. Try again.';
                    document.getElementById('pin-recovery-input').value = '';
                }
            },

            // Save reset PIN after recovery
            async saveResetPin() {
                const newPin = document.getElementById('pin-reset-new').value;
                const confirmPin = document.getElementById('pin-reset-confirm').value;
                const recovery = document.getElementById('pin-reset-recovery').value.trim();
                const errorEl = document.getElementById('pin-reset-error');

                if (!/^\d{4}$/.test(newPin)) {
                    errorEl.textContent = 'PIN must be exactly 4 digits.';
                    return;
                }
                if (newPin !== confirmPin) {
                    errorEl.textContent = 'PINs do not match.';
                    return;
                }
                if (recovery.length < 3) {
                    errorEl.textContent = 'Recovery phrase must be at least 3 characters.';
                    return;
                }

                localStorage.setItem('pin-hash', await this.hash(newPin));
                localStorage.setItem('pin-recovery-hash', await this.hash(recovery));

                errorEl.textContent = '';
                ui.showToast('PIN updated successfully!', 'success');
                this.unlock();
            },

            // Change PIN from Settings
            async changePin() {
                const current = document.getElementById('settings-pin-current').value;
                const newPin = document.getElementById('settings-pin-new').value;
                const confirmPin = document.getElementById('settings-pin-confirm').value;
                const recovery = document.getElementById('settings-pin-recovery').value.trim();
                const errorEl = document.getElementById('settings-pin-error');

                const currentHash = await this.hash(current);
                const storedHash = localStorage.getItem('pin-hash');

                if (currentHash !== storedHash) {
                    errorEl.textContent = 'Current PIN is incorrect.';
                    return;
                }
                if (!/^\d{4}$/.test(newPin)) {
                    errorEl.textContent = 'New PIN must be exactly 4 digits.';
                    return;
                }
                if (newPin !== confirmPin) {
                    errorEl.textContent = 'New PINs do not match.';
                    return;
                }
                if (recovery.length < 3) {
                    errorEl.textContent = 'Recovery phrase must be at least 3 characters.';
                    return;
                }

                localStorage.setItem('pin-hash', await this.hash(newPin));
                localStorage.setItem('pin-recovery-hash', await this.hash(recovery));

                // Clear inputs
                ['settings-pin-current', 'settings-pin-new', 'settings-pin-confirm', 'settings-pin-recovery']
                    .forEach(id => document.getElementById(id).value = '');
                errorEl.textContent = '';
                ui.showToast('PIN changed successfully!', 'success');
            },

            // Inactivity timer — re-lock after 15 minutes
            resetInactivityTimer() {
                clearTimeout(this._inactivityTimer);
                this._inactivityTimer = setTimeout(() => {
                    this.showPanel('unlock');
                }, this.INACTIVITY_MINUTES * 60 * 1000);
            },

            startInactivityWatcher() {
                if (this._watcherStarted) return;
                this._watcherStarted = true;
                ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(event => {
                    document.addEventListener(event, () => {
                        // Only reset timer if app is currently unlocked
                        if (document.getElementById('pin-lock-screen').style.display === 'none') {
                            this.resetInactivityTimer();
                        }
                    }, { passive: true });
                });
            }
        };

        // ============================================
        // STORAGE PERSISTENCE
        // Asks the browser to protect this site's
        // data from being silently evicted.
        // ============================================
        async function requestStoragePersistence() {
            if (!navigator.storage || !navigator.storage.persist) return;
            const isPersisted = await navigator.storage.persisted();
            if (!isPersisted) {
                const granted = await navigator.storage.persist();
                if (granted) {
                    console.log('✅ Storage persistence granted — data protected from eviction.');
                } else {
                    console.warn('⚠️ Storage persistence denied — data may be cleared by browser.');
                }
            }
        }