/*
 * SPADES modular page bootstrap.
 * Loads every page fragment before the shared runtime so the legacy SPA
 * continues to find its original DOM IDs and handlers.
 */
(function () {
  'use strict';

  const pages = [
    ['dashboard', 'pageMount-dashboard'],
    ['memo-database', 'pageMount-memo-database'],
    ['profile', 'pageMount-profile'],
    ['personnel-management', 'pageMount-personnel-management'],
    ['activity-management', 'pageMount-activity-management'],
    ['settings', 'pageMount-settings'],
    ['user-management', 'pageMount-user-management']
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = () => resolve(src);
      script.onerror = () => reject(new Error(`Unable to load ${src}`));
      document.body.appendChild(script);
    });
  }

  async function bootstrap() {
    const missing = pages.filter(([, mountId]) => !document.getElementById(mountId));
    if (missing.length) {
      throw new Error(`Missing page mount point(s): ${missing.map(([, id]) => id).join(', ')}`);
    }

    // Fetch all HTML fragments; do not start app.js until every page is mounted.
    const fragments = await Promise.all(pages.map(async ([name, mountId]) => {
      const response = await fetch(`pages/${name}.html`, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Unable to load pages/${name}.html (${response.status})`);
      return { mountId, markup: await response.text(), name };
    }));

    fragments.forEach(({ mountId, markup, name }) => {
      const mount = document.getElementById(mountId);
      if (!markup.trim()) throw new Error(`The ${name} page is empty.`);
      mount.outerHTML = markup;
    });

    // Load page entry points first, then the shared runtime exactly once.
    for (const [name] of pages) await loadScript(`script/pages/${name}.js`);
    await loadScript('script/app.js');

    // Initialize optional page modules after the legacy runtime is available.
    Object.values(window.SPADESPageModules || {}).forEach((module) => {
      if (module && typeof module.init === 'function') {
        try { module.init(); }
        catch (error) { console.error('SPADES page module initialization failed:', error); }
      }
    });
    document.documentElement.classList.add('spades-pages-ready');
    window.dispatchEvent(new CustomEvent('spades:pages-ready'));
  }

  function showLoadError(error) {
    console.error('SPADES startup failed:', error);
    const notice = document.createElement('section');
    notice.setAttribute('role', 'alert');
    notice.style.cssText = 'margin:24px;padding:18px;border:1px solid #dc2626;border-radius:12px;color:#991b1b;background:#fef2f2;font:14px/1.5 Arial,sans-serif;';
    notice.innerHTML = '<strong>SPADES could not finish loading.</strong><br>Check your connection and confirm that the pages, css, and script folders are deployed beside index.html. Then refresh the page.';
    (document.querySelector('.main-content') || document.body).prepend(notice);
  }

  function start() { bootstrap().catch(showLoadError); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
