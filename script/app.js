/* -------------------------------------------------------------------------
   SPADES GLOBAL MODAL STACK CONTROLLER
   Every modal is promoted in open order; the most recently opened modal stays
   above earlier dialogs regardless of legacy inline/static z-index values.
   ------------------------------------------------------------------------- */
(function initializeSpadesModalStack() {
    'use strict';

    const MODAL_SELECTOR = '.modal-overlay';
    const STACK_BASE = 30000;
    const STACK_STEP = 10;
    let modalOrder = [];

    function getModal(target) {
        if (typeof target === 'string') return document.getElementById(target);
        return target instanceof HTMLElement ? target : null;
    }

    function isManagedModal(el) {
        return !!(el && el.matches && el.matches(MODAL_SELECTOR));
    }

    function isVisible(el) {
        if (!el || !el.isConnected || el.hidden || el.classList.contains('hidden')) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
    }

    // Unspecified buttons default to "submit" inside forms. Explicit submit
    // controls keep their type; all other controls are made safe action buttons.
    function normalizeUntypedButtons(root = document) {
        if (!root) return;
        if (root instanceof HTMLButtonElement && !root.hasAttribute('type')) root.type = 'button';
        root.querySelectorAll?.('button:not([type])').forEach(button => { button.type = 'button'; });
    }

    function moveModalsToDocumentRoot() {
        document.querySelectorAll(MODAL_SELECTOR).forEach(modal => {
            // Root-level overlays are not trapped inside tab/layout stacking contexts.
            if (modal.parentElement !== document.body) document.body.appendChild(modal);
        });
    }

    function paintStack() {
        modalOrder = modalOrder.filter(isVisible);
        modalOrder.forEach((modal, index) => {
            modal.style.setProperty('position', 'fixed', 'important');
            modal.style.setProperty('z-index', String(STACK_BASE + index * STACK_STEP), 'important');
            modal.style.setProperty('isolation', 'isolate', 'important');

            const isTop = index === modalOrder.length - 1;
            modal.setAttribute('aria-hidden', isTop ? 'false' : 'true');
            if (isTop) modal.setAttribute('aria-modal', 'true');
            else modal.removeAttribute('aria-modal');
        });

        document.querySelectorAll(MODAL_SELECTOR).forEach(modal => {
            if (!isVisible(modal)) {
                modal.setAttribute('aria-hidden', 'true');
                modal.removeAttribute('aria-modal');
            }
        });
        document.body.classList.toggle('spades-modal-stack-open', modalOrder.length > 0);
    }

    function refreshStack() {
        modalOrder = modalOrder.filter(isVisible);
        document.querySelectorAll(MODAL_SELECTOR).forEach(modal => {
            if (isVisible(modal) && !modalOrder.includes(modal)) modalOrder.push(modal);
        });
        paintStack();
    }

    function bringToFront(target) {
        const modal = getModal(target);
        if (!isManagedModal(modal)) return;
        if (modal.parentElement !== document.body) document.body.appendChild(modal);

        modalOrder = modalOrder.filter(existing => existing !== modal && isVisible(existing));
        document.querySelectorAll(MODAL_SELECTOR).forEach(existing => {
            if (isVisible(existing) && existing !== modal && !modalOrder.includes(existing)) modalOrder.push(existing);
        });
        if (isVisible(modal)) modalOrder.push(modal);
        paintStack();
    }

    function mutationHandler(records) {
        // Re-home overlays added dynamically, if the app adds any in a future update.
        records.forEach(record => {
            if (record.type !== 'childList') return;
            record.addedNodes.forEach(node => {
                if (!(node instanceof HTMLElement)) return;
                normalizeUntypedButtons(node);
                const candidates = [];
                if (isManagedModal(node)) candidates.push(node);
                node.querySelectorAll?.(MODAL_SELECTOR).forEach(modal => candidates.push(modal));
                candidates.forEach(modal => {
                    if (modal.parentElement !== document.body) document.body.appendChild(modal);
                });
            });
        });

        // Track class transitions from hidden -> visible in MutationObserver order,
        // so when several dialogs open in one event cycle the last one wins.
        const newlyOpened = [];
        records.forEach(record => {
            if (record.type !== 'attributes' || !isManagedModal(record.target)) return;
            if (record.attributeName === 'class') {
                const wasHidden = String(record.oldValue || '').split(/\s+/).includes('hidden');
                if (wasHidden && isVisible(record.target)) newlyOpened.push(record.target);
            } else if (record.attributeName === 'hidden' && record.oldValue !== null && isVisible(record.target)) {
                newlyOpened.push(record.target);
            }
        });

        modalOrder = modalOrder.filter(isVisible);
        newlyOpened.forEach(modal => {
            if (!isVisible(modal)) return;
            modalOrder = modalOrder.filter(existing => existing !== modal);
            modalOrder.push(modal);
        });
        document.querySelectorAll(MODAL_SELECTOR).forEach(modal => {
            if (isVisible(modal) && !modalOrder.includes(modal)) modalOrder.push(modal);
        });
        paintStack();
    }

    function initialize() {
        if (!document.body) return;
        normalizeUntypedButtons(document.body);
        moveModalsToDocumentRoot();
        refreshStack();

        const observer = new MutationObserver(mutationHandler);
        observer.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeOldValue: true,
            attributeFilter: ['class', 'hidden']
        });

        // A final safety net for legacy close controls: their own handlers run first
        // and perform module cleanup; if a handler is missing or fails to hide its
        // owning overlay, close that exact dialog and repaint the stack.
        document.addEventListener('click', event => {
            const control = event.target && event.target.closest && event.target.closest(
                'button.modal-uniform-close,button.modal-close-control,button.matrix-compliance-modal-close,button.profile-card-close,button.my-files-close-btn,button[data-modal-close],.modal-content button[aria-label*="close" i]'
            );
            if (!control) return;
            const owner = control.closest(MODAL_SELECTOR);
            if (!owner) return;
            window.setTimeout(() => {
                if (!isVisible(owner)) { refreshStack(); return; }
                // Retry an explicitly declared inline close callback if one exists.
                const inline = String(control.getAttribute('onclick') || '');
                const callback = inline.match(/^\s*([A-Za-z_$][\w$]*)\s*\(/);
                if (callback && typeof window[callback[1]] === 'function') {
                    try { window[callback[1]](); } catch (error) { console.warn('Modal close callback failed:', error); }
                }
                if (isVisible(owner)) {
                    owner.classList.add('hidden');
                    owner.setAttribute('aria-hidden', 'true');
                    owner.removeAttribute('aria-modal');
                }
                refreshStack();
            }, 0);
        }, false);

        window.SPADESModalStack = Object.freeze({
            bringToFront,
            refresh: refreshStack,
            getOpenModalIds: () => modalOrder.filter(isVisible).map(modal => modal.id || '')
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
})();



/* -------------------------------------------------------------------------
   SPADES LIST VIEWPORT PRESERVATION
   Keeps the reader's current list position stable while background or manual
   data loaders refresh/rebuild list contents. It stores both scroll offsets
   and a visible-row anchor so the same record remains in view when possible.
   ------------------------------------------------------------------------- */
(function initializeSpadesListViewportPreserver() {
    'use strict';

    const LIST_SCROLL_SELECTOR = [
        '.table-wrapper', '.um-table-scroll', '.proofreader-table-wrap',
        '.my-files-table-wrap', '.my-files-content', '.chat-user-list',
        '.users-chat-page-user-list', '.squad-carousel', '.squad-members-wrap',
        '.duty-sequence-list', '.bmi-personnel-list', '.leave-personnel-table',
        '.area-personnel-list', '.activity-data-table-wrap',
        '.matrix-compliance-table-wrap', '.area-overview-table-wrap',
        '.proofreader-designation-list', '.rank-recap', '.exec-list',
        '.exec-venue-list', '.memo-summary-list', '.spades-backup-list',
        '.exec-log-scroll', '.memo-table-wrapper', '#profileRecentMemos',
        '#folderBrowserList', '#squadMemberList', '#areaPersonnelList',
        '#proofReaderDesignationList', '#proofReaderAnnotationList',
        '#activityDayListBody', '#chatDropdownUserList'
    ].join(',');

    const ANCHOR_SELECTOR = [
        'tbody tr', '[data-myfiles-row]', '[data-proof-reader-id]',
        '[data-matrix-compliance-id]', '.chat-user-item',
        '.personnel-clickable-row', '.exec-row', '[data-note-card]',
        '.area-card', 'li', 'article'
    ].join(',');

    const IDENTITY_ATTRIBUTES = [
        'data-myfiles-row', 'data-proof-reader-id', 'data-matrix-compliance-id',
        'data-personnel-record', 'data-note-card', 'data-id', 'data-username', 'data-record-id'
    ];

    // The saved viewport is restored after rendering even if the temporary
    // loading state collapsed the scroll area in the meantime.

    function isVisible(element) {
        if (!element || !element.isConnected) return false;
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' &&
            element.getClientRects().length > 0;
    }

    function cssEscape(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
        return String(value).replace(/[^a-zA-Z0-9_-]/g, character => '\\' + character);
    }

    // Build a stable-enough selector from the nearest ID or the DOM path. This
    // also resolves list wrappers that are recreated by a parent innerHTML write.
    function getElementPath(element) {
        const parts = [];
        let node = element;
        while (node && node.nodeType === 1 && node !== document.documentElement) {
            if (node.dataset && node.dataset.spadesScrollKey) {
                parts.unshift('[data-spades-scroll-key="' + String(node.dataset.spadesScrollKey).replace(/\"/g, '\\\"') + '"]');
                break;
            }
            if (node.id) {
                parts.unshift('#' + cssEscape(node.id));
                break;
            }
            const tag = node.tagName.toLowerCase();
            let position = 1;
            for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
                if (sibling.tagName === node.tagName) position++;
            }
            parts.unshift(tag + ':nth-of-type(' + position + ')');
            node = node.parentElement;
        }
        return parts.join(' > ');
    }

    function getAnchorItems(container) {
        return Array.from(container.querySelectorAll(ANCHOR_SELECTOR)).filter(item => {
            if (!item.getClientRects().length) return false;
            const text = String(item.textContent || '').replace(/\s+/g, ' ').trim();
            return !!text;
        });
    }

    function captureAnchor(container) {
        const containerRect = container.getBoundingClientRect();
        const visibleItems = getAnchorItems(container).filter(item => {
            const rect = item.getBoundingClientRect();
            return rect.bottom > containerRect.top + 1 && rect.top < containerRect.bottom - 1;
        });
        const item = visibleItems[0];
        if (!item) return null;

        let identity = null;
        for (const attribute of IDENTITY_ATTRIBUTES) {
            if (item.hasAttribute(attribute)) {
                identity = {attribute, value: item.getAttribute(attribute)};
                break;
            }
        }

        const text = String(item.textContent || '').replace(/\s+/g, ' ').trim();
        return {
            identity,
            text: text.slice(0, 180),
            index: getAnchorItems(container).indexOf(item),
            offsetTop: item.getBoundingClientRect().top - containerRect.top
        };
    }

    function capture() {
        const positions = [];
        document.querySelectorAll(LIST_SCROLL_SELECTOR).forEach(element => {
            if (!isVisible(element)) return;
            const canScrollY = element.scrollHeight > element.clientHeight + 2;
            const canScrollX = element.scrollWidth > element.clientWidth + 2;
            if (!canScrollY && !canScrollX) return;
            positions.push({
                path: getElementPath(element),
                top: element.scrollTop,
                left: element.scrollLeft,
                anchor: canScrollY ? captureAnchor(element) : null
            });
        });

        return {
            windowX: window.scrollX || 0,
            windowY: window.scrollY || 0,
            positions
        };
    }

    function findAnchor(container, anchor) {
        if (!anchor) return null;
        const items = getAnchorItems(container);
        if (anchor.identity) {
            const matchingIdentity = items.find(item =>
                item.getAttribute(anchor.identity.attribute) === anchor.identity.value
            );
            if (matchingIdentity) return matchingIdentity;
        }
        if (anchor.text) {
            const exact = items.find(item => String(item.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180) === anchor.text);
            if (exact) return exact;
        }
        return items[anchor.index] || null;
    }

    function restore(snapshot) {
        if (!snapshot) return Promise.resolve();
        return new Promise(resolve => {
            const requestFrame = window.requestAnimationFrame || (callback => window.setTimeout(callback, 16));
            requestFrame(() => requestFrame(() => {
                if (Math.abs((window.scrollY || 0) - snapshot.windowY) > 1 ||
                    Math.abs((window.scrollX || 0) - snapshot.windowX) > 1) {
                    window.scrollTo(snapshot.windowX, snapshot.windowY);
                }

                snapshot.positions.forEach(position => {
                    let element = null;
                    try { element = document.querySelector(position.path); } catch (_) {}
                    if (!element || !isVisible(element)) return;

                    const anchor = findAnchor(element, position.anchor);
                    if (anchor && position.anchor) {
                        const containerRect = element.getBoundingClientRect();
                        const anchorRect = anchor.getBoundingClientRect();
                        const delta = (anchorRect.top - containerRect.top) - position.anchor.offsetTop;
                        if (Number.isFinite(delta) && Math.abs(delta) > 0.5) element.scrollTop += delta;
                    } else {
                        element.scrollTop = position.top;
                    }
                    element.scrollLeft = position.left;
                });
                resolve();
            }));
        });
    }

    window.SPADESListViewport = Object.freeze({capture, restore});
})();

const API_URL = "https://script.google.com/macros/s/AKfycbx42FXBvP2w42kl5XO9ICUAf04mJqqHLcVfSsEC9Ku8bcYWd5KZ2S1H_zzGWs8zE-kS/exec";
        const ALPHA_ADMIN_NAME_CACHE_KEY = 'spadesAlphaAdminName';
        const ALPHA_ADMIN_NAME_CACHE_TIME_KEY = 'spadesAlphaAdminNameCachedAt';
        function readCachedAlphaAdminName() {
            try {
                const cachedAt = Number(localStorage.getItem(ALPHA_ADMIN_NAME_CACHE_TIME_KEY) || 0);
                const cachedName = String(localStorage.getItem(ALPHA_ADMIN_NAME_CACHE_KEY) || '').trim();
                // The username is not a credential. A short cache only improves initial UI readiness;
                // the backend remains authoritative for all authentication and administrative actions.
                if (cachedName && cachedAt && Date.now() - cachedAt < 7 * 24 * 60 * 60 * 1000) return cachedName;
            } catch (_) {}
            return '';
        }
        let ALPHA_ADMIN_NAME = readCachedAlphaAdminName(); // Public identifier cache only; never stores the Alpha Admin credential.

        let sessionAdminPass = "";
        let sessionAdminPassExpiresAt = 0;
        let sessionAdminPassTimer = null;
        function hasFreshAlphaStepUp() {
            if (!sessionAdminPass || !sessionAdminPassExpiresAt || Date.now() >= sessionAdminPassExpiresAt) {
                sessionAdminPass = ''; sessionAdminPassExpiresAt = 0;
                if (sessionAdminPassTimer) clearTimeout(sessionAdminPassTimer);
                sessionAdminPassTimer = null;
                return false;
            }
            return true;
        }
        function activateAlphaStepUpToken(data) {
            if (!data || !data.adminToken) throw new Error('The administrator verification did not return a valid elevated session.');
            sessionAdminPass = String(data.adminToken);
            sessionAdminPassExpiresAt = Number(data.elevatedUntil || (Date.now() + 15 * 60 * 1000));
            if (sessionAdminPassTimer) clearTimeout(sessionAdminPassTimer);
            sessionAdminPassTimer = window.setTimeout(() => {
                sessionAdminPass = ''; sessionAdminPassExpiresAt = 0; sessionAdminPassTimer = null;
                if (document.getElementById('tabAdminMgmt') && !document.getElementById('tabAdminMgmt').classList.contains('hidden')) {
                    customAlert('Your elevated administrator verification has expired. Verify again to continue administrative actions.', 'Verification Expired');
                    switchTab('settings');
                }
            }, Math.max(0, sessionAdminPassExpiresAt - Date.now()));
            return sessionAdminPass;
        }
        async function ensureAlphaStepUpToken(password) {
            if (hasFreshAlphaStepUp()) return sessionAdminPass;
            const activeUser = localStorage.getItem('loggedInUser') || '';
            if (!password) throw new Error('Enter your Alpha Admin credential to continue.');
            const response = await fetch(API_URL, {
                method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
                body:JSON.stringify({action:'verify_admin',username:activeUser,password,sessionToken:localStorage.getItem('loggedCred') || '',issueStepUp:true})
            });
            const result = await response.json();
            if (!result || !result.success || !result.adminToken) throw new Error(result?.error || 'Alpha Admin verification failed.');
            return activateAlphaStepUpToken(result);
        }

        let adminUsersCache = [];
        let alphaAdminConfigLoaded = false;
        let pendingAdminAction = null;
        let actionTargetControl = null;

        async function spadesAuthenticatedRead(action, extra = {}) {
            const username = localStorage.getItem('loggedInUser') || '';
            const sessionToken = localStorage.getItem('loggedCred') || '';
            if (!username || !sessionToken) throw new Error('Your session has expired. Please sign in again.');
            return fetch(API_URL, {
                method: 'POST',
                headers: {'Content-Type':'text/plain;charset=utf-8'},
                cache: 'no-store',
                body: JSON.stringify({action, username, userName:username, credential:sessionToken, ...extra})
            });
        }

        function setCachedAlphaAdminName(name) {
            const safeName = String(name || '').trim();
            ALPHA_ADMIN_NAME = safeName;
            try {
                if (safeName) {
                    localStorage.setItem(ALPHA_ADMIN_NAME_CACHE_KEY, safeName);
                    localStorage.setItem(ALPHA_ADMIN_NAME_CACHE_TIME_KEY, String(Date.now()));
                } else {
                    localStorage.removeItem(ALPHA_ADMIN_NAME_CACHE_KEY);
                    localStorage.removeItem(ALPHA_ADMIN_NAME_CACHE_TIME_KEY);
                }
            } catch (_) {}
            syncAlphaAdminLoginCredentialField();
            syncAlphaAdminAccessVisibility();
        }

        async function loadAlphaAdminIdentity() {
            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => controller.abort(), 7000);
            try {
                const response = await fetch(`${API_URL}?action=get_alpha_admin_name`, {
                    cache: 'no-store',
                    signal: controller.signal
                });
                if (!response.ok) throw new Error('Alpha Admin identity request failed (' + response.status + ').');
                const data = await response.json();
                if (data && data.configured && data.username) {
                    setCachedAlphaAdminName(data.username);
                    alphaAdminConfigLoaded = true;
                } else if (data && data.configured === false) {
                    setCachedAlphaAdminName('');
                    alphaAdminConfigLoaded = false;
                    console.warn('Alpha Admin Script Properties are not configured.');
                }
            } catch (error) {
                // Retain a previously validated public username cache during network interruptions.
                // This only affects UI hints; every protected backend operation checks the session.
                alphaAdminConfigLoaded = false;
                console.warn('Alpha Admin identity refresh deferred; the cached identity remains in use.', error);
            } finally {
                window.clearTimeout(timeoutId);
                syncAlphaAdminLoginCredentialField();
                syncAlphaAdminAccessVisibility();
            }
        }
        
        let allMemos = [];
        let dashboardSummaryCache = null;
        let dashboardSummaryPromise = null;
        let filteredMemos = [];
        let currentMemoPage = 1;
        
        let MEMOS_PER_PAGE = 10;
        let activityRefreshTimer = null;
        let autoLogoutTimer = null;
        let sessionExpiryTimer = null;
        let sessionHeartbeatTimer = null;
        const NOTIFICATION_SOUNDS = [
            { file: 'Notif1.mp3', label: 'Notif1 (Default)' },
            { file: 'Notif2.mp3', label: 'Notif2' },
            { file: 'Alert.mp3', label: 'Alert' }
            // Add additional MP3 files placed in the sounds folder here, for example:
            // ,{ file: 'Notif2.mp3', label: 'Notif2' }
            // ,{ file: 'Alert.mp3', label: 'Alert' }
        ];
        const DEFAULT_NOTIFICATION_SOUND = 'Notif1.mp3';
        const DEFAULT_USER_SETTINGS = { theme: 'Light', sidebar: 'Collapsed', tableDisplay: 'Comfortable', liveNotif: true, notifSound: true, notificationSound: DEFAULT_NOTIFICATION_SOUND, recordsPerPage: '10', rememberSearch: false, showChatbot: true, autoOpenChatbot: false, autoLogout: '30', confirmLogout: true, fontSize: 'Default', reducedMotion: false, highContrast: false, autoRefresh: true, refreshInterval: '60', confirmActions: true, language: 'English', dateFormat: 'US', time24: false };
        let userSettings = { ...DEFAULT_USER_SETTINGS };
        let lastLogCount = 0;
        let liveActivityLogs = [];
        let execActivityUserFilter = "";
        let activityLogRefreshTimer = null;
        let allPersonnel = [];
        let archivedPersonnel = [];
        let personnelEditNo = null;

        let chatMode = 'global';
        let chatSelectedUser = '';
        let chatUsers = [];
        let chatMessagesTimer = null;
        let chatbotHistory = [];
        let chatbotRequestInFlight = false;
        let chatbotAttachmentFile = null;
        const CHATBOT_MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
        let chatUsersLoaded = false;
        let chatAttachmentFile = null;
        const CHAT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

        // Incoming chat notification monitor. This runs independently from the
        // Users Chat page so messages can alert the user from any dashboard page.
        let chatNotificationTimer = null;
        let chatNotificationSince = 0;
        let chatNotificationInitialized = false;
        const CHAT_NOTIFICATION_POLL_MS = 4000;
        const CHAT_POPUP_MAX = 4;
        let chatUnreadCount = 0;
        const chatUnreadByConversation = Object.create(null);

        let allActivities = [];
        let filteredActivities = [];
        let matrixComplianceRecords = [];
        let matrixComplianceReadOnly = false;
        let matrixComplianceIsAlphaAdmin = false;
        let matrixComplianceEditingId = '';
        let matrixComplianceBusy = false;
        let currentMatrixCompliancePage = 1;
        const MATRIX_COMPLIANCES_PER_PAGE = 10;
        let archivedActivities = [];
        let filteredArchivedActivities = [];
        let currentActivityPage = 1;
        let currentArchivedActivityPage = 1;
        let activityEditId = null;
        let activityReminderTimer = null;
        let activeActivityReminder = null;
        let scheduledAlertQueue = [];
        let scheduledAlertQueueKeys = new Set();
        let scheduledAlertPollInFlight = false;
        let scheduledAlertClientId = '';
        const SCHEDULED_ALERT_POLL_MS = 60000;
        const ACTIVITY_VENUES = ["PRO 1 Auditorium","PRO 1 Grandstand","PRO 1 Parade Ground","PRO 1 Firing Range","PRO 1 Conference Room"];


        document.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                const activeId = document.activeElement.id;
                if (['loginUsername', 'loginCredential'].includes(activeId)) loginUser();
                if (['regFirst', 'regMiddle', 'regLast', 'regQlf', 'regEmail', 'regUsername', 'regCredential'].includes(activeId)) registerUser();
                if (['newUsernameInput', 'newCredential'].includes(activeId)) updateProfile();
                if (activeId === 'adminPassInput') verifyAdmin();
                if (['actionAdminPass', 'actionNewSubject'].includes(activeId)) executeAction();
            }
        });

        function getUserSettingsKey(username) {
            return 'rhsuSettings_' + String(username || '').trim();
        }

        function persistUserSettings(username = localStorage.getItem('loggedInUser')) {
            if (!username) return;
            try {
                localStorage.setItem(getUserSettingsKey(username), JSON.stringify(userSettings));
            } catch (e) {}
        }

        function loadSettings() {
            const user = localStorage.getItem('loggedInUser');
            if(!user) return;

            userSettings = { ...DEFAULT_USER_SETTINGS };
            const stored = localStorage.getItem(getUserSettingsKey(user));
            if(stored) {
                try {
                    const parsed = JSON.parse(stored);
                    if (parsed && typeof parsed === 'object') {
                        userSettings = { ...userSettings, ...parsed };
                    }
                } catch(e) {}
            }

            updateSettingsUI();
            applySettingsEffects();
        }

        function getValidNotificationSound(soundFile) {
            const requested = String(soundFile || '').trim();
            return NOTIFICATION_SOUNDS.some(sound => sound.file === requested) ? requested : DEFAULT_NOTIFICATION_SOUND;
        }

        function populateNotificationSoundOptions() {
            const select = document.getElementById('setNotificationSound');
            if (!select) return;
            const current = getValidNotificationSound(userSettings.notificationSound);
            select.innerHTML = '';
            NOTIFICATION_SOUNDS.forEach(sound => {
                const option = document.createElement('option');
                option.value = sound.file;
                option.textContent = sound.label;
                select.appendChild(option);
            });
            select.value = current;
        }

        const NOTIFICATION_SOUND_DELAY_MS = 500;

        function playNotificationSound(soundFile = userSettings.notificationSound) {
            if (userSettings.notifSound === false) return;
            const selected = getValidNotificationSound(soundFile);

            // Delay playback slightly so the notification UI can finish rendering and
            // the browser has time to initialize the audio element. A fresh Audio
            // instance prevents a new notification from resetting/cutting off a sound
            // that is already playing.
            setTimeout(() => {
                if (userSettings.notifSound === false) return;
                try {
                    const audio = new Audio('sounds/' + selected);
                    audio.preload = 'auto';
                    audio.volume = 0.7;
                    audio.addEventListener('ended', () => {
                        audio.removeAttribute('src');
                        audio.load();
                    }, { once: true });
                    const playPromise = audio.play();
                    if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
                } catch (e) {}
            }, NOTIFICATION_SOUND_DELAY_MS);
        }

        function testNotificationSound() {
            const select = document.getElementById('setNotificationSound');
            const selected = select ? getValidNotificationSound(select.value) : DEFAULT_NOTIFICATION_SOUND;
            setTimeout(() => {
                try {
                    const audio = new Audio('sounds/' + selected);
                    audio.preload = 'auto';
                    audio.volume = 0.7;
                    const playPromise = audio.play();
                    if (playPromise && typeof playPromise.catch === 'function') {
                        playPromise.catch(() => showNotification('Sound Test', 'The browser blocked audio playback. Click the Test button again to allow the sound.'));
                    }
                } catch (e) {
                    showNotification('Sound Test', 'Unable to play the selected notification sound.');
                }
            }, NOTIFICATION_SOUND_DELAY_MS);
        }

        function updateSettingsUI() {
            const values = {
                setTheme: userSettings.theme || 'Light',
                setSidebar: userSettings.sidebar || 'Collapsed',
                setTableDisplay: userSettings.tableDisplay || 'Comfortable',
                setNotificationSound: getValidNotificationSound(userSettings.notificationSound),
                setRecordsPage: userSettings.recordsPerPage || '10',
                setAutoLogout: ['15','30','60'].includes(String(userSettings.autoLogout)) ? String(userSettings.autoLogout) : '30',
                setFontSize: userSettings.fontSize || 'Default',
                setRefreshInterval: userSettings.refreshInterval || '60',
                setLanguage: userSettings.language || 'English',
                setDateFormat: userSettings.dateFormat || 'US'
            };
            const checks = {
                setLiveNotif: userSettings.liveNotif !== false,
                setNotifSound: userSettings.notifSound !== false,
                setRemSearch: !!userSettings.rememberSearch,
                setShowChat: userSettings.showChatbot !== false,
                setAutoChat: !!userSettings.autoOpenChatbot,
                setConfirmLogout: userSettings.confirmLogout !== false,
                setReducedMotion: !!userSettings.reducedMotion,
                setHighContrast: !!userSettings.highContrast,
                setAutoRefresh: userSettings.autoRefresh !== false,
                setConfirmActions: userSettings.confirmActions !== false,
                set24Hour: !!userSettings.time24
            };
            Object.entries(values).forEach(([id, value]) => {
                const el = document.getElementById(id);
                if (el) el.value = value;
            });
            Object.entries(checks).forEach(([id, value]) => {
                const el = document.getElementById(id);
                if (el) el.checked = value;
            });
            populateNotificationSoundOptions();
        }

        function saveSettings() {
            userSettings.theme = document.getElementById('setTheme').value;
            userSettings.sidebar = document.getElementById('setSidebar').value;
            userSettings.tableDisplay = document.getElementById('setTableDisplay').value;
            userSettings.liveNotif = document.getElementById('setLiveNotif').checked;
            userSettings.notifSound = document.getElementById('setNotifSound').checked;
            userSettings.notificationSound = getValidNotificationSound(document.getElementById('setNotificationSound')?.value);
            userSettings.recordsPerPage = document.getElementById('setRecordsPage').value;
            userSettings.rememberSearch = document.getElementById('setRemSearch').checked;
            userSettings.showChatbot = document.getElementById('setShowChat').checked;
            userSettings.autoOpenChatbot = document.getElementById('setAutoChat').checked;
            userSettings.autoLogout = ['15','30','60'].includes(String(document.getElementById('setAutoLogout').value)) ? document.getElementById('setAutoLogout').value : '30';
            userSettings.confirmLogout = document.getElementById('setConfirmLogout').checked;
            userSettings.fontSize = document.getElementById('setFontSize').value;
            userSettings.reducedMotion = document.getElementById('setReducedMotion').checked;
            userSettings.highContrast = document.getElementById('setHighContrast').checked;
            userSettings.autoRefresh = document.getElementById('setAutoRefresh').checked;
            userSettings.refreshInterval = document.getElementById('setRefreshInterval').value;
            userSettings.confirmActions = document.getElementById('setConfirmActions').checked;
            userSettings.language = document.getElementById('setLanguage').value;
            userSettings.dateFormat = document.getElementById('setDateFormat').value;
            userSettings.time24 = document.getElementById('set24Hour').checked;

            persistUserSettings();
            applySettingsEffects();
            if (typeof restartActivityLogRefresh === 'function') restartActivityLogRefresh();
            showNotification("Settings Saved", "Your preferences have been updated successfully.");
        }

        function resetPreferences() {
            customConfirm("Are you sure you want to reset all preferences to default?", (confirmed) => {
                if(confirmed) {
                    userSettings = { ...DEFAULT_USER_SETTINGS };
                    updateSettingsUI();
                    saveSettings();
                }
            });
        }

        function applySettingsEffects() {
            const body = document.body;
            if (!body) return;
            const prefersDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
            body.classList.toggle('dark-mode', userSettings.theme === 'Dark' || (userSettings.theme === 'System' && prefersDark));
            body.classList.toggle('compact-mode', userSettings.tableDisplay === 'Compact');
            body.classList.toggle('rhsu-font-large', userSettings.fontSize === 'Large');
            body.classList.toggle('rhsu-font-xlarge', userSettings.fontSize === 'ExtraLarge');
            body.classList.toggle('rhsu-reduced-motion', !!userSettings.reducedMotion);
            body.classList.toggle('rhsu-high-contrast', !!userSettings.highContrast);

            const sidebar = document.getElementById('navSidebar');
            const layout = document.getElementById('appLayout');
            if (window.innerWidth > 992) {
                const collapsed = userSettings.sidebar !== 'Expanded';
                if (sidebar) sidebar.classList.toggle('collapsed', collapsed);
                if (layout) layout.classList.toggle('nav-collapsed', collapsed);
            } else {
                if (sidebar) sidebar.classList.remove('collapsed');
                if (layout) layout.classList.remove('nav-collapsed');
            }

            const pageSize = Number.parseInt(userSettings.recordsPerPage, 10);
            MEMOS_PER_PAGE = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 10;
            if (Array.isArray(filteredMemos) && filteredMemos.length > 0) renderMemoTable();

            const chatbot = document.getElementById('chatbot-container');
            if (chatbot) chatbot.classList.toggle('hidden', userSettings.showChatbot === false);
            const refreshInterval = document.getElementById('setRefreshInterval');
            if (refreshInterval) refreshInterval.disabled = userSettings.autoRefresh === false;
            resetIdleTimer();
            updateDateTime();
        }

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => { if (userSettings.theme === 'System') applySettingsEffects(); });

        function playAudioBeep() {
            // Preserve the existing function name for compatibility while using
            // the user's selected notification MP3 instead of the generated beep.
            playNotificationSound();
        }

        ['mousemove', 'keydown', 'click', 'scroll'].forEach(evt => { window.addEventListener(evt, resetIdleTimer); });

        function resetIdleTimer() {
            if (autoLogoutTimer) clearTimeout(autoLogoutTimer);
            if (!localStorage.getItem('loggedInUser')) return;
            // Security policy: a signed-in browser tab may remain idle for at most 60 minutes.
            let minutes = parseInt(userSettings.autoLogout, 10);
            if (!Number.isFinite(minutes) || minutes <= 0) minutes = 30;
            minutes = Math.min(60, Math.max(15, minutes));
            autoLogoutTimer = setTimeout(() => { customAlert("Your session has expired due to inactivity. Please sign in again.", "Session Expired"); logoutUser(true); }, minutes * 60000);
        }

        function toggleNav() {
            const sidebar = document.getElementById('navSidebar');
            if (!sidebar) return;
            if (window.innerWidth <= 992) {
                sidebar.classList.toggle('open');
                return;
            }
            sidebar.classList.toggle('collapsed');
            const collapsed = sidebar.classList.contains('collapsed');
            const appLayout = document.getElementById('appLayout');
            if (appLayout) appLayout.classList.toggle('nav-collapsed', collapsed);
            userSettings.sidebar = collapsed ? 'Collapsed' : 'Expanded';
            const user = localStorage.getItem('loggedInUser');
            const sidebarSelect = document.getElementById('setSidebar');
            if (sidebarSelect) sidebarSelect.value = userSettings.sidebar;
            if (user) persistUserSettings(user);
        }

        function updateDateTime() {
            const display = document.getElementById('datetime-display');
            if (!display) return;
            const now = new Date();
            const dateFormat = userSettings.dateFormat || 'US';
            const dateParts = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
            }).formatToParts(now).reduce((out, part) => { if (part.type !== 'literal') out[part.type] = part.value; return out; }, {});
            const dateText = dateFormat === 'ISO'
                ? `${dateParts.year}-${dateParts.month}-${dateParts.day}`
                : dateFormat === 'Long'
                    ? new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Manila',year:'numeric',month:'long',day:'numeric'}).format(now)
                    : new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
            const timeText = new Intl.DateTimeFormat('en-US', {
                timeZone:'Asia/Manila', hour:'2-digit', minute:'2-digit', hour12:!userSettings.time24
            }).format(now);
            display.textContent = `${dateText} · ${timeText} (PHT)`;
        }
        setInterval(updateDateTime, 15000); updateDateTime();

        function showNotification(title, message, onClickAction) {
            try { if (typeof playNotificationSound === 'function') playNotificationSound(); } catch (_) {}
            const container = document.getElementById('notificationContainer');
            if (!container) {
                console.info(String(title || 'Notification') + ': ' + String(message || ''));
                return;
            }
            // Limit the number of live toasts to avoid stacking memory/DOM during busy sessions.
            while (container.children.length >= 5) container.firstElementChild?.remove();
            const toast = document.createElement('button');
            toast.type = 'button';
            toast.className = 'notification-toast';
            toast.setAttribute('aria-label', `${String(title || 'Notification')}. ${String(message || '')}. Dismiss notification.`);
            const titleNode = document.createElement('span');
            titleNode.className = 'notification-title';
            titleNode.textContent = String(title == null ? 'System Notification' : title);
            const messageNode = document.createElement('span');
            messageNode.className = 'notification-msg';
            messageNode.textContent = String(message == null ? '' : message);
            toast.append(titleNode, messageNode);
            const removeToast = () => {
                if (!toast.isConnected) return;
                toast.classList.add('fade-out');
                window.setTimeout(() => toast.remove(), 320);
            };
            const timeout = window.setTimeout(removeToast, 6000);
            toast.addEventListener('click', () => {
                window.clearTimeout(timeout);
                removeToast();
                if (typeof onClickAction === 'function') {
                    try { onClickAction(); } catch (error) { console.error('Notification action failed:', error); }
                }
            }, { once: true });
            container.appendChild(toast);
        }

        function customAlert(message, title = "System Notification") { showNotification(title, message); }
        const pendingCustomConfirmRequests = [];
        let activeCustomConfirmRequest = null;

        function showNextCustomConfirm() {
            if (activeCustomConfirmRequest || pendingCustomConfirmRequests.length === 0) return;
            const modal = document.getElementById('customConfirmModal');
            const messageNode = document.getElementById('customConfirmMessage');
            const yes = document.getElementById('customConfirmYesBtn');
            const no = document.getElementById('customConfirmNoBtn');

            if (!modal || !messageNode || !yes || !no) {
                const request = pendingCustomConfirmRequests.shift();
                const result = window.confirm(String(request.message || 'Are you sure?'));
                try { if (typeof request.callback === 'function') request.callback(result); }
                catch (error) { console.error('Confirmation callback failed:', error); }
                queueMicrotask(showNextCustomConfirm);
                return;
            }

            activeCustomConfirmRequest = pendingCustomConfirmRequests.shift();
            messageNode.textContent = activeCustomConfirmRequest.message;
            if (modal.parentElement !== document.body) document.body.appendChild(modal);
            modal.classList.remove('hidden');
            window.SPADESModalStack?.bringToFront(modal);

            let settled = false;
            const finish = answer => {
                if (settled) return;
                settled = true;
                const request = activeCustomConfirmRequest;
                activeCustomConfirmRequest = null;
                modal.classList.add('hidden');
                yes.onclick = null;
                no.onclick = null;
                try {
                    if (request && typeof request.callback === 'function') request.callback(answer);
                } catch (error) {
                    console.error('Confirmation callback failed:', error);
                } finally {
                    queueMicrotask(showNextCustomConfirm);
                }
            };
            yes.onclick = () => finish(true);
            no.onclick = () => finish(false);
        }

        function customConfirm(message, callback) {
            const modal = document.getElementById('customConfirmModal');
            const messageNode = document.getElementById('customConfirmMessage');
            const yes = document.getElementById('customConfirmYesBtn');
            const no = document.getElementById('customConfirmNoBtn');
            if (!modal || !messageNode || !yes || !no) {
                const result = window.confirm(String(message || 'Are you sure?'));
                if (typeof callback === 'function') callback(result);
                return;
            }
            pendingCustomConfirmRequests.push({
                message: String(message == null ? '' : message),
                callback: typeof callback === 'function' ? callback : null
            });
            showNextCustomConfirm();
        }

        function getActivityLogTimestamp(log) {
            if (!log) return 0;
            const raw = log.timestamp || log.time || log.datetime || log.date || log.createdAt || log.created_at || '';
            if (raw instanceof Date) return raw.getTime();
            if (typeof raw === 'number') return raw < 100000000000 ? raw * 1000 : raw;
            const parsed = Date.parse(String(raw));
            return Number.isNaN(parsed) ? 0 : parsed;
        }

        function sortActivityLogsLatestFirst(logs) {
            return (Array.isArray(logs) ? logs : []).map((log, index) => ({ log, index, ts: getActivityLogTimestamp(log) }))
                .sort((a, b) => {
                    if (b.ts !== a.ts) return b.ts - a.ts;
                    return a.index - b.index;
                })
                .map(item => item.log);
        }

        async function logActivity(actionText) {
            const user = localStorage.getItem('loggedInUser') || 'Unknown User';

            // Do not even send Alpha Admin actions to the activity-log endpoint.
            // The backend repeats this check to keep the exclusion authoritative.
            if (user === ALPHA_ADMIN_NAME) return;

            try {
                await spadesAuthenticatedRead('log_activity', {actionText});
                // Refresh the log only when the Dashboard is actually visible.
                // Other modules must not trigger an extra full activity-sheet read.
                if (!document.getElementById('tabDashboard')?.classList.contains('hidden')) {
                    setTimeout(loadExecutiveDashboard, 1200);
                }
            } catch (err) {}
        }

        async function fetchActivityLogs() {
            try {
                // Cache-busting ensures every poll asks the backend for the latest log dataset.
                const res = await spadesAuthenticatedRead('get_activity_logs');
                const logs = await res.json();
                liveActivityLogs = sortActivityLogsLatestFirst(logs);

                if (lastLogCount > 0 && liveActivityLogs.length > lastLogCount) {
                    const newLogs = liveActivityLogs.length - lastLogCount;
                    for (let i = 0; i < Math.min(newLogs, 3); i++) {
                        const log = liveActivityLogs[i];
                        if (userSettings.liveNotif) {
                            showNotification("Live Activity", `${log.user || 'Unknown User'} ${log.actionText || log.action || ''}`.trim());
                        }
                    }
                }

                lastLogCount = liveActivityLogs.length;
                if (!document.getElementById('tabDashboard').classList.contains('hidden')) {
                    renderExecutiveDashboard();
                }
            } catch (err) {}
        }

        function getScheduledAlertClientId() {
            if (scheduledAlertClientId) return scheduledAlertClientId;
            try {
                scheduledAlertClientId = sessionStorage.getItem('spadesScheduledAlertClientId') || '';
                if (!scheduledAlertClientId) {
                    scheduledAlertClientId = 'tab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
                    sessionStorage.setItem('spadesScheduledAlertClientId', scheduledAlertClientId);
                }
            } catch (error) {
                scheduledAlertClientId = 'tab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
            }
            return scheduledAlertClientId;
        }

        async function acknowledgeScheduledAlert(alert) {
            if (!alert || !alert.alertKey) return;
            try {
                const response = await fetch(API_URL, {
                    method:'POST', mode:'cors',
                    headers:{'Content-Type':'text/plain;charset=utf-8'},
                    body:JSON.stringify({
                        action:'ack_scheduled_alerts',
                        ...chatCredentialPayload(),
                        clientId:getScheduledAlertClientId(),
                        alertKeys:[String(alert.alertKey)]
                    })
                });
                const result = await response.json();
                if (!response.ok || !result.success) console.debug('Scheduled alert acknowledgement was deferred.');
            } catch (error) {
                console.debug('Scheduled alert acknowledgement:', error);
            }
        }

        function scheduledAlertDateText(value) {
            const raw = String(value || '').slice(0, 10);
            const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!match) return raw || 'Date not specified';
            const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString(undefined, {year:'numeric', month:'long', day:'numeric'});
        }

        function notifyBrowserForScheduledAlert(alert) {
            if (typeof Notification !== 'function' || Notification.permission !== 'granted') return;
            try {
                const title = `${alert.recordType || 'SPADES'} Reminder: ${alert.title || 'Upcoming schedule'}`;
                const body = `${alert.alertLabel || 'Advance reminder'} · ${scheduledAlertDateText(alert.occurrenceDate)} at ${formatActivityTime(alert.scheduledTime || '')}`;
                const notification = new Notification(title, {body, tag:String(alert.alertKey || ''), renotify:false});
                notification.onclick = () => {
                    try { window.focus(); } catch (_) {}
                    openScheduledAlertRecord(alert);
                    notification.close();
                };
            } catch (error) {
                console.debug('Browser notification unavailable:', error);
            }
        }

        async function pollScheduledAlerts() {
            if (scheduledAlertPollInFlight || activeActivityReminder || scheduledAlertQueue.length || !localStorage.getItem('loggedInUser') || !localStorage.getItem('loggedCred')) return;
            scheduledAlertPollInFlight = true;
            try {
                const response = await fetch(API_URL, {
                    method:'POST', mode:'cors',
                    headers:{'Content-Type':'text/plain;charset=utf-8'},
                    body:JSON.stringify({action:'get_scheduled_alerts', ...chatCredentialPayload(), clientId:getScheduledAlertClientId()})
                });
                const result = await response.json();
                if (!response.ok || !result.success) {
                    if (result && result.error && /session|sign in|active/i.test(String(result.error))) {
                        console.debug('Scheduled alerts paused:', result.error);
                        stopActivityReminderMonitor();
                    }
                    return;
                }
                const alerts = Array.isArray(result.alerts) ? result.alerts : [];
                alerts.forEach(alert => {
                    const key = String(alert.alertKey || '');
                    if (!key || scheduledAlertQueueKeys.has(key) || (activeActivityReminder && activeActivityReminder.alertKey === key)) return;
                    scheduledAlertQueueKeys.add(key);
                    scheduledAlertQueue.push(alert);
                    notifyBrowserForScheduledAlert(alert);
                });
                showNextScheduledAlert();
            } catch (error) {
                // Schedule checking is background work; never interrupt normal SPADES use.
                console.debug('Scheduled alert polling:', error);
            } finally {
                scheduledAlertPollInFlight = false;
            }
        }

        function showNextScheduledAlert() {
            if (activeActivityReminder || !scheduledAlertQueue.length || !localStorage.getItem('loggedInUser')) return;
            const modal = document.getElementById('activityReminderModal');
            const title = document.getElementById('activityReminderTitle');
            const subtitle = document.getElementById('activityReminderSubtitle');
            const message = document.getElementById('activityReminderMessage');
            const openButton = document.getElementById('activityReminderOpenBtn');
            if (!modal || !title || !message) return;
            const alert = scheduledAlertQueue.shift();
            activeActivityReminder = alert;
            const source = String(alert.recordType || 'Schedule');
            title.textContent = String(alert.title || (source + ' Reminder'));
            if (subtitle) subtitle.textContent = `${source} reminder · ${String(alert.alertLabel || '')}`;
            message.innerHTML = `<div class="scheduled-alert-level">${escapeHtml(alert.alertLabel || 'ADVANCE REMINDER')}</div>
                <p class="scheduled-alert-copy">${source === 'Compliance' ? 'This compliance requirement is approaching its target time.' : 'This activity is approaching its scheduled start time.'}</p>
                <div class="scheduled-alert-detail"><span>Scheduled Date</span><strong>${escapeHtml(scheduledAlertDateText(alert.occurrenceDate))}</strong></div>
                <div class="scheduled-alert-detail"><span>Scheduled Time</span><strong>${escapeHtml(formatActivityTime(alert.scheduledTime || '') || 'Not specified')}</strong></div>
                <div class="scheduled-alert-detail"><span>${source === 'Compliance' ? 'Office In-charge' : 'Assigned Venue'}</span><strong>${escapeHtml(alert.detail || 'Not specified')}</strong></div>`;
            if (openButton) openButton.textContent = source === 'Compliance' ? 'Open Compliance' : 'Open Activity';
            modal.classList.remove('hidden');
            modal.setAttribute('aria-hidden', 'false');
            window.SPADESModalStack?.bringToFront(modal);
            // Claim is acknowledged as soon as the alert is visibly presented in this tab.
            acknowledgeScheduledAlert(alert);
            try { if (typeof playNotificationSound === 'function') playNotificationSound(); } catch (_) {}
        }

        function closeActivityReminder(deferQueue = false) {
            const modal = document.getElementById('activityReminderModal');
            if (modal) {
                modal.classList.add('hidden');
                modal.setAttribute('aria-hidden', 'true');
            }
            // Keep the alert key in this tab's in-memory seen set after dismissal/open;
            // a failed acknowledgement must not cause repeated modal prompts in the same session.
            activeActivityReminder = null;
            window.SPADESModalStack?.refresh();
            if (!deferQueue) window.setTimeout(() => {
                if (scheduledAlertQueue.length) showNextScheduledAlert();
                else pollScheduledAlerts();
            }, 180);
        }

        async function openActivityReminderRecord() {
            const alert = activeActivityReminder;
            if (!alert) return closeActivityReminder();
            closeActivityReminder(true);
            if (String(alert.recordType || '').toLowerCase() === 'compliance') {
                switchTab('matrixCompliances');
                window.requestAnimationFrame(async () => {
                    if (!(matrixComplianceRecords || []).some(record => String(record.id) === String(alert.recordId))) await loadMatrixCompliances();
                    const search = document.getElementById('matrixComplianceSearch');
                    if (search && search.value) search.value = '';
                    const recordIndex = (matrixComplianceRecords || []).findIndex(record => String(record.id) === String(alert.recordId));
                    if (recordIndex >= 0) {
                        currentMatrixCompliancePage = Math.floor(recordIndex / MATRIX_COMPLIANCES_PER_PAGE) + 1;
                        renderMatrixCompliances();
                    }
                    const tbody = document.getElementById('matrixComplianceTableBody');
                    const row = tbody ? Array.from(tbody.querySelectorAll('tr')).find(item => String(item.dataset.matrixComplianceId || '') === String(alert.recordId)) : null;
                    if (row) {
                        row.scrollIntoView({behavior:'smooth', block:'center'});
                        row.classList.add('scheduled-alert-row-highlight');
                        window.setTimeout(() => row.classList.remove('scheduled-alert-row-highlight'), 4500);
                    } else {
                        customAlert('The compliance record is no longer available in the register.', 'Record Unavailable');
                    }
                    window.setTimeout(() => scheduledAlertQueue.length ? showNextScheduledAlert() : pollScheduledAlerts(), 500);
                });
                return;
            }
            switchTab('activityManagement');
            window.requestAnimationFrame(async () => {
                if (!(allActivities || []).some(activity => String(activity.id) === String(alert.recordId))) await loadActivities();
                const activity = (allActivities || []).find(item => String(item.id) === String(alert.recordId));
                if (activity) showActivityDetails(activity.id, false);
                else customAlert('The scheduled activity is no longer available. Refresh Activity Management to review the latest records.', 'Record Unavailable');
                window.setTimeout(() => scheduledAlertQueue.length ? showNextScheduledAlert() : pollScheduledAlerts(), 500);
            });
        }

        function startActivityReminderMonitor() {
            if (activityReminderTimer) return;
            pollScheduledAlerts();
            activityReminderTimer = setInterval(pollScheduledAlerts, SCHEDULED_ALERT_POLL_MS);
        }

        function stopActivityReminderMonitor() {
            if (activityReminderTimer) clearInterval(activityReminderTimer);
            activityReminderTimer = null;
            scheduledAlertQueue = [];
            scheduledAlertQueueKeys.clear();
            activeActivityReminder = null;
            const modal = document.getElementById('activityReminderModal');
            if (modal) modal.classList.add('hidden');
        }

        function openScheduledAlertRecord(alert) {
            if (!alert) return;
            // Browser-native notification clicks use the same authorized in-app route.
            if (activeActivityReminder && String(activeActivityReminder.alertKey) === String(alert.alertKey)) {
                openActivityReminderRecord();
                return;
            }
            scheduledAlertQueue = scheduledAlertQueue.filter(item => String(item.alertKey) !== String(alert.alertKey));
            activeActivityReminder = alert;
            openActivityReminderRecord();
        }

        function chatCredentialPayload() {
            return {
                username: localStorage.getItem('loggedInUser') || '',
                credential: localStorage.getItem('loggedCred') || ''
            };
        }

        async function loadChatUsers() {
            const currentUser = localStorage.getItem('loggedInUser') || '';
            if (!currentUser) return;
            try {
                const auth = chatCredentialPayload();
                const res = await fetch(API_URL, {
                    method:'POST', mode:'cors',
                    headers:{'Content-Type':'text/plain;charset=utf-8'},
                    body:JSON.stringify({action:'get_chat_users', ...auth})
                });
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Unable to load chat users.');
                chatUsers = Array.isArray(data.users) ? data.users : [];
                chatUsersLoaded = true;
                const countEl = document.getElementById('chatActiveUsersCount');
                if (countEl) countEl.textContent = String(chatUsers.filter(u => String(u.username) !== String(currentUser)).length);
                if (chatSelectedUser && !chatUsers.some(u => String(u.username) === String(chatSelectedUser))) {
                    chatSelectedUser = '';
                    chatMode = 'global';
                }
                renderChatUserList();
            } catch (err) {
                console.error('Chat users:', err);
                const box = document.getElementById('chatDropdownUserList');
                if (box) box.innerHTML = '<div class="chat-empty-users">Unable to load users.</div>';
            }
        }

        function renderChatUserList() {
            const box = document.getElementById('chatDropdownUserList');
            if (!box) return;
            const q = String(document.getElementById('chatDropdownUserSearch')?.value || '').trim().toLowerCase();
            const currentUser = localStorage.getItem('loggedInUser') || '';
            const users = chatUsers.filter(u => String(u.username) !== String(currentUser))
                .filter(u => !q || `${u.name || ''} ${u.username || ''}`.toLowerCase().includes(q));
            if (!users.length) {
                box.innerHTML = '<div class="chat-empty-users">No other active users found.</div>';
                return;
            }
            box.innerHTML = users.map(u => {
                return `<button type="button" class="chat-user-item${chatMode === 'private' && String(chatSelectedUser) === String(u.username) ? ' is-active' : ''}" onclick="openUsersChatPage('private','${escapeAttr(u.username)}')" role="listitem">
                    <span class="chat-user-dot"></span>
                    <span class="chat-user-name">${escapeHtml(u.name || u.username)} <span style="opacity:.6;">(${escapeHtml(u.username)})</span> <small style="opacity:.75;margin-left:6px;cursor:pointer;text-decoration:underline;color:var(--primary);" onclick="event.stopPropagation();viewUserProfile('${escapeAttr(u.username)}')" title="View profile">view profile</small></span>
                </button>`;
            }).join('');
        }

        function setChatMode(mode) {
            chatMode = mode === 'private' ? 'private' : 'global';
            if (chatMode === 'global') chatSelectedUser = '';
            const title = document.getElementById('usersChatTitle');
            const subtitle = document.getElementById('usersChatSubtitle');
            if (chatMode === 'global') {
                if (title) title.innerText = 'Global Chat';
                if (subtitle) subtitle.innerText = 'Messages sent here are visible to all active users.';
            } else {
                if (title) title.innerText = chatSelectedUser ? `Private: ${chatSelectedUser}` : 'Private Chat';
                if (subtitle) subtitle.innerText = chatSelectedUser ? 'Only you and the selected user can see these messages.' : 'Select a user to start a private conversation.';
            }
            document.getElementById('usersChatGlobalBtn')?.classList.toggle('is-active', chatMode === 'global');
            renderChatUserList();
            loadChatMessages();
        }

        function selectPrivateChat(username) {
            chatSelectedUser = String(username || '');
            chatMode = 'private';
            setChatMode('private');
        }

        async function loadChatMessages() {
            if (!localStorage.getItem('loggedInUser')) return;
            if (chatMode === 'private' && !chatSelectedUser) {
                const box = document.getElementById('usersChatMessages');
                if (box) box.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:25px;">Select a user to start a private conversation.</div>';
                return;
            }
            try {
                const auth = chatCredentialPayload();
                const res = await fetch(API_URL, {
                    method:'POST', mode:'cors',
                    headers:{'Content-Type':'text/plain;charset=utf-8'},
                    body:JSON.stringify({action:'get_chat_messages', ...auth, mode:chatMode, withUser:chatSelectedUser})
                });
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Unable to load chat messages.');
                renderChatMessages(Array.isArray(data.messages) ? data.messages : []);
            } catch (err) {
                console.error('Chat messages:', err);
                const box = document.getElementById('usersChatMessages');
                if (box) box.innerHTML = '<div style="text-align:center;color:var(--danger);font-size:12px;padding:25px;">Unable to load messages.</div>';
            }
        }

        /**
         * Safe client-side file optimization. JPEG, PNG and WebP images are decoded,
         * optionally resized, re-encoded in their original format, and accepted only
         * when the resulting image validates and is strictly smaller. All other formats
         * (including PDF and Office documents) pass through unchanged.
         */
        function spadesFormatFileSize(bytes) {
            const n = Math.max(0, Number(bytes) || 0);
            if (!n) return '0 B';
            const units = ['B','KB','MB','GB'];
            const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
            const amount = n / Math.pow(1024, i);
            const formatted = i ? amount.toFixed(2).replace(/\.?0+$/, '') : String(Math.round(amount));
            return formatted + ' ' + units[i];
        }

        async function spadesOptimizeUploadFile(file, options = {}) {
            const originalSize = Number(file && file.size) || 0;
            const unchanged = (reason) => ({file, compressed:false, originalSize, optimizedSize:originalSize, savedBytes:0, savedPercent:0, reason:reason || 'unchanged'});
            if (!file || !originalSize) return unchanged('empty');
            const ext = String((file.name || '').split('.').pop() || '').toLowerCase();
            const suppliedType = String(file.type || '').toLowerCase();
            const typeByExtension = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
            const mime = suppliedType === 'image/jpg' ? 'image/jpeg' : ((suppliedType === 'application/octet-stream' || !suppliedType) ? (typeByExtension[ext] || suppliedType) : suppliedType);
            if (!['image/jpeg','image/png','image/webp'].includes(mime) || !['jpg','jpeg','png','webp'].includes(ext)) {
                return unchanged('unsupported-format');
            }
            if (typeByExtension[ext] !== mime) return unchanged('mime-extension-mismatch');
            if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return unchanged('image-optimizer-unavailable');
            let bitmap = null;
            try {
                bitmap = await createImageBitmap(file);
                const originalWidth = Number(bitmap.width) || 0;
                const originalHeight = Number(bitmap.height) || 0;
                if (!originalWidth || !originalHeight) return unchanged('invalid-image-dimensions');
                const maxDimension = Math.max(320, Number(options.maxDimension) || 2800);
                // Preserve every PNG pixel: these commonly contain scanned forms, certificates,
                // and other official documents. JPEG/WebP photos may be resized when oversized.
                const scale = mime === 'image/png' ? 1 : Math.min(1, maxDimension / Math.max(originalWidth, originalHeight));
                const width = Math.max(1, Math.round(originalWidth * scale));
                const height = Math.max(1, Math.round(originalHeight * scale));
                const threshold = mime === 'image/png' ? 600 * 1024 : 256 * 1024;
                if (scale === 1 && originalSize < threshold) return unchanged('already-optimized-or-small');
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                const context = canvas.getContext('2d', {alpha:mime === 'image/png'});
                if (!context) return unchanged('canvas-unavailable');
                context.imageSmoothingEnabled = true;
                context.imageSmoothingQuality = 'high';
                context.drawImage(bitmap, 0, 0, width, height);
                const quality = Math.min(0.94, Math.max(0.72, Number(options.quality) || (mime === 'image/webp' ? 0.88 : 0.90)));
                const blob = await new Promise((resolve, reject) => {
                    try { canvas.toBlob(result => result ? resolve(result) : reject(new Error('Image encoder returned no data.')), mime, mime === 'image/png' ? undefined : quality); }
                    catch (error) { reject(error); }
                });
                if (!blob || !blob.size || blob.type !== mime || blob.size >= originalSize) return unchanged('no-safe-size-reduction');
                // Decode the output once to verify that the optimized image is complete/readable.
                let validation = null;
                try {
                    validation = await createImageBitmap(blob);
                    if (validation.width !== width || validation.height !== height) return unchanged('optimized-image-validation-failed');
                } finally { if (validation && typeof validation.close === 'function') validation.close(); }
                const optimized = new File([blob], file.name, {type:mime, lastModified:file.lastModified || Date.now()});
                const savedBytes = originalSize - optimized.size;
                return {file:optimized, compressed:true, originalSize, optimizedSize:optimized.size, savedBytes, savedPercent:Math.round(savedBytes / originalSize * 100), reason:'compressed', width, height};
            } catch (error) {
                return unchanged('compression-failed');
            } finally {
                if (bitmap && typeof bitmap.close === 'function') bitmap.close();
            }
        }

        function spadesUploadOptimizationLabel(result) {
            if (!result) return 'No optimization details available.';
            const original = spadesFormatFileSize(result.originalSize);
            const optimized = spadesFormatFileSize(result.optimizedSize);
            if (!result.compressed) {
                const reason = result.reason;
                const explanation = reason === 'already-optimized-or-small' ? 'already optimized or too small to benefit' :
                    reason === 'unsupported-format' ? 'safe compression is not supported for this format' :
                    reason === 'mime-extension-mismatch' ? 'file type and extension did not match' :
                    reason === 'no-safe-size-reduction' ? 'no smaller safe version was produced' :
                    reason === 'empty' ? 'empty file' : 'safe compression was unavailable or failed';
                return 'Original ' + original + ' → uploaded ' + optimized + ' (unchanged; ' + explanation + ').';
            }
            return 'Original ' + original + ' → optimized ' + optimized + ' (' + result.savedPercent + '% saved).';
        }

        function formatChatFileSize(bytes) {
            const n = Number(bytes || 0);
            if (!n) return '0 B';
            const units = ['B','KB','MB','GB'];
            const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
            return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
        }

        function handleChatAttachmentChange(event) {
            const file = event?.target?.files?.[0] || null;
            if (!file) {
                clearChatAttachment();
                return;
            }
            chatAttachmentFile = file;
            const wrap = document.getElementById('usersChatAttachment');
            const name = document.getElementById('usersChatAttachmentName');
            if (name) name.textContent = `${file.name} · ${formatChatFileSize(file.size)}${file.size > CHAT_MAX_ATTACHMENT_BYTES ? ' · safe optimization will be attempted where supported before upload' : ''}`;
            wrap?.classList.remove('hidden');
        }

        function clearChatAttachment() {
            chatAttachmentFile = null;
            const input = document.getElementById('usersChatFile');
            const wrap = document.getElementById('usersChatAttachment');
            const name = document.getElementById('usersChatAttachmentName');
            if (input) input.value = '';
            if (name) name.textContent = '';
            wrap?.classList.add('hidden');
        }

        function readChatFileAsBase64(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const result = String(reader.result || '');
                    const comma = result.indexOf(',');
                    resolve(comma >= 0 ? result.slice(comma + 1) : result);
                };
                reader.onerror = () => reject(new Error('Unable to read the selected file.'));
                reader.readAsDataURL(file);
            });
        }

        function renderChatAttachmentMarkup(message) {
            const attachmentId = String(message?.attachmentId || '').trim();
            const name = String(message?.attachmentName || '').trim();
            if (!attachmentId || !name) return '';
            return `<button type="button" class="chat-attachment-link" data-chat-attachment-id="${escapeAttr(attachmentId)}" data-chat-attachment-name="${escapeAttr(name)}" onclick="openChatAttachment(this.dataset.chatAttachmentId,this.dataset.chatAttachmentName)" title="Open attachment">
                <span aria-hidden="true">📎</span><span>${escapeHtml(name)}</span>
            </button>`;
        }

        async function openChatAttachment(attachmentId, fileName) {
            const id = String(attachmentId || '').trim();
            if (!id) return customAlert('Attachment reference is missing.', 'Attachment Error');
            // Open synchronously during the click gesture so browser popup blockers
            // do not prevent the authenticated file from opening after the fetch.
            const popup = window.open('about:blank', '_blank');
            if (popup) {
                try {
                    popup.document.title = 'Opening SPADES attachment';
                    popup.document.body.textContent = 'Retrieving secure attachment…';
                } catch (_) {}
            }
            try {
                const auth = chatCredentialPayload();
                const response = await fetch(API_URL, {
                    method:'POST', mode:'cors', cache:'no-store',
                    headers:{'Content-Type':'text/plain;charset=utf-8'},
                    body:JSON.stringify({action:'get_chat_attachment',...auth,attachmentId:id})
                });
                const data = await response.json();
                if (!response.ok || !data || !data.success) throw new Error(data?.error || 'Unable to retrieve this attachment.');
                if (data.externalUrl) {
                    if (popup && !popup.closed) popup.location.replace(data.externalUrl);
                    else window.open(data.externalUrl, '_blank', 'noopener');
                    return;
                }
                if (!data.base64) throw new Error('The attachment data was empty.');
                const binary = atob(data.base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const blob = new Blob([bytes], {type:data.mimeType || 'application/octet-stream'});
                const objectUrl = URL.createObjectURL(blob);
                const safeName = String(data.name || fileName || 'chat-attachment').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
                if (popup && !popup.closed) popup.location.replace(objectUrl);
                else {
                    const link = document.createElement('a');
                    link.href = objectUrl; link.download = safeName; link.rel = 'noopener';
                    document.body.appendChild(link); link.click(); link.remove();
                }
                window.setTimeout(() => URL.revokeObjectURL(objectUrl), 120000);
            } catch (error) {
                if (popup && !popup.closed) popup.close();
                customAlert(error.message || 'Unable to open this attachment.', 'Attachment Error');
            }
        }

        function sanitizeChatMessageHtml(html) {
            const template = document.createElement('template');
            template.innerHTML = String(html || '');
            const walk = node => {
                if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue || '');
                if (node.nodeType !== Node.ELEMENT_NODE) return '';
                const tag = node.tagName.toLowerCase();
                const children = Array.from(node.childNodes).map(walk).join('');
                if (tag === 'br') return '<br>';
                if (tag === 'b' || tag === 'strong') return `<strong>${children}</strong>`;
                if (tag === 'i' || tag === 'em') return `<em>${children}</em>`;
                if (tag === 'u') return `<u>${children}</u>`;
                if (tag === 'div' || tag === 'p') return children + '<br>';
                return children;
            };
            let result = Array.from(template.content.childNodes).map(walk).join('');
            result = result.replace(/(?:<br>)+$/i, '');
            return result;
        }

        function renderChatMessages(messages) {
            const box = document.getElementById('usersChatMessages');
            if (!box) return;
            const currentUser = localStorage.getItem('loggedInUser') || '';
            if (!messages.length) {
                box.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:25px;">No messages yet. Start the conversation.</div>';
                return;
            }
            box.innerHTML = messages.map(m => {
                const mine = String(m.sender || '') === String(currentUser);
                const time = m.timestamp ? new Date(m.timestamp).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
                const body = sanitizeChatMessageHtml(m.message || '');
                const attachment = renderChatAttachmentMarkup(m);
                return `<div class="user-chat-message${mine ? ' mine' : ''}">
                    <div class="meta">${escapeHtml(m.sender || '')}${time ? ' · ' + escapeHtml(time) : ''}</div>
                    ${body ? `<div class="body">${body}</div>` : ''}
                    ${attachment}
                </div>`;
            }).join('');
            box.scrollTop = box.scrollHeight;
        }

        function applyChatFormat(command) {
            const input = document.getElementById('usersChatInput');
            if (!input) return;
            input.focus();
            try { document.execCommand(command, false, null); } catch (e) {}
            updateChatFormatState();
        }

        function updateChatFormatState() {
            ['bold','italic','underline'].forEach(command => {
                const button = document.querySelector(`.users-chat-format-toolbar button[onclick="applyChatFormat('${command}')"]`);
                if (!button) return;
                let active = false;
                try { active = document.queryCommandState(command); } catch (e) {}
                button.classList.toggle('active', !!active);
            });
        }

        function getChatComposerHtml() {
            const input = document.getElementById('usersChatInput');
            if (!input) return '';
            return sanitizeChatMessageHtml(input.innerHTML).trim();
        }

        function clearChatComposer() {
            const input = document.getElementById('usersChatInput');
            if (input) input.innerHTML = '';
            updateChatFormatState();
        }

        function handleUsersChatKeydown(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendUsersChatMessage();
            }
        }

        async function sendUsersChatMessage() {
            const input = document.getElementById('usersChatInput');
            const message = getChatComposerHtml();
            if (!message && !chatAttachmentFile) return;
            if (chatMode === 'private' && !chatSelectedUser) return customAlert('Select a user before sending a private message.', 'Chat');
            const btn = document.querySelector('.users-chat-send');
            if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.setAttribute('aria-label', 'Sending message'); }
            try {
                const auth = chatCredentialPayload();
                let attachment = null;
                if (chatAttachmentFile) {
                    const selectedFile = chatAttachmentFile;
                    const optimization = await spadesOptimizeUploadFile(selectedFile);
                    const uploadFile = optimization.file || selectedFile;
                    if (uploadFile.size > CHAT_MAX_ATTACHMENT_BYTES) throw new Error('The selected file exceeds 10 MB and could not be reduced safely. Choose a smaller file.');
                    let base64;
                    try { base64 = await readChatFileAsBase64(uploadFile); }
                    catch (readErr) {
                        clearChatAttachment();
                        throw readErr;
                    }
                    {
                        const attachmentName = document.getElementById('usersChatAttachmentName');
                        if (attachmentName) attachmentName.textContent = selectedFile.name + ' · ' + spadesUploadOptimizationLabel(optimization);
                    }
                    attachment = {
                        name: selectedFile.name,
                        mimeType: uploadFile.type || selectedFile.type || 'application/octet-stream',
                        size: uploadFile.size,
                        base64: base64
                    };
                }
                const res = await fetch(API_URL, {
                    method:'POST', mode:'cors',
                    headers:{'Content-Type':'text/plain;charset=utf-8'},
                    body:JSON.stringify({
                        action:'send_chat_message', ...auth,
                        recipient:chatMode === 'private' ? chatSelectedUser : '',
                        message:message,
                        type:chatMode === 'private' ? 'Private' : 'Global',
                        attachment:attachment
                    })
                });
                let data;
                try {
                    data = await res.json();
                } catch (parseErr) {
                    throw new Error('The server returned an invalid response. Confirm that the current Web App deployment is being used and that it executes as the account with access to the Chat Attachments folder.');
                }
                if (!data.success) throw new Error(data.error || 'Unable to send message.');
                clearChatComposer();
                clearChatAttachment();
                await loadChatMessages();
            } catch (err) {
                customAlert(err.message || 'Unable to send message.', 'Chat Error');
            } finally {
                if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
                input?.focus();
            }
        }

        function getChatPopupContainer() {
            return document.getElementById('incomingChatContainer');
        }

        function chatNotificationDisplayName(message) {
            const sender = String(message?.sender || '').trim();
            const found = chatUsers.find(u => String(u.username) === sender);
            return found?.name || sender || 'New message';
        }

        function chatPopupInitials(name) {
            const clean = String(name || '').trim();
            if (!clean) return '💬';
            const parts = clean.split(/\s+/).filter(Boolean);
            return (parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0,2)).toUpperCase();
        }

        function dismissIncomingChatPopup(popup) {
            if (!popup) return;
            popup.classList.add('removing');
            setTimeout(() => popup.remove(), 220);
        }

        function openIncomingChatMessage(message) {
            const type = String(message?.type || 'Global').toLowerCase() === 'private' ? 'private' : 'global';
            if (type === 'private') {
                openUsersChatPage('private', String(message.sender || ''));
            } else {
                openUsersChatPage('global');
            }
        }

        function showIncomingChatPopup(message) {
            const container = getChatPopupContainer();
            if (!container || !message) return;

            const sender = chatNotificationDisplayName(message);
            const isPrivate = String(message.type || '').toLowerCase() === 'private';
            const popup = document.createElement('div');
            popup.className = 'incoming-chat-popup';
            popup.setAttribute('role', 'button');
            popup.setAttribute('tabindex', '0');

            const avatar = document.createElement('div');
            avatar.className = 'incoming-chat-avatar';
            avatar.textContent = chatPopupInitials(sender);

            const content = document.createElement('div');
            content.className = 'incoming-chat-content';
            const title = document.createElement('div');
            title.className = 'incoming-chat-title';
            const senderEl = document.createElement('span');
            senderEl.className = 'incoming-chat-sender';
            senderEl.textContent = sender;
            const typeEl = document.createElement('span');
            typeEl.className = 'incoming-chat-type';
            typeEl.textContent = isPrivate ? 'Private' : 'Global';
            title.append(senderEl, typeEl);

            const body = document.createElement('div');
            body.className = 'incoming-chat-message';
            const messageText = String(message.message || '').trim();
            const attachmentName = String(message.attachmentName || '').trim();
            body.textContent = messageText || (attachmentName ? `📎 ${attachmentName}` : 'Attachment');

            const time = document.createElement('div');
            time.className = 'incoming-chat-time';
            try {
                time.textContent = message.timestamp
                    ? new Date(message.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
                    : 'Now';
            } catch (e) { time.textContent = 'Now'; }

            content.append(title, body, time);

            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'incoming-chat-close';
            close.setAttribute('aria-label', 'Dismiss notification');
            close.textContent = '×';
            close.onclick = (event) => {
                event.stopPropagation();
                dismissIncomingChatPopup(popup);
            };

            popup.append(avatar, content, close);
            popup.onclick = () => {
                dismissIncomingChatPopup(popup);
                openIncomingChatMessage(message);
            };
            popup.onkeydown = (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    popup.click();
                }
            };

            container.prepend(popup);

            while (container.children.length > CHAT_POPUP_MAX) {
                container.lastElementChild?.remove();
            }

            // Sound is handled by the application notification toast so each new message plays once.
        }

        async function pollChatNotifications() {
            const currentUser = localStorage.getItem('loggedInUser');
            if (!currentUser) return;

            try {
                const auth = chatCredentialPayload();
                const res = await fetch(API_URL, {
                    method:'POST',
                    mode:'cors',
                    headers:{'Content-Type':'text/plain;charset=utf-8'},
                    body:JSON.stringify({
                        action:'get_chat_notifications',
                        ...auth,
                        since: chatNotificationSince
                    })
                });
                const data = await res.json();
                if (!data.success) return;

                const messages = Array.isArray(data.messages) ? data.messages : [];

                // The first successful poll establishes the baseline and prevents
                // old messages from producing a burst of popups after login/refresh.
                if (!chatNotificationInitialized) {
                    chatNotificationInitialized = true;
                    const newest = messages.reduce((max, m) => {
                        const ts = new Date(m.timestamp || 0).getTime();
                        return Math.max(max, isNaN(ts) ? 0 : ts);
                    }, chatNotificationSince || 0);
                    if (newest > chatNotificationSince) chatNotificationSince = newest;
                    return;
                }

                const newMessages = [];
                messages.forEach(message => {
                    const ts = new Date(message.timestamp || 0).getTime();
                    if (!isNaN(ts) && ts > chatNotificationSince) {
                        newMessages.push(message);
                    }
                });

                if (newMessages.length) {
                    newMessages.forEach(message => {
                        const ts = new Date(message.timestamp || 0).getTime();
                        if (!isNaN(ts)) chatNotificationSince = Math.max(chatNotificationSince, ts);

                        const messageMode = String(message.type || '').toLowerCase() === 'private' ? 'private' : 'global';
                        const messageUser = messageMode === 'private' ? String(message.sender || '') : '';
                        const conversationOpen = isCurrentChatConversation(messageMode, messageUser);

                        if (!conversationOpen) markChatConversationUnread(messageMode, messageUser);

                        const sender = chatNotificationDisplayName(message);
                        const preview = String(message.message || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                        showIncomingChatPopup(message);
                        showNotification(
                            messageMode === 'private' ? 'New Private Message' : 'New Global Message',
                            `${sender}: ${preview || (message.attachmentName ? 'sent an attachment.' : 'sent a message.')}`,
                            () => openIncomingChatMessage(message)
                        );
                    });
                }
            } catch (err) {
                // Notification polling must never interrupt the main application.
                console.debug('Chat notification polling:', err);
            }
        }

        function startChatNotificationMonitor() {
            if (chatNotificationTimer) clearInterval(chatNotificationTimer);
            chatNotificationSince = Date.now();
            chatNotificationInitialized = false;
            pollChatNotifications();
            chatNotificationTimer = setInterval(pollChatNotifications, CHAT_NOTIFICATION_POLL_MS);
        }

        function stopChatNotificationMonitor() {
            if (chatNotificationTimer) {
                clearInterval(chatNotificationTimer);
                chatNotificationTimer = null;
            }
            chatNotificationInitialized = false;
            chatNotificationSince = 0;
            resetChatUnreadState();
        }

        function unlockNotificationAudio() {
            // Browsers may require a user gesture before allowing notification audio.
            // A silent, short-lived AudioContext is used only to unlock playback.
            try {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) return;
                if (!window.__rhsuAudioContext) window.__rhsuAudioContext = new Ctx();
                if (window.__rhsuAudioContext.state === 'suspended') {
                    window.__rhsuAudioContext.resume().catch(() => {});
                }
            } catch (e) {}
        }

        document.addEventListener('pointerdown', unlockNotificationAudio, {passive:true});
        document.addEventListener('keydown', unlockNotificationAudio, {passive:true});

        function chatConversationKey(mode = chatMode, username = chatSelectedUser) {
            return mode === 'private' ? `private:${String(username || '').trim()}` : 'global';
        }

        function updateChatUnreadBadge() {
            const badge = document.getElementById('usersChatUnreadBadge');
            if (!badge) return;
            const count = Math.max(0, Number(chatUnreadCount) || 0);
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.classList.toggle('hidden', count === 0);
            badge.setAttribute('aria-label', `${count} unread chat message${count === 1 ? '' : 's'}`);
        }

        function markChatConversationUnread(mode, username) {
            const key = chatConversationKey(mode, username);
            chatUnreadByConversation[key] = (Number(chatUnreadByConversation[key]) || 0) + 1;
            chatUnreadCount += 1;
            updateChatUnreadBadge();
        }

        function markChatConversationRead(mode, username) {
            const key = chatConversationKey(mode, username);
            const amount = Math.max(0, Number(chatUnreadByConversation[key]) || 0);
            if (amount) chatUnreadCount = Math.max(0, chatUnreadCount - amount);
            delete chatUnreadByConversation[key];
            updateChatUnreadBadge();
        }

        function resetChatUnreadState() {
            chatUnreadCount = 0;
            Object.keys(chatUnreadByConversation).forEach(key => delete chatUnreadByConversation[key]);
            updateChatUnreadBadge();
        }

        function isCurrentChatConversation(mode, username) {
            const page = document.getElementById('tabUsersChat');
            if (!page || page.classList.contains('hidden')) return false;
            if (mode === 'private') return chatMode === 'private' && String(chatSelectedUser || '') === String(username || '');
            return chatMode === 'global';
        }

        // Users Chat is a normal application page, not a floating popup or modal.
        // Keep its conversation panel inside tabUsersChat so it follows page navigation.
        function ensureUsersChatPageConversation() {
            const page = document.getElementById('tabUsersChat');
            const panel = document.getElementById('usersChatConversationPanel');
            const layout = page?.querySelector('.users-chat-page-layout');
            if (!page || !panel || !layout) return null;
            if (panel.parentElement !== layout) layout.appendChild(panel);
            panel.classList.remove('users-chat-floating', 'hidden');
            panel.classList.add('users-chat-page-conversation');
            panel.setAttribute('role', 'region');
            panel.setAttribute('aria-label', 'Chat conversation');
            panel.setAttribute('aria-hidden', 'false');
            panel.removeAttribute('aria-modal');
            return panel;
        }

        function startUsersChatMessageRefresh() {
            if (chatMessagesTimer) clearInterval(chatMessagesTimer);
            chatMessagesTimer = setInterval(() => {
                const page = document.getElementById('tabUsersChat');
                if (!page || page.classList.contains('hidden')) {
                    clearInterval(chatMessagesTimer);
                    chatMessagesTimer = null;
                    return;
                }
                loadChatMessages();
                if (!chatUsersLoaded) loadChatUsers();
            }, 5000);
        }

        function openUsersChatPage(mode = 'global', username = '') {
            if (mode === 'private' && !username) return;
            chatMode = mode === 'private' ? 'private' : 'global';
            chatSelectedUser = chatMode === 'private' ? String(username) : '';

            const page = document.getElementById('tabUsersChat');
            if (!page) {
                console.warn('Users Chat page was not found.');
                return;
            }
            if (page.classList.contains('hidden')) switchTab('usersChat', { fromChat: true });
            const conversation = ensureUsersChatPageConversation();
            if (!conversation) return;

            try { markChatConversationRead(chatMode, chatSelectedUser); }
            catch (error) { console.warn('Unable to update chat read state:', error); }
            setChatMode(chatMode);
            if (!chatUsersLoaded) loadChatUsers();
            else renderChatUserList();
            startUsersChatMessageRefresh();
            window.setTimeout(() => document.getElementById('usersChatInput')?.focus({preventScroll:true}), 40);
        }

        function startUsersChat() {
            chatUsersLoaded = false;
            loadChatUsers();
        }

        // Place the chat conversation panel in its dedicated page container once at startup.
        ensureUsersChatPageConversation();

        function toggleChat(forceState) {
            const panel = document.getElementById('chatbot-window');
            const bubble = document.getElementById('chatbot-bubble');
            if (!panel) return;
            const open = typeof forceState === 'boolean' ? forceState : panel.classList.contains('hidden');
            panel.classList.toggle('hidden', !open);
            bubble?.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (open) setTimeout(() => document.getElementById('chatInput')?.focus(), 50);
        }

        function appendChatbotMessage(role, text, className = '') {
            const chatBox = document.getElementById('chatMessages');
            if (!chatBox) return null;
            const node = document.createElement('div');
            node.className = `chat-msg ${role === 'user' ? 'user' : 'bot'}${className ? ' ' + className : ''}`;
            node.textContent = String(text || '');
            chatBox.appendChild(node);
            chatBox.scrollTop = chatBox.scrollHeight;
            return node;
        }

        function handleChat(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendChatbotMessage();
            }
        }

        function chatbotAttachmentMime(file) {
            const name = String(file?.name || '').toLowerCase();
            const type = String(file?.type || '').toLowerCase();
            if (name.endsWith('.pdf') || type === 'application/pdf') return 'application/pdf';
            if (name.endsWith('.png') || type === 'image/png') return 'image/png';
            if (name.endsWith('.jpg') || name.endsWith('.jpeg') || type === 'image/jpeg') return 'image/jpeg';
            if (name.endsWith('.webp') || type === 'image/webp') return 'image/webp';
            if (name.endsWith('.txt') || type === 'text/plain') return 'text/plain';
            return '';
        }

        function handleChatbotAttachmentChange(event) {
            const file = event?.target?.files?.[0] || null;
            if (!file) { clearChatbotAttachment(); return; }
            const mimeType = chatbotAttachmentMime(file);
            if (!mimeType) {
                clearChatbotAttachment();
                customAlert('Choose a PDF, TXT, PNG, JPG, or WEBP file. Other formats are not supported by the AI attachment service.', 'Unsupported Attachment');
                return;
            }
            const limit = mimeType === 'text/plain' ? 512 * 1024 : CHATBOT_MAX_ATTACHMENT_BYTES;
            if (!file.size || file.size > limit) {
                clearChatbotAttachment();
                customAlert(mimeType === 'text/plain' ? 'TXT attachments are limited to 512 KB.' : 'AI attachments are limited to 8 MB.', 'Attachment Too Large');
                return;
            }
            chatbotAttachmentFile = file;
            const name = document.getElementById('chatbotAttachmentName');
            const preview = document.getElementById('chatbotAttachmentPreview');
            if (name) name.textContent = `${file.name} · ${formatChatFileSize(file.size)}`;
            preview?.classList.remove('hidden');
        }

        function clearChatbotAttachment() {
            chatbotAttachmentFile = null;
            const input = document.getElementById('chatbotFileInput');
            const preview = document.getElementById('chatbotAttachmentPreview');
            const name = document.getElementById('chatbotAttachmentName');
            if (input) input.value = '';
            if (name) name.textContent = '';
            preview?.classList.add('hidden');
        }

        async function sendChatbotMessage() {
            const input = document.getElementById('chatInput');
            const sendButton = document.getElementById('chatSendBtn');
            const attachButton = document.getElementById('chatbotAttachBtn');
            const text = String(input?.value || '').trim();
            const selectedFile = chatbotAttachmentFile;
            if ((!text && !selectedFile) || chatbotRequestInFlight) return;
            if (text.length > 1600) return appendChatbotMessage('bot', 'Please keep your question under 1,600 characters.');

            const question = text || 'Please examine the attached file and summarize its contents, important points, and any concerns.';
            chatbotRequestInFlight = true;
            if (input) input.value = '';
            if (sendButton) { sendButton.disabled = true; sendButton.setAttribute('aria-busy', 'true'); sendButton.setAttribute('aria-label', 'Sending message'); }
            if (attachButton) attachButton.disabled = true;
            appendChatbotMessage('user', selectedFile ? `${question}\n📎 ${selectedFile.name}` : question);
            const typing = appendChatbotMessage('bot', 'Thinking…', 'chatbot-typing');

            try {
                const payload = {
                    action: 'ai_chat',
                    username: localStorage.getItem('loggedInUser') || '',
                    credential: localStorage.getItem('loggedCred') || '',
                    message: question,
                    history: chatbotHistory.slice(-8),
                    currentPage: getCurrentSpadesPageKey()
                };
                if (selectedFile) {
                    const base64 = await readChatFileAsBase64(selectedFile);
                    payload.attachment = {name:selectedFile.name,mimeType:chatbotAttachmentMime(selectedFile),size:selectedFile.size,base64:base64};
                }
                const response = await fetch(API_URL, {
                    method: 'POST', mode: 'cors',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify(payload)
                });
                let data = {};
                try { data = await response.json(); } catch (parseError) { throw new Error('The AI service returned an unreadable response.'); }
                if (!response.ok || !data.success) throw new Error(data.error || 'The AI service is temporarily unavailable.');
                const answer = String(data.reply || '').trim();
                if (!answer) throw new Error('The AI assistant returned an empty response.');
                if (typing) typing.remove();
                appendChatbotMessage('bot', answer);
                chatbotHistory.push({ role: 'user', content: selectedFile ? `${question} [Attached file: ${selectedFile.name}]` : question }, { role: 'assistant', content: answer });
                chatbotHistory = chatbotHistory.slice(-12);
                clearChatbotAttachment();
            } catch (error) {
                if (typing) typing.remove();
                const message = String(error?.message || 'AI service unavailable');
                const localGuide = getChatbotResponse(text.toLowerCase());
                let fallback;
                if (message.toLowerCase().includes('gemini_api_key') || message.toLowerCase().includes('not configured')) {
                    fallback = `The AI service has not been configured by the system administrator yet. Here is a quick built-in guide in the meantime: ${localGuide}`;
                } else if (message.toLowerCase().includes('too many') || message.toLowerCase().includes('rate limit')) {
                    fallback = `The AI assistant is receiving several requests right now. Please try again shortly. ${localGuide}`;
                } else {
                    fallback = `I could not reach the AI service at the moment. ${localGuide}`;
                }
                appendChatbotMessage('bot', fallback);
                console.warn('SPADES AI request failed:', message);
            } finally {
                chatbotRequestInFlight = false;
                if (sendButton) { sendButton.disabled = false; sendButton.removeAttribute('aria-busy'); sendButton.setAttribute('aria-label', 'Send message'); }
                if (attachButton) attachButton.disabled = false;
                input?.focus();
            }
        }

        function getCurrentSpadesPageKey() {
            const routes = [
                ['dashboard','tabDashboard'],['home','tabHome'],['personnel','tabPersonnel'],
                ['activityManagement','tabActivityManagement'],['matrixCompliances','tabMatrixCompliances'],
                ['adminProofReader','tabAdminProofReader'],['usersChat','tabUsersChat'],['settings','tabSettings'],['myProfile','tabProfile'],
                ['adminMgmt','tabAdminMgmt']
            ];
            const current = routes.find(([, id]) => { const el = document.getElementById(id); return el && !el.classList.contains('hidden'); });
            if (!current) return 'unknown';
            // Include the selected Personnel Management sub-page so the AI can
            // tailor steps to Personnel List, BMI, Squadding, and other sections.
            if (current[0] === 'personnel') return 'personnel:' + String(currentPersonnelSubPage || 'list');
            return current[0];
        }

        function getChatbotResponse(query) {
            if (query.includes('quick access') || query.includes('gear icon')) return 'The Dashboard Quick Access button and its dedicated panel have been removed. Use the main navigation menu and the existing Dashboard action buttons to reach available functions.';
            if (query.includes('week view') || query.includes('weekly view')) return 'Activity Management uses Month View only. Weekly recurring activities are still supported; only the calendar Week View display has been removed.';
            if (query.includes('alert') || query.includes('reminder') || query.includes('notification')) return 'SPADES provides separate in-app reminders at the 3-hour and 1-hour thresholds for eligible scheduled Activities and Matrix of Compliances records. Activity alerts require a valid activity time; Compliance alerts require an explicitly saved Target Time. Alerts run while you are signed in with SPADES open; browser notifications also require prior browser permission.';
            if (query.includes('compliance')) return 'Open Matrix of Compliances to view the shared compliance calendar and register. Add or edit a record using its Target Date, responsible Office In-charge, and recurrence fields. Target Time is optional; only a saved exact time enables 3-hour and 1-hour reminders. Existing date-only records remain unchanged.';
            if (query.includes('my files') || query.includes('file browser') || query.includes('upload file')) return 'Open My Files to manage your account workspace, or use the relevant Personnel File Browser for a personnel folder. You can upload, preview, download, and manage supported files. JPEG, PNG, and WebP images are optimized only when a valid smaller output is produced; other file types upload unchanged.';
            if (query.includes('bmi')) return 'Open Personnel Management, then BMI Monitoring. Use the available personnel list and month-specific BMI entries, subject to your account permissions.';
            if (query.includes('leave')) return 'Open Personnel Management, then Leave Management to review or manage leave entries available to your account.';
            if (query.includes('squad')) return 'Open Personnel Management, then Squadding to review the existing squad assignments and related records.';
            if (query.includes('area of responsibilit') || query.includes('aor')) return 'Open Personnel Management, then Area of Responsibilities to review assigned areas and personnel. Editing and deletion remain subject to record ownership and permissions.';
            if (query.includes('filter by section') || query.includes('section filter')) return 'Open Personnel Management, then Personnel List. Use the Filter by Section dropdown alongside the existing search and filters. All Sections restores the complete list for the currently selected Active or Archive view.';
            if (query.includes('compress') || query.includes('upload image') || query.includes('file size')) return 'My Files and supported file-upload interfaces safely optimize JPEG, PNG, and WebP images when the optimized file validates and is smaller. Other formats, including PDF and Office documents, are uploaded unchanged to protect their contents.';
            if (query.includes('memo') || query.includes('control number')) return 'Open Memo Database to encode or review memorandums. Choose Create New Memo, complete the required fields, and submit. After saving, copy the generated control number and use search or filters to locate existing records. Only users with the appropriate permissions can edit or delete records.';
            if (query.includes('duty office') || query.includes('duty sequence')) return 'Go to Personnel Management, then Duty Office. Authorized personnel can open Modify Duty Sequence to search the rotation, add active personnel, remove a name from the rotation, and change order before saving.';
            if (query.includes('activity')) return 'Open Activity Management to review the Month View calendar. Event cards show the activity title, time where available, and status; use + MORE to open all activities for a date. Add Activity creates a schedule, and View Data opens existing records. Eligible timed activities have 3-hour and 1-hour in-app reminders while SPADES is open and you are signed in. Weekly recurrence remains supported.';
            if (query.includes('personnel')) return 'Open Personnel Management and choose the relevant sub-page, such as Personnel List, Duty Office, BMI Monitoring, Squadding, Leave Management, or Area of Responsibilities.';
            if (query.includes('admin') || query.includes('user management') || query.includes('permission')) return 'User Management is reserved for the configured Alpha Admin. Access and editing options elsewhere depend on your assigned role and permissions.';
            if (query.includes('profile') || query.includes('password') || query.includes('pin') || query.includes('cover photo')) return 'Open My Profile to review your information. Use Profile Settings or Security & Authentication to update supported account settings. The profile banner can be changed from the Change Cover button.';
            if (query.includes('chat') || query.includes('message')) return 'Open Users Chat from the main navigation. Choose Global Chat or select an active user for a private conversation. Do not send passwords, PINs, or sensitive information in chat.';
            if (query.includes('setting') || query.includes('theme') || query.includes('dark mode') || query.includes('notification')) return 'Open Settings to adjust theme, notifications, AI assistant visibility, automatic logout, table display, accessibility, and other personal preferences.';
            return 'I can help explain SPADES workflows for memos, personnel, Duty Office, Activity Management, profile settings, and Users Chat. For account permissions or official records, rely on the data shown in the portal and your office guidance.';
        }

        function toggleAuthViews(viewId) { document.getElementById('loginPage').classList.add('hidden'); document.getElementById('registerPage').classList.add('hidden'); document.getElementById('appLayout').classList.add('hidden'); document.getElementById('mainTopBar').classList.add('hidden'); document.getElementById(viewId).classList.remove('hidden'); }
        function isAlphaAdminLoginName(value) { const configured = String(ALPHA_ADMIN_NAME || '').trim(); return !!configured && String(value || '').trim().toLowerCase() === configured.toLowerCase(); }
        function syncAlphaAdminLoginCredentialField() {
            const input = document.getElementById('loginCredential');
            const usernameInput = document.getElementById('loginUsername');
            if (!input || !usernameInput) return;
            if (isAlphaAdminLoginName(usernameInput.value)) {
                // Alpha Admin may use a legacy PIN or a longer password. Do not
                // let the default PIN-mode maxlength truncate the credential.
                input.placeholder = 'Enter Alpha Admin PIN or password';
                input.setAttribute('maxlength', '128');
                input.removeAttribute('inputmode');
                input.setAttribute('autocomplete', 'current-password');
                return;
            }
            const mode = document.querySelector('input[name="loginType"]:checked')?.value || 'pin';
            if (mode === 'pin') {
                input.placeholder = 'Enter your PIN';
                // Keep login backward-compatible with legacy credentials longer than six digits.
                // New PIN length rules remain enforced when credentials are created or changed.
                input.setAttribute('maxlength', '128');
                input.setAttribute('inputmode', 'numeric');
            } else {
                input.placeholder = 'Enter your password';
                input.setAttribute('maxlength', '128');
                input.removeAttribute('inputmode');
            }
        }
        function toggleInputType(inputId, type) {
            const input = document.getElementById(inputId);
            if (!input) return;
            if (inputId === 'loginCredential' && isAlphaAdminLoginName(document.getElementById('loginUsername')?.value)) {
                syncAlphaAdminLoginCredentialField();
                input.value = '';
                return;
            }
            if (type === 'pin') {
                input.placeholder = inputId === 'loginCredential' ? 'Enter your PIN' : 'Enter 6-Digit PIN';
                input.setAttribute('maxlength', '128');
                input.setAttribute('inputmode', 'numeric');
            } else {
                input.placeholder = inputId === 'loginCredential' ? 'Enter your password' : 'Enter password (10+ characters)';
                input.setAttribute('maxlength', '128');
                input.removeAttribute('inputmode');
            }
            input.value = '';
        }
        document.getElementById('loginUsername')?.addEventListener('input', syncAlphaAdminLoginCredentialField);

        // Google Drive may return different redirects for view links. Prefer its image thumbnail
        // endpoint, then retry the direct view URL so uploaded avatars render reliably in <img> tags.
        function extractDriveImageId(url) {
            const value = String(url || '').trim();
            if (!value) return '';
            try {
                const parsed = new URL(value, window.location.href);
                const queryId = parsed.searchParams.get('id');
                if (queryId) return queryId;
            } catch (_) {}
            const match = value.match(/\/file\/d\/([^/?#]+)|\/d\/([^/?#]+)/i);
            return match ? (match[1] || match[2] || '') : '';
        }

        function getProfileImageCandidates(url) {
            const raw = String(url || '').trim();
            if (!raw) return [];
            const id = extractDriveImageId(raw);
            const cacheKey = 'spades=' + Date.now();
            const withCacheBust = value => value + (value.includes('?') ? '&' : '?') + cacheKey;
            const candidates = [];
            if (id) {
                candidates.push(withCacheBust('https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w512'));
                candidates.push(withCacheBust('https://drive.google.com/uc?export=view&id=' + encodeURIComponent(id)));
            }
            candidates.push(withCacheBust(raw));
            return [...new Set(candidates)];
        }

        function setProfileImageDisplay(imageEl, fallbackEl, imageUrl, fallbackInitial) {
            if (!imageEl || !fallbackEl) return;
            const initial = String(fallbackInitial || 'U').trim().charAt(0).toUpperCase() || 'U';
            fallbackEl.textContent = initial;
            fallbackEl.style.display = 'flex';
            imageEl.style.display = 'none';
            imageEl.style.objectFit = 'cover';
            imageEl.style.objectPosition = 'center';
            imageEl.decoding = 'async';
            imageEl.loading = 'eager';

            const candidates = getProfileImageCandidates(imageUrl);
            if (!candidates.length) {
                imageEl.removeAttribute('src');
                imageEl.onload = null;
                imageEl.onerror = null;
                return;
            }

            let candidateIndex = 0;
            imageEl.onload = function () {
                imageEl.style.display = 'block';
                fallbackEl.style.display = 'none';
            };
            imageEl.onerror = function () {
                candidateIndex += 1;
                if (candidateIndex < candidates.length) {
                    imageEl.src = candidates[candidateIndex];
                } else {
                    imageEl.style.display = 'none';
                    fallbackEl.style.display = 'flex';
                }
            };
            imageEl.src = candidates[candidateIndex];
        }

        function profilePhotoCacheKey(username, photoType) {
            const userKey = String(username || '').trim().toLowerCase();
            const typeKey = String(photoType || 'profile').trim().toLowerCase() === 'cover' ? 'cover' : 'profile';
            return 'spades.savedPhoto.' + typeKey + '.' + encodeURIComponent(userKey);
        }
        // Temp photo links (e.g. signed/shared URLs) can expire. Bound the cache lifetime
        // so a stale entry is dropped and a fresh URL is fetched from the server instead.
        const PROFILE_PHOTO_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
        function getCachedProfilePhotoUrl(username, photoType) {
            try {
                const raw = localStorage.getItem(profilePhotoCacheKey(username, photoType));
                if (!raw) return '';
                const sep = raw.indexOf('|');
                if (sep < 0) {
                    // Old cache entry without a timestamp — treat as stale and force a fresh fetch.
                    try { localStorage.removeItem(profilePhotoCacheKey(username, photoType)); } catch (_) {}
                    return '';
                }
                const ts = Number(raw.slice(0, sep));
                if (!ts || (Date.now() - ts) > PROFILE_PHOTO_CACHE_TTL_MS) {
                    try { localStorage.removeItem(profilePhotoCacheKey(username, photoType)); } catch (_) {}
                    return '';
                }
                return raw.slice(sep + 1);
            } catch (_) { return ''; }
        }
        function rememberProfilePhotoUrl(username, photoType, url) {
            const safeUrl = String(url || '').trim();
            if (!username || !safeUrl) return;
            try { localStorage.setItem(profilePhotoCacheKey(username, photoType), Date.now() + '|' + safeUrl); }
            catch (_) { /* Backend cloud storage remains the source of truth if browser storage is full/disabled. */ }
        }
        function applyProfilePhotos(profileUrl) {
            const av = document.getElementById('profileAvatarImg');
            const fb = document.getElementById('profileAvatarFallback');
            const displayName = document.getElementById('profileDisplayName')?.textContent || localStorage.getItem('loggedInUser') || 'U';
            const resolvedUrl = profileUrl || getCachedProfilePhotoUrl(localStorage.getItem('loggedInUser'), 'profile');
            setProfileImageDisplay(av, fb, resolvedUrl, displayName);
            syncProfilePictureModalPreview(resolvedUrl, displayName);
        }
        function syncProfilePictureModalPreview(url, displayName) {
            const preview = document.getElementById('profilePictureModalPreview');
            const fallback = document.getElementById('profilePictureModalFallback');
            if (!preview || !fallback) return;
            const name = displayName || document.getElementById('profileDisplayName')?.textContent || localStorage.getItem('loggedInUser') || 'U';
            if (url) {
                preview.onerror = () => { preview.style.display = 'none'; fallback.style.display = 'flex'; fallback.textContent = String(name).trim().charAt(0).toUpperCase() || 'U'; };
                preview.src = url;
                preview.style.display = 'block';
                fallback.style.display = 'none';
            } else {
                preview.removeAttribute('src');
                preview.style.display = 'none';
                fallback.textContent = String(name).trim().charAt(0).toUpperCase() || 'U';
                fallback.style.display = 'flex';
            }
        }
        function openProfilePictureModal() {
            const modal = document.getElementById('profilePictureModal');
            if (!modal) return;
            const avatar = document.getElementById('profileAvatarImg');
            const cachedUrl = getCachedProfilePhotoUrl(localStorage.getItem('loggedInUser'), 'profile');
            const visibleAvatarUrl = avatar && avatar.style.display !== 'none' ? avatar.src : '';
            syncProfilePictureModalPreview(cachedUrl || visibleAvatarUrl, document.getElementById('profileDisplayName')?.textContent);
            modal.classList.remove('hidden');
            modal.setAttribute('aria-hidden','false');
            modal.querySelector('.profile-picture-modal')?.focus({preventScroll:true});
        }
        function closeProfilePictureModal() {
            const modal = document.getElementById('profilePictureModal');
            if (modal) { modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true'); }
        }
        function chooseProfilePictureFromModal() {
            const input = document.getElementById('avatarPhotoInput');
            if (input && !input.disabled) input.click();
        }
        function applyProfileCover(coverUrl) {
            const cover = document.getElementById('profileCoverBanner');
            if (!cover) return;
            const fallback = 'image-set(url("images/SPADES%20Banner.webp") type("image/webp"), url("images/SPADES%20Banner.jpg") type("image/jpeg"))';
            const selected = String(coverUrl || '').trim();
            // Keep the banner visible if a saved cloud-storage image is missing or blocked.
            cover.style.backgroundImage = selected
                ? `linear-gradient(90deg, rgba(5,18,48,.12), rgba(5,18,48,.08)), url("${selected.replace(/[\"\\]/g, '')}")`
                : fallback;
            cover.style.backgroundSize = 'cover';
            cover.style.backgroundPosition = 'center center';
            cover.style.backgroundRepeat = 'no-repeat';
        }

        async function uploadProfilePhoto(type, inputEl) {
            const file = inputEl.files && inputEl.files[0];
            if (!file) return;
            if (file.type && !['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type.toLowerCase())) {
                customAlert('Please select a JPG, PNG, or WebP image.', 'Validation'); inputEl.value=''; return;
            }
            const triggerBtn = type === 'cover'
                ? document.querySelector('.pf-cover-change-btn')
                : (document.querySelector('#profilePictureModal .profile-picture-select-btn') || document.querySelector('.pf-avatar-trigger'));
            inputEl.disabled = true;
            if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.style.opacity = '0.5'; triggerBtn.style.pointerEvents = 'none'; }
            const restoreUploadUI = function () {
                inputEl.disabled = false; inputEl.value = '';
                if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.style.opacity = ''; triggerBtn.style.pointerEvents = ''; }
            };
            try {
                const optimization = await spadesOptimizeUploadFile(file, {maxDimension:2400, quality:0.91});
                const uploadFile = optimization.file || file;
                if (uploadFile.size > 4 * 1024 * 1024) {
                    customAlert('The image is still larger than 4 MB after safe optimization. Choose a smaller image.', 'Validation');
                    restoreUploadUI(); return;
                }
                const reader = new FileReader();
                reader.onerror = function () { customAlert('The selected image could not be read. Please try another image.', 'Error'); restoreUploadUI(); };
                reader.onabort = function () { customAlert('Image reading was cancelled. Please try again.', 'Upload Cancelled'); restoreUploadUI(); };
                reader.onload = async function(e) {
                    const payload = {
                        action: 'upload_photo', username: localStorage.getItem('loggedInUser') || '',
                        credential: localStorage.getItem('loggedCred') || '',
                        photoType: type === 'cover' ? 'cover' : 'profile',
                        mime: uploadFile.type || file.type || 'image/jpeg', dataBase64: e.target.result
                    };
                    try {
                        const res = await fetch(API_URL, { method:'POST', mode:'cors', headers:{'Content-Type':'text/plain'}, body: JSON.stringify(payload) });
                        let data;
                        try { data = await res.json(); }
                        catch (parseErr) {
                            let detail = ''; try { detail = (await res.text()).trim(); } catch (_) {}
                            if (detail && detail.length > 300) detail = detail.slice(0, 300) + '…';
                            throw new Error(detail ? ('Server returned an error: ' + detail) : 'The server returned an invalid response. Please try again later.');
                        }
                        if (data && data.success && data.url) {
                            const photoOwner = localStorage.getItem('loggedInUser') || '';
                            rememberProfilePhotoUrl(photoOwner, type === 'cover' ? 'cover' : 'profile', data.url);
                            const savedNote = ' ' + spadesUploadOptimizationLabel(optimization);
                            if (type === 'cover') {
                                applyProfileCover(data.url);
                                customAlert((data.cleanupWarning ? 'Cover photo updated successfully. ' + data.cleanupWarning : 'Cover photo updated successfully.') + savedNote, data.cleanupWarning ? 'Updated with Warning' : 'Success');
                            } else {
                                applyProfilePhotos(data.url); closeProfilePictureModal();
                                customAlert((data.cleanupWarning ? 'Profile photo updated successfully. ' + data.cleanupWarning : 'Profile photo updated successfully.') + savedNote, data.cleanupWarning ? 'Updated with Warning' : 'Success');
                            }
                        } else customAlert((data && data.error) ? data.error : 'Photo upload failed. Please try again.', 'Error');
                    } catch (err) {
                        const msg = (err && err.message && !/fetch|network|load failed/i.test(err.message)) ? err.message : 'Photo upload failed. Please check your connection and try again.';
                        customAlert(msg, 'Error');
                    }
                    restoreUploadUI();
                };
                reader.readAsDataURL(uploadFile);
            } catch (error) {
                customAlert(error && error.message ? error.message : 'The selected image could not be processed.', 'Upload Error');
                restoreUploadUI();
            }
        }
        function renderProfileRecentMemos(username) {
            const box = document.getElementById('profileRecentMemos');
            if (!box) return;
            const key = String(username || '').trim().toLowerCase();
            // loadData() sorts newest records first. Keep this order so the newest memo is always the first item.
            const mine = (Array.isArray(allMemos) ? allMemos : [])
                .filter(m => String((m && m[3]) || '').trim().toLowerCase() === key)
                .slice(0, 5);
            if (!mine.length) {
                box.innerHTML = '<div class="profile-memos-empty"><span aria-hidden="true">▤</span><strong>No memos created yet</strong><small>Your latest encoded memos will appear here.</small></div>';
                return;
            }
            box.innerHTML = mine.map((m, index) => `<article class="profile-recent-memo${index === 0 ? ' is-latest' : ''}">
                <div class="profile-recent-memo-mark" aria-hidden="true">${index === 0 ? 'NEW' : 'MEMO'}</div>
                <div class="profile-recent-memo-main"><strong>${escapeHtml(String(m[1] || '(no subject)'))}</strong>
                <span class="profile-recent-memo-date">Date: ${escapeHtml(String(m[0] || '—'))}</span>
                <span class="profile-recent-memo-control">Control No.: ${escapeHtml(String(m[2] || '—'))}</span></div>
            </article>`).join('');
        }
        async function viewUserProfile(username) {
            try {
                const res = await spadesAuthenticatedRead('get_user_profile', {targetUsername:username});
                const data = await res.json();
                if (!data || !data.success || !data.profile) { customAlert('Profile not found.', 'Error'); return; }
                const p = data.profile;
                const fullName = [p.rank, p.firstName, p.middleName, p.lastName, p.qlf].filter(Boolean).join(' ') || p.username;
                document.getElementById('viewProfileName').innerText = fullName;
                document.getElementById('viewProfileUsername').innerText = p.username;
                document.getElementById('viewProfileRole').innerText = p.role || 'Regular User';
                document.getElementById('viewTotalMemos').innerText = (p.totalMemos != null) ? p.totalMemos : 0;
                const av = document.getElementById('viewAvatarImg'); const fb = document.getElementById('viewAvatarFallback');
                const savedViewProfilePhoto = p.profilePhotoUrl || getCachedProfilePhotoUrl(p.username, 'profile');
                const savedViewCoverPhoto = p.coverPhotoUrl || getCachedProfilePhotoUrl(p.username, 'cover');
                if (p.profilePhotoUrl) rememberProfilePhotoUrl(p.username, 'profile', p.profilePhotoUrl);
                if (p.coverPhotoUrl) rememberProfilePhotoUrl(p.username, 'cover', p.coverPhotoUrl);
                setProfileImageDisplay(av, fb, savedViewProfilePhoto, fullName);
                const cv = document.getElementById('viewCoverBanner');
                if (savedViewCoverPhoto) cv.style.setProperty('background-image', `url("${savedViewCoverPhoto}")`, 'important'); else cv.style.removeProperty('background-image');
                const detailGroups = [
                    { title: 'Personnel Details', icon: 'fi-rr-id-badge', description: 'Registered personnel name information', fields: [
                        ['Rank', p.rank], ['First Name', p.firstName], ['Middle Name', p.middleName], ['Last Name', p.lastName], ['Qualifier', p.qlf]
                    ] },
                    { title: 'Account Information', icon: 'fi-rr-user-shield', description: 'Contact and account details', fields: [
                        ['Email Address', p.email], ['Assigned Role', p.role || 'Regular User']
                    ] }
                ];
                const detailsNode = document.getElementById('viewProfileInfo');
                if (detailsNode) detailsNode.innerHTML = detailGroups.map(group => `
                    <section class="um-user-info-card" aria-label="${escapeAttr(group.title)}">
                        <div class="um-user-info-card-head"><span class="um-user-info-card-icon"><i class="fi ${group.icon}" aria-hidden="true"></i></span><div><h3>${escapeHtml(group.title)}</h3><p>${escapeHtml(group.description)}</p></div></div>
                        <div class="um-user-info-fields">${group.fields.map(([label,value]) => `
                            <div class="um-user-info-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '—')}</strong></div>
                        `).join('')}</div>
                    </section>
                `).join('');
                document.getElementById('userProfileViewModal').classList.remove('hidden');
            } catch (err) { customAlert('Could not load profile.', 'Error'); }
        }
        function closeUserProfileView() { document.getElementById('userProfileViewModal').classList.add('hidden'); }

        async function populateProfileData() {
            const currentUser = localStorage.getItem('loggedInUser') || 'Unknown';
            const setProfileValue = (id, value, fallback = 'Not Available') => {
                const el = document.getElementById(id);
                if (!el) return;
                const text = value == null ? '' : String(value).trim();
                el.textContent = text || fallback;
                el.classList.toggle('is-not-available', !text);
            };

            if ((!Array.isArray(allMemos) || allMemos.length === 0) && typeof userHasAccess === 'function' && userHasAccess('home')) {
                try { await loadData(); } catch (loadMemoError) { console.warn('Could not refresh profile memo list:', loadMemoError); }
            }
            setProfileValue('profUsername', currentUser, 'Unknown');
            setProfileValue('profUsernameAccount', currentUser, 'Unknown');

            const displayRole = currentUser === ALPHA_ADMIN_NAME
                ? 'Alpha Admin'
                : (localStorage.getItem('userRole') || (localStorage.getItem('canEdit') === 'Yes' ? 'Admin' : 'Regular User'));
            setProfileValue('profAccType', displayRole);
            const fallbackName = [localStorage.getItem('profileFirstName') || '', localStorage.getItem('profileLastName') || ''].filter(Boolean).join(' ') || currentUser;
            setProfileValue('profileDisplayName', fallbackName, currentUser);
            const avatar = document.getElementById('profileAvatar');
            if (avatar) avatar.textContent = String(fallbackName.trim().charAt(0) || 'U').toUpperCase();
            const fallbackAvatar = document.getElementById('profileAvatarFallback');
            if (fallbackAvatar) fallbackAvatar.textContent = String(fallbackName.trim().charAt(0) || 'U').toUpperCase();
            setProfileValue('profileRoleBadge', displayRole);
            setProfileValue('profAccessLevel', currentUser === ALPHA_ADMIN_NAME ? 'Full Administrative Access' : (localStorage.getItem('canEdit') === 'Yes' || localStorage.getItem('userRole') === 'Admin' ? 'Administrative Editing' : 'Standard User'));
            loadProfilePreferences();

            // Show cached Drive-backed images immediately while the authenticated profile loads.
            applyProfilePhotos(getCachedProfilePhotoUrl(currentUser, 'profile'));
            applyProfileCover(getCachedProfilePhotoUrl(currentUser, 'cover'));

            let profile = null;
            try {
                const res = await spadesAuthenticatedRead('get_profile');
                const data = await res.json();
                if (!res.ok || !data || data.success !== true || !data.profile) throw new Error(data?.error || 'Unable to retrieve the authenticated profile.');
                profile = data.profile;

                const identityFields = {
                    profRank: profile.rank,
                    profFirstName: profile.firstName,
                    profMiddleName: profile.middleName,
                    profLastName: profile.lastName,
                    profQlf: profile.qlf,
                    profBadgeNumber: profile.badgeNumber,
                    profEmail: profile.email,
                    profContactNo: profile.contactNo,
                    profAddress: profile.address,
                    profDesignation: profile.designation,
                    profSection: profile.section,
                    profPersonnelStatus: profile.personnelStatus,
                    profPersonnelNo: profile.personnelNo
                };
                Object.entries(identityFields).forEach(([id, value]) => setProfileValue(id, value));
                setProfileValue('profAccType', profile.role || displayRole);
                setProfileValue('profileAccountStatus', profile.status || 'Active');
                setProfileValue('profPersonnelLink', profile.personnelLinked ? 'Linked' : 'Not Linked');
                setProfileValue('profDesignationHero', profile.designation || 'Designation not available');
                setProfileValue('profSectionHero', profile.section || 'Office / Section not available');

                const accountStatus = document.getElementById('profileAccountStatus');
                if (accountStatus) {
                    accountStatus.dataset.status = String(profile.status || 'Active').toLowerCase();
                    accountStatus.classList.toggle('is-inactive', String(profile.status || 'Active').toLowerCase() !== 'active');
                }

                const editValues = {
                    editProfileRank:profile.rank,
                    editProfileFirstName:profile.firstName,
                    editProfileMiddleName:profile.middleName,
                    editProfileLastName:profile.lastName,
                    editProfileQlf:profile.qlf,
                    editProfileEmail:profile.email,
                    editProfileContact:profile.contactNo
                };
                Object.entries(editValues).forEach(([id, value]) => {
                    const el = document.getElementById(id);
                    if (el) el.value = value || '';
                });

                if (profile.profilePhotoUrl) rememberProfilePhotoUrl(currentUser, 'profile', profile.profilePhotoUrl);
                if (profile.coverPhotoUrl) rememberProfilePhotoUrl(currentUser, 'cover', profile.coverPhotoUrl);
                applyProfilePhotos(profile.profilePhotoUrl || getCachedProfilePhotoUrl(currentUser, 'profile'));
                applyProfileCover(profile.coverPhotoUrl || getCachedProfilePhotoUrl(currentUser, 'cover'));

                const fullName = [profile.rank, profile.firstName, profile.middleName, profile.lastName, profile.qlf].filter(Boolean).join(' ').trim();
                if (fullName) {
                    setProfileValue('profileDisplayName', fullName, currentUser);
                    const initials = document.getElementById('profileAvatarFallback');
                    if (initials) initials.textContent = String(fullName.charAt(0) || 'U').toUpperCase();
                }

                const completionCandidates = [profile.rank, profile.firstName, profile.lastName, profile.email, profile.contactNo, profile.address, profile.designation, profile.section, profile.badgeNumber];
                const completed = completionCandidates.filter(value => String(value || '').trim()).length;
                const completion = Math.round((completed / completionCandidates.length) * 100);
                setProfileValue('profileCompletionText', `${completed}/${completionCandidates.length} fields`);
                const completionBar = document.getElementById('profileCompletionBar');
                if (completionBar) completionBar.style.width = `${completion}%`;
            } catch (err) {
                console.warn('Unable to refresh profile from the server:', err);
                setProfileValue('profilePersonnelLink', 'Not Linked');
            }

            let userMemos = 0;
            let lastAct = 'Not Available';
            if (Array.isArray(allMemos) && allMemos.length > 0 && typeof userHasAccess === 'function' && userHasAccess('home')) {
                const userMemosArr = allMemos.filter(m => String(m[3] || '').trim().toLowerCase() === String(currentUser).trim().toLowerCase());
                userMemos = userMemosArr.length;
                if (userMemos > 0) lastAct = userMemosArr[0][0] || 'Not Available';
            }
            const memoCountText = typeof userHasAccess === 'function' && userHasAccess('home') ? String(userMemos) : 'Restricted';
            setProfileValue('profTotalMemos', memoCountText);
            setProfileValue('profTotalMemosRepeat', memoCountText);
            setProfileValue('profLastActivity', typeof userHasAccess === 'function' && userHasAccess('home') ? lastAct : 'Restricted');
            renderProfileRecentMemos(currentUser);
            if (!profile) {
                setProfileValue('profAddress', 'Not Available');
                setProfileValue('profDesignation', 'Not Available');
                setProfileValue('profSection', 'Not Available');
                setProfileValue('profBadgeNumber', 'Not Available');
                setProfileValue('profPersonnelStatus', 'Not Available');
                setProfileValue('profPersonnelNo', 'Not Available');
            }
        }

        const SPADES_PAGE_ROUTES = {
            dashboard: { hash: '#dashboard', label: 'Dashboard' },
            home: { hash: '#memo-database', label: 'Memo Database' },
            personnel: { hash: '#personnel-management/personnel-list', label: 'Personnel Management' },
            adminMgmt: { hash: '#user-management', label: 'User Management' },
            activityManagement: { hash: '#activity-management', label: 'Activity Management' },
            matrixCompliances: { hash: '#matrix-of-compliances', label: 'Matrix of Compliances' },
            adminProofReader: { hash: '#admin-proof-reader', label: 'Admin Proof Reader' },
            usersChat: { hash: '#users-chat', label: 'Users Chat' },
            settings: { hash: '#settings', label: 'Settings' },
            profile: { hash: '#my-profile', label: 'My Profile' }
        };
        const SPADES_PERSONNEL_ROUTE_LABELS = {
            list: 'Personnel List', duty: 'Duty Office', bmi: 'BMI Monitoring',
            squad: 'Squadding', leave: 'Leave Management', aor: 'Area of Responsibilities'
        };
        const SPADES_PERSONNEL_ROUTE_SLUGS = {
            list: 'personnel-list', duty: 'duty-office', bmi: 'bmi-monitoring',
            squad: 'squadding', leave: 'leave-management', aor: 'area-of-responsibilities'
        };

        function updateSpadesAddressBar(tabName, options = {}) {
            const route = SPADES_PAGE_ROUTES[tabName] || SPADES_PAGE_ROUTES.dashboard;
            let hash = route.hash;
            let pageLabel = route.label;
            if (tabName === 'personnel') {
                const sub = Object.prototype.hasOwnProperty.call(SPADES_PERSONNEL_ROUTE_SLUGS, currentPersonnelSubPage)
                    ? currentPersonnelSubPage : 'list';
                hash = `#personnel-management/${SPADES_PERSONNEL_ROUTE_SLUGS[sub]}`;
                pageLabel = `${route.label} · ${SPADES_PERSONNEL_ROUTE_LABELS[sub]}`;
            }
            const nextUrl = `${window.location.pathname}${window.location.search}${hash}`;
            if (window.location.hash !== hash) {
                const method = options.replace ? 'replaceState' : 'pushState';
                window.history[method]({ spadesPage: tabName, spadesHash: hash }, '', nextUrl);
            }
            document.title = `${pageLabel} | SPADES`;
            const pageLabelEl = document.getElementById('activePageLabel');
            if (pageLabelEl) pageLabelEl.textContent = pageLabel;
        }

        function navigateToSpadesAddress() {
            if (!localStorage.getItem('loggedInUser')) return;
            const rawHash = String(window.location.hash || '').replace(/^#/, '');
            const [pageSlug, subSlug] = rawHash.split('/');
            const routeMap = {
                'dashboard': 'dashboard', 'memo-database': 'home',
                'personnel-management': 'personnel', 'user-management': 'adminMgmt',
                'activity-management': 'activityManagement', 'matrix-of-compliances': 'matrixCompliances',
                'admin-proof-reader': 'adminProofReader',
                'users-chat': 'usersChat', 'settings': 'settings', 'my-profile': 'profile'
            };
            const tabName = routeMap[pageSlug] || 'dashboard';
            if (tabName === 'personnel') {
                const subMap = Object.fromEntries(Object.entries(SPADES_PERSONNEL_ROUTE_SLUGS).map(([key, slug]) => [slug, key]));
                switchTab('personnel', { skipAddressUpdate: true });
                switchPersonnelSubPage(subMap[subSlug] || 'list', { skipAddressUpdate: true });
            } else {
                switchTab(tabName, { skipAddressUpdate: true });
            }
        }

        window.addEventListener('popstate', navigateToSpadesAddress);

        function switchTab(tabName, options = {}) {
            const activeUsername = localStorage.getItem('loggedInUser') || '';
            const accessControlledTab = ['dashboard', 'home', 'personnel', 'activityManagement', 'matrixCompliances', 'adminProofReader', 'usersChat', 'settings'].includes(tabName);
            if (activeUsername && accessControlledTab &&
                typeof userAccessMapLoadedFor !== 'undefined' && userAccessMapLoadedFor === activeUsername &&
                typeof userHasAccess === 'function' && !userHasAccess(tabName)) {
                customAlert('Your account does not have access to this page.', 'Permission Denied');
                return;
            }
            if (tabName !== 'usersChat' && chatMessagesTimer) { clearInterval(chatMessagesTimer); chatMessagesTimer = null; }
            ['tabDashboard','tabHome','tabProfile','tabAdminMgmt','tabSettings','tabPersonnel','tabActivityManagement','tabMatrixCompliances','tabAdminProofReader','tabUsersChat'].forEach(id => {
                const el=document.getElementById(id); if(el) el.classList.add('hidden');
            });
            ['btnDashboard','btnHome','btnSettings','btnAdminMgmt','btnPersonnel','btnActivityManagement','btnMatrixCompliances','btnAdminProofReader','btnUsersChat'].forEach(id => {
                const el=document.getElementById(id); if(el) el.classList.remove('active');
            });
            const settingsMain = document.getElementById('settingsMainPanel');
            if (settingsMain) settingsMain.classList.remove('hidden');

            if (tabName === 'dashboard') {
                document.getElementById('tabDashboard').classList.remove('hidden');
                document.getElementById('btnDashboard').classList.add('active');
                loadExecutiveDashboard();
            } else if (tabName === 'home') {
                document.getElementById('tabHome').classList.remove('hidden');
                document.getElementById('btnHome').classList.add('active');
                loadData();
            } else if (tabName === 'profile') {
                document.getElementById('tabProfile').classList.remove('hidden');
                document.getElementById('newCredential').value = "";
                document.getElementById('newUsernameInput').value = "";
                populateProfileData();
            } else if (tabName === 'settings') {
                document.getElementById('tabSettings').classList.remove('hidden');
                document.getElementById('btnSettings').classList.add('active');
            } else if (tabName === 'adminMgmt') {
                if (!isAlphaAdmin()) {
                    customAlert("Only the configured Alpha Admin can access User Management.", "Permission Denied"); return;
                }
                document.getElementById('tabSettings').classList.remove('hidden');
                document.getElementById('btnSettings').classList.add('active');
                if (!hasFreshAlphaStepUp()) {
                    pendingAdminAction = 'open_mgmt';
                    document.getElementById('adminModal').classList.remove('hidden');
                    document.getElementById('adminPassInput').value = "";
                    document.getElementById('adminPassInput').focus();
                } else {
                    showAdminMgmtTab();
                }

            } else if (tabName === 'adminProofReader') {
                document.getElementById('tabAdminProofReader')?.classList.remove('hidden');
                document.getElementById('btnAdminProofReader')?.classList.add('active');
                loadProofReaderDashboard();
            } else if (tabName === 'usersChat') {
                const chatPage = document.getElementById('tabUsersChat');
                if (chatPage) chatPage.classList.remove('hidden');
                document.getElementById('btnUsersChat')?.classList.add('active');
                ensureUsersChatPageConversation();
                if (!options.fromChat) {
                    setChatMode(chatMode || 'global');
                    if (!chatUsersLoaded) startUsersChat();
                    else renderChatUserList();
                    startUsersChatMessageRefresh();
                }
            } else if (tabName === 'activityManagement') {
                document.getElementById('tabActivityManagement').classList.remove('hidden');
                document.getElementById('btnActivityManagement').classList.add('active');
                updateActivityPermissions();
                loadActivities();
            } else if (tabName === 'matrixCompliances') {
                document.getElementById('tabMatrixCompliances').classList.remove('hidden');
                document.getElementById('btnMatrixCompliances').classList.add('active');
                loadMatrixCompliances();
            } else if (tabName === 'personnel') {
                document.getElementById('tabPersonnel').classList.remove('hidden');
                document.getElementById('btnPersonnel').classList.add('active');
                updatePersonnelPermissions();
                loadAllPersonnelManagementData();
            }
            if (window.innerWidth <= 992) document.getElementById('navSidebar').classList.remove('open');
            sessionStorage.setItem('activeTab', tabName);
            if (tabName !== 'adminMgmt') updateSpadesAddressBar(tabName, { replace: !!options.skipAddressUpdate });
        }

        function showAdminMgmtTab() {
            document.getElementById('tabSettings').classList.remove('hidden');
            document.getElementById('btnSettings').classList.add('active');
            const settingsMain = document.getElementById('settingsMainPanel');
            if (settingsMain) settingsMain.classList.add('hidden');
            document.getElementById('tabAdminMgmt').classList.remove('hidden');
            loadAdminUsers();
            sessionStorage.setItem('activeTab', 'adminMgmt');
            updateSpadesAddressBar('adminMgmt');
        }

        function closeAdminMgmtSubPage() {
            document.getElementById('tabAdminMgmt').classList.add('hidden');
            const settingsMain = document.getElementById('settingsMainPanel');
            if (settingsMain) settingsMain.classList.remove('hidden');
            document.getElementById('tabSettings').classList.remove('hidden');
            document.getElementById('btnSettings').classList.add('active');
            sessionStorage.setItem('activeTab', 'settings');
            updateSpadesAddressBar('settings');
        }

        async function fetchSystemAnnouncement() {
            if (sessionStorage.getItem('systemAnnouncementSeen') === 'true') return;
            try { const res = await fetch(API_URL + "?action=get_announcement"); const data = await res.json(); if (data.success && data.message) { document.getElementById('globalAnnouncementMsg').innerText = data.message; document.getElementById('systemAnnouncementModal').classList.remove('hidden'); sessionStorage.setItem('systemAnnouncementSeen', 'true'); } } catch(e) {}
        }

        function closeAnnouncementModal() { document.getElementById('systemAnnouncementModal').classList.add('hidden'); }

        async function saveAdminAnnouncement() {
            const message = document.getElementById('adminAnnouncementText').value.trim();
            if (!message) return customAlert('Announcement message cannot be empty.', 'Error');
            try {
                const response = await fetch(API_URL, {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'save_announcement',message,password:sessionAdminPass,userName:localStorage.getItem('loggedInUser') || ''})});
                const result = await response.json();
                if (!result.success) return customAlert(result.error || 'Could not publish the announcement.', 'Error');
                customAlert('System announcement published.', 'Success'); logActivity('updated the global system announcement.');
            } catch (error) { customAlert('Could not publish the announcement. Please retry.', 'Error'); }
        }
        function deleteAdminAnnouncement() {
            customConfirm('Remove the global system announcement?', async confirmed => {
                if (!confirmed) return;
                try {
                    const response = await fetch(API_URL, {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'delete_announcement',password:sessionAdminPass,userName:localStorage.getItem('loggedInUser') || ''})});
                    const result = await response.json();
                    if (!result.success) return customAlert(result.error || 'Could not remove the announcement.', 'Error');
                    document.getElementById('adminAnnouncementText').value = '';
                    customAlert('Announcement removed.', 'Success'); logActivity('removed the global system announcement.');
                } catch (error) { customAlert('Could not remove the announcement. Please retry.', 'Error'); }
            });
        }

        let visibleRefreshInProgress = false;
        function isSpadesUserActivelyEditing() {
            const active = document.activeElement;
            if (active && active !== document.body && active.matches && active.matches('input:not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"]')) return true;
            return !!document.querySelector('.modal-overlay:not(.hidden), .profile-settings-overlay:not(.hidden), .proofreader-workspace-modal:not(.hidden)');
        }

        async function refreshActivePersonnelSubPage() {
            // Refresh only the currently visible Personnel module. This avoids
            // seven sheet reads and several DOM rebuilds when the user is viewing
            // just one sub-page, while preserving its independent list viewport.
            switch (String(currentPersonnelSubPage || 'list')) {
                case 'list': return loadPersonnel();
                case 'duty': return loadDutySequence();
                case 'bmi': return loadBmiRecords();
                case 'squad': return loadSquads();
                case 'leave': return loadLeaveEntries();
                case 'aor': return loadAreas();
                default: return loadPersonnel();
            }
        }

        async function refreshVisibleTabData() {
            if (!localStorage.getItem('loggedInUser') || document.hidden || visibleRefreshInProgress || isSpadesUserActivelyEditing()) return;
            visibleRefreshInProgress = true;
            const tabName = sessionStorage.getItem('activeTab') || 'dashboard';
            try {
                if (tabName === 'dashboard') await loadExecutiveDashboard();
                else if (tabName === 'home') await loadData();
                else if (tabName === 'personnel') await refreshActivePersonnelSubPage();
                else if (tabName === 'activityManagement') await loadActivities();
                else if (tabName === 'profile') await populateProfileData();
                else if (tabName === 'adminMgmt' && isAlphaAdmin() && hasFreshAlphaStepUp()) await loadAdminUsers();
                // Activity logs are part of the Dashboard summary. Do not fetch
                // the full log sheet on every unrelated tab's refresh interval.
            } catch (error) {
                console.warn('Automatic data refresh failed; the current view remains available.', error);
            } finally {
                visibleRefreshInProgress = false;
            }
        }

        function restartActivityLogRefresh() {
            if (activityLogRefreshTimer) {
                clearInterval(activityLogRefreshTimer);
                activityLogRefreshTimer = null;
            }
            if (!localStorage.getItem('loggedInUser') || userSettings.autoRefresh === false || document.hidden) return;
            const configuredSeconds = Number.parseInt(userSettings.refreshInterval, 10);
            const allowedIntervals = [30, 60, 300];
            const seconds = allowedIntervals.includes(configuredSeconds) ? configuredSeconds : 60;
            activityLogRefreshTimer = window.setInterval(refreshVisibleTabData, seconds * 1000);
        }

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (activityLogRefreshTimer) clearInterval(activityLogRefreshTimer);
                activityLogRefreshTimer = null;
            } else {
                restartActivityLogRefresh();
                if (localStorage.getItem('loggedInUser') && userSettings.autoRefresh !== false) refreshVisibleTabData();
            }
        });

        async function heartbeatSpadesSession() {
            const username = localStorage.getItem('loggedInUser') || '';
            const token = localStorage.getItem('loggedCred') || '';
            if (!username || !token) return;
            try {
                const response = await fetch(API_URL, {
                    method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
                    body:JSON.stringify({action:'validate_session',username,credential:token})
                });
                const result = await response.json();
                if (!result || !result.success) {
                    customAlert(result?.error || 'Your sign-in session is no longer valid. Please sign in again.', 'Session Expired');
                    logoutUser(true);
                } else if (result.expiresAt) {
                    localStorage.setItem('loggedSessionExpiresAt', String(result.expiresAt));
                    scheduleSessionExpiry();
                }
            } catch (error) {
                // A temporary connection failure is retried on the next heartbeat; do not log the user out on a network blip.
                console.warn('SPADES session heartbeat could not reach the server.', error);
            }
        }

        function startSpadesSessionHeartbeat() {
            if (sessionHeartbeatTimer) clearInterval(sessionHeartbeatTimer);
            sessionHeartbeatTimer = null;
            if (!localStorage.getItem('loggedInUser')) return;
            sessionHeartbeatTimer = window.setInterval(heartbeatSpadesSession, 5 * 60 * 1000);
        }

        function scheduleSessionExpiry() {
            if (sessionExpiryTimer) clearTimeout(sessionExpiryTimer);
            sessionExpiryTimer = null;
            const expiry = Number(localStorage.getItem('loggedSessionExpiresAt') || 0);
            if (!expiry) return;
            const remaining = expiry - Date.now();
            if (remaining <= 0) {
                customAlert('Your sign-in session has expired. Please sign in again.', 'Session Expired');
                logoutUser(true);
                return;
            }
            sessionExpiryTimer = window.setTimeout(() => {
                customAlert('Your sign-in session has expired. Please sign in again.', 'Session Expired');
                logoutUser(true);
            }, Math.min(remaining, 2147483000));
        }

        function checkAuth() {
            const user = localStorage.getItem('loggedInUser');
            if (user) {
                document.getElementById('appBrand').innerText = 'REGIONAL HEADQUARTERS SUPPORT UNIT';
                document.getElementById('loginPage').classList.add('hidden');
                document.getElementById('registerPage').classList.add('hidden');
                document.getElementById('appLayout').classList.remove('hidden');
                document.getElementById('mainTopBar').classList.remove('hidden');
                // User Management is visible only to the configured Alpha Admin.
                // Compare normalized identities because the backend accepts usernames case-insensitively.
                syncAlphaAdminAccessVisibility();
                scheduleSessionExpiry();
                startSpadesSessionHeartbeat();
                resetIdleTimer();
                document.getElementById('btnPersonnel').classList.remove('hidden');
                loadSettings();
                if (userSettings.autoOpenChatbot && userSettings.showChatbot) document.getElementById('chatbot-window').classList.remove('hidden'); else document.getElementById('chatbot-window').classList.add('hidden');
                
                // Restore the exact page from the URL hash after authentication.
                // Page navigation updates the hash (including Personnel sub-pages),
                // so a browser refresh keeps the user's current view instead of
                // forcing a redirect to the Dashboard. Empty/unknown hashes safely
                // fall back to the Dashboard through navigateToSpadesAddress().
                navigateToSpadesAddress();
                
                // Fetch the combined security context once. Access permissions and read-only
                // restrictions are delivered by the same authenticated endpoint.
                loadUserAccessContext().then(() => {
                    const currentUsername = String(localStorage.getItem('loggedInUser') || '').trim();
                    const me = currentUsername.toLowerCase();
                    const restrictedKey = Object.keys(userRestrictedMap || {}).find(key => String(key).trim().toLowerCase() === me);
                    if (restrictedKey && userRestrictedMap[restrictedKey]) {
                        localStorage.setItem('canEdit', 'No');
                        localStorage.setItem('userRole', 'Regular User');
                    }
                    applyAccessRestrictions();
                    if (userAccessContextLoadedFor === currentUsername && userHasAccess('usersChat')) startChatNotificationMonitor();
                    else stopChatNotificationMonitor();
                }).catch(() => { stopChatNotificationMonitor(); });

                // Keep the first authenticated screen responsive. Background polling,
                // announcements and reminders start after the initial render.
                const startPostLoginTasks = () => {
                    if (!localStorage.getItem('loggedInUser')) return;
                    restartActivityLogRefresh();
                    fetchSystemAnnouncement();
                    startActivityReminderMonitor();
                    if (typeof startProofReaderNotificationMonitor === 'function') startProofReaderNotificationMonitor();
                };
                if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(startPostLoginTasks, {timeout: 1200});
                else window.setTimeout(startPostLoginTasks, 260);
            } else {
                stopActivityReminderMonitor();
                stopChatNotificationMonitor();
                if (typeof stopProofReaderNotificationMonitor === 'function') stopProofReaderNotificationMonitor();
                toggleAuthViews('loginPage');
            }
        }

        async function loginUser() {
            if (loginUser._inFlight) return;
            const user = document.getElementById('loginUsername').value.trim();
            const cred = document.getElementById('loginCredential').value;
            const credentialMode = document.querySelector('input[name="loginType"]:checked')?.value || 'pin';
            if (!user || !cred) return customAlert('Enter your username and PIN/password.', 'Authentication Error');
            if (cred.length > 128) return customAlert('Your credential must not exceed 128 characters.', 'Authentication Error');
            // Do not enforce new-credential creation rules during login. Existing accounts
            // may still have legacy PINs/passwords of different lengths; the backend hash/legacy
            // verifier is authoritative. New PIN/password rules remain enforced at creation/change.
            const credentialInput = document.getElementById('loginCredential');
            const loginButton = document.querySelector('#loginPage .rhsu-login-submit');
            const loginLabel = loginButton?.querySelector('.rhsu-login-submit-label');
            const previousText = loginLabel?.textContent || 'LOG IN';
            loginUser._inFlight = true;
            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => controller.abort(), 45000);
            credentialInput.disabled = true;
            if (loginButton) { loginButton.disabled = true; loginButton.setAttribute('aria-busy', 'true'); if (loginLabel) loginLabel.textContent = 'VERIFYING…'; }
            try {
                // Allow the visual busy state to paint before the network request begins.
                await new Promise(resolve => requestAnimationFrame(resolve));
                const response = await fetch(API_URL, {
                    method:'POST',
                    mode:'cors',
                    cache:'no-store',
                    redirect:'follow',
                    headers:{'Content-Type':'text/plain;charset=utf-8'},
                    body:JSON.stringify({action:'login',username:user,pin:cred,credentialType:credentialMode}),
                    signal:controller.signal
                });
                const responseText = await response.text();
                let result;
                try {
                    result = JSON.parse(responseText);
                } catch (parseError) {
                    console.error('SPADES login endpoint returned a non-JSON response.', {
                        status:response.status,
                        redirected:response.redirected,
                        contentType:response.headers.get('content-type') || 'unknown',
                        responsePreview:String(responseText || '').slice(0, 240)
                    });
                    throw new Error('The Apps Script endpoint did not return a valid SPADES JSON response. Confirm that the latest Code.gs was saved and deployed to the same Web App URL used by this website.');
                }
                if (!response.ok) {
                    throw new Error(result?.error || ('SPADES login request failed with HTTP ' + response.status + '.'));
                }
                if (!result || !result.success || !result.sessionToken) {
                    customAlert(result?.error || 'Invalid username or credential.', 'Authentication Error');
                    credentialInput.value = '';
                    return;
                }
                const storedUser = String(result.username || user);
                localStorage.setItem('loggedInUser', storedUser);
                // Store only the server-issued expiring session token, never the PIN/password.
                localStorage.setItem('loggedCred', result.sessionToken);
                localStorage.setItem('loggedSessionExpiresAt', String(result.expiresAt || ''));
                scheduleSessionExpiry();
                localStorage.setItem('userRole', result.role || 'Regular User');
                localStorage.setItem('canEdit', result.role === 'Admin' || result.role === 'Alpha Admin' ? 'Yes' : 'No');
                if (String(result.role || '').trim().toLowerCase() === 'alpha admin') setCachedAlphaAdminName(storedUser);
                sessionAdminPass = ''; sessionAdminPassExpiresAt = 0;
                sessionStorage.removeItem('systemAnnouncementSeen');
                credentialInput.value = '';
                logActivity('logged into the system.');
                checkAuth();
            } catch (error) {
                console.error('SPADES login request failed:', error);
                let message = String(error && error.message || 'Unknown connection error.');
                if (error && error.name === 'AbortError') {
                    message = 'The SPADES login request timed out after 45 seconds. Check the Apps Script execution log and confirm the latest Web App deployment is active.';
                } else if (error instanceof TypeError || /failed to fetch|load failed|networkerror/i.test(message)) {
                    message = 'The browser could not reach the SPADES Apps Script endpoint. Check internet access, Web App deployment access, and whether API_URL in script/app.js matches the current Web App /exec URL.';
                }
                customAlert(message, 'Authentication Connection Error');
            } finally {
                window.clearTimeout(timeoutId);
                loginUser._inFlight = false;
                credentialInput.disabled = false;
                if (loginButton) { loginButton.disabled = false; loginButton.removeAttribute('aria-busy'); if (loginLabel) loginLabel.textContent = previousText || 'LOG IN'; }
            }
        }

        async function registerUser() {
            const field = id => document.getElementById(id);
            const rank = field('regRank')?.value?.trim() || '';
            const firstName = field('regFirst')?.value?.trim() || '';
            const middleName = field('regMiddle')?.value?.trim() || '';
            const lastName = field('regLast')?.value?.trim() || '';
            const qlf = field('regQlf')?.value?.trim() || '';
            const email = field('regEmail')?.value?.trim() || '';
            const username = field('regUsername')?.value?.trim() || '';
            const cred = field('regCredential')?.value || '';
            const credentialType = document.querySelector('input[name="regType"]:checked')?.value || 'pin';
            if (!rank || !firstName || !lastName || !email || !username || !cred) return customAlert('Please complete all required fields.', 'Registration');
            if (credentialType === 'pin' && !/^\d{6}$/.test(cred)) return customAlert('A new PIN must contain exactly 6 digits.', 'Registration');
            if (credentialType === 'password' && (cred.length < 10 || cred.length > 128 || [/[a-z]/.test(cred),/[A-Z]/.test(cred),/\d/.test(cred),/[^A-Za-z0-9]/.test(cred)].filter(Boolean).length < 3)) return customAlert('Use a password of 10–128 characters with at least three character types.', 'Registration');
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return customAlert('Please enter a valid email address.', 'Registration');
            if (username.length < 3 || /[\u0000-\u001f]/.test(username)) return customAlert('Username must contain at least 3 characters and no control characters.', 'Registration');
            const payload = { action: 'register', rank, firstName, middleName, lastName, qlf, email, username, pin: cred, credentialType };
            const submitButton = document.querySelector('#registerPage button[onclick="registerUser()"]');
            const previousText = submitButton?.textContent;
            if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Creating account…'; }
            try {
                const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
                if (!res.ok) throw new Error(`Registration request failed (${res.status})`);
                const data = await res.json();
                if (data && data.success) {
                    if (field('regCredential')) field('regCredential').value = '';
                    customAlert('Account created! It is pending approval by an Admin.', 'Success');
                    toggleAuthViews('loginPage');
                } else {
                    customAlert(data?.error || 'Unable to create the account.', 'Registration Error');
                }
            } catch (error) {
                console.error('Registration request failed:', error);
                customAlert('Network error while creating the account. Please try again.', 'Registration Error');
            } finally {
                if (submitButton) { submitButton.disabled = false; submitButton.textContent = previousText || 'Register'; }
            }
        }

        function attemptLogout() { if (userSettings.confirmLogout) { customConfirm("Are you sure you want to log out of the system?", (confirmed) => { if (confirmed) logoutUser(false); }); } else { logoutUser(false); } }
        function logoutUser(force = false) {
            dashboardSummaryCache = null;
            liveActivityLogs = [];
            
            const currentUser = localStorage.getItem('loggedInUser');
            const currentToken = localStorage.getItem('loggedCred') || '';
            if (currentUser && currentToken) {
                fetch(API_URL, {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'logout_session',username:currentUser,credential:currentToken})}).catch(() => {});
            }
            persistUserSettings(currentUser);
            if (!force) logActivity("logged out of the system.");

            // End the authenticated session and remove the page route. The route is
            // intentionally retained during refresh, but must never survive logout.
            ['loggedInUser', 'loggedCred', 'loggedSessionExpiresAt', 'userRole', 'canEdit'].forEach(key => localStorage.removeItem(key));
            try {
                const cleanUrl = `${window.location.pathname}${window.location.search}`;
                window.history.replaceState({}, '', cleanUrl);
            } catch (error) { window.location.hash = ''; }

            // Close every open dialog before showing the login screen.
            document.querySelectorAll('.modal-overlay, .profile-settings-overlay').forEach(modal => {
                modal.classList.add('hidden');
                modal.setAttribute('aria-hidden', 'true');
                modal.removeAttribute('aria-modal');
            });
            document.body.classList.remove('profile-modal-open', 'spades-modal-stack-open');
            if (window.SPADESModalStack?.refresh) window.SPADESModalStack.refresh();

            sessionAdminPass = ''; sessionAdminPassExpiresAt = 0;
            if (sessionAdminPassTimer) clearTimeout(sessionAdminPassTimer); sessionAdminPassTimer = null;
            pendingAdminAction = null;
            pendingAction = null;
            liveActivityLogs = [];
            lastLogCount = 0;
            if (activityLogRefreshTimer) { clearInterval(activityLogRefreshTimer); activityLogRefreshTimer = null; }
            if (activityRefreshTimer) { clearInterval(activityRefreshTimer); activityRefreshTimer = null; }
            stopActivityReminderMonitor();
            if (autoLogoutTimer) { clearTimeout(autoLogoutTimer); autoLogoutTimer = null; }
            if (sessionExpiryTimer) { clearTimeout(sessionExpiryTimer); sessionExpiryTimer = null; }
            if (sessionHeartbeatTimer) { clearInterval(sessionHeartbeatTimer); sessionHeartbeatTimer = null; }
            sessionStorage.removeItem('systemAnnouncementSeen');
            stopChatNotificationMonitor();
            if (typeof stopProofReaderNotificationMonitor === 'function') stopProofReaderNotificationMonitor();
            // Access and restriction maps are session-scoped. Clear them so a
            // same-account relogin always fetches the latest server permissions.
            userAccessMap = {};
            userPersonnelPermissionsMap = {};
            userRestrictedMap = {};
            userAccessMapLoadedFor = '';
            userAccessContextLoadedFor = '';
            userAccessContextLoadedAt = 0;
            userAccessContextPromise = null;
            userAccessContextPromiseFor = '';
            const incomingChatContainer = document.getElementById('incomingChatContainer');
            if (incomingChatContainer) incomingChatContainer.innerHTML = '';
            userSettings = { ...DEFAULT_USER_SETTINGS };
            checkAuth();
        }
        let profileModalPreviousFocus = null;
        function syncProfileModalIdentity() {
            const currentUser = localStorage.getItem('loggedInUser') || 'username';
            const userEl = document.getElementById('securityCurrentUsername'); if (userEl) userEl.textContent = currentUser;
            const summaryUser = document.getElementById('editProfileSummaryUsername'); if (summaryUser) summaryUser.textContent = currentUser;
            const displayName = document.getElementById('profileDisplayName')?.textContent?.trim() || currentUser;
            const summaryName = document.getElementById('editProfileSummaryName'); if (summaryName) summaryName.textContent = displayName;
            const initial = document.getElementById('editProfileInitial'); if (initial) initial.textContent = String(displayName.charAt(0) || 'U').toUpperCase();
        }
        function openProfileModal(id) {
            const target = document.getElementById(id);
            if (!target) return;
            profileModalPreviousFocus = document.activeElement;
            document.querySelectorAll('.profile-settings-overlay:not(.hidden)').forEach(el => {
                if (el.id !== id) el.classList.add('hidden');
            });
            target.classList.remove('hidden');
            document.body.classList.add('profile-modal-open');
            syncProfileModalIdentity();
            if (id === 'profileSettingsModal') {
                Promise.resolve(populateProfileData()).then(syncProfileModalIdentity).catch(() => {});
            } else if (id === 'securitySettingsModal') {
                const isAlpha = !!ALPHA_ADMIN_NAME && localStorage.getItem('loggedInUser') === ALPHA_ADMIN_NAME;
                const usernameField = document.getElementById('usernameChangeField');
                const alphaNotice = document.getElementById('alphaUsernameLockNotice');
                if (usernameField) usernameField.classList.toggle('hidden', isAlpha);
                if (alphaNotice) alphaNotice.classList.toggle('hidden', !isAlpha);
                const usernameInput = document.getElementById('newUsernameInput');
                if (usernameInput) { usernameInput.disabled = isAlpha; usernameInput.value = ''; }
                updateCredentialStrength();
            }
            window.setTimeout(() => {
                const firstField = target.querySelector('input:not([disabled]), select:not([disabled])');
                (firstField || target.querySelector('.profile-settings-modal'))?.focus({ preventScroll: true });
            }, 40);
        }
        function closeProfileModal(id) {
            document.getElementById(id)?.classList.add('hidden');
            if (!document.querySelector('.profile-settings-overlay:not(.hidden)')) {
                document.body.classList.remove('profile-modal-open');
                const previous = profileModalPreviousFocus;
                if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
                    window.setTimeout(() => previous.focus({ preventScroll: true }), 0);
                }
                profileModalPreviousFocus = null;
            }
        }
        function toggleProfileCredentialVisibility() {
            const input = document.getElementById('newCredential');
            const button = document.getElementById('toggleCredentialVisibility');
            if (!input || !button) return;
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            button.innerHTML = show ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.7A10.8 10.8 0 0 1 12 5.5c6.1 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3.1 3.8M6.2 6.3C3.8 8 2.5 12 2.5 12s3.4 6.5 9.5 6.5a9.9 9.9 0 0 0 3-.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.4 6.5-9.5 6.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
            button.setAttribute('aria-label', show ? 'Hide PIN or password' : 'Show PIN or password');
            button.setAttribute('aria-pressed', show ? 'true' : 'false');
            input.focus({ preventScroll: true });
        }
        function updateCredentialStrength() {
            const input = document.getElementById('newCredential');
            const bar = document.getElementById('credentialStrengthBar');
            const meter = bar?.parentElement;
            const hint = document.getElementById('credentialStrengthText');
            if (!input || !meter || !hint) return;
            const value = input.value || '';
            meter.classList.remove('level-1', 'level-2', 'level-3', 'level-4');
            if (!value) {
                hint.textContent = 'Enter a new credential to see its strength guidance. This is an estimate only.';
                return;
            }
            let score = 0;
            if (value.length >= 4) score++;
            if (value.length >= 8) score++;
            if (value.length >= 12) score++;
            if (/[a-z]/.test(value) && /[A-Z]/.test(value) || /\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score++;
            score = Math.max(1, Math.min(4, score));
            meter.classList.add('level-' + score);
            const labels = {
                1: 'Short or predictable — consider a longer credential.',
                2: 'Basic — a longer, less predictable credential is safer.',
                3: 'Good — avoid reusing this credential on other services.',
                4: 'Stronger — keep it private and store it securely.'
            };
            hint.textContent = labels[score] + ' This is guidance only; it does not enforce a password policy.';
        }
        document.addEventListener('keydown', function(event) {
            const activeModal = document.querySelector('.profile-settings-overlay:not(.hidden)');
            if (!activeModal) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closeProfileModal(activeModal.id);
                return;
            }
            if (event.key === 'Tab') {
                const focusable = Array.from(activeModal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
                    .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
                if (!focusable.length) { event.preventDefault(); activeModal.querySelector('.profile-settings-modal')?.focus(); return; }
                const first = focusable[0], last = focusable[focusable.length - 1];
                if (event.shiftKey && (document.activeElement === first || !activeModal.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        });
        document.getElementById('newCredential')?.addEventListener('input', updateCredentialStrength);
        async function savePersonalProfile() {
            const username = localStorage.getItem('loggedInUser');
            const payload = {
                action:'update_profile', username,
                currentCredential:localStorage.getItem('loggedCred'),
                rank:document.getElementById('editProfileRank').value.trim(),
                firstName:document.getElementById('editProfileFirstName').value.trim(),
                middleName:document.getElementById('editProfileMiddleName').value.trim(),
                lastName:document.getElementById('editProfileLastName').value.trim(),
                qlf:document.getElementById('editProfileQlf').value.trim(),
                email:document.getElementById('editProfileEmail').value.trim(),
                contactNo:document.getElementById('editProfileContact').value.trim()
            };
            if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return customAlert('Please enter a valid email address.', 'Error');
            try {
                const res = await fetch(API_URL, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(payload)});
                const data = await res.json();
                if (!data || !data.success) return customAlert(data?.error || 'Could not save profile changes.', 'Error');
                localStorage.setItem('profileFirstName', payload.firstName); localStorage.setItem('profileLastName', payload.lastName);
                customAlert('Profile settings saved successfully.', 'Success');
                closeProfileModal('profileSettingsModal'); await populateProfileData();
                if (typeof logActivity === 'function') logActivity('updated their profile details.');
            } catch (err) { customAlert('Could not save profile changes. Please try again.', 'Error'); }
        }

        function getProfilePreferencesKey(username = localStorage.getItem('loggedInUser')) { return 'rhsuProfilePrefs_' + String(username || '').trim(); }
        function loadProfilePreferences() {
            const stored = localStorage.getItem(getProfilePreferencesKey());
            let prefs = { density:'Comfortable', showActivity:true, showContact:true };
            try { if (stored) prefs = { ...prefs, ...JSON.parse(stored) }; } catch(e) {}
            const density = document.getElementById('profileDisplayDensity'); if (density) density.value = prefs.density;
            const activity = document.getElementById('profileShowActivity'); if (activity) activity.checked = prefs.showActivity !== false;
            const contact = document.getElementById('profileShowContact'); if (contact) contact.checked = prefs.showContact !== false;
            const activityPanel = document.getElementById('pfRecentMemosPanel');
            if (activityPanel) activityPanel.classList.toggle('hidden', prefs.showActivity === false);
            const contactGroup = document.getElementById('pfContactInfoGroup');
            if (contactGroup) contactGroup.classList.toggle('hidden', prefs.showContact === false);
            document.getElementById('tabProfile')?.classList.toggle('profile-compact', prefs.density === 'Compact');
        }
        function saveProfilePreferences() {
            const prefs = { density: document.getElementById('profileDisplayDensity')?.value || 'Comfortable', showActivity: document.getElementById('profileShowActivity')?.checked !== false, showContact: document.getElementById('profileShowContact')?.checked !== false };
            localStorage.setItem(getProfilePreferencesKey(), JSON.stringify(prefs)); loadProfilePreferences();
        }
        function clearProfileFields() {
            const credential = document.getElementById('newCredential');
            const username = document.getElementById('newUsernameInput');
            if (credential) { credential.value = ''; credential.type = 'password'; }
            if (username) username.value = '';
            const toggle = document.getElementById('toggleCredentialVisibility');
            if (toggle) { toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.4 6.5-9.5 6.5S2.5 12 2.5 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg>'; toggle.setAttribute('aria-label', 'Show PIN or password'); toggle.setAttribute('aria-pressed', 'false'); }
            updateCredentialStrength();
            if (!document.getElementById('securitySettingsModal')?.classList.contains('hidden')) { const currentUser = localStorage.getItem('loggedInUser'); (currentUser === ALPHA_ADMIN_NAME ? credential : username)?.focus({ preventScroll: true }); }
        }
        function refreshSessionProfile() { populateProfileData(); showNotification('Profile Refreshed','Your profile and session information are up to date.'); }

        async function updateProfile() {
            const newCred = document.getElementById('newCredential').value.trim();
            const oldUsername = localStorage.getItem('loggedInUser') || '';
            const isAlpha = !!ALPHA_ADMIN_NAME && oldUsername === ALPHA_ADMIN_NAME;
            const newUsername = isAlpha ? '' : document.getElementById('newUsernameInput').value.trim();
            if (!newCred && !newUsername) return customAlert('Enter a new username or credential.', 'Error');
            if (newUsername && (newUsername.length < 3 || /[\u0000-\u001f]/.test(newUsername))) return customAlert('Choose a valid username with at least 3 characters.', 'Error');
            const payload = {
                action: 'update_profile', username: oldUsername,
                currentCredential: localStorage.getItem('loggedCred') || '',
                newUsername, newCredential: newCred, newCredentialType: (/^\d{6}$/.test(newCred) ? 'pin' : (newCred ? 'password' : ''))
            };
            const saveButton = document.querySelector('#securitySettingsModal .profile-primary-action');
            const originalText = saveButton?.innerHTML;
            if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Saving…'; }
            try {
                const response = await fetch(API_URL, {
                    method: 'POST', headers: {'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify(payload)
                });
                const data = await response.json();
                if (!data || !data.success) return customAlert(data?.error || 'The backend rejected the account changes.', 'Error');
                if (newCred || newUsername) {
                    customAlert('Your sign-in details were updated. Please sign in again using your updated username and credential.', 'Security Updated');
                    logoutUser(true);
                    return;
                }
                if (newUsername && data.username) {
                    const confirmedUsername = String(data.username);
                    const oldSettings = localStorage.getItem(getUserSettingsKey(oldUsername));
                    const oldPrefs = localStorage.getItem(getProfilePreferencesKey(oldUsername));
                    if (oldSettings) localStorage.setItem(getUserSettingsKey(confirmedUsername), oldSettings);
                    if (oldPrefs) localStorage.setItem(getProfilePreferencesKey(confirmedUsername), oldPrefs);
                    localStorage.setItem('loggedInUser', confirmedUsername);
                }
                persistUserSettings(localStorage.getItem('loggedInUser'));
                customAlert(isAlpha ? 'Alpha Admin credential updated successfully. The username remains centrally managed.' : 'Account credentials updated successfully.', 'Success');
                closeProfileModal('securitySettingsModal'); clearProfileFields();
                document.getElementById('appBrand').innerText = 'REGIONAL HEADQUARTERS SUPPORT UNIT';
                await populateProfileData(); syncProfileModalIdentity();
                if (typeof logActivity === 'function') logActivity('updated their account credentials.');
            } catch (error) {
                console.error('Account credential update failed:', error);
                customAlert('Could not save account changes. Check the connection and try again.', 'Error');
            } finally {
                if (saveButton) { saveButton.disabled = false; saveButton.innerHTML = originalText || '✓ Save account changes'; }
            }
        }
        const OFFICE_DESTINATIONS = ["RD, PRO1", "DRDA", "DRDO", "CRS", "Msg Center", "RPRMD", "RID", "ROD", "RLRDD", "RCADD", "RCD", "RIDMD", "RETD", "RPSMD", "RICTMD", "RESPO", "RMFB1"];
        function toggleOfficeDestinationOther(selectId, otherInputId) { const select = document.getElementById(selectId); const otherInput = document.getElementById(otherInputId); if (!select || !otherInput) return; const showOther = select.value === "Others"; otherInput.classList.toggle('hidden', !showOther); otherInput.required = showOther; if (!showOther) otherInput.value = ""; }
        function getSelectedOfficeDestination(selectId, otherInputId) { const select = document.getElementById(selectId); const otherInput = document.getElementById(otherInputId); if (!select) return ""; if (select.value === "Others") return otherInput ? otherInput.value.trim() : ""; return select.value.trim(); }
        function setOfficeDestination(selectId, otherInputId, destination) { const select = document.getElementById(selectId); const otherInput = document.getElementById(otherInputId); if (!select) return; const value = String(destination || "").trim(); if (OFFICE_DESTINATIONS.includes(value)) { select.value = value; if (otherInput) { otherInput.value = ""; otherInput.classList.add('hidden'); otherInput.required = false; } } else if (value) { select.value = "Others"; if (otherInput) { otherInput.value = value; otherInput.classList.remove('hidden'); otherInput.required = true; } } else { select.value = ""; if (otherInput) { otherInput.value = ""; otherInput.classList.add('hidden'); otherInput.required = false; } } }

        function openMemoModalUser() { const typeSelect = document.getElementById('memoType'); if (typeSelect) typeSelect.value = 'Regular Memo'; document.getElementById('memoSubmissionModal').classList.remove('hidden'); document.getElementById('memoSubmitBtn').disabled = false; document.getElementById('memoSubmitBtn').innerText = "Submit Data"; }
        function dashboardAddMemo() {
            switchTab('home');
            setTimeout(() => {
                if (!document.getElementById('tabHome')?.classList.contains('hidden')) openMemoModalUser();
            }, 0);
        }
        function dashboardAddActivity() {
            // The Dashboard shortcut must perform the advertised action, not merely
            // navigate to Activity Management. The destination tab is verified before
            // opening the page-specific Add Activity form.
            switchTab('activityManagement');
            requestAnimationFrame(() => {
                const activityPage = document.getElementById('tabActivityManagement');
                if (activityPage && !activityPage.classList.contains('hidden')) openActivityModal();
            });
        }
        function closeMemoModal() { document.getElementById('memoSubmissionModal').classList.add('hidden'); }
        function toggleAdminCredentialVisibility() {
            const input = document.getElementById('adminPassInput');
            const button = document.getElementById('toggleAdminCredentialVisibility');
            if (!input || !button) return;
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            button.innerHTML = show ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.7A10.8 10.8 0 0 1 12 5.5c6.1 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3.1 3.8M6.2 6.3C3.8 8 2.5 12 2.5 12s3.4 6.5 9.5 6.5a9.9 9.9 0 0 0 3-.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.4 6.5-9.5 6.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
            button.setAttribute('aria-label', show ? 'Hide credential' : 'Show credential');
            button.setAttribute('aria-pressed', show ? 'true' : 'false');
            input.focus({ preventScroll: true });
        }
        function closeAdminModal() {
            const modal = document.getElementById('adminModal');
            const input = document.getElementById('adminPassInput');
            const toggle = document.getElementById('toggleAdminCredentialVisibility');
            modal?.classList.add('hidden');
            if (input) { input.value = ''; input.type = 'password'; input.disabled = false; }
            if (toggle) { toggle.setAttribute('aria-label', 'Show credential'); toggle.setAttribute('aria-pressed', 'false'); toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.4 6.5-9.5 6.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>'; }
            const verifyButton = document.getElementById('verifyAdminButton');
            if (verifyButton) { verifyButton.disabled = false; verifyButton.innerHTML = '<span aria-hidden="true">&#128273;</span> Verify and Continue'; }
            pendingAdminAction = null;
        }

        async function verifyAdmin() {
            const input = document.getElementById('adminPassInput');
            const pass = input.value;
            if (!pass) { input.focus(); return; }
            const activeUser = localStorage.getItem('loggedInUser') || '';
            if (!ALPHA_ADMIN_NAME || activeUser.toLowerCase() !== ALPHA_ADMIN_NAME.toLowerCase()) return customAlert('Alpha Admin authentication is not available for this session.', 'Permission Denied');
            const verifyButton = document.getElementById('verifyAdminButton');
            input.disabled = true;
            if (verifyButton) { verifyButton.disabled = true; verifyButton.textContent = 'Verifying…'; }
            try {
                const res = await fetch(API_URL, {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'verify_admin',username:activeUser,password:pass,sessionToken:localStorage.getItem('loggedCred') || '',issueStepUp:true})});
                const data = await res.json();
                if (data.success && data.adminToken) {
                    // The elevated token lives only in memory and expires after 15 minutes.
                    activateAlphaStepUpToken(data);
                    document.getElementById('adminModal').classList.add('hidden');
                    input.value = ''; input.type = 'password';
                    const toggle = document.getElementById('toggleAdminCredentialVisibility');
                    if (toggle) { toggle.setAttribute('aria-label', 'Show credential'); toggle.setAttribute('aria-pressed', 'false'); }
                    const action = pendingAdminAction; pendingAdminAction = null;
                    if (action === 'open_mgmt') showAdminMgmtTab();
                    else if (action === 'backup_manager') openSpadesBackupManager();
                } else { customAlert(data.error || 'Incorrect Alpha Admin credential.', 'Error'); input.value = ''; }
            } catch (error) { customAlert('Could not verify Alpha Admin credentials. Check the connection.', 'Error'); input.value = ''; }
            finally { input.disabled = false; const verifyButton = document.getElementById('verifyAdminButton'); if (verifyButton) { verifyButton.disabled = false; verifyButton.innerHTML = '<span aria-hidden="true">🔑</span> Verify and Continue'; } }
        }


        async function requestSpadesBackupManager() {
            if (!isAlphaAdmin()) return customAlert('Only Alpha Admin can manage system backups.', 'Permission Denied');
            pendingAdminAction = 'backup_manager';
            const title = document.getElementById('adminCredentialTitle');
            const description = document.getElementById('adminCredentialDescription');
            if (title) title.textContent = 'Verify Alpha Admin';
            if (description) description.textContent = 'Confirm your Alpha Admin credential to manage system backups and recovery copies.';
            const input = document.getElementById('adminPassInput');
            if (input) { input.value = ''; input.disabled = false; input.focus(); }
            document.getElementById('adminModal')?.classList.remove('hidden');
        }

        function openSpadesBackupManager() {
            document.getElementById('spadesBackupManagerModal')?.classList.remove('hidden');
            loadSpadesBackupList();
        }

        async function spadesBackupRequest(action, extra = {}) {
            if (!hasFreshAlphaStepUp()) throw new Error('Your administrator verification has expired. Please verify again.');
            const username = localStorage.getItem('loggedInUser') || '';
            const response = await fetch(API_URL, {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,userName:username,password:sessionAdminPass,...extra})});
            if (!response.ok) throw new Error('The server could not complete the backup request.');
            const result = await response.json();
            if (!result || !result.success) throw new Error(result?.error || 'The backup request was rejected.');
            return result;
        }

        async function loadSpadesBackupList() {
            const select = document.getElementById('spadesBackupSelect');
            const list = document.getElementById('spadesBackupList');
            const status = document.getElementById('spadesBackupStatus');
            if (status) status.textContent = 'Loading protected backup records…';
            try {
                const result = await spadesBackupRequest('get_spades_backups');
                const backups = Array.isArray(result.backups) ? result.backups : [];
                if (select) select.innerHTML = '<option value="">Select a backup…</option>' + backups.map(item => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(new Date(item.createdAt).toLocaleString())}</option>`).join('');
                if (list) list.innerHTML = backups.length ? backups.map(item => `<div class="spades-backup-row"><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(new Date(item.createdAt).toLocaleString())} · ${formatFolderBytes(item.size)}</small></div><span>Stored privately</span></div>`).join('') : '<div class="spades-backup-empty">No backup files found yet. Configure the daily schedule or create the first backup.</div>';
                if (status) status.textContent = `${backups.length} backup(s) available. The system retains the latest 30 scheduled/manual backups.`;
            } catch (error) { if (status) status.textContent = error.message; if (list) list.innerHTML = '<div class="spades-backup-empty">Backup list unavailable.</div>'; }
        }

        async function createSpadesBackupNow() {
            const button = document.getElementById('spadesCreateBackupBtn');
            if (button) { button.disabled = true; button.textContent = 'Creating backup…'; }
            try {
                const result = await spadesBackupRequest('create_spades_backup');
                if (result.backup?.url) { const status = document.getElementById('spadesBackupStatus'); if (status) status.textContent = `Backup created: ${result.backup.name}`; }
                await loadSpadesBackupList();
                customAlert('A new SPADES backup was created successfully.', 'Backup Complete');
            } catch (error) { customAlert(error.message, 'Backup Error'); }
            finally { if (button) { button.disabled = false; button.textContent = 'Create Backup Now'; } }
        }

        async function configureSpadesDailyBackupFromUI() {
            const button = document.getElementById('spadesSetupBackupScheduleBtn');
            if (button) { button.disabled = true; button.textContent = 'Configuring…'; }
            try {
                const result = await spadesBackupRequest('setup_spades_daily_backup');
                const status = document.getElementById('spadesBackupStatus');
                if (status) status.textContent = result.schedule || 'Daily backup schedule configured.';
                customAlert('Daily automatic backups are now scheduled.', 'Backup Schedule');
            } catch (error) { customAlert(error.message, 'Backup Error'); }
            finally { if (button) { button.disabled = false; button.textContent = 'Enable Daily Backup'; } }
        }

        async function prepareSpadesRecoveryCopy() {
            const backupId = document.getElementById('spadesBackupSelect')?.value || '';
            if (!backupId) return customAlert('Select a backup first.', 'Recovery');
            customConfirm('Create a separate recovery spreadsheet from this backup? The live SPADES database will remain unchanged.', async confirmed => {
                if (!confirmed) return;
                try {
                    const result = await spadesBackupRequest('create_spades_recovery_copy', {backupId});
                    const url = result.recovery?.url || '';
                    if (url) window.open(url, '_blank', 'noopener,noreferrer');
                    customAlert('A separate recovery copy was prepared. Verify its contents before using it as a replacement database.', 'Recovery Copy Ready');
                    await loadSpadesBackupList();
                } catch (error) { customAlert(error.message, 'Recovery Error'); }
            });
        }

        async function loadAdminUsers() {
            const tbody = document.getElementById('adminUsersTableBody');
            if (tbody && !tbody.querySelector('tr:not(.um-table-empty)')) tbody.innerHTML = '<tr><td colspan="6" class="um-table-empty"><span class="um-loading-dot"></span> Loading user accounts…</td></tr>';
            const userName = localStorage.getItem('loggedInUser') || '';
            try {
                const [usersResponse, announcementResponse] = await Promise.all([
                    fetch(API_URL, {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'get_all_users',userName,password:sessionAdminPass})}),
                    fetch(`${API_URL}?action=get_announcement&_ts=${Date.now()}`, {cache:'no-store'})
                ]);
                const data = await usersResponse.json();
                const dataAnnouncement = await announcementResponse.json();
                const announcement = document.getElementById('adminAnnouncementText');
                if (announcement) announcement.value = (dataAnnouncement.success && dataAnnouncement.message) ? dataAnnouncement.message : '';
                if (!data || !data.success) {
                    adminUsersCache = []; updateAdminUserSummary([]);
                    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="um-table-empty um-error-empty">Could not load accounts. Your Alpha Admin session may have expired; return to Settings and authenticate again.</td></tr>';
                    const count = document.getElementById('adminUsersResultCount'); if (count) count.textContent = 'Unable to load accounts';
                    return;
                }
                adminUsersCache = Array.isArray(data.users) ? data.users.map(user => ({...user,username:String(user.username || ''),role:String(user.role || 'Regular User'),status:String(user.status || 'Active')})) : [];
                try { await loadUserAccessMap(); } catch (error) {}
                try { await loadUserRestrictions(); } catch (error) {}
                updateAdminUserSummary(adminUsersCache); renderAdminUsers();
            } catch (error) {
                console.error('Unable to load User Management accounts.', error);
                adminUsersCache = []; updateAdminUserSummary([]);
                if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="um-table-empty um-error-empty">A connection error prevented account data from loading. Please retry.</td></tr>';
                const count = document.getElementById('adminUsersResultCount'); if (count) count.textContent = 'Connection error';
            }
        }
        function updateAdminUserSummary(users) {
            const statusOf = user => String(user.status || 'Active').trim().toLowerCase();
            const setValue = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(value); };
            setValue('umTotalUsers', users.length);
            setValue('umActiveUsers', users.filter(user => statusOf(user) !== 'pending').length);
            setValue('umPendingUsers', users.filter(user => statusOf(user) === 'pending').length);
            setValue('umAdminUsers', users.filter(user => String(user.role || '') === 'Admin').length);
        }
        function renderAdminUsers() {
            const tbody = document.getElementById('adminUsersTableBody'); if (!tbody) return;
            const query = String(document.getElementById('adminUserSearch')?.value || '').trim().toLowerCase();
            const statusFilter = String(document.getElementById('adminStatusFilter')?.value || 'all').toLowerCase();
            const roleFilter = String(document.getElementById('adminRoleFilter')?.value || 'all');
            const filtered = adminUsersCache.filter(user => {
                const status = String(user.status || 'Active').trim().toLowerCase();
                const role = String(user.role || 'Regular User');
                const searchText = `${user.rank || ''} ${user.name || ''} ${user.username || ''}`.toLowerCase();
                return (!query || searchText.includes(query)) && (statusFilter === 'all' || status === statusFilter) && (roleFilter === 'all' || role === roleFilter);
            });
            const count = document.getElementById('adminUsersResultCount');
            if (count) count.textContent = `${filtered.length} of ${adminUsersCache.length} account${adminUsersCache.length === 1 ? '' : 's'}`;
            if (!filtered.length) {
                tbody.innerHTML = '<tr><td colspan="6" class="um-table-empty"><span class="um-empty-icon">&#128269;</span><strong>No matching accounts</strong><small>Try changing the search terms or filters.</small></td></tr>';
                return;
            }
            tbody.innerHTML = filtered.map(user => {
                const username = String(user.username || ''), safeUser = escapeAttr(username);
                const name = String(user.name || '').trim() || username;
                const rank = String(user.rank || '').trim();
                const role = String(user.role || 'Regular User');
                const statusText = String(user.status || 'Active');
                const isPending = statusText.trim().toLowerCase() === 'pending';
                const restricted = !!userRestrictedMap[username];
                const roleOptions = `<option value="Regular User" ${role === 'Regular User' ? 'selected' : ''}>Regular User</option><option value="Admin" ${role === 'Admin' ? 'selected' : ''}>Admin</option>`;
                const accessButton = `<button type="button" class="um-action-link um-access-icon-btn" data-um-action="access" data-username="${safeUser}" title="Configure allowed page access" aria-label="Configure allowed page access for ${safeUser}"><i class="fi fi-rr-settings-sliders" aria-hidden="true"></i></button>`;
                const restrictButton = isPending ? '' : `<button type="button" class="um-mini-btn um-access-icon-btn ${restricted ? 'um-mini-danger' : 'um-mini-neutral'}" data-um-action="restrict" data-restrict="${restricted ? 'false' : 'true'}" data-username="${safeUser}" title="${restricted ? 'Remove read-only restriction' : 'Restrict to read-only access'}" aria-label="${restricted ? 'Remove read-only restriction' : 'Restrict to read-only access'} for ${safeUser}"><i class="fi ${restricted ? 'fi-rr-unlock' : 'fi-rr-lock'}" aria-hidden="true"></i></button>`;
                const primaryActions = isPending ? `<button type="button" class="um-mini-btn um-mini-success" data-um-action="approve" data-username="${safeUser}">Approve</button><button type="button" class="um-mini-btn um-mini-danger" data-um-action="reject" data-username="${safeUser}">Reject</button>` : `<button type="button" class="um-mini-btn um-mini-danger" data-um-action="delete" data-username="${safeUser}">Delete account</button>`;
                return `<tr>
                    <td><div class="um-account-cell"><span class="um-account-avatar">${escapeHtml(String((name || username).trim().charAt(0) || 'U').toUpperCase())}</span><div class="um-account-copy"><button type="button" class="um-account-name" data-um-action="view-profile" data-username="${safeUser}">${escapeHtml(name)}</button><span>${escapeHtml(rank || 'Personnel account')}</span></div></div></td>
                    <td><span class="um-username">@${escapeHtml(username)}</span></td>
                    <td><select class="um-role-select" aria-label="Assigned role for ${escapeAttr(username)}" data-um-action="role" data-username="${safeUser}">${roleOptions}</select></td>
                    <td><span class="um-status-pill ${isPending ? 'um-status-pending' : 'um-status-active'}"><span></span>${escapeHtml(statusText)}</span></td>
                    <td><div class="um-access-actions">${accessButton}${restrictButton}</div></td>
                    <td><div class="um-row-actions">${primaryActions}</div></td>
                </tr>`;
            }).join('');
        }
        const adminUsersTbody = document.getElementById('adminUsersTableBody');
        if (adminUsersTbody) {
            adminUsersTbody.addEventListener('click', event => {
                const control = event.target.closest('[data-um-action]'); if (!control) return;
                const username = control.getAttribute('data-username') || '';
                const action = control.getAttribute('data-um-action');
                if (action === 'view-profile') viewUserProfile(username);
                else if (action === 'access') openUserAccessModal(username);
                else if (action === 'restrict') toggleUserRestriction(username, control.getAttribute('data-restrict') === 'true');
                else if (action === 'approve') processApproval(username, 'approve_user');
                else if (action === 'reject') processApproval(username, 'reject_user');
                else if (action === 'delete') adminDeleteUser(username);
            });
            adminUsersTbody.addEventListener('change', event => {
                const control = event.target.closest('[data-um-action="role"]');
                if (control) changeUserRole(control.getAttribute('data-username') || '', control.value);
            });
        }
        function changeUserRole(username, newRole) {
            customConfirm(`Set role for ${username} to ${newRole === 'Admin' ? 'Admin' : 'Regular User'}?`, async confirmed => {
                if (!confirmed) { loadAdminUsers(); return; }
                try {
                    const response = await fetch(API_URL, {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'set_role',username,role:newRole,password:sessionAdminPass,userName:localStorage.getItem('loggedInUser') || ''})});
                    const result = await response.json();
                    if (!result.success) { customAlert(result.error || 'The role change was rejected.', 'Error'); loadAdminUsers(); return; }
                    customAlert(`Role updated for ${username}.`, 'Success'); logActivity(`changed role of user "${username}" to ${newRole}`); await loadAdminUsers();
                } catch (error) { customAlert('Failed to update user role. Please retry.', 'Error'); }
            });
        }
        function adminDeleteUser(username) {
            customConfirm(`Delete the account for ${username}? This action cannot be undone.`, async confirmed => {
                if (!confirmed) return;
                try {
                    const response = await fetch(API_URL, {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'delete_user_admin',username,password:sessionAdminPass,userName:localStorage.getItem('loggedInUser') || ''})});
                    const result = await response.json();
                    if (!result.success) { customAlert(result.error || 'Could not delete this account.', 'Error'); return; }
                    customAlert(`Account ${username} deleted.`, 'Success'); logActivity(`deleted user account: ${username}`); await loadAdminUsers();
                } catch (error) { customAlert('Failed to delete account. Please retry.', 'Error'); }
            });
        }
        function processApproval(userIdentifier, actionType) {
            const verb = actionType === 'approve_user' ? 'approve' : 'reject and remove';
            customConfirm(`Are you sure you want to ${verb} the account ${userIdentifier}?`, async confirmed => {
                if (!confirmed) return;
                try {
                    const response = await fetch(API_URL, {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:actionType,username:userIdentifier,userPin:userIdentifier,password:sessionAdminPass,userName:localStorage.getItem('loggedInUser') || ''})});
                    const result = await response.json();
                    if (!result.success) { customAlert(result.error || 'The account action was rejected.', 'Error'); return; }
                    customAlert(actionType === 'approve_user' ? `Account ${userIdentifier} approved.` : `Account ${userIdentifier} rejected and removed.`, 'Success');
                    logActivity(actionType === 'approve_user' ? 'approved a new user account.' : 'rejected an account request.'); await loadAdminUsers();
                } catch (error) { customAlert('Unable to complete the account action. Please retry.', 'Error'); }
            });
        }
        function isAlphaAdmin() {
            const current = String(localStorage.getItem('loggedInUser') || '').trim().toLowerCase();
            const configured = String(ALPHA_ADMIN_NAME || '').trim().toLowerCase();
            const hasSession = !!localStorage.getItem('loggedCred');
            const serverRole = String(localStorage.getItem('userRole') || '').trim().toLowerCase();
            // This is a UI visibility hint only. The Apps Script backend still validates
            // the signed session and the separate elevated token for every restricted action.
            return !!current && (!!configured && current === configured || (hasSession && serverRole === 'alpha admin'));
        }

        function syncAlphaAdminAccessVisibility() {
            const alphaAdmin = isAlphaAdmin();
            // User Management is intentionally nested in Settings, never shown in the sidebar.
            document.getElementById('btnAdminMgmt')?.classList.add('hidden');
            document.getElementById('settingsUserMgmtBtn')?.classList.toggle('hidden', !alphaAdmin);
            document.getElementById('memoBarcodeSettingsBtn')?.classList.toggle('hidden', !alphaAdmin);
            document.getElementById('settingsBackupAdminCard')?.classList.toggle('hidden', !alphaAdmin);
        }

        function canManagePersonnel() {
            const role = localStorage.getItem('userRole') || '';
            const username = localStorage.getItem('loggedInUser') || '';
            if (typeof userRestrictedMap !== 'undefined' && userRestrictedMap[username]) return false;
            return isAlphaAdmin() || role === 'Admin' || localStorage.getItem('canEdit') === 'Yes';
        }

        function canPersonnelAction(subpage, operation) {
            const username = localStorage.getItem('loggedInUser') || '';
            if (isAlphaAdmin()) return true;
            if (typeof userRestrictedMap !== 'undefined' && userRestrictedMap[username]) return false;
            const explicit = userPersonnelPermissionsMap && userPersonnelPermissionsMap[username];
            if (explicit && Object.prototype.hasOwnProperty.call(explicit, subpage)) {
                return !!(explicit[subpage] && explicit[subpage][operation] === true);
            }
            // Preserve legacy Admin behavior until an explicit permission matrix is saved.
            return canManagePersonnel();
        }

        // Permission-sensitive Personnel Management writes use readable JSON responses,
        // so the UI never displays a success message for a backend-rejected operation.
        async function postPersonnelMutation(payload) {
            const response = await fetch(API_URL, {
                method: 'POST',
                mode: 'cors',
                headers: {'Content-Type': 'text/plain;charset=utf-8'},
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(`Request failed (${response.status}).`);
            const result = await response.json();
            if (!result || result.success !== true) {
                throw new Error((result && result.error) || 'The requested change was rejected by the backend.');
            }
            return result;
        }

        /* ---------- MATRIX OF COMPLIANCES ---------- */
        let matrixComplianceCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const MATRIX_COMPLIANCE_FREQUENCIES = ['None', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Semestral', 'Annually'];

        function matrixComplianceAuthPayload(action, extra = {}) {
            return Object.assign({
                action: action,
                userName: localStorage.getItem('loggedInUser') || '',
                credential: localStorage.getItem('loggedCred') || ''
            }, extra || {});
        }

        function formatMatrixComplianceDate(value, includeTime = false) {
            if (!value) return '—';
            const raw = String(value);
            const date = includeTime ? new Date(raw) : new Date(raw.slice(0, 10) + 'T12:00:00');
            if (Number.isNaN(date.getTime())) return raw;
            return includeTime
                ? date.toLocaleString(undefined, {year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})
                : date.toLocaleDateString(undefined, {year:'numeric', month:'short', day:'numeric'});
        }

        function setMatrixComplianceNotice(message, type = '') {
            const notice = document.getElementById('matrixComplianceNotice');
            if (!notice) return;
            notice.textContent = String(message || '');
            notice.className = 'matrix-compliance-notice' + (type ? ' is-' + type : '');
        }

        function matrixComplianceDateObject(value) {
            const key = String(value || '').slice(0, 10);
            const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!match) return null;
            const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            return Number.isNaN(date.getTime()) ? null : date;
        }

        function matrixComplianceFrequencyLabel(value) {
            const normalized = String(value || 'None').trim().toLowerCase();
            return MATRIX_COMPLIANCE_FREQUENCIES.find(item => item.toLowerCase() === normalized) || 'None';
        }

        function matrixComplianceOccursOnDate(record, dateObject) {
            const anchor = matrixComplianceDateObject(record && record.targetDate);
            if (!anchor || !dateObject) return false;
            const occurrence = new Date(dateObject.getFullYear(), dateObject.getMonth(), dateObject.getDate());
            const anchorKey = localDateKey(anchor);
            const occurrenceKey = localDateKey(occurrence);
            if (occurrenceKey < anchorKey) return false;
            const until = matrixComplianceDateObject(record && record.recurrenceUntil);
            if (until && occurrenceKey > localDateKey(until)) return false;

            const frequency = matrixComplianceFrequencyLabel(record && record.frequency);
            if (frequency === 'None') return occurrenceKey === anchorKey;
            if (frequency === 'Daily') return true;

            const dayDifference = Math.round((occurrence.getTime() - anchor.getTime()) / 86400000);
            if (frequency === 'Weekly') return dayDifference >= 0 && dayDifference % 7 === 0;

            const monthDifference = (occurrence.getFullYear() - anchor.getFullYear()) * 12 + occurrence.getMonth() - anchor.getMonth();
            const expectedDay = Math.min(anchor.getDate(), new Date(occurrence.getFullYear(), occurrence.getMonth() + 1, 0).getDate());
            if (frequency === 'Monthly') return monthDifference >= 0 && occurrence.getDate() === expectedDay;
            if (frequency === 'Quarterly') return monthDifference >= 0 && monthDifference % 3 === 0 && occurrence.getDate() === expectedDay;
            if (frequency === 'Semestral') return monthDifference >= 0 && monthDifference % 6 === 0 && occurrence.getDate() === expectedDay;
            if (frequency === 'Annually') return occurrence.getMonth() === anchor.getMonth() && occurrence.getDate() === Math.min(anchor.getDate(), new Date(occurrence.getFullYear(), occurrence.getMonth() + 1, 0).getDate());
            return occurrenceKey === anchorKey;
        }

        function changeMatrixComplianceCalendarMonth(delta) {
            matrixComplianceCalendarMonth = new Date(matrixComplianceCalendarMonth.getFullYear(), matrixComplianceCalendarMonth.getMonth() + Number(delta || 0), 1);
            renderMatrixComplianceCalendar();
        }

        function renderMatrixComplianceCalendar() {
            const host = document.getElementById('matrixComplianceCalendar');
            const title = document.getElementById('matrixComplianceCalendarMonthTitle');
            if (!host || !title) return;
            const year = matrixComplianceCalendarMonth.getFullYear();
            const month = matrixComplianceCalendarMonth.getMonth();
            title.textContent = matrixComplianceCalendarMonth.toLocaleDateString(undefined, {month:'long', year:'numeric'});
            const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            let html = weekdays.map(day => `<div class="activity-overview-weekday">${day}</div>`).join('');
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const previousMonthDays = new Date(year, month, 0).getDate();
            const today = localDateKey(new Date());
            let totalOccurrences = 0;
            for (let index = 0; index < 42; index++) {
                const rawDay = index - firstDay + 1;
                const date = rawDay < 1
                    ? new Date(year, month - 1, previousMonthDays + rawDay)
                    : rawDay > daysInMonth
                        ? new Date(year, month + 1, rawDay - daysInMonth)
                        : new Date(year, month, rawDay);
                const key = localDateKey(date);
                const isOtherMonth = date.getMonth() !== month;
                const matches = (matrixComplianceRecords || []).filter(record => matrixComplianceOccursOnDate(record, date));
                if (!isOtherMonth) totalOccurrences += matches.length;
                const list = matches.map(record => {
                    const recurring = matrixComplianceFrequencyLabel(record.frequency) !== 'None';
                    const frequency = recurring ? ` · ${matrixComplianceFrequencyLabel(record.frequency)}` : '';
                    const office = record.officeInCharge ? `Office In-charge: ${record.officeInCharge}` : '';
                    return `<button type="button" class="activity-overview-event-text matrix-compliance-event-text matrix-compliance-event-button${recurring ? ' is-recurring' : ''}" data-matrix-compliance-details-id="${escapeAttr(record.id)}" onclick="openMatrixComplianceInformationModal(this.dataset.matrixComplianceDetailsId)" title="Open compliance information: ${escapeAttr(record.compliance || 'Untitled compliance')}${escapeAttr(frequency)}${office ? ' — ' + escapeAttr(office) : ''}">${escapeHtml(record.compliance || 'Untitled compliance')}${recurring ? `<span class="matrix-compliance-recurrence-label">${escapeHtml(frequency)}</span>` : ''}</button>`;
                }).join('');
                html += `<div class="activity-overview-day${isOtherMonth ? ' is-other-month' : ''}${key === today ? ' is-today' : ''}"><span class="activity-overview-day-number">${date.getDate()}</span>${list ? `<div class="activity-overview-events activity-day-text-list" aria-label="Compliances scheduled on ${escapeAttr(key)}">${list}</div>` : ''}</div>`;
            }
            host.innerHTML = html;
            const count = document.getElementById('matrixComplianceCalendarCount');
            if (count) count.textContent = `${totalOccurrences} scheduled ${totalOccurrences === 1 ? 'occurrence' : 'occurrences'} this month`;
        }

        function toggleMatrixComplianceRepeatUntil() {
            const frequency = matrixComplianceFrequencyLabel(document.getElementById('matrixComplianceFrequency')?.value);
            const until = document.getElementById('matrixComplianceRepeatUntil');
            if (until) {
                until.disabled = frequency === 'None';
                if (frequency === 'None') until.value = '';
            }
        }

        async function loadMatrixCompliances() {
            const tbody = document.getElementById('matrixComplianceTableBody');
            const currentUser = localStorage.getItem('loggedInUser') || 'Current account';
            const accountLabel = document.getElementById('matrixComplianceAccountLabel');
            if (accountLabel) accountLabel.textContent = currentUser;
            if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="matrix-compliance-empty"><span class="matrix-compliance-loading" aria-hidden="true"></span> Loading the compliance register…</td></tr>';
            setMatrixComplianceNotice('Connecting to the shared compliance register…');
            try {
                const result = await postPersonnelMutation(matrixComplianceAuthPayload('get_matrix_compliances'));
                matrixComplianceRecords = Array.isArray(result.records) ? result.records : [];
                matrixComplianceReadOnly = !!result.readOnly;
                matrixComplianceIsAlphaAdmin = !!result.alphaAdmin;
                const addButton = document.getElementById('matrixComplianceAddBtn');
                if (addButton) {
                    addButton.disabled = matrixComplianceReadOnly;
                    addButton.title = matrixComplianceReadOnly ? 'This account is restricted to read-only access' : 'Add compliance';
                }
                renderMatrixCompliances();
                renderMatrixComplianceCalendar();
                setMatrixComplianceNotice(
                    matrixComplianceReadOnly
                        ? 'Read-only account: you can review the shared register but cannot add, edit, or delete entries.'
                        : (matrixComplianceIsAlphaAdmin ? 'Shared register loaded. Alpha Admin can manage all entries.' : 'Shared register loaded. You can manage entries you encoded.'),
                    matrixComplianceReadOnly ? 'warning' : 'success'
                );
            } catch (error) {
                matrixComplianceRecords = [];
                matrixComplianceReadOnly = true;
                renderMatrixComplianceCalendar();
                if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="matrix-compliance-empty matrix-compliance-error">Unable to load the compliance register. ' + escapeHtml(error.message || 'Please retry.') + '</td></tr>';
                document.getElementById('matrixCompliancePagination')?.classList.add('hidden');
                setMatrixComplianceNotice(error.message || 'Unable to connect to the compliance service.', 'error');
                const addButton = document.getElementById('matrixComplianceAddBtn');
                if (addButton) addButton.disabled = true;
            }
        }

        function renderMatrixCompliances() {
            const tbody = document.getElementById('matrixComplianceTableBody');
            if (!tbody) return;
            const search = String(document.getElementById('matrixComplianceSearch')?.value || '').trim().toLowerCase();
            const matchingRows = matrixComplianceRecords.filter(record => {
                const haystack = [record.compliance, record.officeInCharge, record.actionTaken, record.targetDate, record.targetTime, record.frequency, record.encodedBy].join(' ').toLowerCase();
                return !search || haystack.includes(search);
            });
            const pagination = document.getElementById('matrixCompliancePagination');
            const pageInfo = document.getElementById('matrixCompliancePageInfo');
            const previousButton = document.getElementById('prevMatrixComplianceBtn');
            const nextButton = document.getElementById('nextMatrixComplianceBtn');

            if (!matchingRows.length) {
                const message = matrixComplianceRecords.length
                    ? 'No compliance records match your search.'
                    : 'No compliance entries yet. Select Add Compliance to record the first requirement.';
                tbody.innerHTML = '<tr><td colspan="9" class="matrix-compliance-empty"><i class="fi fi-rr-clipboard-list"></i><span>' + escapeHtml(message) + '</span></td></tr>';
                if (pagination) pagination.classList.add('hidden');
                return;
            }

            const totalPages = Math.max(1, Math.ceil(matchingRows.length / MATRIX_COMPLIANCES_PER_PAGE));
            currentMatrixCompliancePage = Math.min(Math.max(currentMatrixCompliancePage, 1), totalPages);
            const startIndex = (currentMatrixCompliancePage - 1) * MATRIX_COMPLIANCES_PER_PAGE;
            const pageRows = matchingRows.slice(startIndex, startIndex + MATRIX_COMPLIANCES_PER_PAGE);
            const currentUser = String(localStorage.getItem('loggedInUser') || '').trim().toLowerCase();

            tbody.innerHTML = pageRows.map(record => {
                const encodedId = escapeAttr(String(record.id || ''));
                const compliance = escapeHtml(record.compliance || 'Untitled compliance');
                const office = escapeHtml(record.officeInCharge || 'Not specified');
                const actionTaken = escapeHtml(record.actionTaken || 'Not yet recorded');
                const encodedBy = escapeHtml(record.encodedBy || 'Unknown');
                const targetDate = formatMatrixComplianceDate(record.targetDate);
                const targetTime = record.targetTime ? formatActivityTime(record.targetTime) : '—';
                const lastUpdated = formatMatrixComplianceDate(record.updatedAt || record.createdAt, true);
                const recurrence = matrixComplianceFrequencyLabel(record.frequency);
                const recurrenceText = recurrence === 'None' ? 'One-time' : recurrence + (record.recurrenceUntil ? ` · until ${formatMatrixComplianceDate(record.recurrenceUntil)}` : ' · ongoing');
                const canManage = !matrixComplianceReadOnly && (matrixComplianceIsAlphaAdmin || String(record.encodedBy || '').trim().toLowerCase() === currentUser);
                const disabled = canManage ? '' : ' disabled aria-disabled="true"';
                return '<tr data-matrix-compliance-id="' + encodedId + '" class="matrix-compliance-clickable-row" tabindex="0" role="button" aria-label="View compliance information: ' + escapeAttr(record.compliance || 'Compliance') + '" onclick="if(!event.target.closest(\'button,a,input,select,textarea\'))openMatrixComplianceInformationModal(this.dataset.matrixComplianceId)" onkeydown="if((event.key===\'Enter\'||event.key===\' \')&&!event.target.closest(\'button,a,input,select,textarea\')){event.preventDefault();openMatrixComplianceInformationModal(this.dataset.matrixComplianceId)}">'
                    + '<td class="matrix-compliance-main-cell"><strong>' + compliance + '</strong></td>'
                    + '<td class="matrix-compliance-date-cell">' + escapeHtml(targetDate) + '</td>'
                    + '<td class="matrix-compliance-time-cell">' + escapeHtml(targetTime) + '</td>'
                    + '<td class="matrix-compliance-office-cell">' + office + '</td>'
                    + '<td class="matrix-compliance-action-cell">' + actionTaken + '</td>'
                    + '<td class="matrix-compliance-recurrence-cell">' + escapeHtml(recurrenceText) + '</td>'
                    + '<td class="matrix-compliance-owner-cell">' + encodedBy + '</td>'
                    + '<td class="matrix-compliance-updated-cell">' + escapeHtml(lastUpdated) + '</td>'
                    + '<td class="matrix-compliance-actions-cell"><div class="matrix-compliance-row-actions">'
                    + '<button type="button" class="action-btn icon-action-btn matrix-compliance-edit" onclick="openMatrixComplianceModal(\'' + encodedId + '\')" title="Edit compliance" aria-label="Edit compliance"' + disabled + '><i class="fi fi-rr-edit" aria-hidden="true"></i></button>'
                    + '<button type="button" class="action-btn icon-action-btn matrix-compliance-delete" onclick="deleteMatrixCompliance(\'' + encodedId + '\')" title="Delete compliance" aria-label="Delete compliance"' + disabled + '><i class="fi fi-rr-trash" aria-hidden="true"></i></button>'
                    + '</div></td></tr>';
            }).join('');

            if (pagination) pagination.classList.toggle('hidden', matchingRows.length <= MATRIX_COMPLIANCES_PER_PAGE);
            if (pageInfo) pageInfo.textContent = `Page ${currentMatrixCompliancePage} of ${totalPages} · ${matchingRows.length} ${matchingRows.length === 1 ? 'record' : 'records'}`;
            if (previousButton) previousButton.disabled = currentMatrixCompliancePage === 1;
            if (nextButton) nextButton.disabled = currentMatrixCompliancePage === totalPages;
        }

        function filterMatrixCompliances() { currentMatrixCompliancePage = 1; renderMatrixCompliances(); }

        function changeMatrixCompliancePage(direction) {
            currentMatrixCompliancePage += Number(direction || 0);
            renderMatrixCompliances();
        }

        function matrixComplianceInfoValue(value, fallback='Not Provided') {
            const text = String(value == null ? '' : value).trim();
            return text ? escapeHtml(text) : fallback;
        }

        function openMatrixComplianceInformationModal(id) {
            const record = matrixComplianceRecords.find(item => String(item.id) === String(id || ''));
            if (!record) return customAlert('The selected compliance record could not be found. Refresh the register and try again.', 'Record Not Found');
            const target = matrixComplianceDateObject(record.targetDate);
            const recurring = matrixComplianceFrequencyLabel(record.frequency);
            const recurrenceText = recurring === 'None' ? 'One-time' : recurring + (record.recurrenceUntil ? ' · until ' + formatMatrixComplianceDate(record.recurrenceUntil) : ' · ongoing');
            const rows = [
                ['Compliance Requirement', matrixComplianceInfoValue(record.compliance)],
                ['Target Date', matrixComplianceInfoValue(target ? formatMatrixComplianceDate(record.targetDate) : '')],
                ['Target Time', matrixComplianceInfoValue(record.targetTime)],
                ['Office In-charge', matrixComplianceInfoValue(record.officeInCharge)],
                ['Recurring Schedule', matrixComplianceInfoValue(recurrenceText)],
                ['Action Taken', matrixComplianceInfoValue(record.actionTaken)],
                ['Encoded By', matrixComplianceInfoValue(record.encodedBy)],
                ['Date Created', matrixComplianceInfoValue(record.createdAt ? formatMatrixComplianceDate(record.createdAt) : '')],
                ['Last Updated', matrixComplianceInfoValue(record.updatedAt ? formatMatrixComplianceDate(record.updatedAt) : '')],
                ['Record Reference', matrixComplianceInfoValue(record.id)]
            ];
            const content = document.getElementById('matrixComplianceInfoContent');
            if (content) content.innerHTML = rows.map(([label,value]) => `<div class="matrix-compliance-info-row"><span>${label}</span><strong>${value}</strong></div>`).join('');
            const editButton = document.getElementById('matrixComplianceInfoEditBtn');
            const currentUser = String(localStorage.getItem('loggedInUser') || '').trim().toLowerCase();
            const canEdit = !matrixComplianceReadOnly && (matrixComplianceIsAlphaAdmin || String(record.encodedBy || '').trim().toLowerCase() === currentUser);
            if (editButton) editButton.classList.toggle('hidden', !canEdit);
            const modal = document.getElementById('matrixComplianceInfoModal');
            if (modal) { modal.classList.remove('hidden'); modal.setAttribute('aria-hidden','false'); window.SPADESModalStack?.bringToFront(modal); }
            window.matrixComplianceInfoCurrentId = String(record.id);
        }

        function closeMatrixComplianceInfoModal() {
            const modal = document.getElementById('matrixComplianceInfoModal');
            if (modal) { modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true'); }
            window.matrixComplianceInfoCurrentId = '';
            window.SPADESModalStack?.refresh();
        }

        function editMatrixComplianceFromInfo() {
            const id = String(window.matrixComplianceInfoCurrentId || '');
            if (!id) return;
            closeMatrixComplianceInfoModal();
            openMatrixComplianceModal(id);
        }

        function openMatrixComplianceModal(id = '') {
            if (matrixComplianceReadOnly || matrixComplianceBusy) return customAlert('This account is restricted to read-only access.', 'Permission Denied');
            matrixComplianceEditingId = String(id || '');
            const record = matrixComplianceEditingId ? matrixComplianceRecords.find(item => String(item.id) === matrixComplianceEditingId) : null;
            if (matrixComplianceEditingId && !record) return customAlert('The selected compliance record could not be found. Refresh the page and try again.', 'Record Not Found');
            const title = document.getElementById('matrixComplianceModalTitle');
            const compliance = document.getElementById('matrixComplianceText');
            const target = document.getElementById('matrixComplianceTargetDate');
            const office = document.getElementById('matrixComplianceOfficeInCharge');
            const targetTime = document.getElementById('matrixComplianceTargetTime');
            const action = document.getElementById('matrixComplianceActionTaken');
            const frequency = document.getElementById('matrixComplianceFrequency');
            const repeatUntil = document.getElementById('matrixComplianceRepeatUntil');
            const saveLabel = document.getElementById('matrixComplianceSaveLabel');
            if (title) title.textContent = record ? 'Edit Compliance' : 'Add Compliance';
            if (compliance) compliance.value = record ? String(record.compliance || '') : '';
            if (target) target.value = record ? String(record.targetDate || '').slice(0, 10) : '';
            if (targetTime) targetTime.value = record ? String(record.targetTime || '').slice(0, 5) : '';
            if (office) office.value = record ? String(record.officeInCharge || '') : '';
            if (action) action.value = record ? String(record.actionTaken || '') : '';
            if (frequency) frequency.value = matrixComplianceFrequencyLabel(record && record.frequency);
            if (repeatUntil) repeatUntil.value = record ? String(record.recurrenceUntil || '').slice(0, 10) : '';
            if (saveLabel) saveLabel.textContent = record ? 'Save Changes' : 'Save Compliance';
            toggleMatrixComplianceRepeatUntil();
            const modal = document.getElementById('matrixComplianceModal');
            if (modal) {
                modal.classList.remove('hidden');
                modal.setAttribute('aria-hidden', 'false');
                window.SPADESModalStack?.bringToFront(modal);
                window.setTimeout(() => compliance?.focus({preventScroll:true}), 30);
            }
        }

        function closeMatrixComplianceModal() {
            const modal = document.getElementById('matrixComplianceModal');
            if (modal) {
                modal.classList.add('hidden');
                modal.setAttribute('aria-hidden', 'true');
            }
            matrixComplianceEditingId = '';
            matrixComplianceBusy = false;
            const form = document.getElementById('matrixComplianceForm');
            if (form) form.reset();
            const saveButton = document.getElementById('matrixComplianceSaveBtn');
            if (saveButton) saveButton.disabled = false;
            toggleMatrixComplianceRepeatUntil();
            window.SPADESModalStack?.refresh();
        }

        async function saveMatrixCompliance() {
            if (matrixComplianceReadOnly || matrixComplianceBusy) return;
            const wasEditing = !!matrixComplianceEditingId;
            const compliance = String(document.getElementById('matrixComplianceText')?.value || '').trim();
            const targetDate = String(document.getElementById('matrixComplianceTargetDate')?.value || '').trim();
            const targetTime = String(document.getElementById('matrixComplianceTargetTime')?.value || '').trim();
            const officeInCharge = String(document.getElementById('matrixComplianceOfficeInCharge')?.value || '').trim();
            const actionTaken = String(document.getElementById('matrixComplianceActionTaken')?.value || '').trim();
            const frequency = matrixComplianceFrequencyLabel(document.getElementById('matrixComplianceFrequency')?.value);
            const recurrenceUntil = frequency === 'None' ? '' : String(document.getElementById('matrixComplianceRepeatUntil')?.value || '').trim();
            if (!compliance || !targetDate || !officeInCharge) return customAlert('Please provide the compliance, target date, and Office In-charge.', 'Required Information');
            if (recurrenceUntil && recurrenceUntil < targetDate) return customAlert('Repeat Until must be on or after the Target Date.', 'Invalid Recurrence');
            const saveButton = document.getElementById('matrixComplianceSaveBtn');
            const saveLabel = document.getElementById('matrixComplianceSaveLabel');
            matrixComplianceBusy = true;
            if (saveButton) saveButton.disabled = true;
            if (saveLabel) saveLabel.textContent = 'Saving…';
            try {
                const action = matrixComplianceEditingId ? 'update_matrix_compliance' : 'add_matrix_compliance';
                const payload = matrixComplianceAuthPayload(action, {compliance, targetDate, targetTime, officeInCharge, actionTaken, frequency, recurrenceUntil});
                if (matrixComplianceEditingId) payload.id = matrixComplianceEditingId;
                await postPersonnelMutation(payload);
                closeMatrixComplianceModal();
                await loadMatrixCompliances();
                customAlert(wasEditing ? 'Compliance record updated successfully.' : 'Compliance record saved successfully.', 'Success');
            } catch (error) {
                matrixComplianceBusy = false;
                if (saveButton) saveButton.disabled = false;
                if (saveLabel) saveLabel.textContent = matrixComplianceEditingId ? 'Save Changes' : 'Save Compliance';
                customAlert(error.message || 'Unable to save the compliance record.', 'Error');
            }
        }

        function deleteMatrixCompliance(id) {
            if (matrixComplianceReadOnly || matrixComplianceBusy) return customAlert('This account is restricted to read-only access.', 'Permission Denied');
            customConfirm('Delete this compliance record? This action cannot be undone.', async confirmed => {
                if (!confirmed) return;
                matrixComplianceBusy = true;
                try {
                    await postPersonnelMutation(matrixComplianceAuthPayload('delete_matrix_compliance', {id:String(id || '')}));
                    await loadMatrixCompliances();
                    customAlert('Compliance record deleted successfully.', 'Success');
                } catch (error) {
                    customAlert(error.message || 'Unable to delete the compliance record.', 'Error');
                } finally {
                    matrixComplianceBusy = false;
                }
            });
        }

        function updatePersonnelPermissions() {
            const controls = document.getElementById('personnelAdminControls');
            if (controls) controls.classList.toggle('hidden', currentPersonnelSubPage !== 'list' || !canPersonnelAction('list', 'add'));
            const header = document.getElementById('personnelActionHeader');
            if (header) header.style.display = canPersonnelAction('list', 'edit') ? '' : 'none';
            const setVisible = (id, allowed) => {
                const element = document.getElementById(id);
                if (element) element.style.display = allowed ? '' : 'none';
            };
            setVisible('dutyEditSeqBtn', canPersonnelAction('duty', 'edit'));
            setVisible('bmiAddBtn', canPersonnelAction('bmi', 'add'));
            setVisible('bmiActionHeader', canPersonnelAction('bmi', 'edit') || canPersonnelAction('bmi', 'delete'));
            setVisible('squadAddBtn', canPersonnelAction('squad', 'add'));
            setVisible('leaveAddBtn', canPersonnelAction('leave', 'add'));
            setVisible('leaveActionHeader', canPersonnelAction('leave', 'delete'));
            setVisible('areaAddBtn', canPersonnelAction('aor', 'add'));
        }

        async function loadPersonnel() {
            try {
                // Keep the original single backend request. All summaries, filters and
                // table data are derived from this one in-memory dataset.
                const res = await spadesAuthenticatedRead('get_personnel');
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Unable to load personnel');

                allPersonnel = Array.isArray(data.personnel) ? data.personnel : [];
                archivedPersonnel = Array.isArray(data.archived) ? data.archived : [];

                // Do lightweight preparation first so the data is available immediately.
                updatePersonnelDashboard();
                populatePersonnelFilters();
                populatePersonnelSections();

                // Wait for the table DOM to finish rendering before this loader resolves.
                // The global list-viewport wrapper restores the previous visible record
                // in the promise's finally() callback, so resolving before this frame
                // would allow the delayed table rebuild to jump the list back to the top.
                await new Promise(resolve => requestAnimationFrame(() => {
                    filterPersonnel();
                    const dashboard = document.getElementById('tabDashboard');
                    if (dashboard && !dashboard.classList.contains('hidden')) renderExecutiveDashboard();
                    resolve();
                }));
                return true;
            } catch (err) {
                console.error('Personnel data load failed:', err);
                const container = document.getElementById('personnelTablesContainer');
                if (container) {
                    container.innerHTML = `<div style="text-align:center;color:var(--danger);padding:20px;">Unable to load personnel records.</div>`;
                }
                customAlert("Unable to load the Personnel sheet.", "Error");
                return false;
            }
        }

        function togglePersonnelRecapPanel(forceState) {
            const panel = document.getElementById('personnelRecapPanel');
            const toggle = document.getElementById('personnelRecapToggle');
            if (!panel || !toggle) return;
            const collapsed = typeof forceState === 'boolean' ? forceState : !panel.classList.contains('is-collapsed');
            panel.classList.toggle('is-collapsed', collapsed);
            toggle.setAttribute('aria-expanded', String(!collapsed));
            const accessibleLabel = collapsed ? 'Expand Recapitulation' : 'Collapse Recapitulation';
            const iconName = collapsed ? 'fi-rr-angle-left' : 'fi-rr-angle-right';
            toggle.setAttribute('aria-label', accessibleLabel);
            toggle.setAttribute('title', accessibleLabel);
            toggle.setAttribute('data-tooltip', accessibleLabel);
            toggle.dataset.spadesIconName = iconName;
            toggle.classList.add('spades-force-icon-only');
            toggle.innerHTML = `<i class="fi ${iconName}" aria-hidden="true"></i><span class="spades-visually-hidden">${accessibleLabel}</span>`;
            const layout = panel.closest('.personnel-content-layout');
            if (layout) layout.classList.toggle('has-collapsed-recap', collapsed);
        }

        function rankGroup(rank) {
            const r = String(rank || '').trim().toUpperCase();
            const pnco = ['PAT','PCPL','PSSG','PMSG','PSMS','PCMS','PEMS'];
            const pco = ['PLT','PCPT','PMAJ','PLTCOL','PCOL'];
            if (pnco.includes(r)) return 'PNCO';
            if (pco.includes(r)) return 'PCO';
            if (r === 'NUP') return 'NUP';
            return 'Other';
        }

        function updatePersonnelDashboard() {
            const counts = {PNCO:0,PCO:0,NUP:0,Other:0};
            const rankCounts = {};
            const sectionCounts = {};
            const detachedRankCounts = {};
            const dsOtherRankCounts = {};
            const isDetached = p => String(p.section || '').trim().toLowerCase() === 'detached service';
            const isDsOther = p => String(p.section || '').trim().toLowerCase() === 'ds to other office/unit';

            // Detached Service and DS to Other Office/Unit personnel are intentionally
            // excluded from the main totals/recapitulations and tracked separately.
            allPersonnel.forEach(p => {
                if (isDetached(p)) {
                    const r = p.rank || 'Unspecified';
                    detachedRankCounts[r] = (detachedRankCounts[r] || 0) + 1;
                    return;
                }
                if (isDsOther(p)) {
                    const r = p.rank || 'Unspecified';
                    dsOtherRankCounts[r] = (dsOtherRankCounts[r] || 0) + 1;
                    // DS to Other Office/Unit remains separately recapitulated, but its
                    // personnel are included in the appropriate rank-group cards above.
                    counts[rankGroup(p.rank)]++;
                    return;
                }

                const g=rankGroup(p.rank);
                counts[g]++;
                const r=p.rank || 'Unspecified';
                rankCounts[r]=(rankCounts[r]||0)+1;

                const section = String(p.section || '').trim() || 'Unspecified';
                sectionCounts[section]=(sectionCounts[section]||0)+1;
            });

            // Counts already include DS to Other Office/Unit in its rank group.
            const mainTotal = Object.values(counts).reduce((a,b)=>a+b,0);
            document.getElementById('personnelTotal').innerText = mainTotal;
            document.getElementById('personnelPNCO').innerText = counts.PNCO;
            document.getElementById('personnelPCO').innerText = counts.PCO;
            document.getElementById('personnelNUP').innerText = counts.NUP;
            document.getElementById('personnelOther').innerText = counts.Other;

            const recap=document.getElementById('personnelRankRecap');
            const rankOrder = {
                'PBGEN':1, 'PCOL':2, 'PLTCOL':3, 'PMAJ':4, 'PCPT':5, 'PLT':6,
                'PEMS':7, 'PCMS':8, 'PSMS':9, 'PMSG':10, 'PSSG':11, 'PCPL':12,
                'PAT':13, 'NUP':14
            };
            const sortRanksHighestToLowest = (a,b) => {
                const ra=String(a||'').trim().toUpperCase(), rb=String(b||'').trim().toUpperCase();
                const oa=rankOrder[ra] || 99, ob=rankOrder[rb] || 99;
                return oa !== ob ? oa-ob : String(a).localeCompare(String(b));
            };
            recap.innerHTML=Object.keys(rankCounts).sort(sortRanksHighestToLowest).map(r =>
                `<div class="rank-chip"><span>${escapeHtml(r)}</span><strong>${rankCounts[r]}</strong></div>`).join('') ||
                '<div style="color:var(--text-muted);font-size:13px;">No personnel records.</div>';

            const sectionRecap=document.getElementById('personnelSectionRecap');
            sectionRecap.innerHTML=Object.keys(sectionCounts).sort((a,b)=>a.localeCompare(b)).map(section =>
                `<div class="rank-chip"><span>${escapeHtml(section)}</span><strong>${sectionCounts[section]}</strong></div>`).join('') ||
                '<div style="color:var(--text-muted);font-size:13px;">No personnel records.</div>';

            const detachedRecap=document.getElementById('detachedServiceRecap');
            const detachedTotal=Object.values(detachedRankCounts).reduce((a,b)=>a+b,0);
            detachedRecap.innerHTML = detachedTotal
                ? `<div class="rank-chip"><span>Total Detached Service</span><strong>${detachedTotal}</strong></div>` +
                  Object.keys(detachedRankCounts).sort(sortRanksHighestToLowest).map(r =>
                    `<div class="rank-chip"><span>${escapeHtml(r)}</span><strong>${detachedRankCounts[r]}</strong></div>`).join('')
                : '<div style="color:var(--text-muted);font-size:13px;">No Detached Service personnel.</div>';

            const dsOtherRecap=document.getElementById('dsOtherOfficeRecap');
            if (dsOtherRecap) {
                const dsOtherTotal=Object.values(dsOtherRankCounts).reduce((a,b)=>a+b,0);
                dsOtherRecap.innerHTML = dsOtherTotal
                    ? `<div class="rank-chip"><span>Total DS to Other Office/Unit</span><strong>${dsOtherTotal}</strong></div>` +
                      Object.keys(dsOtherRankCounts).sort(sortRanksHighestToLowest).map(r =>
                        `<div class="rank-chip"><span>${escapeHtml(r)}</span><strong>${dsOtherRankCounts[r]}</strong></div>`).join('')
                    : '<div style="color:var(--text-muted);font-size:13px;">No DS to Other Office/Unit personnel.</div>';
            }
        }
        function populatePersonnelFilters() {
            const records = [...(Array.isArray(allPersonnel) ? allPersonnel : []), ...(Array.isArray(archivedPersonnel) ? archivedPersonnel : [])];
            const ranks = [...new Set(records.map(p => String(p.rank || '').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
            const statuses = [...new Set(records.map(p => String(p.status || '').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
            const sectionsMap = new Map();
            records.forEach(p => {
                const value = String(p.section || '').trim();
                if (value && !sectionsMap.has(value.toLowerCase())) sectionsMap.set(value.toLowerCase(), value);
            });
            const sections = [...sectionsMap.values()].sort((a,b)=>a.localeCompare(b));
            const hasBlankSection = records.some(p => !String(p.section || '').trim());
            const rs = document.getElementById('personnelRankFilter'), ss = document.getElementById('personnelStatusFilter'), sec = document.getElementById('personnelSectionFilter');
            const oldR = rs ? rs.value : '', oldS = ss ? ss.value : '', oldSection = sec ? sec.value : '';
            if (rs) {
                rs.innerHTML = '<option value="">All Ranks</option>' + ranks.map(r => `<option value="${escapeAttr(r)}">${escapeHtml(r)}</option>`).join('');
                rs.value = ranks.includes(oldR) ? oldR : '';
            }
            if (ss) {
                ss.innerHTML = '<option value="">All Status</option>' + statuses.map(x => `<option value="${escapeAttr(x)}">${escapeHtml(x)}</option>`).join('');
                ss.value = statuses.includes(oldS) ? oldS : '';
            }
            if (sec) {
                sec.innerHTML = '<option value="">All Sections</option>' + sections.map(x => `<option value="${escapeAttr(x)}">${escapeHtml(x)}</option>`).join('') + (hasBlankSection ? '<option value="__blank__">Unspecified / Blank</option>' : '');
                sec.value = oldSection === '__blank__' && hasBlankSection ? '__blank__' : (sections.find(x => x.toLowerCase() === String(oldSection).toLowerCase()) || '');
            }
        }

        function populatePersonnelSections() {
            const select = document.getElementById('pSection');
            if (!select) return;

            // Preserve the existing/current section values from the backend while also
            // ensuring Detached Service and DS to Other Office/Unit are always available
            // as selectable options.
            const current = String(select.value || '').trim();
            const sections = [...new Set(
                allPersonnel
                    .map(p => String(p.section || '').trim())
                    .filter(Boolean)
            )].sort((a, b) => a.localeCompare(b));

            if (!sections.some(s => s.toLowerCase() === 'detached service')) {
                sections.push('Detached Service');
            }
            if (!sections.some(s => s.toLowerCase() === 'ds to other office/unit')) {
                sections.push('DS to Other Office/Unit');
            }

            select.innerHTML = '<option value="">Select Section...</option>' +
                sections.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');

            if (current && sections.some(s => s.toLowerCase() === current.toLowerCase())) {
                const match = sections.find(s => s.toLowerCase() === current.toLowerCase());
                select.value = match || current;
            }
        }

        function filterPersonnel() {
            const q = (document.getElementById('personnelSearch')?.value || '').trim().toLowerCase();
            const rank = document.getElementById('personnelRankFilter')?.value || '';
            const status = document.getElementById('personnelStatusFilter')?.value || '';
            const section = document.getElementById('personnelSectionFilter')?.value || '';
            const matches = p => {
                const text = [p.no,p.rank,p.lastName,p.firstName,p.middleName,p.qualifiers,p.designation,p.section,p.status,p.contactNo,p.address,p.remarks,p.badgeNumber]
                    .join(' ').toLowerCase();
                const sectionValue = String(p.section || '').trim();
                return (!q || text.includes(q)) &&
                    (!rank || String(p.rank || '') === rank) &&
                    (!status || String(p.status || '') === status) &&
                    (!section || (section === '__blank__' ? !sectionValue : sectionValue.toLowerCase() === section.toLowerCase()));
            };
            const rows = (Array.isArray(allPersonnel) ? allPersonnel : []).filter(matches);
            const archiveRows = (Array.isArray(archivedPersonnel) ? archivedPersonnel : []).filter(matches);
            const count = document.getElementById('personnelFilterResultCount');
            if (count) count.textContent = `Showing ${rows.length} in current list · ${archiveRows.length} archived`;
            renderPersonnelTable(rows, archiveRows);
        }

        function getPersonnelExportRowsInDisplayOrder() {
            const q = (document.getElementById('personnelSearch')?.value || '').trim().toLowerCase();
            const rank = document.getElementById('personnelRankFilter')?.value || '';
            const status = document.getElementById('personnelStatusFilter')?.value || '';
            const section = document.getElementById('personnelSectionFilter')?.value || '';
            const matches = p => {
                const text = [p.no,p.rank,p.lastName,p.firstName,p.middleName,p.qualifiers,p.designation,p.section,p.status,p.contactNo,p.address,p.remarks,p.badgeNumber]
                    .map(value => String(value == null ? '' : value)).join(' ').toLowerCase();
                const sectionValue = String(p.section || '').trim();
                return (!q || text.includes(q)) &&
                    (!rank || String(p.rank || '') === rank) &&
                    (!status || String(p.status || '') === status) &&
                    (!section || (section === '__blank__' ? !sectionValue : sectionValue.toLowerCase() === section.toLowerCase()));
            };
            const rankOrder = {PBGEN:1,PCOL:2,PLTCOL:3,PMAJ:4,PCPT:5,PLT:6,PEMS:7,PCMS:8,PSMS:9,PMSG:10,PSSG:11,PCPL:12,PAT:13,NUP:14};
            const sortPersonnel = rows => rows.slice().sort((a,b) => {
                const aRank = String(a.rank || '').trim().toUpperCase();
                const bRank = String(b.rank || '').trim().toUpperCase();
                return (rankOrder[aRank] || 99) - (rankOrder[bRank] || 99) || String(a.lastName || '').localeCompare(String(b.lastName || ''));
            });
            const active = sortPersonnel((Array.isArray(allPersonnel) ? allPersonnel : []).filter(matches));
            const archived = sortPersonnel((Array.isArray(archivedPersonnel) ? archivedPersonnel : []).filter(matches));
            const groups = new Map();
            const detached = [], dsOther = [];
            active.forEach(person => {
                const sectionName = String(person.section || '').trim() || 'Unspecified';
                const normalized = sectionName.toLowerCase();
                if (normalized === 'detached service') { detached.push(person); return; }
                if (normalized === 'ds to other office/unit') { dsOther.push(person); return; }
                if (!groups.has(sectionName)) groups.set(sectionName, []);
                groups.get(sectionName).push(person);
            });
            const preferredOrder = ['Admin Section','General Services Section','Special Services Band','Base Police'];
            const orderedSections = [];
            preferredOrder.forEach(name => {
                const actual = [...groups.keys()].find(key => key.toLowerCase() === name.toLowerCase());
                if (actual) orderedSections.push(actual);
            });
            [...groups.keys()].filter(key => !orderedSections.some(item => item.toLowerCase() === key.toLowerCase())).sort((a,b) => a.localeCompare(b)).forEach(key => orderedSections.push(key));
            const result = [];
            const appendGroup = (groupName, people, archivedFlag) => people.forEach((person, index) => result.push({person, groupName, archived:archivedFlag, displayNo:index + 1}));
            orderedSections.forEach(name => appendGroup(name, groups.get(name), false));
            appendGroup('Detached Service', detached, false);
            appendGroup('DS to Other Office/Unit', dsOther, false);
            appendGroup('Archived', archived, true);
            return result;
        }

        async function downloadPersonnelListExcel() {
            if (!Array.isArray(allPersonnel) || !Array.isArray(archivedPersonnel)) {
                return customAlert('Personnel records are not ready. Refresh the Personnel List and try again.', 'Excel Export');
            }
            const exportRows = getPersonnelExportRowsInDisplayOrder();
            if (!exportRows.length) return customAlert('No personnel records match the current search and filters.', 'Excel Export');
            const button = document.getElementById('personnelDownloadExcelBtn');
            if (button) { button.disabled = true; button.setAttribute('aria-busy','true'); }
            try {
                const headers = ['Record Type','Section Group','No.','Rank','Last Name','First Name','Middle Name','Qualifiers','Badge Number','Designation','Section','Status','Contact No.','Address','Remarks','Archived Date'];
                const rows = exportRows.map(({person:p,groupName,archived,displayNo}) => [
                    archived ? 'Archived' : 'Current List', groupName, displayNo, p.rank || '', p.lastName || '', p.firstName || '', p.middleName || '', p.qualifiers || '',
                    p.badgeNumber || '', p.designation || '', p.section || '', p.status || (archived ? 'Archived' : 'Active'), p.contactNo || '', p.address || '',
                    archived ? '' : (p.remarks || ''), archived ? (p.archivedDate || '') : ''
                ]);
                const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
                const result = await downloadSpadesExcelWorkbook({
                    title:'RHSU Personnel List', sheetName:'Personnel List', fileName:`RHSU_Personnel_List_${today}.xlsx`,
                    headers, rows, widths:[16,28,8,12,20,20,20,18,18,26,28,16,18,34,28,18]
                });
                customAlert(`${result.rowCount} personnel record(s) exported successfully. The workbook follows the current filters and displayed section order.`, 'Excel Download');
            } catch (error) {
                console.error('Personnel List Excel export failed:', error);
                customAlert(error.message || 'Unable to generate the Personnel List Excel workbook.', 'Excel Export Error');
            } finally {
                if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
            }
        }

        function renderPersonnelTable(rows, archiveRows) {
            const can = canPersonnelAction('list', 'edit') || canPersonnelAction('list', 'delete') || canPersonnelAction('list', 'add');
            const container = document.getElementById('personnelTablesContainer');
            if (!container) return;

            const rankOrder = {
                "PBGEN": 1, "PCOL": 2, "PLTCOL": 3, "PMAJ": 4, "PCPT": 5, "PLT": 6,
                "PEMS": 7, "PCMS": 8, "PSMS": 9, "PMSG": 10, "PSSG": 11, "PCPL": 12,
                "PAT": 13, "NUP": 14
            };

            const sortPersonnel = data => data.slice().sort((a, b) => {
                const rA = String(a.rank || '').trim().toUpperCase();
                const rB = String(b.rank || '').trim().toUpperCase();
                const valA = rankOrder[rA] || 99;
                const valB = rankOrder[rB] || 99;
                if (valA !== valB) return valA - valB;
                return String(a.lastName || '').localeCompare(String(b.lastName || ''));
            });

            const sortedRows = sortPersonnel(rows);
            const groups = new Map();
            let detached = [];
            let dsOther = [];
            sortedRows.forEach(p => {
                const section = String(p.section || '').trim() || 'Unspecified';
                const secLower = section.toLowerCase();
                if (secLower === 'detached service') {
                    detached.push(p);
                    return;
                }
                if (secLower === 'ds to other office/unit') {
                    dsOther.push(p);
                    return;
                }
                if (!groups.has(section)) groups.set(section, []);
                groups.get(section).push(p);
            });

            const preferredOrder = ['Admin Section','General Services Section','Special Services Band','Base Police'];
            const orderedSections = [];
            preferredOrder.forEach(name => {
                const actual = [...groups.keys()].find(k => k.toLowerCase() === name.toLowerCase());
                if (actual) orderedSections.push(actual);
            });
            [...groups.keys()]
                .filter(k => !orderedSections.some(x => x.toLowerCase() === k.toLowerCase()))
                .sort((a,b) => a.localeCompare(b))
                .forEach(k => orderedSections.push(k));

            const buildTable = (title, dataRows, archived = false) => {
                if (!dataRows.length) return '';
                // Restore controls are shown only to Alpha Admin and Admin users who
                // pass the same personnel-management permission check used elsewhere.
                const showRestoreAction = archived && canPersonnelAction('list', 'add');
                const bodyHtml = dataRows.map((p, index) => {
                    const clickAction = archived ? `onclick="openArchivedPersonnelDetails(${Number(p.archiveRow)})"` : `onclick="openPersonnelProfile(${Number(p.no)})"`;
                    const recordKey = archived ? Number(p.archiveRow) : Number(p.no);
                    const copyLabel = 'Copy Rank through Qualifier for ' + [p.rank,p.lastName,p.firstName,p.middleName,p.qualifiers].filter(Boolean).join(' ');
                    const copyActionCell = `<td class="personnel-copy-cell"><button type="button" class="personnel-row-copy-btn" title="Copy Rank through Qualifier" aria-label="${escapeAttr(copyLabel)}" onclick="event.stopPropagation();copyPersonnelRowToClipboard(${recordKey},${archived},this)" onkeydown="event.stopPropagation()"><i aria-hidden="true" class="fi fi-rr-copy"></i><span class="sr-only">Copy row</span></button></td>`;
                    const restoreActionCell = showRestoreAction
                        ? `<td class="personnel-actions-cell"><button type="button" class="action-btn approve-btn" title="Restore personnel" aria-label="Restore ${escapeAttr((p.rank||'')+' '+(p.firstName||'')+' '+(p.lastName||''))}" onclick="event.stopPropagation();restorePersonnel(${Number(p.archiveRow)})" onkeydown="event.stopPropagation()" style="font-size:12px;padding:6px 10px;width:auto;min-width:76px;height:auto;">↻ Restore</button></td>`
                        : '';
                    return `<tr class="personnel-clickable-row" data-personnel-record="${recordKey}" data-personnel-archived="${archived ? 'true' : 'false'}" ${clickAction} tabindex="0" role="button" aria-label="View personnel ${escapeAttr((p.rank||'')+' '+(p.firstName||'')+' '+(p.lastName||''))}" onkeydown="if((event.key==='Enter'||event.key===' ')&&!event.target.closest('button,a,input,select,textarea')){event.preventDefault();${archived ? `openArchivedPersonnelDetails(${Number(p.archiveRow)})` : `openPersonnelProfile(${Number(p.no)})`};}">
                        <td>${index + 1}</td>
                        <td>${escapeHtml(p.rank)}</td>
                        <td>${escapeHtml(p.lastName)}</td>
                        <td>${escapeHtml(p.firstName)}</td>
                        <td>${escapeHtml(p.middleName)}</td>
                        <td>${escapeHtml(p.qualifiers)}</td>
                        ${copyActionCell}
                        <td>${escapeHtml(p.badgeNumber || '')}</td>
                        <td>${escapeHtml(p.designation)}</td>
                        <td>${escapeHtml(p.section)}</td>
                        <td><span style="font-weight:600;color:${archived ? 'var(--danger)' : 'var(--success)'};">${escapeHtml(p.status || (archived ? 'Archived' : 'Active'))}</span></td>
                        <td>${escapeHtml(p.contactNo)}</td>
                        <td class="personnel-address-cell" title="${escapeAttr(p.address || 'Not Provided')}">${escapeHtml(p.address || 'Not Provided')}</td>
                        ${archived ? `<td>${escapeHtml(p.archivedDate || '')}</td>` : `<td>${escapeHtml(p.remarks || '')}</td>`}
                        ${restoreActionCell}
                    </tr>`;
                }).join('');

                const extraHeader = archived
                    ? `<th>Archived Date</th>${showRestoreAction ? '<th id="personnelActionHeader">Action</th>' : ''}`
                    : '<th>Remarks</th>';
                const scrollKey = archived ? 'personnel-archived' : 'personnel-active-' + String(title || 'section').toLowerCase().replace(/[^a-z0-9]+/g, '-');
                return `<h3 style="margin-top:25px;margin-bottom:10px;color:${archived ? 'var(--danger)' : 'var(--primary)'};font-size:16px;">${escapeHtml(title)}</h3>
                <div class="table-wrapper" data-spades-scroll-key="${escapeAttr(scrollKey)}" style="margin-bottom:20px;margin-top:0;">
                    <table class="personnel-data-table${archived ? ' archived-personnel-table' : ''}">
                        <thead><tr>
                            <th>No.</th><th>Rank</th><th>Last Name</th><th>First Name</th><th>Middle Name</th>
                            <th>Qualifiers</th><th class="personnel-copy-heading">Copy</th><th>Badge Number</th><th>Designation</th><th>Section</th><th>Status</th><th>Contact No.</th><th>Address</th>
                            ${extraHeader}
                        </tr></thead>
                        <tbody>${bodyHtml}</tbody>
                    </table>
                </div>`;
            };
            let activeHtml = '';
            orderedSections.forEach(section => { activeHtml += buildTable(section, groups.get(section)); });
            activeHtml += buildTable('Detached Service', detached);
            activeHtml += buildTable('DS to Other Office/Unit', dsOther);

            const archivedSorted = sortPersonnel(Array.isArray(archiveRows) ? archiveRows : (archivedPersonnel || []));
            const archiveHtml = archivedSorted.length
                ? buildTable('Archived', archivedSorted, true)
                : `<h3 style="margin-top:28px;margin-bottom:10px;color:var(--text-muted);font-size:16px;">Archived</h3>
                   <div class="table-wrapper" style="margin-bottom:20px;margin-top:0;">
                     <div style="text-align:center;color:var(--text-muted);padding:20px;">No archived personnel records.</div>
                   </div>`;

            container.innerHTML = (activeHtml || '<div style="text-align:center;color:var(--text-muted);padding:20px;">No active personnel records found.</div>') + archiveHtml;
        }
        async function copyPersonnelRowToClipboard(recordKey, archived = false, button = null) {
            const records = archived ? (Array.isArray(archivedPersonnel) ? archivedPersonnel : []) : (Array.isArray(allPersonnel) ? allPersonnel : []);
            const key = Number(recordKey);
            const record = records.find(item => archived ? Number(item.archiveRow) === key : Number(item.no) === key);
            if (!record) return customAlert('The selected personnel record could not be found. Refresh the list and try again.', 'Copy Failed');
            // Copy in the same visible order as the table: Rank, Last Name, First Name, Middle Name, Qualifiers.
            const values = [record.rank, record.lastName, record.firstName, record.middleName, record.qualifiers]
                .map(value => String(value == null ? '' : value).trim());
            const text = values.join('\t');
            if (!text.replace(/\t/g, '').trim()) return customAlert('There is no personnel information to copy.', 'Copy');
            let copied = false;
            try {
                if (navigator.clipboard && window.isSecureContext && typeof navigator.clipboard.writeText === 'function') {
                    await navigator.clipboard.writeText(text);
                    copied = true;
                }
            } catch (error) { copied = false; }
            if (!copied) {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.setAttribute('readonly', '');
                textarea.style.position = 'fixed'; textarea.style.left = '-9999px'; textarea.style.top = '0';
                document.body.appendChild(textarea); textarea.select();
                try { copied = document.execCommand('copy'); } catch (error) { copied = false; }
                textarea.remove();
            }
            if (!copied) return customAlert('The browser did not allow clipboard access. Please select the personnel details and copy them manually.', 'Copy Failed');
            if (button) {
                const icon = button.querySelector('i');
                const originalTitle = button.getAttribute('title') || 'Copy Rank through Qualifier';
                if (icon) icon.className = 'fi fi-rr-check';
                button.classList.add('is-copied');
                button.setAttribute('title', 'Copied');
                button.setAttribute('aria-label', 'Personnel details copied');
                window.setTimeout(() => {
                    if (!button.isConnected) return;
                    if (icon) icon.className = 'fi fi-rr-copy';
                    button.classList.remove('is-copied');
                    button.setAttribute('title', originalTitle);
                    button.setAttribute('aria-label', originalTitle);
                }, 1400);
            }
        }

        function clearPersonnelFilters() {
            document.getElementById('personnelSearch').value='';
            document.getElementById('personnelRankFilter').value='';
            document.getElementById('personnelStatusFilter').value='';
            if (document.getElementById('personnelSectionFilter')) document.getElementById('personnelSectionFilter').value='';
            filterPersonnel();
        }

        function togglePersonnelRemarksFields() {
            const remarks = document.getElementById('pRemarks');
            const leave = document.getElementById('pLeaveType');
            const schooling = document.getElementById('pSchooling');
            const other = document.getElementById('pRemarksOther');
            if (!remarks || !leave || !schooling || !other) return;

            const showLeave = remarks.value === 'On-Leave';
            const showSchooling = remarks.value === 'Schooling/Seminar';
            const showOther = remarks.value === 'Others';
            leave.classList.toggle('hidden', !showLeave);
            schooling.classList.toggle('hidden', !showSchooling);
            other.classList.toggle('hidden', !showOther);
            const leaveWrap = document.getElementById('pLeaveTypeField');
            const schoolingWrap = document.getElementById('pSchoolingField');
            const otherWrap = document.getElementById('pRemarksOtherField');
            if (leaveWrap) leaveWrap.classList.toggle('hidden', !showLeave);
            if (schoolingWrap) schoolingWrap.classList.toggle('hidden', !showSchooling);
            if (otherWrap) otherWrap.classList.toggle('hidden', !showOther);
            leave.required = remarks.value === 'On-Leave';
            schooling.required = remarks.value === 'Schooling/Seminar';
            other.required = remarks.value === 'Others';

            if (remarks.value !== 'On-Leave') leave.value = '';
            if (remarks.value !== 'Schooling/Seminar') schooling.value = '';
            if (remarks.value !== 'Others') other.value = '';
        }

        function getPersonnelRemarksPayload() {
            const type = document.getElementById('pRemarks').value;
            if (type === 'On-Leave') {
                const leave = document.getElementById('pLeaveType').value;
                return leave ? `On-Leave — ${leave}` : 'On-Leave';
            }
            if (type === 'Schooling/Seminar') {
                const schooling = document.getElementById('pSchooling').value.trim();
                return schooling ? `Schooling/Seminar — ${schooling}` : 'Schooling/Seminar';
            }
            if (type === 'Others') {
                const other = document.getElementById('pRemarksOther').value.trim();
                return other ? `Others — ${other}` : 'Others';
            }
            return type || '';
        }

        function populatePersonnelRemarks(remarks) {
            const raw = String(remarks || '').trim();
            const typeEl = document.getElementById('pRemarks');
            const leaveEl = document.getElementById('pLeaveType');
            const schoolingEl = document.getElementById('pSchooling');
            const otherEl = document.getElementById('pRemarksOther');
            typeEl.value = '';
            leaveEl.value = '';
            schoolingEl.value = '';
            otherEl.value = '';

            if (!raw) return togglePersonnelRemarksFields();

            const parts = raw.split(/\s+—\s+/);
            const type = parts[0];
            if (['Off-Duty','On-Leave','Schooling/Seminar','Others'].includes(type)) {
                typeEl.value = type;
                const detail = parts.slice(1).join(' — ').trim();
                if (type === 'On-Leave') {
                    leaveEl.value = detail;
                } else if (type === 'Schooling/Seminar') {
                    schoolingEl.value = detail;
                } else if (type === 'Others') {
                    otherEl.value = detail;
                }
            } else {
                typeEl.value = 'Others';
                otherEl.value = raw;
            }
            togglePersonnelRemarksFields();
        }

        function openPersonnelModal() {
            if(!canPersonnelAction('list', 'add')) return customAlert("You do not have permission to add Personnel List entries.","Permission Denied");
            personnelEditNo = null;
            const modal = document.getElementById('personnelModal');
            const saveBtn = document.getElementById('personnelSaveBtn');
            if (!modal || !saveBtn) return customAlert('The Add Personnel form is unavailable. Please reload the page.', 'Form Error');

            ['pLastName','pFirstName','pMiddleName','pQualifiers','pBadgeNumber','pDesignation','pContactNo','pAddress','pSchooling','pRemarksOther','pLeaveType'].forEach(id => {
                const field = document.getElementById(id); if (field) field.value = '';
            });
            ['pRank','pSection','pRemarks'].forEach(id => { const field=document.getElementById(id); if(field) field.value=''; });
            document.getElementById('pStatus').value = 'Active';
            document.getElementById('pNo').value = 'Auto';
            document.getElementById('personnelModalTitle').innerText = 'Add Personnel';
            document.getElementById('personnelModalDescription').innerText = "Enter the personnel\'s identity, assignment, and current status.";
            saveBtn.disabled = false;
            saveBtn.innerText = 'Save Personnel';
            populatePersonnelRemarks('');
            modal.classList.remove('hidden');
            document.body.classList.add('modal-open');
            requestAnimationFrame(() => focusPersonnelModalField());
        }

        function editPersonnel(no) {
            if(!canPersonnelAction('list', 'edit')) return customAlert("You do not have permission to edit Personnel List entries.","Permission Denied");
            const p=allPersonnel.find(x=>Number(x.no)===Number(no)); if(!p) return;
            personnelEditNo=Number(no);
            document.getElementById('personnelModalTitle').innerText='Edit Personnel';
            document.getElementById('personnelModalDescription').innerText='Review and update this personnel record.';
            document.getElementById('pNo').value=p.no;
            document.getElementById('pRank').value=p.rank||'';
            document.getElementById('pLastName').value=p.lastName||'';
            document.getElementById('pFirstName').value=p.firstName||'';
            document.getElementById('pMiddleName').value=p.middleName||'';
            document.getElementById('pQualifiers').value=p.qualifiers||'';
            document.getElementById('pBadgeNumber').value=p.badgeNumber||'';
            document.getElementById('pDesignation').value=p.designation||'';
            document.getElementById('pSection').value=p.section||'';
            document.getElementById('pStatus').value=p.status||'Active';
            document.getElementById('pContactNo').value=p.contactNo||'';
            document.getElementById('pAddress').value=p.address||'';
            populatePersonnelRemarks(p.remarks||'');
            const saveBtn = document.getElementById('personnelSaveBtn');
            saveBtn.disabled = false;
            saveBtn.innerText='Update Personnel';
            document.getElementById('personnelModal').classList.remove('hidden');
            document.body.classList.add('modal-open');
            requestAnimationFrame(() => focusPersonnelModalField());
        }

        function closePersonnelModal(){
            const modal = document.getElementById('personnelModal');
            if (modal) modal.classList.add('hidden');
            document.body.classList.remove('modal-open');
            personnelEditNo=null;
        }

        // --- Personnel modal UX enhancements (additive; existing logic/payload unchanged) ---
        // Autofocus the Rank field when the modal opens.
        function focusPersonnelModalField(){
            const rank = document.getElementById('pRank');
            if (rank) { try { rank.focus(); } catch(e){ /* no-op */ } }
        }
        // Escape closes the modal; Enter inside a text input submits (guarded while saving).
        document.addEventListener('keydown', function(e){
            const modal = document.getElementById('personnelModal');
            if (!modal || modal.classList.contains('hidden')) return;
            if (e.key === 'Escape') { e.preventDefault(); closePersonnelModal(); return; }
            if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && e.target.closest && e.target.closest('#personnelModal')) {
                const saveBtn = document.getElementById('personnelSaveBtn');
                if (saveBtn && !saveBtn.disabled) { e.preventDefault(); savePersonnel(); }
            }
        });

        async function savePersonnel() {
            const saveButton = document.getElementById('personnelSaveBtn');
            if (!saveButton || saveButton.disabled) return;
            const operation = personnelEditNo === null ? 'add' : 'edit';
            if(!canPersonnelAction('list', operation)) return customAlert(`You do not have permission to ${operation} Personnel List entries.`,"Permission Denied");
            const payload={
                action: personnelEditNo===null?'add_personnel':'update_personnel',
                userName:localStorage.getItem('loggedInUser'),
                credential:localStorage.getItem('loggedCred')||'',
                no:personnelEditNo,
                rank:document.getElementById('pRank').value.trim(),
                lastName:document.getElementById('pLastName').value.trim(),
                firstName:document.getElementById('pFirstName').value.trim(),
                middleName:document.getElementById('pMiddleName').value.trim(),
                qualifiers:document.getElementById('pQualifiers').value.trim(),
                badgeNumber:document.getElementById('pBadgeNumber').value.trim(),
                designation:document.getElementById('pDesignation').value.trim(),
                section:document.getElementById('pSection').value.trim(),
                status:document.getElementById('pStatus').value || 'Active',
                contactNo:document.getElementById('pContactNo').value.trim(),
                address:document.getElementById('pAddress').value.trim(),
                remarks:getPersonnelRemarksPayload()
            };
            if(!payload.rank||!payload.lastName||!payload.firstName) return customAlert("Rank, Last Name and First Name are required.","Validation Error");
            if (document.getElementById('pRemarks').value === 'On-Leave' && !document.getElementById('pLeaveType').value) return customAlert("Please select the Leave Type.","Validation Error");
            if (document.getElementById('pRemarks').value === 'Schooling/Seminar' && !document.getElementById('pSchooling').value.trim()) return customAlert("Please specify the schooling/seminar.","Validation Error");
            if (document.getElementById('pRemarks').value === 'Others' && !document.getElementById('pRemarksOther').value.trim()) return customAlert("Please encode the remarks.","Validation Error");

            const btn=saveButton; btn.disabled=true; btn.setAttribute('aria-busy','true'); btn.innerText='Saving...';
            try {
                const res=await fetch(API_URL,{method:'POST',mode:'cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
                const data=await res.json();
                if(!data.success) throw new Error(data.error||'Save failed');
                logActivity(`${payload.action==='add_personnel'?'added':'updated'} personnel record: ${payload.rank} ${payload.lastName}, ${payload.firstName}`);
                closePersonnelModal();
                customAlert(data.archived ? 'Personnel marked non-Active and moved to Archived.' : (payload.action==='add_personnel'?'Personnel added successfully.':'Personnel updated successfully.'),'Success');
                await refreshPersonnelManagementAfterMutation();
            } catch(e) {
                customAlert(e.message||'Unable to save personnel record.','Error');
            } finally { btn.disabled=false; btn.removeAttribute('aria-busy'); btn.innerText=(payload.action==='add_personnel' ? 'Save Personnel' : 'Update Personnel'); }
        }

        function archivePersonnel(no) {
            if(!canPersonnelAction('list', 'delete')) return customAlert("You do not have permission to archive Personnel List entries.","Permission Denied");
            const p=allPersonnel.find(x=>Number(x.no)===Number(no)); if(!p) return;
            customConfirm(`Archive ${p.rank} ${p.lastName}, ${p.firstName}? The record will be moved to the Archive sheet.`, async confirmed=>{
                if(!confirmed) return;
                try {
                    const res=await fetch(API_URL,{method:'POST',mode:'cors',headers:{'Content-Type':'text/plain;charset=utf-8'},
                        body:JSON.stringify({action:'archive_personnel',no:Number(no),userName:localStorage.getItem('loggedInUser'),credential:localStorage.getItem('loggedCred')||''})});
                    const data=await res.json(); if(!data.success) throw new Error(data.error||'Archive failed');
                    logActivity(`archived personnel record: ${p.rank} ${p.lastName}, ${p.firstName}`);
                    customAlert('Personnel record archived successfully.','Success'); await refreshPersonnelManagementAfterMutation();
                } catch(e){ customAlert(e.message||'Unable to archive personnel record.','Error'); }
            });
        }

        async function restorePersonnel(archiveRow) {
            if(!canPersonnelAction('list', 'add')) return customAlert("You do not have permission to restore Personnel List entries.","Permission Denied");
            const p = (archivedPersonnel || []).find(x => Number(x.archiveRow) === Number(archiveRow));
            const name = p ? `${p.rank} ${p.lastName}, ${p.firstName}` : 'this archived personnel record';

            customConfirm(`Restore ${name} to the active Personnel list?`, async confirmed => {
                if(!confirmed) return;
                try {
                    const res = await fetch(API_URL, {
                        method:'POST', mode:'cors', headers:{'Content-Type':'text/plain;charset=utf-8'},
                        body:JSON.stringify({
                            action:'restore_personnel',
                            archiveRow:Number(archiveRow),
                            userName:localStorage.getItem('loggedInUser'),
                            credential:localStorage.getItem('loggedCred') || ''
                        })
                    });
                    const data = await res.json();
                    if(!data.success) throw new Error(data.error || 'Restore failed');
                    logActivity(`restored personnel record${p ? `: ${p.rank} ${p.lastName}, ${p.firstName}` : ''}`);
                    customAlert('Personnel record restored to the active list.','Success');
                    await refreshPersonnelManagementAfterMutation();
                } catch(e) {
                    customAlert(e.message || 'Unable to restore personnel record.','Error');
                }
            });
        }

        function escapeHtml(v){ return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
        function escapeAttr(v){ return escapeHtml(v); }

        // Retained for compatibility with other screens. BMI permissions are
        // controlled by the Alpha Admin-granted add/edit/delete permission matrix.
        function isCurrentUserRecordOwner(owner) {
            if (isAlphaAdmin()) return true;
            const current = String(localStorage.getItem('loggedInUser') || '').trim().toLowerCase();
            const recorded = String(owner || '').trim().toLowerCase();
            return !!current && !!recorded && current === recorded;
        }


        function canManageActivities() {
            const role = localStorage.getItem('userRole') || '';
            return isAlphaAdmin() || role === 'Admin' || localStorage.getItem('canEdit') === 'Yes';
        }

        function updateActivityPermissions() {
            const can = canManageActivities();
            const addBtn = document.getElementById('activityAddBtn');
            const header = document.getElementById('activityActionHeader');
            if (addBtn) addBtn.classList.toggle('hidden', !can);
            if (header) header.style.display = can ? '' : 'none';
            const table = document.getElementById('activityTable');
            if (table) table.classList.toggle('activity-readonly', !can);
        }

        function localDateKey(dateObj) {
            const d = dateObj || new Date();
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        }

        function activityStatusForDate(dateValue) {
            const key = String(dateValue || '').slice(0,10);
            const today = localDateKey(new Date());
            if (key === today) return 'Ongoing';
            if (key && key < today) return 'Archive';
            return 'Recurring';
        }

        function toggleActivityVenueOther() {
            const select = document.getElementById('activityVenue');
            const input = document.getElementById('activityVenueOther');
            const show = select.value === 'Others';
            input.classList.toggle('hidden', !show);
            input.required = show;
            if (!show) input.value = '';
        }

        let activityCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

        function resetActivityDatePicker() {
            activityCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
            renderActivityCalendar();
            renderSelectedActivityDates([]);
        }

        function getSelectedActivityDates() {
            return Array.from(document.querySelectorAll('#activitySelectedDates .activity-date-chip'))
                .map(el => el.dataset.date).filter(Boolean);
        }

        function toggleActivityDate(dateValue) {
            let dates = getSelectedActivityDates();
            if (dates.includes(dateValue)) dates = dates.filter(d => d !== dateValue);
            else dates.push(dateValue);
            dates.sort();
            renderSelectedActivityDates(dates);
            renderActivityCalendar();
            updateActivityModalStatus();
        }

        function renderActivityCalendar() {
            const title = document.getElementById('activityCalendarTitle');
            const calendar = document.getElementById('activityCalendar');
            if (!title || !calendar) return;
            const year = activityCalendarMonth.getFullYear();
            const month = activityCalendarMonth.getMonth();
            title.textContent = activityCalendarMonth.toLocaleDateString(undefined, {month:'long', year:'numeric'});

            const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            let html = weekdays.map(d => `<div class="activity-calendar-weekday">${d}</div>`).join('');
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const prevDays = new Date(year, month, 0).getDate();
            const selected = new Set(getSelectedActivityDates());
            const today = localDateKey(new Date());

            for (let i=0;i<42;i++) {
                const cell = i - firstDay + 1;
                let day, cellDate, other=false;
                if (cell < 1) { day = prevDays + cell; cellDate = new Date(year, month-1, day); other=true; }
                else if (cell > daysInMonth) { day = cell - daysInMonth; cellDate = new Date(year, month+1, day); other=true; }
                else { day = cell; cellDate = new Date(year, month, day); }
                const key = localDateKey(cellDate);
                const cls = ['activity-calendar-day'];
                if (other) cls.push('is-other-month');
                if (key === today) cls.push('is-today');
                if (selected.has(key)) cls.push('is-selected');
                html += `<button type="button" class="${cls.join(' ')}" onclick="toggleActivityDate('${key}')">${day}</button>`;
            }
            calendar.innerHTML = html;
        }

        function changeActivityCalendarMonth(delta) {
            activityCalendarMonth = new Date(activityCalendarMonth.getFullYear(), activityCalendarMonth.getMonth()+delta, 1);
            renderActivityCalendar();
        }

        function removeActivityDate(dateValue) {
            toggleActivityDate(dateValue);
        }

        function renderSelectedActivityDates(dates) {
            const box = document.getElementById('activitySelectedDates');
            if (!box) return;
            const sorted = [...new Set(dates)].sort();
            box.innerHTML = sorted.map(d => `
                <span class="activity-date-chip" data-date="${escapeAttr(d)}">
                    ${escapeHtml(d)}
                    <button type="button" onclick="removeActivityDate('${escapeAttr(d)}')" title="Remove date">×</button>
                </span>`).join('') ||
                '<span style="font-size:12px;color:var(--text-muted);">No dates selected.</span>';
        }

        function updateActivityModalStatus() {
            const dates = getSelectedActivityDates();
            const status = dates.length ? dates.map(activityStatusForDate).includes('Ongoing') ? 'Ongoing' : 'Recurring' : 'Recurring';
            document.getElementById('activityStatus').value = status;
        }

        function setActivitySaveButtonLabel(label) {
            const button = document.getElementById('activitySaveBtn');
            if (!button) return;
            const safeLabel = String(label || 'Save Activity');
            button.setAttribute('aria-label', safeLabel);
            button.setAttribute('title', safeLabel);
            button.textContent = safeLabel;
        }

        function openActivityModal() {
            if (!canManageActivities()) return customAlert('Only Alpha Admin and Admin users can add activities.', 'Permission Denied');
            activityEditId = null;
            document.getElementById('activityModalTitle').innerText = 'Add Activity';
            setActivitySaveButtonLabel('Save Activity');
            document.getElementById('activityTitle').value = '';
            document.getElementById('activityVenue').value = '';
            document.getElementById('activityVenueOther').value = '';
            document.getElementById('activityRequestingOffice').value = '';
            document.getElementById('activityConcernedOffice').value = '';
            document.getElementById('activityRequestedServices').value = '';
            document.getElementById('activityTimeFrom').value = '';
            document.getElementById('activityTimeTo').value = '';
            document.getElementById('activityFrequency').value = 'N/A';
            document.getElementById('activityStatus').value = 'Recurring';
            document.getElementById('activityNotificationsEnabled').checked = true;
            resetActivityDatePicker();
            toggleActivityVenueOther();
            document.getElementById('activityModal').classList.remove('hidden');
        }

        function formatActivityTime(value) {
            if (value === null || value === undefined) return '';
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
                const minutes = Math.round(value * 1440) % 1440;
                const hour24 = Math.floor(minutes / 60);
                const minute = minutes % 60;
                const hour12 = hour24 % 12 || 12;
                return `${String(hour12).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${hour24 >= 12 ? 'PM' : 'AM'}`;
            }
            const raw = String(value).trim();
            if (!raw) return '';
            if (/^(?:0|0?\.\d+|\.\d+)$/.test(raw)) {
                const fraction = Number(raw);
                if (Number.isFinite(fraction) && fraction >= 0 && fraction < 1) return formatActivityTime(fraction);
            }
            const rangeParts = raw.split(/\s*(?:-|–|to)\s*/i);
            if (rangeParts.length === 2) return `${formatActivityTime(rangeParts[0])} – ${formatActivityTime(rangeParts[1])}`;

            // Recognize explicit AM/PM values before extracting times from a
            // Date string; otherwise the Date-string matcher can mistake the
            // space before "02:30 PM" for a date/time boundary and lose PM.
            const match12 = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])$/);
            if (match12) {
                const hours = Number(match12[1]);
                const minutes = Number(match12[2]);
                if (hours >= 1 && hours <= 12 && minutes >= 0 && minutes <= 59) {
                    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${match12[3].toUpperCase()}`;
                }
            }

            // Normal 24-hour value: 08:30, 14:30, etc.
            const match24 = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
            if (match24) {
                let hours = Number(match24[1]);
                const minutes = Number(match24[2]);
                if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
                    const suffix = hours >= 12 ? 'PM' : 'AM';
                    hours = hours % 12 || 12;
                    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${suffix}`;
                }
            }

            // Google Sheets may return a time-only cell as a full Date string,
            // e.g. "Sat Dec 30 1899 08:30:00 GMT+0800 (...)".
            const dateTimeMatch = raw.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\s*(?:GMT[+-]\d{4})?/i);
            if (dateTimeMatch) {
                let hours = Number(dateTimeMatch[1]);
                const minutes = Number(dateTimeMatch[2]);
                const explicitSuffix = dateTimeMatch[3] ? dateTimeMatch[3].toUpperCase() : '';
                const validHours = explicitSuffix ? hours >= 1 && hours <= 12 : hours >= 0 && hours <= 23;
                if (validHours && minutes >= 0 && minutes <= 59) {
                    const suffix = explicitSuffix || (hours >= 12 ? 'PM' : 'AM');
                    if (explicitSuffix) hours = (hours % 12) + (suffix === 'PM' ? 12 : 0);
                    hours = hours % 12 || 12;
                    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${suffix}`;
                }
            }
            return raw;
        }

        function activityTimeForInput(value) {
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
                const totalMinutes = Math.round(value * 1440) % 1440;
                return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
            }
            let raw = String(value == null ? '' : value).trim();
            if (!raw) return '';
            if (/^(?:0|0?\.\d+|\.\d+)$/.test(raw)) {
                const fraction = Number(raw);
                if (Number.isFinite(fraction) && fraction >= 0 && fraction < 1) {
                    const totalMinutes = Math.round(fraction * 1440) % 1440;
                    return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
                }
            }
            const match24 = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
            if (match24) {
                const hours = Number(match24[1]);
                const minutes = Number(match24[2]);
                if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
                    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
                }
            }
            const match12 = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])$/);
            if (match12) {
                let hours = Number(match12[1]);
                const minutes = Number(match12[2]);
                const suffix = match12[3].toUpperCase();
                if (hours >= 1 && hours <= 12 && minutes >= 0 && minutes <= 59) {
                    if (suffix === 'AM') hours = hours === 12 ? 0 : hours;
                    else hours = hours === 12 ? 12 : hours + 12;
                    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
                }
            }
            // Normalize older Google Sheets Date-string representations through the shared formatter.
            const formatted = formatActivityTime(raw);
            if (formatted && formatted !== raw) return activityTimeForInput(formatted);
            return '';
        }

        function activityLegacyGroupSignature(activity) {
            return [activity.activityTitle, activity.assignedVenue, activity.requestingOffice,
                activity.concernedOffice, activity.time, activity.frequency, activity.encodedBy]
                .map(value => String(value == null ? '' : value).trim().toLowerCase()).join('¦');
        }

        function getActivityGroupRecords(activity) {
            if (!activity) return [];
            if (activity.groupId) {
                return (allActivities || []).filter(item => String(item.groupId || '') === String(activity.groupId));
            }
            // Compatibility for activities saved before group IDs were introduced.
            const signature = activityLegacyGroupSignature(activity);
            return (allActivities || []).filter(item => activityLegacyGroupSignature(item) === signature);
        }

        function editActivity(id) {
            if (!canManageActivities()) return customAlert('Permission denied.', 'Error');
            const a = allActivities.find(x => String(x.id) === String(id));
            if (!a) return;
            if (isActivityMarkedDone(a)) return customAlert('Completed or archived activities are locked and cannot be edited.', 'Record Locked');
            if (!isCurrentUserRecordOwner(a.encodedBy)) return customAlert('You can edit only activities that you encoded.', 'Permission Denied');
            const groupRecords = getActivityGroupRecords(a);
            const groupDates = [...new Set(groupRecords.map(item => String(item.date || '').slice(0,10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
            activityEditId = String(id);
            document.getElementById('activityModalTitle').innerText = 'Edit Activity';
            setActivitySaveButtonLabel('Update Activity');
            document.getElementById('activityTitle').value = a.activityTitle || '';
            if (ACTIVITY_VENUES.includes(a.assignedVenue)) {
                document.getElementById('activityVenue').value = a.assignedVenue;
                document.getElementById('activityVenueOther').value = '';
            } else {
                document.getElementById('activityVenue').value = 'Others';
                document.getElementById('activityVenueOther').value = a.assignedVenue || '';
            }
            document.getElementById('activityRequestingOffice').value = a.requestingOffice || '';
            document.getElementById('activityConcernedOffice').value = a.concernedOffice || '';
            document.getElementById('activityRequestedServices').value = a.requestedServices || '';
            const savedRange = String(a.time == null ? '' : a.time).split(/\s*(?:-|–|to)\s*/i);
            document.getElementById('activityTimeFrom').value = activityTimeForInput(savedRange[0] || '');
            document.getElementById('activityTimeTo').value = activityTimeForInput(savedRange[1] || savedRange[0] || '');
            document.getElementById('activityFrequency').value = a.frequency || 'N/A';
            document.getElementById('activityStatus').value = a.status || 'Recurring';
            document.getElementById('activityNotificationsEnabled').checked = a.notificationsEnabled !== false;
            const firstDate = groupDates[0] || String(a.date || '').slice(0,10);
            activityCalendarMonth = new Date(firstDate + 'T00:00:00');
            activityCalendarMonth = new Date(activityCalendarMonth.getFullYear(), activityCalendarMonth.getMonth(), 1);
            renderSelectedActivityDates(groupDates.length ? groupDates : [firstDate]);
            renderActivityCalendar();
            toggleActivityVenueOther();
            document.getElementById('activityModal').classList.remove('hidden');
        }

        function closeActivityModal() {
            document.getElementById('activityModal').classList.add('hidden');
            activityEditId = null;
        }

        function clearQueuedActivityRemindersForRecords(recordIds) {
            const ids = new Set((Array.isArray(recordIds) ? recordIds : []).map(value => String(value == null ? '' : value).trim()).filter(Boolean));
            if (!ids.size || !Array.isArray(scheduledAlertQueue)) return 0;
            const removed = [];
            scheduledAlertQueue = scheduledAlertQueue.filter(alert => {
                const stale = String(alert?.recordType || '').toLowerCase() === 'activity' && ids.has(String(alert?.recordId || ''));
                if (stale) removed.push(String(alert.alertKey || ''));
                return !stale;
            });
            removed.forEach(key => { if (key) scheduledAlertQueueKeys.delete(key); });
            return removed.length;
        }

        async function saveActivity() {
            if (!canManageActivities()) return customAlert('Permission denied.', 'Error');

            const title = document.getElementById('activityTitle').value.trim();
            const venueSelect = document.getElementById('activityVenue').value;
            const venueOther = document.getElementById('activityVenueOther').value.trim();
            const venue = venueSelect === 'Others' ? venueOther : venueSelect;
            const requestingOffice = document.getElementById('activityRequestingOffice').value.trim();
            const concernedOffice = document.getElementById('activityConcernedOffice').value.trim();
            const requestedServices = document.getElementById('activityRequestedServices').value.trim();
            const timeFrom = document.getElementById('activityTimeFrom').value;
            const timeTo = document.getElementById('activityTimeTo').value;
            const time = timeFrom && timeTo ? `${timeFrom}-${timeTo}` : ''; 
            const frequency = document.getElementById('activityFrequency').value || 'N/A';
            const dates = getSelectedActivityDates();
            const notificationsEnabled = document.getElementById('activityNotificationsEnabled')?.checked !== false;

            if (!dates.length) return customAlert('Target Date is required. Please select at least one activity date.', 'Required Target Date');
            if (!title || !venue || !requestingOffice || !concernedOffice || !timeFrom || !timeTo || timeTo <= timeFrom || !dates.length) {
                return customAlert('Please complete all required fields and select at least one date.', 'Validation Error');
            }
            const wasEditing = !!activityEditId;
            const originalActivity = wasEditing ? (allActivities || []).find(item => String(item.id) === String(activityEditId)) : null;
            const affectedActivityIds = wasEditing
                ? getActivityGroupRecords(originalActivity).map(item => String(item.id || '')).filter(Boolean)
                : [];
            const payload = {
                action: wasEditing ? 'update_activity' : 'add_activity',
                id: activityEditId,
                userName: localStorage.getItem('loggedInUser'),
                credential: localStorage.getItem('loggedCred') || '',
                activityTitle: title, assignedVenue: venue, requestingOffice, concernedOffice, requestedServices, time, frequency, dates, notificationsEnabled
            };

            const btn = document.getElementById('activitySaveBtn');
            btn.disabled = true; setActivitySaveButtonLabel('Saving Activity…'); 
            try {
                const res = await fetch(API_URL, { method:'POST', mode:'cors', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(payload) });
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Unable to save activity.');
                if (wasEditing) clearQueuedActivityRemindersForRecords(affectedActivityIds);
                logActivity(`${wasEditing ? 'updated' : 'added'} activity: "${title}"`);
                closeActivityModal();
                customAlert(wasEditing ? 'Activity updated successfully.' : 'Activity added successfully.', 'Success');
                await loadActivities();
                // Re-check the existing server-side 3-hour / 1-hour reminder ledger
                // against the confirmed saved activity values. The ledger key prevents duplicates.
                if (typeof pollScheduledAlerts === 'function') await pollScheduledAlerts();
            } catch (err) {
                customAlert(err.message || 'Unable to save activity.', 'Error');
            } finally {
                btn.disabled = false; setActivitySaveButtonLabel(wasEditing ? 'Update Activity' : 'Save Activity');
            }
        }

        function deleteActivity(id) {
            if (!canManageActivities()) return customAlert('Permission denied.', 'Error');
            const a = allActivities.find(x => String(x.id) === String(id));
            if (!a) return;
            if (isActivityMarkedDone(a)) return customAlert('Completed or archived activities are locked and cannot be deleted.', 'Record Locked');
            customConfirm(`Delete activity "${a.activityTitle}" scheduled on ${a.date}?`, async confirmed => {
                if (!confirmed) return;
                try {
                    const res = await fetch(API_URL, {
                        method:'POST', mode:'cors',
                        headers:{'Content-Type':'text/plain;charset=utf-8'},
                        body:JSON.stringify({
                            action:'delete_activity', id:String(id),
                            userName:localStorage.getItem('loggedInUser'),
                            credential:localStorage.getItem('loggedCred') || ''
                        })
                    });
                    const data = await res.json();
                    if (!data.success) throw new Error(data.error || 'Unable to delete activity.');
                    logActivity(`deleted activity: "${a.activityTitle}"`);
                    customAlert('Activity deleted successfully.', 'Success');
                    await loadActivities();
                } catch(e) {
                    customAlert(e.message || 'Unable to delete activity.', 'Error');
                }
            });
        }

        let activityOverviewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        let selectedActivityDetailsId = null;
        let selectedActivityOccurrenceLocked = false;

        function changeActivityOverviewMonth(delta) {
            activityOverviewMonth = new Date(activityOverviewMonth.getFullYear(), activityOverviewMonth.getMonth() + (Number(delta) || 0), 1);
            renderActivityOverviewCalendar();
        }
        function goToActivityOverviewToday() {
            const today = new Date();
            activityOverviewMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            renderActivityOverviewCalendar();
        }

        function activityAnchorDates(activity) {
            return String(activity && activity.date || '').split(',').map(v => v.trim().slice(0, 10)).filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v));
        }
        function activityOccursOnDate(activity, dateObj) {
            const key = localDateKey(dateObj);
            const anchors = activityAnchorDates(activity);
            if (!anchors.length) return false;
            const frequency = String(activity.frequency || 'N/A').trim().toLowerCase();
            return anchors.some(anchor => {
                if (key < anchor) return false;
                if (key === anchor) return true;
                const start = new Date(anchor + 'T00:00:00');
                if (Number.isNaN(start.getTime())) return false;
                if (frequency === 'daily') return true;
                if (frequency === 'weekly') return dateObj.getDay() === start.getDay();
                if (frequency === 'monthly') return dateObj.getDate() === start.getDate();
                if (frequency === 'quarterly') return dateObj.getDate() === start.getDate() && ((dateObj.getFullYear() - start.getFullYear()) * 12 + dateObj.getMonth() - start.getMonth()) % 3 === 0;
                if (frequency === 'semestral' || frequency === 'semiannual') return dateObj.getDate() === start.getDate() && ((dateObj.getFullYear() - start.getFullYear()) * 12 + dateObj.getMonth() - start.getMonth()) % 6 === 0;
                if (frequency === 'annually' || frequency === 'annual' || frequency === 'yearly') return dateObj.getMonth() === start.getMonth() && dateObj.getDate() === start.getDate();
                return false;
            });
        }
        function isActivityArchived(activity) {
            return (archivedActivities || []).some(item => String(item.id) === String(activity && activity.id));
        }
        function isActivitySingleDatePast(activity) {
            const frequency = String(activity && activity.frequency || '').trim().toLowerCase();
            const recurring = ['daily','weekly','monthly','quarterly','semestral','semiannual','annually','annual','yearly'].includes(frequency);
            if (recurring) return false;
            const dates = activityAnchorDates(activity);
            return dates.length > 0 && dates.every(date => date < localDateKey(new Date()));
        }
        function isActivityMarkedDone(activity) {
            const status = String(activity && activity.status || '').trim().toLowerCase();
            return isActivityArchived(activity) || isActivitySingleDatePast(activity) || /^(done|complete|completed|finished|closed|archive|archived)$/.test(status);
        }
        function activityMatchesOnDate(dateObj) {
            const key = localDateKey(dateObj);
            const activeMatches = (allActivities || []).filter(activity => activityOccursOnDate(activity, dateObj));
            const archivedMatches = (archivedActivities || []).filter(activity => activityAnchorDates(activity).includes(key));
            const seenIds = new Set();
            return [...activeMatches, ...archivedMatches].filter(activity => {
                const id = String(activity.id || '');
                if (id && seenIds.has(id)) return false;
                if (id) seenIds.add(id);
                return true;
            }).map(activity => {
                const archived = archivedMatches.some(item => String(item.id) === String(activity.id));
                const pastOccurrence = key < localDateKey(new Date());
                return { activity, archived, locked: isActivityMarkedDone(activity) || archived || pastOccurrence };
            });
        }
        function sortActivityCalendarMatches(matches) {
            return (Array.isArray(matches) ? matches : []).slice().sort((left, right) => {
                const leftRange = getActivityTimeRange(left.activity);
                const rightRange = getActivityTimeRange(right.activity);
                const leftTime = leftRange.start == null ? Number.MAX_SAFE_INTEGER : leftRange.start;
                const rightTime = rightRange.start == null ? Number.MAX_SAFE_INTEGER : rightRange.start;
                if (leftTime !== rightTime) return leftTime - rightTime;
                return String(left.activity.activityTitle || '').localeCompare(String(right.activity.activityTitle || ''));
            });
        }

        function activityCalendarStatusClass(status, archived, locked) {
            if (archived || /^(archive|archived|done|complete|completed|finished|closed|cancelled|canceled)$/.test(String(status || '').trim().toLowerCase())) return 'is-closed';
            const normalized = String(status || '').trim().toLowerCase();
            if (normalized === 'ongoing' || normalized === 'active') return 'is-ongoing';
            if (normalized === 'recurring') return 'is-recurring';
            return locked ? 'is-locked' : 'is-scheduled';
        }

        function activityCalendarEventMarkup(item) {
            const activity = item.activity || {};
            const archived = !!item.archived;
            const locked = !!item.locked;
            const activityName = String(activity.activityTitle || 'Untitled activity');
            const statusLabel = archived ? 'Archived' : String(activity.status || activityStatusForDate(activity.date) || 'Scheduled');
            const rawTime = String(activity.time == null ? '' : activity.time).trim();
            const firstTime = rawTime.split(/\s*(?:-|–|to)\s*/i)[0] || '';
            const timeValue = activityTimeForInput(firstTime) || activityTimeForInput(formatActivityTime(firstTime));
            const timeLabel = timeValue ? formatActivityTime(timeValue) : '';
            const statusClass = activityCalendarStatusClass(statusLabel, archived, locked);
            return `<button type="button" class="activity-overview-event-text activity-calendar-event-card ${statusClass}${locked ? ' is-occurrence-locked' : ''}" data-activity-details-id="${escapeAttr(activity.id)}" data-activity-occurrence-locked="${locked ? 'true' : 'false'}" title="${locked ? 'Read-only occurrence · ' : ''}${escapeAttr(activityName)}" aria-label="${locked ? 'Read-only. ' : ''}${escapeAttr(statusLabel)} activity: ${escapeAttr(activityName)}${timeLabel ? ', ' + escapeAttr(timeLabel) : ''}">
                <span class="activity-calendar-event-meta">${timeLabel ? `<span class="activity-calendar-event-time">${escapeHtml(timeLabel)}</span>` : '<span class="activity-calendar-event-time is-unspecified">Time not set</span>'}<span class="activity-calendar-event-status">${escapeHtml(statusLabel)}</span></span>
                <span class="activity-calendar-event-title">${locked ? '<i class="fi fi-rr-lock activity-lock-icon" aria-hidden="true"></i>' : ''}${escapeHtml(activityName)}${archived ? ' <span class="activity-overview-archive-label">(Archived)</span>' : ''}</span>
            </button>`;
        }

        function bindActivityCalendarDetails(host) {
            if (!host) return;
            host.querySelectorAll('[data-activity-details-id]').forEach(button => {
                button.addEventListener('click', () => {
                    if (button.closest('#activityDayListBody')) closeActivityDayList();
                    showActivityDetails(
                        button.dataset.activityDetailsId,
                        button.dataset.activityOccurrenceLocked === 'true'
                    );
                });
            });
            host.querySelectorAll('[data-activity-day-more]').forEach(button => {
                button.addEventListener('click', () => showActivityDayList(button.dataset.activityDayMore));
            });
        }

        function showActivityDayList(dateKey) {
            const date = new Date(String(dateKey || '') + 'T00:00:00');
            if (Number.isNaN(date.getTime())) return;
            const matches = sortActivityCalendarMatches(activityMatchesOnDate(date));
            const modal = document.getElementById('activityDayListModal');
            const title = document.getElementById('activityDayListTitle');
            const body = document.getElementById('activityDayListBody');
            if (!modal || !title || !body) return;
            title.textContent = `Activities · ${date.toLocaleDateString(undefined, {year:'numeric', month:'long', day:'numeric'})}`;
            body.innerHTML = matches.length
                ? matches.map(activityCalendarEventMarkup).join('')
                : '<div class="activity-day-list-empty">No activities are scheduled for this date.</div>';
            modal.classList.remove('hidden');
            modal.setAttribute('aria-hidden', 'false');
            window.SPADESModalStack?.bringToFront(modal);
            bindActivityCalendarDetails(body);
        }

        function closeActivityDayList() {
            const modal = document.getElementById('activityDayListModal');
            if (modal) {
                modal.classList.add('hidden');
                modal.setAttribute('aria-hidden', 'true');
            }
            window.SPADESModalStack?.refresh();
        }

        function renderActivityOverviewCalendar() {
            const host = document.getElementById('activityOverviewCalendar');
            const title = document.getElementById('activityOverviewMonthTitle');
            if (!host || !title) return;
            const year = activityOverviewMonth.getFullYear(), month = activityOverviewMonth.getMonth();
            title.textContent = activityOverviewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
            const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            let html = weekdays.map(day => `<div class="activity-overview-weekday">${day}</div>`).join('');
            const first = new Date(year, month, 1).getDay(), count = new Date(year, month + 1, 0).getDate();
            const previousCount = new Date(year, month, 0).getDate();
            const today = localDateKey(new Date());
            for (let i = 0; i < 42; i++) {
                const raw = i - first + 1;
                const date = raw < 1 ? new Date(year, month - 1, previousCount + raw) : raw > count ? new Date(year, month + 1, raw - count) : new Date(year, month, raw);
                const key = localDateKey(date), other = date.getMonth() !== month;
                const matches = sortActivityCalendarMatches(activityMatchesOnDate(date));
                const visibleMatches = matches.slice(0, 2);
                const activityTextList = visibleMatches.map(activityCalendarEventMarkup).join('');
                const overflowCount = Math.max(0, matches.length - visibleMatches.length);
                const overflowButton = overflowCount
                    ? `<button type="button" class="activity-calendar-more-button" data-activity-day-more="${escapeAttr(key)}" aria-label="View ${overflowCount} more activities scheduled on ${escapeAttr(key)}">+${overflowCount} MORE</button>`
                    : '';
                const lockedDate = matches.length > 0 && matches.every(item => item.locked);
                html += `<div class="activity-overview-day${other ? ' is-other-month' : ''}${key === today ? ' is-today' : ''}${lockedDate ? ' is-locked-date' : ''}"><span class="activity-overview-day-number">${date.getDate()}${lockedDate ? ' <i class="fi fi-rr-lock" aria-label="Completed date locked"></i>' : ''}</span>${activityTextList || overflowButton ? `<div class="activity-overview-events activity-day-text-list" aria-label="Activities scheduled on ${escapeAttr(key)}">${activityTextList}${overflowButton}</div>` : ''}</div>`;
            }
            host.classList.add('activity-month-view-host');
            host.innerHTML = html;
            bindActivityCalendarDetails(host);
        }
        function getActivityTimeRange(activity) {
            const raw = String(activity && activity.time != null ? activity.time : '').trim();
            const parts = raw.split(/\s*(?:-|–|to)\s*/i);
            const startText = activityTimeForInput(parts[0] || '') || activityTimeForInput(formatActivityTime(parts[0] || ''));
            const endText = activityTimeForInput(parts[1] || '') || activityTimeForInput(formatActivityTime(parts[1] || ''));
            const toMinutes = value => {
                if (!value) return null;
                const [hh, mm] = value.split(':').map(Number);
                return hh * 60 + mm;
            };
            let start = toMinutes(startText), end = toMinutes(endText);
            if (start == null) return {start: null, end: null, label: raw ? formatActivityTime(raw) : 'Time not specified'};
            if (end == null) end = start + 60;
            if (end <= start) end += 24 * 60;
            return {start, end, label: formatActivityTime(raw) || 'Time not specified'};
        }
        function openActivityDataModal() {
            const modal = document.getElementById('activityDataModal');
            if (!modal) return;
            modal.classList.remove('hidden');
            const search = document.getElementById('activitySearch');
            if (search) search.focus({preventScroll:true});
            if (typeof filterActivities === 'function') filterActivities();
        }
        function closeActivityDataModal() {
            const modal = document.getElementById('activityDataModal');
            if (modal) modal.classList.add('hidden');
        }

        function showActivityDetails(id, occurrenceLocked = false) {
            const activity = (allActivities || []).find(a => String(a.id) === String(id)) || (archivedActivities || []).find(a => String(a.id) === String(id));
            if (!activity) return;
            selectedActivityDetailsId = String(activity.id);
            selectedActivityOccurrenceLocked = !!occurrenceLocked || isActivityMarkedDone(activity);
            document.getElementById('activityDetailsTitle').textContent = activity.activityTitle || 'Activity Details';
            const detailRecords = [...(allActivities || []), ...(archivedActivities || [])].filter(item => {
                if (activity.groupId) return String(item.groupId || '') === String(activity.groupId);
                return activityLegacyGroupSignature(item) === activityLegacyGroupSignature(activity);
            });
            const relatedDates = [activity.date, ...detailRecords.map(item => String(item.date || '').slice(0,10))].filter(Boolean);
            const scheduleText = relatedDates.length > 1 ? [...new Set(relatedDates)].sort().join(', ') : (activity.date || '');
            const isArchivedActivity = (archivedActivities || []).some(item => String(item.id) === String(activity.id));
            const activityStatus = activity.status || (isArchivedActivity ? 'Archive' : 'Ongoing');
            const fields = [['Date / Schedule', scheduleText], ['Activity Title', activity.activityTitle], ['Assigned Venue', activity.assignedVenue], ['Requesting Office', activity.requestingOffice], ['Concerned Office', activity.concernedOffice], ['Requested Service/s', activity.requestedServices], ['Time', formatActivityTime(activity.time)], ['Frequency', activity.frequency], ['Status', activityStatus]];
            document.getElementById('activityDetailsContent').innerHTML = fields.map(([label,value]) => `<div class="activity-detail-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '—')}</strong></div>`).join('');
            const canEditActivity = !selectedActivityOccurrenceLocked && canManageActivities() && (allActivities || []).some(a => String(a.id) === String(id));
            const lockNote = selectedActivityOccurrenceLocked ? '<div class="activity-details-locked-note"><i class="fi fi-rr-lock" aria-hidden="true"></i><span>This activity is completed or archived and is locked from editing.</span></div>' : '';
            const contentEl = document.getElementById('activityDetailsContent');
            if (contentEl && lockNote) contentEl.insertAdjacentHTML('beforeend', lockNote);
            document.getElementById('activityDetailsEditBtn').classList.toggle('hidden', !canEditActivity);
            const detailsFooter = document.getElementById('activityDetailsFooter');
            if (detailsFooter) detailsFooter.classList.toggle('hidden', !canEditActivity);
            document.getElementById('activityDetailsModal').classList.remove('hidden');
        }
        function closeActivityDetails() { document.getElementById('activityDetailsModal').classList.add('hidden'); selectedActivityDetailsId = null; selectedActivityOccurrenceLocked = false; }
        function editActivityFromDetails() { const id = selectedActivityDetailsId; const locked = selectedActivityOccurrenceLocked; closeActivityDetails(); if (id && !locked) editActivity(id); }

        let selectedArchivedPersonnelRow = null;

        function openArchivedPersonnelDetails(archiveRow) {
            const p = (archivedPersonnel || []).find(x => Number(x.archiveRow) === Number(archiveRow));
            if (!p) return;
            selectedArchivedPersonnelRow = Number(archiveRow);
            const canEditStatus = canPersonnelAction('list', 'edit');
            const name = `${p.rank || ''} ${p.firstName || ''} ${p.middleName || ''} ${p.lastName || ''}`.replace(/\s+/g, ' ').trim();
            document.getElementById('archivedPersonnelDetailsName').textContent = name || 'Archived Personnel';
            document.getElementById('archivedPersonnelDetailsContent').innerHTML = [
                ['Designation', p.designation], ['Section', p.section], ['Contact', p.contactNo],
                ['Address', p.address || 'Not Provided'],
                ['Archived Date', p.archivedDate], ['Archived By', p.archivedBy], ['Archive Note', p.archiveAction]
            ].map(([label, value]) => `<div class="activity-detail-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '—')}</strong></div>`).join('');
            const statusSelect = document.getElementById('archivedPersonnelStatus');
            const statuses = ['Active', 'Resigned', 'Deceased', 'Dismissed', 'Suspended', 'Reassigned'];
            statusSelect.innerHTML = statuses.map(status => `<option value="${status}"${status === (p.status || 'Active') ? ' selected' : ''}>${status}</option>`).join('');
            statusSelect.disabled = !canEditStatus;
            document.getElementById('saveArchivedPersonnelStatusBtn').classList.toggle('hidden', !canEditStatus);
            document.getElementById('archivedPersonnelStatusPermissionNote').classList.toggle('hidden', canEditStatus);
            document.getElementById('archivedPersonnelDetailsModal').classList.remove('hidden');
        }

        function closeArchivedPersonnelDetails() {
            document.getElementById('archivedPersonnelDetailsModal').classList.add('hidden');
            selectedArchivedPersonnelRow = null;
        }

        async function saveArchivedPersonnelStatus() {
            if (!canPersonnelAction('list', 'edit')) return customAlert('You do not have permission to edit archived Personnel List entries.', 'Permission Denied');
            if (!selectedArchivedPersonnelRow) return;
            const status = document.getElementById('archivedPersonnelStatus').value;
            const p = (archivedPersonnel || []).find(x => Number(x.archiveRow) === selectedArchivedPersonnelRow);
            const name = p ? `${p.rank || ''} ${p.firstName || ''} ${p.lastName || ''}`.trim() : 'personnel';
            const btn = document.getElementById('saveArchivedPersonnelStatusBtn');
            btn.disabled = true;
            const oldText = btn.textContent;
            btn.textContent = 'Saving…';
            try {
                const res = await fetch(API_URL, { method: 'POST', mode: 'cors', headers: {'Content-Type':'text/plain;charset=utf-8'},
                    body: JSON.stringify({ action: 'update_archived_personnel_status', archiveRow: selectedArchivedPersonnelRow, status,
                        userName: localStorage.getItem('loggedInUser'), credential: localStorage.getItem('loggedCred') || '' }) });
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Unable to update archived personnel status.');
                logActivity(`changed archived personnel status for ${name} to ${status}`);
                closeArchivedPersonnelDetails();
                customAlert(`Archived personnel status updated to ${status}.`, 'Success');
                await refreshPersonnelManagementAfterMutation();
            } catch (e) {
                customAlert(e.message || 'Unable to update archived personnel status.', 'Error');
            } finally {
                btn.disabled = false;
                btn.textContent = oldText;
            }
        }

        async function loadActivities() {
            try {
                const res = await spadesAuthenticatedRead('get_activities');
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Unable to load activities.');
                allActivities = Array.isArray(data.activities) ? data.activities : [];
                archivedActivities = Array.isArray(data.archived) ? data.archived : [];
                // Backend status synchronization keeps current-date rows Ongoing and past rows archived.
                filterActivities(true);
                renderArchivedActivities();
                renderActivityOverviewCalendar();
                updateActivityPermissions();
                if (!document.getElementById('tabDashboard').classList.contains('hidden')) renderExecutiveDashboard();
            } catch(e) {
                console.error(e);
                document.getElementById('activityTableBody').innerHTML =
                    '<tr><td colspan="8" style="text-align:center;color:var(--danger);padding:20px;">Unable to load activities.</td></tr>';
                customAlert('Unable to load Activity Management records.', 'Error');
            }
        }

        function filterActivities(preserveCurrentPage = false) {
            const q = (document.getElementById('activitySearch').value || '').trim().toLowerCase();
            filteredActivities = allActivities.filter(a =>
                [a.date,a.activityTitle,a.assignedVenue,a.requestingOffice,a.concernedOffice,a.requestedServices,a.time,a.frequency,a.status]
                .join(' ').toLowerCase().includes(q)
            );
            if (!preserveCurrentPage) currentActivityPage = 1;
            renderActivities();
        }

        function renderActivities() {
            renderActivityOverviewCalendar();
            const body = document.getElementById('activityTableBody');
            const can = canManageActivities();
            const perPage = 10; // Activity Records uses a fixed 10-record page size.
            const totalPages = Math.ceil(filteredActivities.length / perPage) || 1;
            currentActivityPage = Math.min(Math.max(currentActivityPage,1),totalPages);
            // Organize by date; ongoing activities always pinned at top.
            const sortedActs = filteredActivities.slice().sort((a, b) => {
                const stA = (a.status || activityStatusForDate(a.date) || '').toLowerCase();
                const stB = (b.status || activityStatusForDate(b.date) || '').toLowerCase();
                const aOn = stA === 'ongoing' ? 0 : 1;
                const bOn = stB === 'ongoing' ? 0 : 1;
                if (aOn !== bOn) return aOn - bOn;
                return String(a.date || '').localeCompare(String(b.date || ''));
            });
            const rows = sortedActs.slice((currentActivityPage-1)*perPage, currentActivityPage*perPage);

            body.innerHTML = rows.length ? rows.map(a => {
                const status = a.status || activityStatusForDate(a.date);
                const statusClass = status.toLowerCase() === 'ongoing' ? 'ongoing' : status.toLowerCase() === 'archive' ? 'archive' : 'recurring';
                const canEditThisActivity = can && isCurrentUserRecordOwner(a.encodedBy);
                return `<tr>
                    <td>${escapeHtml(a.date)}</td>
                    <td><button type="button" class="activity-title-link" onclick="showActivityDetails('${escapeAttr(a.id)}')">${escapeHtml(a.activityTitle)}</button></td>
                    <td>${escapeHtml(a.assignedVenue)}</td>
                    <td>${escapeHtml(a.requestingOffice)}</td>
                    <td>${escapeHtml(a.concernedOffice)}</td>
                    <td class="activity-services-cell">${escapeHtml(a.requestedServices || '—')}</td>
                    <td>${escapeHtml(formatActivityTime(a.time))}</td>
                    <td><span class="activity-status ${statusClass}">${escapeHtml(status)}</span></td>
                    <td class="activity-action-cell">
                        ${can ? `${canEditThisActivity ? `<button class="action-btn" onclick="editActivity('${escapeAttr(a.id)}')">Edit</button>` : ''}<button class="action-btn delete-btn" style="color:white;" onclick="deleteActivity('${escapeAttr(a.id)}')">Delete</button>` : ''}
                    </td>
                </tr>`;
            }).join('') : `<tr><td colspan="${can ? 9 : 8}" style="text-align:center;padding:20px;">No activities found.</td></tr>`;

            const p = document.getElementById('activityPagination');
            if (filteredActivities.length > perPage) {
                p.classList.remove('hidden');
                document.getElementById('activityPageInfo').innerText = `Page ${currentActivityPage} of ${totalPages} · ${filteredActivities.length} ${filteredActivities.length === 1 ? 'activity' : 'activities'}`;
                document.getElementById('prevActivityBtn').disabled = currentActivityPage === 1;
                document.getElementById('nextActivityBtn').disabled = currentActivityPage === totalPages;
            } else p.classList.add('hidden');
        }

        function changeActivityPage(direction) {
            currentActivityPage += direction;
            renderActivities();
        }

        function renderArchivedActivities() {
            const body = document.getElementById('archivedActivityTableBody');
            const perPage = Math.max(1, parseInt(userSettings.recordsPerPage,10) || 10);
            const totalPages = Math.ceil(archivedActivities.length / perPage) || 1;
            currentArchivedActivityPage = Math.min(Math.max(currentArchivedActivityPage,1),totalPages);
            const rows = archivedActivities.slice((currentArchivedActivityPage-1)*perPage, currentArchivedActivityPage*perPage);
            body.innerHTML = rows.length ? rows.map(a => `<tr>
                <td>${escapeHtml(a.date)}</td>
                <td>${escapeHtml(a.activityTitle)}</td>
                <td>${escapeHtml(a.assignedVenue)}</td>
                <td>${escapeHtml(a.requestingOffice)}</td>
                <td>${escapeHtml(a.concernedOffice)}</td>
                <td class="activity-services-cell">${escapeHtml(a.requestedServices || '—')}</td>
                <td>${escapeHtml(formatActivityTime(a.time))}</td>
                <td><span class="activity-status archive">Archive</span></td>
            </tr>`).join('') : '<tr><td colspan="8" style="text-align:center;padding:20px;">No archived activities.</td></tr>';

            const p = document.getElementById('archivedActivityPagination');
            if (archivedActivities.length > perPage) {
                p.classList.remove('hidden');
                document.getElementById('archivedActivityPageInfo').innerText = `Page ${currentArchivedActivityPage} of ${totalPages}`;
                document.getElementById('prevArchivedActivityBtn').disabled = currentArchivedActivityPage === 1;
                document.getElementById('nextArchivedActivityBtn').disabled = currentArchivedActivityPage === totalPages;
            } else p.classList.add('hidden');
        }

        function changeArchivedActivityPage(direction) {
            currentArchivedActivityPage += direction;
            renderArchivedActivities();
        }


        // ===== EXECUTIVE DASHBOARD =====
        function execCountMap(items, keyFn) {
            const map = {};
            (items || []).forEach(item => {
                const key = String(keyFn(item) || 'Unspecified').trim() || 'Unspecified';
                map[key] = (map[key] || 0) + 1;
            });
            return map;
        }

        function execRenderList(containerId, map, total) {
            const el = document.getElementById(containerId);
            if (!el) return;
            const entries = Object.entries(map || {}).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
            if (!entries.length) { el.innerHTML = '<div class="exec-empty">No data available.</div>'; return; }
            const max = entries[0][1] || 1;
            el.innerHTML = entries.map(([name,count]) => `
                <div class="exec-row">
                    <div style="min-width:0;flex:1"><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
                    <div class="exec-bar"><i style="width:${Math.max(4,(count/max)*100)}%"></i></div></div>
                    <span>${count}</span>
                </div>`).join('');
        }

        function renderExecVenueActivities(activities) {
            const el = document.getElementById('execVenues');
            if (!el) return;
            const rows = Array.isArray(activities) ? activities : [];
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const ongoing = rows.filter(a => {
                // Use the same recurrence engine as the calendar so a weekly/monthly
                // activity is listed whenever one of its actual occurrences is today,
                // even when the original anchor date is in a previous month.
                const scheduledToday = typeof activityOccursOnDate === 'function'
                    ? activityOccursOnDate(a, today)
                    : (typeof activityStatusForDate === 'function' && activityStatusForDate(a.date) === 'Ongoing');
                const status = String(a.status || '').trim().toLowerCase();
                const explicitlyCompleted = /^(done|complete|completed|finished|closed|archive|archived)$/.test(status);
                const completed = typeof isActivityMarkedDone === 'function' && isActivityMarkedDone(a);
                return scheduledToday && !explicitlyCompleted && !completed;
            }).sort((a, b) => {
                const aStart = typeof getActivityTimeRange === 'function' ? getActivityTimeRange(a).start : null;
                const bStart = typeof getActivityTimeRange === 'function' ? getActivityTimeRange(b).start : null;
                const startCompare = (aStart == null ? Number.MAX_SAFE_INTEGER : aStart) - (bStart == null ? Number.MAX_SAFE_INTEGER : bStart);
                return startCompare || String(a.activityTitle || '').localeCompare(String(b.activityTitle || ''));
            });
            const venues = execCountMap(rows, a => a.assignedVenue);
            const venueEntries = Object.entries(venues).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
            const max = venueEntries.length ? Math.max(1, venueEntries[0][1]) : 1;
            const ongoingHtml = ongoing.length
                ? `<div class="exec-venue-section-title"><span class="exec-venue-live-dot"></span> Ongoing Activities <span class="exec-venue-section-count">${ongoing.length}</span></div>` +
                  ongoing.map(a => `<div class="exec-ongoing-activity-row">
                      <div class="exec-ongoing-activity-main"><span class="exec-status">ONGOING</span><strong title="${escapeAttr(a.activityTitle || 'Untitled Activity')}">${escapeHtml(a.activityTitle || 'Untitled Activity')}</strong></div>
                      <div class="exec-ongoing-activity-meta"><span>${escapeHtml(new Date().toLocaleDateString(undefined, {month:'short', day:'numeric'}))}${a.time ? ' · ' + escapeHtml(a.time) : ''}</span><span>${escapeHtml(a.assignedVenue || 'Venue not specified')}</span></div>
                  </div>`).join('')
                : `<div class="exec-venue-section-title"><span class="exec-venue-live-dot is-idle"></span> Ongoing Activities <span class="exec-venue-section-count">0</span></div><div class="exec-venue-empty">No activity is scheduled for today.</div>`;
            const venueHtml = venueEntries.length
                ? `<div class="exec-venue-section-title exec-venue-recap-title">Venue Recap</div>` + venueEntries.slice(0, 12).map(([name, count]) => `<div class="exec-row"><div style="min-width:0;flex:1"><strong title="${escapeAttr(name)}">${escapeHtml(name)}</strong><div class="exec-bar"><i style="width:${Math.max(4,(count/max)*100)}%"></i></div></div><span>${count}</span></div>`).join('')
                : '<div class="exec-venue-empty">No venue records available.</div>';
            el.classList.add('exec-venue-list');
            el.innerHTML = ongoingHtml + venueHtml;
        }

        function execFormatDate(value) {
            if (!value) return '—';
            const d = new Date(value);
            return isNaN(d.getTime()) ? String(value) : d.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
        }

        function setExecActivityUserFilter(username) {
            execActivityUserFilter = String(username || '');
            execActivityPage = 1;
            renderExecutiveDashboard();
        }

        function populateExecActivityUserFilter(logs) {
            const select = document.getElementById('execActivityUserFilter');
            if (!select) return;
            const users = Array.from(new Set((Array.isArray(logs) ? logs : []).map(log => {
                const value = log && (log.user || log.username || log.name);
                return String(value || 'Unknown User').trim();
            }).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

            const previous = execActivityUserFilter;
            select.innerHTML = '<option value="">All Users</option>' + users.map(user =>
                `<option value="${escapeAttr(user)}">${escapeHtml(user)}</option>`
            ).join('');

            if (previous && users.includes(previous)) {
                select.value = previous;
            } else {
                execActivityUserFilter = '';
                select.value = '';
            }
        }

        function renderExecutiveDashboard() {
            const summary = dashboardSummaryCache;
            const organicPersonnel = summary ? null : (allPersonnel || []).filter(p => {
                const section = String(p.section || '').trim().toLowerCase();
                return section !== 'detached service' && section !== 'ds to other office/unit';
            });
            const detachedPersonnel = summary ? null : (allPersonnel || []).filter(p => String(p.section || '').trim().toLowerCase() === 'detached service');
            const dsOtherPersonnel = summary ? null : (allPersonnel || []).filter(p => String(p.section || '').trim().toLowerCase() === 'ds to other office/unit');
            const totalMemos = summary ? Number(summary.memos?.total || 0) : allMemos.length;
            const totalPersonnel = summary ? Number(summary.personnel?.total || 0) : (organicPersonnel.length + detachedPersonnel.length + dsOtherPersonnel.length);
            const totalActivities = summary ? (Array.isArray(summary.activities) ? summary.activities.length : 0) : (allActivities || []).length;
            const totalCompliances = summary ? Number(summary.complianceCount || 0) : (matrixComplianceRecords || []).length;

            const totalMemosEl = document.getElementById('execTotalMemos');
            const totalPersonnelEl = document.getElementById('execTotalPersonnel');
            const totalActivitiesEl = document.getElementById('execTotalActivities');
            if (totalMemosEl) totalMemosEl.innerText = totalMemos;
            if (totalPersonnelEl) totalPersonnelEl.innerText = totalPersonnel;
            if (totalActivitiesEl) totalActivitiesEl.innerText = totalActivities;
            const complianceKpi = document.getElementById('execTotalCompliances');
            if (complianceKpi) complianceKpi.innerText = totalCompliances;

            const encoders = summary ? (summary.memos?.encoders || {}) : execCountMap(allMemos, row => row[3]);
            const categories = summary ? (summary.memos?.categories || {}) : (() => {
                const counts = {};
                allMemos.forEach(row => {
                    const control = String(row[2] || '');
                    const match = control.match(/RHSU\(([^)]+)\)/i);
                    const key = match ? match[1] : (control || 'Uncategorized');
                    counts[key] = (counts[key] || 0) + 1;
                });
                return counts;
            })();
            const encoderCount = document.getElementById('execEncoderCount');
            if (encoderCount) encoderCount.innerText = Object.keys(encoders).length;
            execRenderList('execMemoCategories', categories, totalMemos);
            execRenderList('execMemoEncoders', encoders, totalMemos);

            let personnelRecap;
            if (summary) {
                const p = summary.personnel || {};
                const groups = p.groups || {PNCO:0,PCO:0,NUP:0,Other:0};
                personnelRecap = {
                    'Organic Personnel':Number(p.organic || 0),
                    'Detached Service':Number(p.detached || 0),
                    'DS to Other Office/Unit':Number(p.dsOther || 0),
                    'Total Personnel':Number(p.total || 0),
                    'PNCO':Number(groups.PNCO || 0),
                    'PCO':Number(groups.PCO || 0),
                    'NUP':Number(groups.NUP || 0),
                    'Other':Number(groups.Other || 0)
                };
            } else {
                const groups = { PNCO:0, PCO:0, NUP:0, Other:0 };
                organicPersonnel.forEach(person => {
                    const group = rankGroup(person.rank);
                    groups[group] = (groups[group] || 0) + 1;
                });
                personnelRecap = {
                    'Organic Personnel':organicPersonnel.length,
                    'Detached Service':detachedPersonnel.length,
                    'DS to Other Office/Unit':dsOtherPersonnel.length,
                    'Total Personnel':totalPersonnel,
                    'PNCO':groups.PNCO,
                    'PCO':groups.PCO,
                    'NUP':groups.NUP,
                    'Other':groups.Other
                };
            }
            execRenderList('execPersonnelGroups', personnelRecap, totalPersonnel);

            renderExecVenueActivities(summary ? (summary.activities || []) : allActivities);

            const detailsEl = document.getElementById('execDetailsStrip');
            if (detailsEl) {
                let cards;
                if (summary && summary.operations) {
                    const o = summary.operations;
                    cards = [
                        ['On Leave Today', Number(o.onLeaveToday || 0)],
                        ['On Leave This Month', Number(o.onLeaveMonth || 0)],
                        ['Active Squads', Number(o.activeSquads || 0)],
                        ['Designated Areas', Number(o.designatedAreas || 0)],
                        ['BMI Overweight/Obese', Number(o.bmiUnhealthy || 0)],
                        ['Archived Personnel', Number(o.archivedPersonnel || 0)]
                    ];
                } else {
                    const now = new Date();
                    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
                    const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
                    let onLeaveToday = 0, onLeaveMonth = 0;
                    (leaveEntries || []).forEach(entry => { (entry.dates || []).forEach(date => { if (date === todayStr) onLeaveToday++; if (String(date).startsWith(ym)) onLeaveMonth++; }); });
                    let bmiUnhealthy = 0;
                    (bmiRecords || []).forEach(record => { const c = String(record.bmiClassification || record.classification || '').toLowerCase(); if (c.indexOf('overweight') !== -1 || c.indexOf('obese') !== -1) bmiUnhealthy++; });
                    cards = [
                        ['On Leave Today', onLeaveToday],
                        ['On Leave This Month', onLeaveMonth],
                        ['Active Squads', (squads || []).length],
                        ['Designated Areas', (areas || []).length],
                        ['BMI Overweight/Obese', bmiUnhealthy],
                        ['Archived Personnel', (archivedPersonnel || []).length]
                    ];
                }
                detailsEl.innerHTML = '<h3 class="exec-details-title">Operational Details</h3><div class="exec-details-grid">' +
                    cards.map(card => `<div class="exec-detail-card"><div class="exec-detail-value">${card[1]}</div><div class="exec-detail-label">${card[0]}</div></div>`).join('') +
                    '</div>';
            }

            renderExecActivityLogs();
            const dashUser = document.getElementById('execDashUser');
            const dashUpdated = document.getElementById('execDashUpdated');
            if (dashUser) dashUser.innerText = `Signed in: ${localStorage.getItem('loggedInUser') || 'Guest'}`;
            if (dashUpdated) dashUpdated.innerText = `Updated ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
        }

        async function loadExecutiveDashboard() {
            if (dashboardSummaryPromise) return dashboardSummaryPromise;
            dashboardSummaryPromise = (async () => {
                try {
                    // One authenticated summary response replaces separate full-data
                    // requests for memos, personnel submodules, activities, Matrix, and logs.
                    const response = await spadesAuthenticatedRead('get_dashboard_summary');
                    if (!response.ok) throw new Error(`Dashboard summary request failed (${response.status}).`);
                    const result = await response.json();
                    if (!result || result.success !== true || !result.summary) throw new Error(result?.error || 'Dashboard summary is unavailable.');
                    dashboardSummaryCache = result.summary;
                    liveActivityLogs = sortActivityLogsLatestFirst(Array.isArray(result.summary.activityLogs) ? result.summary.activityLogs : []);
                    lastLogCount = liveActivityLogs.length;
                    renderExecutiveDashboard();
                    return true;
                } catch (summaryError) {
                    console.warn('Optimized Dashboard summary is unavailable; using the compatible full-read fallback.', summaryError);
                    dashboardSummaryCache = null;
                    // Backward compatibility for a frontend deployed before its matching backend.
                    try {
                        const tasks = [loadMatrixCompliances(), fetchActivityLogs()];
                        if (typeof userHasAccess !== 'function' || userHasAccess('home')) tasks.push(loadData());
                        if (typeof userHasAccess !== 'function' || userHasAccess('personnel')) tasks.push(loadAllPersonnelManagementData(true));
                        if (typeof userHasAccess !== 'function' || userHasAccess('activityManagement')) tasks.push(loadActivities());
                        await Promise.allSettled(tasks);
                        renderExecutiveDashboard();
                        return false;
                    } catch (fallbackError) {
                        console.error('Dashboard data could not be loaded:', fallbackError);
                        renderExecutiveDashboard();
                        return false;
                    }
                }
            })();
            try { return await dashboardSummaryPromise; }
            finally { dashboardSummaryPromise = null; }
        }

        async function loadData() {
            const tableBody = document.getElementById('dataTable');
            const scrollElement = document.querySelector('#tabHome .memo-table-wrapper');
            const scrollTop = scrollElement ? scrollElement.scrollTop : 0;
            const scrollLeft = scrollElement ? scrollElement.scrollLeft : 0;
            updateMemoBarcodeSettingsButton();
            try {
                const response = await spadesAuthenticatedRead('get_memos');
                if (!response.ok) throw new Error('Memo records could not be loaded.');
                const data = await response.json();
                if (!tableBody) return;
                if (!Array.isArray(data) || data.length === 0) {
                    allMemos = [];
                    filteredMemos = [];
                    tableBody.innerHTML = "<tr><td colspan='8' style='text-align:center;'>No memos found.</td></tr>";
                    document.getElementById('memoPagination')?.classList.add('hidden');
                    updateDashboard();
                    return;
                }

                // The existing control number in column C remains the stable memo key.
                // H:K are additive: type, barcode, barcode timestamp, and generator.
                allMemos = data.reverse().map(row => {
                    const normalized = Array.isArray(row) ? row.slice(0, 11) : [];
                    while (normalized.length < 11) normalized.push('');
                    if (!String(normalized[7] || '').trim()) normalized[7] = 'Regular Memo';
                    return normalized;
                });

                const encoders = new Set();
                const years = new Set();
                allMemos.forEach(row => {
                    if (row[3]) encoders.add(row[3]);
                    if (row[0]) {
                        const d = new Date(row[0]);
                        if (!isNaN(d.getTime())) years.add(d.getFullYear().toString());
                    }
                });

                const encoderSelect = document.getElementById('filterEncoder');
                if (encoderSelect) {
                    const selectedEncoder = encoderSelect.value;
                    encoderSelect.innerHTML = '<option value="">All Encoders</option>';
                    Array.from(encoders).sort().forEach(enc => encoderSelect.innerHTML += `<option value="${escapeAttr(enc)}">${escapeHtml(enc)}</option>`);
                    encoderSelect.value = encoders.has(selectedEncoder) ? selectedEncoder : '';
                }

                const yearSelect = document.getElementById('filterYear');
                if (yearSelect) {
                    const selectedYear = yearSelect.value;
                    yearSelect.innerHTML = '<option value="">All Years</option>';
                    Array.from(years).sort((a,b) => b-a).forEach(yr => yearSelect.innerHTML += `<option value="${escapeAttr(yr)}">${escapeHtml(yr)}</option>`);
                    yearSelect.value = years.has(selectedYear) ? selectedYear : '';
                }

                updateDashboard();
                if (userSettings.rememberSearch) {
                    const savedSearch = localStorage.getItem('rhsuSearch_' + localStorage.getItem('loggedInUser'));
                    const searchInput = document.getElementById('searchInput');
                    if (savedSearch && searchInput && !searchInput.value) searchInput.value = savedSearch;
                }
                searchTable(true);
                if (scrollElement) {
                    scrollElement.scrollTop = scrollTop;
                    scrollElement.scrollLeft = scrollLeft;
                }
                if (!document.getElementById('tabDashboard')?.classList.contains('hidden')) renderExecutiveDashboard();
            } catch (err) {
                console.error('Memo records could not be loaded:', err);
                if (tableBody && !allMemos.length) tableBody.innerHTML = "<tr><td colspan='8' style='text-align:center;'>Unable to load memo records. Please retry.</td></tr>";
            }
        }

        function updateDashboard() {
            const total = allMemos.length; document.getElementById('dashTotalMemos').innerText = total;

            // Memo Database monthly recap only. The main/Executive Dashboard does not
            // display this KPI; this value is rendered exclusively in the Memo Database.
            const now = new Date();
            const currentMonth = now.getMonth();
            const currentYear = now.getFullYear();
            const currentMonthMemos = allMemos.filter(row => {
                if (!row || !row[0]) return false;
                const rawDate = String(row[0]).trim();
                let memoDate = new Date(rawDate);

                // Support common backend date formats such as YYYY-MM-DD,
                // YYYY-MM-DD HH:mm:ss, and MM/DD/YYYY without changing stored data.
                if (isNaN(memoDate.getTime())) {
                    const match = rawDate.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
                    if (match) {
                        memoDate = new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
                    }
                }

                return !isNaN(memoDate.getTime()) &&
                       memoDate.getMonth() === currentMonth &&
                       memoDate.getFullYear() === currentYear;
            }).length;

            const monthlyCountEl = document.getElementById('dashCurrentMonthMemos');
            const monthlyLabelEl = document.getElementById('dashCurrentMonthLabel');
            if (monthlyCountEl) monthlyCountEl.innerText = currentMonthMemos;
            if (monthlyLabelEl) {
                monthlyLabelEl.innerText = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
            }

            const categoryCounts = {}; const userCounts = {};

            allMemos.forEach(row => {
                const ctrlNum = row[2] || ""; const encodedBy = row[3] || "Unknown";
                const match = ctrlNum.match(/RHSU\((.*?)\)/); const category = match ? match[1] : "Uncategorized";
                categoryCounts[category] = (categoryCounts[category] || 0) + 1; userCounts[encodedBy] = (userCounts[encodedBy] || 0) + 1;
            });

            const categoryFullNames = {
                A: "Admin",
                S: "Supply",
                GSS: "General Services Section",
                BP: "Base Police",
                SSB: "Special Services Band",
                RCIA: "Regional Committee on Inspection & Acceptance"
            };
            const catHtml = Object.keys(categoryCounts).map(k => {
                const fullName = categoryFullNames[k] || (k === "Uncategorized" ? k : k);
                return `<div style="display:flex; justify-content:space-between; gap:12px; font-size:14px; margin-bottom:8px; border-bottom: 1px solid var(--border-color); padding-bottom: 4px;"><span>${fullName}</span> <strong style="color:var(--primary);">${categoryCounts[k]}</strong></div>`;
            }).join('');
            document.getElementById('dashCategories').innerHTML = catHtml || '<div style="font-size:13px; color:var(--text-muted)">No data</div>';

            const userHtml = Object.keys(userCounts).map(k => `<div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:8px; border-bottom: 1px solid var(--border-color); padding-bottom: 4px;"><span>${k}</span> <strong style="color:var(--primary);">${userCounts[k]}</strong></div>`).join('');
            document.getElementById('dashUsers').innerHTML = userHtml || '<div style="font-size:13px; color:var(--text-muted)">No data</div>';
        }

        function renderMemoTable() {
            const tableBody = document.getElementById('dataTable');
            if (!tableBody) return;
            const totalPages = Math.ceil(filteredMemos.length / MEMOS_PER_PAGE) || 1;
            if (currentMemoPage > totalPages) currentMemoPage = totalPages;
            if (currentMemoPage < 1) currentMemoPage = 1;
            const currentMemos = filteredMemos.slice((currentMemoPage - 1) * MEMOS_PER_PAGE, currentMemoPage * MEMOS_PER_PAGE);

            if (currentMemos.length === 0) {
                tableBody.innerHTML = "<tr><td colspan='8' style='text-align:center;'>No match.</td></tr>";
                document.getElementById('memoPagination')?.classList.add('hidden');
                return;
            }

            const rowsHtml = currentMemos.map(row => {
                const control = String(row[2] || '');
                const controlAttr = escapeAttr(control);
                const subject = String(row[1] || '');
                const destination = String(row[5] || 'N/A');
                const status = String(row[4] || 'For Dispatched');
                const encoder = String(row[3] || '');
                const currentIsEncoder = isCurrentUserRecordOwner(encoder);
                const alphaAdmin = isAlphaAdmin();
                const actions = [
                    currentIsEncoder ? `<button class="action-btn icon-action-btn" title="Edit Memo" aria-label="Edit Memo" data-memo-action="edit" data-control-number="${controlAttr}"><i class="fi fi-rr-edit" aria-hidden="true"></i></button>` : '',
                    alphaAdmin ? `<button class="action-btn delete-btn icon-action-btn" title="Delete Memo" aria-label="Delete Memo" data-memo-action="delete" data-control-number="${controlAttr}"><i class="fi fi-rr-trash" aria-hidden="true"></i></button>` : ''
                ].filter(Boolean).join(' ');
                return `<tr data-memo-control="${controlAttr}" tabindex="0" aria-label="Open memo information for ${escapeAttr(subject || control)}">
                    <td><input type="checkbox" class="row-checkbox" value="${controlAttr}" aria-label="Select memo ${controlAttr}"></td>
                    <td>${escapeHtml(row[0] || '')}</td>
                    <td class="memo-clickable-subject">${escapeHtml(subject)}</td>
                    <td>${escapeHtml(destination)}</td>
                    <td>${escapeHtml(control)}</td>
                    <td>${escapeHtml(encoder || 'N/A')}</td>
                    <td><span class="memo-status-text">${escapeHtml(status)}</span></td>
                    <td class="memo-row-actions" style="white-space:nowrap;">${actions || '<span style="color:var(--text-muted);">—</span>'}</td>
                </tr>`;
            }).join('');
            tableBody.innerHTML = rowsHtml;

            const pagination = document.getElementById('memoPagination');
            if (filteredMemos.length > MEMOS_PER_PAGE) {
                pagination?.classList.remove('hidden');
                const info = document.getElementById('memoPageInfo');
                const prev = document.getElementById('prevMemoBtn');
                const next = document.getElementById('nextMemoBtn');
                if (info) info.innerText = `Page ${currentMemoPage} of ${totalPages}`;
                if (prev) prev.disabled = currentMemoPage === 1;
                if (next) next.disabled = currentMemoPage === totalPages;
            } else pagination?.classList.add('hidden');
        }

        let activeMemoControlNumber = '';
        let activeMemoBarcode = '';

        function memoApi(action, extra = {}) {
            const username = localStorage.getItem('loggedInUser') || '';
            const credential = localStorage.getItem('loggedCred') || '';
            if (!username || !credential) return Promise.reject(new Error('Your session has expired. Please sign in again.'));
            return fetch(API_URL, {
                method: 'POST', mode: 'cors', cache: 'no-store',
                headers: {'Content-Type':'text/plain;charset=utf-8'},
                body: JSON.stringify({action, username, userName:username, credential, ...extra})
            }).then(async response => {
                if (!response.ok) throw new Error('The server could not complete the request.');
                const result = await response.json();
                if (!result || result.success !== true) throw new Error(result?.error || 'The requested memo operation failed.');
                return result;
            });
        }

        function updateMemoBarcodeSettingsButton() {
            const button = document.getElementById('memoBarcodeSettingsBtn');
            if (button) button.classList.toggle('hidden', !isAlphaAdmin());
        }

        function setMemoInformationValue(id, value) {
            const element = document.getElementById(id);
            if (element) element.textContent = String(value == null || value === '' ? '—' : value);
        }

        async function openMemoInformation(controlNumber) {
            const stableControl = String(controlNumber || '').trim();
            if (!stableControl) return;
            const memo = (allMemos || []).find(row => String(row[2] || '').trim() === stableControl);
            if (!memo) {
                customAlert('The selected memo is no longer in the current list. Reload the Memo Database and try again.', 'Memo Not Found');
                return;
            }
            activeMemoControlNumber = stableControl;
            activeMemoBarcode = String(memo[8] || '').trim();
            const memoType = String(memo[7] || 'Regular Memo').trim() || 'Regular Memo';
            const isCsw = memoType === 'CSW (Complete Staff Work)';
            setMemoInformationValue('memoInformationTitle', 'Memo Information');
            setMemoInformationValue('memoInformationSubtitle', memo[1] || stableControl);
            setMemoInformationValue('memoInformationType', memoType);
            setMemoInformationValue('memoInformationSubject', memo[1]);
            setMemoInformationValue('memoInformationDate', memo[0]);
            setMemoInformationValue('memoInformationControl', memo[2]);
            setMemoInformationValue('memoInformationDestination', memo[5] || 'N/A');
            setMemoInformationValue('memoInformationEncoder', memo[3] || 'N/A');
            setMemoInformationValue('memoInformationStatus', memo[4] || 'For Dispatched');
            const classificationNames = {A:'Admin', S:'Supply', GSS:'General Services Section', BP:'Base Police', SSB:'Special Services Band', RCIA:'Regional Committee on Inspection & Acceptance'};
            setMemoInformationValue('memoInformationClassification', classificationNames[String(memo[6] || '').trim()] || memo[6] || 'N/A');

            const barcodePanel = document.getElementById('memoBarcodePanel');
            const generateButton = document.getElementById('memoBarcodeGenerateBtn');
            const copyButton = document.getElementById('memoBarcodeCopyBtn');
            const feedback = document.getElementById('memoBarcodeFeedback');
            if (barcodePanel) barcodePanel.classList.toggle('hidden', !isCsw);
            if (generateButton) { generateButton.classList.add('hidden'); generateButton.disabled = false; generateButton.innerHTML = '<i aria-hidden="true" class="fi fi-rr-barcode"></i><span>Generate Barcode</span>'; }
            if (copyButton) copyButton.classList.toggle('hidden', !activeMemoBarcode);
            if (feedback) feedback.textContent = '';
            setMemoInformationValue('memoBarcodeValue', activeMemoBarcode || 'Not generated');
            setMemoInformationValue('memoBarcodeMeta', activeMemoBarcode ? [memo[9] ? `Generated: ${memo[9]}` : '', memo[10] ? `Generated by: ${memo[10]}` : ''].filter(Boolean).join(' · ') : '');

            const modal = document.getElementById('memoInformationModal');
            if (modal) {
                modal.classList.remove('hidden');
                window.SPADESModalStack?.bringToFront(modal);
            }
            if (isCsw && !activeMemoBarcode) {
                try {
                    const context = await memoApi('get_memo_barcode_context');
                    if (generateButton && context.canGenerate && activeMemoControlNumber === stableControl && !activeMemoBarcode) generateButton.classList.remove('hidden');
                } catch (error) {
                    if (feedback && activeMemoControlNumber === stableControl) feedback.textContent = error.message || 'Barcode permission could not be verified.';
                }
            }
        }

        function closeMemoInformation() {
            document.getElementById('memoInformationModal')?.classList.add('hidden');
            activeMemoControlNumber = '';
            activeMemoBarcode = '';
        }

        async function generateMemoBarcode() {
            const controlNumber = activeMemoControlNumber;
            const button = document.getElementById('memoBarcodeGenerateBtn');
            const feedback = document.getElementById('memoBarcodeFeedback');
            if (!controlNumber || !button || button.disabled) return;
            button.disabled = true;
            button.innerHTML = '<i aria-hidden="true" class="fi fi-rr-spinner"></i><span>Generating…</span>';
            if (feedback) feedback.textContent = '';
            try {
                const result = await memoApi('generate_memo_barcode', {controlNumber});
                const generatedBarcode = String(result.barcode || '').trim();
                const memo = (allMemos || []).find(row => String(row[2] || '').trim() === controlNumber);
                if (memo) {
                    memo[8] = generatedBarcode;
                    memo[9] = result.generatedAt || '';
                    memo[10] = result.generatedBy || '';
                }
                if (activeMemoControlNumber === controlNumber) {
                    activeMemoBarcode = generatedBarcode;
                    setMemoInformationValue('memoBarcodeValue', activeMemoBarcode);
                    setMemoInformationValue('memoBarcodeMeta', [result.generatedAt ? `Generated: ${result.generatedAt}` : '', result.generatedBy ? `Generated by: ${result.generatedBy}` : ''].filter(Boolean).join(' · '));
                    document.getElementById('memoBarcodeCopyBtn')?.classList.remove('hidden');
                    button.classList.add('hidden');
                    if (feedback) feedback.textContent = result.alreadyAssigned ? 'This memo already has a barcode. The existing number was retrieved.' : 'Barcode generated and saved successfully.';
                }
                searchTable(true);
            } catch (error) {
                if (activeMemoControlNumber === controlNumber) {
                    button.disabled = false;
                    button.innerHTML = '<i aria-hidden="true" class="fi fi-rr-barcode"></i><span>Generate Barcode</span>';
                    if (feedback) feedback.textContent = error.message || 'Barcode generation failed.';
                }
            }
        }

        async function copyMemoBarcode() {
            const value = String(activeMemoBarcode || document.getElementById('memoBarcodeValue')?.textContent || '').trim();
            const feedback = document.getElementById('memoBarcodeFeedback');
            if (!value || value === 'Not generated' || !/^\d{9}$/.test(value)) return;
            try {
                if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
                else {
                    const temporary = document.createElement('textarea');
                    temporary.value = value;
                    temporary.setAttribute('readonly', '');
                    temporary.style.position = 'fixed'; temporary.style.opacity = '0';
                    document.body.appendChild(temporary); temporary.select();
                    const copied = document.execCommand('copy'); temporary.remove();
                    if (!copied) throw new Error('Clipboard copy failed.');
                }
                if (feedback) feedback.textContent = 'Barcode copied to clipboard.';
            } catch (error) {
                if (feedback) feedback.textContent = 'Copy was blocked. Select the barcode number and copy it manually.';
            }
        }

        async function openMemoBarcodeSettings() {
            updateMemoBarcodeSettingsButton();
            if (!isAlphaAdmin()) return customAlert('Only ALPHA ADMIN can manage barcode-generation permissions.', 'Permission Denied');
            const modal = document.getElementById('memoBarcodeSettingsModal');
            const list = document.getElementById('memoBarcodeAdminList');
            const feedback = document.getElementById('memoBarcodeSettingsFeedback');
            if (list) list.innerHTML = '<p class="memo-barcode-empty">Loading eligible ADMIN accounts…</p>';
            if (feedback) feedback.textContent = '';
            modal?.classList.remove('hidden');
            window.SPADESModalStack?.bringToFront(modal);
            try {
                const result = await memoApi('get_memo_barcode_settings');
                const admins = Array.isArray(result.admins) ? result.admins : [];
                if (list) {
                    list.innerHTML = admins.length ? admins.map(admin => `<label class="memo-barcode-admin-option"><input type="checkbox" data-memo-barcode-admin value="${escapeAttr(admin.username)}" ${admin.authorized ? 'checked' : ''}><span><strong>${escapeHtml(admin.name || admin.username)}</strong><small>@${escapeHtml(admin.username)}</small></span><em>${admin.authorized ? 'Authorized' : 'Not authorized'}</em></label>`).join('') : '<p class="memo-barcode-empty">No active ADMIN accounts are currently eligible.</p>';
                }
                document.getElementById('memoBarcodeAdminCount').textContent = `${admins.length} eligible Admin account${admins.length === 1 ? '' : 's'}`;
                updateMemoBarcodeSelectedCount();
            } catch (error) {
                if (list) list.innerHTML = `<p class="memo-barcode-empty">${escapeHtml(error.message || 'Unable to load ADMIN accounts.')}</p>`;
                if (feedback) feedback.textContent = error.message || 'Unable to load barcode settings.';
            }
        }

        function updateMemoBarcodeSelectedCount() {
            const count = document.querySelectorAll('#memoBarcodeAdminList [data-memo-barcode-admin]:checked').length;
            const target = document.getElementById('memoBarcodeSelectedCount');
            if (target) target.textContent = `${count} authorized`;
        }

        function closeMemoBarcodeSettings() {
            document.getElementById('memoBarcodeSettingsModal')?.classList.add('hidden');
        }

        async function saveMemoBarcodeSettings() {
            if (!isAlphaAdmin()) return customAlert('Only ALPHA ADMIN can manage barcode-generation permissions.', 'Permission Denied');
            const button = document.getElementById('memoBarcodeSettingsSaveBtn');
            const feedback = document.getElementById('memoBarcodeSettingsFeedback');
            const selectedUsernames = Array.from(document.querySelectorAll('#memoBarcodeAdminList [data-memo-barcode-admin]:checked')).map(input => input.value);
            if (!button) return;
            button.disabled = true;
            button.innerHTML = '<i aria-hidden="true" class="fi fi-rr-spinner"></i><span>Saving…</span>';
            try {
                let adminToken = '';
                if (hasFreshAlphaStepUp()) adminToken = sessionAdminPass;
                else {
                    const password = window.prompt('Enter the ALPHA ADMIN credential to authorize this permission change:');
                    if (!password) throw new Error('Permission changes were cancelled.');
                    adminToken = await ensureAlphaStepUpToken(password);
                }
                const result = await memoApi('save_memo_barcode_settings', {selectedUsernames, adminToken});
                if (feedback) feedback.textContent = result.message || 'Barcode permissions saved successfully.';
                customAlert('CSW barcode-generation permissions have been saved.', 'Success');
                setTimeout(() => closeMemoBarcodeSettings(), 450);
            } catch (error) {
                if (feedback) feedback.textContent = error.message || 'Unable to save barcode permissions.';
            } finally {
                button.disabled = false;
                button.innerHTML = '<i aria-hidden="true" class="fi fi-rr-disk"></i><span>Save Changes</span>';
            }
        }

        function bindMemoTableInteractions() {
            const body = document.getElementById('dataTable');
            if (!body || body.dataset.memoEventsBound === 'true') return;
            body.dataset.memoEventsBound = 'true';
            body.addEventListener('click', event => {
                const actionButton = event.target.closest('[data-memo-action]');
                if (actionButton) {
                    event.preventDefault(); event.stopPropagation();
                    const control = actionButton.getAttribute('data-control-number') || '';
                    const memo = (allMemos || []).find(row => String(row[2] || '') === control);
                    if (!memo) return;
                    if (actionButton.dataset.memoAction === 'edit') initiateEdit(control, memo[1] || '', memo[5] || '', memo[4] || 'For Dispatched', memo[3] || '');
                    else if (actionButton.dataset.memoAction === 'delete') triggerDelete(control);
                    return;
                }
                if (event.target.closest('input,button,a,select,textarea,label')) return;
                const rowElement = event.target.closest('tr[data-memo-control]');
                if (rowElement) openMemoInformation(rowElement.getAttribute('data-memo-control'));
            });
            body.addEventListener('keydown', event => {
                if (!['Enter', ' '].includes(event.key) || event.target.closest('input,button,a,select,textarea,label')) return;
                const rowElement = event.target.closest('tr[data-memo-control]');
                if (rowElement) { event.preventDefault(); openMemoInformation(rowElement.getAttribute('data-memo-control')); }
            });
        }

        document.getElementById('memoBarcodeAdminList')?.addEventListener('change', updateMemoBarcodeSelectedCount);
        bindMemoTableInteractions();

        function changeMemoPage(direction) { currentMemoPage += direction; renderMemoTable(); }

        let generatedMemoControlNumber = "";

        function showMemoControlNumberModal(controlNumber) {
            generatedMemoControlNumber = String(controlNumber || "").trim();
            document.getElementById('generatedMemoControlNumber').textContent = generatedMemoControlNumber || "Control number unavailable";
            document.getElementById('memoControlCopyFeedback').textContent = "";
            document.getElementById('copyMemoControlNumberBtn').disabled = !generatedMemoControlNumber;
            document.getElementById('memoControlNumberModal').classList.remove('hidden');
        }

        async function copyGeneratedMemoControlNumber() {
            if (!generatedMemoControlNumber) return;
            const feedback = document.getElementById('memoControlCopyFeedback');
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(generatedMemoControlNumber);
                } else {
                    const temp = document.createElement('textarea');
                    temp.value = generatedMemoControlNumber;
                    temp.style.position = 'fixed'; temp.style.opacity = '0';
                    document.body.appendChild(temp); temp.select();
                    const copied = document.execCommand('copy'); temp.remove();
                    if (!copied) throw new Error('Clipboard copy failed');
                }
                feedback.textContent = "Control number copied to clipboard.";
            } catch (err) {
                feedback.textContent = "Copy was blocked. Please select and copy the control number above.";
            }
        }

        function closeMemoControlNumberModal() {
            document.getElementById('memoControlNumberModal').classList.add('hidden');
            generatedMemoControlNumber = "";
        }

        document.getElementById('memoForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = document.getElementById('memoSubmitBtn');
            const subject = document.getElementById('memoSubject').value.trim();
            const officeDestination = getSelectedOfficeDestination('memoOfficeDestination', 'memoOfficeDestinationOther');
            const classification = document.getElementById('memoClassification').value;
            const memoType = document.getElementById('memoType')?.value || 'Regular Memo';
            if (!['Regular Memo', 'CSW (Complete Staff Work)'].includes(memoType)) return customAlert('Please select a valid Memorandum Type.', 'Error');
            if (!subject) return customAlert("Please enter a Memo Subject.", "Error");
            if (!officeDestination) return customAlert("Please select or enter the Office Destination.", "Error");
            submitBtn.disabled = true; submitBtn.innerText = "Submitting...";
            try {
                // CORS mode is required to read the backend's JSON response containing the actual generated control number.
                const response = await fetch(API_URL, {
                    method: 'POST', mode: 'cors',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ action: 'create', memoSubject: subject, officeDestination: officeDestination, classification: classification, memoType: memoType, userName: localStorage.getItem('loggedInUser'), credential: localStorage.getItem('loggedCred') || '' })
                });
                if (!response.ok) throw new Error('The server could not confirm the submission.');
                const result = await response.json();
                if (!result || result.success !== true || !result.controlNumber) {
                    throw new Error((result && result.error) || 'The server did not return a control number.');
                }
                logActivity(`encoded a new memo: "${subject}" for ${officeDestination}`);
                document.getElementById('memoSubject').value = "";
                if (document.getElementById('memoType')) document.getElementById('memoType').value = 'Regular Memo';
                setOfficeDestination('memoOfficeDestination', 'memoOfficeDestinationOther', "");
                closeMemoModal();
                await loadData();
                showMemoControlNumberModal(result.controlNumber);
            } catch (err) {
                customAlert("Memo submission could not be confirmed. Please check the Memo Database before retrying to avoid creating a duplicate. " + (err.message || ""), "Submission Status");
            } finally {
                submitBtn.disabled = false; submitBtn.innerText = "Submit Data";
            }
        });

        function initiateEdit(controlNum, currentSubject, currentOfficeDestination = "", currentStatus = "For Dispatched", encodedBy = "") {
            if (!isCurrentUserRecordOwner(encodedBy)) {
                customAlert('You can edit only memo entries that you encoded.', 'Permission Denied');
                return;
            }
            triggerActionModal('edit', controlNum, currentSubject, currentOfficeDestination, currentStatus);
        }

        function triggerDelete(controlNum) {
            const isAlphaAdmin = localStorage.getItem('loggedInUser') === ALPHA_ADMIN_NAME; 

            if (!isAlphaAdmin) { 
                return customAlert("Regular Users and Admins are unable to delete existing entries. Only Alpha Admin can delete records.", "Permission Denied"); 
            }
            triggerActionModal('delete', controlNum);
        }

        function triggerActionModal(action, controlNum, currentSubject = "", currentOfficeDestination = "", currentStatus = "For Dispatched") {
            pendingAction = action; 
            actionTargetControl = controlNum; 
            const confirmationModal = document.getElementById('actionModal');
            if (confirmationModal && confirmationModal.parentElement !== document.body) document.body.appendChild(confirmationModal);
            confirmationModal.classList.remove('hidden');
            window.SPADESModalStack?.bringToFront(confirmationModal);
            
            const passInput = document.getElementById('actionAdminPass');
            const confirmBtn = document.getElementById('actionConfirmBtn');
            if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.innerText = 'Confirm'; }
            passInput.value = hasFreshAlphaStepUp() ? sessionAdminPass : (isAlphaAdmin() ? "" : (localStorage.getItem('loggedCred') || ""));
            passInput.placeholder = hasFreshAlphaStepUp() ? "Verified Admin Session" : "Enter Password";
            
            document.getElementById('actionNewSubject').value = currentSubject;
            document.getElementById('actionNewStatus').value = currentStatus;
            setOfficeDestination('actionNewOfficeDestination', 'actionNewOfficeDestinationOther', currentOfficeDestination === "N/A" ? "" : currentOfficeDestination);
            
            if (action === 'edit') { 
                document.getElementById('actionModalTitle').innerText = `Edit: ${controlNum}`; 
                document.getElementById('actionNewSubject').classList.remove('hidden'); 
                document.getElementById('actionNewStatus').classList.remove('hidden');
                document.getElementById('actionOfficeDestinationWrapper').classList.remove('hidden'); 
            } else { 
                document.getElementById('actionModalTitle').innerText = `Delete: ${controlNum}`; 
                document.getElementById('actionNewSubject').classList.add('hidden'); 
                document.getElementById('actionNewStatus').classList.add('hidden');
                document.getElementById('actionOfficeDestinationWrapper').classList.add('hidden'); 
            }
        }
        
        function closeActionModal() { document.getElementById('actionModal').classList.add('hidden'); pendingAction = null; actionTargetControl = null; document.getElementById('actionNewSubject').classList.add('hidden'); document.getElementById('actionNewStatus').classList.add('hidden'); document.getElementById('actionOfficeDestinationWrapper').classList.add('hidden'); setOfficeDestination('actionNewOfficeDestination', 'actionNewOfficeDestinationOther', ""); }
        
        async function executeAction() {
            let pass = document.getElementById('actionAdminPass').value;
            const confirmBtn = document.getElementById('actionConfirmBtn');
            if (!pass && !hasFreshAlphaStepUp()) {
                if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.innerText = 'Confirm'; }
                return customAlert("Please enter password.", "Error");
            }

            // Lock the Confirm button immediately after the first valid press to prevent
            // duplicate submissions while the backend request is being processed.
            if (confirmBtn) {
                if (confirmBtn.disabled) return;
                confirmBtn.disabled = true;
                confirmBtn.innerText = 'Processing...';
            }

            const currentUser = localStorage.getItem('loggedInUser');

            try {
                // Alpha Admin memo operations use the same elevated token required
                // by the other sensitive administrator endpoints.
                if (isAlphaAdmin()) pass = await ensureAlphaStepUpToken(pass);
                if (pendingAction === 'edit') { 
                    const newSubject = document.getElementById('actionNewSubject').value.trim(); 
                    const newStatus = document.getElementById('actionNewStatus').value;
                    const newOfficeDestination = getSelectedOfficeDestination('actionNewOfficeDestination', 'actionNewOfficeDestinationOther'); 
                    
                    if (!newSubject) throw new Error("Please enter a Memo Subject."); 
                    if (!newOfficeDestination) throw new Error("Please select or enter the Office Destination."); 
                    
                    const response = await fetch(API_URL, { method: 'POST', mode: 'cors', headers: {'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify({ action: 'update', controlNumber: actionTargetControl, newSubject: newSubject, newStatus: newStatus, officeDestination: newOfficeDestination, password: pass, userName: currentUser }) });
                    const result = await response.json();
                    if (!result || result.success !== true) throw new Error((result && result.error) || 'The memo update was rejected.');
                    logActivity(`updated memo: ${actionTargetControl}`);
                } else if (pendingAction === 'delete') {
                    const response = await fetch(API_URL, { method:'POST', mode:'cors', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify({ action:'delete', controlNumber:actionTargetControl, password:pass, userName:currentUser }) });
                    const result = await response.json();
                    if (!result || result.success !== true) throw new Error(result?.error || 'The memo could not be deleted.');
                    logActivity(`deleted memo: ${actionTargetControl}`);
                } else if (pendingAction === 'batch_delete') {
                    for (const c of actionTargetControl) {
                        const response = await fetch(API_URL, { method:'POST', mode:'cors', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify({ action:'delete', controlNumber:c, password:pass, userName:currentUser }) });
                        const result = await response.json();
                        if (!result || result.success !== true) throw new Error(result?.error || `Memo ${c} could not be deleted.`);
                    }
                    logActivity(`batch deleted ${actionTargetControl.length} memos`);
                } else if (pendingAction === 'batch_status') {
                    const newStatus = document.getElementById('actionNewStatus').value;
                    for (const c of actionTargetControl) {
                        const row = (allMemos || []).find(r => String(r[2]) === String(c));
                        const newSubject = row ? String(row[1] || '') : '';
                        const newOfficeDestination = row ? String(row[5] || 'N/A') : 'N/A';
                        const response = await fetch(API_URL, { method: 'POST', mode: 'cors', headers: {'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify({ action: 'update', controlNumber: c, newSubject: newSubject, newStatus: newStatus, officeDestination: newOfficeDestination, password: pass, userName: currentUser }) });
                        const result = await response.json();
                        if (!result || result.success !== true) throw new Error((result && result.error) || `Memo ${c} could not be updated.`);
                    }
                    logActivity(`bulk updated status to ${newStatus} for ${actionTargetControl.length} memos`);
                }

                // Refresh only memo data; retain the active search, filters, page, and table scroll position.
                await loadData();

                // Automatically close the action/confirmation modal after the first
                // confirmed action has been submitted successfully.
                closeActionModal();
            } catch (err) {
                if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.innerText = 'Confirm'; }
                customAlert(err.message || 'Unable to complete the requested action.', 'Error');
            } finally {
                const passInput = document.getElementById('actionAdminPass');
                if (passInput && isAlphaAdmin()) passInput.value = '';
            }
        }

        function searchTable(preserveCurrentPage = false) {
            const input = document.getElementById('searchInput').value.toLowerCase();
            const categoryFilter = document.getElementById('filterCategory').value;
            const encoderFilter = document.getElementById('filterEncoder').value;
            const monthFilter = document.getElementById('filterMonth').value;
            const yearFilter = document.getElementById('filterYear').value;
            const dayFilter = document.getElementById('filterDay').value;

            if (userSettings.rememberSearch) {
                const user = localStorage.getItem('loggedInUser');
                if (user) localStorage.setItem('rhsuSearch_' + user, input);
            }

            filteredMemos = allMemos.filter(row => {
                const text = (row.join(" ")).toLowerCase();
                const controlNum = row[2] || "";
                
                let matchesSearch = text.includes(input);
                let matchesCategory = categoryFilter === "" || controlNum.includes(`RHSU(${categoryFilter})`);
                let matchesEncoder = encoderFilter === "" || row[3] === encoderFilter;
                
                let matchesMonth = true;
                let matchesYear = true;
                let matchesDay = true;

                if (row[0]) {
                    const d = new Date(row[0]);
                    if (!isNaN(d.getTime())) {
                        const m = ("0" + (d.getMonth() + 1)).slice(-2);
                        const y = d.getFullYear().toString();
                        const day = `${y}-${m}-${String(d.getDate()).padStart(2,'0')}`;
                        if (monthFilter !== "" && m !== monthFilter) matchesMonth = false;
                        if (yearFilter !== "" && y !== yearFilter) matchesYear = false;
                        if (dayFilter !== "" && day !== dayFilter) matchesDay = false;
                    }
                }

                return matchesSearch && matchesCategory && matchesEncoder && matchesMonth && matchesYear && matchesDay;
            });
            if (!preserveCurrentPage) currentMemoPage = 1;
            renderMemoTable();
        }

        function toggleSelectAll() {
            const isChecked = document.getElementById('selectAll').checked;
            const checkboxes = document.querySelectorAll('.row-checkbox');
            checkboxes.forEach(cb => cb.checked = isChecked);
        }

        function batchEditStatus() {
            const checked = document.querySelectorAll('.row-checkbox:checked');
            if (checked.length === 0) return customAlert("No memos selected for status update.", "Error");
            const selectedControls = Array.from(checked).map(cb => cb.value);
            const selectedMemos = allMemos.filter(row => selectedControls.includes(String(row[2])));
            if (selectedMemos.length !== selectedControls.length || selectedMemos.some(row => !isCurrentUserRecordOwner(row[3]))) {
                return customAlert('You can update the status only of memo entries that you encoded. Deselect entries encoded by other users.', 'Permission Denied');
            }
            actionTargetControl = selectedControls;
            pendingAction = 'batch_status';
            const confirmationModal = document.getElementById('actionModal');
            if (confirmationModal && confirmationModal.parentElement !== document.body) document.body.appendChild(confirmationModal);
            confirmationModal.classList.remove('hidden');
            window.SPADESModalStack?.bringToFront(confirmationModal);
            document.getElementById('actionModalTitle').innerText = `Bulk Edit Status (${actionTargetControl.length} items)`;
            document.getElementById('actionNewSubject').classList.add('hidden');
            document.getElementById('actionNewStatus').classList.remove('hidden');
            document.getElementById('actionOfficeDestinationWrapper').classList.add('hidden');
            const passInput = document.getElementById('actionAdminPass');
            const confirmBtn = document.getElementById('actionConfirmBtn');
            if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.innerText = 'Confirm'; }
            passInput.value = hasFreshAlphaStepUp() ? sessionAdminPass : (isAlphaAdmin() ? "" : (localStorage.getItem('loggedCred') || ""));
            passInput.placeholder = hasFreshAlphaStepUp() ? "Verified Admin Session" : "Enter Password";
        }

        function batchDelete() {
            const isAlphaAdmin = localStorage.getItem('loggedInUser') === ALPHA_ADMIN_NAME; 
            if (!isAlphaAdmin) return customAlert("Permission Denied.", "Error");

            const checked = document.querySelectorAll('.row-checkbox:checked');
            if (checked.length === 0) return customAlert("No memos selected for deletion.", "Error");
            
            const toDelete = Array.from(checked).map(cb => cb.value);
            actionTargetControl = toDelete;
            pendingAction = 'batch_delete';
            
            document.getElementById('actionModal').classList.remove('hidden');
            document.getElementById('actionModalTitle').innerText = `Batch Delete (${toDelete.length} items)`;
            document.getElementById('actionNewSubject').classList.add('hidden');
            document.getElementById('actionNewStatus').classList.add('hidden');
            document.getElementById('actionOfficeDestinationWrapper').classList.add('hidden');
            
            const passInput = document.getElementById('actionAdminPass');
            const confirmBtn = document.getElementById('actionConfirmBtn');
            if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.innerText = 'Confirm'; }
            passInput.value = hasFreshAlphaStepUp() ? sessionAdminPass : (isAlphaAdmin() ? "" : (localStorage.getItem('loggedCred') || ""));
            passInput.placeholder = hasFreshAlphaStepUp() ? "Verified Admin Session" : "Enter Password";
        }

        // Restore the authenticated session on refresh while keeping the login screen
        // concealed behind the boot loader. No credentials are re-authenticated here;
        // the existing stored session is restored through checkAuth().
        (function initializeSpadesBootSequence() {
            const startedAt = performance.now();
            let dismissed = false;

            function dismissBootLoader() {
                if (dismissed) return;
                dismissed = true;
                const loader = document.getElementById('spadesBootLoader');
                document.documentElement.classList.remove('spades-session-restore');
                if (!loader) return;
                loader.classList.add('is-leaving');
                window.setTimeout(() => loader.remove(), 650);
            }

            document.addEventListener('DOMContentLoaded', async () => {
                const caption = document.getElementById('spadesLoaderCaption');
                const percent = document.getElementById('spadesLoaderPercent');
                const stages = [
                    ['ESTABLISHING SECURE CONNECTION', '30%'],
                    ['RESTORING USER SESSION', '65%'],
                    ['LOADING WORKSPACE MODULES', '100%']
                ];
                let stage = 0;
                const stageTimer = window.setInterval(() => {
                    if (stage < stages.length) {
                        if (caption) caption.textContent = stages[stage][0];
                        if (percent) percent.textContent = stages[stage][1];
                        stage++;
                    } else {
                        window.clearInterval(stageTimer);
                    }
                }, 110);

                // Identity lookup is a non-blocking UI bootstrap. A cached public username
                // is available immediately; validate_session returns the authoritative role.
                loadAlphaAdminIdentity();
                const storedUser = localStorage.getItem('loggedInUser') || '';
                const storedToken = localStorage.getItem('loggedCred') || '';
                if (storedUser && storedToken) {
                    try {
                        const validationResponse = await Promise.race([
                            fetch(API_URL, {
                                method:'POST',
                                headers:{'Content-Type':'text/plain;charset=utf-8'},
                                cache:'no-store',
                                body:JSON.stringify({action:'validate_session',username:storedUser,credential:storedToken})
                            }),
                            new Promise((_, reject) => window.setTimeout(() => reject(new Error('Session validation timed out.')), 6000))
                        ]);
                        const validation = await validationResponse.json();
                        if (!validation?.success) {
                            ['loggedInUser','loggedCred','loggedSessionExpiresAt','userRole','canEdit'].forEach(key => localStorage.removeItem(key));
                            sessionAdminPass = ''; sessionAdminPassExpiresAt = 0;
                        } else {
                            localStorage.setItem('loggedSessionExpiresAt', String(validation.expiresAt || ''));
                            scheduleSessionExpiry();
                            localStorage.setItem('userRole', validation.role || 'Regular User');
                            if (validation.isAlphaAdmin) setCachedAlphaAdminName(validation.username || storedUser);
                        }
                    } catch (validationError) {
                        // Fail closed when a saved bearer token cannot be verified.
                        ['loggedInUser','loggedCred','loggedSessionExpiresAt','userRole','canEdit'].forEach(key => localStorage.removeItem(key));
                        sessionAdminPass = ''; sessionAdminPassExpiresAt = 0;
                        console.warn('Stored SPADES session could not be validated.', validationError);
                    }
                } else if (storedUser || storedToken) {
                    ['loggedInUser','loggedCred','loggedSessionExpiresAt','userRole','canEdit'].forEach(key => localStorage.removeItem(key));
                }

                checkAuth();
                const minimumDisplay = 160;
                const remaining = Math.max(0, minimumDisplay - (performance.now() - startedAt));
                window.setTimeout(() => {
                    window.clearInterval(stageTimer);
                    if (caption) caption.textContent = 'WORKSPACE READY';
                    if (percent) percent.textContent = '100%';
                    dismissBootLoader();
                }, remaining);
            }, { once: true });

            // Safety release if an unexpected script error interrupts startup.
            window.setTimeout(dismissBootLoader, 12000);
        })();

        /* ============================================================
           SPADES ENHANCEMENTS: Duty Office / BMI / Squadding / Leave /
           Area of Responsibilities / User Access / Activity Pagination
           ============================================================ */
        let execActivityPage = 1;
        const EXEC_ACTIVITY_PAGE_SIZE = 8;
        let currentPersonnelSubPage = 'list';
        let personnelManagementDataLoaded = false;
        let personnelManagementDataPromise = null;
        let personnelManagementForceRefreshQueued = false;
        let dutySequence = [];
        let dutyCalendarDate = new Date();
        let bmiRecords = [];
        let squads = [];
        let leaveEntries = [];
        let leaveCalendarDate = new Date();
        let areas = [];
        let editingAreaId = null;
        let areaPreselected = [];
        let areaExcludeNames = null;
        let editingSquadId = null;
        let squadPreselectedMembers = null;
        let squadExcludeNames = null;
        let squadEditingLeaderIdx = '';
        let selectedLeaveDates = [];
        let userAccessMap = {};
        let userPersonnelPermissionsMap = {};
        let userAccessMapLoadedFor = '';
        let currentAccessUsername = null;
        let bmiEditingId = null;
        let dutySequenceWorking = [];

        const ACCESS_PAGES = [
            {key:'dashboard', label:'Dashboard'},
            {key:'home', label:'Memo Database'},
            {key:'personnel', label:'Personnel Management'},
            {key:'activityManagement', label:'Activity Management'},
            {key:'matrixCompliances', label:'Matrix of Compliances'},
            {key:'adminProofReader', label:'Admin Proof Reader'},
            {key:'settings', label:'Settings'},
            {key:'adminMgmt', label:'User Management'},
            {key:'usersChat', label:'Users Chat'}
        ];
        const PERSONNEL_PERMISSION_SUBPAGES = [
            {key:'list', label:'Personnel List'}, {key:'duty', label:'Duty Office'},
            {key:'bmi', label:'BMI Monitoring'}, {key:'squad', label:'Squadding'},
            {key:'leave', label:'Leave Management'}, {key:'aor', label:'Area of Responsibilities'}
        ];
        const PERSONNEL_PERMISSION_ACTIONS = [
            {key:'add', label:'Add'}, {key:'edit', label:'Edit'}, {key:'delete', label:'Delete'}
        ];

        function personnelFullName(p) {
            if (!p) return '';
            const parts = [p.rank, p.firstName, p.middleName, p.lastName, p.qualifiers]
                .map(s => String(s || '').trim()).filter(Boolean);
            return parts.join(' ');
        }
        function personnelShortName(p) {
            if (!p) return '';
            return [p.rank, p.lastName].map(s => String(s || '').trim()).filter(Boolean).join(' ');
        }

        /* ---------- Dashboard Live Activity Log: 5 latest + pagination ---------- */
        function renderExecActivityLogs() {
            const logContainer = document.getElementById('execLiveActivityLogs');
            if (!logContainer) return;
            const logs = sortActivityLogsLatestFirst(liveActivityLogs);
            populateExecActivityUserFilter(logs);
            const getLogTime = (log) => log && (log.timestamp || log.time || log.datetime || log.date || log.createdAt || log.created_at || '');
            const getLogUser = (log) => log && (log.user || log.username || log.name || 'Unknown User');
            const getLogAction = (log) => log && (log.actionText || log.action || log.activity || log.message || '—');
            const visibleLogs = execActivityUserFilter
                ? logs.filter(log => String(getLogUser(log)).trim() === execActivityUserFilter)
                : logs;
            const filterLabel = execActivityUserFilter ? ` • ${execActivityUserFilter}` : ' • all users';
            const totalPages = Math.max(1, Math.ceil(visibleLogs.length / EXEC_ACTIVITY_PAGE_SIZE));
            if (execActivityPage > totalPages) execActivityPage = totalPages;
            if (execActivityPage < 1) execActivityPage = 1;
            const start = (execActivityPage - 1) * EXEC_ACTIVITY_PAGE_SIZE;
            const pageLogs = visibleLogs.slice(start, start + EXEC_ACTIVITY_PAGE_SIZE);
            const countText = `${visibleLogs.length} entr${visibleLogs.length === 1 ? 'y' : 'ies'}${filterLabel} • Page ${execActivityPage}/${totalPages}`;

            if (visibleLogs.length) {
                let paginationHtml = '';
                if (totalPages > 1) {
                    paginationHtml = `<div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:10px;">
                        <button type="button" class="action-btn page-btn" style="margin:0;padding:4px 10px;font-size:12px;" ${execActivityPage<=1?'disabled':''} onclick="setExecActivityPage(${execActivityPage-1})">‹ Prev</button>
                        <span style="font-size:12px;color:var(--text-muted);">${execActivityPage} / ${totalPages}</span>
                        <button type="button" class="action-btn page-btn" style="margin:0;padding:4px 10px;font-size:12px;" ${execActivityPage>=totalPages?'disabled':''} onclick="setExecActivityPage(${execActivityPage+1})">Next ›</button>
                    </div>`;
                }
                logContainer.innerHTML = `<div style="margin-bottom:10px;font-size:11px;color:var(--text-muted);font-weight:600;">${escapeHtml(countText)}</div><div class="exec-log-scroll"><table class="exec-table"><thead><tr><th>Time</th><th>User</th><th>Activity</th></tr></thead><tbody>${
                    pageLogs.map(log => `<tr><td>${escapeHtml(execFormatDate(getLogTime(log)))}</td><td>${escapeHtml(getLogUser(log))}</td><td>${escapeHtml(getLogAction(log))}</td></tr>`).join('')
                }</tbody></table></div>${paginationHtml}`;
            } else if (execActivityUserFilter && logs.length) {
                logContainer.innerHTML = '<div class="exec-empty">No activity logs found for the selected user.</div>';
            } else {
                logContainer.innerHTML = '<div class="exec-empty">No activity logs are currently available from the backend.</div>';
            }
        }
        function setExecActivityPage(page) {
            execActivityPage = Math.max(1, Number(page) || 1);
            renderExecutiveDashboard();
        }

        /* ---------- Personnel Sub-Page Navigation ---------- */
        function switchPersonnelSubPage(sub, options = {}) {
            currentPersonnelSubPage = Object.prototype.hasOwnProperty.call(SPADES_PERSONNEL_ROUTE_LABELS, sub) ? sub : 'list';
            sub = currentPersonnelSubPage;
            if (sub === 'list') togglePersonnelRecapPanel(true);
            const map = {
                'list':'subPersonnelList', 'duty':'subDutyOffice', 'bmi':'subBmiMonitoring',
                'squad':'subSquadding', 'leave':'subLeaveManagement', 'aor':'subAreaOfResponsibility'
            };
            Object.values(map).forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.add('hidden');
            });
            const target = document.getElementById(map[sub]);
            if (target) target.classList.remove('hidden');
            document.querySelectorAll('.personnel-subnav-btn').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-sub') === sub);
            });
            updatePersonnelPermissions();
            // Keep every Personnel Management sub-page dataset warm in memory. The data
            // is also preloaded from the Dashboard, so summaries never depend on a visit.
            updateSpadesAddressBar('personnel', { replace: !!options.skipAddressUpdate });
            loadAllPersonnelManagementData();
        }

        async function loadAllPersonnelManagementData(forceRefresh = false) {
            if (personnelManagementDataLoaded && !forceRefresh) return true;
            if (personnelManagementDataPromise) {
                if (forceRefresh) personnelManagementForceRefreshQueued = true;
                const inFlight = personnelManagementDataPromise;
                return inFlight.then(() => {
                    if (!personnelManagementForceRefreshQueued) return true;
                    personnelManagementForceRefreshQueued = false;
                    return loadAllPersonnelManagementData(true);
                });
            }

            personnelManagementDataPromise = (async () => {
                try {
                    const response = await spadesAuthenticatedRead('get_personnel_management_bundle');
                    if (!response.ok) throw new Error(`Personnel Management request failed (${response.status}).`);
                    const data = await response.json();
                    if (!data || data.success !== true) throw new Error(data?.error || 'Invalid Personnel Management response.');

                    allPersonnel = Array.isArray(data.personnel) ? data.personnel : [];
                    archivedPersonnel = Array.isArray(data.archived) ? data.archived : [];
                    dutySequence = Array.isArray(data.sequence) ? data.sequence : [];
                    bmiRecords = Array.isArray(data.records) ? data.records.map(normalizeBmiRecordForDisplay) : [];
                    squads = Array.isArray(data.squads) ? data.squads : [];
                    leaveEntries = Array.isArray(data.entries) ? data.entries : [];
                    areas = Array.isArray(data.areas) ? data.areas : [];

                    updatePersonnelDashboard();
                    populatePersonnelFilters();
                    populatePersonnelSections();
                    renderDutyCalendar();
                    renderDutyTable();
                    populateBmiPeriods();
                    renderBmiTable();
                    renderSquadCarousel();
                    renderLeaveCalendar();
                    renderLeaveTable();
                    renderAreaCards();
                    // Complete Personnel List rendering before the loader resolves so
                    // scroll restoration runs after the new rows are in the DOM.
                    await new Promise(resolve => requestAnimationFrame(() => { filterPersonnel(); resolve(); }));

                    personnelManagementDataLoaded = true;
                    return true;
                } catch (error) {
                    personnelManagementDataLoaded = false;
                    console.warn('Personnel Management bundle failed; falling back to individual module reads.', error);
                    const personnelLoaded = await loadPersonnel();
                    const moduleResults = await Promise.allSettled([
                        loadDutySequence(), loadBmiRecords(), loadLeaveEntries(), loadAreas()
                    ]);
                    const squadsLoaded = await loadSquads();
                    personnelManagementDataLoaded = personnelLoaded !== false &&
                        moduleResults.every(result => result.status === 'fulfilled' && result.value !== false) &&
                        squadsLoaded !== false;
                    return personnelManagementDataLoaded;
                }
            })();

            try { return await personnelManagementDataPromise; }
            finally { personnelManagementDataPromise = null; }
        }

        async function refreshPersonnelManagementAfterMutation() {
            // Personnel CRUD changes only the Personnel List/Archive datasets.
            // Avoid reloading and repainting all seven Personnel submodules after
            // each add/edit/archive/restore operation. If the initial bundle is
            // still in flight, let it settle first, then fetch the authoritative
            // Personnel data so an older response cannot overwrite the mutation.
            const inFlight = personnelManagementDataPromise;
            if (inFlight) {
                try { await inFlight; }
                catch (error) { console.warn('Earlier Personnel bundle did not complete before the targeted refresh:', error); }
            }
            personnelManagementDataLoaded = false;
            return loadPersonnel();
        }

        /* ---------- Duty Office ---------- */
        async function loadDutySequence() {
            let loaded = true;
            try {
                const res = await spadesAuthenticatedRead('get_duty_sequence');
                if (!res.ok) throw new Error(`Request failed (${res.status})`);
                const data = await res.json();
                if (data.success && Array.isArray(data.sequence)) dutySequence = data.sequence;
                else {
                    loaded = false;
                    dutySequence = ['PMSg Siobal','PCMS Tayab','PMSg Graycochea','PMSg Oligo','PCpl Gandia','Pat Bao-anen','Pat Benitez','Pat Obra'];
                }
            } catch (e) {
                loaded = false;
                console.warn('Duty Office sequence could not be loaded:', e);
                dutySequence = ['PMSg Siobal','PCMS Tayab','PMSg Graycochea','PMSg Oligo','PCpl Gandia','Pat Bao-anen','Pat Benitez','Pat Obra'];
            }
            renderDutyCalendar();
            renderDutyTable();
            return loaded;
        }
        function getDutyAssignment(dateObj, seq) {
            const day = dateObj.getDay(); // 0=Sun ... 6=Sat
            if (day === 5) return {name:'Duty Supply', remarks:'Persistent Friday duty'};
            if (day === 6) return {name:'Duty RBand', remarks:'Persistent Saturday duty'};
            if (day === 0) return {name:'Duty Water Operator', remarks:'Persistent Sunday duty'};
            // Mon-Thu: rotate through sequence using week-based index
            if (!seq || !seq.length) return {name:'—', remarks:''};
            const onejan = new Date(dateObj.getFullYear(), 0, 1);
            const weekNum = Math.ceil((((dateObj - onejan) / 86400000) + onejan.getDay() + 1) / 7);
            const dayOffset = day === 1 ? 0 : day === 2 ? 1 : day === 3 ? 2 : 3; // Mon=0..Thu=3
            const idx = (weekNum * 4 + dayOffset) % seq.length;
            return {name: seq[idx], remarks:'Rotating duty (Mon–Thu)'};
        }
        function renderDutyCalendar() {
            const grid = document.getElementById('dutyCalendarGrid');
            const title = document.getElementById('dutyCalendarTitle');
            if (!grid || !title) return;
            const year = dutyCalendarDate.getFullYear();
            const month = dutyCalendarDate.getMonth();
            const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            title.innerText = `${monthNames[month]} ${year}`;
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            let html = dayNames.map(d => `<div class="duty-cal-day duty-cal-head">${d}</div>`).join('');
            for (let i = 0; i < firstDay; i++) html += '<div class="duty-cal-day duty-cal-empty"></div>';
            for (let d = 1; d <= daysInMonth; d++) {
                const dateObj = new Date(year, month, d);
                const assign = getDutyAssignment(dateObj, dutySequence);
                const dayOfWeek = dateObj.getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                const isToday = dateObj.toDateString() === new Date().toDateString();
                html += `<div class="duty-cal-day ${isWeekend?'duty-cal-weekend':''} ${isToday?'duty-cal-today':''}" title="${escapeAttr(assign.name)} — ${escapeAttr(assign.remarks)}">
                    <div class="duty-cal-date">${d}</div>
                    <div class="duty-cal-personnel">${escapeHtml(assign.name)}</div>
                </div>`;
            }
            grid.innerHTML = html;
        }
        function changeDutyMonth(delta) {
            dutyCalendarDate = new Date(dutyCalendarDate.getFullYear(), dutyCalendarDate.getMonth() + Number(delta), 1);
            renderDutyCalendar();
            renderDutyTable();
        }
        function renderDutyTable() {
            const tbody = document.getElementById('dutyTableBody');
            if (!tbody) return;
            const year = dutyCalendarDate.getFullYear();
            const month = dutyCalendarDate.getMonth();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
            const today = new Date(); today.setHours(0,0,0,0);

            const dateInfo = [];
            for (let d = 1; d <= daysInMonth; d++) {
                const dateObj = new Date(year, month, d);
                dateInfo.push({day: d, dateObj: dateObj, assign: getDutyAssignment(dateObj, dutySequence)});
            }

            // Ongoing = today; Out Going = closest duty day before today; Incoming = closest duty day after today.
            let ongoingIdx = -1, outgoingIdx = -1, incomingIdx = -1;
            dateInfo.forEach((info, i) => {
                const diff = info.dateObj.getTime() - today.getTime();
                if (diff === 0) ongoingIdx = i;
                else if (diff < 0) { if (outgoingIdx === -1 || info.dateObj.getTime() > dateInfo[outgoingIdx].dateObj.getTime()) outgoingIdx = i; }
                else { if (incomingIdx === -1 || info.dateObj.getTime() < dateInfo[incomingIdx].dateObj.getTime()) incomingIdx = i; }
            });

            // Add per-column copy buttons to the table header.
            const table = tbody.closest('table');
            if (table) {
                const thead = table.querySelector('thead');
                if (thead) {
                    const headers = ['Rank/Name','Date (Month D, YYYY)','Day','Remarks'];
                    thead.innerHTML = '<tr>' + headers.map((h, ci) =>
                        `<th>${escapeHtml(h)} <button type="button" class="duty-copy-btn" onclick="copyDutyColumn(${ci})" title="Copy ${escapeAttr(h)} column">Copy</button></th>`
                    ).join('') + '</tr>';
                }
            }

            tbody.innerHTML = dateInfo.map((info, i) => {
                let remarks = info.assign.remarks;
                let rowClass = '';
                let remarkStyle = '';
                if (i === ongoingIdx) { remarks = 'Duty Office'; rowClass = 'duty-row-ongoing'; remarkStyle = 'color:var(--success);font-weight:700;'; }
                else if (i === outgoingIdx) { remarks = 'Out Going'; remarkStyle = 'color:var(--danger);font-weight:700;'; }
                else if (i === incomingIdx) { remarks = 'Incoming'; remarkStyle = 'color:#f59e0b;font-weight:700;'; }
                return `<tr class="${rowClass}">
                    <td>${escapeHtml(info.assign.name)}</td>
                    <td>${monthNames[month]} ${info.day}, ${year}</td>
                    <td>${dayNames[info.dateObj.getDay()]}</td>
                    <td style="${remarkStyle}">${escapeHtml(remarks)}</td>
                </tr>`;
            }).join('');
        }
        function copyDutyColumn(colIndex) {
            const tbody = document.getElementById('dutyTableBody');
            if (!tbody) return;
            const values = [];
            tbody.querySelectorAll('tr').forEach(tr => {
                const td = tr.querySelectorAll('td')[Number(colIndex)];
                if (td) values.push(td.innerText.trim());
            });
            const text = values.join('\n');
            const done = () => customAlert("Column copied to clipboard.", "Copied");
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(() => {});
            } else {
                const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
                try { document.execCommand('copy'); done(); } catch(e) {}
                document.body.removeChild(ta);
            }
        }

        function openDutySequenceModal() {
            if (!canPersonnelAction('duty', 'edit')) { customAlert("You do not have permission to edit Duty Office entries.", "Permission Denied"); return; }
            dutySequenceWorking = dutySequence.slice();
            const sequenceSearch = document.getElementById('dutySequenceSearch');
            if (sequenceSearch) sequenceSearch.value = '';
            populateDutyPersonnelOptions();
            renderDutySequenceList();
            document.getElementById('dutySequenceModal').classList.remove('hidden');
        }
        function populateDutyPersonnelOptions() {
            const select = document.getElementById('dutyPersonnelToAdd');
            if (!select) return;
            const current = select.value;
            const personnel = (allPersonnel || []).filter(p => !p.status || String(p.status).trim().toLowerCase() === 'active')
                .map(p => ({label: personnelShortName(p) || personnelFullName(p), value: personnelShortName(p) || personnelFullName(p), full: personnelFullName(p)}))
                .filter(p => p.value);
            const existing = new Set((dutySequenceWorking || []).map(n => String(n).trim().toLowerCase()));
            const available = personnel.filter(p => !existing.has(p.value.toLowerCase()));
            select.innerHTML = '<option value="">Select active personnel…</option>' + available
                .sort((a,b) => a.label.localeCompare(b.label))
                .map(p => `<option value="${escapeAttr(p.value)}" title="${escapeAttr(p.full)}">${escapeHtml(p.label)}${p.full && p.full !== p.label ? ' — ' + escapeHtml(p.full) : ''}</option>`).join('');
            if (available.some(p => p.value === current)) select.value = current;
        }
        function addDutyPersonnelToSequence() {
            if (!canPersonnelAction('duty', 'edit')) return customAlert('You do not have permission to edit Duty Office entries.', 'Permission Denied');
            const select = document.getElementById('dutyPersonnelToAdd');
            const value = select ? String(select.value || '').trim() : '';
            if (!value) return customAlert('Select an active personnel record to add.', 'Select Personnel');
            if (dutySequenceWorking.some(n => String(n).trim().toLowerCase() === value.toLowerCase())) {
                populateDutyPersonnelOptions();
                return customAlert('This personnel is already in the duty sequence.', 'Already Added');
            }
            dutySequenceWorking.push(value);
            renderDutySequenceList();
            populateDutyPersonnelOptions();
        }

        function closeDutySequenceModal() { document.getElementById('dutySequenceModal').classList.add('hidden'); }
        let dutyDragIndex = null;
        function filterDutySequenceList() { renderDutySequenceList(); }

        function removeDutyItem(index) {
            if (!canPersonnelAction('duty', 'edit')) return customAlert('You do not have permission to edit Duty Office entries.', 'Permission Denied');
            const i = Number(index);
            const name = dutySequenceWorking[i];
            if (name == null) return;
            customConfirm(`Remove ${name} from the Duty Office rotation sequence? The personnel record will remain unchanged.`, confirmed => {
                if (!confirmed) return;
                dutySequenceWorking.splice(i, 1);
                renderDutySequenceList();
                populateDutyPersonnelOptions();
            });
        }

        function renderDutySequenceList() {
            const list = document.getElementById('dutySequenceList');
            if (!list) return;
            const query = String(document.getElementById('dutySequenceSearch')?.value || '').trim().toLowerCase();
            const visibleItems = dutySequenceWorking.map((name, index) => ({name, index}))
                .filter(item => !query || String(item.name).toLowerCase().includes(query));
            if (!visibleItems.length) {
                list.innerHTML = `<div class="duty-sequence-empty">${dutySequenceWorking.length ? 'No matching personnel found.' : 'No personnel are currently in the rotation. Add active personnel above.'}</div>`;
                return;
            }
            list.innerHTML = visibleItems.map(({name, index: i}) => `<div class="duty-seq-item" draggable="true" data-index="${i}"
                ondragstart="dutySeqDragStart(event, ${i})"
                ondragover="dutySeqDragOver(event, ${i})"
                ondragleave="dutySeqDragLeave(event)"
                ondrop="dutySeqDrop(event, ${i})"
                ondragend="dutySeqDragEnd(event)">
                <span class="duty-seq-drag-handle" aria-hidden="true" title="Drag to reorder">&#x22EE;&#x22EE;</span>
                <span class="duty-seq-pos">${i + 1}</span>
                <span class="duty-seq-name">${escapeHtml(name)}</span>
                <span class="duty-seq-controls">
                    <button type="button" class="action-btn duty-seq-move spades-force-icon-only" ${i===0?'disabled':''} aria-label="Move ${escapeAttr(name)} up" title="Move up" data-tooltip="Move up" onclick="moveDutyItem(${i}, -1)"><i class="fi fi-rr-angle-small-up" aria-hidden="true"></i></button>
                    <button type="button" class="action-btn duty-seq-move spades-force-icon-only" ${i===dutySequenceWorking.length-1?'disabled':''} aria-label="Move ${escapeAttr(name)} down" title="Move down" data-tooltip="Move down" onclick="moveDutyItem(${i}, 1)"><i class="fi fi-rr-angle-small-down" aria-hidden="true"></i></button>
                    <button type="button" class="action-btn duty-seq-remove spades-force-icon-only" aria-label="Remove ${escapeAttr(name)} from rotation" title="Remove from rotation" data-tooltip="Remove from rotation" onclick="removeDutyItem(${i})"><i class="fi fi-rr-trash" aria-hidden="true"></i></button>
                </span>
            </div>`).join('');
        }
        function dutySeqDragStart(e, idx) { dutyDragIndex = Number(idx); e.currentTarget.classList.add('dragging'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); } catch(err) {} }
        function dutySeqDragOver(e, idx) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); try { e.dataTransfer.dropEffect = 'move'; } catch(err) {} }
        function dutySeqDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
        function dutySeqDrop(e, idx) {
            e.preventDefault();
            e.currentTarget.classList.remove('drag-over');
            if (dutyDragIndex === null || dutyDragIndex === Number(idx)) return;
            const moved = dutySequenceWorking.splice(dutyDragIndex, 1)[0];
            dutySequenceWorking.splice(Number(idx), 0, moved);
            dutyDragIndex = null;
            renderDutySequenceList();
            populateDutyPersonnelOptions();
        }
        function dutySeqDragEnd(e) {
            dutyDragIndex = null;
            document.querySelectorAll('.duty-seq-item').forEach(el => { el.classList.remove('dragging'); el.classList.remove('drag-over'); });
        }

        function moveDutyItem(index, dir) {
            const i = Number(index), d = Number(dir);
            const j = i + d;
            if (j < 0 || j >= dutySequenceWorking.length) return;
            [dutySequenceWorking[i], dutySequenceWorking[j]] = [dutySequenceWorking[j], dutySequenceWorking[i]];
            renderDutySequenceList();
            populateDutyPersonnelOptions();
        }
        async function saveDutySequence() {
            if (!canPersonnelAction('duty', 'edit')) return customAlert('You do not have permission to edit Duty Office entries.', 'Permission Denied');
            const saveButton = document.getElementById('dutySequenceSaveBtn');
            if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Saving…'; }
            try {
                const result = await postPersonnelMutation({
                    action: 'save_duty_sequence', sequence: dutySequenceWorking,
                    userName: localStorage.getItem('loggedInUser'),
                    credential: localStorage.getItem('loggedCred') || ''
                });
                dutySequence = Array.isArray(result.sequence) ? result.sequence.slice() : dutySequenceWorking.slice();
                closeDutySequenceModal();
                customAlert('Duty sequence saved successfully.', 'Success');
                renderDutyCalendar(); renderDutyTable();
            } catch (e) { customAlert(e.message || 'Failed to save duty sequence.', 'Error'); }
            finally { if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Save Sequence'; } }
        }

        /* ---------- BMI Monitoring ---------- */
        function classifyBmiNumber(bmiValue) {
            if (bmiValue == null || String(bmiValue).trim() === '') return '';
            const bmi = Number(bmiValue);
            if (!Number.isFinite(bmi)) return '';
            if (bmi < 18.5) return 'Underweight (UW)';
            // SPADES rule: BMI results strictly above 25.00 are Overweight (OW).
            if (bmi > 25.0) return 'Overweight (OW)';
            return 'Normal (N)';
        }
        function getPnpBmiLimits(age) {
            const a = Number(age);
            if (!Number.isFinite(a) || a < 0) return null;
            // Age bands and upper BMI limits transcribed from the supplied PNP workbook.
            const maxBmi = a < 29 ? 24.9 : a <= 34 ? 25 : a <= 39 ? 25.5 : a <= 44 ? 26 : a <= 50 ? 26.5 : 27;
            return { minBmi: 18.5, maxBmi };
        }
        function computeBmiStandards(heightCm, weightKg, age) {
            const h = Number(heightCm), w = Number(weightKg), limits = getPnpBmiLimits(age);
            if (!Number.isFinite(h) || h <= 0 || !Number.isFinite(w) || w < 0 || !limits) return {minIdeal:'', maxAcceptable:'', weightToLose:''};
            const h2 = (h / 100) ** 2;
            const minIdeal = limits.minBmi * h2;
            const maxAcceptable = limits.maxBmi * h2;
            return {
                minIdeal: Math.round(minIdeal * 100) / 100,
                maxAcceptable: Math.round(maxAcceptable * 100) / 100,
                weightToLose: Math.round(Math.max(0, w - maxAcceptable) * 100) / 100
            };
        }
        function computeBmiClient(heightCm, weightKg, age) {
            // BMI = weight (kg) / height (m)^2. Classification uses the rounded
            // result shown in the BMI Result column so both columns stay consistent.
            const h = Number(heightCm), w = Number(weightKg);
            if (!h || !w || h <= 0 || w <= 0) return {bmi:'', classification:''};
            const bmi = Math.round((w / ((h/100)*(h/100))) * 100) / 100;
            return {bmi:bmi, classification:classifyBmiNumber(bmi)};
        }
        function normalizeBmiRecordForDisplay(record) {
            const rec = record || {};
            const computed = computeBmiClient(rec.height, rec.weight, rec.age);
            if (computed.bmi !== '') {
                return Object.assign({}, rec, {
                    bmiResult: computed.bmi,
                    bmiClassification: computed.classification,
                    ...computeBmiStandards(rec.height, rec.weight, rec.age)
                });
            }
            // Fallback for legacy rows that contain a BMI Result but lack usable
            // height/weight values. Prefer recalculating the classification from
            // that displayed numeric result instead of an obsolete saved label.
            const rawBmi = String(rec.bmiResult == null ? '' : rec.bmiResult).replace(/[^0-9.+-]/g, '');
            const bmiValue = rawBmi ? Number(rawBmi) : NaN;
            const classification = Number.isFinite(bmiValue)
                ? classifyBmiNumber(bmiValue)
                : String(rec.bmiClassification || '');
            return Object.assign({}, rec, {bmiClassification: classification});
        }
        function bmiClassColor(cls) {
            if (!cls) return 'var(--text-muted)';
            if (cls.includes('Underweight')) return '#f59e0b';
            if (cls.includes('Normal')) return 'var(--success)';
            if (cls.includes('Acceptable')) return '#0ea5e9';
            if (cls.includes('Overweight')) return '#f59e0b';
            if (cls.includes('Obese I')) return '#f97316';
            if (cls.includes('Obese II')) return '#ef4444';
            if (cls.includes('Obese III')) return '#b91c1c';
            return 'var(--text-muted)';
        }
        async function loadBmiRecords() {
            let loaded = true;
            try {
                const res = await spadesAuthenticatedRead('get_bmi_records');
                if (!res.ok) throw new Error(`Request failed (${res.status})`);
                const data = await res.json();
                if (!data || data.success !== true || !Array.isArray(data.records)) throw new Error((data && data.error) || 'Invalid BMI response');
                bmiRecords = data.records.map(normalizeBmiRecordForDisplay);
            } catch (e) {
                loaded = false;
                console.warn('BMI records could not be loaded:', e);
                bmiRecords = [];
            }
            populateBmiPeriods();
            renderBmiTable();
            return loaded;
        }
        function currentBmiPeriod() {
            // Keep the browser period identical to Apps Script, which stores BMI
            // periods in Asia/Manila. This avoids month-boundary mismatches when
            // a workstation/browser is configured for another timezone.
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit'
            }).formatToParts(new Date());
            const year = parts.find(part => part.type === 'year')?.value || '';
            const month = parts.find(part => part.type === 'month')?.value || '';
            return year && month ? `${year}-${month}` : '';
        }
        function selectedBmiPeriod() {
            const sel = document.getElementById('bmiPeriodSelect');
            return sel && sel.value ? sel.value : currentBmiPeriod();
        }
        function populateBmiPeriods() {
            const sel = document.getElementById('bmiPeriodSelect');
            if (!sel) return;
            const current = currentBmiPeriod();
            const previous = sel.value;
            const periods = [...new Set((bmiRecords || []).map(r => String(r.period || '').trim()).filter(v => /^\d{4}-\d{2}$/.test(v)))];
            if (!periods.includes(current)) periods.push(current);
            periods.sort((a,b) => b.localeCompare(a));
            const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            sel.innerHTML = periods.map(period => {
                const [year, month] = period.split('-');
                return `<option value="${period}">${monthNames[Number(month)-1]} ${year}${period === current ? ' (Current)' : ''}</option>`;
            }).join('');
            sel.value = periods.includes(previous) ? previous : current;
            sel.disabled = false;
            const mode = document.getElementById('bmiViewMode');
            if (mode) { mode.value = 'monthly'; mode.disabled = true; mode.style.display = 'none'; }
        }
        function renderBmiTable() {
            const tbody = document.getElementById('bmiTableBody');
            const summary = document.getElementById('bmiClassificationSummary');
            if (!tbody) return;
            populateBmiPeriods();
            // Populate autocomplete suggestions so the search automatically
            // displays matching personnel names as you type.
            (function(){
                const dl = document.getElementById('bmiSearchSuggestions');
                if (!dl) return;
                const seen = {};
                const opts = [];
                allPersonnel.forEach(p => {
                    const s = String(p.section || '').trim().toLowerCase();
                    if (s === 'detached service') return;
                    const n = personnelFullName(p);
                    if (n && !seen[n]) { seen[n] = true; opts.push('<option value="' + escapeAttr(n) + '">'); }
                });
                dl.innerHTML = opts.join('');
            })();
            const periodSel = document.getElementById('bmiPeriodSelect');
            const modeSel = document.getElementById('bmiViewMode');
            const period = selectedBmiPeriod();
            const mode = 'monthly';

            const can = canPersonnelAction('bmi', 'add') || canPersonnelAction('bmi', 'edit') || canPersonnelAction('bmi', 'delete');
            const dlBtn = document.getElementById('bmiDownloadBtn');
            if (dlBtn) dlBtn.style.display = can ? '' : 'none';

            // Filter BMI records by the selected period.
            let filteredRecords = bmiRecords.slice();
            if (period) {
                if (mode === 'yearly') filteredRecords = filteredRecords.filter(r => String(r.period || '').trim().startsWith(period));
                else filteredRecords = filteredRecords.filter(r => String(r.period || '').trim() === period);
            }

            const recordMap = new Map();
            filteredRecords.forEach(r => {
                const key = [r.rank, r.lastName, r.firstName, r.middleName, r.qualifiers].map(s => String(s || '').trim()).join('|');
                if (!recordMap.has(key) || String(r.period || '') > String(recordMap.get(key).period || '')) recordMap.set(key, r);
            });

            const classCounts = {};
            recordMap.forEach(r => { const normalized = normalizeBmiRecordForDisplay(r); const c = normalized.bmiClassification || 'Unclassified'; classCounts[c] = (classCounts[c] || 0) + 1; });
            const periodLabel = period ? (() => {
                if (mode === 'yearly') return period;
                const [yy, mm] = period.split('-');
                const mN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                return `${mN[Number(mm)-1] || period} ${yy}`;
            })() : (() => { const [yy, mm] = currentBmiPeriod().split('-'); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(mm)-1]} ${yy}`; })();
            if (summary) {
                const chips = Object.keys(classCounts).sort().map(c =>
                    `<span class="bmi-class-chip" style="border-color:${bmiClassColor(c)};color:${bmiClassColor(c)};">${escapeHtml(c)}: <strong>${classCounts[c]}</strong></span>`
                ).join('');
                summary.innerHTML = `<span style="display:inline-block;margin-right:10px;font-size:12px;color:var(--text-muted);">Viewing: <strong style="color:var(--primary);">${escapeHtml(periodLabel)}</strong> — ${recordMap.size} record(s)</span>` +
                    (chips || '<span style="font-size:12px;color:var(--text-muted);">No BMI records encoded yet for the selected period.</span>');
            }

            const rankOrder = { "PBGEN":1,"PCOL":2,"PLTCOL":3,"PMAJ":4,"PCPT":5,"PLT":6,"PEMS":7,"PCMS":8,"PSMS":9,"PMSG":10,"PSSG":11,"PCPL":12,"PAT":13,"NUP":14 };
            let personnel = allPersonnel
                .map((p, origIdx) => ({ p: p, origIdx: origIdx }))
                .filter(x => {
                    const s = String(x.p.section || '').trim().toLowerCase();
                    return s !== 'detached service';
                })
                .sort((a, b) => {
                    const va = rankOrder[String(a.p.rank || '').trim().toUpperCase()] || 99;
                    const vb = rankOrder[String(b.p.rank || '').trim().toUpperCase()] || 99;
                    if (va !== vb) return va - vb;
                    return String(a.p.lastName || '').localeCompare(String(b.p.lastName || ''));
                });

            // Recapitulation: BMI Classification by Rank (matrix).
            const rankRecap = document.getElementById('bmiRankRecap');
            if (rankRecap) {
                const classOrder = ['Underweight (UW)','Normal (N)','Acceptable BMI (ABMI)','Overweight (OW)','Obese I (OB 1)','Obese II (OB 2)','Obese III (OB 3)'];
                const rankMatrix = {};
                personnel.forEach(x => {
                    const p = x.p;
                    const rank = String(p.rank || 'Unspecified').trim() || 'Unspecified';
                    const key = [p.rank, p.lastName, p.firstName, p.middleName, p.qualifiers].map(s => String(s || '').trim()).join('|');
                    const rec = recordMap.get(key) || null;
                    const cls = rec ? (normalizeBmiRecordForDisplay(rec).bmiClassification || 'Not encoded') : 'Not encoded';
                    if (!rankMatrix[rank]) rankMatrix[rank] = {};
                    rankMatrix[rank][cls] = (rankMatrix[rank][cls] || 0) + 1;
                });
                const allClasses = classOrder.concat(['Not encoded']);
                const sortRank = (a,b) => (rankOrder[a.toUpperCase()]||99) - (rankOrder[b.toUpperCase()]||99) || a.localeCompare(b);
                let html = '<div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">Recapitulation by BMI Classification × Rank</div><div style="overflow-x:auto;border:1px solid var(--border-color);border-radius:var(--radius-sm);"><table class="data-table bmi-rank-matrix"><thead><tr><th style="padding:6px 8px;">Rank</th>';
                allClasses.forEach(c => { const short = c.replace(/\s*\([^)]*\)/,''); html += `<th style="padding:6px 6px;font-size:11px;" title="${escapeAttr(c)}">${escapeHtml(short)}</th>`; });
                html += '<th style="padding:6px 8px;">Total</th></tr></thead><tbody>';
                Object.keys(rankMatrix).sort(sortRank).forEach(rank => {
                    html += `<tr><td style="padding:6px 8px;font-weight:700;">${escapeHtml(rank)}</td>`;
                    let total = 0;
                    allClasses.forEach(c => { const n = rankMatrix[rank][c] || 0; total += n; html += `<td style="padding:6px;text-align:center;font-size:12px;">${n || ''}</td>`; });
                    html += `<td style="padding:6px 8px;text-align:center;font-weight:700;color:var(--primary);">${total}</td></tr>`;
                });
                html += '</tbody></table></div>';
                rankRecap.innerHTML = html;
            }

            // Search filter
            const searchQ = document.getElementById('bmiSearchInput') ? String(document.getElementById('bmiSearchInput').value).toLowerCase().trim() : '';
            if (searchQ) {
                personnel = personnel.filter(x => personnelFullName(x.p).toLowerCase().includes(searchQ) || String(x.p.section||'').toLowerCase().includes(searchQ));
            }

            if (!personnel.length) {
                tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;color:var(--text-muted);padding:20px;">No personnel records found.</td></tr>`;
                return;
            }

            // Group by section with header rows
            const sections = new Map();
            personnel.forEach(x => {
                const sec = String(x.p.section || '').trim() || 'Unspecified';
                if (!sections.has(sec)) sections.set(sec, []);
                sections.get(sec).push(x);
            });
            const sectionOrder = ['Admin Section','General Services Section','Special Services Band','Base Police'];
            const orderedSecs = [];
            sectionOrder.forEach(name => {
                const actual = [...sections.keys()].find(k => k.toLowerCase() === name.toLowerCase());
                if (actual) orderedSecs.push(actual);
            });
            [...sections.keys()].filter(k => !orderedSecs.includes(k)).sort().forEach(k => orderedSecs.push(k));

            let rowNo = 1;
            const htmlRows = [];
            orderedSecs.forEach(sec => {
                htmlRows.push(`<tr class="bmi-section-header"><td colspan="14">${escapeHtml(sec)} — ${sections.get(sec).length} personnel</td></tr>`);
                sections.get(sec).forEach(x => {
                    const p = x.p;
                    const key = [p.rank, p.lastName, p.firstName, p.middleName, p.qualifiers].map(s => String(s || '').trim()).join('|');
                    const storedRec = recordMap.get(key) || null;
                    const rec = storedRec ? normalizeBmiRecordForDisplay(storedRec) : null;
                    const fullName = personnelFullName(p);
                    const currentPeriodRecord = bmiRecords.find(r => personnelFullName(r) === fullName && String(r.period || '').trim() === currentBmiPeriod());
                    // Alpha Admin-granted BMI permissions control access. Do not
                    // restrict authorized editors to records they originally encoded.
                    const canEditThisBmi = currentPeriodRecord
                        ? canPersonnelAction('bmi', 'edit')
                        : (canPersonnelAction('bmi', 'add') || (!!rec && canPersonnelAction('bmi', 'edit')));
                    const nameCell = canEditThisBmi
                        ? `<td><span class="bmi-name-link" onclick="openBmiModalForPersonnel(${x.origIdx})" title="${rec ? 'Edit your BMI record' : 'Encode BMI record'}">${escapeHtml(fullName)}</span></td>`
                        : `<td>${escapeHtml(fullName)}</td>`;
                    const actionCell = (canPersonnelAction('bmi', 'edit') || canPersonnelAction('bmi', 'delete'))
                        ? (rec
                            ? `<td>${canPersonnelAction('bmi', 'delete') && String(rec.period || '').trim() === currentBmiPeriod() ? `<button class="action-btn delete-btn" style="margin:0;padding:4px 8px;font-size:11px;" onclick="event.stopPropagation();deleteBmiRecord('${escapeAttr(rec.id)}')">Del</button>` : '—'}</td>`
                            : `<td style="color:var(--text-muted);font-size:11px;">—</td>`)
                        : '';
                    htmlRows.push(`<tr>
                        <td>${rowNo++}</td>
                        ${nameCell}
                        <td>${rec ? escapeHtml(rec.age || '') : ''}</td>
                        <td>${rec ? escapeHtml(rec.height || '') : ''}</td>
                        <td>${rec ? escapeHtml(rec.weight || '') : ''}</td>
                        <td>${rec ? escapeHtml(rec.waist || '') : ''}</td>
                        <td>${rec ? escapeHtml(rec.hip || '') : ''}</td>
                        <td>${rec ? escapeHtml(rec.wrist || '') : ''}</td>
                        <td><strong>${rec ? escapeHtml(rec.bmiResult || '') : ''}</strong></td>
                        <td style="color:${rec ? bmiClassColor(rec.bmiClassification) : 'var(--text-muted)'};font-weight:600;">${rec ? escapeHtml(rec.bmiClassification || '') : '<span style="font-size:11px;font-weight:400;">Not encoded</span>'}</td>
                        <td>${rec && rec.minIdeal !== '' ? Number(rec.minIdeal).toFixed(2) : ''}</td>
                        <td>${rec && rec.maxAcceptable !== '' ? Number(rec.maxAcceptable).toFixed(2) : ''}</td>
                        <td>${rec && rec.weightToLose !== '' ? Number(rec.weightToLose).toFixed(2) : ''}</td>
                        ${actionCell}
                    </tr>`);
                });
            });
            tbody.innerHTML = htmlRows.join('');
        }

        function downloadBmiExcel() {
            const periodSel = document.getElementById('bmiPeriodSelect');
            const modeSel = document.getElementById('bmiViewMode');
            const period = selectedBmiPeriod();
            const mode = 'monthly';
            let filteredRecords = bmiRecords.slice();
            if (period) {
                if (mode === 'yearly') filteredRecords = filteredRecords.filter(r => String(r.period || '').trim().startsWith(period));
                else filteredRecords = filteredRecords.filter(r => String(r.period || '').trim() === period);
            }
            const recordMap = new Map();
            filteredRecords.forEach(r => {
                const key = [r.rank, r.lastName, r.firstName, r.middleName, r.qualifiers].map(s => String(s || '').trim()).join('|');
                if (!recordMap.has(key) || String(r.period || '') > String(recordMap.get(key).period || '')) recordMap.set(key, r);
            });
            const rankOrder = { "PBGEN":1,"PCOL":2,"PLTCOL":3,"PMAJ":4,"PCPT":5,"PLT":6,"PEMS":7,"PCMS":8,"PSMS":9,"PMSG":10,"PSSG":11,"PCPL":12,"PAT":13,"NUP":14 };
            const personnel = allPersonnel
                .filter(p => {
                    const s = String(p.section || '').trim().toLowerCase();
                    return s !== 'detached service';
                })
                .sort((a, b) => (rankOrder[String(a.rank||'').toUpperCase()]||99) - (rankOrder[String(b.rank||'').toUpperCase()]||99) || String(a.lastName||'').localeCompare(String(b.lastName||'')));
            const escCsv = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
            // Group personnel by section with the same ordering used on-screen so the
            // downloaded Excel/CSV carries the same section separation tables.
            const sections = new Map();
            personnel.forEach(p => {
                const sec = String(p.section || '').trim() || 'Unspecified';
                if (!sections.has(sec)) sections.set(sec, []);
                sections.get(sec).push(p);
            });
            const sectionOrder = ['Admin Section','General Services Section','Special Services Band','Base Police'];
            const orderedSecs = [];
            sectionOrder.forEach(name => {
                const actual = [...sections.keys()].find(k => k.toLowerCase() === name.toLowerCase());
                if (actual) orderedSecs.push(actual);
            });
            [...sections.keys()].filter(k => !orderedSecs.includes(k)).sort().forEach(k => orderedSecs.push(k));

            let csv = '\uFEFFNo.,Section,Rank/Full Name,Age,Height (cm),Weight (kg),Waist (cm),Hip (cm),Wrist (cm),BMI Result,BMI Classification,Minimum Ideal Body Weight (kg),Maximum PNP Acceptable BMI (kg),Weight to Lose (kg)\n';
            let rowNo = 1;
            orderedSecs.forEach(sec => {
                const group = sections.get(sec);
                csv += `${escCsv(sec + ' — ' + group.length + ' personnel')},,,,,,,,,,\n`;
                group.forEach(p => {
                    const key = [p.rank, p.lastName, p.firstName, p.middleName, p.qualifiers].map(s => String(s || '').trim()).join('|');
                    const storedRec = recordMap.get(key) || null;
                    const rec = storedRec ? normalizeBmiRecordForDisplay(storedRec) : null;
                    const limits = rec ? computeBmiStandards(rec.height, rec.weight, rec.age) : {minIdeal:'',maxAcceptable:'',weightToLose:''};
                    csv += `${rowNo},${escCsv(p.section||'')},${escCsv(personnelFullName(p))},${rec?rec.age:''},${rec?rec.height:''},${rec?rec.weight:''},${rec?rec.waist:''},${rec?rec.hip:''},${rec?rec.wrist:''},${rec?rec.bmiResult:''},${escCsv(rec?rec.bmiClassification:'')},${limits.minIdeal},${limits.maxAcceptable},${limits.weightToLose}\\n`;
                    rowNo++;
                });
            });
            const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `BMI_Records_${period || 'AllPeriods'}.csv`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            customAlert("BMI data downloaded (Excel-compatible CSV).", "Downloaded");
        }

        function openBmiModalForPersonnel(origIdx) {
            if (!allPersonnel || !allPersonnel.length) { loadPersonnel(); customAlert("Personnel data is still loading. Please try again in a moment.", "Loading"); return; }
            const p = allPersonnel[Number(origIdx)];
            if (!p) return;
            const period = currentBmiPeriod();
            const viewedPeriod = selectedBmiPeriod();
            const pKey = personnelFullName(p);
            const candidates = bmiRecords.filter(r => personnelFullName(r) === pKey)
                .sort((a, b) => String(b.period || '').localeCompare(String(a.period || '')));
            // Current-month data takes precedence. Otherwise, the record from the
            // month currently being viewed (or the latest historical record) is used
            // as a template. Saving always writes to the current month, preserving
            // the historical source row.
            const currentRecord = candidates.find(r => String(r.period || '').trim() === period) || null;
            const viewedRecord = candidates.find(r => String(r.period || '').trim() === viewedPeriod) || null;
            const seedRecord = currentRecord || viewedRecord || candidates[0] || null;
            const permissionRecord = currentRecord || viewedRecord || seedRecord;
            const requiredOperation = currentRecord ? 'edit' : (permissionRecord ? 'edit' : 'add');
            if (!canPersonnelAction('bmi', requiredOperation) && !(requiredOperation === 'edit' && canPersonnelAction('bmi', 'add'))) {
                customAlert(`You do not have permission to ${requiredOperation} BMI records.`, 'Permission Denied');
                return;
            }
            // Only attach an ID when editing an existing current-month row. A historical
            // record is a template for a new current-month entry and must remain untouched.
            bmiEditingId = currentRecord ? currentRecord.id : null;
            document.getElementById('bmiModalTitle').innerText = currentRecord ? 'Edit Current Month BMI Record' : 'Create Current Month Entry from Selected Record';
            const sel = document.getElementById('bmiPersonnelSelect');
            sel.innerHTML = '<option value="">Select personnel...</option>' + allPersonnel.map((pp, i) =>
                `<option value="${i}">${escapeHtml(personnelFullName(pp))}</option>`).join('');
            sel.value = String(origIdx);
            const bmiLbl = document.getElementById('bmiPersonnelSelectedLabel');
            if (bmiLbl) { bmiLbl.style.display = 'block'; bmiLbl.innerText = 'Selected: ' + pKey; }
            const bmiSrch = document.getElementById('bmiPersonnelSearch'); if (bmiSrch) bmiSrch.value = '';
            const bmiFlt = document.getElementById('bmiPersonnelSectionFilter'); if (bmiFlt) bmiFlt.value = '';
            renderBmiPersonnelList();
            ['bmiAge','bmiHeight','bmiWeight','bmiWaist','bmiHip','bmiWrist'].forEach(id => {
                const el = document.getElementById(id);
                const key = id.replace('bmi','').toLowerCase();
                if (el) el.value = seedRecord && seedRecord[key] !== null && seedRecord[key] !== undefined ? String(seedRecord[key]) : '';
            });
            // Explicitly pin the form to this month, never the historical seed period.
            document.getElementById('bmiPeriodInput').value = period;
            document.getElementById('bmiPeriodInput').readOnly = true;
            recalcBmi();
            document.getElementById('bmiRecordModal').classList.remove('hidden');
        }

        function recalcBmi() {
            const h = document.getElementById('bmiHeight').value;
            const w = document.getElementById('bmiWeight').value;
            const age = document.getElementById('bmiAge') ? document.getElementById('bmiAge').value : '';
            const res = computeBmiClient(h, w, age);
            const rEl = document.getElementById('bmiResultPreview');
            const cEl = document.getElementById('bmiClassPreview');
            if (rEl) rEl.innerText = res.bmi !== '' ? res.bmi : '—';
            if (cEl) { cEl.innerText = res.classification || '—'; cEl.style.color = bmiClassColor(res.classification); }
            const standards = computeBmiStandards(h, w, age);
            const previewMap = {bmiMinIdealPreview: standards.minIdeal, bmiMaxAcceptablePreview: standards.maxAcceptable, bmiWeightLosePreview: standards.weightToLose};
            Object.keys(previewMap).forEach(id => { const el = document.getElementById(id); if (el) el.textContent = previewMap[id] === '' ? '—' : Number(previewMap[id]).toFixed(2) + ' kg'; });
        }
        function openBmiModal(editId) {
            const selectedRecord = editId ? bmiRecords.find(r => String(r.id) === String(editId)) : null;
            if (editId && !selectedRecord) {
                customAlert('The selected BMI record could not be found. Please refresh the table.', 'Record Not Found');
                return;
            }

            // A historical row is a read-only source for the current month. If a
            // current-month row already exists for the same personnel member,
            // open that row for editing instead of attempting a duplicate add.
            const currentPeriod = currentBmiPeriod();
            const selectedPersonName = selectedRecord ? personnelFullName(selectedRecord) : '';
            const selectedIsCurrent = !!(selectedRecord && String(selectedRecord.period || '').trim() === currentPeriod);
            const matchingCurrentRecord = selectedRecord && !selectedIsCurrent
                ? bmiRecords.find(r => personnelFullName(r) === selectedPersonName && String(r.period || '').trim() === currentPeriod) || null
                : null;
            const currentRecord = selectedIsCurrent ? selectedRecord : matchingCurrentRecord;
            const seedRecord = currentRecord || selectedRecord || null;
            const operation = currentRecord ? 'edit' : 'add';

            if (!canPersonnelAction('bmi', operation)) {
                customAlert(`You do not have permission to ${operation} BMI records.`, 'Permission Denied');
                return;
            }
            if (!allPersonnel || !allPersonnel.length) {
                loadPersonnel();
                customAlert('Personnel data is still loading. Please try again in a moment.', 'Loading');
                return;
            }

            // Only a current-month row receives an editing ID. Historical rows
            // remain untouched and can only seed a separate current-month entry.
            bmiEditingId = currentRecord ? currentRecord.id : null;
            document.getElementById('bmiModalTitle').innerText = currentRecord
                ? 'Edit Current Month BMI Record'
                : (selectedRecord ? 'Create Current Month Entry from Historical Record' : 'Add BMI Record');

            const sel = document.getElementById('bmiPersonnelSelect');
            sel.innerHTML = '<option value="">Select personnel...</option>' + allPersonnel.map((p, i) =>
                `<option value="${i}">${escapeHtml(personnelFullName(p))}</option>`).join('');

            // Reset the form before applying the selected/current record values.
            ['bmiAge','bmiHeight','bmiWeight','bmiWaist','bmiHip','bmiWrist'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            const selectedLabel = document.getElementById('bmiPersonnelSelectedLabel');
            if (selectedLabel) { selectedLabel.style.display = 'none'; selectedLabel.innerText = ''; }
            const searchInput = document.getElementById('bmiPersonnelSearch');
            if (searchInput) searchInput.value = '';
            const sectionFilter = document.getElementById('bmiPersonnelSectionFilter');
            if (sectionFilter) sectionFilter.value = '';
            if (sel) sel.value = '';
            renderBmiPersonnelList();

            if (seedRecord) {
                const idx = allPersonnel.findIndex(p => personnelFullName(p) === selectedPersonName);
                if (idx >= 0 && sel) sel.value = String(idx);
                if (selectedLabel) {
                    selectedLabel.style.display = 'block';
                    selectedLabel.innerText = 'Selected: ' + selectedPersonName;
                }
                ['age','height','weight','waist','hip','wrist'].forEach(key => {
                    const el = document.getElementById('bmi' + key.charAt(0).toUpperCase() + key.slice(1));
                    if (el) el.value = seedRecord[key] ?? '';
                });
                renderBmiPersonnelList();
            }

            const periodInput = document.getElementById('bmiPeriodInput');
            if (periodInput) {
                periodInput.value = currentPeriod;
                periodInput.readOnly = true;
            }
            recalcBmi();
            document.getElementById('bmiRecordModal').classList.remove('hidden');
        }
        function editBmiRecord(id) { openBmiModal(id); }
        function closeBmiModal() { document.getElementById('bmiRecordModal').classList.add('hidden'); bmiEditingId = null; }
        function renderBmiPersonnelList() {
            const list = document.getElementById('bmiPersonnelList');
            if (!list) return;
            const q = (document.getElementById('bmiPersonnelSearch') ? document.getElementById('bmiPersonnelSearch').value : '').toLowerCase().trim();
            const secFilter = (document.getElementById('bmiPersonnelSectionFilter') ? document.getElementById('bmiPersonnelSectionFilter').value : '').toLowerCase();
            const secSel = document.getElementById('bmiPersonnelSectionFilter');
            if (secSel && secSel.options.length <= 1) {
                const sections = [...new Set(allPersonnel.map(p => String(p.section || '').trim()).filter(Boolean))].sort();
                secSel.innerHTML = '<option value="">All Sections</option>' + sections.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
            }
            const sel = document.getElementById('bmiPersonnelSelect');
            const selectedIdx = sel ? sel.value : '';
            let count = 0;
            let html = '';
            allPersonnel.forEach((p, i) => {
                const sec = String(p.section || '').trim() || 'Unspecified';
                if (secFilter && sec.toLowerCase() !== secFilter) return;
                const name = personnelFullName(p);
                if (q && !name.toLowerCase().includes(q)) return;
                count++;
                const active = String(i) === selectedIdx;
                html += `<div class="bmi-personnel-item${active ? ' selected' : ''}" data-idx="${i}" onclick="selectBmiPersonnel(${i})">
                    <span class="bmi-personnel-name">${escapeHtml(name)}</span>
                    <span class="bmi-personnel-sec">${escapeHtml(sec)}</span>
                </div>`;
            });
            list.innerHTML = html || '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:14px;">No personnel found.</div>';
            if (selectedIdx !== '') {
                const el = list.querySelector('[data-idx="' + selectedIdx + '"]');
                if (el) el.scrollIntoView({ block: 'nearest' });
            }
        }
        function selectBmiPersonnel(idx) {
            const sel = document.getElementById('bmiPersonnelSelect');
            if (sel) sel.value = String(idx);
            const p = allPersonnel[Number(idx)];
            const label = document.getElementById('bmiPersonnelSelectedLabel');
            if (label && p) { label.style.display = 'block'; label.innerText = 'Selected: ' + personnelFullName(p); }
            renderBmiPersonnelList();
            fillBmiPersonnelDetails();
        }
        function fillBmiPersonnelDetails() { /* personnel selected from list; fields remain manual entry */ }
        async function saveBmiRecord() {
            const operation = bmiEditingId ? 'edit' : 'add';
            if (!canPersonnelAction('bmi', operation)) return customAlert(`You do not have permission to ${operation} BMI records.`, 'Permission Denied');
            const selIdx = document.getElementById('bmiPersonnelSelect').value;
            const period = currentBmiPeriod();
            const periodInput = document.getElementById('bmiPeriodInput');
            if (periodInput) { periodInput.value = period; periodInput.readOnly = true; }
            if (selIdx === '' || !period) { customAlert('Please select personnel and a period.', 'Validation'); return; }
            const p = allPersonnel[Number(selIdx)];
            if (!p) { customAlert('Select a valid personnel record.', 'Validation'); return; }
            const payload = {
                action: 'save_bmi_record', id: bmiEditingId || undefined, period,
                rank: p.rank, lastName: p.lastName, firstName: p.firstName,
                middleName: p.middleName, qualifiers: p.qualifiers,
                age: document.getElementById('bmiAge').value,
                height: document.getElementById('bmiHeight').value,
                weight: document.getElementById('bmiWeight').value,
                waist: document.getElementById('bmiWaist').value,
                hip: document.getElementById('bmiHip').value,
                wrist: document.getElementById('bmiWrist').value,
                userName: localStorage.getItem('loggedInUser'),
                credential: localStorage.getItem('loggedCred') || ''
            };
            if (!payload.height || !payload.weight) { customAlert('Height and Weight are required for BMI calculation.', 'Validation'); return; }
            const saveButton = document.querySelector('#bmiRecordModal .approve-btn');
            if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Saving…'; }
            try {
                const saveResult = await postPersonnelMutation(payload);
                closeBmiModal();
                // After an edit, show the current month so the updated in-place
                // record is immediately visible in the BMI Monitoring table.
                const periodSelect = document.getElementById('bmiPeriodSelect');
                if (periodSelect) periodSelect.value = currentBmiPeriod();
                customAlert(saveResult && saveResult.updated
                    ? 'Current-month BMI record updated successfully. The existing record was replaced; no duplicate was created.'
                    : 'BMI record saved. BMI result and classification were computed automatically.', 'Success');
                await loadBmiRecords();
            } catch (e) { customAlert(e.message || 'Failed to save BMI record.', 'Error'); }
            finally { if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Save Record'; } }
        }
        function deleteBmiRecord(id) {
            if (!canPersonnelAction('bmi', 'delete')) return customAlert('You do not have permission to delete BMI records.', 'Permission Denied');
            customConfirm('Delete this BMI record?', async confirmed => {
                if (!confirmed) return;
                try {
                    await postPersonnelMutation({action:'delete_bmi_record', id, userName:localStorage.getItem('loggedInUser'), credential:localStorage.getItem('loggedCred') || ''});
                    customAlert('BMI record deleted.', 'Success');
                    await loadBmiRecords();
                } catch (e) { customAlert(e.message || 'Failed to delete BMI record.', 'Error'); }
            });
        }
        /* ---------- Squadding ---------- */
        async function loadSquads() {
            let loaded = true;
            try {
                const res = await spadesAuthenticatedRead('get_squads');
                if (!res.ok) throw new Error(`Request failed (${res.status})`);
                const data = await res.json();
                if (!data || data.success !== true || !Array.isArray(data.squads)) throw new Error((data && data.error) || 'Invalid Squadding response');
                squads = data.squads;
                // Defensive UI filter: archived personnel should never remain visible in a squad.
                const key = value => String(value || '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
                const archivedFull = new Set((archivedPersonnel || []).map(p => key(personnelFullName(p))));
                const archivedShort = new Set((archivedPersonnel || []).map(p => key(personnelShortName(p))));
                squads = squads.map(s => ({...s,
                    squadLeader: archivedShort.has(key(s.squadLeader)) ? '' : s.squadLeader,
                    members: (Array.isArray(s.members) ? s.members : []).filter(m => !archivedFull.has(key(personnelFullName(m))))
                }));
            } catch (e) {
                loaded = false;
                console.warn('Squad data could not be loaded:', e);
                squads = [];
            }
            renderSquadCarousel();
            return loaded;
        }
        function renderSquadCarousel() {
            const container = document.getElementById('squadCarousel');
            if (!container) return;
            if (!squads.length) {
                container.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px;">No squads created yet.${canPersonnelAction('squad','add')?' Click "Create Squad" to group personnel.':''}</div>`;
                return;
            }
            const canEditSquad = canPersonnelAction('squad', 'edit');
            const canDeleteSquad = canPersonnelAction('squad', 'delete');
            container.innerHTML = squads.map(s => {
                const totalCount = (s.members ? s.members.length : 0) + (s.squadLeader ? 1 : 0);
                const membersHtml = s.members.length
                    ? s.members.map(m => `<div class="squad-member-chip">${escapeHtml([m.rank,m.lastName].filter(Boolean).join(' '))}</div>`).join('')
                    : '<span style="font-size:12px;color:var(--text-muted);">No members assigned.</span>';
                const actions = (canEditSquad || canDeleteSquad) ? `<div style="margin-top:10px;display:flex;gap:6px;">
                    ${(canEditSquad && isCurrentUserRecordOwner(s.createdBy)) ? `<button class="action-btn" style="margin:0;padding:4px 10px;font-size:11px;flex:1;" onclick="event.stopPropagation();editSquad('${escapeAttr(s.squadId)}')">Edit</button>` : ''}
                    ${canDeleteSquad ? `<button class="action-btn delete-btn" style="margin:0;padding:4px 10px;font-size:11px;flex:1;" onclick="event.stopPropagation();deleteSquad('${escapeAttr(s.squadId)}')">Delete</button>` : ''}
                </div>` : '';
                return `<div class="squad-card glass-panel" onclick="openSquadDetails('${escapeAttr(s.squadId)}')" role="button" tabindex="0" aria-label="View ${escapeAttr(s.squadName)} details" style="cursor:pointer;">
                    <div class="squad-card-head">
                        <h4 style="margin:0;color:var(--primary);">${escapeHtml(s.squadName)}</h4>
                        <span class="squad-member-count">${totalCount} member${totalCount===1?'':'s'}</span>
                    </div>
                    <div style="font-size:12px;color:var(--text-muted);margin:6px 0 10px;">Leader: <strong style="color:var(--text-main);">${escapeHtml(s.squadLeader||'Not assigned')}</strong></div>
                    <div style="margin-top:10px;font-size:12px;color:var(--text-muted);">Click card to view full member list</div>
                    ${actions}
                </div>`;
            }).join('');
        }
        function scrollSquadCarousel(dir) {
            const c = document.getElementById('squadCarousel');
            if (c) c.scrollBy({left: Number(dir) * 320, behavior:'smooth'});
        }
        function squaddedPersonnelNames(excludeSquadId) {
            // Full names of personnel already assigned to any squad (optionally excluding one squad being edited).
            // Includes both squad members and the designated squad leader.
            const names = new Set();
            squads.forEach(s => {
                if (excludeSquadId && String(s.squadId) === String(excludeSquadId)) return;
                (s.members || []).forEach(m => names.add(personnelFullName(m)));
                if (s.squadLeader) {
                    const leaderP = allPersonnel.find(p => personnelShortName(p) === String(s.squadLeader || '').trim());
                    if (leaderP) names.add(personnelFullName(leaderP));
                }
            });
            return names;
        }
        function openSquadModal(editId) {
            const operation = editId ? 'edit' : 'add';
            if (!canPersonnelAction('squad', operation)) { customAlert(`You do not have permission to ${operation} Squadding entries.`, "Permission Denied"); return; }
            if (!allPersonnel || !allPersonnel.length) { loadPersonnel(); customAlert("Personnel data is still loading. Please try again in a moment.", "Loading"); return; }

            editingSquadId = editId || null;
            document.getElementById('squadModalTitle').innerText = editId ? 'Edit Squad' : 'Create Squad';
            document.getElementById('squadNameInput').value = '';

            // Populate section filter dropdown
            const secFilter = document.getElementById('squadSectionFilter');
            if (secFilter) {
                const secs = [...new Set(allPersonnel.map(p => String(p.section || '').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
                secFilter.innerHTML = '<option value="">All Sections</option>' + secs.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
            }
            const searchInput = document.getElementById('squadMemberSearch');
            if (searchInput) searchInput.value = '';

            const leaderSel = document.getElementById('squadLeaderSelect');
            leaderSel.innerHTML = '<option value="">Select squad leader...</option>' + allPersonnel.map((p,i) => `<option value="${i}">${escapeHtml(personnelFullName(p))}</option>`).join('');
            leaderSel.onchange = function(){ syncSquadSelectionFromCheckboxes(); renderSquadMemberChecklist(); updateSquadMemberCount(); };

            // When creating a new squad, personnel already in another squad are removed from the available list.
            squadExcludeNames = editId ? null : squaddedPersonnelNames(null);
            squadPreselectedMembers = editId ? [] : null;
            squadEditingLeaderIdx = '';

            if (editId) {
                const s = squads.find(x => String(x.squadId) === String(editId));
                if (s) {
                    document.getElementById('squadNameInput').value = s.squadName || '';
                    // Robustly retain the currently designated squad leader: match by short name (Rank LastName).
                    const leaderShort = String(s.squadLeader || '').trim();
                    let leaderIdx = -1;
                    if (leaderShort) {
                        leaderIdx = allPersonnel.findIndex(p => personnelShortName(p) === leaderShort);
                        if (leaderIdx < 0) {
                            // Fallback: case-insensitive match
                            leaderIdx = allPersonnel.findIndex(p => personnelShortName(p).toLowerCase() === leaderShort.toLowerCase());
                        }
                    }
                    if (leaderIdx >= 0) {
                        leaderSel.value = String(leaderIdx);
                        squadEditingLeaderIdx = String(leaderIdx);
                    }
                    squadPreselectedMembers = s.members || [];
                }
            }
            renderSquadMemberChecklist();
            updateSquadMemberCount();
            document.getElementById('squadModal').classList.remove('hidden');
        }
        function closeSquadModal() { document.getElementById('squadModal').classList.add('hidden'); editingSquadId = null; squadPreselectedMembers = null; squadExcludeNames = null; squadEditingLeaderIdx = ''; }
        function renderSquadMemberChecklist() {
            const wrap = document.getElementById('squadMemberList');
            if (!wrap) return;
            const preNames = squadPreselectedMembers ? squadPreselectedMembers.map(m => personnelFullName(m)) : null;
            const exclude = squadExcludeNames || new Set();

            // Read live filter values
            const searchQ = document.getElementById('squadMemberSearch') ? String(document.getElementById('squadMemberSearch').value).toLowerCase().trim() : '';
            const secFilter = document.getElementById('squadSectionFilter') ? document.getElementById('squadSectionFilter').value : '';
            // Currently selected leader is excluded from the member checklist to avoid double-counting.
            const leaderSel = document.getElementById('squadLeaderSelect');
            const leaderIdxVal = leaderSel ? leaderSel.value : '';
            const leaderFull = leaderIdxVal !== '' ? personnelFullName(allPersonnel[Number(leaderIdxVal)]) : '';

            let excludedCount = 0;
            const items = [];
            allPersonnel.forEach((p, i) => {
                const full = personnelFullName(p);
                if (exclude.has(full)) { excludedCount++; return; }
                if (leaderFull && full === leaderFull) return;
                if (secFilter && String(p.section || '').trim() !== secFilter) return;
                if (searchQ && !full.toLowerCase().includes(searchQ) && !String(p.section||'').toLowerCase().includes(searchQ)) return;
                const checked = preNames ? preNames.includes(full) : false;
                items.push(`<label class="checklist-item"><input type="checkbox" class="squad-member-cb" value="${i}" ${checked?'checked':''} onchange="updateSquadMemberCount()"> <span>${escapeHtml(full)}</span> <span style="font-size:11px;color:var(--text-muted);">(${escapeHtml(p.section||'—')})</span></label>`);
            });
            const note = excludedCount ? `<div style="font-size:11px;color:var(--text-muted);padding:6px;border-top:1px solid var(--border-color);margin-top:6px;">${excludedCount} personnel already assigned to another squad and excluded from this list.</div>` : '';
            wrap.innerHTML = items.length ? items.join('') + note : '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:10px;">No personnel match the current filters.</div>' + note;
        }
        function renderSquadMemberChecklistFromFilters() { syncSquadSelectionFromCheckboxes(); renderSquadMemberChecklist(); }
        function syncSquadSelectionFromCheckboxes() {
            // Preserve user checkbox selections across filter/search re-renders.
            const visibleCbs = document.querySelectorAll('.squad-member-cb');
            if (!visibleCbs.length) return;
            const visibleIdxs = new Set([...visibleCbs].map(cb => Number(cb.value)));
            const checkedIdxs = new Set([...document.querySelectorAll('.squad-member-cb:checked')].map(cb => Number(cb.value)));
            const kept = (squadPreselectedMembers || []).filter(m => {
                const idx = allPersonnel.findIndex(p => personnelFullName(p) === personnelFullName(m));
                return idx < 0 || !visibleIdxs.has(idx);
            });
            const checked = [...checkedIdxs].map(i => {
                const p = allPersonnel[i];
                return {rank:p.rank, lastName:p.lastName, firstName:p.firstName, middleName:p.middleName, qualifiers:p.qualifiers};
            });
            squadPreselectedMembers = kept.concat(checked);
        }
        function openSquadDetails(squadId) {
            const s = squads.find(x => String(x.areaId || x.squadId) === String(squadId) || String(x.squadId) === String(squadId));
            if (!s) return;
            document.getElementById('squadDetailsTitle').innerText = s.squadName || 'Squad';
            const totalCount = (s.members ? s.members.length : 0) + (s.squadLeader ? 1 : 0);
            document.getElementById('squadDetailsLeader').innerHTML = `Squad Leader: <strong style="color:var(--text-main);">${escapeHtml(s.squadLeader || 'Not assigned')}</strong> &bull; ${totalCount} member${totalCount===1?'':'s'} (incl. leader)`;
            const membersWrap = document.getElementById('squadDetailsMembers');
            if (!s.members || !s.members.length) {
                membersWrap.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No members assigned to this squad.</div>';
            } else {
                membersWrap.innerHTML = s.members.map((m, i) => `<div class="area-personnel-row">
                    <span class="area-personnel-num">${i+1}</span>
                    <span>${escapeHtml(personnelFullName(m))}</span>
                </div>`).join('');
            }
            document.getElementById('squadDetailsEditBtn').style.display = (canPersonnelAction('squad', 'edit') && isCurrentUserRecordOwner(s.createdBy)) ? '' : 'none';
            document.getElementById('squadDetailsDeleteBtn').style.display = canPersonnelAction('squad', 'delete') ? '' : 'none';
            document.getElementById('squadDetailsEditBtn').setAttribute('data-squad-id', s.squadId);
            document.getElementById('squadDetailsDeleteBtn').setAttribute('data-squad-id', s.squadId);
            document.getElementById('squadDetailsModal').classList.remove('hidden');
        }
        function closeSquadDetailsModal() { document.getElementById('squadDetailsModal').classList.add('hidden'); }
        function editSquadFromDetails() {
            const id = document.getElementById('squadDetailsEditBtn').getAttribute('data-squad-id');
            closeSquadDetailsModal();
            openSquadModal(id);
        }
        function deleteSquadFromDetails() {
            if (!canPersonnelAction('squad', 'delete')) return customAlert('You do not have permission to delete Squadding entries.', 'Permission Denied');
            const id = document.getElementById('squadDetailsDeleteBtn').getAttribute('data-squad-id');
            customConfirm('Delete this squad and remove all member assignments?', async confirmed => {
                if (!confirmed) return;
                try {
                    await postPersonnelMutation({action:'delete_squad', squadId:id, userName:localStorage.getItem('loggedInUser'), credential:localStorage.getItem('loggedCred') || ''});
                    closeSquadDetailsModal(); await loadSquads();
                    customAlert('Squad deleted.', 'Success');
                } catch (e) { customAlert(e.message || 'Failed to delete squad.', 'Error'); }
            });
        }
        function updateSquadMemberCount() {
            const cbs = document.querySelectorAll('.squad-member-cb:checked');
            const leaderSel = document.getElementById('squadLeaderSelect');
            const leaderCount = (leaderSel && leaderSel.value !== '') ? 1 : 0;
            const el = document.getElementById('squadMemberCount');
            if (el) el.innerText = cbs.length + leaderCount;
        }
        async function saveSquad() {
            const operation = editingSquadId ? 'edit' : 'add';
            if (!canPersonnelAction('squad', operation)) return customAlert(`You do not have permission to ${operation} Squadding entries.`, 'Permission Denied');
            const name = document.getElementById('squadNameInput').value.trim();
            if (!name) { customAlert('Squad name is required.', 'Validation'); return; }
            syncSquadSelectionFromCheckboxes();
            const leaderIdx = document.getElementById('squadLeaderSelect').value;
            const leader = leaderIdx !== '' ? personnelShortName(allPersonnel[Number(leaderIdx)]) : '';
            const selected = (squadPreselectedMembers || []).map(m => ({rank:m.rank,lastName:m.lastName,firstName:m.firstName,middleName:m.middleName,qualifiers:m.qualifiers}));
            const saveButton = document.querySelector('#squadModal .approve-btn');
            if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Saving…'; }
            try {
                await postPersonnelMutation({
                    action: editingSquadId ? 'update_squad' : 'create_squad',
                    squadId: editingSquadId || undefined, squadName: name, squadLeader: leader, members: selected,
                    userName: localStorage.getItem('loggedInUser'), credential: localStorage.getItem('loggedCred') || ''
                });
                closeSquadModal(); await loadSquads();
                customAlert('Squad saved successfully.', 'Success');
            } catch (e) { customAlert(e.message || 'Failed to save squad.', 'Error'); }
            finally { if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Save Squad'; } }
        }
        function editSquad(id) { if (!canPersonnelAction('squad', 'edit')) return customAlert('You do not have permission to edit Squadding entries.', 'Permission Denied'); const squad = squads.find(s => String(s.squadId) === String(id)); if (!squad || !isCurrentUserRecordOwner(squad.createdBy)) return customAlert('You can edit only squads that you encoded.', 'Permission Denied'); openSquadModal(id); }
        function deleteSquad(id) {
            if (!canPersonnelAction('squad', 'delete')) return customAlert('You do not have permission to delete Squadding entries.', 'Permission Denied');
            customConfirm('Delete this squad and remove all member assignments?', async confirmed => {
                if (!confirmed) return;
                try {
                    await postPersonnelMutation({action:'delete_squad', squadId:id, userName:localStorage.getItem('loggedInUser'), credential:localStorage.getItem('loggedCred') || ''});
                    await loadSquads(); customAlert('Squad deleted.', 'Success');
                } catch (e) { customAlert(e.message || 'Failed to delete squad.', 'Error'); }
            });
        }

        /* ---------- Leave Management ---------- */
        async function loadLeaveEntries() {
            let loaded = true;
            try {
                const res = await spadesAuthenticatedRead('get_leave_entries');
                if (!res.ok) throw new Error(`Request failed (${res.status})`);
                const data = await res.json();
                if (!data || data.success !== true || !Array.isArray(data.entries)) throw new Error((data && data.error) || 'Invalid Leave Management response');
                leaveEntries = data.entries;
            } catch (e) {
                loaded = false;
                console.warn('Leave entries could not be loaded:', e);
                leaveEntries = [];
            }
            renderLeaveCalendar();
            renderLeaveTable();
            return loaded;
        }
        const MAX_LEAVE_PER_DATE = 5;
        function leaveDateCount(dateStr) {
            let c = 0;
            (leaveEntries || []).forEach(e => { if ((e.dates || []).includes(dateStr)) c++; });
            return c;
        }
        function isLeaveDateMaxed(dateStr) { return leaveDateCount(dateStr) >= MAX_LEAVE_PER_DATE; }
        let leavePickerDate = new Date();

        function shortLeaveName(fullName) {
            // Display only Rank + Last Name in the calendar.
            const match = allPersonnel.find(p => personnelFullName(p) === String(fullName || ''));
            if (match) return personnelShortName(match);
            const parts = String(fullName || '').trim().split(/\s+/);
            if (parts.length >= 2) return parts[0] + ' ' + parts[parts.length - 1];
            return String(fullName || '');
        }

        function renderLeaveCalendar() {
            const grid = document.getElementById('leaveCalendarGrid');
            const title = document.getElementById('leaveCalendarTitle');
            if (!grid || !title) return;
            const year = leaveCalendarDate.getFullYear();
            const month = leaveCalendarDate.getMonth();
            const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            title.innerText = `${monthNames[month]} ${year}`;
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            const leaveMap = {};
            leaveEntries.forEach(e => {
                (e.dates || []).forEach(d => {
                    if (!leaveMap[d]) leaveMap[d] = [];
                    leaveMap[d].push(e);
                });
            });
            let html = dayNames.map(d => `<div class="duty-cal-day duty-cal-head">${d}</div>`).join('');
            for (let i = 0; i < firstDay; i++) html += '<div class="duty-cal-day duty-cal-empty"></div>';
            for (let d = 1; d <= daysInMonth; d++) {
                const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                const leaves = leaveMap[dateStr] || [];
                const isToday = new Date(year, month, d).toDateString() === new Date().toDateString();
                const maxed = leaves.length >= MAX_LEAVE_PER_DATE;
                // Calendar shows only Rank + Last Name, max 5 list per date.
                const shown = leaves.slice(0, MAX_LEAVE_PER_DATE).map(l => escapeHtml(shortLeaveName(l.personnelName))).join(', ');
                const extra = leaves.length > MAX_LEAVE_PER_DATE ? ` +${leaves.length - MAX_LEAVE_PER_DATE}` : '';
                const leaveLabel = leaves.length ? shown + extra : '';
                const tooltip = leaves.length ? leaves.map(l => `${l.personnelName} — ${l.leaveType}${l.otherType?' ('+l.otherType+')':''}`).join('\n') : '';
                html += `<div class="duty-cal-day ${leaves.length?'leave-cal-has-leave':''} ${maxed?'leave-cal-max':''} ${isToday?'duty-cal-today':''}" title="${escapeAttr(tooltip)}">
                    <div class="duty-cal-date">${d}${maxed?` <span style="color:var(--danger);font-size:9px;">(MAX)</span>`:''}</div>
                    ${leaves.length ? `<div class="leave-cal-label">${leaveLabel}</div>` : '<div class="duty-cal-personnel">&nbsp;</div>'}
                </div>`;
            }
            grid.innerHTML = html;
        }
        function changeLeaveMonth(delta) {
            leaveCalendarDate = new Date(leaveCalendarDate.getFullYear(), leaveCalendarDate.getMonth() + Number(delta), 1);
            renderLeaveCalendar();
        }
        function renderLeaveTypeRecap() {
            const wrap = document.getElementById('leaveTypeRecap');
            if (!wrap) return;

            const counts = new Map();
            let totalDays = 0;
            (leaveEntries || []).forEach(entry => {
                const rawType = String(entry.leaveType || 'Unspecified').trim() || 'Unspecified';
                const label = rawType === 'Others' && entry.otherType ? `Others (${entry.otherType})` : rawType;
                const key = label.toLocaleLowerCase();
                const dates = Array.isArray(entry.dates) ? entry.dates : [];
                const days = new Set(dates.map(date => String(date || '').trim()).filter(Boolean)).size;
                totalDays += days;
                if (!counts.has(key)) counts.set(key, { label, entries: 0, days: 0, personnel: new Set() });
                const item = counts.get(key);
                item.entries += 1;
                item.days += days;
                if (entry.personnelName) item.personnel.add(String(entry.personnelName).trim());
            });

            const items = [...counts.values()].sort((a, b) => b.days - a.days || b.entries - a.entries || a.label.localeCompare(b.label));
            const totalEntries = Array.isArray(leaveEntries) ? leaveEntries.length : 0;
            const totalPeople = new Set((leaveEntries || []).map(entry => String(entry.personnelName || '').trim()).filter(Boolean)).size;
            const topType = items.length ? items[0].label : '—';

            wrap.classList.add('leave-analytics-panel');
            wrap.innerHTML = `
                <div class="leave-analytics-head">
                    <div class="leave-analytics-title-group">
                        <div class="leave-analytics-icon" aria-hidden="true">▤</div>
                        <div>
                            <span class="leave-analytics-eyebrow">PERSONNEL MANAGEMENT · RECAP</span>
                            <h4>Leave Overview</h4>
                            <p>A consolidated view of all recorded personnel leave entries.</p>
                        </div>
                    </div>
                    <span class="leave-analytics-scope">ALL RECORDED DATA</span>
                </div>
                <div class="leave-analytics-kpis">
                    <article class="leave-analytics-kpi leave-kpi-primary">
                        <span class="leave-kpi-label">Leave Entries</span>
                        <strong>${totalEntries.toLocaleString()}</strong>
                        <small>Encoded records</small>
                    </article>
                    <article class="leave-analytics-kpi">
                        <span class="leave-kpi-label">Total Leave Days</span>
                        <strong>${totalDays.toLocaleString()}</strong>
                        <small>Days recorded</small>
                    </article>
                    <article class="leave-analytics-kpi">
                        <span class="leave-kpi-label">Personnel Covered</span>
                        <strong>${totalPeople.toLocaleString()}</strong>
                        <small>Unique personnel</small>
                    </article>
                    <article class="leave-analytics-kpi">
                        <span class="leave-kpi-label">Leave Categories</span>
                        <strong>${items.length.toLocaleString()}</strong>
                        <small>Distinct leave types</small>
                    </article>
                </div>
                <div class="leave-analytics-breakdown">
                    <div class="leave-analytics-section-head">
                        <div><h5>Leave Type Breakdown</h5><p>Distribution based on the total number of leave days.</p></div>
                        ${items.length ? `<span class="leave-analytics-category-badge">${items.length} ${items.length === 1 ? 'category' : 'categories'}</span>` : ''}
                    </div>
                    ${items.length ? `<div class="leave-analytics-list">${items.map((item, index) => {
                        const share = totalDays > 0
                            ? Math.round((item.days / totalDays) * 100)
                            : Math.round((item.entries / Math.max(1, totalEntries)) * 100);
                        const width = Math.max(item.days || item.entries ? 3 : 0, share);
                        return `<article class="leave-analytics-type">
                            <div class="leave-analytics-type-top">
                                <div class="leave-analytics-type-name">
                                    <span class="leave-analytics-type-index">${String(index + 1).padStart(2, '0')}</span>
                                    <div><strong title="${escapeAttr(item.label)}">${escapeHtml(item.label)}</strong><small>${item.entries} ${item.entries === 1 ? 'entry' : 'entries'} · ${item.personnel.size} ${item.personnel.size === 1 ? 'personnel member' : 'personnel members'}</small></div>
                                </div>
                                <div class="leave-analytics-type-value"><strong>${item.days.toLocaleString()}</strong><span>${item.days === 1 ? 'day' : 'days'} · ${share}%</span></div>
                            </div>
                            <div class="leave-analytics-track" role="progressbar" aria-label="${escapeAttr(item.label)} share of leave days" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${share}"><i style="width:${width}%"></i></div>
                        </article>`;
                    }).join('')}</div>` : `<div class="leave-analytics-empty"><span aria-hidden="true">▤</span><strong>No leave records yet</strong><small>Leave entries will be summarized here as soon as they are encoded.</small></div>`}
                    ${items.length ? `<div class="leave-analytics-insight"><span class="leave-analytics-insight-mark" aria-hidden="true">✦</span><span><strong>Most recorded leave type:</strong> ${escapeHtml(topType)}</span></div>` : ''}
                </div>`;
        }
        function formatLeaveDates(datesArr) {
            // Group dates by month+year and render as (Month, D1, D2, ..., YYYY).
            // Dates are stored as YYYY-MM-DD strings.
            const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            const groups = new Map();
            (datesArr || []).forEach(d => {
                const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (!m) return;
                const key = `${m[1]}-${m[2]}`;
                if (!groups.has(key)) groups.set(key, { year: m[1], month: Number(m[2]), days: [] });
                groups.get(key).days.push(Number(m[3]));
            });
            if (!groups.size) return '';
            const parts = [...groups.keys()].sort().map(key => {
                const g = groups.get(key);
                const days = g.days.slice().sort((a,b)=>a-b).join(', ');
                return `(${monthNames[g.month-1]}, ${days}, ${g.year})`;
            });
            return parts.join(', ');
        }
        function renderLeaveTable() {
            const tbody = document.getElementById('leaveTableBody');
            if (!tbody) return;
            renderLeaveTypeRecap();
            const countBadge = document.getElementById('leaveEntriesCount');
            if (countBadge) countBadge.textContent = `${leaveEntries.length.toLocaleString()} ${leaveEntries.length === 1 ? 'record' : 'records'}`;
            const can = canPersonnelAction('leave', 'delete');
            if (!leaveEntries.length) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px;">No leave entries recorded.</td></tr>`;
                return;
            }
            tbody.innerHTML = leaveEntries.slice().reverse().map(e => {
                const typeLabel = e.leaveType === 'Others' && e.otherType ? `Others (${e.otherType})` : e.leaveType;
                const datesStr = formatLeaveDates(e.dates) || (e.dates || []).join(', ');
                const actionCell = can ? `<td><button class="action-btn delete-btn" style="margin:0;padding:4px 8px;font-size:11px;" onclick="deleteLeaveEntry('${escapeAttr(e.id)}')">Delete</button></td>` : '';
                return `<tr>
                    <td>${escapeHtml(e.personnelName)}</td>
                    <td>${escapeHtml(typeLabel)}</td>
                    <td style="font-size:12px;">${escapeHtml(datesStr)}</td>
                    <td>${escapeHtml(e.encodedBy||'')}</td>
                    ${actionCell}
                </tr>`;
            }).join('');
        }

        /* Leave-entry modal: clickable multi-date picker calendar */
        function renderLeavePickerCalendar() {
            const grid = document.getElementById('leavePickerCalendar');
            const title = document.getElementById('leavePickerTitle');
            if (!grid || !title) return;
            const year = leavePickerDate.getFullYear();
            const month = leavePickerDate.getMonth();
            const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            title.innerText = `${monthNames[month]} ${year}`;
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const dayNames = ['S','M','T','W','T','F','S'];
            const leaveMap = {};
            (leaveEntries || []).forEach(e => { (e.dates || []).forEach(d => { leaveMap[d] = (leaveMap[d] || 0) + 1; }); });
            let html = dayNames.map(d => `<div class="leave-picker-head">${d}</div>`).join('');
            for (let i = 0; i < firstDay; i++) html += '<div class="leave-picker-day empty"></div>';
            for (let d = 1; d <= daysInMonth; d++) {
                const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                const selected = selectedLeaveDates.includes(dateStr);
                const maxed = (leaveMap[dateStr] || 0) >= MAX_LEAVE_PER_DATE;
                if (maxed) {
                    html += `<div class="leave-picker-day locked" title="${dateStr} — Maximum allowable personnel (${MAX_LEAVE_PER_DATE}) on leave reached. Date locked."><span class="leave-picker-day-num">${d}</span><span class="leave-picker-lock">LOCK</span></div>`;
                } else {
                    html += `<div class="leave-picker-day ${selected?'selected':''}" onclick="toggleLeaveDate('${dateStr}')" role="button" title="${dateStr}">${d}</div>`;
                }
            }
            grid.innerHTML = html;
        }
        function changeLeavePickerMonth(delta) {
            leavePickerDate = new Date(leavePickerDate.getFullYear(), leavePickerDate.getMonth() + Number(delta), 1);
            renderLeavePickerCalendar();
        }
        function toggleLeaveDate(dateStr) {
            if (!selectedLeaveDates.includes(dateStr) && isLeaveDateMaxed(dateStr)) {
                customAlert(`Date ${dateStr} has reached the maximum allowable personnel (${MAX_LEAVE_PER_DATE}) on leave. This date is locked.`, 'Date Locked');
                return;
            }
            if (selectedLeaveDates.includes(dateStr)) {
                selectedLeaveDates = selectedLeaveDates.filter(d => d !== dateStr);
            } else {
                selectedLeaveDates.push(dateStr);
                selectedLeaveDates.sort();
            }
            renderLeaveSelectedDates();
            renderLeavePickerCalendar();
        }

        function openLeaveModal() {
            if (!canPersonnelAction('leave', 'add')) { customAlert("You do not have permission to add Leave Management entries.", "Permission Denied"); return; }
            if (!allPersonnel || !allPersonnel.length) { loadPersonnel(); customAlert("Personnel data is still loading. Please try again in a moment.", "Loading"); return; }

            const sel = document.getElementById('leavePersonnelSelect');
            sel.innerHTML = '<option value="">Select personnel...</option>' + allPersonnel.map((p,i) => `<option value="${i}">${escapeHtml(personnelFullName(p))}</option>`).join('');
            document.getElementById('leaveTypeSelect').value = '';
            document.getElementById('leaveOtherTypeInput').value = '';
            document.getElementById('leaveOtherTypeWrap').classList.add('hidden');
            document.getElementById('leaveDatePicker').value = '';
            selectedLeaveDates = [];
            leavePickerDate = new Date();
            selectedLeavePersonnelIdx = '';
            document.getElementById('leavePersonnelSelect').value = '';
            const selEl = document.getElementById('leavePersonnelSelected'); if (selEl) { selEl.style.display='none'; selEl.innerText=''; }
            renderLeaveSelectedDates();
            renderLeavePickerCalendar();
            renderLeavePersonnelTable('');
            document.getElementById('leaveEntryModal').classList.remove('hidden');
        }
        function closeLeaveModal() { document.getElementById('leaveEntryModal').classList.add('hidden'); }
        function toggleLeaveOtherType() {
            const val = document.getElementById('leaveTypeSelect').value;
            const wrap = document.getElementById('leaveOtherTypeWrap');
            if (wrap) wrap.classList.toggle('hidden', val !== 'Others');
        }
        function addLeaveDate() {
            const val = document.getElementById('leaveDatePicker').value;
            if (!val) { customAlert("Please pick a date first.", "Validation"); return; }
            if (isLeaveDateMaxed(val)) {
                customAlert(`Date ${val} has reached the maximum allowable personnel (${MAX_LEAVE_PER_DATE}) on leave. This date is locked.`, 'Date Locked');
                return;
            }
            if (!selectedLeaveDates.includes(val)) {
                selectedLeaveDates.push(val);
                selectedLeaveDates.sort();
            }
            renderLeaveSelectedDates();
        }
        function clearLeaveDates() { selectedLeaveDates = []; renderLeaveSelectedDates(); }
        function removeLeaveDate(dateStr) {
            selectedLeaveDates = selectedLeaveDates.filter(d => d !== dateStr);
            renderLeaveSelectedDates();
        }
        function renderLeaveSelectedDates() {
            const wrap = document.getElementById('leaveSelectedDates');
            if (!wrap) return;
            if (!selectedLeaveDates.length) { wrap.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">No dates selected.</span>'; return; }
            wrap.innerHTML = selectedLeaveDates.map(d => `<span class="leave-date-chip">${escapeHtml(d)} <button type="button" onclick="removeLeaveDate('${escapeAttr(d)}')" style="background:none;border:none;color:inherit;cursor:pointer;padding:0;margin:0 0 0 4px;font-size:12px;width:auto;">×</button></span>`).join('');
        }
        async function saveLeaveEntry() {
            if (!canPersonnelAction('leave', 'add')) return customAlert('You do not have permission to add Leave Management entries.', 'Permission Denied');
            const selIdx = document.getElementById('leavePersonnelSelect').value || selectedLeavePersonnelIdx;
            const leaveType = document.getElementById('leaveTypeSelect').value;
            if (selIdx === '' || !leaveType) { customAlert('Please select personnel and leave type.', 'Validation'); return; }
            if (leaveType === 'Others' && !document.getElementById('leaveOtherTypeInput').value.trim()) { customAlert('Please specify the leave type under Others.', 'Validation'); return; }
            if (!selectedLeaveDates.length) { customAlert('Please add at least one leave date.', 'Validation'); return; }
            const p = allPersonnel[Number(selIdx)];
            if (!p) { customAlert('Select a valid personnel record.', 'Validation'); return; }
            const saveButton = document.querySelector('#leaveEntryModal .approve-btn');
            if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Saving…'; }
            try {
                await postPersonnelMutation({
                    action:'add_leave_entry', personnelName:personnelFullName(p), leaveType,
                    otherType:leaveType === 'Others' ? document.getElementById('leaveOtherTypeInput').value.trim() : '',
                    dates:selectedLeaveDates,
                    userName:localStorage.getItem('loggedInUser'), credential:localStorage.getItem('loggedCred') || ''
                });
                closeLeaveModal(); customAlert('Leave entry saved successfully.', 'Success'); await loadLeaveEntries();
            } catch (e) { customAlert(e.message || 'Failed to save leave entry.', 'Error'); }
            finally { if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Save Leave Entry'; } }
        }
        function deleteLeaveEntry(id) {
            if (!canPersonnelAction('leave', 'delete')) return customAlert('You do not have permission to delete Leave Management entries.', 'Permission Denied');
            customConfirm('Delete this leave entry?', async confirmed => {
                if (!confirmed) return;
                try {
                    await postPersonnelMutation({action:'delete_leave_entry', id, userName:localStorage.getItem('loggedInUser'), credential:localStorage.getItem('loggedCred') || ''});
                    await loadLeaveEntries(); customAlert('Leave entry deleted.', 'Success');
                } catch (e) { customAlert(e.message || 'Failed to delete leave entry.', 'Error'); }
            });
        }

        /* ---------- Area of Responsibilities ---------- */
        async function loadAreas() {
            let loaded = true;
            try {
                const res = await spadesAuthenticatedRead('get_areas');
                if (!res.ok) throw new Error(`Request failed (${res.status})`);
                const data = await res.json();
                if (!data || data.success !== true || !Array.isArray(data.areas)) throw new Error((data && data.error) || 'Invalid Areas response');
                areas = data.areas;
            } catch (e) {
                loaded = false;
                console.warn('Area of Responsibilities data could not be loaded:', e);
                areas = [];
            }
            renderAreaCards();
            renderAreaOverviewTable();
            return loaded;
        }
        let areaDragId = null;
        function renderAreaCards() {
            const container = document.getElementById('areaCardsContainer');
            if (!container) return;
            if (!areas.length) {
                container.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px;">No areas created yet.${canPersonnelAction('aor','add')?' Click "Add Area" to create one and deploy personnel.':''}</div>`;
                return;
            }
            const canEdit = canPersonnelAction('aor', 'edit');
            container.innerHTML = areas.map(a => {
                const canEditThisArea = canEdit && isCurrentUserRecordOwner(a.createdBy);
                const assignedCount = Array.isArray(a.personnel) ? a.personnel.length : 0;
                return `<div class="area-card glass-panel" draggable="${canEditThisArea?'true':'false'}" data-area-id="${escapeAttr(a.areaId)}"
                    onclick="openAreaDetails('${escapeAttr(a.areaId)}')" role="button" tabindex="0" aria-label="View details for ${escapeAttr(a.areaName)}"
                    ${canEditThisArea ? `ondragstart="areaCardDragStart(event, '${escapeAttr(a.areaId)}')" ondragover="areaCardDragOver(event)" ondragleave="areaCardDragLeave(event)" ondrop="areaCardDrop(event, '${escapeAttr(a.areaId)}')" ondragend="areaCardDragEnd(event)"` : ''}>
                    <div class="area-card-icon" aria-hidden="true">&#9635;</div>
                    <h4 style="margin:8px 0 4px;color:var(--primary);">${escapeHtml(a.areaName)}</h4>
                    <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(a.camp||'PRO 1 Camp')}</div>
                    <div style="margin-top:10px;font-size:13px;"><strong>${assignedCount}</strong> personnel assigned</div>
                    <div style="margin-top:6px;font-size:11px;color:var(--text-muted);">${canEditThisArea ? 'Drag your area cards to reorder &bull; ' : ''}Click to view personnel in-charge</div>
                </div>`;
            }).join('');
            renderAreaOverviewTable();
        }

        function renderAreaOverviewTable() {
            const body = document.getElementById('areaOverviewTableBody');
            const count = document.getElementById('areaOverviewCount');
            if (!body) return;
            const records = Array.isArray(areas) ? areas : [];
            if (count) count.textContent = `${records.length} ${records.length === 1 ? 'area' : 'areas'}`;
            if (!records.length) {
                body.innerHTML = '<tr><td colspan="5" class="area-overview-empty">No Areas of Responsibility have been recorded.</td></tr>';
                return;
            }
            body.innerHTML = records.map((area, index) => {
                const assigned = Array.isArray(area.personnel) ? area.personnel : [];
                const names = assigned.map(person => personnelFullName(person)).filter(Boolean);
                return `<tr>
                    <td class="area-overview-number">${index + 1}</td>
                    <td><strong>${escapeHtml(area.areaName || '—')}</strong></td>
                    <td>${escapeHtml(area.camp || 'PRO 1 Camp')}</td>
                    <td class="area-overview-personnel">${names.length ? names.map(name => `<span>${escapeHtml(name)}</span>`).join('') : '<span class="area-overview-muted">No personnel assigned</span>'}</td>
                    <td class="area-overview-count-cell">${assigned.length}</td>
                </tr>`;
            }).join('');
        }

        function openAreaOverviewModal() {
            renderAreaOverviewTable();
            const modal = document.getElementById('areaOverviewModal');
            if (!modal) return;
            modal.classList.remove('hidden');
            modal.setAttribute('aria-hidden','false');
            window.SPADESModalStack?.bringToFront('areaOverviewModal');
        }

        function closeAreaOverviewModal() {
            const modal = document.getElementById('areaOverviewModal');
            if (!modal) return;
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden','true');
            window.SPADESModalStack?.refresh?.();
        }

        async function downloadAreaResponsibilityExcel() {
            const records = Array.isArray(areas) ? areas.slice() : [];
            if (!records.length) return customAlert('There are no Area of Responsibility records to export.', 'Excel Export');
            const button = document.getElementById('areaOverviewDownloadBtn');
            if (button) { button.disabled = true; button.setAttribute('aria-busy','true'); }
            try {
                const headers = ['No.','Area of Responsibility','Camp','Personnel Assigned','Personnel Count'];
                const rows = records.map((area,index) => {
                    const assigned = Array.isArray(area.personnel) ? area.personnel : [];
                    return [index + 1, area.areaName || '', area.camp || 'PRO 1 Camp', assigned.map(person => personnelFullName(person)).filter(Boolean).join('\n'), assigned.length];
                });
                const result = await downloadSpadesExcelWorkbook({
                    title:'RHSU Area of Responsibility Overview', sheetName:'Area Overview', fileName:'RHSU_Area_of_Responsibility_Overview.xlsx',
                    headers, rows, widths:[8,32,24,58,18]
                });
                customAlert(`${result.rowCount} Area of Responsibility record(s) exported successfully in card order.`, 'Excel Download');
            } catch (error) {
                console.error('Area of Responsibility Excel export failed:', error);
                customAlert(error.message || 'Unable to generate the Area of Responsibility Excel workbook.', 'Excel Export Error');
            } finally {
                if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
            }
        }
        function areaCardDragStart(e, areaId) { areaDragId = String(areaId); e.currentTarget.classList.add('dragging'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', areaId); } catch(err) {} }
        function areaCardDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); try { e.dataTransfer.dropEffect = 'move'; } catch(err) {} }
        function areaCardDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
        function areaCardDrop(e, targetId) {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.classList.remove('drag-over');
            if (!areaDragId || areaDragId === String(targetId)) return;
            const fromIdx = areas.findIndex(a => String(a.areaId) === areaDragId);
            const toIdx = areas.findIndex(a => String(a.areaId) === String(targetId));
            if (fromIdx < 0 || toIdx < 0) return;
            const moved = areas.splice(fromIdx, 1)[0];
            areas.splice(toIdx, 0, moved);
            areaDragId = null;
            renderAreaCards();
            persistAreaOrder();
        }
        function areaCardDragEnd(e) {
            areaDragId = null;
            document.querySelectorAll('.area-card').forEach(el => { el.classList.remove('dragging'); el.classList.remove('drag-over'); });
        }
        async function persistAreaOrder() {
            if (!canPersonnelAction('aor', 'edit')) return;
            try {
                await postPersonnelMutation({
                    action:'reorder_areas', orderedIds:areas.map(a => String(a.areaId)),
                    userName:localStorage.getItem('loggedInUser'), credential:localStorage.getItem('loggedCred') || ''
                });
            } catch (e) { console.warn('Area order was not saved:', e.message || e); }
        }
        function openAreaModal(editId) {
            const operation = editId ? 'edit' : 'add';
            if (!canPersonnelAction('aor', operation)) { customAlert(`You do not have permission to ${operation} Area of Responsibilities entries.`, "Permission Denied"); return; }
            if (!allPersonnel || !allPersonnel.length) { loadPersonnel(); customAlert("Personnel data is still loading. Please try again in a moment.", "Loading"); return; }

            editingAreaId = editId || null;
            document.getElementById('areaModalTitle').innerText = editId ? 'Edit Area Personnel' : 'Add Area of Responsibility';
            document.getElementById('areaNameInput').value = '';
            document.getElementById('areaNameInput').disabled = !!editId;
            document.getElementById('areaCampSelect').value = 'PRO 1 Camp';

            // Populate section filter dropdown
            const secFilter = document.getElementById('areaSectionFilter');
            if (secFilter) {
                const secs = [...new Set(allPersonnel.map(p => String(p.section || '').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
                secFilter.innerHTML = '<option value="">All Sections</option>' + secs.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
            }
            const searchInput = document.getElementById('areaPersonnelSearch');
            if (searchInput) searchInput.value = '';

            // Exclude personnel already assigned to another area (when creating, or when editing exclude other areas only).
            const assignedNames = new Set();
            (areas || []).forEach(a => {
                if (editId && String(a.areaId) === String(editId)) return;
                (a.personnel || []).forEach(p => assignedNames.add(personnelFullName(p)));
            });
            areaExcludeNames = assignedNames;

            areaPreselected = [];
            if (editId) {
                const a = areas.find(x => String(x.areaId) === String(editId));
                if (a) {
                    document.getElementById('areaNameInput').value = a.areaName || '';
                    document.getElementById('areaCampSelect').value = a.camp || 'PRO 1 Camp';
                    areaPreselected = a.personnel || [];
                }
            }
            renderAreaPersonnelChecklist();
            updateAreaPersonnelCount();
            document.getElementById('areaModal').classList.remove('hidden');
        }
        function closeAreaModal() { document.getElementById('areaModal').classList.add('hidden'); editingAreaId = null; areaPreselected = []; areaExcludeNames = null; }
        function renderAreaPersonnelChecklist() {
            const wrap = document.getElementById('areaPersonnelList');
            if (!wrap) return;
            const preNames = (areaPreselected || []).map(m => personnelFullName(m));
            const exclude = areaExcludeNames || new Set();
            const searchQ = document.getElementById('areaPersonnelSearch') ? String(document.getElementById('areaPersonnelSearch').value).toLowerCase().trim() : '';
            const secFilter = document.getElementById('areaSectionFilter') ? document.getElementById('areaSectionFilter').value : '';

            let excludedCount = 0;
            const items = [];
            allPersonnel.forEach((p, i) => {
                const full = personnelFullName(p);
                const isPreselected = preNames.includes(full);
                // Exclude personnel assigned to another area, but keep preselected ones.
                if (!isPreselected && exclude.has(full)) { excludedCount++; return; }
                if (secFilter && String(p.section || '').trim() !== secFilter) return;
                if (searchQ && !full.toLowerCase().includes(searchQ) && !String(p.section||'').toLowerCase().includes(searchQ)) return;
                const checked = isPreselected;
                items.push(`<label class="checklist-item"><input type="checkbox" class="area-personnel-cb" value="${i}" ${checked?'checked':''} onchange="updateAreaPersonnelCount()"> <span>${escapeHtml(full)}</span> <span style="font-size:11px;color:var(--text-muted);">(${escapeHtml(p.section||'—')})</span></label>`);
            });
            const note = excludedCount ? `<div style="font-size:11px;color:var(--text-muted);padding:6px;border-top:1px solid var(--border-color);margin-top:6px;">${excludedCount} personnel already assigned to another area and excluded from this list.</div>` : '';
            wrap.innerHTML = items.length ? items.join('') + note : '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:10px;">No personnel match the current filters.</div>' + note;
        }
        function renderAreaPersonnelChecklistFromFilters() { syncAreaSelectionFromCheckboxes(); renderAreaPersonnelChecklist(); }
        function syncAreaSelectionFromCheckboxes() {
            const visibleCbs = document.querySelectorAll('.area-personnel-cb');
            if (!visibleCbs.length) return;
            const visibleIdxs = new Set([...visibleCbs].map(cb => Number(cb.value)));
            const checkedIdxs = new Set([...document.querySelectorAll('.area-personnel-cb:checked')].map(cb => Number(cb.value)));
            const kept = (areaPreselected || []).filter(m => {
                const idx = allPersonnel.findIndex(p => personnelFullName(p) === personnelFullName(m));
                return idx < 0 || !visibleIdxs.has(idx);
            });
            const checked = [...checkedIdxs].map(i => {
                const p = allPersonnel[i];
                return {rank:p.rank, lastName:p.lastName, firstName:p.firstName, middleName:p.middleName, qualifiers:p.qualifiers};
            });
            areaPreselected = kept.concat(checked);
        }
        function updateAreaPersonnelCount() {
            const cbs = document.querySelectorAll('.area-personnel-cb:checked');
            const el = document.getElementById('areaPersonnelCount');
            if (el) el.innerText = cbs.length;
        }
        async function saveArea() {
            const operation = editingAreaId ? 'edit' : 'add';
            if (!canPersonnelAction('aor', operation)) return customAlert(`You do not have permission to ${operation} Area of Responsibilities entries.`, 'Permission Denied');
            const name = document.getElementById('areaNameInput').value.trim();
            const camp = document.getElementById('areaCampSelect').value;
            if (!name && !editingAreaId) { customAlert('Area name is required.', 'Validation'); return; }
            syncAreaSelectionFromCheckboxes();
            const selected = (areaPreselected || []).map(p => ({rank:p.rank,lastName:p.lastName,firstName:p.firstName,middleName:p.middleName,qualifiers:p.qualifiers}));
            const saveButton = document.querySelector('#areaModal .approve-btn');
            if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Saving…'; }
            try {
                if (editingAreaId) {
                    await postPersonnelMutation({action:'update_area_personnel', areaId:editingAreaId, personnel:selected, userName:localStorage.getItem('loggedInUser'), credential:localStorage.getItem('loggedCred') || ''});
                } else {
                    await postPersonnelMutation({action:'add_area', areaName:name, camp, personnel:selected, userName:localStorage.getItem('loggedInUser'), credential:localStorage.getItem('loggedCred') || ''});
                }
                closeAreaModal(); closeAreaDetailsModal(); await loadAreas();
                customAlert('Area saved successfully.', 'Success');
            } catch (e) { customAlert(e.message || 'Failed to save area.', 'Error'); }
            finally { if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Save Area'; } }
        }
        function openAreaDetails(areaId) {
            const a = areas.find(x => String(x.areaId) === String(areaId));
            if (!a) return;
            document.getElementById('areaDetailsTitle').innerText = a.areaName;
            document.getElementById('areaDetailsCamp').innerText = `Camp: ${a.camp || 'PRO 1 Camp'} • Created by: ${a.createdBy || '—'}`;
            const persWrap = document.getElementById('areaDetailsPersonnel');
            if (!a.personnel || !a.personnel.length) {
                persWrap.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No personnel assigned to this area yet.</div>';
            } else {
                const archivedNames = (archivedPersonnel || []).map(ap => personnelFullName(ap));
                const activePers = a.personnel.filter(p => !archivedNames.includes(personnelFullName(p)));
                persWrap.innerHTML = activePers.map((p, i) => `<div class="area-personnel-row">
                    <span class="area-personnel-num">${i+1}</span>
                    <span>${escapeHtml(personnelFullName(p))}</span>
                </div>`).join('');
            }
            document.getElementById('areaEditBtn').style.display = (canPersonnelAction('aor', 'edit') && isCurrentUserRecordOwner(a.createdBy)) ? '' : 'none';
            document.getElementById('areaDeleteBtn').style.display = canPersonnelAction('aor', 'delete') ? '' : 'none';
            document.getElementById('areaEditBtn').setAttribute('data-area-id', areaId);
            document.getElementById('areaDeleteBtn').setAttribute('data-area-id', areaId);
            document.getElementById('areaDetailsModal').classList.remove('hidden');
        }
        function closeAreaDetailsModal() { document.getElementById('areaDetailsModal').classList.add('hidden'); }
        function editAreaFromDetails() {
            if (!canPersonnelAction('aor', 'edit')) return customAlert('You do not have permission to edit Area of Responsibilities entries.', 'Permission Denied');
            const id = document.getElementById('areaEditBtn').getAttribute('data-area-id');
            const area = areas.find(a => String(a.areaId) === String(id));
            if (!area || !isCurrentUserRecordOwner(area.createdBy)) return customAlert('You can edit only Area of Responsibility entries that you encoded.', 'Permission Denied');
            closeAreaDetailsModal();
            openAreaModal(id);
        }
        function deleteAreaFromDetails() {
            if (!canPersonnelAction('aor', 'delete')) return customAlert('You do not have permission to delete Area of Responsibilities entries.', 'Permission Denied');
            const id = document.getElementById('areaDeleteBtn').getAttribute('data-area-id');
            customConfirm('Delete this area of responsibility and unassign all personnel?', async confirmed => {
                if (!confirmed) return;
                try {
                    await postPersonnelMutation({action:'delete_area', areaId:id, userName:localStorage.getItem('loggedInUser'), credential:localStorage.getItem('loggedCred') || ''});
                    closeAreaDetailsModal(); await loadAreas(); customAlert('Area deleted.', 'Success');
                } catch (e) { customAlert(e.message || 'Failed to delete area.', 'Error'); }
            });
        }

        /* ---------- User Access Control ---------- */
        let userAccessContextLoadedFor = '';
        let userAccessContextLoadedAt = 0;
        let userAccessContextPromise = null;
        let userAccessContextPromiseFor = '';
        async function loadUserAccessContext(forceRefresh = false) {
            const requestedUser = localStorage.getItem('loggedInUser') || '';
            if (!requestedUser) return;
            if (!forceRefresh && userAccessContextLoadedFor === requestedUser && Date.now() - userAccessContextLoadedAt < 30000) return;

            // Never let a pending request for a previous account populate the new
            // account's client-side permission maps. Same-user callers share one request.
            if (userAccessContextPromise) {
                if (userAccessContextPromiseFor === requestedUser) return userAccessContextPromise;
                const previousRequest = userAccessContextPromise;
                try { await previousRequest; } catch (_) {}
                if (localStorage.getItem('loggedInUser') !== requestedUser) return;
                return loadUserAccessContext(true);
            }

            const requestForUser = requestedUser;
            const requestPromise = (async () => {
                try {
                    const res = await fetch(API_URL, {
                        method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, cache:'no-store',
                        body:JSON.stringify({action:'get_user_security_context',userName:requestForUser,password:sessionAdminPass,credential:localStorage.getItem('loggedCred') || ''})
                    });
                    if (!res.ok) throw new Error(`Account security context request failed (${res.status})`);
                    const data = await res.json();
                    if (!data || !data.success) throw new Error(data?.error || 'Unable to load account security preferences.');
                    if (localStorage.getItem('loggedInUser') !== requestForUser) return;
                    userAccessMap = data.accessMap && typeof data.accessMap === 'object' ? data.accessMap : {};
                    userPersonnelPermissionsMap = data.personnelPermissionsMap && typeof data.personnelPermissionsMap === 'object' ? data.personnelPermissionsMap : {};
                    userRestrictedMap = data.restricted && typeof data.restricted === 'object' ? data.restricted : {};
                    userAccessMapLoadedFor = requestForUser;
                    userAccessContextLoadedFor = requestForUser;
                    userAccessContextLoadedAt = Date.now();
                } catch (error) {
                    if (localStorage.getItem('loggedInUser') === requestForUser) {
                        userAccessMap = {};
                        userPersonnelPermissionsMap = {};
                        userRestrictedMap = {};
                        userAccessMapLoadedFor = '';
                        userAccessContextLoadedFor = '';
                        userAccessContextLoadedAt = 0;
                    }
                    console.warn('Could not load account security preferences.', error);
                } finally {
                    if (localStorage.getItem('loggedInUser') === requestForUser) {
                        updatePersonnelPermissions();
                        if (typeof applyAccessRestrictions === 'function') applyAccessRestrictions();
                    }
                }
            })();
            userAccessContextPromise = requestPromise;
            userAccessContextPromiseFor = requestForUser;
            try { return await requestPromise; }
            finally {
                if (userAccessContextPromise === requestPromise) {
                    userAccessContextPromise = null;
                    userAccessContextPromiseFor = '';
                }
            }
        }
        async function loadUserAccessMap(forceRefresh = false) {
            await loadUserAccessContext(forceRefresh);
        }

        function openUserAccessModal(username) {
            if (!isAlphaAdmin()) return customAlert('Only the Alpha Admin can configure account permissions.', 'Permission Denied');
            currentAccessUsername = username;
            document.getElementById('userAccessUsername').innerText = username;
            const current = Array.isArray(userAccessMap[username]) ? userAccessMap[username] : [];
            const wrap = document.getElementById('userAccessCheckboxes');
            wrap.innerHTML = ACCESS_PAGES.map(p => `<label class="checklist-item um-page-access-item"><input type="checkbox" class="user-access-cb" value="${escapeAttr(p.key)}" ${current.includes(p.key)?'checked':''}><span>${escapeHtml(p.label)}</span></label>`).join('');

            const matrix = document.getElementById('userPersonnelPermissionMatrixBody');
            const saved = userPersonnelPermissionsMap[username];
            const role = (adminUsersCache.find(user => String(user.username) === String(username)) || {}).role || 'Regular User';
            const defaultAllowed = !saved && role === 'Admin';
            matrix.innerHTML = PERSONNEL_PERMISSION_SUBPAGES.map(subpage => {
                const currentSub = saved && saved[subpage.key] ? saved[subpage.key] : null;
                return `<tr><th scope="row"><span class="um-subpage-name">${escapeHtml(subpage.label)}</span></th>${PERSONNEL_PERMISSION_ACTIONS.map(action => {
                    const checked = currentSub ? currentSub[action.key] === true : defaultAllowed;
                    return `<td><label class="um-permission-cell" aria-label="${escapeAttr(subpage.label)} ${escapeAttr(action.label)}"><input type="checkbox" class="user-personnel-perm-cb" data-subpage="${escapeAttr(subpage.key)}" data-action="${escapeAttr(action.key)}" ${checked ? 'checked' : ''}><span>${escapeHtml(action.label)}</span></label></td>`;
                }).join('')}</tr>`;
            }).join('');
            const modal = document.getElementById('userAccessModal');
            if (!modal) return;
            modal.classList.remove('hidden');
            modal.setAttribute('aria-hidden', 'false');
            modal.setAttribute('aria-modal', 'true');
            document.body.classList.add('profile-modal-open');
            // Promote the dialog immediately; MutationObserver remains a fallback
            // for other legacy modals opened only by toggling the hidden class.
            window.SPADESModalStack?.bringToFront(modal);
        }
        function closeUserAccessModal() {
            const modal = document.getElementById('userAccessModal');
            if (modal) {
                modal.classList.add('hidden');
                modal.setAttribute('aria-hidden', 'true');
                modal.removeAttribute('aria-modal');
            }
            document.body.classList.remove('profile-modal-open');
            currentAccessUsername = null;
            // Recalculate scroll locking and stacking without waiting for the observer.
            window.SPADESModalStack?.refresh();
        }
        async function saveUserAccess() {
            if (!isAlphaAdmin()) return customAlert('Only the Alpha Admin can configure account permissions.', 'Permission Denied');
            if (!currentAccessUsername) return customAlert('Select an account before saving access permissions.', 'Error');
            const targetUsername = currentAccessUsername;
            const saveButton = document.querySelector('#userAccessModal .um-btn-primary');
            if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Saving…'; }
            const selected = [...document.querySelectorAll('.user-access-cb:checked')].map(cb => cb.value);
            const personnelPermissions = {};
            PERSONNEL_PERMISSION_SUBPAGES.forEach(subpage => {
                personnelPermissions[subpage.key] = {};
                PERSONNEL_PERMISSION_ACTIONS.forEach(action => {
                    const checkbox = document.querySelector(`.user-personnel-perm-cb[data-subpage="${subpage.key}"][data-action="${action.key}"]`);
                    personnelPermissions[subpage.key][action.key] = !!(checkbox && checkbox.checked);
                });
            });
            try {
                const response = await fetch(API_URL, {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'set_user_access',username:targetUsername,access:selected,personnelPermissions,password:sessionAdminPass,userName:localStorage.getItem('loggedInUser') || ''})});
                if (!response.ok) throw new Error(`Permission update failed (${response.status})`);
                const result = await response.json();
                if (!result.success) throw new Error(result.error || 'Access permission changes were rejected.');
                userAccessMap[targetUsername] = selected;
                userPersonnelPermissionsMap[targetUsername] = result.personnelPermissions || personnelPermissions;
                closeUserAccessModal();
                customAlert('Page and Personnel Management permissions updated.', 'Success');
                if (targetUsername === (localStorage.getItem('loggedInUser') || '')) {
                    await loadUserAccessMap();
                    applyAccessRestrictions();
                }
            } catch (e) { customAlert(e.message || 'Failed to save access permissions. Please retry.', 'Error'); }
            finally { if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Save Access'; } }
        }
        function userHasAccess(pageKey) {
            const user = localStorage.getItem('loggedInUser') || '';
            const role = String(localStorage.getItem('userRole') || '').trim().toLowerCase();
            // Every regular Admin account can open Admin Proof Reader so it can
            // receive and process assignments once ALPHA ADMIN designates it.
            // This does not grant access to other restricted pages.
            if (isAlphaAdmin() || pageKey === 'matrixCompliances' || (pageKey === 'adminProofReader' && role === 'admin')) return true;
            const allowed = userAccessMap[user];
            if (!Array.isArray(allowed) || !allowed.length) return true; // empty = full access
            return allowed.includes(pageKey);
        }
        function applyAccessRestrictions() {
            // Hide sidebar nav buttons for pages the user is not allowed to access.
            const navMap = {
                'dashboard':'btnDashboard', 'home':'btnHome', 'personnel':'btnPersonnel',
                'activityManagement':'btnActivityManagement', 'matrixCompliances':'btnMatrixCompliances',
                'adminProofReader':'btnAdminProofReader', 'usersChat':'btnUsersChat', 'settings':'btnSettings'
            };
            Object.keys(navMap).forEach(key => {
                const btn = document.getElementById(navMap[key]);
                if (!btn) return;
                if (key === 'adminMgmt') {
                    // Keep this route exclusively available to Alpha Admin; the .hidden
                    // class controls visibility so no stale inline display rule can override it.
                    btn.classList.toggle('hidden', !isAlphaAdmin());
                    btn.style.removeProperty('display');
                    return;
                }
                btn.style.display = userHasAccess(key) ? '' : 'none';
            });
        }

        /* ---------- Squad Carousel: cover-flow + mouse wheel / drag scroll ---------- */
        let squadDragState = null;
        let squadDragged = false;
        function initSquadCarouselInteractions() {
            const c = document.getElementById('squadCarousel');
            if (!c) return;
            if (!c._squadFlowInit) {
                // Vertical mouse wheel scrolls the carousel horizontally.
                c.addEventListener('wheel', (e) => {
                    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                        e.preventDefault();
                        c.scrollLeft += e.deltaY;
                    }
                }, {passive: false});
                // Drag-to-scroll with the mouse.
                c.addEventListener('mousedown', (e) => {
                    squadDragState = {startX: e.pageX, scrollLeft: c.scrollLeft};
                    squadDragged = false;
                    c.style.cursor = 'grabbing';
                });
                c.addEventListener('mouseleave', () => { squadDragState = null; c.style.cursor = ''; });
                c.addEventListener('mouseup', () => { squadDragState = null; c.style.cursor = ''; });
                c.addEventListener('mousemove', (e) => {
                    if (!squadDragState) return;
                    e.preventDefault();
                    const dx = e.pageX - squadDragState.startX;
                    if (Math.abs(dx) > 5) squadDragged = true;
                    c.scrollLeft = squadDragState.scrollLeft - dx;
                });
                // Suppress the card-click detail modal after a drag gesture.
                c.addEventListener('click', (e) => {
                    if (squadDragged) { e.stopPropagation(); e.preventDefault(); }
                    squadDragged = false;
                }, true);
                c.addEventListener('scroll', () => updateSquadCarouselFlow(), {passive: true});
                window.addEventListener('resize', () => updateSquadCarouselFlow());
                c._squadFlowInit = true;
            }
            updateSquadCarouselFlow();
        }
        function updateSquadCarouselFlow() {
            const c = document.getElementById('squadCarousel');
            if (!c) return;
            const cards = c.querySelectorAll('.squad-card');
            if (!cards.length) return;
            const center = c.scrollLeft + c.clientWidth / 2;
            const maxDist = c.clientWidth / 2 + 300;
            cards.forEach(card => {
                const cardCenter = card.offsetLeft + card.offsetWidth / 2;
                const dist = Math.abs(cardCenter - center);
                const ratio = Math.min(dist / maxDist, 1);
                const scale = 1 - ratio * 0.20;       // centered card largest
                const opacity = 1 - ratio * 0.40;
                const z = 100 - Math.round(ratio * 90); // centered card in front
                card.style.transform = `scale(${scale}) translateY(${ratio * 8}px)`;
                card.style.opacity = opacity;
                card.style.zIndex = z;
                card.style.transition = 'transform 0.25s ease, opacity 0.25s ease, box-shadow 0.25s ease';
                card.classList.toggle('squad-card-active', ratio < 0.18);
            });
        }

        /* Leave modal: filter personnel dropdown by search query */
        let selectedLeavePersonnelIdx = '';
        function filterLeavePersonnel(query) {
            renderLeavePersonnelTable(query);
        }
        function renderLeavePersonnelTable(query) {
            const wrap = document.getElementById('leavePersonnelTable');
            if (!wrap) return;
            const q = String(query || '').toLowerCase().trim();
            const list = allPersonnel.map((p, i) => ({ idx: i, name: personnelFullName(p), section: p.section || '' }))
                .filter(o => !q || o.name.toLowerCase().includes(q) || String(o.section||'').toLowerCase().includes(q));
            if (!list.length) { wrap.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:12px;">No personnel found.</div>'; return; }
            wrap.innerHTML = list.map(o => `<div class="leave-personnel-row ${String(selectedLeavePersonnelIdx)===String(o.idx)?'selected':''}" onclick="selectLeavePersonnel(${o.idx})">
                <span>${escapeHtml(o.name)}</span><span style="margin-left:auto;font-size:11px;color:var(--text-muted);">${escapeHtml(o.section||'')}</span>
            </div>`).join('');
        }
        function selectLeavePersonnel(idx) {
            selectedLeavePersonnelIdx = String(idx);
            document.getElementById('leavePersonnelSelect').value = idx;
            const p = allPersonnel[Number(idx)];
            const selEl = document.getElementById('leavePersonnelSelected');
            if (selEl) { selEl.style.display = 'block'; selEl.innerText = '✓ Selected: ' + personnelFullName(p); }
            renderLeavePersonnelTable(document.getElementById('leavePersonnelSearch') ? document.getElementById('leavePersonnelSearch').value : '');
        }

        /* ---------- User Restriction (read-only mode) ---------- */
        let userRestrictedMap = {};
        async function loadUserRestrictions(forceRefresh = false) {
            await loadUserAccessContext(forceRefresh);
            updatePersonnelPermissions();
        }

        function toggleUserRestriction(username, restrict) {
            customConfirm(`${restrict ? 'Restrict (make read-only)' : 'Remove the read-only restriction from'} user "${username}"?`, async confirmed => {
                if (!confirmed) { loadAdminUsers(); return; }
                try {
                    const response = await fetch(API_URL, {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({
                        action:'set_user_restriction', username, restricted:!!restrict,
                        userName:localStorage.getItem('loggedInUser') || '', password:sessionAdminPass,
                        credential:localStorage.getItem('loggedCred') || ''
                    })});
                    const result = await response.json();
                    if (!result.success) { customAlert(result.error || 'Could not update this account restriction.', 'Error'); return; }
                    customAlert(`User "${username}" ${restrict ? 'is now restricted to read-only access.' : 'can edit again.'}`, 'Success');
                    await loadAdminUsers();
                } catch (error) { customAlert('Failed to update restriction. Please retry.', 'Error'); }
            });
        }

        /* ---------- Personnel Profile Card Modal ---------- */
        let profileCardPersonnelNo = null;
        let personnelNameCopyFeedbackTimer = null;
        async function copyPersonnelProfileName() {
            const nameElement = document.getElementById('profileCardName');
            const feedback = document.getElementById('profileCardCopyNameFeedback');
            const copyButton = document.getElementById('profileCardCopyNameBtn');
            const personnelName = String(nameElement?.textContent || '').trim();
            if (!personnelName || personnelName === 'Name' || personnelName === 'Personnel Profile') return;

            if (feedback) {
                feedback.textContent = '';
                feedback.classList.remove('is-visible', 'is-error');
            }
            if (personnelNameCopyFeedbackTimer) clearTimeout(personnelNameCopyFeedbackTimer);

            try {
                if (navigator.clipboard && window.isSecureContext && typeof navigator.clipboard.writeText === 'function') {
                    await navigator.clipboard.writeText(personnelName);
                } else {
                    const temporaryInput = document.createElement('textarea');
                    temporaryInput.value = personnelName;
                    temporaryInput.setAttribute('readonly', '');
                    temporaryInput.setAttribute('aria-hidden', 'true');
                    temporaryInput.style.position = 'fixed';
                    temporaryInput.style.left = '-9999px';
                    temporaryInput.style.top = '0';
                    temporaryInput.style.opacity = '0';
                    document.body.appendChild(temporaryInput);
                    temporaryInput.focus();
                    temporaryInput.select();
                    temporaryInput.setSelectionRange(0, temporaryInput.value.length);
                    const copied = document.execCommand('copy');
                    temporaryInput.remove();
                    if (!copied) throw new Error('Clipboard copy was not permitted');
                }

                if (feedback) {
                    feedback.textContent = 'Personnel name copied to clipboard.';
                    feedback.classList.add('is-visible');
                }
                if (copyButton) copyButton.setAttribute('aria-label', 'Copy personnel name again');
            } catch (error) {
                if (feedback) {
                    feedback.textContent = 'Copy was blocked. Please select the personnel name and copy it manually.';
                    feedback.classList.add('is-visible', 'is-error');
                }
                if (copyButton) copyButton.setAttribute('aria-label', 'Copy personnel name');
            }

            if (feedback) {
                personnelNameCopyFeedbackTimer = setTimeout(() => {
                    feedback.classList.remove('is-visible', 'is-error');
                    feedback.textContent = '';
                }, 3200);
            }
        }

        function openPersonnelProfile(no) {
            const p = allPersonnel.find(x => String(x.no) === String(no));
            if (!p) return;
            profileCardPersonnelNo = no;
            const fullName = personnelFullName(p);
            const initials = [p.firstName, p.lastName].map(v => String(v || '').trim()).filter(Boolean).map(v => v.charAt(0)).join('').slice(0,2);
            document.getElementById('profileCardAvatar').innerText = initials || String(p.rank || 'U').charAt(0);
            document.getElementById('profileCardName').innerText = fullName || 'Personnel Profile';
            const copyNameFeedback = document.getElementById('profileCardCopyNameFeedback');
            if (copyNameFeedback) {
                copyNameFeedback.textContent = '';
                copyNameFeedback.classList.remove('is-visible', 'is-error');
            }
            const copyNameButton = document.getElementById('profileCardCopyNameBtn');
            if (copyNameButton) copyNameButton.setAttribute('aria-label', 'Copy personnel name');
            document.getElementById('profileCardDesignation').innerText = [p.designation, p.section].filter(Boolean).join('  •  ') || 'No designation assigned';
            const meta = document.getElementById('profileCardMeta');
            if (meta) meta.innerHTML = `<span class="profile-card-status ${String(p.status || 'Active').toLowerCase().replace(/[^a-z]/g,'-')}"><i aria-hidden="true"></i>${escapeHtml(p.status || 'Active')}</span><span class="profile-card-number">Personnel No. ${escapeHtml(String(p.no || '—'))}</span>`;
            const body = document.getElementById('profileCardBody');
            const rows = [
                ['Badge Number', p.badgeNumber || '—'],
                ['Rank', p.rank || '—'],
                ['Full Name', [p.firstName, p.middleName, p.lastName, p.qualifiers].filter(Boolean).join(' ') || '—'],
                ['Designation', p.designation || '—'],
                ['Section', p.section || '—'],
                ['Contact Number', p.contactNo || '—'],
                ['Address', p.address || 'Not Provided'],
                ['Remarks', p.remarks || '—']
            ];
            body.innerHTML = rows.map(([label, value], i) => `<div class="profile-card-row"><span class="profile-card-row-icon" aria-hidden="true">${['▣','♙','▤','▧','⌂','☎','⌖','≡'][i]}</span><span class="profile-card-row-label">${label}</span><strong>${escapeHtml(String(value))}</strong></div>`).join('');
            const editButton = document.getElementById('profileCardEditBtn');
            const archiveButton = document.getElementById('profileCardArchiveBtn');
            const browseButton = document.getElementById('profileCardBrowseBtn');
            if (editButton) editButton.style.display = canPersonnelAction('list', 'edit') ? '' : 'none';
            if (archiveButton) archiveButton.style.display = canPersonnelAction('list', 'delete') ? '' : 'none';
            if (browseButton) browseButton.style.display = '';
            document.getElementById('personnelProfileModal').classList.remove('hidden');
        }
        function closePersonnelProfile() {
            document.getElementById('personnelProfileModal').classList.add('hidden');
            profileCardPersonnelNo = null;
            const feedback = document.getElementById('profileCardCopyNameFeedback');
            if (feedback) { feedback.textContent = ''; feedback.classList.remove('is-visible', 'is-error'); }
            if (personnelNameCopyFeedbackTimer) { clearTimeout(personnelNameCopyFeedbackTimer); personnelNameCopyFeedbackTimer = null; }
        }
        function editDetailsFromProfile() {
            const no = profileCardPersonnelNo;
            closePersonnelProfile();
            if (no != null) editPersonnel(no);
        }
        function archiveDetailsFromProfile() {
            const no = profileCardPersonnelNo;
            closePersonnelProfile();
            if (no != null) archivePersonnel(no);
        }
        /* ---------- Personnel Folder Browser ---------- */
        let currentFolderEntries = [];
        let currentPreviewEntry = null;
        let currentPreviewObjectUrl = null;
        let currentPreviewReturnFocus = null;
        let previewRequestSequence = 0;
        function formatFolderBytes(n) {
            const num = Number(n) || 0;
            if (num <= 0) return '0 B';
            const units = ['B', 'KB', 'MB', 'GB'];
            const i = Math.min(Math.floor(Math.log(num) / Math.log(1024)), units.length - 1);
            return (num / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + units[i];
        }

        async function fetchPersonnelFolderListing(no) {
            const res = await fetch(API_URL, {
                method:'POST', mode:'cors',
                headers:{'Content-Type':'text/plain;charset=utf-8'},
                body: JSON.stringify({
                    action:'list_personnel_folder',
                    username: localStorage.getItem('loggedInUser') || '',
                    credential: localStorage.getItem('loggedCred') || '',
                    personnelNo: no
                })
            });
            let data;
            try {
                data = await res.json();
            } catch (parseErr) {
                throw new Error('The server returned an invalid response. Please try again later.');
            }
            return data;
        }

        function renderFolderBrowserEntries(entries) {
            const list = document.getElementById('folderBrowserList');
            if (!list) return;
            currentFolderEntries = Array.isArray(entries) ? entries.slice() : [];
            if (!currentFolderEntries.length) {
                list.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted,#888);">No files in this folder yet. Use Upload below.</div>';
                return;
            }

            list.innerHTML = currentFolderEntries.map(function (e, i) {
                const name = String((e && e.name) || '');
                const isFolder = !!(e && e.isFolder);
                const size = isFolder ? '\u2014' : formatFolderBytes(e && e.size);
                const modRaw = (e && (e.server_modified || e.client_modified)) || '';
                let modified = '\u2014';
                if (modRaw) {
                    const parsed = new Date(modRaw);
                    modified = Number.isNaN(parsed.getTime()) ? String(modRaw) : parsed.toLocaleString();
                }
                const icon = isFolder ? '\uD83D\uDCC1' : '\uD83D\uDCC4';
                const secondary = size + ' \u00B7 ' + modified;
                const clickHandler = isFolder ? '' : ' onclick="openFilePreview(currentFolderEntries[' + i + '], &#39;personnel&#39;)"';
                const hoverHandlers = isFolder ? ''
                    : ' onmouseover="this.style.background=\'rgba(37,99,235,0.07)\'" onmouseout="this.style.background=\'\'"';
                const deleteButton = isFolder ? ''
                    : '<button type="button" class="folder-entry-delete" data-folder-delete="' + i + '" '
                        + 'onclick="event.stopPropagation();deletePersonnelFolderFile(' + i + ')" '
                        + 'title="Delete file" aria-label="Delete ' + escapeAttr(name) + '">' 
                        + '<i class="fi fi-rr-trash" aria-hidden="true"></i></button>';

                return '<div class="profile-card-row folder-entry-row" data-idx="' + i + '" style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;margin-bottom:6px;transition:background .15s;"' + hoverHandlers + '>'
                    + '<button type="button" class="folder-entry-main"' + clickHandler + (isFolder ? ' disabled aria-disabled="true"' : '') + '>'
                    + '<span class="folder-entry-name">' + icon + ' ' + escapeHtml(name) + '</span>'
                    + '<span class="folder-entry-meta">' + escapeHtml(secondary) + '</span>'
                    + '</button>' + deleteButton
                    + '</div>';
            }).join('');
        }

        function deletePersonnelFolderFile(index) {
            const entry = currentFolderEntries[index];
            const personnelNo = profileCardPersonnelNo;
            if (!entry || entry.isFolder || !entry.path_lower) {
                customAlert('Select a valid file to delete.', 'Delete File');
                return;
            }
            if (personnelNo == null) {
                customAlert('No personnel record is selected.', 'Delete File');
                return;
            }

            const fileName = String(entry.name || 'this file');
            const filePath = String(entry.path_lower);
            customConfirm('Permanently delete "' + fileName + '" from this personnel folder? This action cannot be undone.', async confirmed => {
                if (!confirmed) return;
                const status = document.getElementById('folderBrowserStatus');
                const deleteButton = document.querySelector('[data-folder-delete="' + index + '"]');
                if (deleteButton) deleteButton.disabled = true;
                if (status) status.textContent = 'Deleting ' + fileName + '\u2026';

                try {
                    const res = await fetch(API_URL, {
                        method:'POST', mode:'cors',
                        headers:{'Content-Type':'text/plain;charset=utf-8'},
                        body: JSON.stringify({
                            action:'delete_personnel_folder_file',
                            username: localStorage.getItem('loggedInUser') || '',
                            credential: localStorage.getItem('loggedCred') || '',
                            personnelNo: personnelNo,
                            path: filePath
                        })
                    });
                    const data = await res.json();
                    if (!data || !data.success) {
                        throw new Error((data && data.error) || 'The file could not be deleted.');
                    }

                    if (currentPreviewEntry && currentPreviewEntry.path_lower === filePath) closeFilePreview();
                    currentFolderEntries = currentFolderEntries.filter(item => String(item && item.path_lower || '') !== filePath);
                    renderFolderBrowserEntries(currentFolderEntries);
                    if (status) status.textContent = 'Deleted: ' + fileName;

                    // Refresh from Google Drive to ensure the displayed list matches the backend.
                    try {
                        const refreshed = await fetchPersonnelFolderListing(personnelNo);
                        if (refreshed && refreshed.success) renderFolderBrowserEntries(refreshed.entries || []);
                    } catch (refreshErr) {
                        console.warn('Personnel folder list refresh failed after file deletion:', refreshErr);
                    }
                    customAlert('The file "' + fileName + '" was deleted successfully.', 'Delete Complete');
                } catch (err) {
                    if (deleteButton && deleteButton.isConnected) deleteButton.disabled = false;
                    if (status) status.textContent = 'Delete failed: ' + ((err && err.message) || 'Please try again.');
                    customAlert((err && err.message) || 'The file could not be deleted. Please try again.', 'Delete Error');
                }
            });
        }

        async function openPersonnelFolderBrowser() {
            const no = profileCardPersonnelNo;
            if (no == null) return customAlert('No personnel selected.', 'Error');
            const modal = document.getElementById('personnelFolderBrowserModal');
            const list = document.getElementById('folderBrowserList');
            const title = document.getElementById('folderBrowserTitle');
            const uploadBtn = document.getElementById('personnelFolderUploadBtn');
            const status = document.getElementById('folderBrowserStatus');
            const p = allPersonnel.find(function (x) { return String(x.no) === String(no); });
            if (title) title.textContent = (p ? personnelFullName(p) : 'Personnel') + ' \u2014 Folder';
            if (list) list.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted,#888);">Loading\u2026</div>';
            if (status) status.textContent = '';
            if (uploadBtn) uploadBtn.disabled = true;
            if (modal) modal.classList.remove('hidden');
            try {
                const data = await fetchPersonnelFolderListing(no);
                if (data && data.success) {
                    renderFolderBrowserEntries(data.entries || []);
                    if (status && data.path) status.textContent = 'Path: ' + data.path;
                } else {
                    customAlert((data && data.error) ? data.error : 'Could not load folder.', 'Error');
                    closePersonnelFolderBrowser();
                }
            } catch (err) {
                const msg = (err && err.message && !/fetch|network|load failed/i.test(err.message))
                    ? err.message
                    : 'Could not reach the server. Please check your connection and try again.';
                customAlert(msg, 'Error');
                closePersonnelFolderBrowser();
            } finally {
                if (uploadBtn) uploadBtn.disabled = false;
            }
        }

        async function uploadFilesToPersonnelFolder() {
            const input = document.getElementById('personnelFolderFileInput');
            const files = (input && input.files) ? Array.from(input.files) : [];
            if (!files.length) return customAlert('Select files to upload.', 'Upload');
            const no = profileCardPersonnelNo;
            if (no == null) return customAlert('No personnel selected.', 'Error');
            const status = document.getElementById('folderBrowserStatus');
            const uploadBtn = document.getElementById('personnelFolderUploadBtn');
            if (uploadBtn) uploadBtn.disabled = true;
            let okCount = 0;
            const failures = [], reports = [];
            try {
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    if (status) status.textContent = 'Optimizing / preparing ' + file.name + ' (' + (i + 1) + '/' + files.length + ')…';
                    try {
                        const optimization = await spadesOptimizeUploadFile(file);
                        const uploadFile = optimization.file || file;
                        if (uploadFile.size > 10 * 1024 * 1024) throw new Error('file exceeds 10 MB and could not be reduced safely; choose a smaller file');
                        const rawBase64 = await readChatFileAsBase64(uploadFile);
                        if (status) status.textContent = 'Uploading ' + file.name + ' (' + (i + 1) + '/' + files.length + ')…';
                        const res = await fetch(API_URL, {
                            method:'POST', mode:'cors', headers:{'Content-Type':'text/plain;charset=utf-8'},
                            body: JSON.stringify({
                                action:'upload_to_personnel_folder', username:localStorage.getItem('loggedInUser') || '',
                                credential:localStorage.getItem('loggedCred') || '', personnelNo:no, fileName:file.name,
                                mimeType:uploadFile.type || file.type || 'application/octet-stream', base64:rawBase64
                            })
                        });
                        let data;
                        try { data = await res.json(); } catch (parseErr) { throw new Error('The server returned an invalid response.'); }
                        if (data && data.success) {
                            okCount++;
                            reports.push(file.name + ': ' + spadesUploadOptimizationLabel(optimization));
                        } else failures.push(file.name + ': ' + ((data && data.error) ? data.error : 'upload failed'));
                    } catch (err) { failures.push(file.name + ': ' + ((err && err.message) ? err.message : 'upload failed')); }
                }
            } finally {
                if (input) input.value = '';
                if (uploadBtn) uploadBtn.disabled = false;
            }
            const summary = okCount + ' uploaded' + (failures.length ? ', ' + failures.length + ' failed.' : '.');
            if (status) status.textContent = summary;
            customAlert(summary + (reports.length ? '\n\n' + reports.join('\n') : '') + (failures.length ? ('\n\nFailed:\n' + failures.join('\n')) : ''), 'Upload Result');
            try { const data = await fetchPersonnelFolderListing(no); if (data && data.success) renderFolderBrowserEntries(data.entries || []); } catch (_) {}
        }

        function closePersonnelFolderBrowser() {
            const modal = document.getElementById('personnelFolderBrowserModal');
            if (modal) modal.classList.add('hidden');
            const list = document.getElementById('folderBrowserList');
            if (list) list.innerHTML = '';
            const status = document.getElementById('folderBrowserStatus');
            if (status) status.textContent = '';
            const input = document.getElementById('personnelFolderFileInput');
            if (input) input.value = '';
        }

        /* ---------- My Files: authenticated account-owned Google Drive directory ---------- */
        const SPADES_ACCOUNT_FILE_MAX_BYTES = 10 * 1024 * 1024;
        let myFilesEntries = [];
        let myFilesReadOnly = false;
        let myFilesUploadQueue = [];
        let myFilesLoadSequence = 0;
        let myFilesLoading = false;
        let myFilesUploading = false;
        let myFilesSearchTerm = '';
        const myFilesPendingDeletes = new Set();

        async function callMyFilesApi(action, extra = {}) {
            const username = localStorage.getItem('loggedInUser') || '';
            const credential = localStorage.getItem('loggedCred') || '';
            if (!username || !credential) throw new Error('Your session could not be verified. Please sign in again.');
            const response = await fetch(API_URL, {
                method:'POST', mode:'cors',
                headers:{'Content-Type':'text/plain;charset=utf-8'},
                body:JSON.stringify({ action, username, credential, ...extra })
            });
            let data;
            try { data = await response.json(); }
            catch (error) { throw new Error('The server returned an invalid response. Please retry.'); }
            if (!response.ok || !data || !data.success) {
                throw new Error((data && data.error) || 'The file request could not be completed.');
            }
            return data;
        }

        function getFileExtension(name) {
            const value = String(name || '').trim().toLowerCase();
            const dot = value.lastIndexOf('.');
            return dot >= 0 ? value.slice(dot + 1) : '';
        }

        function getFileTypeLabel(entry) {
            const ext = getFileExtension(entry && entry.name);
            if (ext) return ext.toUpperCase() === 'XLXS' ? 'XLSX (XLXS)' : ext.toUpperCase();
            const mime = String((entry && entry.mimeType) || '').toLowerCase();
            if (mime.includes('pdf')) return 'PDF';
            if (mime.startsWith('image/')) return mime.split('/')[1].toUpperCase();
            if (mime.includes('word')) return 'WORD';
            if (mime.includes('spreadsheet')) return 'SPREADSHEET';
            if (mime.includes('presentation')) return 'PRESENTATION';
            return mime || 'FILE';
        }

        function openMyFilesModal() {
            const modal = document.getElementById('myFilesModal');
            if (!modal) return;
            modal.classList.remove('hidden');
            const user = localStorage.getItem('loggedInUser') || 'Signed-in user';
            const label = document.getElementById('myFilesAccountLabel');
            if (label) label.textContent = user;
            window.SPADESModalStack?.bringToFront('myFilesModal');
            loadMyFiles();
            window.requestAnimationFrame(() => modal.querySelector('[data-myfiles-refresh]')?.focus({preventScroll:true}));
        }

        function closeMyFilesModal() {
            const modal = document.getElementById('myFilesModal');
            if (modal) modal.classList.add('hidden');
            const input = document.getElementById('myFilesUploadInput');
            if (input) input.value = '';
            myFilesUploadQueue = [];
            renderMyFilesSelection();
            updateMyFilesUploadControls();
            document.querySelector('#tabProfile .pf-profile-quick-actions button[aria-label="My Files"]')?.focus({preventScroll:true});
        }

        function setMyFilesNotice(message, state = '') {
            const notice = document.getElementById('myFilesNotice');
            if (!notice) return;
            notice.textContent = message || '';
            notice.classList.remove('is-error', 'is-success', 'is-warning');
            if (state) notice.classList.add('is-' + state);
        }

        function updateMyFilesUploadProgress(current, total, phase, fileName = '', complete = false) {
            const wrap = document.getElementById('myFilesUploadProgress');
            const bar = document.getElementById('myFilesUploadProgressBar');
            const label = document.getElementById('myFilesUploadProgressLabel');
            const count = document.getElementById('myFilesUploadProgressCount');
            if (!wrap || !bar || !label || !count) return;
            const safeTotal = Math.max(1, Number(total) || 1);
            const percent = Math.max(0, Math.min(100, Math.round((Number(current) || 0) / safeTotal * 100)));
            wrap.classList.remove('hidden');
            bar.value = percent;
            count.textContent = percent + '%';
            label.textContent = complete ? 'Upload processing completed' : ((phase || 'Processing') + ' · ' + Math.min(Number(current) + 1, safeTotal) + ' of ' + safeTotal + (fileName ? ' · ' + fileName : ''));
        }

        function updateMyFilesCount() {
            const count = document.getElementById('myFilesCount');
            if (!count) return;
            const visibleCount = getFilteredMyFiles().length;
            count.textContent = visibleCount + (visibleCount === 1 ? ' file' : ' files');
        }

        function getFilteredMyFiles() {
            const query = String(myFilesSearchTerm || '').trim().toLowerCase();
            return myFilesEntries.map((entry, index) => ({entry, index})).filter(item => {
                if (!query) return true;
                return String(item.entry.name || '').toLowerCase().includes(query)
                    || getFileTypeLabel(item.entry).toLowerCase().includes(query);
            });
        }

        function filterMyFiles(value) {
            myFilesSearchTerm = String(value || '');
            renderMyFilesTable();
        }

        async function loadMyFiles() {
            const requestId = ++myFilesLoadSequence;
            myFilesLoading = true;
            updateMyFilesUploadControls();
            const body = document.getElementById('myFilesTableBody');
            const refreshButton = document.querySelector('#myFilesModal [data-myfiles-refresh]');
            if (refreshButton) { refreshButton.disabled = true; refreshButton.setAttribute('aria-busy', 'true'); }
            if (body && !body.querySelector('tr[data-myfiles-row]')) body.innerHTML = '<tr><td colspan="5" class="my-files-empty-cell"><span class="my-files-spinner"></span> Loading your account files…</td></tr>';
            setMyFilesNotice('Connecting securely to your account directory…');
            try {
                const result = await callMyFilesApi('list_user_files');
                if (requestId !== myFilesLoadSequence) return;
                myFilesReadOnly = !!result.restricted;
                // Only account-root files are displayed. System-managed folders remain separate.
                myFilesEntries = (Array.isArray(result.files) ? result.files : []).filter(item => item && !item.isFolder);
                renderMyFilesTable();
                const sizeText = myFilesEntries.length + (myFilesEntries.length === 1 ? ' file' : ' files');
                if (myFilesReadOnly) {
                    setMyFilesNotice('Read-only access is enabled for this account. Preview and download are available; upload and delete are disabled.', 'warning');
                } else {
                    setMyFilesNotice(sizeText + ' in your private account directory. Each upload may be up to 10 MB.', 'success');
                }
                updateMyFilesUploadControls();
            } catch (error) {
                if (requestId !== myFilesLoadSequence) return;
                myFilesEntries = [];
                myFilesReadOnly = true; // Fail closed until account permissions can be confirmed.
                renderMyFilesTable('Your files could not be loaded. ' + (error && error.message ? error.message : 'Please retry.'));
                setMyFilesNotice(error && error.message ? error.message : 'Could not load your files.', 'error');
            } finally {
                if (requestId === myFilesLoadSequence) {
                    myFilesLoading = false;
                    if (refreshButton) {
                        refreshButton.disabled = false;
                        refreshButton.removeAttribute('aria-busy');
                    }
                    updateMyFilesUploadControls();
                }
            }
        }

        function getMyFilesIconClass(ext) {
            if (ext === 'pdf') return 'file-type-pdf';
            if (['doc', 'docx', 'rtf'].includes(ext)) return 'file-type-word';
            if (['xls', 'xlsx', 'xlxs', 'csv'].includes(ext)) return 'file-type-sheet';
            if (['ppt', 'pptx'].includes(ext)) return 'file-type-slide';
            if (PREVIEWABLE_IMAGE_EXTS.includes(ext)) return 'file-type-image';
            return 'file-type-generic';
        }

        function renderMyFilesTable(errorMessage = '') {
            const body = document.getElementById('myFilesTableBody');
            if (!body) return;
            updateMyFilesCount();
            if (errorMessage) {
                body.innerHTML = '<tr><td colspan="5" class="my-files-empty-cell my-files-error-cell"><strong>Unable to load files</strong><span>' + escapeHtml(errorMessage) + '</span><button type="button" class="my-files-retry-btn" onclick="loadMyFiles()">Try again</button></td></tr>';
                return;
            }
            const visibleEntries = getFilteredMyFiles();
            if (!visibleEntries.length) {
                const isSearching = !!String(myFilesSearchTerm || '').trim();
                body.innerHTML = '<tr><td colspan="5" class="my-files-empty-cell"><span class="my-files-empty-icon"><i class="fi fi-rr-' + (isSearching ? 'search' : 'folder-open') + '" aria-hidden="true"></i></span><strong>' + (isSearching ? 'No matching files' : 'Your workspace is empty') + '</strong><span>' + (isSearching ? 'Try another search term.' : 'Click Upload files above or drag files into the upload area to get started.') + '</span></td></tr>';
                return;
            }
            body.innerHTML = visibleEntries.map(item => {
                const entry = item.entry;
                const index = item.index;
                const name = String(entry.name || 'Unnamed file');
                const ext = getFileExtension(name);
                const iconClass = getMyFilesIconClass(ext);
                const dateRaw = entry.modifiedAt || entry.modifiedTime || entry.server_modified || '';
                const parsedDate = dateRaw ? new Date(dateRaw) : null;
                const modified = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleString() : '—';
                const deleteAction = myFilesReadOnly ? '' : '<button type="button" class="my-files-row-action my-files-delete-action" data-file-index="' + index + '" data-file-action="delete" onclick="deleteMyFile(' + index + ')" title="Delete ' + escapeAttr(name) + '" aria-label="Delete ' + escapeAttr(name) + '"><i class="fi fi-rr-trash" aria-hidden="true"></i><span>Delete</span></button>';
                const previewAction = '<button type="button" class="my-files-row-action my-files-preview-action" data-file-index="' + index + '" data-file-action="preview" onclick="previewMyFile(' + index + ')" title="Preview ' + escapeAttr(name) + '" aria-label="Preview ' + escapeAttr(name) + '"><i class="fi fi-rr-eye" aria-hidden="true"></i><span>Preview</span></button>';
                const downloadAction = '<button type="button" class="my-files-row-action" data-file-index="' + index + '" data-file-action="download" onclick="downloadMyFile(' + index + ')" title="Download ' + escapeAttr(name) + '" aria-label="Download ' + escapeAttr(name) + '"><i class="fi fi-rr-download" aria-hidden="true"></i><span>Download</span></button>';
                return '<tr data-myfiles-row="' + index + '">'
                    + '<td class="my-files-name-cell"><span class="my-files-type-icon ' + iconClass + '"><i class="fi fi-rr-file" aria-hidden="true"></i></span><span class="my-files-name-wrap"><button type="button" class="my-files-file-name" onclick="previewMyFile(' + index + ')" title="Preview ' + escapeAttr(name) + '">' + escapeHtml(name) + '</button><small>' + escapeHtml(entry.id ? 'Stored in your account directory' : 'File identifier unavailable') + '</small></span></td>'
                    + '<td class="my-files-modified-cell">' + escapeHtml(modified) + '</td>'
                    + '<td class="my-files-size-cell">' + escapeHtml(formatFolderBytes(entry.size)) + '</td>'
                    + '<td><span class="my-files-type-pill">' + escapeHtml(getFileTypeLabel(entry)) + '</span></td>'
                    + '<td class="my-files-actions-cell"><div class="my-files-row-actions">' + previewAction + downloadAction + deleteAction + '</div></td></tr>';
            }).join('');
        }

        function renderMyFilesSelection() {
            const row = document.getElementById('myFilesSelectionRow');
            const text = document.getElementById('myFilesSelectionText');
            if (!row || !text) return;
            if (!myFilesUploadQueue.length) {
                row.hidden = true;
                text.textContent = '';
                return;
            }
            row.hidden = false;
            const names = myFilesUploadQueue.slice(0, 2).map(file => file.name).join(', ');
            const remainder = myFilesUploadQueue.length - Math.min(2, myFilesUploadQueue.length);
            const totalSize = myFilesUploadQueue.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
            text.textContent = myFilesUploadQueue.length + (myFilesUploadQueue.length === 1 ? ' file selected' : ' files selected') + ': ' + names + (remainder ? ' +' + remainder + ' more' : '') + ' · ' + formatFolderBytes(totalSize);
        }

        function setMyFilesUploadQueue(files, append = false) {
            const incoming = Array.from(files || []);
            myFilesUploadQueue = append ? myFilesUploadQueue.concat(incoming) : incoming;
            document.getElementById('myFilesUploadProgress')?.classList.add('hidden');
            renderMyFilesSelection();
            updateMyFilesUploadControls();
            if (!myFilesUploadQueue.length) return;
            const oversized = myFilesUploadQueue.filter(file => file.size > SPADES_ACCOUNT_FILE_MAX_BYTES);
            const empty = myFilesUploadQueue.filter(file => !file.size);
            if (oversized.length || empty.length) {
                setMyFilesNotice(oversized.length + ' large file(s) will be optimized where safely supported before the 10 MB limit is checked; ' + empty.length + ' empty file(s) will be skipped.', 'warning');
            } else {
                setMyFilesNotice(myFilesUploadQueue.length + ' file(s) selected. Supported images will be optimized automatically where this reduces size.', 'success');
            }
        }

        function openMyFilesFilePicker() {
            if (myFilesReadOnly || myFilesLoading || myFilesUploading) return;
            const input = document.getElementById('myFilesUploadInput');
            if (!input) return;
            input.value = '';
            input.click();
        }

        function handleMyFilesUploadSelection(input) {
            setMyFilesUploadQueue((input && input.files) || []);
        }

        function clearMyFilesSelection() {
            if (myFilesUploading) return;
            myFilesUploadQueue = [];
            const input = document.getElementById('myFilesUploadInput');
            if (input) input.value = '';
            renderMyFilesSelection();
            updateMyFilesUploadControls();
            setMyFilesNotice('File selection cleared.');
        }

        function handleMyFilesDragOver(event) {
            if (event) event.preventDefault();
            if (myFilesReadOnly || myFilesLoading || myFilesUploading) return;
            document.getElementById('myFilesDropzone')?.classList.add('is-dragging');
        }

        function handleMyFilesDragLeave(event) {
            if (event) event.preventDefault();
            const zone = document.getElementById('myFilesDropzone');
            if (zone && (!event.relatedTarget || !zone.contains(event.relatedTarget))) zone.classList.remove('is-dragging');
        }

        function handleMyFilesDrop(event) {
            if (event) event.preventDefault();
            const zone = document.getElementById('myFilesDropzone');
            zone?.classList.remove('is-dragging');
            if (myFilesReadOnly || myFilesLoading || myFilesUploading) return;
            const files = event && event.dataTransfer ? event.dataTransfer.files : null;
            if (files && files.length) setMyFilesUploadQueue(files, true);
        }

        function updateMyFilesUploadControls() {
            const upload = document.getElementById('myFilesUploadBtn');
            const input = document.getElementById('myFilesUploadInput');
            const clear = document.getElementById('myFilesClearSelection');
            const refresh = document.querySelector('#myFilesModal [data-myfiles-refresh]');
            const uploadLabel = document.getElementById('myFilesUploadBtnLabel');
            const busy = myFilesUploading || myFilesLoading;
            // The single Upload button doubles as the file picker when no files are queued.
            if (upload) upload.disabled = myFilesReadOnly || busy;
            if (input) input.disabled = myFilesReadOnly || busy;
            if (clear) clear.disabled = busy;
            if (refresh) refresh.disabled = busy || refresh.getAttribute('aria-busy') === 'true';
            const uploadStateLabel = myFilesUploading
                ? 'Uploading files'
                : (myFilesUploadQueue.length ? 'Upload ' + myFilesUploadQueue.length + (myFilesUploadQueue.length === 1 ? ' selected file' : ' selected files') : 'Choose files to upload');
            if (uploadLabel) uploadLabel.textContent = myFilesUploading ? 'Uploading…' : (myFilesUploadQueue.length ? 'Upload ' + myFilesUploadQueue.length + (myFilesUploadQueue.length === 1 ? ' file' : ' files') : 'Upload files');
            if (upload) {
                upload.setAttribute('aria-label', uploadStateLabel);
                upload.setAttribute('title', uploadStateLabel);
            }
            const dropzone = document.getElementById('myFilesDropzone');
            if (dropzone) dropzone.classList.toggle('is-readonly', myFilesReadOnly);
        }

        function arrayBufferToBase64(buffer) {
            const bytes = new Uint8Array(buffer);
            const chunkSize = 0x8000;
            let binary = '';
            for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                binary += String.fromCharCode.apply(null, bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
            }
            return btoa(binary);
        }

        async function uploadMyFiles() {
            if (myFilesReadOnly) return customAlert('This account is restricted to read-only access.', 'Upload Not Available');
            if (myFilesLoading || myFilesUploading) return;
            const files = myFilesUploadQueue.slice();
            if (!files.length) return openMyFilesFilePicker();
            const validFiles = files.filter(file => file && file.size > 0);
            const failures = files.filter(file => !file || !file.size).map(file => (file && file.name ? file.name : 'Selected file') + ': empty files are not accepted');
            if (!validFiles.length) {
                setMyFilesNotice('No non-empty files were selected.', 'warning');
                customAlert(failures.join('\n'), 'Upload Not Started');
                return;
            }
            myFilesUploading = true;
            updateMyFilesUploadControls();
            let uploaded = 0;
            const reports = [];
            updateMyFilesUploadProgress(0, validFiles.length, 'Preparing');
            try {
                for (let i = 0; i < validFiles.length; i++) {
                    const file = validFiles[i];
                    updateMyFilesUploadProgress(i, validFiles.length, 'Optimizing', file.name);
                    setMyFilesNotice('Optimizing / preparing ' + (i + 1) + ' of ' + validFiles.length + ': ' + file.name, '');
                    try {
                        const optimization = await spadesOptimizeUploadFile(file);
                        const uploadFile = optimization.file || file;
                        if (uploadFile.size > SPADES_ACCOUNT_FILE_MAX_BYTES) throw new Error('exceeds 10 MB and could not be reduced safely; choose a smaller file');
                        setMyFilesNotice('Uploading ' + (i + 1) + ' of ' + validFiles.length + ': ' + file.name, '');
                        const base64 = arrayBufferToBase64(await uploadFile.arrayBuffer());
                        await callMyFilesApi('upload_user_file', {
                            fileName:file.name, mimeType:uploadFile.type || file.type || 'application/octet-stream', base64
                        });
                        uploaded++;
                        reports.push(file.name + ' — ' + spadesUploadOptimizationLabel(optimization));
                    } catch (error) { failures.push(file.name + ': ' + (error && error.message ? error.message : 'upload failed')); }
                    updateMyFilesUploadProgress(i + 1, validFiles.length, 'Processed', file.name);
                }
            } finally {
                myFilesUploading = false;
                myFilesUploadQueue = [];
                const input = document.getElementById('myFilesUploadInput');
                if (input) input.value = '';
                renderMyFilesSelection();
                updateMyFilesUploadControls();
            }
            updateMyFilesUploadProgress(validFiles.length, validFiles.length, 'Completed', '', true);
            await loadMyFiles();
            const summary = uploaded + ' file(s) uploaded successfully.' + (failures.length ? ' ' + failures.length + ' file(s) could not be uploaded.' : '');
            const details = reports.concat(failures.map(item => 'FAILED — ' + item)).join(' | ');
            setMyFilesNotice(summary + (details ? ' ' + details : ''), failures.length ? 'warning' : 'success');
            if (uploaded || failures.length) customAlert(summary + (reports.length ? '\n\n' + reports.join('\n') : '') + (failures.length ? '\n\n' + failures.join('\n') : ''), 'Upload Result');
        }

        async function fetchMyAccountFile(fileId) {
            if (!fileId) throw new Error('The selected file has no valid account file identifier. Refresh the list and try again.');
            const result = await callMyFilesApi('get_user_file_content', { fileId:String(fileId) });
            if (!result.file || !result.file.base64) throw new Error('The server did not return the selected file content.');
            const binary = atob(result.file.base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return new Blob([bytes], {type:result.file.mimeType || 'application/octet-stream'});
        }

        function saveBlobToDevice(blob, fileName) {
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = String(fileName || 'download');
            anchor.rel = 'noopener';
            anchor.style.display = 'none';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => { try { URL.revokeObjectURL(objectUrl); } catch (_) {} }, 2500);
        }

        async function downloadMyFile(index) {
            const entry = myFilesEntries[index];
            if (!entry) return customAlert('Select a valid file to download.', 'Download File');
            const button = document.querySelector('#myFilesTableBody [data-file-index="' + index + '"][data-file-action="download"]');
            if (button && button.disabled) return;
            if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
            try {
                setMyFilesNotice('Preparing download: ' + entry.name, '');
                const blob = await fetchMyAccountFile(entry.id);
                saveBlobToDevice(blob, entry.name);
                setMyFilesNotice('Download started: ' + entry.name, 'success');
            } catch (error) {
                const message = error && error.message ? error.message : 'The file could not be downloaded.';
                customAlert(message, 'Download Error');
                setMyFilesNotice(message, 'error');
            } finally {
                if (button && button.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); }
            }
        }

        function previewMyFile(index) {
            const entry = myFilesEntries[index];
            if (!entry) return customAlert('Select a valid file to preview.', 'Preview File');
            if (!entry.id) return customAlert('This file has no valid account file identifier. Refresh the list and try again.', 'Preview Unavailable');
            setMyFilesNotice('Opening preview: ' + entry.name, '');
            openFilePreview(entry, 'account');
        }

        function deleteMyFile(index) {
            const entry = myFilesEntries[index];
            if (!entry) return customAlert('Select a valid file to delete.', 'Delete File');
            if (!entry.id) return customAlert('This file has no valid account file identifier. Refresh the list and try again.', 'Delete Unavailable');
            if (myFilesReadOnly) return customAlert('This account is restricted to read-only access.', 'Delete Not Available');
            if (myFilesPendingDeletes.has(String(entry.id))) return;
            myFilesPendingDeletes.add(String(entry.id));
            const button = document.querySelector('#myFilesTableBody [data-file-index="' + index + '"][data-file-action="delete"]');
            if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
            customConfirm('Move "' + String(entry.name || 'this file') + '" to Google Drive Trash? You can restore it later from Drive Trash.', async confirmed => {
                if (!confirmed) {
                    myFilesPendingDeletes.delete(String(entry.id));
                    if (button && button.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); }
                    return;
                }
                try {
                    setMyFilesNotice('Deleting ' + entry.name + '…', '');
                    await callMyFilesApi('delete_user_file', { fileId:String(entry.id) });
                    myFilesEntries = myFilesEntries.filter(item => String(item.id) !== String(entry.id));
                    renderMyFilesTable();
                    setMyFilesNotice('Deleted: ' + entry.name, 'success');
                    await loadMyFiles();
                    setMyFilesNotice('Deleted: ' + entry.name, 'success');
                } catch (error) {
                    const message = error && error.message ? error.message : 'The file could not be deleted.';
                    customAlert(message, 'Delete Error');
                    setMyFilesNotice(message, 'error');
                    if (button && button.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); }
                } finally {
                    myFilesPendingDeletes.delete(String(entry.id));
                }
            });
        }

        /* ---------- Shared File Preview: images, PDF and Office documents ---------- */
        const PREVIEWABLE_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        const PREVIEWABLE_OFFICE_EXTS = ['docx', 'xlsx', 'xlxs', 'pptx'];
        let currentPreviewSource = 'personnel';
        let currentPreviewBlob = null;
        let docxPreviewLibraryPromise = null;
        let xlsxPreviewLibraryPromise = null;
        let pptxPreviewLibraryPromise = null;
        let currentPptxRenderer = null;
        let currentPptxSlideIndex = 0;
        let currentXlsxWorkbook = null;
        let currentXlsxSheetIndex = 0;

        function entryExtension(entry) { return getFileExtension(entry && entry.name); }

        function entryModifiedLabel(entry) {
            const modRaw = (entry && (entry.modifiedAt || entry.server_modified || entry.client_modified)) || '';
            if (!modRaw) return 'Saved in SPADES';
            const parsed = new Date(modRaw);
            return Number.isNaN(parsed.getTime()) ? String(modRaw) : parsed.toLocaleString();
        }

        function revokePreviewObjectUrl() {
            if (currentPreviewObjectUrl) {
                try { URL.revokeObjectURL(currentPreviewObjectUrl); } catch (_) {}
                currentPreviewObjectUrl = null;
            }
        }

        function disposeOfficePreviewEngines() {
            if (currentPptxRenderer) {
                try { currentPptxRenderer.destroy(); } catch (_) {}
                currentPptxRenderer = null;
            }
            currentXlsxWorkbook = null;
            currentXlsxSheetIndex = 0;
        }

        function loadPreviewScript(scriptId, sourceUrl, readyCheck) {
            if (readyCheck && readyCheck()) return Promise.resolve();
            let existing = document.getElementById(scriptId);
            if (existing && existing.dataset.loaded === 'true' && (!readyCheck || readyCheck())) return Promise.resolve();
            if (existing && existing.dataset.promise === 'error') {
                existing.remove();
                existing = null;
            }
            if (existing && existing.dataset.promise === 'loading') {
                return new Promise((resolve, reject) => {
                    existing.addEventListener('load', resolve, {once:true});
                    existing.addEventListener('error', () => reject(new Error('Could not load the document preview library.')), {once:true});
                });
            }
            return new Promise((resolve, reject) => {
                const script = existing || document.createElement('script');
                script.id = scriptId;
                script.src = sourceUrl;
                script.async = true;
                script.dataset.promise = 'loading';
                script.onload = () => {
                    script.dataset.loaded = 'true';
                    script.dataset.promise = 'loaded';
                    if (readyCheck && !readyCheck()) reject(new Error('The document preview library loaded without its expected API.'));
                    else resolve();
                };
                script.onerror = () => {
                    script.dataset.promise = 'error';
                    reject(new Error('Could not load the document preview library. Check your internet connection or content filter.'));
                };
                if (!existing) document.head.appendChild(script);
            });
        }

        async function loadDocxPreviewLibrary() {
            if (!docxPreviewLibraryPromise) {
                docxPreviewLibraryPromise = (async () => {
                    await loadPreviewScript('spades-jszip-library', 'https://cdn.jsdelivr.net/npm/jszip@3.10.2/dist/jszip.min.js', () => !!window.JSZip);
                    await loadPreviewScript('spades-docx-preview-library', 'https://cdn.jsdelivr.net/npm/docx-preview@0.4.1/dist/docx-preview.min.js', () => !!(window.docx && window.docx.renderAsync));
                })().catch(error => { docxPreviewLibraryPromise = null; throw error; });
            }
            return docxPreviewLibraryPromise;
        }

        async function loadXlsxPreviewLibrary() {
            if (!xlsxPreviewLibraryPromise) {
                xlsxPreviewLibraryPromise = loadPreviewScript('spades-sheetjs-library', 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', () => !!(window.XLSX && window.XLSX.read))
                    .catch(error => { xlsxPreviewLibraryPromise = null; throw error; });
            }
            return xlsxPreviewLibraryPromise;
        }

        // ExcelJS is loaded only when a user explicitly requests an export.
        // It produces genuine .xlsx files with formatted headers, filters, and frozen panes.
        let spadesExcelJsExportPromise = null;
        async function loadSpadesExcelJsExportLibrary() {
            if (window.ExcelJS && typeof window.ExcelJS.Workbook === 'function') return;
            if (!spadesExcelJsExportPromise) {
                spadesExcelJsExportPromise = loadPreviewScript(
                    'spades-exceljs-export-library',
                    'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
                    () => !!(window.ExcelJS && typeof window.ExcelJS.Workbook === 'function')
                ).catch(error => { spadesExcelJsExportPromise = null; throw error; });
            }
            return spadesExcelJsExportPromise;
        }

        async function downloadSpadesExcelWorkbook(options) {
            const config = options || {};
            const headers = Array.isArray(config.headers) ? config.headers : [];
            const rows = Array.isArray(config.rows) ? config.rows : [];
            if (!headers.length) throw new Error('The Excel export has no column headings.');
            if (!rows.length) throw new Error('There are no records to export.');
            await loadSpadesExcelJsExportLibrary();
            const workbook = new window.ExcelJS.Workbook();
            workbook.creator = 'RHSU SPADES';
            workbook.lastModifiedBy = 'RHSU SPADES';
            workbook.created = new Date();
            workbook.modified = new Date();
            workbook.subject = 'RHSU SPADES register export';
            workbook.title = String(config.title || config.sheetName || 'SPADES Export');
            const sheet = workbook.addWorksheet(String(config.sheetName || 'Records').slice(0,31), {
                views:[{state:'frozen', ySplit:1}],
                pageSetup:{fitToPage:true, fitToWidth:1, fitToHeight:0, orientation:'landscape'}
            });
            sheet.columns = headers.map((header, index) => ({
                header:String(header || ''),
                key:'c' + index,
                width:Array.isArray(config.widths) && Number(config.widths[index]) > 0 ? Number(config.widths[index]) : 18
            }));
            rows.forEach(row => sheet.addRow(Array.isArray(row) ? row : headers.map((_, index) => row['c' + index] ?? '')));
            const header = sheet.getRow(1);
            header.height = 28;
            header.eachCell(cell => {
                cell.font = {name:'Aptos', size:10, bold:true, color:{argb:'FFFFFFFF'}};
                cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF173F70'}};
                cell.alignment = {vertical:'middle', horizontal:'center', wrapText:true};
                cell.border = {bottom:{style:'medium', color:{argb:'FF0F2747'}}};
            });
            for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
                const row = sheet.getRow(rowNumber);
                row.height = 22;
                row.eachCell(cell => {
                    cell.font = {name:'Aptos', size:10, color:{argb:'FF1F2937'}};
                    cell.alignment = {vertical:'top', wrapText:true};
                    cell.border = {bottom:{style:'hair', color:{argb:'FFDCE3EC'}}};
                    if (rowNumber % 2 === 0) cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FFF3F6FA'}};
                });
            }
            sheet.autoFilter = {from:{row:1, column:1}, to:{row:1, column:headers.length}};
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
            saveBlobToDevice(blob, String(config.fileName || 'SPADES_Export.xlsx'));
            return {rowCount:rows.length, fileName:String(config.fileName || 'SPADES_Export.xlsx')};
        }

        async function loadPptxPreviewLibrary() {
            if (!pptxPreviewLibraryPromise) {
                pptxPreviewLibraryPromise = import('https://cdn.jsdelivr.net/npm/pptx-browser@4.1.5/+esm')
                    .then(module => {
                        if (!module || typeof module.PptxRenderer !== 'function') throw new Error('The PowerPoint preview engine is unavailable.');
                        return module;
                    })
                    .catch(error => { pptxPreviewLibraryPromise = null; throw new Error('Could not load the PowerPoint preview engine. ' + (error && error.message ? error.message : '')); });
            }
            return pptxPreviewLibraryPromise;
        }

        function renderPreviewInfoBlock(entry, message) {
            const size = (entry && entry.isFolder) ? '—' : formatFolderBytes(entry && entry.size);
            const type = getFileTypeLabel(entry);
            return '<div class="file-preview-info-card">'
                + '<div class="file-preview-info-icon"><i class="fi fi-rr-file" aria-hidden="true"></i></div>'
                + '<strong class="file-preview-info-name">' + escapeHtml(String((entry && entry.name) || '')) + '</strong>'
                + '<div class="file-preview-info-meta"><span>' + escapeHtml(size) + '</span><span>' + escapeHtml(type) + '</span><span>' + escapeHtml(entryModifiedLabel(entry)) + '</span></div>'
                + '<p>' + escapeHtml(message) + '</p>'
                + '</div>';
        }

        async function fetchPersonnelFolderFile(entry) {
            const username = localStorage.getItem('loggedInUser') || '';
            const credential = localStorage.getItem('loggedCred') || '';
            if (!username || !credential || profileCardPersonnelNo == null) throw new Error('The selected personnel folder session could not be verified.');
            const response = await fetch(API_URL, {
                method:'POST', mode:'cors',
                headers:{'Content-Type':'text/plain;charset=utf-8'},
                body:JSON.stringify({
                    action:'get_personnel_folder_file_content',
                    username, credential,
                    personnelNo:profileCardPersonnelNo,
                    path:String(entry.path_lower || entry.id || '')
                })
            });
            let result;
            try { result = await response.json(); }
            catch (error) { throw new Error('The server returned an invalid file response.'); }
            if (!response.ok || !result || !result.success || !result.file || !result.file.base64) {
                throw new Error((result && result.error) || 'The personnel document could not be retrieved.');
            }
            const binary = atob(result.file.base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return new Blob([bytes], {type:result.file.mimeType || 'application/octet-stream'});
        }

        async function loadPreviewBlob(entry, source) {
            if (source === 'account') return fetchMyAccountFile(entry.id);
            return fetchPersonnelFolderFile(entry);
        }

        function base64PreviewBlob(base64, mimeType) {
            const binary = atob(String(base64 || ''));
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return new Blob([bytes], {type:mimeType || 'application/octet-stream'});
        }

        async function loadOfficePreviewPdfBlob(entry, source) {
            let result;
            if (source === 'account') {
                result = await callMyFilesApi('preview_user_file_pdf', {fileId:String(entry.id || '')});
            } else {
                const username = localStorage.getItem('loggedInUser') || '';
                const credential = localStorage.getItem('loggedCred') || '';
                if (!username || !credential || profileCardPersonnelNo == null) throw new Error('The selected personnel folder session could not be verified.');
                const response = await fetch(API_URL, {
                    method:'POST', mode:'cors',
                    headers:{'Content-Type':'text/plain;charset=utf-8'},
                    body:JSON.stringify({
                        action:'preview_personnel_folder_file_pdf',
                        username, credential,
                        personnelNo:profileCardPersonnelNo,
                        path:String(entry.path_lower || entry.id || '')
                    })
                });
                try { result = await response.json(); }
                catch (_) { throw new Error('The server returned an invalid Office preview response.'); }
                if (!response.ok || !result || !result.success) throw new Error((result && result.error) || 'The Office document could not be converted for preview.');
            }
            if (!result || !result.file || !result.file.base64) throw new Error('The server did not return a PDF preview.');
            const blob = base64PreviewBlob(result.file.base64, result.file.mimeType || 'application/pdf');
            if (!blob.size) throw new Error('The converted PDF preview is empty.');
            if (blob.size > SPADES_ACCOUNT_FILE_MAX_BYTES) throw new Error('The converted PDF preview exceeds the 10 MB preview limit.');
            return blob;
        }

        function setFilePreviewFooterNote(message) {
            const note = document.querySelector('#filePreviewModal .file-preview-local-note');
            if (note) note.textContent = message || '';
        }

        function addOfficeFallbackNotice(content) {
            if (!content) return;
            const notice = document.createElement('div');
            notice.className = 'office-preview-fallback-note';
            notice.textContent = 'This is a browser-rendered fallback. Some advanced layout, embedded objects, or formatting may differ from the original. Use Download for the untouched file.';
            content.insertBefore(notice, content.firstChild);
        }

        function renderOfficePdfPreview(blob, content, fileName) {
            currentPreviewObjectUrl = URL.createObjectURL(blob);
            content.classList.remove('is-centered');
            content.innerHTML = '<div class="office-pdf-preview-shell"><iframe class="file-preview-pdf" src="' + escapeAttr(currentPreviewObjectUrl) + '#toolbar=1&navpanes=1&scrollbar=1" title="' + escapeAttr(fileName || 'Office document') + ' PDF preview" loading="eager"></iframe></div>';
        }

        async function renderDocxPreview(blob, content, requestSequence) {
            await loadDocxPreviewLibrary();
            if (requestSequence !== previewRequestSequence) return;
            content.classList.remove('is-centered');
            content.innerHTML = '<div class="office-document-shell"><div id="docxPreviewOutput" class="docx-preview-output"></div></div>';
            const output = document.getElementById('docxPreviewOutput');
            await window.docx.renderAsync(blob, output, output, {
                className:'spades-docx',
                inWrapper:true,
                breakPages:true,
                ignoreWidth:false,
                ignoreHeight:false,
                ignoreFonts:false,
                ignoreLastRenderedPageBreak:false,
                useBase64URL:true,
                renderHeaders:true,
                renderFooters:true,
                renderFootnotes:true,
                renderEndnotes:true,
                renderComments:false,
                renderAltChunks:false,
                experimental:true,
                debug:false
            });
        }

        function renderXlsxSheetByIndex(index) {
            if (!currentXlsxWorkbook || !Array.isArray(currentXlsxWorkbook.SheetNames)) return;
            currentXlsxSheetIndex = Math.max(0, Math.min(Number(index) || 0, currentXlsxWorkbook.SheetNames.length - 1));
            const content = document.getElementById('previewContent');
            const sheetName = currentXlsxWorkbook.SheetNames[currentXlsxSheetIndex];
            if (!content || !sheetName) return;
            const sheet = currentXlsxWorkbook.Sheets[sheetName];
            const tableHost = content.querySelector('#xlsxSheetPreviewTable');
            if (!tableHost) return;
            if (!sheet || !sheet['!ref']) {
                tableHost.innerHTML = '<div class="xlsx-empty-sheet">This worksheet is empty.</div>';
            } else {
                const XLSX = window.XLSX;
                const sourceRange = XLSX.utils.decode_range(sheet['!ref']);
                const end = { r:Math.min(sourceRange.e.r, 749), c:Math.min(sourceRange.e.c, 39) };
                const displaySheet = Object.assign({}, sheet, { '!ref':XLSX.utils.encode_range({s:sourceRange.s, e:end}) });
                if (Array.isArray(sheet['!merges'])) {
                    displaySheet['!merges'] = sheet['!merges'].filter(range => range.s.r <= end.r && range.s.c <= end.c && range.e.r <= end.r && range.e.c <= end.c);
                }
                const html = XLSX.utils.sheet_to_html(displaySheet, { id:'spadesXlsxSheetTable', editable:false });
                tableHost.innerHTML = html || '<div class="xlsx-empty-sheet">This worksheet is empty.</div>';
                const table = tableHost.querySelector('table');
                if (table) table.classList.add('xlsx-preview-table');
                const truncated = sourceRange.e.r > 749 || sourceRange.e.c > 39;
                const limitNote = content.querySelector('.xlsx-limit-note');
                if (limitNote) limitNote.textContent = truncated ? 'Preview limited to the first 750 rows and 40 columns. Download the original workbook to view the complete worksheet.' : 'Worksheet preview';
            }
            content.querySelectorAll('[data-xlsx-sheet-index]').forEach(button => {
                button.classList.toggle('is-active', Number(button.dataset.xlsxSheetIndex) === currentXlsxSheetIndex);
            });
        }

        async function renderXlsxPreview(blob, content, requestSequence) {
            await loadXlsxPreviewLibrary();
            if (requestSequence !== previewRequestSequence) return;
            const workbook = window.XLSX.read(await blob.arrayBuffer(), { type:'array', cellDates:true, cellStyles:true, cellNF:true, cellFormula:true, bookImages:true });
            if (requestSequence !== previewRequestSequence) return;
            currentXlsxWorkbook = workbook;
            content.classList.remove('is-centered');
            if (!workbook.SheetNames || !workbook.SheetNames.length) {
                content.innerHTML = '<div class="file-preview-info-card"><strong>No worksheets found.</strong></div>';
                return;
            }
            const tabs = workbook.SheetNames.map((name, index) => '<button type="button" class="xlsx-sheet-tab ' + (index === 0 ? 'is-active' : '') + '" data-xlsx-sheet-index="' + index + '" onclick="renderXlsxSheetByIndex(' + index + ')">' + escapeHtml(name) + '</button>').join('');
            content.innerHTML = '<div class="xlsx-preview-shell"><div class="xlsx-preview-toolbar"><div class="xlsx-sheet-tabs">' + tabs + '</div><span class="xlsx-limit-note">Worksheet preview</span></div><div id="xlsxSheetPreviewTable" class="xlsx-sheet-table-host"></div></div>';
            renderXlsxSheetByIndex(0);
        }

        async function renderPptxSlide(index, requestSequence) {
            if (!currentPptxRenderer || requestSequence !== previewRequestSequence) return;
            const canvas = document.getElementById('pptxSlideCanvas');
            const label = document.getElementById('pptxSlideCounter');
            const previous = document.getElementById('pptxPreviousSlide');
            const next = document.getElementById('pptxNextSlide');
            if (!canvas) return;
            currentPptxSlideIndex = Math.max(0, Math.min(index, currentPptxRenderer.slideCount - 1));
            if (label) label.textContent = 'Slide ' + (currentPptxSlideIndex + 1) + ' of ' + currentPptxRenderer.slideCount;
            if (previous) previous.disabled = currentPptxSlideIndex <= 0;
            if (next) next.disabled = currentPptxSlideIndex >= currentPptxRenderer.slideCount - 1;
            canvas.setAttribute('aria-label', 'PowerPoint slide ' + (currentPptxSlideIndex + 1));
            await currentPptxRenderer.renderSlide(currentPptxSlideIndex, canvas, 1280);
        }

        function changePptxSlide(delta) {
            renderPptxSlide(currentPptxSlideIndex + Number(delta || 0), previewRequestSequence).catch(error => {
                const content = document.getElementById('previewContent');
                if (content) content.innerHTML = renderPreviewInfoBlock(currentPreviewEntry, 'The selected slide could not be rendered. ' + (error && error.message ? error.message : ''));
            });
        }

        async function renderPptxPreview(blob, content, requestSequence) {
            const module = await loadPptxPreviewLibrary();
            if (requestSequence !== previewRequestSequence) return;
            currentPptxRenderer = new module.PptxRenderer();
            await currentPptxRenderer.load(blob);
            if (requestSequence !== previewRequestSequence) { disposeOfficePreviewEngines(); return; }
            if (!currentPptxRenderer.slideCount) throw new Error('No slides were found in this presentation.');
            content.classList.remove('is-centered');
            content.innerHTML = '<div class="pptx-preview-shell"><div class="pptx-preview-toolbar"><button type="button" id="pptxPreviousSlide" onclick="changePptxSlide(-1)" disabled>‹ Previous</button><span id="pptxSlideCounter">Slide 1</span><button type="button" id="pptxNextSlide" onclick="changePptxSlide(1)">Next ›</button></div><div class="pptx-slide-stage"><canvas id="pptxSlideCanvas"></canvas></div></div>';
            await renderPptxSlide(0, requestSequence);
        }

        async function openFilePreview(entry, source = 'personnel') {
            if (!entry) return;
            currentPreviewReturnFocus = document.activeElement;
            const requestSequence = ++previewRequestSequence;
            currentPreviewEntry = entry;
            currentPreviewSource = source === 'account' ? 'account' : 'personnel';
            currentPreviewBlob = null;
            revokePreviewObjectUrl();
            disposeOfficePreviewEngines();
            const modal = document.getElementById('filePreviewModal');
            const nameEl = document.getElementById('previewFileName');
            const metaEl = document.getElementById('previewMeta');
            const content = document.getElementById('previewContent');
            const downloadBtn = document.getElementById('previewDownloadBtn');
            if (downloadBtn) downloadBtn.disabled = !!entry.isFolder;
            const name = String(entry.name || 'File');
            if (nameEl) nameEl.textContent = name;
            if (metaEl) metaEl.textContent = (entry.isFolder ? 'Folder' : formatFolderBytes(entry.size)) + ' · ' + getFileTypeLabel(entry) + ' · ' + entryModifiedLabel(entry);
            setFilePreviewFooterNote('Original file download is always preserved.');
            if (content) {
                content.classList.add('is-centered');
                content.innerHTML = '<div class="file-preview-loading"><span class="my-files-spinner"></span><span>Preparing secure preview…</span></div>';
            }
            if (modal) modal.classList.remove('hidden');
            window.SPADESModalStack?.bringToFront('filePreviewModal');

            const ext = entryExtension(entry);
            const isImage = PREVIEWABLE_IMAGE_EXTS.includes(ext);
            const isPdf = ext === 'pdf';
            const isDocx = ext === 'docx';
            const isXlsx = ext === 'xlsx' || ext === 'xlxs';
            const isPptx = ext === 'pptx';
            const isOffice = isDocx || isXlsx || isPptx;
            if (entry.isFolder || (!isImage && !isPdf && !isOffice)) {
                if (content) content.innerHTML = renderPreviewInfoBlock(entry, entry.isFolder
                    ? 'This is a folder. Open My Files to view the files saved in your account directory.'
                    : 'This file type is not supported for inline preview. Use Download to save the original file.');
                return;
            }

            try {
                // Office files are first converted server-side to a private PDF preview.
                // This preserves page breaks, embedded images, tables, headers/footers,
                // slide composition, and spreadsheet print layout much better than a
                // text-only browser reconstruction. The source Office file is untouched.
                if (isOffice) {
                    try {
                        const previewPdf = await loadOfficePreviewPdfBlob(entry, currentPreviewSource);
                        if (requestSequence !== previewRequestSequence || currentPreviewEntry !== entry) return;
                        renderOfficePdfPreview(previewPdf, content, name);
                        setFilePreviewFooterNote('Page-layout preview. Download returns the untouched original Office file.');
                        return;
                    } catch (conversionError) {
                        if (requestSequence !== previewRequestSequence || currentPreviewEntry !== entry) return;
                        // Fallback to the in-browser renderers if the Drive conversion
                        // service is unavailable or the file contains unsupported content.
                        const fallbackBlob = await loadPreviewBlob(entry, currentPreviewSource);
                        if (requestSequence !== previewRequestSequence || currentPreviewEntry !== entry) return;
                        if (!fallbackBlob || !fallbackBlob.size) throw new Error('The selected Office file is empty or could not be read.');
                        if (fallbackBlob.size > SPADES_ACCOUNT_FILE_MAX_BYTES) throw new Error('This file exceeds the 10 MB preview/download limit.');
                        currentPreviewBlob = fallbackBlob;
                        if (isDocx) {
                            await renderDocxPreview(fallbackBlob, content, requestSequence);
                        } else if (isXlsx) {
                            await renderXlsxPreview(fallbackBlob, content, requestSequence);
                        } else if (isPptx) {
                            await renderPptxPreview(fallbackBlob, content, requestSequence);
                        }
                        if (requestSequence !== previewRequestSequence || currentPreviewEntry !== entry) return;
                        addOfficeFallbackNotice(content);
                        setFilePreviewFooterNote('Fallback view only. Some formatting may differ; Download returns the untouched original.');
                        return;
                    }
                }

                const blob = await loadPreviewBlob(entry, currentPreviewSource);
                if (requestSequence !== previewRequestSequence || currentPreviewEntry !== entry) return;
                if (!blob || !blob.size) throw new Error('The selected file is empty or could not be read.');
                if (blob.size > SPADES_ACCOUNT_FILE_MAX_BYTES) throw new Error('This file exceeds the 10 MB preview/download limit.');
                currentPreviewBlob = blob;
                if (isImage) {
                    currentPreviewObjectUrl = URL.createObjectURL(blob);
                    content.classList.add('is-centered');
                    content.innerHTML = '<img class="file-preview-image" src="' + escapeAttr(currentPreviewObjectUrl) + '" alt="' + escapeAttr(name) + '">';
                } else if (isPdf) {
                    currentPreviewObjectUrl = URL.createObjectURL(blob);
                    content.classList.add('is-centered');
                    content.innerHTML = '<iframe class="file-preview-pdf" src="' + escapeAttr(currentPreviewObjectUrl) + '#toolbar=1&navpanes=1&scrollbar=1' + '" title="' + escapeAttr(name) + '" loading="eager"></iframe>';
                }
            } catch (error) {
                if (requestSequence !== previewRequestSequence || currentPreviewEntry !== entry) return;
                if (content) content.innerHTML = renderPreviewInfoBlock(entry, 'Preview unavailable. ' + (error && error.message ? error.message : 'The file could not be rendered. Use Download to save the original.'));
                setFilePreviewFooterNote('Preview unavailable. Download remains available for the original file.');
            }
        }

        async function downloadPreviewFile() {
            const entry = currentPreviewEntry;
            if (!entry) return customAlert('No file selected.', 'Error');
            if (entry.isFolder) return customAlert('Select a file rather than a folder to download.', 'Download');
            const btn = document.getElementById('previewDownloadBtn');
            if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
            try {
                const blob = currentPreviewBlob || await loadPreviewBlob(entry, currentPreviewSource);
                if (!blob || !blob.size) throw new Error('The selected file could not be retrieved.');
                saveBlobToDevice(blob, entry.name || 'download');
            } catch (error) {
                customAlert((error && error.message) ? error.message : 'Download failed. Please try again.', 'Download Error');
            } finally {
                if (btn) { btn.disabled = !!(entry && entry.isFolder); btn.removeAttribute('aria-busy'); }
            }
        }

        function closeFilePreview() {
            previewRequestSequence++;
            const modal = document.getElementById('filePreviewModal');
            if (modal) modal.classList.add('hidden');
            revokePreviewObjectUrl();
            disposeOfficePreviewEngines();
            currentPreviewBlob = null;
            const content = document.getElementById('previewContent');
            if (content) content.innerHTML = '';
            const meta = document.getElementById('previewMeta');
            if (meta) meta.textContent = '';
            currentPreviewEntry = null;
            const returnFocus = currentPreviewReturnFocus;
            currentPreviewReturnFocus = null;
            if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') {
                window.requestAnimationFrame(() => returnFocus.focus({preventScroll:true}));
            }
        }

/* Admin Proof Reader is loaded from script/admin-proof-reader.js. */

/* Preserve list scroll/visible-record position across all data-loading entry points. */
(function installSpadesListLoaderWrappers() {
    'use strict';
    const names = [
        'loadData', 'loadAdminUsers', 'loadPersonnel', 'loadAllPersonnelManagementData',
        'loadDutySequence', 'loadBmiRecords', 'loadSquads', 'loadLeaveEntries', 'loadAreas',
        'loadActivities', 'loadMatrixCompliances', 'loadMyFiles', 'loadSpadesBackupList',
        'loadChatUsers', 'fetchPersonnelFolderListing', 'fetchActivityLogs',
        'loadExecutiveDashboard', 'populateProfileData'
    ];

    names.forEach(name => {
        const original = window[name];
        if (typeof original !== 'function' || original.__spadesListViewportWrapped) return;
        const wrapped = function (...args) {
            const snapshot = window.SPADESListViewport?.capture?.();
            let result;
            try {
                result = original.apply(this, args);
            } catch (error) {
                window.SPADESListViewport?.restore?.(snapshot);
                throw error;
            }
            if (result && typeof result.then === 'function') {
                return result.finally(() => window.SPADESListViewport?.restore?.(snapshot));
            }
            window.SPADESListViewport?.restore?.(snapshot);
            return result;
        };
        Object.defineProperty(wrapped, '__spadesListViewportWrapped', {value: true});
        window[name] = wrapped;
    });
})();

