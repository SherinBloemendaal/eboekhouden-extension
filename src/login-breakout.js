// EB Sessions: login breakout for 1Password.
//
// The same approach as the e-Boekhouden 1Password fix in DacTecTools: keep the
// top URL, swap the frameset for one iframe.
//
// e-Boekhouden shows its login form three documents deep:
//
//   secure.e-boekhouden.nl/bh/            <frameset>, no <body>, quirks mode, five hidden 0x0 frames
//     frame "mainframe"                   secure20.e-boekhouden.nl/v1login (Angular, other origin)
//       <iframe>                          secure.e-boekhouden.nl/bh/inloggen.asp (the form)
//
// 1Password opens its inline menu there and tears it down ~40 ms later. This
// script takes the login form out of that structure without changing the top
// URL: on the login frameset it swaps the <frameset> for a plain <body> with
// one <iframe name="mainframe"> that loads inloggen.asp directly. The form is
// then one same-origin iframe below a normal body, the layout every ordinary
// site has and where 1Password's menu stays open.
//
// The top URL stays /bh/ because inloggen.asp bounces to /bh/ when it is the
// top window (`if (top === window) location.href = '/bh/'`). It only needs a
// same-origin top that is not itself, which the swapped page provides.
//
// Runs in every frame at document_start, before content.js. Roles:
//   top         /bh/ without v2Url: swap as soon as the parser yields the
//               mainframe frame. With v2Url (e-Boekhouden's own entry into
//               the app) do nothing unless the service worker asks (the
//               session turned out to be gone and mainframe shows v1login).
//   login host  the swapped iframe: when inloggen.asp comes back without a
//               login form (already logged in, or the response to a login),
//               tell the service worker, which opens the app via /bh?v2Url=.
//
// The service worker owns the rest (see background.js): it knows which tabs
// are in breakout mode, opens the app after login, keeps the re-login return
// and refuses to loop.

