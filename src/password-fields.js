// EB Sessions: make e-Boekhouden's login fields easy for password managers.
//
// Ported from the e-Boekhouden 1Password module in DacTecTools by Dion, as
// closely as this extension allows. On e-Boekhouden's login pages only
// (inloggen.asp and secure20's v1login), and only with "Inloggen met
// 1Password" on, it:
//   1. watches the DOM for password inputs, including type="text" to
//      type="password" toggles;
//   2. labels them and the username field next to them (autocomplete, name,
//      id), without overwriting a name or id the page already set, and
//      leaves new-password, PIN and key fields alone;
//   3. re-fires input and change events when a password manager writes a
//      value, so framework-bound forms (the Angular ones on secure20) see it.
// It never fills or submits anything itself, and never moves the page's
// elements. (DacTecTools also wrapped loose fields in a new <form>; moving
// Angular's inputs out of their wrappers broke their layout and bindings.)

(() => {
  if (window.__ebsPasswordFieldsLoaded) return;
  window.__ebsPasswordFieldsLoaded = true;

  const PROCESSED_FLAG = '__ebsPwProcessed';
  const perInput = new WeakMap();
  const LOGIN_PAGE = /^https:\/\/secure\d*\.e-boekhouden\.nl\/(bh\/inloggen\.asp|v1login)(?:[?#]|$)/i;
  if (!LOGIN_PAGE.test(location.href)) return;
  // Not a login password: a new one, a repeat, a PIN or a key.
  const NOT_LOGIN = /new|nieuw|repeat|herhaal|bevestig|confirm|pin|api|key|sleutel|token|secret/i;

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

  function processPasswordInput(passwordEl) {
    if (passwordEl.dataset.ebsRole === 'password') return;
    const hint = [passwordEl.getAttribute('autocomplete'), passwordEl.name, passwordEl.id, passwordEl.getAttribute('formcontrolname'), passwordEl.getAttribute('placeholder')].join(' ');
    if (NOT_LOGIN.test(hint)) return;
    annotatePassword(passwordEl);
    const username = findUsernameNear(passwordEl);
    if (username) annotateUsername(username);
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
  // with the others, so it starts once the DOM is parsed and the setting is read.
  const settingRead = chrome.storage.local.get('settings')
    .then(({ settings }) => EBS.settingsWithDefaults(settings).onePassword)
    .catch(() => false);
  const domReady = document.readyState === 'loading'
    ? new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
    : Promise.resolve();
  Promise.all([settingRead, domReady]).then(([enabled]) => {
    if (enabled) start();
  });
})();
