(function () {
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  const csrfToken = getCsrfToken();
  if (!csrfToken) {
    return;
  }

  window.__csrfToken = csrfToken;

  const forms = Array.from(document.querySelectorAll('form[method="POST"], form[method="post"]'));
  forms.forEach((form) => {
    let input = form.querySelector('input[name="_csrf"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = '_csrf';
      form.appendChild(input);
    }
    input.value = csrfToken;

    const enctype = String(form.getAttribute('enctype') || form.enctype || '').toLowerCase();
    if (enctype.includes('multipart/form-data')) {
      try {
        const action = form.getAttribute('action') || window.location.pathname + window.location.search;
        const url = new URL(action, window.location.origin);
        url.searchParams.set('_csrf', csrfToken);
        form.action = url.pathname + url.search + url.hash;
      } catch (_error) {
        // Keep the hidden field fallback if the action URL cannot be rewritten.
      }
    }
  });
})();
