(function () {
  const storageKey = 'fixmyhome-dashboard-theme';
  const body = document.body;
  if (!body) return;

  function resolveTheme() {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === 'dark' || saved === 'light') {
        return saved;
      }
    } catch (error) {
      // Ignore storage read failures and fall back to light mode.
    }
    return 'light';
  }

  function applyTheme(theme) {
    body.setAttribute('data-theme', theme);
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    });
  }

  let currentTheme = resolveTheme();
  applyTheme(currentTheme);

  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
      try {
        window.localStorage.setItem(storageKey, currentTheme);
      } catch (error) {
        // Ignore storage write failures and still switch the theme in memory.
      }
      applyTheme(currentTheme);
    });
  });
})();
