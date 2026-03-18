(function () {
  const cardSelectors = ['.notification-center.app-card', '.admin-grid > .app-card'];
  const cards = Array.from(document.querySelectorAll(cardSelectors.join(', ')));
  if (cards.length === 0) return;

  const storageKey = 'fixmyhome-admin-collapsed-cards';

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
      // Ignore storage write failures and keep the UI responsive.
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
    toggle.textContent = collapsed ? '+' : '−';
    collapsedState[card.dataset.adminCardId] = collapsed;
    saveCollapsedState(collapsedState);
  }

  cards.forEach((card, index) => {
    const header = card.querySelector(':scope > .section-head');
    if (!header) return;

    const bodyNodes = Array.from(card.children).filter((child) => child !== header);
    if (bodyNodes.length === 0) return;

    const cardId = header.querySelector('h2, h3, strong')?.textContent?.trim() || `card-${index + 1}`;
    card.dataset.adminCardId = cardId;
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

  const collapseAll = document.querySelector('[data-admin-collapse-all]');
  const expandAll = document.querySelector('[data-admin-expand-all]');

  collapseAll?.addEventListener('click', () => {
    cards.forEach((card) => {
      const body = card.querySelector(':scope > .admin-card-body');
      const toggle = card.querySelector(':scope > .section-head .admin-card-toggle');
      if (!body || !toggle) return;
      setCollapsed(card, body, toggle, true);
    });
  });

  expandAll?.addEventListener('click', () => {
    cards.forEach((card) => {
      const body = card.querySelector(':scope > .admin-card-body');
      const toggle = card.querySelector(':scope > .section-head .admin-card-toggle');
      if (!body || !toggle) return;
      setCollapsed(card, body, toggle, false);
    });
  });
})();
