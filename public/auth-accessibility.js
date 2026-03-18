(function () {
  const firstErroredField = document.querySelector('input[aria-invalid="true"], select[aria-invalid="true"], textarea[aria-invalid="true"]');
  if (firstErroredField) {
    firstErroredField.focus();
    return;
  }

  const firstFlash = document.querySelector('.flash[role="alert"]');
  if (firstFlash) {
    firstFlash.setAttribute('tabindex', '-1');
    firstFlash.focus();
  }
})();
