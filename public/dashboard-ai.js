(function () {
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : (window.__csrfToken || '');
  }

  const promptInput = document.getElementById('job-ai-prompt');
  const draftButton = document.getElementById('job-ai-draft-btn');
  const polishButton = document.getElementById('job-ai-polish-btn');
  const budgetButton = document.getElementById('job-ai-budget-btn');
  const responsePanel = document.getElementById('job-ai-response');
  const statusEl = document.getElementById('job-ai-status');
  const summaryEl = document.getElementById('job-ai-summary');
  const budgetRangeEl = document.getElementById('job-ai-budget-range');
  const checklistEl = document.getElementById('job-ai-checklist');
  const chips = Array.from(document.querySelectorAll('.job-ai-chip'));

  const titleInput = document.getElementById('job-title');
  const categoryInput = document.getElementById('job-category');
  const descriptionInput = document.getElementById('job-description');
  const locationInput = document.getElementById('job-location');
  const budgetInput = document.getElementById('job-budget');
  const preferredDateInput = document.getElementById('job-preferred-date');

  if (!draftButton || !titleInput || !descriptionInput) {
    return;
  }

  function setBusy(button, isBusy, label) {
    button.disabled = isBusy;
    button.textContent = isBusy ? 'Working...' : label;
  }

  function showResponse(data, actionLabel) {
    responsePanel.hidden = false;
    statusEl.textContent = actionLabel + ' ready from ' + (data.source || 'assistant') + '.';
    summaryEl.textContent = data.summary || '';
    budgetRangeEl.textContent = data.budgetRangeLabel ? ('Suggested range: ' + data.budgetRangeLabel + (data.areaRateLabel ? ' based on a ' + data.areaRateLabel + '.' : '')) : ''; 
    checklistEl.innerHTML = '';
    (data.checklist || []).forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      checklistEl.appendChild(li);
    });
  }

  async function requestSuggestion(mode, button, idleLabel) {
    setBusy(button, true, idleLabel);
    responsePanel.hidden = false;
    statusEl.textContent = 'Thinking through the job details...';
    summaryEl.textContent = '';
    budgetRangeEl.textContent = '';
    checklistEl.innerHTML = '';

    try {
      const resp = await fetch('/api/ai/job-assist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        body: JSON.stringify({
          mode,
          prompt: promptInput.value,
          title: titleInput.value,
          category: categoryInput ? categoryInput.value : '',
          description: descriptionInput.value,
          location: locationInput ? locationInput.value : '',
          budget: budgetInput ? budgetInput.value : '',
          preferredDate: preferredDateInput ? preferredDateInput.value : '',
        }),
      });

      const data = await resp.json().catch(() => ({ error: 'Request failed' }));
      if (!resp.ok) {
        throw new Error(data.error || 'Request failed');
      }

      if (mode !== 'budget-only') {
        titleInput.value = data.title || titleInput.value;
        descriptionInput.value = data.description || descriptionInput.value;
        if (categoryInput && data.category) {
          categoryInput.value = data.category;
        }
      }
      if (budgetInput && data.budget) {
        budgetInput.value = data.budget;
      }
      if (preferredDateInput && data.preferredDate) {
        preferredDateInput.value = data.preferredDate;
      }

      showResponse(data, mode === 'budget-only' ? 'Budget suggestion' : mode === 'polish' ? 'Polished draft' : 'Draft');
    } catch (error) {
      statusEl.textContent = 'Unable to help right now: ' + error.message;
    } finally {
      setBusy(button, false, idleLabel);
    }
  }

  draftButton.addEventListener('click', function () {
    requestSuggestion('draft', draftButton, 'Draft job post');
  });

  if (polishButton) {
    polishButton.addEventListener('click', function () {
      requestSuggestion('polish', polishButton, 'Polish current details');
    });
  }

  if (budgetButton) {
    budgetButton.addEventListener('click', function () {
      requestSuggestion('budget-only', budgetButton, 'Suggest budget + timing');
    });
  }

  chips.forEach((chip) => {
    chip.addEventListener('click', function () {
      if (promptInput) {
        promptInput.value = chip.dataset.aiPrompt || '';
        promptInput.focus();
      }
    });
  });
})();

