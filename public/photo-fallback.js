(function () {
  const photos = document.querySelectorAll('.photo-thumb');
  if (photos.length === 0) return;

  function markBroken(img) {
    const link = img.closest('.photo-thumb-link');
    if (!link) return;
    link.classList.add('photo-thumb-broken');
    img.remove();
  }

  photos.forEach((img) => {
    if (img.complete && typeof img.naturalWidth === 'number' && img.naturalWidth === 0) {
      markBroken(img);
      return;
    }

    img.addEventListener('error', () => markBroken(img), { once: true });
  });
})();
