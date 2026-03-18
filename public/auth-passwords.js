(function () {
  const toggles = document.querySelectorAll('[data-password-toggle]');
  const meters = document.querySelectorAll('[data-password-strength-input]');
  const matchers = document.querySelectorAll('[data-password-match-with]');
  const capsAwareInputs = document.querySelectorAll('[data-caps-lock-output]');
  const emailInputs = document.querySelectorAll('[data-email-hint-output]');

  toggles.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const inputId = toggle.getAttribute('data-password-toggle');
      const input = document.getElementById(inputId);
      if (!input) return;
      const nextType = input.type === 'password' ? 'text' : 'password';
      input.type = nextType;
      toggle.textContent = nextType === 'password' ? 'Show' : 'Hide';
    });
  });

  function scorePassword(value) {
    let score = 0;
    if (value.length >= 8) score += 1;
    if (/[A-Z]/.test(value)) score += 1;
    if (/[a-z]/.test(value)) score += 1;
    if (/\d/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;
    return score;
  }

  function describeStrength(score, value) {
    if (!value) {
      return {
        label: 'Use 8+ characters and include at least 3 of these: uppercase, lowercase, number, symbol.',
        tone: 'muted',
      };
    }
    if (value.length < 8 || score <= 2) {
      return {
        label: 'Weak password. Aim for 8+ characters and at least 3 of 4: uppercase, lowercase, number, symbol.',
        tone: 'warning',
      };
    }
    if (score === 3 || score === 4) {
      return {
        label: 'Good start. You meet the minimum rule. Adding more variety or length makes it stronger.',
        tone: 'review',
      };
    }
    return {
      label: 'Strong password. Nice coverage across uppercase, lowercase, number, and symbol.',
      tone: 'success',
    };
  }

  meters.forEach((input) => {
    const targetId = input.getAttribute('data-password-strength-input');
    const output = document.getElementById(targetId);
    if (!output) return;

    const update = () => {
      const strength = describeStrength(scorePassword(input.value), input.value);
      output.textContent = strength.label;
      output.setAttribute('data-password-strength-tone', strength.tone);
    };

    input.addEventListener('input', update);
    update();
  });

  matchers.forEach((input) => {
    const sourceId = input.getAttribute('data-password-match-with');
    const outputId = input.getAttribute('data-password-match-output');
    const source = document.getElementById(sourceId);
    const output = document.getElementById(outputId);
    if (!source || !output) return;

    const update = () => {
      if (!source.value && !input.value) {
        output.textContent = 'Re-enter your password to confirm it matches.';
        output.setAttribute('data-password-match-tone', 'muted');
        return;
      }

      if (!input.value) {
        output.textContent = 'Confirm your password to finish setup.';
        output.setAttribute('data-password-match-tone', 'muted');
        return;
      }

      if (source.value === input.value) {
        output.textContent = 'Passwords match.';
        output.setAttribute('data-password-match-tone', 'success');
        return;
      }

      output.textContent = 'Passwords do not match yet.';
      output.setAttribute('data-password-match-tone', 'warning');
    };

    source.addEventListener('input', update);
    input.addEventListener('input', update);
    update();
  });

  capsAwareInputs.forEach((input) => {
    const outputId = input.getAttribute('data-caps-lock-output');
    const output = document.getElementById(outputId);
    if (!output) return;

    const setTone = (isCapsOn) => {
      if (isCapsOn) {
        output.textContent = 'Caps lock appears to be on.';
        output.setAttribute('data-caps-lock-tone', 'warning');
      } else {
        output.textContent = 'Caps lock is off.';
        output.setAttribute('data-caps-lock-tone', 'muted');
      }
    };

    input.addEventListener('keydown', (event) => {
      setTone(Boolean(event.getModifierState && event.getModifierState('CapsLock')));
    });
    input.addEventListener('keyup', (event) => {
      setTone(Boolean(event.getModifierState && event.getModifierState('CapsLock')));
    });
    input.addEventListener('focus', (event) => {
      setTone(Boolean(event.getModifierState && event.getModifierState('CapsLock')));
    });
    input.addEventListener('blur', () => {
      output.textContent = 'Caps lock is off.';
      output.setAttribute('data-caps-lock-tone', 'muted');
    });

    setTone(false);
  });

  emailInputs.forEach((input) => {
    const outputId = input.getAttribute('data-email-hint-output');
    const output = document.getElementById(outputId);
    if (!output) return;

    const update = () => {
      const value = String(input.value || '').trim();
      if (!value) {
        output.setAttribute('data-email-hint-tone', 'muted');
        return;
      }

      if (!value.includes('@')) {
        output.textContent = 'Include an @ sign in the email address.';
        output.setAttribute('data-email-hint-tone', 'warning');
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        output.textContent = 'Double-check the email format before submitting.';
        output.setAttribute('data-email-hint-tone', 'review');
        return;
      }

      output.textContent = 'Email format looks good.';
      output.setAttribute('data-email-hint-tone', 'success');
    };

    input.addEventListener('input', update);
    input.addEventListener('blur', update);
    update();
  });
})();
