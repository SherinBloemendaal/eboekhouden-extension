// EB Sessions: make e-Boekhouden's login fields easy for password managers.
//
// Ported from the e-Boekhouden 1Password module in DacTecTools by Dion, as
// closely as this extension allows. In every e-Boekhouden frame it:
//   1. watches the DOM for password inputs, including type="text" to
//      type="password" toggles;
//   2. labels them and the username field next to them (autocomplete, name,
//      id), without overwriting a name or id the page already set;
//   3. wraps them in a real <form> when they are not in one;
//   4. re-fires input and change events when a password manager writes a
//      value, so framework-bound forms (the Angular ones on secure20) see it.
// It never fills or submits anything itself.

(() => {
  if (window.__ebsPasswordFieldsLoaded) return;
  window.__ebsPasswordFieldsLoaded = true;

  const PROCESSED_FLAG = '__ebsPwProcessed';
  const FORM_ID = 'ebs-eboekhouden-form';
  const perInput = new WeakMap();

  function annotateUsername(el) {
    el.setAttribute('autocomplete', 'username');
    if (!el.getAttribute('name')) el.setAttribute('name', 'username');
    if (!el.id) el.id = 'ebs-eboekhouden-username';
    el.setAttribute('data-ebs-role', 'username');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('spellcheck', 'false');
  }

  function annotatePassword(el) {
    el.setAttribute('autocomplete', 'current-password');
    if (!el.getAttribute('name')) el.setAttribute('name', 'password');
    if (!el.id) el.id = 'ebs-eboekhouden-password';
    el.setAttribute('data-ebs-role', 'password');
  }

  // Re-fire native form events so frameworks that listen for them accept
  // programmatic value writes from password managers.
  function fireNativeEvents(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function patchValueSetter(el) {
    if (el[PROCESSED_FLAG]) return;
    el[PROCESSED_FLAG] = true;

    let lastSeen = el.value;

    // Some autofillers set the value attribute.
    const attrObserver = new MutationObserver(() => {
      if (el.value !== lastSeen) {
        lastSeen = el.value;
        fireNativeEvents(el);
      }
    });
    attrObserver.observe(el, { attributes: true, attributeFilter: ['value'] });

    // Others set the property directly: poll for that.
    const pollInterval = window.setInterval(() => {
      if (!document.contains(el)) {
        cleanupOne();
        return;
      }
      if (el.value !== lastSeen) {
        lastSeen = el.value;
        fireNativeEvents(el);
      }
    }, 250);

    // Real typing keeps lastSeen current, so it does not trigger extra events.
    const onInput = () => {
      lastSeen = el.value;
    };
    el.addEventListener('input', onInput, true);

    function cleanupOne() {
      attrObserver.disconnect();
      window.clearInterval(pollInterval);
      el.removeEventListener('input', onInput, true);
      delete el[PROCESSED_FLAG];
    }

    perInput.set(el, cleanupOne);
  }

  function findUsernameNear(passwordEl) {
    const scope = passwordEl.closest('form')
      || passwordEl.closest('section')
      || passwordEl.closest('div[class*=login i]')
      || passwordEl.parentElement?.parentElement
      || document.body;
    if (!scope) return null;

    const candidates = [...scope.querySelectorAll('input:not([type]), input[type="text"], input[type="email"], input[type="tel"]')]
      .filter((input) => !input.hidden
        && input.offsetParent !== null
        && input.compareDocumentPosition(passwordEl) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (!candidates.length) return null;

    // Prefer what looks like a username or e-mail field.
    const ranked = candidates.map((input) => {
      const hint = [
        input.getAttribute('formcontrolname') ?? '',
        input.name ?? '',
        input.id ?? '',
        input.getAttribute('placeholder') ?? '',
        input.getAttribute('aria-label') ?? '',
      ].join(' ').toLowerCase();
      let score = 0;
      if (/user|gebruik|login|inlog|email|e-mail|account/.test(hint)) score += 5;
      if (input.type === 'email') score += 2;
      return { input, score };
    }).sort((a, b) => b.score - a.score);
    return ranked[0]?.input ?? null;
  }

  // Some password managers only pair fields inside a real <form>. The
  // classic inloggen.asp already has one; the Angular forms may not.
  function ensureForm(username, password) {
    if (password.closest('form')) return;
    const parent = password.parentElement;
    if (!parent || parent.querySelector(`form#${FORM_ID}`)) return;

    try {
      const form = document.createElement('form');
      form.id = FORM_ID;
      form.setAttribute('action', '#');
      form.setAttribute('method', 'post');
      form.setAttribute('autocomplete', 'on');
      form.setAttribute('data-ebs-form', '1');
      // Invisible to layout; the framework bindings keep working.
      form.style.display = 'contents';
      parent.insertBefore(form, password);
      if (username?.parentElement) form.appendChild(username);
      form.appendChild(password);

      // A hidden submit button makes it look like a real login form. Submitting
      // this wrapper only re-fires the field events; it never sends anything.
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.tabIndex = -1;
      submit.setAttribute('aria-hidden', 'true');
      submit.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
      form.appendChild(submit);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (username) fireNativeEvents(username);
        fireNativeEvents(password);
      });
    } catch (error) {
      console.warn('EB Sessions: could not wrap the login fields in a form', error);
    }
  }

  function processPasswordInput(passwordEl) {
    if (passwordEl.dataset.ebsRole === 'password') return;
    annotatePassword(passwordEl);
    const username = findUsernameNear(passwordEl);
    if (username) annotateUsername(username);
    ensureForm(username, passwordEl);
    patchValueSetter(passwordEl);
    if (username) patchValueSetter(username);
  }

  function scan(root) {
    root.querySelectorAll('input[type="password"]').forEach(processPasswordInput);
  }

  function start() {
    scan(document);
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          if (node.matches?.('input[type="password"]')) processPasswordInput(node);
          node.querySelectorAll?.('input[type="password"]').forEach(processPasswordInput);
        });
        // type="text" to type="password" toggles (show-password buttons).
        if (mutation.type === 'attributes' && mutation.attributeName === 'type'
          && mutation.target instanceof HTMLInputElement && mutation.target.type === 'password') {
          processPasswordInput(mutation.target);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['type'] });
  }

  // DacTecTools runs at document_idle; this script loads at document_start
  // with the others, so it starts once the DOM is parsed.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
