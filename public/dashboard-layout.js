(function () {
  const grid = document.querySelector('.homeowner-grid, .handyman-grid');
  if (!grid) return;

  const cards = Array.from(grid.querySelectorAll(':scope > .app-card'));
  if (cards.length === 0) return;

  const storageKey = grid.classList.contains('homeowner-grid')
    ? 'fixmyhome-homeowner-collapsed-cards'
    : 'fixmyhome-handyman-collapsed-cards';

  function loadCollapsedState() {
    try {
      const parsed = JSON.parse(window.sessionStorage.getItem(storageKey) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function saveCollapsedState(state) {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch (error) {
      // Ignore session storage issues and keep the dashboard usable.
    }
  }

  const collapsedState = loadCollapsedState();

  function isInteractiveTarget(target) {
    return Boolean(target.closest('a, button, input, select, textarea, label, form'));
  }

  function setCollapsed(card, body, toggle, collapsed) {
    body.hidden = collapsed;
    card.classList.toggle('is-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Expand section' : 'Collapse section');
    toggle.textContent = collapsed ? '+' : '-';
    collapsedState[card.dataset.dashboardCardId] = collapsed;
    saveCollapsedState(collapsedState);
  }

  cards.forEach((card, index) => {
    const header = card.querySelector(':scope > .section-head');
    if (!header) return;

    const bodyNodes = Array.from(card.children).filter((child) => child !== header);
    if (bodyNodes.length === 0) return;

    const cardId = header.querySelector('h2, h3, strong')?.textContent?.trim() || `dashboard-card-${index + 1}`;
    card.dataset.dashboardCardId = cardId;
    card.classList.add('admin-collapsible-card');

    const body = document.createElement('div');
    body.className = 'admin-card-body';
    bodyNodes.forEach((node) => body.appendChild(node));
    card.appendChild(body);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'admin-card-toggle';
    header.appendChild(toggle);

    const initialCollapsed = Boolean(collapsedState[cardId]);
    setCollapsed(card, body, toggle, initialCollapsed);

    toggle.addEventListener('click', () => {
      setCollapsed(card, body, toggle, !body.hidden);
    });

    header.addEventListener('click', (event) => {
      if (isInteractiveTarget(event.target)) return;
      setCollapsed(card, body, toggle, !body.hidden);
    });
  });

  document.querySelector('[data-dashboard-collapse-all]')?.addEventListener('click', () => {
    cards.forEach((card) => {
      const body = card.querySelector(':scope > .admin-card-body');
      const toggle = card.querySelector(':scope > .section-head .admin-card-toggle');
      if (!body || !toggle) return;
      setCollapsed(card, body, toggle, true);
    });
  });

  document.querySelector('[data-dashboard-expand-all]')?.addEventListener('click', () => {
    cards.forEach((card) => {
      const body = card.querySelector(':scope > .admin-card-body');
      const toggle = card.querySelector(':scope > .section-head .admin-card-toggle');
      if (!body || !toggle) return;
      setCollapsed(card, body, toggle, false);
    });
  });
})();
