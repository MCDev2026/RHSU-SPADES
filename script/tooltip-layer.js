/* SPADES global tooltip layer
   Renders navigation labels and contextual button hints in a portal attached
   directly to <body>, so sidebar/modal overflow and stacking contexts cannot
   clip or cover them. Original accessible names are retained via aria-label. */
(function () {
  'use strict';

  const TARGET_SELECTOR = [
    '#navSidebar .sidebar-btn',
    '[title]:not(iframe):not(option)',
    '[data-tooltip]',
    'button[aria-label]', 'a[aria-label]',
    '[role="button"][aria-label]',
    '[data-spades-tooltip]'
  ].join(',');

  let layer = null;
  let activeTarget = null;
  let activeLabel = '';

  function isCollapsedDesktopNav(target) {
    return !!(target && target.matches('#navSidebar.sidebar.collapsed .sidebar-btn') &&
      window.matchMedia && window.matchMedia('(min-width: 993px)').matches);
  }

  function getLabel(target) {
    if (!target) return '';
    if (target.matches('#navSidebar .sidebar-btn')) {
      if (!isCollapsedDesktopNav(target)) return '';
      const navText = target.querySelector('.nav-text');
      const navLabel = navText ? navText.textContent.replace(/\s+/g, ' ').trim() : '';
      if (navLabel) return navLabel;
    }
    return (
      target.getAttribute('data-tooltip') ||
      target.getAttribute('data-spades-tooltip') ||
      target.getAttribute('title') ||
      target.getAttribute('aria-label') ||
      ''
    ).replace(/\s+/g, ' ').trim();
  }

  function prepareTarget(target) {
    if (!(target instanceof Element)) return;
    if (!target.matches(TARGET_SELECTOR)) return;

    const title = target.getAttribute('title');
    const dataTooltip = target.getAttribute('data-tooltip');
    const navText = isCollapsedDesktopNav(target) ? target.querySelector('.nav-text') : null;
    const navLabel = navText ? navText.textContent.replace(/\s+/g, ' ').trim() : '';
    const label = (dataTooltip || title || target.getAttribute('aria-label') || navLabel || '').trim();
    if (label) {
      target.setAttribute('data-spades-tooltip', label);
      if (target.matches('button, [role="button"]') && !target.hasAttribute('aria-label')) {
        target.setAttribute('aria-label', label);
      } else if (target.matches('a, input, select, textarea, [tabindex], [role]') && !target.hasAttribute('aria-description')) {
        target.setAttribute('aria-description', label);
      }
    }
    // Native title bubbles can appear underneath/in front of the custom layer
    // unpredictably. Move the value to a data attribute and keep it accessible.
    if (title !== null) target.removeAttribute('title');
  }

  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.getElementById('spadesTooltipLayer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'spadesTooltipLayer';
      layer.className = 'spades-tooltip-layer';
      layer.setAttribute('role', 'tooltip');
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);
    }
    return layer;
  }

  function positionLayer(target) {
    if (!layer || !target || !target.isConnected) return;
    const rect = target.getBoundingClientRect();
    const viewW = document.documentElement.clientWidth;
    const viewH = document.documentElement.clientHeight;
    const navFlyout = isCollapsedDesktopNav(target);
    let x;
    let y;
    let placement;

    if (navFlyout) {
      placement = 'right';
      x = rect.right + 11;
      y = rect.top + rect.height / 2;
    } else {
      const spaceAbove = rect.top;
      const spaceBelow = viewH - rect.bottom;
      placement = spaceAbove >= 58 || spaceAbove >= spaceBelow ? 'top' : 'bottom';
      x = rect.left + rect.width / 2;
      y = placement === 'top' ? rect.top - 9 : rect.bottom + 9;
    }

    layer.dataset.placement = placement;
    layer.style.left = `${Math.round(x)}px`;
    layer.style.top = `${Math.round(y)}px`;
    layer.style.maxWidth = `${Math.max(120, Math.min(320, viewW - 24))}px`;

    // After layout, keep any label within the viewport without changing its
    // target relationship. Nav labels prefer the right side but flip left near
    // the viewport edge.
    const tooltipRect = layer.getBoundingClientRect();
    if (navFlyout && tooltipRect.right > viewW - 10) {
      layer.dataset.placement = 'left';
      layer.style.left = `${Math.max(10, Math.round(rect.left - 11))}px`;
    } else if (!navFlyout) {
      const half = tooltipRect.width / 2;
      x = Math.max(half + 10, Math.min(viewW - half - 10, x));
      layer.style.left = `${Math.round(x)}px`;
    }
  }

  function show(target, label) {
    if (!target || !label) return;
    const tooltip = ensureLayer();
    if (activeTarget === target && activeLabel === label) {
      positionLayer(target);
      return;
    }
    if (activeTarget && activeTarget !== target) {
      const previousIds = (activeTarget.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== 'spadesTooltipLayer');
      if (previousIds.length) activeTarget.setAttribute('aria-describedby', previousIds.join(' '));
      else activeTarget.removeAttribute('aria-describedby');
    }
    activeTarget = target;
    activeLabel = label;
    tooltip.textContent = label;
    tooltip.classList.add('is-visible');
    tooltip.setAttribute('aria-hidden', 'false');
    if (target.hasAttribute('aria-describedby')) {
      const current = target.getAttribute('aria-describedby').split(/\s+/).filter(Boolean);
      if (!current.includes('spadesTooltipLayer')) current.push('spadesTooltipLayer');
      target.setAttribute('aria-describedby', current.join(' '));
    } else {
      target.setAttribute('aria-describedby', 'spadesTooltipLayer');
    }
    positionLayer(target);
  }

  function hide(target) {
    if (target && activeTarget && target !== activeTarget && activeTarget.contains(target)) return;
    if (layer) {
      layer.classList.remove('is-visible');
      layer.setAttribute('aria-hidden', 'true');
    }
    if (activeTarget) {
      const ids = (activeTarget.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== 'spadesTooltipLayer');
      if (ids.length) activeTarget.setAttribute('aria-describedby', ids.join(' '));
      else activeTarget.removeAttribute('aria-describedby');
    }
    activeTarget = null;
    activeLabel = '';
  }

  function resolveTarget(node) {
    if (!(node instanceof Element)) return null;
    const target = node.closest(TARGET_SELECTOR);
    return target && target.isConnected ? target : null;
  }

  function onPointerOver(event) {
    if (event.pointerType === 'touch') return;
    const target = resolveTarget(event.target);
    if (!target) return;
    prepareTarget(target);
    const label = getLabel(target);
    if (label) show(target, label);
  }

  function onPointerOut(event) {
    const target = resolveTarget(event.target);
    if (!target || target !== activeTarget) return;
    if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
    hide(target);
  }

  function onFocusIn(event) {
    const target = resolveTarget(event.target);
    if (!target) return;
    prepareTarget(target);
    const label = getLabel(target);
    if (label) show(target, label);
  }

  function onFocusOut(event) {
    const target = resolveTarget(event.target);
    if (!target || target !== activeTarget) return;
    if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
    hide(target);
  }

  function refreshTooltips(root) {
    const scope = root instanceof Element ? root : document;
    if (scope.matches && scope.matches(TARGET_SELECTOR)) prepareTarget(scope);
    scope.querySelectorAll?.(TARGET_SELECTOR).forEach(prepareTarget);
  }

  function init() {
    ensureLayer();
    refreshTooltips(document);
    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    window.addEventListener('scroll', () => {
      if (activeTarget) positionLayer(activeTarget);
    }, true);
    window.addEventListener('resize', () => {
      if (activeTarget) positionLayer(activeTarget);
    }, { passive: true });

    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'childList') {
          record.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) refreshTooltips(node);
          });
        } else if (record.type === 'attributes' && record.target instanceof Element) {
          prepareTarget(record.target);
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title', 'data-tooltip']
    });
    window.SPADESGlobalTooltipLayer = { show, hide, refresh: refreshTooltips };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
