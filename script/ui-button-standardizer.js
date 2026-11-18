/* -------------------------------------------------------------------------
   SPADES GLOBAL ICON BUTTON STANDARDIZER
   Action controls use consistent icon-only buttons with accessible names and
   native title tooltips. Navigation and content-selection controls retain text.
   ------------------------------------------------------------------------- */
(function initializeSpadesIconButtons() {
  'use strict';

  const EXCLUDED = [
    '.sidebar-btn', '.personnel-subnav-btn', '.activity-title-link',
    '.activity-overview-event-text', '.activity-overview-day',
    '.activity-calendar-day', '.notification-toast',
    '.users-chat-dropdown-global', '.chat-user-item', '.um-account-name',
    '.my-files-file-name', '.folder-entry-main', '.xlsx-sheet-tab',
    '.chat-mode-tab', '.users-chat-format-toolbar button',
    '.header-icon-btn', '.profile-btn', '.nav-toggle-btn',
    // This prominent page-level action keeps both its plus icon and visible text.
    '#memoDatabaseAddBtn'
  ].join(',');

  // Page-scoped create actions intentionally use distinct icons and tooltip
  // labels. This prevents multiple generic “Add” controls from being confused
  // when they appear in different modules or sub-pages.
  const PAGE_ACTION_PROFILES = Object.freeze({
    'dashboard-memo-create': {
      icon: 'fi-rr-memo', kind: 'primary',
      label: 'Create Memo', context: 'Dashboard'
    },
    'dashboard-activity-create': {
      icon: 'fi-rr-sparkles', kind: 'primary',
      label: 'Create Activity', context: 'Dashboard'
    },
    'memo-database-add-memo': {
      icon: 'fi-rr-documents', kind: 'primary',
      label: 'Add Memo Record', context: 'Memo Database'
    },
    'personnel-list-add-personnel': {
      icon: 'fi-rr-id-badge', kind: 'primary',
      label: 'Add Personnel', context: 'Personnel Management · Personnel List'
    },
    'personnel-bmi-add-record': {
      icon: 'fi-rr-clipboard-list', kind: 'primary',
      label: 'Add BMI Record', context: 'Personnel Management · BMI Monitoring'
    },
    'personnel-squadding-create': {
      icon: 'fi-rr-users', kind: 'primary',
      label: 'Create Squad', context: 'Personnel Management · Squadding'
    },
    'personnel-leave-add-entry': {
      icon: 'fi-rr-calendar-check', kind: 'primary',
      label: 'Add Leave Entry', context: 'Personnel Management · Leave Management'
    },
    'personnel-aor-add-area': {
      icon: 'fi-rr-category', kind: 'primary',
      label: 'Add Area', context: 'Personnel Management · Area of Responsibilities'
    },
    'activity-management-add-activity': {
      icon: 'fi-rr-calendar', kind: 'primary',
      label: 'Add Activity', context: 'Activity Management'
    },
    'matrix-compliance-add-compliance': {
      icon: 'fi-rr-list-check', kind: 'primary',
      label: 'Add Compliance', context: 'Matrix of Compliances'
    },
    'duty-office-add-personnel': {
      icon: 'fi-rr-user-check', kind: 'primary',
      label: 'Add Personnel to Duty Sequence', context: 'Personnel Management · Duty Office'
    },
    'leave-management-add-date': {
      icon: 'fi-rr-clock', kind: 'primary',
      label: 'Add Leave Date', context: 'Personnel Management · Leave Management'
    }
  });

  const ICON_RULES = [
    { test: /\bapprove(?:d|s)?\b/i, icon: 'fi-rr-check-circle', kind: 'approve' },
    { test: /\barchive\b/i, icon: 'fi-rr-archive', kind: 'neutral' },
    { test: /\b(delete|remove|reject|stop alerts)\b/i, icon: 'fi-rr-trash', kind: 'danger' },
    { test: /\b(send)\b/i, icon: 'fi-rr-paper-plane', kind: 'primary' },
    { test: /\b(save|submit|verify|apply|continue|publish)\b/i, icon: 'fi-rr-check', kind: 'primary' },
    { test: /\b(close|cancel|dismiss|no|clear selection)\b/i, icon: 'fi-rr-cross', kind: 'neutral' },
    { test: /\b(add|create|new)\b/i, icon: 'fi-rr-plus', kind: 'primary' },
    { test: /\b(edit|modify|update)\b/i, icon: 'fi-rr-edit', kind: 'neutral' },
    { test: /\b(upload|choose files|attach)\b/i, icon: 'fi-rr-upload', kind: 'primary' },
    { test: /\b(download|export)\b/i, icon: 'fi-rr-download', kind: 'neutral' },
    { test: /\b(preview|view|browse)\b/i, icon: 'fi-rr-eye', kind: 'neutral' },
    { test: /\b(refresh|reload|retry)\b/i, icon: 'fi-rr-refresh', kind: 'neutral' },
    { test: /\b(search|filter)\b/i, icon: 'fi-rr-search', kind: 'neutral' },
    { test: /\b(clear|reset)\b/i, icon: 'fi-rr-eraser', kind: 'neutral' },
    { test: /\b(prev|previous|back)\b/i, icon: 'fi-rr-angle-left', kind: 'neutral' },
    { test: /\b(next|forward)\b/i, icon: 'fi-rr-angle-right', kind: 'neutral' },
    { test: /\b(login|sign in)\b/i, icon: 'fi-rr-sign-in-alt', kind: 'primary' },
    { test: /\b(sign out|log out)\b/i, icon: 'fi-rr-sign-out-alt', kind: 'danger' },
    { test: /\b(confirm|yes|done|understood|dismiss)\b/i, icon: 'fi-rr-check', kind: 'primary' },
    { test: /\b(copy)\b/i, icon: 'fi-rr-copy', kind: 'neutral' },
    { test: /\b(settings|access|configure)\b/i, icon: 'fi-rr-settings', kind: 'neutral' },
    { test: /\b(restore|undo)\b/i, icon: 'fi-rr-undo', kind: 'primary' },
    { test: /\b(snooze|time|schedule)\b/i, icon: 'fi-rr-clock', kind: 'neutral' },
    { test: /\b(test|play)\b/i, icon: 'fi-rr-play', kind: 'neutral' },
    { test: /\b(photo|avatar|cover)\b/i, icon: 'fi-rr-camera', kind: 'neutral' },
    { test: /\b(show|password|credential|pin)\b/i, icon: 'fi-rr-eye', kind: 'neutral' },
    { test: /\b(personnel|people|user|register)\b/i, icon: 'fi-rr-user', kind: 'neutral' },
    { test: /\b(files|folder|open)\b/i, icon: 'fi-rr-folder', kind: 'neutral' },
    { test: /\bsecurity|authentication\b/i, icon: 'fi-rr-shield-check', kind: 'neutral' },
    { test: /\b(move up|up)\b/i, icon: 'fi-rr-arrow-up', kind: 'neutral' },
    { test: /\b(move down|down)\b/i, icon: 'fi-rr-arrow-down', kind: 'neutral' },
    { test: /\b(add|more)\b/i, icon: 'fi-rr-plus', kind: 'primary' }
  ];

  function getLabel(button) {
    const explicit = (button.getAttribute('aria-label') || '').trim();
    const title = (button.getAttribute('title') || '').trim();
    const content = (button.textContent || '').replace(/\s+/g, ' ').trim();
    const symbolOnly = /^[×✕✖＋+‹›←→↑↓↻↺−-]+$/.test(content);
    return explicit || title || (!symbolOnly ? content : '');
  }

  function resolveIcon(label, button) {
    const clean = String(label || '').trim();
    if (/^[‹←]|\b(prev|previous|back)\b/i.test(clean)) return ICON_RULES.find(x => x.test.test('previous'));
    if (/^[›→]|\b(next|forward)\b/i.test(clean)) return ICON_RULES.find(x => x.test.test('next'));
    if (/^[×✕✖]|\b(close|cancel|dismiss)\b/i.test(clean)) return ICON_RULES.find(x => x.test.test('close'));
    if (/^[＋+]/.test(clean)) return ICON_RULES.find(x => x.test.test('add'));
    return ICON_RULES.find(rule => rule.test.test(clean)) || { icon: 'fi-rr-apps', kind: 'neutral' };
  }

  function shouldSkip(button) {
    if (!(button instanceof HTMLButtonElement)) return true;
    if (button.matches(EXCLUDED) || button.closest('#navSidebar, .users-chat-format-toolbar')) return true;
    // Preserve buttons that are rich content controls rather than actions.
    if (button.querySelector('img, canvas, video, audio, .users-chat-unread-badge, .notification-title, .notification-msg')) return true;
    if (!getLabel(button)) return true;
    return false;
  }

  function renderIconButton(button, label, rule) {
    const profile = PAGE_ACTION_PROFILES[button.dataset.spadesActionKey || ''];
    const resolvedRule = profile || rule;
    const baseLabel = profile ? profile.label : label;
    const contextLabel = profile ? profile.context : '';
    const accessibleLabel = [baseLabel, contextLabel].filter(Boolean).join(' · ')
      .replace(/[×✕✖＋+‹›←→↑↓↻↺]/g, '').replace(/\s+/g, ' ').trim() || label;
    const tooltipLabel = profile ? `${profile.context} — ${profile.label}` : accessibleLabel;

    button.dataset.spadesOriginalLabel = accessibleLabel;
    button.dataset.spadesIconized = 'true';
    button.classList.add('spades-icon-only');
    button.classList.remove('spades-icon-primary', 'spades-icon-approve', 'spades-icon-danger', 'spades-icon-neutral');
    button.classList.add('spades-icon-' + resolvedRule.kind);
    button.setAttribute('aria-label', accessibleLabel);
    button.setAttribute('title', tooltipLabel);
    button.setAttribute('data-tooltip', tooltipLabel);
    button.setAttribute('data-spades-icon', resolvedRule.icon);

    const icon = document.createElement('i');
    icon.className = 'fi ' + resolvedRule.icon + ' spades-action-icon';
    icon.setAttribute('aria-hidden', 'true');
    const srLabel = document.createElement('span');
    srLabel.className = 'spades-visually-hidden';
    srLabel.textContent = accessibleLabel;
    button.replaceChildren(icon, srLabel);
  }

  function iconize(button) {
    if (!(button instanceof HTMLButtonElement)) return;

    // App workflows sometimes replace button text with transient states such as
    // “Saving…”. Restore the icon presentation and preserve the action label;
    // non-transient labels (e.g. Add -> Update) refresh the tooltip and icon.
    if (button.dataset.spadesIconized === 'true') {
      if (button.querySelector('.spades-action-icon')) return;
      const changedText = (button.textContent || '').replace(/\s+/g, ' ').trim();
      const isProgressText = /^(saving|submitting|verifying|processing|loading|uploading|deleting|refreshing)(?:\b|\.{0,3})/i.test(changedText);
      const label = isProgressText ? (button.dataset.spadesOriginalLabel || button.getAttribute('aria-label') || 'Action') : (changedText || button.dataset.spadesOriginalLabel || 'Action');
      const rule = resolveIcon(label, button);
      renderIconButton(button, label, rule);
      if (isProgressText) {
        button.dataset.spadesAutoBusy = 'true';
        button.setAttribute('aria-busy', 'true');
      } else if (button.dataset.spadesAutoBusy === 'true') {
        button.removeAttribute('aria-busy');
        delete button.dataset.spadesAutoBusy;
      }
      return;
    }

    if (shouldSkip(button)) return;
    const label = getLabel(button);
    if (!label) return;
    renderIconButton(button, label, resolveIcon(label, button));
  }

  function standardizeGroups(root) {
    const scope = root instanceof Element ? root : document;
    const candidates = new Set();
    if (scope instanceof HTMLButtonElement) candidates.add(scope);
    scope.querySelectorAll?.('button').forEach(button => candidates.add(button));
    candidates.forEach(iconize);

    // Keep sibling action icons aligned and anchored at the conventional end of
    // a form/modal action row without touching navigation or content toolbars.
    candidates.forEach(button => {
      if (!button.classList.contains('spades-icon-only')) return;
      const parent = button.parentElement;
      if (!parent || !parent.isConnected) return;
      const directActions = Array.from(parent.children).filter(node =>
        node instanceof HTMLButtonElement && node.classList.contains('spades-icon-only'));
      if (directActions.length > 1) parent.classList.add('spades-icon-action-group');
    });
  }

  function init() {
    standardizeGroups(document);
    const observer = new MutationObserver(records => {
      records.forEach(record => {
        record.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) standardizeGroups(node);
        });
        if (record.type === 'childList' && record.target instanceof Element && record.target.matches('button')) {
          iconize(record.target);
        }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.SPADESIconButtonObserver = observer;
    window.SPADESPageActionProfiles = PAGE_ACTION_PROFILES;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
