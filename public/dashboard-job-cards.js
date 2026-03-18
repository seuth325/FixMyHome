(function () {
  const jobCards = Array.from(document.querySelectorAll('.job-card[data-job-card-id]'));
  if (jobCards.length === 0) return;

  const storageKey = 'fixmyhome-dashboard-collapsed-job-cards';

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

  function isInteractiveTarget(target) {
    return Boolean(target.closest('a, button, input, select, textarea, label, form, summary'));
  }

  const collapsedState = loadCollapsedState();

  function setCollapsed(card, body, toggle, collapsed) {
    body.hidden = collapsed;
    card.classList.toggle('is-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Expand job details' : 'Collapse job details');
    toggle.textContent = collapsed ? '+' : '-';
    collapsedState[card.dataset.jobCardId] = collapsed;
    saveCollapsedState(collapsedState);
  }

  jobCards.forEach((card, index) => {
    const summary = card.querySelector(':scope > .job-summary');
    if (!summary) return;

    const bodyNodes = Array.from(card.children).filter((child) => child !== summary);
    if (bodyNodes.length === 0) return;

    const cardId = card.dataset.jobCardId || `dashboard-job-card-${index + 1}`;
    card.dataset.jobCardId = cardId;
    card.classList.add('job-card-collapsible');

    const body = document.createElement('div');
    body.className = 'job-card-body';
    bodyNodes.forEach((node) => body.appendChild(node));
    card.appendChild(body);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'admin-card-toggle job-card-toggle';
    summary.appendChild(toggle);

    const initialCollapsed = Boolean(collapsedState[cardId]);
    setCollapsed(card, body, toggle, initialCollapsed);

    toggle.addEventListener('click', () => {
      setCollapsed(card, body, toggle, !body.hidden);
    });

    summary.addEventListener('click', (event) => {
      if (isInteractiveTarget(event.target)) return;
      setCollapsed(card, body, toggle, !body.hidden);
    });
  });
})();
