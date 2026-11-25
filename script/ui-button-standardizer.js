/* -------------------------------------------------------------------------
   SPADES GLOBAL ICON BUTTON STANDARDIZER
   Action buttons retain visible text labels outside data tables. Dense table-row actions remain icon-only with accessible names and tooltips.
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
    '.nav-toggle-btn',
    // This prominent page-level action keeps both its plus icon and visible text.
    '#memoDatabaseAddBtn'
  ].join(',');

  // Modal and popup close controls are always X-only. This runs before the
  // general action-button label standardizer so their accessible name and
  // tooltip remain available without adding a visible text label.
  const MODAL_CLOSE_SELECTOR = [
    '.modal-close-control', '.spades-modal-close', '.profile-modal-close',
    '.profile-card-close', '.activity-details-close', '.activity-data-close',
    '.activity-edit-close', '.modal-uniform-close', '.my-files-close-btn',
    '.matrix-compliance-modal-close', '.chatbot-close',
    '.users-chat-dropdown-close', '.users-chat-minimized-close',
    '.incoming-chat-close'
  ].join(',');
  const MODAL_SURFACE_SELECTOR = [
    '.modal-overlay', '.profile-settings-overlay', '[role="dialog"]',
    '#chatbot-window', '.incoming-chat-popup', '.users-chat-dropdown'
  ].join(',');

  const PASSWORD_VISIBILITY_SELECTOR = '.credential-visibility-toggle, .alpha-credential-eye';

  // These controls intentionally remain icon-only even though the general button
  // standardizer restores visible labels elsewhere in the application.
  const FORCE_ICON_ONLY_SELECTOR = [
    '.spades-force-icon-only', '.pf-icon-only-control', '.spades-month-nav-icon-only',
    // Personnel Folder delete and File Preview download controls must never
    // regain visible text labels during global button standardization.
    '.folder-entry-delete', '#previewDownloadBtn',
    '#chatbot-bubble',
    '#profileHeaderBtn', '#pageRefreshBtn', '#prevMemoBtn', '#nextMemoBtn',
    '#prevActivityBtn', '#nextActivityBtn', '#prevArchivedActivityBtn', '#nextArchivedActivityBtn',
    '#prevMatrixComplianceBtn', '#nextMatrixComplianceBtn', '#personnelRecapToggle',
    '.profile-settings-overlay .profile-modal-actions button:not(.credential-visibility-toggle)',
    '.profile-settings-overlay .profile-utility-actions button',
    '.profile-picture-overlay .profile-picture-select-btn'
  ].join(',');

  function isModalCloseButton(button) {
    if (!(button instanceof HTMLButtonElement)) return false;
    if (button.matches(MODAL_CLOSE_SELECTOR) || button.classList.contains('spades-modal-icon-close')) return true;
    if (!button.closest(MODAL_SURFACE_SELECTOR)) return false;
    const aria = (button.getAttribute('aria-label') || '').trim();
    const title = (button.getAttribute('title') || button.getAttribute('data-tooltip') || '').trim();
    const visibleText = (button.textContent || '').replace(/\s+/g, ' ').trim();
    return /^close(?:\s|$)/i.test(aria) || /^close(?:\s|$)/i.test(title) || /^close$/i.test(visibleText);
  }

  function standardizeModalCloseButton(button) {
    if (!isModalCloseButton(button)) return false;

    button.classList.add('spades-modal-icon-close');
    button.classList.remove('spades-icon-labeled', 'spades-icon-primary', 'spades-icon-approve', 'spades-icon-danger');
    button.classList.add('spades-modal-close-neutral');
    button.type = 'button';
    button.setAttribute('aria-label', 'Close');
    button.setAttribute('title', 'Close');
    button.setAttribute('data-tooltip', 'Close');
    button.setAttribute('data-spades-tooltip', 'Close');
    button.dataset.spadesModalCloseNormalized = 'true';

    // Rebuild only the button contents; native/inline click handlers and all
    // modal-specific close behavior remain attached to the original button.
    const hasGlyph = !!button.querySelector('.spades-modal-close-glyph');
    const hasOnlyCloseContents = hasGlyph && button.querySelector('.spades-modal-close-sr');
    if (!hasOnlyCloseContents) {
      const icon = document.createElement('i');
      icon.className = 'fi fi-rr-cross-small spades-modal-close-glyph';
      icon.setAttribute('aria-hidden', 'true');
      const srLabel = document.createElement('span');
      srLabel.className = 'spades-visually-hidden spades-modal-close-sr';
      srLabel.textContent = 'Close';
      button.replaceChildren(icon, srLabel);
    }
    return true;
  }

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
    const forcedIcon = String(button?.dataset?.spadesIconName || '').trim();
    if (forcedIcon) return { icon: forcedIcon, kind: 'neutral' };
    if (/^[‹←]|\b(prev|previous|back)\b/i.test(clean)) return ICON_RULES.find(x => x.test.test('previous'));
    if (/^[›→]|\b(next|forward)\b/i.test(clean)) return ICON_RULES.find(x => x.test.test('next'));
    if (/^[×✕✖]|\b(close|cancel|dismiss)\b/i.test(clean)) return ICON_RULES.find(x => x.test.test('close'));
    if (/^[＋+]/.test(clean)) return ICON_RULES.find(x => x.test.test('add'));
    return ICON_RULES.find(rule => rule.test.test(clean)) || { icon: 'fi-rr-apps', kind: 'neutral' };
  }

  function shouldSkip(button) {
    if (!(button instanceof HTMLButtonElement)) return true;
    if (isModalCloseButton(button) || button.matches(EXCLUDED) || button.closest('#navSidebar, .users-chat-format-toolbar')) return true;
    // Preserve buttons that are rich content controls rather than actions.
    if (button.querySelector('img, canvas, video, audio, .users-chat-unread-badge, .notification-title, .notification-msg')) return true;
    if (!getLabel(button)) return true;
    return false;
  }

  function applyButtonMetadata(button, label, rule, profile) {
    const baseLabel = profile ? profile.label : label;
    const contextLabel = profile ? profile.context : '';
    const accessibleLabel = [baseLabel, contextLabel].filter(Boolean).join(' · ').replace(/[×✕✖＋+‹›←→↑↓↻↺]/g, '').replace(/\s+/g, ' ').trim() || label;
    const tooltipLabel = profile ? `${profile.context} — ${profile.label}` : accessibleLabel;
    button.dataset.spadesOriginalLabel = accessibleLabel;
    button.dataset.spadesIconized = 'true';
    button.setAttribute('aria-label', accessibleLabel);
    button.setAttribute('title', tooltipLabel);
    button.setAttribute('data-tooltip', tooltipLabel);
    button.setAttribute('data-spades-icon', (profile || rule).icon);
    button.classList.remove('spades-icon-primary','spades-icon-approve','spades-icon-danger','spades-icon-neutral');
    button.classList.add('spades-icon-' + (profile || rule).kind);
    return {accessibleLabel, tooltipLabel, rule:(profile || rule)};
  }

  function renderIconButton(button, label, rule) {
    // Dense data-table actions intentionally remain icon-only.
    const profile = PAGE_ACTION_PROFILES[button.dataset.spadesActionKey || ''];
    const meta = applyButtonMetadata(button, label, rule, profile);
    button.classList.add('spades-icon-only');
    button.classList.remove('spades-icon-labeled');
    const icon = document.createElement('i');
    icon.className = 'fi ' + meta.rule.icon + ' spades-action-icon';
    icon.setAttribute('aria-hidden', 'true');
    const srLabel = document.createElement('span');
    srLabel.className = 'spades-visually-hidden';
    srLabel.textContent = meta.accessibleLabel;
    button.replaceChildren(icon, srLabel);
  }

  function renderLabeledButton(button, label, rule) {
    const profile = PAGE_ACTION_PROFILES[button.dataset.spadesActionKey || ''];
    const originalText = (button.textContent || '').replace(/\s+/g, ' ').trim();
    const isProgress = /^(saving|submitting|verifying|processing|loading|uploading|deleting|refreshing)(?:\b|\.{0,3})/i.test(originalText);
    const meta = applyButtonMetadata(button, label, rule, profile);
    button.classList.remove('spades-icon-only');
    button.classList.add('spades-icon-labeled');
    const visibleText = originalText.replace(/^\s*[＋+↻↺‹›←→↑↓×✕✖]\s*/, '').trim();
    const visibleLabel = isProgress
      ? originalText
      : (profile ? profile.label : (visibleText || String(label || '').split(' · ').pop().trim() || meta.accessibleLabel));

    // Preserve an existing icon even when it is nested inside a text wrapper.
    let icon = button.querySelector('.spades-action-icon') || button.querySelector('i,svg');
    if (!icon) {
      icon = document.createElement('i');
      icon.className = 'fi ' + meta.rule.icon + ' spades-action-icon';
      icon.setAttribute('aria-hidden', 'true');
    } else {
      icon.classList.add('spades-action-icon');
      icon.setAttribute('aria-hidden', 'true');
    }
    if (icon.parentElement !== button) button.insertBefore(icon, button.firstChild);

    // Reuse a visible label or a previously generated screen-reader label.
    // If none exists, reuse a non-icon text wrapper before creating a new span.
    let textNode = button.querySelector('.spades-visible-button-label') || button.querySelector('.spades-visually-hidden');
    if (textNode === icon || (textNode && textNode.contains(icon))) textNode = null;
    if (!textNode) {
      textNode = Array.from(button.children).find(child => child !== icon && !child.matches('i,svg') && !child.contains(icon) && String(child.textContent || '').trim());
    }
    if (!textNode) {
      textNode = document.createElement('span');
      button.appendChild(textNode);
    }
    textNode.classList.remove('spades-visually-hidden');
    textNode.classList.add('spades-visible-button-label');
    textNode.textContent = visibleLabel;

    // Remove duplicate text wrappers and direct text while preserving any
    // additional decorative icons. This avoids icon + label + old-label duplication.
    Array.from(button.childNodes).forEach(node => {
      if (node === icon || node === textNode) return;
      if (node.nodeType === Node.TEXT_NODE && String(node.textContent || '').trim()) node.remove();
      else if (node.nodeType === Node.ELEMENT_NODE && !node.matches('i,svg') && !node.contains(icon) && String(node.textContent || '').trim()) node.remove();
    });
    button.dataset.spadesLabelled = 'true';
  }

  function standardizePasswordVisibilityButton(button) {
    if (!(button instanceof HTMLButtonElement) || !button.matches(PASSWORD_VISIBILITY_SELECTOR)) return false;

    const inputWrap = button.parentElement;
    const relatedInput = inputWrap?.querySelector('input[type="password"], input[type="text"]');
    const pressed = button.getAttribute('aria-pressed') === 'true' || relatedInput?.type === 'text';
    const label = (button.getAttribute('aria-label') || (pressed ? 'Hide password' : 'Show password')).trim();

    button.type = 'button';
    button.classList.add('spades-icon-only', 'spades-password-visibility-icon');
    button.classList.remove('spades-icon-labeled', 'spades-icon-primary', 'spades-icon-approve', 'spades-icon-danger');
    button.dataset.spadesOriginalLabel = label;
    button.dataset.spadesIconized = 'true';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.setAttribute('data-tooltip', label);
    button.setAttribute('data-spades-tooltip', label);
    button.setAttribute('aria-pressed', pressed ? 'true' : 'false');

    // Use the installed Flaticon Uicons font for both visibility states.
    // The crossed-eye state indicates that the credential is currently visible.
    let icon = button.querySelector('.spades-password-visibility-glyph');
    if (!icon) icon = document.createElement('i');
    icon.className = 'fi ' + (pressed ? 'fi-rr-eye-crossed' : 'fi-rr-eye') + ' spades-password-visibility-glyph';
    icon.setAttribute('aria-hidden', 'true');

    let srLabel = button.querySelector('.spades-password-visibility-sr');
    if (!srLabel) {
      srLabel = document.createElement('span');
      srLabel.className = 'spades-visually-hidden spades-password-visibility-sr';
    }
    srLabel.textContent = label;
    if (button.children.length !== 2 || button.children[0] !== icon || button.children[1] !== srLabel) {
      button.replaceChildren(icon, srLabel);
    }
    return true;
  }

  function isForceIconOnlyButton(button, label) {
    if (!(button instanceof HTMLButtonElement)) return false;
    if (button.matches(FORCE_ICON_ONLY_SELECTOR)) return true;
    const clean = String(label || '').replace(/^[‹←↞↤↢↰↶↻↺]+\s*/, '').replace(/\s*[›→↠↦↣↱↷]+$/, '').trim();
    return /^my profile$/i.test(clean) || /^refresh(?:\b|$)/i.test(clean) || /^(?:prev|previous|next)(?:\s+(?:page|record|activity|memo|compliance))?$/i.test(clean);
  }

  function iconize(button) {
    if (!(button instanceof HTMLButtonElement)) return;
    if (standardizePasswordVisibilityButton(button)) return;
    const label= getLabel(button) || button.dataset.spadesOriginalLabel || button.getAttribute('aria-label') || 'Action';
    const rule = resolveIcon(label, button);
    if (isForceIconOnlyButton(button, label)) {
      const desiredIconClass = 'fi ' + rule.icon + ' spades-action-icon';
      const currentIcon = button.querySelector('.spades-action-icon');
      const isAlreadyCorrect = button.dataset.spadesForceIconOnlyDone === 'true' && currentIcon && currentIcon.className === desiredIconClass && button.querySelector('.spades-visually-hidden');
      if (!isAlreadyCorrect) renderIconButton(button, label, rule);
      button.dataset.spadesForceIconOnlyDone = 'true';
      return;
    }
    if (shouldSkip(button)) return;
    if (button.closest('table')) {
      if (button.dataset.spadesIconized === 'true' && button.querySelector('.spades-action-icon')) return;
      renderIconButton(button, label, rule);
      return;
    }
    // Retain full, visible button labels everywhere outside table action cells.
    const existingVisible = button.querySelector('.spades-visible-button-label');
    if (button.dataset.spadesLabelled === 'true' && existingVisible) {
      const currentText = (button.textContent || '').replace(/\s+/g,' ').trim();
      const isProgress = /^(saving|submitting|verifying|processing|loading|uploading|deleting|refreshing)(?:\b|\.{0,3})/i.test(currentText);
      const nextLabel = isProgress
        ? currentText
        : ((PAGE_ACTION_PROFILES[button.dataset.spadesActionKey || ''] || {}).label || existingVisible.textContent.trim() || (label && label !== 'Action' ? label.split(' · ').pop().trim() : ''));
      if (nextLabel && existingVisible.textContent !== nextLabel) existingVisible.textContent = nextLabel;
      return;
    }
    renderLabeledButton(button, label, rule);
  }

  function standardizeGroups(root) {
    const scope = root instanceof Element ? root : document;
    const candidates = new Set();
    if (scope instanceof HTMLButtonElement) candidates.add(scope);
    scope.querySelectorAll?.('button').forEach(button => candidates.add(button));
    candidates.forEach(button => {
      if (!standardizeModalCloseButton(button) && !standardizePasswordVisibilityButton(button)) iconize(button);
    });

    // Keep sibling action buttons aligned without touching navigation or content toolbars.
    candidates.forEach(button => {
      if (!button.classList.contains('spades-icon-only') && !button.classList.contains('spades-icon-labeled')) return;
      const parent = button.parentElement;
      if (!parent || !parent.isConnected) return;
      const directActions = Array.from(parent.children).filter(node =>
        node instanceof HTMLButtonElement && (node.classList.contains('spades-icon-only') || node.classList.contains('spades-icon-labeled')));
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
        if (record.type === 'childList' && record.target instanceof HTMLButtonElement) {
          if (!standardizeModalCloseButton(record.target) && !standardizePasswordVisibilityButton(record.target)) iconize(record.target);
        }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.SPADESIconButtonObserver = observer;
    window.SPADESPageActionProfiles = PAGE_ACTION_PROFILES;
    window.SPADESModalCloseStandardizer = {
      normalize: standardizeModalCloseButton,
      selector: MODAL_CLOSE_SELECTOR,
      normalizePasswordVisibility: standardizePasswordVisibilityButton
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