(() => {
  if (window.__ebsBreakoutLoaded) return;
  window.__ebsBreakoutLoaded = true;

  const ASP_ORIGIN = /^https:\/\/secure\d*\.e-boekhouden\.nl$/;
  const SECURE20 = 'secure20.e-boekhouden.nl';
  const LOGIN_SRC = /\/v1login(?:[?#]|$)|\/bh\/inloggen\.asp/i;
  const TOP_PATHS = ['/bh', '/bh/', '/bh/index.asp', '/bh/default.asp'];
  const HOST_ID = 'ebs-login-host';

  const isTop = window === window.top;
  const parentIsTop = !isTop && window.parent === window.top;

  function send(message) {
    return chrome.runtime.sendMessage(message).catch(() => ({}));
  }

  function onReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  if (isTop) runTop();
  if (parentIsTop && window.name === 'mainframe') runLoginHost();

  // -------------------------------------------------------------------------
  // Top: replace the login frameset with <body><iframe name="mainframe">.
  // -------------------------------------------------------------------------

  function runTop() {
    if (!ASP_ORIGIN.test(location.origin) || location.hostname === SECURE20) return;
    if (!TOP_PATHS.includes(location.pathname.toLowerCase())) return;

    // /bh?v2Url=<secure20 page> is e-Boekhouden's own way into the app with a
    // valid session. mainframe still says v1login there, so the src alone
    // cannot tell a login screen from an app entry. Leave it to the server;
    // the service worker asks for a swap if v1login really shows a form.
    const entersApp = new URLSearchParams(location.search).has('v2Url');

    // Every top load starts clean; the swap below switches it on.
    send({ type: 'login:host', active: false });

    let swapped = false;
    // The "Inloggen met 1Password" switch in the popup. Until the setting has
    // been read the swap waits; the parser is usually still in <head> then.
    let enabled = null;
    chrome.storage.local.get('settings').then(({ settings }) => {
      enabled = EBS.settingsWithDefaults(settings).onePassword;
      if (enabled && !entersApp) swap('parse');
    });

    function swap(reason) {
      if (enabled !== true) return enabled === false;
      if (swapped || document.getElementById(HOST_ID)) return true;
      const frameset = document.querySelector('frameset');
      const mainframe = document.querySelector('frame#mainframe, frame[name="mainframe"]');
      if (!frameset || !mainframe) return false;

      const src = mainframe.getAttribute('src') ?? '';
      if (reason === 'parse' && !LOGIN_SRC.test(src)) return false;

      // Carry EBM over; it is the only parameter inloggen.asp itself reads.
      const loginUrl = new URL('/bh/inloggen.asp', location.origin);
      try {
        const ebm = new URL(src, location.href).searchParams.get('EBM');
        if (ebm) loginUrl.searchParams.set('EBM', ebm);
      } catch { /* keep the bare URL */ }

      const body = document.createElement('body');
      body.id = HOST_ID;
      body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:#f5f5f5;';

      const iframe = document.createElement('iframe');
      iframe.id = 'mainframe';
      iframe.name = 'mainframe';
      iframe.title = 'Inloggen';
      iframe.src = loginUrl.href;
      iframe.setAttribute('allowfullscreen', '');
      iframe.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;background:#f5f5f5;';
      body.append(iframe);

      // The /bh/ page's own message handlers address top.hiddenframe and
      // top.jwtframe and fall back to navigating the top window when a frame
      // is missing (fGoto). Give them empty, invisible targets so a post-login
      // "tokensaved" message cannot send the top window to jwtredirect.asp.
      for (const name of ['hiddenframe', 'jwtframe']) {
        const sink = document.createElement('iframe');
        sink.id = name;
        sink.name = name;
        sink.src = 'about:blank';
        sink.tabIndex = -1;
        sink.setAttribute('aria-hidden', 'true');
        sink.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;';
        body.append(sink);
      }

      // The outermost <frameset> is document.body here. Replacing it stops
      // every frame in it, including the hidden ones and the secure20 shell.
      // Frames the parser still emits land in the detached subtree and never
      // load.
      frameset.replaceWith(body);
      swapped = true;
      send({ type: 'login:host', active: true });
      // login-page.js and content.js add the header and the switcher on this.
      document.dispatchEvent(new CustomEvent('ebs-login-host'));

      // As in DacTecTools: after a login the iframe lands on a page that is
      // no longer a login page. Same-origin pages are checked here; a landing
      // on secure20 (cross-origin) is reported by content.js in that frame.
      let lastInnerUrl = iframe.src;
      iframe.addEventListener('load', () => {
        let inner = '';
        try {
          inner = iframe.contentWindow?.location.href ?? '';
        } catch {
          return;
        }
        if (!inner || inner === lastInnerUrl) return;
        lastInnerUrl = inner;
        if (/uitloggen\.asp/i.test(inner)) {
          // Logged out from inside the iframe: show the login again.
          location.replace('/bh/');
          return;
        }
        if (!/inloggen\.asp|v1login|vergeten/i.test(inner)) send({ type: 'login:done', url: inner });
      });
      return true;
    }

    // Also from DacTecTools: logging out does not reload the top page, it only
    // sends mainframe to a login page. Watch for that and swap then. Only a
    // URL we can read counts: on /bh?v2Url= the frame's src attribute also
    // says v1login while the app is loading, so the attribute proves nothing.
    // A secure20 login screen (cross-origin) is reported through the service
    // worker instead (login:swap).
    const watch = window.setInterval(() => {
      if (swapped || document.getElementById(HOST_ID)) {
        window.clearInterval(watch);
        return;
      }
      const frame = document.querySelector('frame#mainframe, frame[name="mainframe"]');
      let url = '';
      try {
        url = frame?.contentWindow?.location.href ?? '';
      } catch {
        return;
      }
      if (/\/bh\/inloggen\.asp/i.test(url)) swap('request');
    }, 1000);

    if (!entersApp) {
      const observer = new MutationObserver(() => {
        if (swap('parse')) observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
      onReady(() => {
        observer.disconnect();
        swap('parse');
      });
    }

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'login:swap') onReady(() => swap('request'));
    });
  }

  // -------------------------------------------------------------------------
  // Login host iframe: inloggen.asp directly under the swapped top.
  // -------------------------------------------------------------------------

  function runLoginHost() {
    if (!ASP_ORIGIN.test(location.origin) || location.hostname === SECURE20) return;
    if (location.pathname.toLowerCase() !== '/bh/inloggen.asp') return;

    let hosted = false;
    try {
      hosted = Boolean(window.top.document.getElementById(HOST_ID));
    } catch {
      return; // cross-origin top: not our layout
    }
    if (!hosted) return;

    // "U bent reeds ingelogd" (a session was still valid; the page shows a
    // login form under that text) or inloggen.asp without its form (the
    // answer to a successful login) both mean: open the app. The bare form
    // is left to content.js (re-login dialog, 1Password labels).
    onReady(() => {
      const already = /reeds ingelogd/i.test(document.body?.innerText ?? '');
      if (!already && document.getElementById('txtEmail')) return;
      send({ type: 'login:done', url: location.href });
    });
  }
})();
