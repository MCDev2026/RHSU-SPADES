const API_URL = "https://script.google.com/macros/s/AKfycbx42FXBvP2w42kl5XO9ICUAf04mJqqHLcVfSsEC9Ku8bcYWd5KZ2S1H_zzGWs8zE-kS/exec";
        const ALPHA_ADMIN_NAME = "PCpl Gandia"; 
        let sessionAdminPass = ""; 
        let pendingAction = null;
        let pendingAdminAction = null;
        let actionTargetControl = null;
        
        let allMemos = [];
        let filteredMemos = [];
        let currentMemoPage = 1;
        
        let MEMOS_PER_PAGE = 10;
        let activityRefreshTimer = null;
        let autoLogoutTimer = null;
        const NOTIFICATION_SOUNDS = [
            { file: 'Notif1.mp3', label: 'Notif1 (Default)' },
            { file: 'Notif2.mp3', label: 'Notif2' },
            { file: 'Alert.mp3', label: 'Alert' }
            // Add additional MP3 files placed in the sounds folder here, for example:
            // ,{ file: 'Notif2.mp3', label: 'Notif2' }
            // ,{ file: 'Alert.mp3', label: 'Alert' }
        ];
        const DEFAULT_NOTIFICATION_SOUND = 'Notif1.mp3';
        const DEFAULT_USER_SETTINGS = { theme: 'Light', sidebar: 'Collapsed', tableDisplay: 'Comfortable', liveNotif: true, notifSound: true, notificationSound: DEFAULT_NOTIFICATION_SOUND, recordsPerPage: '10', rememberSearch: false, showChatbot: true, autoOpenChatbot: false, autoLogout: 'Never', confirmLogout: true, fontSize: 'Default', reducedMotion: false, highContrast: false, autoRefresh: true, refreshInterval: '60', confirmActions: true, language: 'English', dateFormat: 'US', time24: false };
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
        const CHAT_MINIMIZED_MAX = 6;
        let chatUnreadCount = 0;
        const chatUnreadByConversation = Object.create(null);
        let minimizedChatInstances = [];

        let allActivities = [];
        let filteredActivities = [];
        let archivedActivities = [];
        let filteredArchivedActivities = [];
        let currentActivityPage = 1;
        let currentArchivedActivityPage = 1;
        let activityEditId = null;
        let activityReminderTimer = null;
        let activeActivityReminder = null;
        const ACTIVITY_REMINDER_OFFSETS = [12 * 60 * 60 * 1000, 6 * 60 * 60 * 1000, 1 * 60 * 60 * 1000];
        const ACTIVITY_REMINDER_LABELS = { [12 * 60 * 60 * 1000]:'12 hours', [6 * 60 * 60 * 1000]:'6 hours', [1 * 60 * 60 * 1000]:'1 hour' };
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
            document.getElementById('setTheme').value = userSettings.theme || 'Light';
            document.getElementById('setSidebar').value = userSettings.sidebar || 'Collapsed';
            document.getElementById('setTableDisplay').value = userSettings.tableDisplay || 'Comfortable';
            document.getElementById('setLiveNotif').checked = userSettings.liveNotif;
            document.getElementById('setNotifSound').checked = userSettings.notifSound !== false;
            populateNotificationSoundOptions();
            const soundSelect = document.getElementById('setNotificationSound');
            if (soundSelect) soundSelect.value = getValidNotificationSound(userSettings.notificationSound);
            document.getElementById('setRecordsPage').value = userSettings.recordsPerPage;
            document.getElementById('setRemSearch').checked = userSettings.rememberSearch;
            document.getElementById('setShowChat').checked = userSettings.showChatbot;
            document.getElementById('setAutoChat').checked = userSettings.autoOpenChatbot;
            document.getElementById('setAutoLogout').value = userSettings.autoLogout;
            document.getElementById('setConfirmLogout').checked = userSettings.confirmLogout;
            document.getElementById('setFontSize').value = userSettings.fontSize || 'Default';
            document.getElementById('setReducedMotion').checked = !!userSettings.reducedMotion;
            document.getElementById('setHighContrast').checked = !!userSettings.highContrast;
            document.getElementById('setAutoRefresh').checked = userSettings.autoRefresh !== false;
            document.getElementById('setRefreshInterval').value = userSettings.refreshInterval || '60';
            document.getElementById('setConfirmActions').checked = userSettings.confirmActions !== false;
            document.getElementById('setLanguage').value = userSettings.language || 'English';
            document.getElementById('setDateFormat').value = userSettings.dateFormat || 'US';
            document.getElementById('set24Hour').checked = !!userSettings.time24;
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
            userSettings.autoLogout = document.getElementById('setAutoLogout').value;
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
            if (userSettings.theme === 'Dark' || (userSettings.theme === 'System' && window.matchMedia('(prefers-color-scheme: dark)').matches)) body.classList.add('dark-mode'); else body.classList.remove('dark-mode');
            if (userSettings.tableDisplay === 'Compact') body.classList.add('compact-mode'); else body.classList.remove('compact-mode');
            body.classList.toggle('rhsu-font-large', userSettings.fontSize === 'Large');
            body.classList.toggle('rhsu-font-xlarge', userSettings.fontSize === 'ExtraLarge');
            body.classList.toggle('rhsu-reduced-motion', !!userSettings.reducedMotion);
            body.classList.toggle('rhsu-high-contrast', !!userSettings.highContrast);

            const sb = document.getElementById('navSidebar');
            const appLayout = document.getElementById('appLayout');
            if (window.innerWidth > 992) {
                // v8: sidebar rests collapsed (icon-only); labels slide-fade in on hover.
                userSettings.sidebar = 'Collapsed';
                sb.classList.add('collapsed');
                if (appLayout) appLayout.classList.add('nav-collapsed');
                const setSidebarSel = document.getElementById('setSidebar');
                if (setSidebarSel) setSidebarSel.value = 'Collapsed';
            } else if (appLayout) {
                appLayout.classList.remove('nav-collapsed');
            }

            MEMOS_PER_PAGE = parseInt(userSettings.recordsPerPage, 10) || 10;
            if (filteredMemos && filteredMemos.length > 0) renderMemoTable();

            const bot = document.getElementById('chatbot-container');
            if(userSettings.showChatbot) bot.classList.remove('hidden'); else bot.classList.add('hidden');
            resetIdleTimer();
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
            if (userSettings.autoLogout !== 'Never') {
                let minutes = parseInt(userSettings.autoLogout, 10);
                if (!isNaN(minutes) && minutes > 0) {
                    autoLogoutTimer = setTimeout(() => { customAlert("Your session has expired due to inactivity.", "Session Expired"); logoutUser(true); }, minutes * 60000);
                }
            }
        }

        function toggleNav() {
            const sidebar = document.getElementById('navSidebar');
            if (window.innerWidth <= 992) sidebar.classList.toggle('open');
            else {
                sidebar.classList.toggle('collapsed');
                const collapsed = sidebar.classList.contains('collapsed');
                const appLayout = document.getElementById('appLayout');
                if (appLayout) appLayout.classList.toggle('nav-collapsed', collapsed);
                userSettings.sidebar = collapsed ? 'Collapsed' : 'Expanded';
                const user = localStorage.getItem('loggedInUser');
                if(user) { document.getElementById('setSidebar').value = userSettings.sidebar; persistUserSettings(user); }
            }
        }

        function updateDateTime() { const now = new Date(); const options = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }; document.getElementById('datetime-display').innerText = now.toLocaleString('en-US', options); }
        setInterval(updateDateTime, 1000); updateDateTime();

        function showNotification(title, message, onClickAction) {
            playNotificationSound();
            const container = document.getElementById('notificationContainer');
            const toast = document.createElement('div'); toast.className = 'notification-toast';
            toast.innerHTML = `<span class="notification-title">${title}</span><span class="notification-msg">${message}</span>`;
            const timeout = setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 300); }, 5000);
            toast.addEventListener('click', () => { clearTimeout(timeout); toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 300); if (onClickAction) onClickAction(); });
            container.appendChild(toast);
        }

        function customAlert(message, title = "System Notification") { showNotification(title, message); }
        function customConfirm(message, callback) { document.getElementById('customConfirmMessage').innerText = message; document.getElementById('customConfirmModal').classList.remove('hidden'); document.getElementById('customConfirmYesBtn').onclick = () => { document.getElementById('customConfirmModal').classList.add('hidden'); callback(true); }; document.getElementById('customConfirmNoBtn').onclick = () => { document.getElementById('customConfirmModal').classList.add('hidden'); callback(false); }; }

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
                await fetch(API_URL, {
                    method: 'POST',
                    mode: 'no-cors',
                    body: JSON.stringify({ action: 'log_activity', user: user, actionText: actionText })
                });
                // Refresh after the backend has had time to append the log; the normal polling
                // timer continues to keep every user's dashboard current.
                setTimeout(fetchActivityLogs, 1200);
            } catch (err) {}
        }

        async function fetchActivityLogs() {
            try {
                // Cache-busting ensures every poll asks the backend for the latest log dataset.
                const res = await fetch(API_URL + "?action=get_activity_logs&_ts=" + Date.now(), { cache: 'no-store' });
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

        function activityReminderKey(activity, offset) {
            return `rhsuActivityReminder:${activity.id}:${activity.date}:${activity.time}:${offset}`;
        }

        function activityReminderStoppedKey(activity) {
            return `rhsuActivityReminderStopped:${activity.id}:${activity.date}:${activity.time}`;
        }

        function parseActivityDateTime(activity) {
            const dateKey = String(activity.date || '').slice(0,10);
            const timeKey = activityTimeForInput(activity.time);
            if (!dateKey || !timeKey) return NaN;
            const d = new Date(`${dateKey}T${timeKey}:00`);
            return d.getTime();
        }

        function checkActivityReminders() {
            if (!localStorage.getItem('loggedInUser')) return;
            const now = Date.now();

            for (const activity of (Array.isArray(allActivities) ? allActivities : [])) {
                if (String(activity.status || '').toLowerCase() !== 'recurring') continue;
                const start = parseActivityDateTime(activity);
                if (!Number.isFinite(start) || start <= now) continue;

                const stoppedKey = activityReminderStoppedKey(activity);
                if (localStorage.getItem(stoppedKey) === 'true') continue;

                for (const offset of ACTIVITY_REMINDER_OFFSETS) {
                    const reminderAt = start - offset;
                    const key = activityReminderKey(activity, offset);
                    const snoozeUntil = Number(localStorage.getItem(`${key}:snoozeUntil`) || 0);

                    if (now < reminderAt || now > start || localStorage.getItem(key) === 'shown') continue;
                    if (snoozeUntil && now < snoozeUntil) continue;

                    localStorage.setItem(key, 'shown');
                    activeActivityReminder = { activity, offset, key };
                    document.getElementById('activityReminderTitle').innerText = activity.activityTitle || 'Upcoming Activity';
                    document.getElementById('activityReminderMessage').innerHTML =
                        `<div><strong>${escapeHtml(ACTIVITY_REMINDER_LABELS[offset] || '')} before the scheduled activity.</strong></div>
                         <div style="margin-top:8px;"><strong>Date:</strong> ${escapeHtml(activity.date)}</div>
                         <div><strong>Time:</strong> ${escapeHtml(formatActivityTime(activity.time))}</div>
                         <div><strong>Venue:</strong> ${escapeHtml(activity.assignedVenue)}</div>
                         <div><strong>Requesting Office:</strong> ${escapeHtml(activity.requestingOffice)}</div>`;
                    document.getElementById('activityReminderModal').classList.remove('hidden');
                    return;
                }
            }
        }

        function closeActivityReminder() {
            document.getElementById('activityReminderModal').classList.add('hidden');
            activeActivityReminder = null;
        }

        function snoozeActivityReminder(minutes = 10) {
            if (activeActivityReminder) {
                localStorage.setItem(`${activeActivityReminder.key}:snoozeUntil`, String(Date.now() + minutes * 60 * 1000));
                localStorage.removeItem(activeActivityReminder.key);
            }
            closeActivityReminder();
        }

        function stopActivityReminder() {
            if (activeActivityReminder) {
                localStorage.setItem(activityReminderStoppedKey(activeActivityReminder.activity), 'true');
            }
            closeActivityReminder();
        }

        function startActivityReminderMonitor() {
            if (activityReminderTimer) clearInterval(activityReminderTimer);
            checkActivityReminders();
            activityReminderTimer = setInterval(checkActivityReminders, 30000);
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
                return `<button type="button" class="chat-user-item" onclick="openUsersChatWindow('private','${escapeAttr(u.username)}')" role="menuitem">
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
            if (file.size > CHAT_MAX_ATTACHMENT_BYTES) {
                event.target.value = '';
                clearChatAttachment();
                return customAlert('The selected file is larger than 10 MB. Please choose a smaller file.', 'Attachment');
            }
            chatAttachmentFile = file;
            const wrap = document.getElementById('usersChatAttachment');
            const name = document.getElementById('usersChatAttachmentName');
            if (name) name.textContent = `${file.name} · ${formatChatFileSize(file.size)}`;
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
            const url = String(message?.attachmentUrl || '').trim();
            const name = String(message?.attachmentName || '').trim();
            if (!url || !name) return '';
            return `<a class="chat-attachment-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" title="Open attachment">
                <span aria-hidden="true">📎</span><span>${escapeHtml(name)}</span>
            </a>`;
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
            if (btn) { btn.disabled = true; btn.innerText = 'Sending...'; }
            try {
                const auth = chatCredentialPayload();
                let attachment = null;
                if (chatAttachmentFile) {
                    const base64 = await readChatFileAsBase64(chatAttachmentFile);
                    attachment = {
                        name: chatAttachmentFile.name,
                        mimeType: chatAttachmentFile.type || 'application/octet-stream',
                        size: chatAttachmentFile.size,
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
                if (btn) { btn.disabled = false; btn.innerText = 'Send'; }
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
                openUsersChatWindow('private', String(message.sender || ''));
            } else {
                openUsersChatWindow('global');
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

        function chatConversationLabel(mode, username) {
            if (mode !== 'private') return 'Global Chat';
            const target = String(username || '').trim();
            const found = chatUsers.find(u => String(u.username || '') === target);
            return found?.name ? `Private: ${found.name}` : `Private: ${target || 'Chat'}`;
        }

        function renderMinimizedChatStack() {
            const stack = document.getElementById('usersChatMinimizedStack');
            if (!stack) return;

            stack.innerHTML = minimizedChatInstances.map(item => {
                const unread = Math.max(0, Number(item.unread) || 0);
                const label = chatConversationLabel(item.mode, item.username);
                const key = escapeAttr(item.key);
                return `<div class="users-chat-minimized-item" data-chat-key="${key}">
                    <button type="button" class="users-chat-minimized-open" title="Restore ${escapeAttr(label)}" aria-label="Restore ${escapeAttr(label)}">
                        <span class="users-chat-minimized-avatar">💬</span>
                        <span class="users-chat-minimized-label">${escapeHtml(label)}</span>
                        ${unread ? `<span class="users-chat-minimized-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
                    </button>
                    <button type="button" class="users-chat-minimized-close" title="Remove minimized chat" aria-label="Remove minimized chat">×</button>
                </div>`;
            }).join('');

            stack.querySelectorAll('.users-chat-minimized-item').forEach(itemEl => {
                const key = itemEl.getAttribute('data-chat-key') || '';
                const record = minimizedChatInstances.find(item => item.key === key);
                itemEl.querySelector('.users-chat-minimized-open')?.addEventListener('click', () => {
                    if (!record) return;
                    minimizedChatInstances = minimizedChatInstances.filter(item => item.key !== key);
                    renderMinimizedChatStack();
                    openUsersChatWindow(record.mode, record.username);
                });
                itemEl.querySelector('.users-chat-minimized-close')?.addEventListener('click', event => {
                    event.stopPropagation();
                    minimizedChatInstances = minimizedChatInstances.filter(item => item.key !== key);
                    renderMinimizedChatStack();
                });
            });
        }

        function addMinimizedChatInstance(mode = chatMode, username = chatSelectedUser, unreadDelta = 0) {
            const key = chatConversationKey(mode, username);
            let item = minimizedChatInstances.find(entry => entry.key === key);
            if (!item) {
                item = { key, mode: mode === 'private' ? 'private' : 'global', username: mode === 'private' ? String(username || '') : '', unread: 0 };
                minimizedChatInstances.unshift(item);
            } else {
                minimizedChatInstances = [item, ...minimizedChatInstances.filter(entry => entry.key !== key)];
            }
            item.unread = Math.max(0, (Number(item.unread) || 0) + (Number(unreadDelta) || 0));
            if (minimizedChatInstances.length > CHAT_MINIMIZED_MAX) minimizedChatInstances = minimizedChatInstances.slice(0, CHAT_MINIMIZED_MAX);
            renderMinimizedChatStack();
        }

        function markChatConversationUnread(mode, username) {
            const key = chatConversationKey(mode, username);
            chatUnreadByConversation[key] = (Number(chatUnreadByConversation[key]) || 0) + 1;
            chatUnreadCount += 1;
            addMinimizedChatInstance(mode, username, 1);
            updateChatUnreadBadge();
        }

        function markChatConversationRead(mode, username) {
            const key = chatConversationKey(mode, username);
            const amount = Math.max(0, Number(chatUnreadByConversation[key]) || 0);
            if (amount) chatUnreadCount = Math.max(0, chatUnreadCount - amount);
            delete chatUnreadByConversation[key];
            minimizedChatInstances = minimizedChatInstances.filter(item => item.key !== key);
            updateChatUnreadBadge();
            renderMinimizedChatStack();
        }

        function resetChatUnreadState() {
            chatUnreadCount = 0;
            Object.keys(chatUnreadByConversation).forEach(key => delete chatUnreadByConversation[key]);
            minimizedChatInstances = [];
            updateChatUnreadBadge();
            renderMinimizedChatStack();
        }

        function isCurrentChatConversation(mode, username) {
            const win = document.getElementById('usersChatFloatingWindow');
            if (!win || win.classList.contains('hidden')) return false;
            if (mode === 'private') return chatMode === 'private' && String(chatSelectedUser || '') === String(username || '');
            return chatMode === 'global';
        }

        function toggleUsersChatDropdown(event, forceState) {
            if (event) event.stopPropagation();
            const dropdown = document.getElementById('usersChatDropdown');
            const button = document.getElementById('usersChatHeaderBtn');
            if (!dropdown) return;
            const shouldOpen = typeof forceState === 'boolean' ? forceState : dropdown.classList.contains('hidden');
            dropdown.classList.toggle('hidden', !shouldOpen);
            button?.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
            if (shouldOpen) {
                chatUsersLoaded = false;
                loadChatUsers();
                setTimeout(() => document.getElementById('chatDropdownUserSearch')?.focus(), 0);
            }
        }

        function closeUsersChatWindow() {
            const win = document.getElementById('usersChatFloatingWindow');
            win?.classList.add('hidden');
            win?.setAttribute('aria-hidden', 'true');
            renderMinimizedChatStack();
        }

        function minimizeUsersChatWindow() {
            const win = document.getElementById('usersChatFloatingWindow');
            if (!win || win.classList.contains('hidden')) return;
            if (chatMode === 'private' && !chatSelectedUser) return;
            addMinimizedChatInstance(chatMode, chatSelectedUser, 0);
            win.classList.add('hidden');
            win.setAttribute('aria-hidden', 'true');
            if (chatMessagesTimer) {
                clearInterval(chatMessagesTimer);
                chatMessagesTimer = null;
            }
        }

        function openUsersChatWindow(mode = 'global', username = '') {
            if (mode === 'private' && !username) return;
            chatMode = mode === 'private' ? 'private' : 'global';
            chatSelectedUser = chatMode === 'private' ? String(username) : '';
            markChatConversationRead(chatMode, chatSelectedUser);
            document.getElementById('usersChatFloatingWindow')?.classList.remove('hidden');
            document.getElementById('usersChatFloatingWindow')?.setAttribute('aria-hidden', 'false');
            toggleUsersChatDropdown(null, false);
            setChatMode(chatMode);
            if (chatMode === 'private') renderChatUserList();
            document.getElementById('usersChatInput')?.focus();
            if (chatMessagesTimer) clearInterval(chatMessagesTimer);
            chatMessagesTimer = setInterval(() => {
                const win = document.getElementById('usersChatFloatingWindow');
                if (!win || win.classList.contains('hidden')) {
                    clearInterval(chatMessagesTimer);
                    chatMessagesTimer = null;
                    return;
                }
                loadChatMessages();
                if (!chatUsersLoaded) loadChatUsers();
            }, 5000);
        }

        function startUsersChat() {
            chatUsersLoaded = false;
            loadChatUsers();
        }

        document.addEventListener('click', function(event) {
            const wrap = document.getElementById('headerChatWrap');
            const dropdown = document.getElementById('usersChatDropdown');
            if (wrap && dropdown && !wrap.contains(event.target) && !dropdown.classList.contains('hidden')) {
                toggleUsersChatDropdown(null, false);
            }
        });

        function toggleChat() { const window = document.getElementById('chatbot-window'); window.classList.toggle('hidden'); if(!window.classList.contains('hidden')) document.getElementById('chatInput').focus(); }
        function handleChat(e) {
            if (e.key === 'Enter') {
                const input = document.getElementById('chatInput'); const text = input.value.trim(); if (!text) return;
                const chatBox = document.getElementById('chatMessages'); chatBox.innerHTML += `<div class="chat-msg user">${text}</div>`; input.value = "";
                setTimeout(() => { const response = getChatbotResponse(text.toLowerCase()); chatBox.innerHTML += `<div class="chat-msg bot">${response}</div>`; chatBox.scrollTop = chatBox.scrollHeight; }, 500);
            }
        }
        function getChatbotResponse(query) {
            if (query.includes('memo')) return "To manage memos, go to the Home Page tab. Regular users can create and generate control numbers, while Admins can edit and update records.";
            if (query.includes('admin')) return "Admin Management is strictly accessible to the Alpha Admin to configure user roles.";
            if (query.includes('profile') || query.includes('password') || query.includes('pin')) return "You can change your PIN, password, or username securely by opening your Profile Settings.";
            if (query.includes('setting') || query.includes('theme') || query.includes('dark mode')) return "You can adjust Theme, Notifications, AI behaviors, Auto Logout inside Settings.";
            return "I am a polite system assistant. I can guide you on creating memos, settings, or managing your profile.";
        }

        function toggleAuthViews(viewId) { document.getElementById('loginPage').classList.add('hidden'); document.getElementById('registerPage').classList.add('hidden'); document.getElementById('appLayout').classList.add('hidden'); document.getElementById('mainTopBar').classList.add('hidden'); document.getElementById(viewId).classList.remove('hidden'); }
        function toggleInputType(inputId, type) { const input = document.getElementById(inputId); if (type === 'pin') { input.placeholder = "Enter 6-Digit PIN"; input.setAttribute("maxlength", "6"); } else { input.placeholder = "Enter Password"; input.removeAttribute("maxlength"); } input.value = ""; }

        function applyProfilePhotos(profileUrl) {
            const av = document.getElementById('profileAvatarImg');
            const fb = document.getElementById('profileAvatarFallback');
            if (!av || !fb) return;
            if (profileUrl) {
                // Set the fallback first, then reveal the image only after it loads successfully.
                fb.style.display = 'flex';
                av.onload = function () { av.style.display = 'block'; fb.style.display = 'none'; };
                av.onerror = function () { av.style.display = 'none'; fb.style.display = 'flex'; };
                av.src = profileUrl;
            } else {
                av.removeAttribute('src');
                av.style.display = 'none';
                fb.style.display = 'flex';
            }
        }
        async function uploadProfilePhoto(type, inputEl) {
            const file = inputEl.files && inputEl.files[0];
            if (!file) return;
            if (file.size > 4 * 1024 * 1024) { customAlert("Image too large. Please use an image under 4 MB.", "Validation"); inputEl.value=''; return; }
            const reader = new FileReader();
            reader.onload = async function(e) {
                const payload = {
                    action: 'upload_photo',
                    username: localStorage.getItem('loggedInUser') || '',
                    credential: localStorage.getItem('loggedCred') || '',
                    photoType: 'profile',
                    mime: file.type || 'image/jpeg',
                    dataBase64: e.target.result
                };
                try {
                    const res = await fetch(API_URL, { method:'POST', mode:'cors', headers:{'Content-Type':'text/plain'}, body: JSON.stringify(payload) });
                    const data = await res.json();
                    if (data && data.success && data.url) {
                        applyProfilePhotos(data.url);
                        customAlert('Profile photo updated successfully.', 'Success');
                    } else {
                        customAlert((data && data.error) ? data.error : 'Photo upload failed. Please try again.', 'Error');
                    }
                } catch (err) { customAlert('Photo upload failed. Please try again.', 'Error'); }
                inputEl.value = '';
            };
            reader.readAsDataURL(file);
        }
        function renderProfileRecentMemos(username) {
            const box = document.getElementById('profileRecentMemos');
            if (!box) return;
            const mine = (allMemos || []).filter(m => String(m[3]||'').trim() === username).slice(-5).reverse();
            if (!mine.length) { box.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">No memos created yet.</span>'; return; }
            box.innerHTML = mine.map(m => `<div style="padding:10px 0;border-bottom:1px solid var(--border-color);display:grid;grid-template-columns:minmax(0,1fr);gap:4px;"><strong style="color:var(--text-main);overflow-wrap:anywhere;">${escapeHtml(String(m[1]||'(no subject)'))}</strong><span style="color:var(--text-muted);font-size:11px;">Date: ${escapeHtml(String(m[0]||'—'))}</span><span style="color:var(--primary);font-size:11px;font-weight:600;overflow-wrap:anywhere;">Control No.: ${escapeHtml(String(m[2]||'—'))}</span></div>`).join('');
        }
        async function viewUserProfile(username) {
            try {
                const res = await fetch(`${API_URL}?action=get_user_profile&username=${encodeURIComponent(username)}`);
                const data = await res.json();
                if (!data || !data.success || !data.profile) { customAlert('Profile not found.', 'Error'); return; }
                const p = data.profile;
                const fullName = [p.rank, p.firstName, p.middleName, p.lastName, p.qlf].filter(Boolean).join(' ') || p.username;
                document.getElementById('viewProfileName').innerText = fullName;
                document.getElementById('viewProfileUsername').innerText = p.username;
                document.getElementById('viewProfileRole').innerText = p.role || 'Regular User';
                document.getElementById('viewTotalMemos').innerText = (p.totalMemos != null) ? p.totalMemos : 0;
                const av = document.getElementById('viewAvatarImg'); const fb = document.getElementById('viewAvatarFallback');
                if (p.profilePhotoUrl) { av.src = p.profilePhotoUrl; av.style.display='block'; fb.style.display='none'; } else { av.style.display='none'; fb.style.display='flex'; fb.innerText = String(fullName.charAt(0)||'U').toUpperCase(); }
                const cv = document.getElementById('viewCoverBanner');
                if (p.coverPhotoUrl) cv.style.backgroundImage = `url("${p.coverPhotoUrl}")`; else cv.style.backgroundImage = '';
                const fbInitial = document.getElementById('viewAvatarFallback'); if (fbInitial && !p.profilePhotoUrl) fbInitial.innerText = String(fullName.charAt(0)||'U').toUpperCase();
                const rows = [['Rank', p.rank], ['First Name', p.firstName], ['Middle Name', p.middleName], ['Last Name', p.lastName], ['Qualifier', p.qlf], ['Email', p.email], ['Role', p.role], ['Total Memos', p.totalMemos]];
                document.getElementById('viewProfileInfo').innerHTML = rows.map(([k,v]) => `<div class="setting-row" style="margin:0;"><span>${k}</span><span class="profile-value">${escapeHtml(v || '—')}</span></div>`).join('');
                document.getElementById('userProfileViewModal').classList.remove('hidden');
            } catch (err) { customAlert('Could not load profile.', 'Error'); }
        }
        function closeUserProfileView() { document.getElementById('userProfileViewModal').classList.add('hidden'); }

        async function populateProfileData() {
            const currentUser = localStorage.getItem('loggedInUser') || 'Unknown';
            document.getElementById('profUsername').innerText = currentUser;
            
            let displayRole = "Regular User";
            if (currentUser === ALPHA_ADMIN_NAME) {
                displayRole = "Alpha Admin";
            } else {
                displayRole = localStorage.getItem('userRole') || (localStorage.getItem('canEdit') === 'Yes' ? 'Admin' : 'Regular User');
            }
            document.getElementById('profAccType').innerText = displayRole;
            const nameParts = [localStorage.getItem('profileFirstName') || '', localStorage.getItem('profileLastName') || ''].filter(Boolean);
            const profileDisplay = document.getElementById('profileDisplayName'); if (profileDisplay) profileDisplay.innerText = nameParts.join(' ') || currentUser;
            const avatar = document.getElementById('profileAvatar'); if (avatar) avatar.innerText = String((nameParts.join(' ') || currentUser).trim().charAt(0) || 'U').toUpperCase();
            const roleBadge = document.getElementById('profileRoleBadge'); if (roleBadge) roleBadge.innerText = displayRole;
            const access = document.getElementById('profAccessLevel'); if (access) access.innerText = currentUser === ALPHA_ADMIN_NAME ? 'Full Administrative Access' : (localStorage.getItem('canEdit') === 'Yes' || localStorage.getItem('userRole') === 'Admin' ? 'Administrative Editing' : 'Standard User');
            loadProfilePreferences();
            
            try {
                const res = await fetch(`${API_URL}?action=get_profile&username=${encodeURIComponent(currentUser)}`); const data = await res.json();
                if (data.success && data.profile) {
                    const updateField = (id, val) => { const el = document.getElementById(id); el.innerText = val || 'Not Available'; if(val) el.style.color = 'var(--text-main)'; };
                    updateField('profRank', data.profile.rank); updateField('profFirstName', data.profile.firstName); updateField('profMiddleName', data.profile.middleName); updateField('profLastName', data.profile.lastName); updateField('profQlf', data.profile.qlf); updateField('profEmail', data.profile.email);
                    applyProfilePhotos(data.profile.profilePhotoUrl);
                    const pfFull = [data.profile.rank, data.profile.firstName, data.profile.middleName, data.profile.lastName, data.profile.qlf].filter(Boolean).join(' ');
                    if (pfFull) { const dn2 = document.getElementById('profileDisplayName'); if (dn2) dn2.innerText = pfFull; const fb2 = document.getElementById('profileAvatarFallback'); if (fb2) fb2.innerText = String(pfFull.charAt(0)||'U').toUpperCase(); }
                }
            } catch (err) {}

            let userMemos = 0; let lastAct = "Not Available";
            if (allMemos && allMemos.length > 0) { const userMemosArr = allMemos.filter(m => m[3] === currentUser); userMemos = userMemosArr.length; if(userMemos > 0) lastAct = userMemosArr[0][0]; }
            document.getElementById('profTotalMemos').innerText = userMemos; document.getElementById('profLastActivity').innerText = lastAct;
            renderProfileRecentMemos(currentUser);
            const fbMine = document.getElementById('profileAvatarFallback'); if (fbMine) fbMine.innerText = String((nameParts.join(' ') || currentUser).trim().charAt(0) || 'U').toUpperCase();
        }

        function switchTab(tabName) {
            ['tabDashboard','tabHome','tabProfile','tabAdminMgmt','tabSettings','tabPersonnel','tabActivityManagement'].forEach(id => {
                const el=document.getElementById(id); if(el) el.classList.add('hidden');
            });
            ['btnDashboard','btnHome','btnSettings','btnAdminMgmt','btnPersonnel','btnActivityManagement'].forEach(id => {
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
                if (localStorage.getItem('loggedInUser') !== ALPHA_ADMIN_NAME) {
                    customAlert("Only the Alpha Admin can access User Management.", "Permission Denied"); return;
                }
                document.getElementById('tabSettings').classList.remove('hidden');
                document.getElementById('btnSettings').classList.add('active');
                if (sessionAdminPass === "") {
                    pendingAdminAction = 'open_mgmt';
                    document.getElementById('adminModal').classList.remove('hidden');
                    document.getElementById('adminPassInput').value = "";
                    document.getElementById('adminPassInput').focus();
                } else {
                    showAdminMgmtTab();
                }

            } else if (tabName === 'usersChat') {
                openUsersChatWindow(chatMode || 'global');
                return;
            } else if (tabName === 'activityManagement') {
                document.getElementById('tabActivityManagement').classList.remove('hidden');
                document.getElementById('btnActivityManagement').classList.add('active');
                updateActivityPermissions();
                loadActivities();
            } else if (tabName === 'personnel') {
                document.getElementById('tabPersonnel').classList.remove('hidden');
                document.getElementById('btnPersonnel').classList.add('active');
                updatePersonnelPermissions();
                loadPersonnel();
            }
            if (window.innerWidth <= 992) document.getElementById('navSidebar').classList.remove('open');
            sessionStorage.setItem('activeTab', tabName);
        }

        function showAdminMgmtTab() {
            document.getElementById('tabSettings').classList.remove('hidden');
            document.getElementById('btnSettings').classList.add('active');
            const settingsMain = document.getElementById('settingsMainPanel');
            if (settingsMain) settingsMain.classList.add('hidden');
            document.getElementById('tabAdminMgmt').classList.remove('hidden');
            loadAdminUsers();
            sessionStorage.setItem('activeTab', 'adminMgmt');
        }

        function closeAdminMgmtSubPage() {
            document.getElementById('tabAdminMgmt').classList.add('hidden');
            const settingsMain = document.getElementById('settingsMainPanel');
            if (settingsMain) settingsMain.classList.remove('hidden');
            document.getElementById('tabSettings').classList.remove('hidden');
            document.getElementById('btnSettings').classList.add('active');
            sessionStorage.setItem('activeTab', 'settings');
        }

        async function fetchSystemAnnouncement() {
            if (sessionStorage.getItem('systemAnnouncementSeen') === 'true') return;
            try { const res = await fetch(API_URL + "?action=get_announcement"); const data = await res.json(); if (data.success && data.message) { document.getElementById('globalAnnouncementMsg').innerText = data.message; document.getElementById('systemAnnouncementModal').classList.remove('hidden'); sessionStorage.setItem('systemAnnouncementSeen', 'true'); } } catch(e) {}
        }

        function closeAnnouncementModal() { document.getElementById('systemAnnouncementModal').classList.add('hidden'); }

        async function saveAdminAnnouncement() {
            const msg = document.getElementById('adminAnnouncementText').value.trim(); if (!msg) return customAlert("Announcement message cannot be empty.", "Error");
            try { await fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'save_announcement', message: msg, password: sessionAdminPass }) }); customAlert("System announcement updated!", "Success"); logActivity("updated the global system announcement."); } catch (err) {}
        }

        function deleteAdminAnnouncement() { customConfirm("Remove global system announcement?", async (confirmed) => { if(!confirmed) return; try { await fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'delete_announcement', password: sessionAdminPass }) }); document.getElementById('adminAnnouncementText').value = ""; customAlert("Announcement removed.", "Success"); logActivity("removed the global system announcement."); } catch (err) {} }); }

        function checkAuth() {
            const user = localStorage.getItem('loggedInUser');
            if (user) {
                document.getElementById('appBrand').innerText = 'REGIONAL HEADQUARTERS SUPPORT UNIT';
                document.getElementById('loginPage').classList.add('hidden'); document.getElementById('registerPage').classList.add('hidden'); document.getElementById('appLayout').classList.remove('hidden'); document.getElementById('mainTopBar').classList.remove('hidden'); document.getElementById('btnAdminMgmt').classList.add('hidden');
                document.getElementById('settingsUserMgmtBtn').classList.toggle('hidden', user !== ALPHA_ADMIN_NAME);
                document.getElementById('btnPersonnel').classList.remove('hidden');
                loadSettings();
                if (userSettings.autoOpenChatbot && userSettings.showChatbot) document.getElementById('chatbot-window').classList.remove('hidden'); else document.getElementById('chatbot-window').classList.add('hidden');
                
                // Authentication survives browser refresh through localStorage.
                // Every successful login/session restoration starts on the Dashboard,
                // regardless of the tab that was open before the refresh.
                sessionStorage.setItem('activeTab', 'dashboard');
                switchTab('dashboard');
                
                // Apply per-user allowed-access restrictions to navigation after login/restore.
                loadUserAccessMap().then(() => applyAccessRestrictions()).catch(() => {});
                // Force read-only if the current user is restricted by Alpha Admin.
                loadUserRestrictions().then(() => {
                    const me = localStorage.getItem('loggedInUser');
                    if (me && userRestrictedMap[me]) {
                        localStorage.setItem('canEdit', 'No');
                        localStorage.setItem('userRole', 'Regular User');
                        applyAccessRestrictions();
                    }
                }).catch(() => {});
                
                fetchActivityLogs();
                if (activityLogRefreshTimer) clearInterval(activityLogRefreshTimer);
                activityLogRefreshTimer = setInterval(fetchActivityLogs, 2000);
                fetchSystemAnnouncement();
                startActivityReminderMonitor();
                startChatNotificationMonitor();
            } else {
                if (activityReminderTimer) clearInterval(activityReminderTimer);
                stopChatNotificationMonitor();
                toggleAuthViews('loginPage');
            }
        }

        async function loginUser() {
            const user = document.getElementById('loginUsername').value.trim();
            const cred = document.getElementById('loginCredential').value.trim();
            if(!user || !cred) return customAlert("Enter Username and PIN/Password.", "Authentication Error");
            
            document.getElementById('loginCredential').value = "Logging in...";
            
            // Alpha Admin Authentication Bypass Route
            if (user === ALPHA_ADMIN_NAME) {
                try {
                    const adminRes = await fetch(`${API_URL}?action=verify_admin&password=${encodeURIComponent(cred)}`);
                    const adminData = await adminRes.json();
                    if (adminData.success) {
                        localStorage.setItem('loggedInUser', ALPHA_ADMIN_NAME);
                        localStorage.setItem('loggedCred', cred);
                        localStorage.setItem('userRole', 'Admin');
                        localStorage.setItem('canEdit', 'Yes');
                        sessionAdminPass = cred;
                        sessionStorage.removeItem('systemAnnouncementSeen');
                        document.getElementById('loginCredential').value = "";
                        logActivity("logged into the system as Alpha Admin.");
                        checkAuth();
                        return;
                    }
                } catch (err) {
                    console.error("Admin verification bypass failed:", err);
                }
            }
            
            try {
                const res = await fetch(`${API_URL}?action=login&username=${encodeURIComponent(user)}&pin=${encodeURIComponent(cred)}`);
                const data = await res.json();
                
                if (data.success) {
                    const assignedRole = data.role || (data.canEdit ? 'Admin' : 'Regular User');
                    const storedUser = (user === ALPHA_ADMIN_NAME) ? ALPHA_ADMIN_NAME : (data.username || data.name || user);
                    
                    localStorage.setItem('loggedInUser', storedUser); 
                    localStorage.setItem('loggedCred', cred); 
                    localStorage.setItem('userRole', assignedRole);
                    localStorage.setItem('canEdit', assignedRole === 'Admin' ? 'Yes' : 'No'); 
                    sessionStorage.removeItem('systemAnnouncementSeen'); 
                    document.getElementById('loginCredential').value = ""; 
                    logActivity("logged into the system."); 
                    checkAuth();
                } else {
                    customAlert(data.error || "Invalid credentials", "Error");
                    document.getElementById('loginCredential').value = "";
                }
            } catch (err) {
                customAlert("Network error during login.", "Error");
                document.getElementById('loginCredential').value = "";
            }
        }

        async function registerUser() {
            const rank = document.getElementById('regRank').value; const firstName = document.getElementById('regFirst').value.trim(); const middleName = document.getElementById('regMiddle').value.trim(); const lastName = document.getElementById('regLast').value.trim(); const qlf = document.getElementById('regQlf').value.trim(); const email = document.getElementById('regEmail').value.trim(); const username = document.getElementById('regUsername').value.trim(); const cred = document.getElementById('regCredential').value.trim();
            if(!rank || !firstName || !lastName || !email || !username || cred.length < 4) return customAlert("Please complete all required fields.", "Registration");
            
            const payload = { action: 'register', rank, firstName, middleName, lastName, qlf, email, username, pin: cred };
            try { const res = await fetch(`${API_URL}?action=register&` + new URLSearchParams(payload)); const data = await res.json(); if (data.success) { customAlert("Account created! Pending approval by Admin.", "Success"); toggleAuthViews('loginPage'); } else { customAlert(data.error, "Error"); } } catch(e) { customAlert("Network Error", "Error"); }
        }

        function attemptLogout() { if (userSettings.confirmLogout) { customConfirm("Are you sure you want to log out of the system?", (confirmed) => { if (confirmed) logoutUser(false); }); } else { logoutUser(false); } }
        function logoutUser(force = false) {
            const currentUser = localStorage.getItem('loggedInUser');
            persistUserSettings(currentUser);
            if (!force) logActivity("logged out of the system.");
            localStorage.removeItem('loggedInUser');
            localStorage.removeItem('loggedCred');
            localStorage.removeItem('userRole');
            localStorage.removeItem('canEdit');
            sessionAdminPass = "";
            pendingAdminAction = null;
            liveActivityLogs = [];
            lastLogCount = 0;
            if (activityLogRefreshTimer) {
                clearInterval(activityLogRefreshTimer);
                activityLogRefreshTimer = null;
            }
            sessionStorage.removeItem('systemAnnouncementSeen');
            if (activityRefreshTimer) clearInterval(activityRefreshTimer);
            if (autoLogoutTimer) clearTimeout(autoLogoutTimer);
            stopChatNotificationMonitor();
            const incomingChatContainer = document.getElementById('incomingChatContainer');
            if (incomingChatContainer) incomingChatContainer.innerHTML = '';
            userSettings = { ...DEFAULT_USER_SETTINGS };
            checkAuth();
        }
        function getProfilePreferencesKey(username = localStorage.getItem('loggedInUser')) { return 'rhsuProfilePrefs_' + String(username || '').trim(); }
        function loadProfilePreferences() {
            const stored = localStorage.getItem(getProfilePreferencesKey());
            let prefs = { density:'Comfortable', showActivity:true, showContact:true };
            try { if (stored) prefs = { ...prefs, ...JSON.parse(stored) }; } catch(e) {}
            const density = document.getElementById('profileDisplayDensity'); if (density) density.value = prefs.density;
            const activity = document.getElementById('profileShowActivity'); if (activity) activity.checked = prefs.showActivity !== false;
            const contact = document.getElementById('profileShowContact'); if (contact) contact.checked = prefs.showContact !== false;
            document.querySelectorAll('#tabProfile .settings-section').forEach(sec => {
                if (sec.querySelector('#profTotalMemos')) sec.classList.toggle('hidden', prefs.showActivity === false);
                if (sec.querySelector('#profEmail')) sec.classList.toggle('hidden', prefs.showContact === false);
            });
            document.getElementById('tabProfile')?.classList.toggle('profile-compact', prefs.density === 'Compact');
        }
        function saveProfilePreferences() {
            const prefs = { density: document.getElementById('profileDisplayDensity')?.value || 'Comfortable', showActivity: document.getElementById('profileShowActivity')?.checked !== false, showContact: document.getElementById('profileShowContact')?.checked !== false };
            localStorage.setItem(getProfilePreferencesKey(), JSON.stringify(prefs)); loadProfilePreferences();
        }
        function clearProfileFields() { document.getElementById('newCredential').value=''; document.getElementById('newUsernameInput').value=''; }
        function refreshSessionProfile() { populateProfileData(); showNotification('Profile Refreshed','Your profile and session information are up to date.'); }

        async function updateProfile() {
            const newCred = document.getElementById('newCredential').value.trim();
            const newUsername = document.getElementById('newUsernameInput').value.trim();
            if(!newCred && !newUsername) return customAlert("Enter new username or credential.", "Error");

            const oldUsername = localStorage.getItem('loggedInUser');

            try {
                await fetch(API_URL, {
                    method: 'POST',
                    mode: 'no-cors',
                    body: JSON.stringify({
                        action: 'update_profile',
                        username: oldUsername,
                        currentCredential: localStorage.getItem('loggedCred'),
                        newUsername: newUsername,
                        newCredential: newCred
                    })
                });

                if (newCred) localStorage.setItem('loggedCred', newCred);

                if (newUsername) {
                    const oldSettings = localStorage.getItem(getUserSettingsKey(oldUsername));
                    if (oldSettings) localStorage.setItem(getUserSettingsKey(newUsername), oldSettings);
                    localStorage.setItem('loggedInUser', newUsername);
                }

                persistUserSettings(localStorage.getItem('loggedInUser'));
                customAlert("Profile updated successfully!", "Success");
                document.getElementById('newCredential').value = "";
                document.getElementById('newUsernameInput').value = "";
                document.getElementById('appBrand').innerText = 'REGIONAL HEADQUARTERS SUPPORT UNIT';
                populateProfileData();
                logActivity("updated their profile information.");
            } catch (err) {}
        }
        const OFFICE_DESTINATIONS = ["RD, PRO1", "DRDA", "DRDO", "CRS", "Msg Center", "RPRMD", "RID", "ROD", "RLRDD", "RCADD", "RCD", "RIDMD", "RETD", "RPSMD", "RICTMD", "RESPO", "RMFB1"];
        function toggleOfficeDestinationOther(selectId, otherInputId) { const select = document.getElementById(selectId); const otherInput = document.getElementById(otherInputId); if (!select || !otherInput) return; const showOther = select.value === "Others"; otherInput.classList.toggle('hidden', !showOther); otherInput.required = showOther; if (!showOther) otherInput.value = ""; }
        function getSelectedOfficeDestination(selectId, otherInputId) { const select = document.getElementById(selectId); const otherInput = document.getElementById(otherInputId); if (!select) return ""; if (select.value === "Others") return otherInput ? otherInput.value.trim() : ""; return select.value.trim(); }
        function setOfficeDestination(selectId, otherInputId, destination) { const select = document.getElementById(selectId); const otherInput = document.getElementById(otherInputId); if (!select) return; const value = String(destination || "").trim(); if (OFFICE_DESTINATIONS.includes(value)) { select.value = value; if (otherInput) { otherInput.value = ""; otherInput.classList.add('hidden'); otherInput.required = false; } } else if (value) { select.value = "Others"; if (otherInput) { otherInput.value = value; otherInput.classList.remove('hidden'); otherInput.required = true; } } else { select.value = ""; if (otherInput) { otherInput.value = ""; otherInput.classList.add('hidden'); otherInput.required = false; } } }

        function openMemoModalUser() { document.getElementById('memoSubmissionModal').classList.remove('hidden'); document.getElementById('memoSubmitBtn').disabled = false; document.getElementById('memoSubmitBtn').innerText = "Submit Data"; }
        function dashboardAddMemo() {
            switchTab('home');
            setTimeout(openMemoModalUser, 0);
        }
        function closeMemoModal() { document.getElementById('memoSubmissionModal').classList.add('hidden'); }
        function closeAdminModal() { document.getElementById('adminModal').classList.add('hidden'); pendingAdminAction = null; }

        async function verifyAdmin() { const pass = document.getElementById('adminPassInput').value; if (!pass) return; document.getElementById('adminPassInput').value = "Verifying..."; const res = await fetch(`${API_URL}?action=verify_admin&password=${encodeURIComponent(pass)}`); const data = await res.json(); if (data.success) { sessionAdminPass = pass; document.getElementById('adminModal').classList.add('hidden'); if (pendingAdminAction === 'open_mgmt') { showAdminMgmtTab(); pendingAdminAction = null; } } else { customAlert("Incorrect Admin Password.", "Error"); document.getElementById('adminPassInput').value = ""; } }

        async function loadAdminUsers() {
            const res = await fetch(`${API_URL}?action=get_all_users&password=${encodeURIComponent(sessionAdminPass)}`); const data = await res.json(); const resAnnounce = await fetch(API_URL + "?action=get_announcement"); const dataAnnounce = await resAnnounce.json(); document.getElementById('adminAnnouncementText').value = (dataAnnounce.success && dataAnnounce.message) ? dataAnnounce.message : "";
            try { await loadUserAccessMap(); } catch(e) {}
            try { await loadUserRestrictions(); } catch(e) {}
            const tbody = document.getElementById('adminUsersTableBody'); tbody.innerHTML = "";
            if (data.success) {
                if(data.users.length === 0) { tbody.innerHTML = "<tr><td colspan='5' style='text-align:center;'>No accounts.</td></tr>"; return; }
                data.users.forEach(u => {
                    const safePin = String(u.pin).replace(/'/g, "\\'").replace(/"/g, '&quot;'); 
                    const safeUser = String(u.username).replace(/'/g, "\\'").replace(/"/g, '&quot;'); 
                    const isPending = String(u.status || '').trim().toLowerCase() === 'pending';
                    const userRole = u.role || (u.canEdit ? 'Admin' : 'Regular User');
                    
                    const roleSelect = `<select onchange="changeUserRole('${safeUser}', this.value)" style="margin:0; padding: 6px 10px; font-size: 13px; width: auto; border-radius: var(--radius-sm); background: white;">
                        <option value="Regular User" ${userRole === 'Regular User' ? 'selected' : ''}>Regular User</option>
                        <option value="Admin" ${userRole === 'Admin' ? 'selected' : ''}>Admin (Add/Edit/Update)</option>
                    </select>
                    <br><button type="button" class="action-btn" style="margin-top:5px;padding:3px 10px;font-size:11px;width:auto;" onclick="openUserAccessModal('${safeUser}')" title="Configure allowed page access">⚙ Allowed Access</button>`;

                    const isRestricted = !!userRestrictedMap[safeUser];
                    const restrictBtn = isPending ? '' :
                        `<button class="action-btn" style="margin:0 6px 0 0;padding:3px 8px;font-size:11px;${isRestricted ? 'background:var(--danger);color:white;border:none;' : ''}" onclick="toggleUserRestriction('${safeUser}', ${!isRestricted})" title="${isRestricted ? 'Remove read-only restriction' : 'Restrict user to view-only (cannot add/edit/modify)'}">${isRestricted ? '🔒 Restricted' : '🔓 Restrict'}</button>`;
                    const actionHtml = restrictBtn + (isPending ? 
                        `<button class="action-btn approve-btn" onclick="processApproval('${safeUser}', 'approve_user')">Approve</button> <button class="action-btn delete-btn" onclick="processApproval('${safeUser}', 'reject_user')">Reject</button>` : 
                        `<button class="action-btn delete-btn" onclick="adminDeleteUser('${safeUser}')">Delete</button>`);
                    
                    tbody.innerHTML += `<tr>
                        <td><span style="cursor:pointer;color:var(--primary);text-decoration:underline;" onclick="viewUserProfile('${safeUser}')" title="View full profile">${u.rank || ''} ${u.name || ''}</span></td>
                        <td><span style="cursor:pointer;color:var(--primary);text-decoration:underline;" onclick="viewUserProfile('${safeUser}')" title="View full profile">${u.username}</span></td>
                        <td>${roleSelect}</td>
                        <td style="color:${isPending ? '#f59e0b' : 'var(--success)'}">${u.status || 'Active'}</td>
                        <td>${actionHtml}</td>
                    </tr>`;
                });
            }
        }

        function changeUserRole(username, newRole) {
            customConfirm(`Set role for ${username} to: ${newRole}?`, async (confirmed) => {
                if (!confirmed) {
                    loadAdminUsers();
                    return;
                }
                try {
                    await fetch(API_URL, {
                        method: 'POST',
                        mode: 'no-cors',
                        body: JSON.stringify({
                            action: 'set_role',
                            username: username,
                            role: newRole,
                            password: sessionAdminPass
                        })
                    });
                    logActivity(`changed role of user "${username}" to ${newRole}`);
                    customAlert(`Role updated to ${newRole} for ${username}`, "Success");
                    setTimeout(loadAdminUsers, 1500);
                } catch(err) {
                    customAlert("Failed to update user role.", "Error");
                }
            });
        }

        function adminDeleteUser(username) { customConfirm(`Delete user: ${username}?`, async (confirmed) => { if (!confirmed) return; await fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'delete_user_admin', username: username, password: sessionAdminPass }) }); logActivity(`deleted user account: ${username}`); setTimeout(loadAdminUsers, 1500); }); }
        function processApproval(userIdentifier, actionType) { customConfirm(`Confirm Action?`, async (confirmed) => { if (!confirmed) return; await fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: actionType, username: userIdentifier, userPin: userIdentifier, password: sessionAdminPass }) }); logActivity(actionType === 'approve_user' ? "approved a new user account." : "rejected an account request."); setTimeout(loadAdminUsers, 1500); }); }


        function isAlphaAdmin() {
            return localStorage.getItem('loggedInUser') === ALPHA_ADMIN_NAME;
        }

        function canManagePersonnel() {
            const role = localStorage.getItem('userRole') || '';
            return isAlphaAdmin() || role === 'Admin' || localStorage.getItem('canEdit') === 'Yes';
        }

        function updatePersonnelPermissions() {
            const can = canManagePersonnel();
            const controls = document.getElementById('personnelAdminControls');
            const header = document.getElementById('personnelActionHeader');
            if (controls) controls.classList.toggle('hidden', !can);
            if (header) header.style.display = can ? '' : 'none';
        }

        async function loadPersonnel() {
            try {
                // Keep the original single backend request. All summaries, filters and
                // table data are derived from this one in-memory dataset.
                const res = await fetch(API_URL + "?action=get_personnel");
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Unable to load personnel');

                allPersonnel = Array.isArray(data.personnel) ? data.personnel : [];
                archivedPersonnel = Array.isArray(data.archived) ? data.archived : [];

                // Do lightweight preparation first so the data is available immediately.
                updatePersonnelDashboard();
                populatePersonnelFilters();
                populatePersonnelSections();

                // Defer the potentially heavier table DOM rendering until the browser has
                // painted the Personnel page. This keeps the page responsive with larger sheets.
                requestAnimationFrame(() => { filterPersonnel(); if (!document.getElementById('tabDashboard').classList.contains('hidden')) renderExecutiveDashboard(); });
            } catch (err) {
                console.error(err);
                const container = document.getElementById('personnelTablesContainer');
                if (container) {
                    container.innerHTML = `<div style="text-align:center;color:var(--danger);padding:20px;">Unable to load personnel records.</div>`;
                }
                customAlert("Unable to load the Personnel sheet.", "Error");
            }
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
            const ranks=[...new Set(allPersonnel.map(p=>String(p.rank||'').trim()).filter(Boolean))].sort();
            const statuses=[...new Set(allPersonnel.map(p=>String(p.status||'').trim()).filter(Boolean))].sort();
            const rs=document.getElementById('personnelRankFilter'), ss=document.getElementById('personnelStatusFilter');
            const oldR=rs.value, oldS=ss.value;
            rs.innerHTML='<option value="">All Ranks</option>'+ranks.map(r=>`<option value="${escapeAttr(r)}">${escapeHtml(r)}</option>`).join('');
            ss.innerHTML='<option value="">All Status</option>'+statuses.map(x=>`<option value="${escapeAttr(x)}">${escapeHtml(x)}</option>`).join('');
            rs.value=ranks.includes(oldR)?oldR:'';
            ss.value=statuses.includes(oldS)?oldS:'';
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
            const q = document.getElementById('personnelSearch').value.trim().toLowerCase();
            const rank = document.getElementById('personnelRankFilter').value;
            const status = document.getElementById('personnelStatusFilter').value;

            const rows = allPersonnel.filter(p => {
                const text = [p.no,p.rank,p.lastName,p.firstName,p.middleName,p.qualifiers,p.designation,p.section,p.status,p.contactNo,p.remarks]
                    .join(' ').toLowerCase();
                return (!q || text.includes(q)) &&
                       (!rank || String(p.rank || '') === rank) &&
                       (!status || String(p.status || '') === status);
            });

            renderPersonnelTable(rows);
        }

        function renderPersonnelTable(rows) {
            const can = canManagePersonnel();
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
                const showRestoreAction = archived && (isAlphaAdmin() || localStorage.getItem('userRole') === 'Admin');
                const bodyHtml = dataRows.map((p, index) => {
                    const clickAction = archived ? `onclick="openArchivedPersonnelDetails(${Number(p.archiveRow)})"` : `onclick="openPersonnelProfile(${Number(p.no)})"`;
                    const restoreActionCell = showRestoreAction
                        ? `<td class="personnel-actions-cell"><button type="button" class="action-btn approve-btn" title="Restore personnel" aria-label="Restore ${escapeAttr((p.rank||'')+' '+(p.firstName||'')+' '+(p.lastName||''))}" onclick="event.stopPropagation();restorePersonnel(${Number(p.archiveRow)})" style="font-size:12px;padding:6px 10px;width:auto;min-width:76px;height:auto;">↻ Restore</button></td>`
                        : '';
                    return `<tr class="personnel-clickable-row" ${clickAction} tabindex="0" role="button" aria-label="View personnel ${escapeAttr((p.rank||'')+' '+(p.firstName||'')+' '+(p.lastName||''))}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${archived ? `openArchivedPersonnelDetails(${Number(p.archiveRow)})` : `openPersonnelProfile(${Number(p.no)})`};}">
                        <td>${index + 1}</td>
                        <td>${escapeHtml(p.rank)}</td>
                        <td>${escapeHtml(p.lastName)}</td>
                        <td>${escapeHtml(p.firstName)}</td>
                        <td>${escapeHtml(p.middleName)}</td>
                        <td>${escapeHtml(p.qualifiers)}</td>
                        <td>${escapeHtml(p.designation)}</td>
                        <td>${escapeHtml(p.section)}</td>
                        <td><span style="font-weight:600;color:${archived ? 'var(--danger)' : 'var(--success)'};">${escapeHtml(p.status || (archived ? 'Archived' : 'Active'))}</span></td>
                        <td>${escapeHtml(p.contactNo)}</td>
                        ${archived ? `<td>${escapeHtml(p.archivedDate || '')}</td>` : `<td>${escapeHtml(p.remarks || '')}</td>`}
                        ${restoreActionCell}
                    </tr>`;
                }).join('');

                const extraHeader = archived
                    ? `<th>Archived Date</th>${showRestoreAction ? '<th>Action</th>' : ''}`
                    : '<th>Remarks</th>';
                return `<h3 style="margin-top:25px;margin-bottom:10px;color:${archived ? 'var(--danger)' : 'var(--primary)'};font-size:16px;">${escapeHtml(title)}</h3>
                <div class="table-wrapper" style="margin-bottom:20px;margin-top:0;">
                    <table class="personnel-data-table${archived ? ' archived-personnel-table' : ''}">
                        <thead><tr>
                            <th>No.</th><th>Rank</th><th>Last Name</th><th>First Name</th><th>Middle Name</th>
                            <th>Qualifiers</th><th>Designation</th><th>Section</th><th>Status</th><th>Contact No.</th>
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

            const archivedSorted = sortPersonnel(archivedPersonnel || []);
            const archiveHtml = archivedSorted.length
                ? buildTable('Archived', archivedSorted, true)
                : `<h3 style="margin-top:28px;margin-bottom:10px;color:var(--text-muted);font-size:16px;">Archived</h3>
                   <div class="table-wrapper" style="margin-bottom:20px;margin-top:0;">
                     <div style="text-align:center;color:var(--text-muted);padding:20px;">No archived personnel records.</div>
                   </div>`;

            container.innerHTML = (activeHtml || '<div style="text-align:center;color:var(--text-muted);padding:20px;">No active personnel records found.</div>') + archiveHtml;
        }
        function clearPersonnelFilters() {
            document.getElementById('personnelSearch').value='';
            document.getElementById('personnelRankFilter').value='';
            document.getElementById('personnelStatusFilter').value='';
            filterPersonnel();
        }

        function togglePersonnelRemarksFields() {
            const remarks = document.getElementById('pRemarks');
            const leave = document.getElementById('pLeaveType');
            const schooling = document.getElementById('pSchooling');
            const other = document.getElementById('pRemarksOther');
            if (!remarks || !leave || !schooling || !other) return;

            leave.classList.toggle('hidden', remarks.value !== 'On-Leave');
            schooling.classList.toggle('hidden', remarks.value !== 'Schooling/Seminar');
            other.classList.toggle('hidden', remarks.value !== 'Others');
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
            if(!canManagePersonnel()) return customAlert("Only the Alpha Admin and designated Admin users can modify personnel records.","Permission Denied");
            personnelEditNo=null;
            document.getElementById('personnelModalTitle').innerText='Add Personnel';
            ['pLastName','pFirstName','pMiddleName','pQualifiers','pDesignation','pContactNo'].forEach(id=>document.getElementById(id).value='');
            document.getElementById('pRank').value='';
            document.getElementById('pSection').value='';
            document.getElementById('pStatus').value='Active';
            document.getElementById('pNo').value='Auto';
            document.getElementById('personnelSaveBtn').innerText='Add Personnel';
            populatePersonnelRemarks('');
            document.getElementById('personnelModal').classList.remove('hidden');
            focusPersonnelModalField();
        }

        function editPersonnel(no) {
            if(!canManagePersonnel()) return customAlert("Permission denied.","Error");
            const p=allPersonnel.find(x=>Number(x.no)===Number(no)); if(!p) return;
            personnelEditNo=Number(no);
            document.getElementById('personnelModalTitle').innerText='Edit Personnel';
            document.getElementById('pNo').value=p.no;
            document.getElementById('pRank').value=p.rank||'';
            document.getElementById('pLastName').value=p.lastName||'';
            document.getElementById('pFirstName').value=p.firstName||'';
            document.getElementById('pMiddleName').value=p.middleName||'';
            document.getElementById('pQualifiers').value=p.qualifiers||'';
            document.getElementById('pDesignation').value=p.designation||'';
            document.getElementById('pSection').value=p.section||'';
            document.getElementById('pStatus').value=p.status||'Active';
            document.getElementById('pContactNo').value=p.contactNo||'';
            populatePersonnelRemarks(p.remarks||'');
            document.getElementById('personnelSaveBtn').innerText='Update Personnel';
            document.getElementById('personnelModal').classList.remove('hidden');
            focusPersonnelModalField();
        }

        function closePersonnelModal(){ document.getElementById('personnelModal').classList.add('hidden'); personnelEditNo=null; }

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
            if(!canManagePersonnel()) return customAlert("Permission denied.","Error");
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
                designation:document.getElementById('pDesignation').value.trim(),
                section:document.getElementById('pSection').value.trim(),
                status:document.getElementById('pStatus').value || 'Active',
                contactNo:document.getElementById('pContactNo').value.trim(),
                remarks:getPersonnelRemarksPayload()
            };
            if(!payload.rank||!payload.lastName||!payload.firstName) return customAlert("Rank, Last Name and First Name are required.","Validation Error");
            if (document.getElementById('pRemarks').value === 'On-Leave' && !document.getElementById('pLeaveType').value) return customAlert("Please select the Leave Type.","Validation Error");
            if (document.getElementById('pRemarks').value === 'Schooling/Seminar' && !document.getElementById('pSchooling').value.trim()) return customAlert("Please specify the schooling/seminar.","Validation Error");
            if (document.getElementById('pRemarks').value === 'Others' && !document.getElementById('pRemarksOther').value.trim()) return customAlert("Please encode the remarks.","Validation Error");

            const btn=document.getElementById('personnelSaveBtn'); btn.disabled=true; btn.innerText='Saving...';
            try {
                const res=await fetch(API_URL,{method:'POST',mode:'cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
                const data=await res.json();
                if(!data.success) throw new Error(data.error||'Save failed');
                logActivity(`${payload.action==='add_personnel'?'added':'updated'} personnel record: ${payload.rank} ${payload.lastName}, ${payload.firstName}`);
                closePersonnelModal();
                customAlert(data.archived ? 'Personnel marked non-Active and moved to Archived.' : (payload.action==='add_personnel'?'Personnel added successfully.':'Personnel updated successfully.'),'Success');
                await loadPersonnel();
            } catch(e) {
                customAlert(e.message||'Unable to save personnel record.','Error');
            } finally { btn.disabled=false; btn.innerText=(payload.action==='add_personnel' ? 'Add Personnel' : 'Update Personnel'); }
        }

        function archivePersonnel(no) {
            if(!canManagePersonnel()) return customAlert("Permission denied.","Error");
            const p=allPersonnel.find(x=>Number(x.no)===Number(no)); if(!p) return;
            customConfirm(`Archive ${p.rank} ${p.lastName}, ${p.firstName}? The record will be moved to the Archive sheet.`, async confirmed=>{
                if(!confirmed) return;
                try {
                    const res=await fetch(API_URL,{method:'POST',mode:'cors',headers:{'Content-Type':'text/plain;charset=utf-8'},
                        body:JSON.stringify({action:'archive_personnel',no:Number(no),userName:localStorage.getItem('loggedInUser'),credential:localStorage.getItem('loggedCred')||''})});
                    const data=await res.json(); if(!data.success) throw new Error(data.error||'Archive failed');
                    logActivity(`archived personnel record: ${p.rank} ${p.lastName}, ${p.firstName}`);
                    customAlert('Personnel record archived successfully.','Success'); await loadPersonnel();
                } catch(e){ customAlert(e.message||'Unable to archive personnel record.','Error'); }
            });
        }

        async function restorePersonnel(archiveRow) {
            const role = localStorage.getItem('userRole') || '';
            if(!isAlphaAdmin() && role !== 'Admin') return customAlert("Only the Alpha Admin and Admin users can restore archived personnel.","Permission Denied");
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
                    await loadPersonnel();
                } catch(e) {
                    customAlert(e.message || 'Unable to restore personnel record.','Error');
                }
            });
        }

        function escapeHtml(v){ return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
        function escapeAttr(v){ return escapeHtml(v); }


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

        function openActivityModal() {
            if (!canManageActivities()) return customAlert('Only Alpha Admin and Admin users can add activities.', 'Permission Denied');
            activityEditId = null;
            document.getElementById('activityModalTitle').innerText = 'Add Activity';
            document.getElementById('activitySaveBtn').innerText = 'Add Activity';
            document.getElementById('activityTitle').value = '';
            document.getElementById('activityVenue').value = '';
            document.getElementById('activityVenueOther').value = '';
            document.getElementById('activityRequestingOffice').value = '';
            document.getElementById('activityConcernedOffice').value = '';
            document.getElementById('activityTime').value = '';
            document.getElementById('activityFrequency').value = 'N/A';
            document.getElementById('activityStatus').value = 'Recurring';
            resetActivityDatePicker();
            toggleActivityVenueOther();
            document.getElementById('activityModal').classList.remove('hidden');
        }

        function formatActivityTime(value) {
            if (value === null || value === undefined) return '';

            const raw = String(value).trim();
            if (!raw) return '';

            // Google Sheets may return a time-only cell as a full Date string,
            // e.g. "Sat Dec 30 1899 08:30:00 GMT+0800 (...)".
            const dateTimeMatch = raw.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:GMT[+-]\d{4})?/i);
            if (dateTimeMatch) {
                let hours = Number(dateTimeMatch[1]);
                const minutes = Number(dateTimeMatch[2]);

                if (
                    Number.isFinite(hours) &&
                    hours >= 0 &&
                    hours <= 23 &&
                    Number.isFinite(minutes) &&
                    minutes >= 0 &&
                    minutes <= 59
                ) {
                    const suffix = hours >= 12 ? 'PM' : 'AM';
                    hours = hours % 12 || 12;
                    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${suffix}`;
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

            // Normal 12-hour value: 08:30 AM, 02:30 PM, etc.
            const match12 = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])$/);
            if (match12) {
                const hours = Number(match12[1]);
                const minutes = Number(match12[2]);
                if (hours >= 1 && hours <= 12 && minutes >= 0 && minutes <= 59) {
                    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${match12[3].toUpperCase()}`;
                }
            }

            return raw;
        }

        function activityTimeForInput(value) {
            const raw = String(value == null ? '' : value).trim();
            const match24 = raw.match(/^(\\d{1,2}):(\\d{2})$/);
            if (match24) {
                const hours = Number(match24[1]);
                const minutes = Number(match24[2]);
                if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
                    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
                }
            }
            const match12 = raw.match(/^(\\d{1,2}):(\\d{2})\\s*([AaPp][Mm])$/);
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
            return '';
        }

        function editActivity(id) {
            if (!canManageActivities()) return customAlert('Permission denied.', 'Error');
            const a = allActivities.find(x => String(x.id) === String(id));
            if (!a) return;
            activityEditId = String(id);
            document.getElementById('activityModalTitle').innerText = 'Edit Activity';
            document.getElementById('activitySaveBtn').innerText = 'Update Activity';
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
            document.getElementById('activityTime').value = activityTimeForInput(a.time);
            document.getElementById('activityFrequency').value = a.frequency || 'N/A';
            document.getElementById('activityStatus').value = a.status || 'Recurring';
            activityCalendarMonth = new Date(String(a.date || '').slice(0,10) + 'T00:00:00');
            activityCalendarMonth = new Date(activityCalendarMonth.getFullYear(), activityCalendarMonth.getMonth(), 1);
            renderSelectedActivityDates([String(a.date || '').slice(0,10)]);
            renderActivityCalendar();
            toggleActivityVenueOther();
            document.getElementById('activityModal').classList.remove('hidden');
        }

        function closeActivityModal() {
            document.getElementById('activityModal').classList.add('hidden');
            activityEditId = null;
        }

        async function saveActivity() {
            if (!canManageActivities()) return customAlert('Permission denied.', 'Error');

            const title = document.getElementById('activityTitle').value.trim();
            const venueSelect = document.getElementById('activityVenue').value;
            const venueOther = document.getElementById('activityVenueOther').value.trim();
            const venue = venueSelect === 'Others' ? venueOther : venueSelect;
            const requestingOffice = document.getElementById('activityRequestingOffice').value.trim();
            const concernedOffice = document.getElementById('activityConcernedOffice').value.trim();
            const time = document.getElementById('activityTime').value;
            const frequency = document.getElementById('activityFrequency').value || 'N/A';
            const dates = getSelectedActivityDates();

            if (!title || !venue || !requestingOffice || !concernedOffice || !time || !dates.length) {
                return customAlert('Please complete all required fields and select at least one date.', 'Validation Error');
            }
            if (activityEditId && dates.length !== 1) {
                return customAlert('When editing an activity, select only its scheduled date.', 'Validation Error');
            }

            const wasEditing = !!activityEditId;
            const payload = {
                action: wasEditing ? 'update_activity' : 'add_activity',
                id: activityEditId,
                userName: localStorage.getItem('loggedInUser'),
                credential: localStorage.getItem('loggedCred') || '',
                activityTitle: title, assignedVenue: venue, requestingOffice, concernedOffice, time, frequency, dates
            };

            const btn = document.getElementById('activitySaveBtn');
            btn.disabled = true; btn.innerText = wasEditing ? 'Updating...' : 'Saving...';
            try {
                const res = await fetch(API_URL, { method:'POST', mode:'cors', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(payload) });
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Unable to save activity.');
                logActivity(`${wasEditing ? 'updated' : 'added'} activity: "${title}"`);
                closeActivityModal();
                customAlert(wasEditing ? 'Activity updated successfully.' : 'Activity added successfully.', 'Success');
                await loadActivities();
            } catch (err) {
                customAlert(err.message || 'Unable to save activity.', 'Error');
            } finally {
                btn.disabled = false; btn.innerText = wasEditing ? 'Update Activity' : 'Add Activity';
            }
        }

        function deleteActivity(id) {
            if (!canManageActivities()) return customAlert('Permission denied.', 'Error');
            const a = allActivities.find(x => String(x.id) === String(id));
            if (!a) return;
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

        function changeActivityOverviewMonth(delta) {
            activityOverviewMonth = new Date(activityOverviewMonth.getFullYear(), activityOverviewMonth.getMonth() + delta, 1);
            renderActivityOverviewCalendar();
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
                const matches = (allActivities || []).filter(a => String(a.date || '').split(',').map(d => d.trim().slice(0,10)).includes(key));
                html += `<div class="activity-overview-day${other ? ' is-other-month' : ''}${key === today ? ' is-today' : ''}"><span class="activity-overview-day-number">${date.getDate()}</span><div class="activity-overview-events">${matches.slice(0,3).map(a => `<button type="button" class="activity-overview-event" title="${escapeAttr(a.activityTitle || 'Activity')}" onclick="showActivityDetails('${escapeAttr(a.id)}')">${escapeHtml(a.activityTitle || 'Untitled activity')}</button>`).join('')}${matches.length > 3 ? `<span class="activity-overview-more">+${matches.length-3} more</span>` : ''}</div></div>`;
            }
            host.innerHTML = html;
        }

        function showActivityDetails(id) {
            const activity = (allActivities || []).find(a => String(a.id) === String(id)) || (archivedActivities || []).find(a => String(a.id) === String(id));
            if (!activity) return;
            selectedActivityDetailsId = String(activity.id);
            document.getElementById('activityDetailsTitle').textContent = activity.activityTitle || 'Activity Details';
            const fields = [['Date / Schedule', activity.date], ['Activity Title', activity.activityTitle], ['Assigned Venue', activity.assignedVenue], ['Requesting Office', activity.requestingOffice], ['Concerned Office', activity.concernedOffice], ['Time', formatActivityTime(activity.time)], ['Frequency', activity.frequency], ['Status', activity.status]];
            document.getElementById('activityDetailsContent').innerHTML = fields.map(([label,value]) => `<div class="activity-detail-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '—')}</strong></div>`).join('');
            document.getElementById('activityDetailsEditBtn').classList.toggle('hidden', !canManageActivities() || !(allActivities || []).some(a => String(a.id) === String(id)));
            document.getElementById('activityDetailsModal').classList.remove('hidden');
        }
        function closeActivityDetails() { document.getElementById('activityDetailsModal').classList.add('hidden'); selectedActivityDetailsId = null; }
        function editActivityFromDetails() { const id = selectedActivityDetailsId; closeActivityDetails(); if (id) editActivity(id); }

        let selectedArchivedPersonnelRow = null;

        function openArchivedPersonnelDetails(archiveRow) {
            const p = (archivedPersonnel || []).find(x => Number(x.archiveRow) === Number(archiveRow));
            if (!p) return;
            selectedArchivedPersonnelRow = Number(archiveRow);
            const canEditStatus = isAlphaAdmin() || localStorage.getItem('userRole') === 'Admin';
            const name = `${p.rank || ''} ${p.firstName || ''} ${p.middleName || ''} ${p.lastName || ''}`.replace(/\s+/g, ' ').trim();
            document.getElementById('archivedPersonnelDetailsName').textContent = name || 'Archived Personnel';
            document.getElementById('archivedPersonnelDetailsContent').innerHTML = [
                ['Designation', p.designation], ['Section', p.section], ['Contact', p.contactNo],
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
            const role = localStorage.getItem('userRole') || '';
            if (!isAlphaAdmin() && role !== 'Admin') return customAlert('Only the Alpha Admin and Admin users can change archived personnel status.', 'Permission Denied');
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
                await loadPersonnel();
            } catch (e) {
                customAlert(e.message || 'Unable to update archived personnel status.', 'Error');
            } finally {
                btn.disabled = false;
                btn.textContent = oldText;
            }
        }

        async function loadActivities() {
            try {
                const res = await fetch(API_URL + '?action=get_activities');
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Unable to load activities.');
                allActivities = Array.isArray(data.activities) ? data.activities : [];
                archivedActivities = Array.isArray(data.archived) ? data.archived : [];
                // Backend status synchronization keeps current-date rows Ongoing and past rows archived.
                filterActivities();
                renderArchivedActivities();
                renderActivityOverviewCalendar();
                updateActivityPermissions();
                startActivityReminderMonitor();
                if (!document.getElementById('tabDashboard').classList.contains('hidden')) renderExecutiveDashboard();
            } catch(e) {
                console.error(e);
                document.getElementById('activityTableBody').innerHTML =
                    '<tr><td colspan="8" style="text-align:center;color:var(--danger);padding:20px;">Unable to load activities.</td></tr>';
                customAlert('Unable to load Activity Management records.', 'Error');
            }
        }

        function filterActivities() {
            const q = (document.getElementById('activitySearch').value || '').trim().toLowerCase();
            filteredActivities = allActivities.filter(a =>
                [a.date,a.activityTitle,a.assignedVenue,a.requestingOffice,a.concernedOffice,a.time,a.frequency,a.status]
                .join(' ').toLowerCase().includes(q)
            );
            currentActivityPage = 1;
            renderActivities();
        }

        function renderActivities() {
            renderActivityOverviewCalendar();
            const body = document.getElementById('activityTableBody');
            const can = canManageActivities();
            const perPage = Math.max(1, parseInt(userSettings.recordsPerPage,10) || 10);
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
                return `<tr>
                    <td>${escapeHtml(a.date)}</td>
                    <td><button type="button" class="activity-title-link" onclick="showActivityDetails('${escapeAttr(a.id)}')">${escapeHtml(a.activityTitle)}</button></td>
                    <td>${escapeHtml(a.assignedVenue)}</td>
                    <td>${escapeHtml(a.requestingOffice)}</td>
                    <td>${escapeHtml(a.concernedOffice)}</td>
                    <td>${escapeHtml(formatActivityTime(a.time))}</td>
                    <td><span class="activity-status ${statusClass}">${escapeHtml(status)}</span></td>
                    ${can ? `<td class="activity-action-cell">
                        <button class="action-btn" onclick="editActivity('${escapeAttr(a.id)}')">Edit</button>
                        <button class="action-btn delete-btn" style="color:white;" onclick="deleteActivity('${escapeAttr(a.id)}')">Delete</button>
                    </td>` : ''}
                </tr>`;
            }).join('') : `<tr><td colspan="${can ? 8 : 7}" style="text-align:center;padding:20px;">No activities found.</td></tr>`;

            const p = document.getElementById('activityPagination');
            if (filteredActivities.length > perPage) {
                p.classList.remove('hidden');
                document.getElementById('activityPageInfo').innerText = `Page ${currentActivityPage} of ${totalPages}`;
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
                <td>${escapeHtml(formatActivityTime(a.time))}</td>
                <td><span class="activity-status archive">Archive</span></td>
            </tr>`).join('') : '<tr><td colspan="7" style="text-align:center;padding:20px;">No archived activities.</td></tr>';

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
            el.innerHTML = entries.slice(0, 12).map(([name,count]) => `
                <div class="exec-row">
                    <div style="min-width:0;flex:1"><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
                    <div class="exec-bar"><i style="width:${Math.max(4,(count/max)*100)}%"></i></div></div>
                    <span>${count}</span>
                </div>`).join('');
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
            const totalMemos = allMemos.length;
            const organicPersonnel = (allPersonnel || []).filter(p => {
                const s = String(p.section || '').trim().toLowerCase();
                return s !== 'detached service' && s !== 'ds to other office/unit';
            });
            const detachedPersonnel = (allPersonnel || []).filter(p => String(p.section || '').trim().toLowerCase() === 'detached service');
            const dsOtherPersonnel = (allPersonnel || []).filter(p => String(p.section || '').trim().toLowerCase() === 'ds to other office/unit');
            const totalPersonnel = organicPersonnel.length + detachedPersonnel.length + dsOtherPersonnel.length;
            const totalActivities = (allActivities || []).length;
            const totalArchived = (archivedActivities || []).length;

            document.getElementById('execTotalMemos').innerText = totalMemos;
            document.getElementById('execTotalPersonnel').innerText = totalPersonnel;
            document.getElementById('execTotalActivities').innerText = totalActivities;
            document.getElementById('execArchivedActivities').innerText = totalArchived;

            const encoders = execCountMap(allMemos, r => r[3]);
            document.getElementById('execEncoderCount').innerText = Object.keys(encoders).length;

            const memoOffices = execCountMap(allMemos, r => r[1]);
            const personnelSections = execCountMap(organicPersonnel, p => p.section);
            const categories = {};
            allMemos.forEach(r => {
                const c = String(r[2] || '');
                const m = c.match(/RHSU\(([^)]+)\)/i);
                const key = m ? m[1] : (c || 'Uncategorized');
                categories[key] = (categories[key] || 0) + 1;
            });
            execRenderList('execMemoCategories', categories, totalMemos);
            execRenderList('execMemoEncoders', encoders, totalMemos);

            const groups = { PNCO:0, PCO:0, NUP:0, Other:0 };
            organicPersonnel.forEach(p => {
                const g = rankGroup(p.rank);
                groups[g] = (groups[g] || 0) + 1;
            });
            const personnelRecap = {
                'Organic Personnel': organicPersonnel.length,
                'Detached Service': detachedPersonnel.length,
                'DS to Other Office/Unit': dsOtherPersonnel.length,
                'Total Personnel': totalPersonnel,
                'PNCO': groups.PNCO,
                'PCO': groups.PCO,
                'NUP': groups.NUP,
                'Other': groups.Other
            };
            execRenderList('execPersonnelGroups', personnelRecap, totalPersonnel);

            const venues = execCountMap(allActivities, a => a.assignedVenue);
            execRenderList('execVenues', venues, totalActivities);

            // Operational details strip
            (function(){
                const detailsEl = document.getElementById('execDetailsStrip');
                if (!detailsEl) return;
                const now = new Date();
                const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
                const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
                let onLeaveToday = 0, onLeaveMonth = 0;
                (leaveEntries || []).forEach(e => { (e.dates || []).forEach(d => { if (d === todayStr) onLeaveToday++; if (String(d).startsWith(ym)) onLeaveMonth++; }); });
                let bmiUnhealthy = 0;
                (bmiRecords || []).forEach(r => { const c = String(r.classification || '').toLowerCase(); if (c.indexOf('overweight') !== -1 || c.indexOf('obese') !== -1) bmiUnhealthy++; });
                const cards = [
                    ['On Leave Today', onLeaveToday],
                    ['On Leave This Month', onLeaveMonth],
                    ['Active Squads', (squads || []).length],
                    ['Designated Areas', (areas || []).length],
                    ['BMI Overweight/Obese', bmiUnhealthy],
                    ['Archived Personnel', (archivedPersonnel || []).length]
                ];
                detailsEl.innerHTML = '<h3 class="exec-details-title">Operational Details</h3><div class="exec-details-grid">' +
                    cards.map(c => `<div class="exec-detail-card"><div class="exec-detail-value">${c[1]}</div><div class="exec-detail-label">${c[0]}</div></div>`).join('') +
                    '</div>';
            })();

            renderExecActivityLogs();

            document.getElementById('execDashUser').innerText = `Signed in: ${localStorage.getItem('loggedInUser') || 'Guest'}`;
            document.getElementById('execDashUpdated').innerText = `Updated ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
        }

        async function loadExecutiveDashboard() {
            // Reuse the original loaders so authentication, backend requests, and existing
            // business logic remain unchanged. The dashboard only reads their in-memory results.
            try { await Promise.allSettled([loadData(), loadPersonnel(), loadActivities(), fetchActivityLogs()]); }
            catch (e) {}
            renderExecutiveDashboard();
        }

        async function loadData() {
            try {
                const response = await fetch(API_URL + "?action=get_memos"); let data = await response.json();
                const tableBody = document.getElementById('dataTable'); tableBody.innerHTML = "";
                
                if(!data || data.length === 0) { tableBody.innerHTML = "<tr><td colspan='8' style='text-align:center;'>No memos found.</td></tr>"; document.getElementById('memoPagination').classList.add('hidden'); updateDashboard(); return; }
                
                allMemos = data.reverse(); 

                // Populate dynamic filters
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
                encoderSelect.innerHTML = '<option value="">All Encoders</option>';
                Array.from(encoders).sort().forEach(enc => encoderSelect.innerHTML += `<option value="${enc}">${enc}</option>`);

                const yearSelect = document.getElementById('filterYear');
                yearSelect.innerHTML = '<option value="">All Years</option>';
                Array.from(years).sort((a,b) => b-a).forEach(yr => yearSelect.innerHTML += `<option value="${yr}">${yr}</option>`);

                updateDashboard();

                if (userSettings.rememberSearch) {
                    const savedSearch = localStorage.getItem('rhsuSearch_' + localStorage.getItem('loggedInUser'));
                    if (savedSearch) document.getElementById('searchInput').value = savedSearch;
                }
                
                searchTable(); 
                if (!document.getElementById('tabDashboard').classList.contains('hidden')) renderExecutiveDashboard();
            } catch (err) { }
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
            const tableBody = document.getElementById('dataTable'); tableBody.innerHTML = "";
            const totalPages = Math.ceil(filteredMemos.length / MEMOS_PER_PAGE) || 1;
            if (currentMemoPage > totalPages) currentMemoPage = totalPages; if (currentMemoPage < 1) currentMemoPage = 1;
            const currentMemos = filteredMemos.slice((currentMemoPage - 1) * MEMOS_PER_PAGE, ((currentMemoPage - 1) * MEMOS_PER_PAGE) + MEMOS_PER_PAGE);
            
            if (currentMemos.length === 0) { tableBody.innerHTML = "<tr><td colspan='8' style='text-align:center;'>No match.</td></tr>"; document.getElementById('memoPagination').classList.add('hidden'); return; }
            currentMemos.forEach(row => {
                const safeSubject = String(row[1] || "").replace(/'/g, "\\'").replace(/"/g, '&quot;'); 
                const safeDestination = String(row[5] || "N/A").replace(/'/g, "\\'").replace(/"/g, '&quot;');
                const memoStatus = row[4] || "For Dispatched";
                
                tableBody.innerHTML += `<tr>
                    <td><input type="checkbox" class="row-checkbox" value="${row[2]}"></td>
                    <td>${row[0]}</td>
                    <td>${row[1]}</td>
                    <td>${safeDestination}</td>
                    <td>${row[2]}</td>
                    <td>${row[3] || "N/A"}</td>
                    <td><span style="font-weight: 500; color: var(--primary);">${memoStatus}</span></td>
                    <td style="white-space: nowrap;">
                        <button class="action-btn icon-action-btn" title="Edit Memo" aria-label="Edit Memo" onclick="initiateEdit('${row[2]}', '${safeSubject}', '${safeDestination}', '${memoStatus}')">
                            <img src="images/Edit.png" alt="Edit" style="width:16px;height:16px;filter:invert(1);display:block;">
                        </button>
                        <button class="action-btn delete-btn icon-action-btn" title="Delete Memo" aria-label="Delete Memo" onclick="triggerDelete('${row[2]}')">
                            <img src="images/Trash.png" alt="Delete" style="width:16px;height:16px;filter:invert(1);display:block;">
                        </button>
                    </td>
                </tr>`;
            });
            const pagination = document.getElementById('memoPagination');
            if (filteredMemos.length > MEMOS_PER_PAGE) { pagination.classList.remove('hidden'); document.getElementById('memoPageInfo').innerText = `Page ${currentMemoPage} of ${totalPages}`; document.getElementById('prevMemoBtn').disabled = (currentMemoPage === 1); document.getElementById('nextMemoBtn').disabled = (currentMemoPage === totalPages); } else { pagination.classList.add('hidden'); }
        }

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
            if (!subject) return customAlert("Please enter a Memo Subject.", "Error");
            if (!officeDestination) return customAlert("Please select or enter the Office Destination.", "Error");
            submitBtn.disabled = true; submitBtn.innerText = "Submitting...";
            try {
                // CORS mode is required to read the backend's JSON response containing the actual generated control number.
                const response = await fetch(API_URL, {
                    method: 'POST', mode: 'cors',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ action: 'create', memoSubject: subject, officeDestination: officeDestination, classification: classification, userName: localStorage.getItem('loggedInUser') })
                });
                if (!response.ok) throw new Error('The server could not confirm the submission.');
                const result = await response.json();
                if (!result || result.success !== true || !result.controlNumber) {
                    throw new Error((result && result.error) || 'The server did not return a control number.');
                }
                logActivity(`encoded a new memo: "${subject}" for ${officeDestination}`);
                document.getElementById('memoSubject').value = "";
                setOfficeDestination('memoOfficeDestination', 'memoOfficeDestinationOther', "");
                closeMemoModal();
                setTimeout(loadData, 1500);
                showMemoControlNumberModal(result.controlNumber);
            } catch (err) {
                customAlert("Memo submission could not be confirmed. Please check the Memo Database before retrying to avoid creating a duplicate. " + (err.message || ""), "Submission Status");
            } finally {
                submitBtn.disabled = false; submitBtn.innerText = "Submit Data";
            }
        });

        function initiateEdit(controlNum, currentSubject, currentOfficeDestination = "", currentStatus = "For Dispatched") {
            const isAlphaAdmin = localStorage.getItem('loggedInUser') === ALPHA_ADMIN_NAME; 
            const userRole = localStorage.getItem('userRole');
            const canEdit = localStorage.getItem('canEdit') === 'Yes' || userRole === 'Admin';
            
            if (!isAlphaAdmin && !canEdit) { 
                customAlert("Regular Users can add and generate control numbers, but only Admins can edit records.", "Permission Denied"); 
            } else { 
                triggerActionModal('edit', controlNum, currentSubject, currentOfficeDestination, currentStatus); 
            } 
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
            document.getElementById('actionModal').classList.remove('hidden'); 
            
            const passInput = document.getElementById('actionAdminPass');
            const confirmBtn = document.getElementById('actionConfirmBtn');
            if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.innerText = 'Confirm'; }
            passInput.value = sessionAdminPass || localStorage.getItem('loggedCred') || "";
            passInput.placeholder = sessionAdminPass ? "Master Password" : "Enter Password";
            
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
            const pass = document.getElementById('actionAdminPass').value;
            const confirmBtn = document.getElementById('actionConfirmBtn');
            if (!pass) {
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
                if (pendingAction === 'edit') { 
                    const newSubject = document.getElementById('actionNewSubject').value.trim(); 
                    const newStatus = document.getElementById('actionNewStatus').value;
                    const newOfficeDestination = getSelectedOfficeDestination('actionNewOfficeDestination', 'actionNewOfficeDestinationOther'); 
                    
                    if (!newSubject) throw new Error("Please enter a Memo Subject."); 
                    if (!newOfficeDestination) throw new Error("Please select or enter the Office Destination."); 
                    
                    await fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'update', controlNumber: actionTargetControl, newSubject: newSubject, newStatus: newStatus, officeDestination: newOfficeDestination, password: pass, userName: currentUser }) }); 
                    logActivity(`updated memo: ${actionTargetControl}`);
                } else if (pendingAction === 'delete') { 
                    await fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'delete', controlNumber: actionTargetControl, password: pass, userName: currentUser }) }); 
                    logActivity(`deleted memo: ${actionTargetControl}`);
                } else if (pendingAction === 'batch_delete') { 
                    for (const c of actionTargetControl) { 
                        await fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'delete', controlNumber: c, password: pass, userName: currentUser }) }); 
                    } 
                    logActivity(`batch deleted ${actionTargetControl.length} memos`);
                } else if (pendingAction === 'batch_status') {
                    const newStatus = document.getElementById('actionNewStatus').value;
                    for (const c of actionTargetControl) {
                        const row = (allMemos || []).find(r => String(r[2]) === String(c));
                        const newSubject = row ? String(row[1] || '') : '';
                        const newOfficeDestination = row ? String(row[5] || 'N/A') : 'N/A';
                        await fetch(API_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'update', controlNumber: c, newSubject: newSubject, newStatus: newStatus, officeDestination: newOfficeDestination, password: pass, userName: currentUser }) });
                    }
                    logActivity(`bulk updated status to ${newStatus} for ${actionTargetControl.length} memos`);
                }

                // Refresh the memo database after an admin update so the latest
                // backend data is immediately displayed in the table/dashboard.
                setTimeout(loadData, 1500);

                // Automatically close the action/confirmation modal after the first
                // confirmed action has been submitted successfully.
                closeActionModal();
            } catch (err) {
                if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.innerText = 'Confirm'; }
                customAlert(err.message || 'Unable to complete the requested action.', 'Error');
            }
        }

        function searchTable() {
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
            currentMemoPage = 1;
            renderMemoTable();
        }

        function toggleSelectAll() {
            const isChecked = document.getElementById('selectAll').checked;
            const checkboxes = document.querySelectorAll('.row-checkbox');
            checkboxes.forEach(cb => cb.checked = isChecked);
        }

        function batchEditStatus() {
            const isAlphaAdmin = localStorage.getItem('loggedInUser') === ALPHA_ADMIN_NAME;
            const userRole = localStorage.getItem('userRole');
            const canEdit = localStorage.getItem('canEdit') === 'Yes' || userRole === 'Admin';
            if (!isAlphaAdmin && !canEdit) return customAlert("Regular Users cannot bulk edit memo status. Admin permission is required.", "Permission Denied");
            const checked = document.querySelectorAll('.row-checkbox:checked');
            if (checked.length === 0) return customAlert("No memos selected for status update.", "Error");
            actionTargetControl = Array.from(checked).map(cb => cb.value);
            pendingAction = 'batch_status';
            document.getElementById('actionModal').classList.remove('hidden');
            document.getElementById('actionModalTitle').innerText = `Bulk Edit Status (${actionTargetControl.length} items)`;
            document.getElementById('actionNewSubject').classList.add('hidden');
            document.getElementById('actionNewStatus').classList.remove('hidden');
            document.getElementById('actionOfficeDestinationWrapper').classList.add('hidden');
            const passInput = document.getElementById('actionAdminPass');
            const confirmBtn = document.getElementById('actionConfirmBtn');
            if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.innerText = 'Confirm'; }
            passInput.value = sessionAdminPass || localStorage.getItem('loggedCred') || "";
            passInput.placeholder = sessionAdminPass ? "Master Password" : "Enter Password";
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
            passInput.value = sessionAdminPass || localStorage.getItem('loggedCred') || "";
            passInput.placeholder = sessionAdminPass ? "Master Password" : "Enter Password";
        }

        // Restore the authenticated session whenever the page is loaded or refreshed.
        // Authentication state is stored in localStorage and is not cleared by a refresh.
        window.addEventListener('load', checkAuth);

        /* ============================================================
           SPADES ENHANCEMENTS: Duty Office / BMI / Squadding / Leave /
           Area of Responsibilities / User Access / Activity Pagination
           ============================================================ */
        let execActivityPage = 1;
        const EXEC_ACTIVITY_PAGE_SIZE = 5;
        let currentPersonnelSubPage = 'list';
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
        let currentAccessUsername = null;
        let bmiEditingId = null;
        let dutySequenceWorking = [];

        const ACCESS_PAGES = [
            {key:'dashboard', label:'Dashboard'},
            {key:'home', label:'Memo Database'},
            {key:'personnel', label:'Personnel Management'},
            {key:'activityManagement', label:'Activity Management'},
            {key:'settings', label:'Settings'},
            {key:'adminMgmt', label:'User Management'},
            {key:'usersChat', label:'Users Chat'}
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
            const recent = document.getElementById('execRecentMemos');
            if (!recent) return;
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
                recent.innerHTML = `<div style="margin-bottom:10px;font-size:11px;color:var(--text-muted);font-weight:600;">${escapeHtml(countText)}</div><div style="overflow:auto;"><table class="exec-table"><thead><tr><th>Time</th><th>User</th><th>Activity</th></tr></thead><tbody>${
                    pageLogs.map(log => `<tr><td>${escapeHtml(execFormatDate(getLogTime(log)))}</td><td>${escapeHtml(getLogUser(log))}</td><td>${escapeHtml(getLogAction(log))}</td></tr>`).join('')
                }</tbody></table></div>${paginationHtml}`;
            } else if (execActivityUserFilter && logs.length) {
                recent.innerHTML = '<div class="exec-empty">No activity logs found for the selected user.</div>';
            } else {
                recent.innerHTML = '<div class="exec-empty">No activity logs are currently available from the backend.</div>';
            }
        }
        function setExecActivityPage(page) {
            execActivityPage = Math.max(1, Number(page) || 1);
            renderExecutiveDashboard();
        }

        /* ---------- Personnel Sub-Page Navigation ---------- */
        function switchPersonnelSubPage(sub) {
            currentPersonnelSubPage = sub;
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
            const can = canManagePersonnel();
            if (sub === 'duty') {
                const btn = document.getElementById('dutyEditSeqBtn');
                if (btn) btn.style.display = can ? '' : 'none';
                loadDutySequence();
            } else if (sub === 'bmi') {
                const btn = document.getElementById('bmiAddBtn');
                if (btn) btn.style.display = can ? '' : 'none';
                const hdr = document.getElementById('bmiActionHeader');
                if (hdr) hdr.style.display = can ? '' : 'none';
                loadBmiRecords();
            } else if (sub === 'squad') {
                const btn = document.getElementById('squadAddBtn');
                if (btn) btn.style.display = can ? '' : 'none';
                loadSquads();
            } else if (sub === 'leave') {
                const btn = document.getElementById('leaveAddBtn');
                if (btn) btn.style.display = can ? '' : 'none';
                const hdr = document.getElementById('leaveActionHeader');
                if (hdr) hdr.style.display = can ? '' : 'none';
                loadLeaveEntries();
            } else if (sub === 'aor') {
                const btn = document.getElementById('areaAddBtn');
                if (btn) btn.style.display = can ? '' : 'none';
                loadAreas();
            }
        }

        /* ---------- Duty Office ---------- */
        async function loadDutySequence() {
            try {
                const res = await fetch(API_URL + "?action=get_duty_sequence&_ts=" + Date.now(), {cache:'no-store'});
                const data = await res.json();
                if (data.success && Array.isArray(data.sequence)) dutySequence = data.sequence;
                else dutySequence = ['PMSg Siobal','PCMS Tayab','PMSg Graycochea','PMSg Oligo','PCpl Gandia','Pat Bao-anen','Pat Benitez','Pat Obra'];
            } catch (e) {
                dutySequence = ['PMSg Siobal','PCMS Tayab','PMSg Graycochea','PMSg Oligo','PCpl Gandia','Pat Bao-anen','Pat Benitez','Pat Obra'];
            }
            renderDutyCalendar();
            renderDutyTable();
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
            if (!canManagePersonnel()) { customAlert("Only Alpha Admin and Admin can modify the duty sequence.", "Permission Denied"); return; }
            dutySequenceWorking = dutySequence.slice();
            renderDutySequenceList();
            document.getElementById('dutySequenceModal').classList.remove('hidden');
        }
        function closeDutySequenceModal() { document.getElementById('dutySequenceModal').classList.add('hidden'); }
        let dutyDragIndex = null;
        function renderDutySequenceList() {
            const list = document.getElementById('dutySequenceList');
            if (!list) return;
            list.innerHTML = dutySequenceWorking.map((name, i) => `<div class="duty-seq-item" draggable="true" data-index="${i}"
                ondragstart="dutySeqDragStart(event, ${i})"
                ondragover="dutySeqDragOver(event, ${i})"
                ondragleave="dutySeqDragLeave(event)"
                ondrop="dutySeqDrop(event, ${i})"
                ondragend="dutySeqDragEnd(event)">
                <span class="duty-seq-drag-handle" aria-hidden="true" title="Drag to reorder">&#x22EE;&#x22EE;</span>
                <span class="duty-seq-pos">${i + 1}</span>
                <span class="duty-seq-name">${escapeHtml(name)}</span>
                <span class="duty-seq-controls">
                    <button type="button" class="action-btn" style="margin:0;padding:2px 8px;font-size:12px;" ${i===0?'disabled':''} onclick="moveDutyItem(${i}, -1)">&#8593;</button>
                    <button type="button" class="action-btn" style="margin:0;padding:2px 8px;font-size:12px;" ${i===dutySequenceWorking.length-1?'disabled':''} onclick="moveDutyItem(${i}, 1)">&#8595;</button>
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
        }
        async function saveDutySequence() {
            try {
                await fetch(API_URL, {
                    method:'POST', mode:'no-cors',
                    body: JSON.stringify({
                        action:'save_duty_sequence', sequence: dutySequenceWorking,
                        userName: localStorage.getItem('loggedInUser'),
                        credential: localStorage.getItem('loggedCred') || ''
                    })
                });
                dutySequence = dutySequenceWorking.slice();
                closeDutySequenceModal();
                customAlert("Duty sequence saved successfully.", "Success");
                renderDutyCalendar();
                renderDutyTable();
            } catch (e) { customAlert("Failed to save duty sequence.", "Error"); }
        }

        /* ---------- BMI Monitoring ---------- */
        function computeBmiClient(heightCm, weightKg, age) {
            // BMI Calculator sheet formula: BMI = weight(kg) / height(m)^2
            // PNP age-adjusted classification (PCPT Jason Ed T. Javier, Medical Officer)
            const h = Number(heightCm), w = Number(weightKg);
            if (!h || !w || h <= 0 || w <= 0) return {bmi:'', classification:''};
            const bmi = Math.round((w / ((h/100)*(h/100))) * 100) / 100;
            const a = Number(age) || 0;
            let normalMax;
            if (a > 0) {
                if (a < 29) normalMax = 24.9;
                else if (a < 35) normalMax = 25.0;
                else if (a < 40) normalMax = 25.5;
                else if (a < 45) normalMax = 26.0;
                else if (a < 51) normalMax = 26.5;
                else normalMax = 27.0;
            } else { normalMax = 24.9; }
            let cls = '';
            if (bmi < 18.5) cls = 'Underweight (UW)';
            else if (bmi <= normalMax) cls = 'Normal (N)';
            else if (bmi < 30) cls = 'Overweight (OW)';
            else if (bmi < 35) cls = 'Obese I (OB 1)';
            else cls = 'Obese II (OB 2)';
            return {bmi:bmi, classification:cls};
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
            try {
                const res = await fetch(API_URL + "?action=get_bmi_records&_ts=" + Date.now(), {cache:'no-store'});
                const data = await res.json();
                bmiRecords = (data.success && Array.isArray(data.records)) ? data.records : [];
            } catch (e) { bmiRecords = []; }
            populateBmiPeriods();
            renderBmiTable();
        }
        function populateBmiPeriods() {
            const sel = document.getElementById('bmiPeriodSelect');
            if (!sel) return;
            const periods = [...new Set(bmiRecords.map(r => String(r.period || '').trim()).filter(Boolean))].sort().reverse();
            const years = [...new Set(periods.map(p => p.slice(0,4)))].sort().reverse();
            const mode = document.getElementById('bmiViewMode');
            const isYearly = mode && mode.value === 'yearly';
            const current = sel.value;
            if (isYearly) {
                sel.innerHTML = '<option value="">All Years</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
            } else {
                sel.innerHTML = '<option value="">All Months</option>' + periods.map(p => {
                    const [y,m] = p.split('-');
                    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const label = `${monthNames[Number(m)-1]} ${y}`;
                    return `<option value="${p}">${label}</option>`;
                }).join('');
            }
            if (current && (periods.includes(current) || years.includes(current))) sel.value = current;
            else sel.value = '';
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
            const period = (periodSel ? periodSel.value : '').trim();
            const mode = modeSel ? modeSel.value : 'monthly';

            const can = canManagePersonnel();
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
            recordMap.forEach(r => { const c = r.bmiClassification || 'Unclassified'; classCounts[c] = (classCounts[c] || 0) + 1; });
            const periodLabel = period ? (() => {
                if (mode === 'yearly') return period;
                const [yy, mm] = period.split('-');
                const mN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                return `${mN[Number(mm)-1] || period} ${yy}`;
            })() : (mode === 'yearly' ? 'All Years' : 'All Months');
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
                    const cls = rec ? (rec.bmiClassification || 'Not encoded') : 'Not encoded';
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
                tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:var(--text-muted);padding:20px;">No personnel records found.</td></tr>`;
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
                htmlRows.push(`<tr class="bmi-section-header"><td colspan="11">${escapeHtml(sec)} — ${sections.get(sec).length} personnel</td></tr>`);
                sections.get(sec).forEach(x => {
                    const p = x.p;
                    const key = [p.rank, p.lastName, p.firstName, p.middleName, p.qualifiers].map(s => String(s || '').trim()).join('|');
                    const rec = recordMap.get(key) || null;
                    const fullName = personnelFullName(p);
                    const nameCell = can
                        ? `<td><span class="bmi-name-link" onclick="openBmiModalForPersonnel(${x.origIdx})" title="Click to encode / edit BMI record">${escapeHtml(fullName)}</span></td>`
                        : `<td>${escapeHtml(fullName)}</td>`;
                    const actionCell = can
                        ? (rec
                            ? `<td><button class="action-btn delete-btn" style="margin:0;padding:4px 8px;font-size:11px;" onclick="event.stopPropagation();deleteBmiRecord('${escapeAttr(rec.id)}')">Del</button></td>`
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
                        ${actionCell}
                    </tr>`);
                });
            });
            tbody.innerHTML = htmlRows.join('');
        }

        function downloadBmiExcel() {
            const periodSel = document.getElementById('bmiPeriodSelect');
            const modeSel = document.getElementById('bmiViewMode');
            const period = (periodSel ? periodSel.value : '').trim();
            const mode = modeSel ? modeSel.value : 'monthly';
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

            let csv = '\uFEFFNo.,Section,Rank/Full Name,Age,Height (cm),Weight (kg),Waist (cm),Hip (cm),Wrist (cm),BMI Result,BMI Classification\n';
            let rowNo = 1;
            orderedSecs.forEach(sec => {
                const group = sections.get(sec);
                csv += `${escCsv(sec + ' — ' + group.length + ' personnel')},,,,,,,,,,\n`;
                group.forEach(p => {
                    const key = [p.rank, p.lastName, p.firstName, p.middleName, p.qualifiers].map(s => String(s || '').trim()).join('|');
                    const rec = recordMap.get(key) || null;
                    csv += `${rowNo},${escCsv(p.section||'')},${escCsv(personnelFullName(p))},${rec?rec.age:''},${rec?rec.height:''},${rec?rec.weight:''},${rec?rec.waist:''},${rec?rec.hip:''},${rec?rec.wrist:''},${rec?rec.bmiResult:''},${escCsv(rec?rec.bmiClassification:'')}\n`;
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
            if (!canManagePersonnel()) { customAlert("Only Alpha Admin and Admin can encode BMI records.", "Permission Denied"); return; }
            if (!allPersonnel || !allPersonnel.length) { loadPersonnel(); customAlert("Personnel data is still loading. Please try again in a moment.", "Loading"); return; }
            const p = allPersonnel[Number(origIdx)];
            if (!p) return;

            const periodSel = document.getElementById('bmiPeriodSelect');
            const modeSel = document.getElementById('bmiViewMode');
            const period = (periodSel ? periodSel.value : '').trim();
            const mode = modeSel ? modeSel.value : 'monthly';

            // Find the latest record for this person within the selected period.
            const pKey = personnelFullName(p);
            let candidates = bmiRecords.filter(r => personnelFullName(r) === pKey);
            if (period) {
                if (mode === 'yearly') candidates = candidates.filter(r => String(r.period || '').trim().startsWith(period));
                else candidates = candidates.filter(r => String(r.period || '').trim() === period);
            }
            candidates.sort((a, b) => String(b.period || '').localeCompare(String(a.period || '')));
            const rec = candidates[0] || null;

            bmiEditingId = rec ? rec.id : null;
            document.getElementById('bmiModalTitle').innerText = rec ? 'Edit BMI Record' : 'Add BMI Record';
            const sel = document.getElementById('bmiPersonnelSelect');
            sel.innerHTML = '<option value="">Select personnel...</option>' + allPersonnel.map((pp, i) =>
                `<option value="${i}">${escapeHtml(personnelFullName(pp))}</option>`).join('');
            sel.value = String(origIdx);
            const bmiLbl = document.getElementById('bmiPersonnelSelectedLabel');
            if (bmiLbl && allPersonnel[Number(origIdx)]) { bmiLbl.style.display = 'block'; bmiLbl.innerText = 'Selected: ' + personnelFullName(allPersonnel[Number(origIdx)]); }
            const bmiSrch = document.getElementById('bmiPersonnelSearch'); if (bmiSrch) bmiSrch.value = '';
            const bmiFlt = document.getElementById('bmiPersonnelSectionFilter'); if (bmiFlt) bmiFlt.value = '';
            renderBmiPersonnelList();

            ['bmiAge','bmiHeight','bmiWeight','bmiWaist','bmiHip','bmiWrist'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
            const periodInput = document.getElementById('bmiPeriodInput');
            if (rec) {
                periodInput.value = rec.period || '';
                document.getElementById('bmiAge').value = rec.age || '';
                document.getElementById('bmiHeight').value = rec.height || '';
                document.getElementById('bmiWeight').value = rec.weight || '';
                document.getElementById('bmiWaist').value = rec.waist || '';
                document.getElementById('bmiHip').value = rec.hip || '';
                document.getElementById('bmiWrist').value = rec.wrist || '';
            } else {
                if (period && mode === 'monthly') periodInput.value = period;
                else { const now = new Date(); periodInput.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`; }
            }
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
        }
        function openBmiModal(editId) {
            if (!canManagePersonnel()) { customAlert("Only Alpha Admin and Admin can encode BMI records.", "Permission Denied"); return; }
            if (!allPersonnel || !allPersonnel.length) { loadPersonnel(); customAlert("Personnel data is still loading. Please try again in a moment.", "Loading"); return; }

            bmiEditingId = editId || null;
            document.getElementById('bmiModalTitle').innerText = editId ? 'Edit BMI Record' : 'Add BMI Record';
            const sel = document.getElementById('bmiPersonnelSelect');
            sel.innerHTML = '<option value="">Select personnel...</option>' + allPersonnel.map((p, i) =>
                `<option value="${i}">${escapeHtml(personnelFullName(p))}</option>`).join('');
            // Reset fields
            ['bmiAge','bmiHeight','bmiWeight','bmiWaist','bmiHip','bmiWrist'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
            const bmiAddLbl = document.getElementById('bmiPersonnelSelectedLabel');
            if (bmiAddLbl) { bmiAddLbl.style.display = 'none'; bmiAddLbl.innerText = ''; }
            const bmiAddSrch = document.getElementById('bmiPersonnelSearch'); if (bmiAddSrch) bmiAddSrch.value = '';
            const bmiAddFlt = document.getElementById('bmiPersonnelSectionFilter'); if (bmiAddFlt) bmiAddFlt.value = '';
            if (sel) sel.value = '';
            renderBmiPersonnelList();
            const now = new Date();
            const periodInput = document.getElementById('bmiPeriodInput');
            if (periodInput) periodInput.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
            if (editId) {
                const rec = bmiRecords.find(r => String(r.id) === String(editId));
                if (rec) {
                    const idx = allPersonnel.findIndex(p => personnelFullName(p) === personnelFullName(rec));
                    if (idx >= 0) sel.value = idx;
                    document.getElementById('bmiPeriodInput').value = rec.period || '';
                    document.getElementById('bmiAge').value = rec.age || '';
                    document.getElementById('bmiHeight').value = rec.height || '';
                    document.getElementById('bmiWeight').value = rec.weight || '';
                    document.getElementById('bmiWaist').value = rec.waist || '';
                    document.getElementById('bmiHip').value = rec.hip || '';
                    document.getElementById('bmiWrist').value = rec.wrist || '';
                }
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
            const selIdx = document.getElementById('bmiPersonnelSelect').value;
            const period = document.getElementById('bmiPeriodInput').value;
            if (selIdx === '' || !period) { customAlert("Please select personnel and a period.", "Validation"); return; }
            const p = allPersonnel[Number(selIdx)];
            const payload = {
                action:'save_bmi_record',
                id: bmiEditingId || undefined,
                period: period,
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
            if (!payload.height || !payload.weight) { customAlert("Height and Weight are required for BMI calculation.", "Validation"); return; }
            try {
                await fetch(API_URL, {method:'POST', mode:'no-cors', body: JSON.stringify(payload)});
                closeBmiModal();
                customAlert("BMI record saved. BMI result and classification were computed automatically.", "Success");
                setTimeout(loadBmiRecords, 1200);
            } catch (e) { customAlert("Failed to save BMI record.", "Error"); }
        }
        function deleteBmiRecord(id) {
            customConfirm("Delete this BMI record?", async (confirmed) => {
                if (!confirmed) return;
                try {
                    await fetch(API_URL, {method:'POST', mode:'no-cors', body: JSON.stringify({
                        action:'delete_bmi_record', id:id,
                        userName: localStorage.getItem('loggedInUser'),
                        credential: localStorage.getItem('loggedCred') || ''
                    })});
                    setTimeout(loadBmiRecords, 1200);
                } catch (e) {}
            });
        }

        /* ---------- Squadding ---------- */
        async function loadSquads() {
            try {
                const res = await fetch(API_URL + "?action=get_squads&_ts=" + Date.now(), {cache:'no-store'});
                const data = await res.json();
                squads = (data.success && Array.isArray(data.squads)) ? data.squads : [];
            } catch (e) { squads = []; }
            renderSquadCarousel();
        }
        function renderSquadCarousel() {
            const container = document.getElementById('squadCarousel');
            if (!container) return;
            if (!squads.length) {
                container.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px;">No squads created yet.${canManagePersonnel()?' Click "Create Squad" to group personnel.':''}</div>`;
                return;
            }
            const can = canManagePersonnel();
            container.innerHTML = squads.map(s => {
                const totalCount = (s.members ? s.members.length : 0) + (s.squadLeader ? 1 : 0);
                const membersHtml = s.members.length
                    ? s.members.map(m => `<div class="squad-member-chip">${escapeHtml([m.rank,m.lastName].filter(Boolean).join(' '))}</div>`).join('')
                    : '<span style="font-size:12px;color:var(--text-muted);">No members assigned.</span>';
                const actions = can ? `<div style="margin-top:10px;display:flex;gap:6px;">
                    <button class="action-btn" style="margin:0;padding:4px 10px;font-size:11px;flex:1;" onclick="event.stopPropagation();editSquad('${escapeAttr(s.squadId)}')">Edit</button>
                    <button class="action-btn delete-btn" style="margin:0;padding:4px 10px;font-size:11px;flex:1;" onclick="event.stopPropagation();deleteSquad('${escapeAttr(s.squadId)}')">Delete</button>
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
            if (!canManagePersonnel()) { customAlert("Only Alpha Admin and Admin can manage squads.", "Permission Denied"); return; }
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
            const can = canManagePersonnel();
            document.getElementById('squadDetailsEditBtn').style.display = can ? '' : 'none';
            document.getElementById('squadDetailsDeleteBtn').style.display = can ? '' : 'none';
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
            const id = document.getElementById('squadDetailsDeleteBtn').getAttribute('data-squad-id');
            customConfirm("Delete this squad and remove all member assignments?", async (confirmed) => {
                if (!confirmed) return;
                try {
                    await fetch(API_URL, {method:'POST', mode:'no-cors', body: JSON.stringify({
                        action:'delete_squad', squadId:id,
                        userName: localStorage.getItem('loggedInUser'),
                        credential: localStorage.getItem('loggedCred') || ''
                    })});
                    closeSquadDetailsModal();
                    setTimeout(loadSquads, 1200);
                } catch (e) {}
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
            const name = document.getElementById('squadNameInput').value.trim();
            if (!name) { customAlert("Squad name is required.", "Validation"); return; }
            syncSquadSelectionFromCheckboxes();
            const leaderIdx = document.getElementById('squadLeaderSelect').value;
            const leader = leaderIdx !== '' ? personnelShortName(allPersonnel[Number(leaderIdx)]) : '';
            // Use synced state so members hidden by search/section filters are preserved.
            const selected = (squadPreselectedMembers || []).map(m => ({
                rank:m.rank, lastName:m.lastName, firstName:m.firstName, middleName:m.middleName, qualifiers:m.qualifiers
            }));
            try {
                await fetch(API_URL, {method:'POST', mode:'no-cors', body: JSON.stringify({
                    action: editingSquadId ? 'update_squad' : 'create_squad',
                    squadId: editingSquadId || undefined,
                    squadName: name, squadLeader: leader, members: selected,
                    userName: localStorage.getItem('loggedInUser'),
                    credential: localStorage.getItem('loggedCred') || ''
                })});
                closeSquadModal();
                customAlert("Squad saved successfully.", "Success");
                setTimeout(loadSquads, 1200);
            } catch (e) { customAlert("Failed to save squad.", "Error"); }
        }
        function editSquad(id) { openSquadModal(id); }
        function deleteSquad(id) {
            customConfirm("Delete this squad and remove all member assignments?", async (confirmed) => {
                if (!confirmed) return;
                try {
                    await fetch(API_URL, {method:'POST', mode:'no-cors', body: JSON.stringify({
                        action:'delete_squad', squadId:id,
                        userName: localStorage.getItem('loggedInUser'),
                        credential: localStorage.getItem('loggedCred') || ''
                    })});
                    setTimeout(loadSquads, 1200);
                } catch (e) {}
            });
        }

        /* ---------- Leave Management ---------- */
        async function loadLeaveEntries() {
            try {
                const res = await fetch(API_URL + "?action=get_leave_entries&_ts=" + Date.now(), {cache:'no-store'});
                const data = await res.json();
                leaveEntries = (data.success && Array.isArray(data.entries)) ? data.entries : [];
            } catch (e) { leaveEntries = []; }
            renderLeaveCalendar();
            renderLeaveTable();
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
            const counts = {};
            leaveEntries.forEach(e => {
                const label = e.leaveType === 'Others' && e.otherType ? `Others (${e.otherType})` : e.leaveType;
                counts[label] = (counts[label] || 0) + 1;
            });
            const keys = Object.keys(counts).sort();
            wrap.innerHTML = keys.length
                ? '<span style="font-size:12px;font-weight:600;color:var(--text-muted);margin-right:8px;">Recap by Leave Type:</span>' + keys.map(k =>
                    `<span class="bmi-class-chip" style="border-color:var(--primary);color:var(--primary);">${escapeHtml(k)}: <strong>${counts[k]}</strong></span>`).join('')
                : '<span style="font-size:12px;color:var(--text-muted);">No leave entries recorded.</span>';
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
            const can = canManagePersonnel();
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
            if (!canManagePersonnel()) { customAlert("Only Alpha Admin and Admin can encode leave entries.", "Permission Denied"); return; }
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
            const selIdx = document.getElementById('leavePersonnelSelect').value || selectedLeavePersonnelIdx;
            const leaveType = document.getElementById('leaveTypeSelect').value;
            if (selIdx === '' || !leaveType) { customAlert("Please select personnel and leave type.", "Validation"); return; }
            if (leaveType === 'Others' && !document.getElementById('leaveOtherTypeInput').value.trim()) {
                customAlert("Please specify the leave type under Others.", "Validation"); return;
            }
            if (!selectedLeaveDates.length) { customAlert("Please add at least one leave date.", "Validation"); return; }
            const p = allPersonnel[Number(selIdx)];
            try {
                await fetch(API_URL, {method:'POST', mode:'no-cors', body: JSON.stringify({
                    action:'add_leave_entry',
                    personnelName: personnelFullName(p),
                    leaveType: leaveType,
                    otherType: leaveType === 'Others' ? document.getElementById('leaveOtherTypeInput').value.trim() : '',
                    dates: selectedLeaveDates,
                    userName: localStorage.getItem('loggedInUser'),
                    credential: localStorage.getItem('loggedCred') || ''
                })});
                closeLeaveModal();
                customAlert("Leave entry saved successfully.", "Success");
                setTimeout(loadLeaveEntries, 1200);
            } catch (e) { customAlert("Failed to save leave entry.", "Error"); }
        }
        function deleteLeaveEntry(id) {
            customConfirm("Delete this leave entry?", async (confirmed) => {
                if (!confirmed) return;
                try {
                    await fetch(API_URL, {method:'POST', mode:'no-cors', body: JSON.stringify({
                        action:'delete_leave_entry', id:id,
                        userName: localStorage.getItem('loggedInUser'),
                        credential: localStorage.getItem('loggedCred') || ''
                    })});
                    setTimeout(loadLeaveEntries, 1200);
                } catch (e) {}
            });
        }

        /* ---------- Area of Responsibilities ---------- */
        async function loadAreas() {
            try {
                const res = await fetch(API_URL + "?action=get_areas&_ts=" + Date.now(), {cache:'no-store'});
                const data = await res.json();
                areas = (data.success && Array.isArray(data.areas)) ? data.areas : [];
            } catch (e) { areas = []; }
            renderAreaCards();
        }
        let areaDragId = null;
        function renderAreaCards() {
            const container = document.getElementById('areaCardsContainer');
            if (!container) return;
            if (!areas.length) {
                container.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px;">No areas created yet.${canManagePersonnel()?' Click "Add Area" to create one and deploy personnel.':''}</div>`;
                return;
            }
            const can = canManagePersonnel();
            container.innerHTML = areas.map(a => `<div class="area-card glass-panel" draggable="${can?'true':'false'}" data-area-id="${escapeAttr(a.areaId)}"
                onclick="openAreaDetails('${escapeAttr(a.areaId)}')" role="button" tabindex="0" aria-label="View details for ${escapeAttr(a.areaName)}"
                ${can ? `ondragstart="areaCardDragStart(event, '${escapeAttr(a.areaId)}')" ondragover="areaCardDragOver(event)" ondragleave="areaCardDragLeave(event)" ondrop="areaCardDrop(event, '${escapeAttr(a.areaId)}')" ondragend="areaCardDragEnd(event)"` : ''}>
                <div class="area-card-icon" aria-hidden="true">&#9635;</div>
                <h4 style="margin:8px 0 4px;color:var(--primary);">${escapeHtml(a.areaName)}</h4>
                <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(a.camp||'PRO 1 Camp')}</div>
                <div style="margin-top:10px;font-size:13px;"><strong>${a.personnel.length}</strong> personnel assigned</div>
                <div style="margin-top:6px;font-size:11px;color:var(--text-muted);">${can ? 'Drag to reorder &bull; ' : ''}Click to view personnel in-charge</div>
            </div>`).join('');
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
            try {
                await fetch(API_URL, {
                    method:'POST', mode:'no-cors',
                    body: JSON.stringify({
                        action:'reorder_areas',
                        orderedIds: areas.map(a => String(a.areaId)),
                        userName: localStorage.getItem('loggedInUser'),
                        credential: localStorage.getItem('loggedCred') || ''
                    })
                });
            } catch (e) { /* order persists on next reload from backend */ }
        }

        function openAreaModal(editId) {
            if (!canManagePersonnel()) { customAlert("Only Alpha Admin and Admin can manage areas.", "Permission Denied"); return; }
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
            const name = document.getElementById('areaNameInput').value.trim();
            const camp = document.getElementById('areaCampSelect').value;
            if (!name) { customAlert("Area name is required.", "Validation"); return; }
            syncAreaSelectionFromCheckboxes();
            // Use synced state so personnel hidden by search/section filters are preserved.
            const selected = (areaPreselected || []).map(p => ({
                rank:p.rank, lastName:p.lastName, firstName:p.firstName, middleName:p.middleName, qualifiers:p.qualifiers
            }));
            try {
                if (editingAreaId) {
                    await fetch(API_URL, {method:'POST', mode:'no-cors', body: JSON.stringify({
                        action:'update_area_personnel', areaId: editingAreaId, personnel: selected,
                        userName: localStorage.getItem('loggedInUser'),
                        credential: localStorage.getItem('loggedCred') || ''
                    })});
                } else {
                    await fetch(API_URL, {method:'POST', mode:'no-cors', body: JSON.stringify({
                        action:'add_area', areaName: name, camp: camp, personnel: selected,
                        userName: localStorage.getItem('loggedInUser'),
                        credential: localStorage.getItem('loggedCred') || ''
                    })});
                }
                closeAreaModal();
                closeAreaDetailsModal();
                customAlert("Area saved successfully.", "Success");
                setTimeout(loadAreas, 1200);
            } catch (e) { customAlert("Failed to save area.", "Error"); }
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
            const can = canManagePersonnel();
            document.getElementById('areaEditBtn').style.display = can ? '' : 'none';
            document.getElementById('areaDeleteBtn').style.display = can ? '' : 'none';
            document.getElementById('areaEditBtn').setAttribute('data-area-id', areaId);
            document.getElementById('areaDeleteBtn').setAttribute('data-area-id', areaId);
            document.getElementById('areaDetailsModal').classList.remove('hidden');
        }
        function closeAreaDetailsModal() { document.getElementById('areaDetailsModal').classList.add('hidden'); }
        function editAreaFromDetails() {
            const id = document.getElementById('areaEditBtn').getAttribute('data-area-id');
            closeAreaDetailsModal();
            openAreaModal(id);
        }
        function deleteAreaFromDetails() {
            const id = document.getElementById('areaDeleteBtn').getAttribute('data-area-id');
            customConfirm("Delete this area of responsibility and unassign all personnel?", async (confirmed) => {
                if (!confirmed) return;
                try {
                    await fetch(API_URL, {method:'POST', mode:'no-cors', body: JSON.stringify({
                        action:'delete_area', areaId:id,
                        userName: localStorage.getItem('loggedInUser'),
                        credential: localStorage.getItem('loggedCred') || ''
                    })});
                    closeAreaDetailsModal();
                    setTimeout(loadAreas, 1200);
                } catch (e) {}
            });
        }

        /* ---------- User Access Control ---------- */
        async function loadUserAccessMap() {
            try {
                const res = await fetch(`${API_URL}?action=get_user_access&password=${encodeURIComponent(sessionAdminPass)}`);
                const data = await res.json();
                if (data.success && data.accessMap) userAccessMap = data.accessMap;
            } catch (e) { userAccessMap = {}; }
        }
        function openUserAccessModal(username) {
            currentAccessUsername = username;
            document.getElementById('userAccessUsername').innerText = username;
            const current = userAccessMap[username] || [];
            const wrap = document.getElementById('userAccessCheckboxes');
            wrap.innerHTML = ACCESS_PAGES.map(p => `<label class="checklist-item">
                <input type="checkbox" class="user-access-cb" value="${escapeAttr(p.key)}" ${current.includes(p.key)?'checked':''}>
                <span>${escapeHtml(p.label)}</span>
            </label>`).join('') + `<div style="font-size:11px;color:var(--text-muted);margin-top:6px;">Note: If no boxes are checked, the user retains full default access. Checking specific boxes restricts access to only those pages.</div>`;
            document.getElementById('userAccessModal').classList.remove('hidden');
        }
        function closeUserAccessModal() { document.getElementById('userAccessModal').classList.add('hidden'); currentAccessUsername = null; }
        async function saveUserAccess() {
            const selected = [...document.querySelectorAll('.user-access-cb:checked')].map(cb => cb.value);
            try {
                await fetch(API_URL, {method:'POST', mode:'no-cors', body: JSON.stringify({
                    action:'set_user_access', username: currentAccessUsername, access: selected,
                    password: sessionAdminPass
                })});
                userAccessMap[currentAccessUsername] = selected;
                closeUserAccessModal();
                customAlert("Access permissions updated.", "Success");
            } catch (e) { customAlert("Failed to save access permissions.", "Error"); }
        }
        function userHasAccess(pageKey) {
            const user = localStorage.getItem('loggedInUser') || '';
            if (user === ALPHA_ADMIN_NAME) return true;
            const allowed = userAccessMap[user];
            if (!allowed || !allowed.length) return true; // empty = full access
            return allowed.includes(pageKey);
        }
        function applyAccessRestrictions() {
            // Hide sidebar nav buttons for pages the user is not allowed to access.
            const navMap = {
                'dashboard':'btnDashboard', 'home':'btnHome', 'personnel':'btnPersonnel',
                'activityManagement':'btnActivityManagement', 'settings':'btnSettings',
                'adminMgmt':'btnAdminMgmt'
            };
            Object.keys(navMap).forEach(key => {
                const btn = document.getElementById(navMap[key]);
                if (btn) btn.style.display = userHasAccess(key) ? '' : 'none';
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
        async function loadUserRestrictions() {
            try {
                const res = await fetch(API_URL + "?action=get_user_restrictions&password=" + encodeURIComponent(sessionAdminPass) + "&_ts=" + Date.now(), {cache:'no-store'});
                const data = await res.json();
                userRestrictedMap = (data.success && data.restricted) ? data.restricted : {};
            } catch(e) { userRestrictedMap = {}; }
        }
        function toggleUserRestriction(username, restrict) {
            customConfirm(`${restrict ? 'RESTRICT (make read-only — cannot add/edit/modify anything)' : 'REMOVE restriction from'} user "${username}"?`, async (confirmed) => {
                if (!confirmed) { loadAdminUsers(); return; }
                try {
                    await fetch(API_URL, {method:'POST', mode:'no-cors', body: JSON.stringify({
                        action:'set_user_restriction', username: username, restricted: !!restrict,
                        userName: localStorage.getItem('loggedInUser'), credential: localStorage.getItem('loggedCred') || ''
                    })});
                    customAlert(`User "${username}" ${restrict ? 'is now RESTRICTED (read-only).' : 'restriction removed.'}`, "Success");
                    setTimeout(loadAdminUsers, 1200);
                } catch(e) { customAlert("Failed to update restriction.", "Error"); }
            });
        }

        /* ---------- Personnel Profile Card Modal ---------- */
        let profileCardPersonnelNo = null;
        function openPersonnelProfile(no) {
            const p = allPersonnel.find(x => String(x.no) === String(no));
            if (!p) return;
            profileCardPersonnelNo = no;
            const fullName = personnelFullName(p);
            document.getElementById('profileCardAvatar').innerText = (p.rank || 'U').charAt(0);
            document.getElementById('profileCardName').innerText = fullName;
            document.getElementById('profileCardDesignation').innerText = (p.designation || '—') + ' • ' + (p.section || '—');
            const body = document.getElementById('profileCardBody');
            const rows = [
                ['Rank', p.rank || '—'],
                ['Last Name', p.lastName || '—'],
                ['First Name', p.firstName || '—'],
                ['Middle Name', p.middleName || '—'],
                ['Qualifier', p.qualifiers || '—'],
                ['Designation', p.designation || '—'],
                ['Section', p.section || '—'],
                ['Status', p.status || 'Active'],
                ['Contact No.', p.contactNo || '—'],
                ['Remarks', p.remarks || '—']
            ];
            body.innerHTML = rows.map(r => `<div class="profile-card-row"><span>${r[0]}</span><span>${escapeHtml(String(r[1]))}</span></div>`).join('');
            const can = canManagePersonnel();
            document.getElementById('profileCardEditBtn').style.display = can ? '' : 'none';
            document.getElementById('personnelProfileModal').classList.remove('hidden');
        }
        function closePersonnelProfile() { document.getElementById('personnelProfileModal').classList.add('hidden'); profileCardPersonnelNo = null; }
        function editDetailsFromProfile() {
            const no = profileCardPersonnelNo;
            closePersonnelProfile();
            if (no != null) editPersonnel(no);
        }