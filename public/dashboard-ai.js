(function () {
  const btn = document.getElementById('ai-generate-btn');
  if (!btn) return;

  const titleInput = document.getElementById('post-title');
  const captionInput = document.getElementById('post-caption');
  const topicInput = document.getElementById('ai-topic');
  const audienceInput = document.getElementById('ai-audience');
  const goalInput = document.getElementById('ai-goal');
  const toneInput = document.getElementById('ai-tone');
  const platformInput = document.getElementById('ai-platform');
  const statusEl = document.getElementById('ai-status');

  async function generate() {
    btn.disabled = true;
    btn.textContent = 'Generating...';
    statusEl.textContent = '';

    try {
      const payload = {
        topic: topicInput.value,
        audience: audienceInput.value,
        goal: goalInput.value,
        tone: toneInput.value,
        platform: platformInput.value,
      };

      const resp = await fetch('/api/ai/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || 'Request failed');
      }

      const data = await resp.json();
      titleInput.value = data.title || '';
      captionInput.value = data.caption || '';
      statusEl.textContent = `Suggestion generated (${data.source}).`;
    } catch (err) {
      statusEl.textContent = `Unable to generate suggestion: ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Recommend Title + Caption';
    }
  }

  btn.addEventListener('click', generate);
})();