(function () {
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : (window.__csrfToken || '');
  }

  const bidAssistRoots = Array.from(document.querySelectorAll('[data-bid-assist-root]'));
  if (!bidAssistRoots.length) {
    return;
  }

  bidAssistRoots.forEach((root) => {
    const jobId = root.dataset.jobId || '';
    const recommendBtn = root.querySelector('[data-bid-assist-btn]');
    const polishBtn = root.querySelector('[data-bid-polish-btn]');
    const responsePanel = root.querySelector('[data-bid-assist-response]');
    const statusEl = root.querySelector('[data-bid-assist-status]');
    const summaryEl = root.querySelector('[data-bid-assist-summary]');
    const rangeEl = root.querySelector('[data-bid-assist-range]');
    const tipsEl = root.querySelector('[data-bid-assist-tips]');
    const amountInput = root.querySelector('[data-bid-amount]');
    const etaInput = root.querySelector('[data-bid-eta]');
    const messageInput = root.querySelector('[data-bid-message]');

    if (!jobId || !recommendBtn || !amountInput || !etaInput || !messageInput) {
      return;
    }

    function setBusy(button, isBusy, label) {
      button.disabled = isBusy;
      button.textContent = isBusy ? 'Working...' : label;
    }

    function showResponse(data, label) {
      if (!responsePanel) return;
      responsePanel.hidden = false;
      if (statusEl) statusEl.textContent = label + ' ready from ' + (data.source || 'assistant') + '.';
      if (summaryEl) summaryEl.textContent = data.strategy || '';
      if (rangeEl) rangeEl.textContent = data.targetRangeLabel ? ('Target range: ' + data.targetRangeLabel + ' · ' + (data.competitivenessLabel || '')) : '';
      if (tipsEl) {
        tipsEl.innerHTML = '';
        (data.tips || []).forEach((tip) => {
          const li = document.createElement('li');
          li.textContent = tip;
          tipsEl.appendChild(li);
        });
      }
    }

    async function requestBidSuggestion(mode, button, idleLabel) {
      setBusy(button, true, idleLabel);
      if (responsePanel) responsePanel.hidden = false;
      if (statusEl) statusEl.textContent = 'Reviewing the job and building a stronger bid...';
      if (summaryEl) summaryEl.textContent = '';
      if (rangeEl) rangeEl.textContent = '';
      if (tipsEl) tipsEl.innerHTML = '';

      try {
        const resp = await fetch('/api/ai/bid-assist', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken(),
          },
          body: JSON.stringify({
            mode,
            jobId,
            amount: amountInput.value,
            etaDays: etaInput.value,
            message: messageInput.value,
          }),
        });

        const data = await resp.json().catch(() => ({ error: 'Request failed' }));
        if (!resp.ok) {
          throw new Error(data.error || 'Request failed');
        }

        amountInput.value = data.amount || amountInput.value;
        etaInput.value = data.etaDays || etaInput.value;
        if (data.message) {
          messageInput.value = data.message;
        }
        showResponse(data, mode === 'polish' ? 'Message polish' : 'Bid recommendation');
      } catch (error) {
        if (statusEl) statusEl.textContent = 'Unable to help right now: ' + error.message;
      } finally {
        setBusy(button, false, idleLabel);
      }
    }

    recommendBtn.addEventListener('click', function () {
      requestBidSuggestion('recommend', recommendBtn, 'Recommend quote');
    });

    if (polishBtn) {
      polishBtn.addEventListener('click', function () {
        requestBidSuggestion('polish', polishBtn, 'Polish message');
      });
    }
  });
})();
