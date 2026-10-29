<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.svg">
  <img alt="EB Sessions: e-Boekhouden, without the login friction" src="assets/banner-light.svg" width="100%">
</picture>

<br>

<a href="https://github.com/SherinBloemendaal/eboekhouden-extension/actions/workflows/ci.yml"><img src="https://github.com/SherinBloemendaal/eboekhouden-extension/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-yellow.svg?style=flat-square" alt="License: MIT"></a>
<img src="https://img.shields.io/badge/manifest-V3-2F3A66.svg?style=flat-square" alt="Manifest V3">
<img src="https://img.shields.io/badge/chrome-116%2B-4E9A2C.svg?style=flat-square" alt="Chrome 116+">
<img src="https://img.shields.io/badge/dependencies-none-555555.svg?style=flat-square" alt="No dependencies">

**EB Sessions** is a small Chrome extension for [e-Boekhouden.nl](https://www.e-boekhouden.nl) that switches between administrations in one click and turns an expired session into a login dialog instead of a lost page.<br>
Repo: [github.com/SherinBloemendaal/eboekhouden-extension](https://github.com/SherinBloemendaal/eboekhouden-extension)

[Install](#-install) · [Highlights](#-highlights) · [1Password](#-1password-not-solved-yet) · [Switching](#-switching-sessions) · [Re-login](#%EF%B8%8F-re-login-dialog) · [Security](#-security) · [Development](#-development)

</div>

<br>

> [!NOTE]
> This is an unofficial, personal tool. It is not made by or affiliated with e-Boekhouden.nl. It only changes how pages are shown in your own browser, and it never submits forms or bookings for you.

## ✨ Highlights

- **One click between administrations.** A switcher in the e-Boekhouden header lists every administration you logged in to in this Chrome session. Pick one and all e-Boekhouden tabs move over, no logging out and in.
- **Expired session? Log in where you are.** Instead of being dropped on the login page, you get a dialog over the page, with 1Password working there too. After login you are back on the page you were on.
- **Passwords never touch the extension.** Logging in always goes through the real e-Boekhouden form and 1Password. The extension stores session cookies in memory only, and only for e-Boekhouden.
- **No dependencies, no network calls.** Plain JavaScript, no build step, nothing sent anywhere.

## 📦 Install

The extension is not on the Chrome Web Store. Load it unpacked:

```bash
git clone https://github.com/SherinBloemendaal/eboekhouden-extension.git
```

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `eboekhouden-extension` folder.
4. Reload any open e-Boekhouden tab.

To update, run `git pull` in the folder and click the reload icon on the extension's card in `chrome://extensions`. To remove it, click **Remove** on that card; that also deletes everything it stored.

## 🔑 1Password: not solved yet

On the e-Boekhouden login page, 1Password's inline menu closes the moment it opens. The extension does not fix that yet. It only labels the login fields as `username` and `current-password`.

What is known so far:

- **The login page is three documents deep.** `secure.e-boekhouden.nl/bh/` is a `<frameset>` (no `<body>`). Its `mainframe` loads `secure20.e-boekhouden.nl/v1login`, an Angular app on another origin, which shows the classic form `secure.e-boekhouden.nl/bh/inloggen.asp` in an `<iframe>`. Both e-Boekhouden documents render in quirks mode.
- **The page does not steal focus.** On the live login page nothing calls `focus()` after load, no window blurs, no frame reloads, the form is not re-rendered, and no resize, scroll or message events fire.
- **The layout alone does not explain it.** Local test pages that copy the layout (a frameset, a cross-origin frame in between, quirks mode, each on its own and together) keep the menu open, except the exact three-level layout.
- **Removing the cross-origin frame is not enough.** Loading `inloggen.asp` straight into `mainframe` made the local copy work, but on the real site 1Password still inserts its menu and removes it about 40 ms later. That change was reverted, because it also broke opening the app with a session that was still valid.

The remaining difference is that 1Password has saved logins for e-Boekhouden and none for the local test pages. Ideas and reports are welcome as issues.

## 🔀 Switching sessions

Cookies in Chrome are shared by every tab of a profile, so two administrations cannot be logged in side by side in one profile. The switcher does the next best thing: it keeps a copy of each administration's e-Boekhouden cookies and swaps them in when you switch.

The switcher is a navbar item in e-Boekhouden's own header, styled after whichever design you use. It is placed while the header renders, so it is there from the first frame.

<table>
<tr>
<td width="50%" valign="top"><b>New design</b><br><br><img alt="The switcher in the new design, with four example administrations and a profile picture" src="assets/switcher-new.png" width="100%"></td>
<td width="50%" valign="top"><b>Legacy design</b><br><br><img alt="The switcher in the legacy design, with four example administrations" src="assets/switcher-legacy.png" width="100%"></td>
</tr>
</table>

- **Logging in adds the administration.** The frameset's title is the administration's name, so after each login the session is saved under that name, with the number from the header.
- **Pick one to switch.** The current cookies are saved, the chosen ones are put back, and every e-Boekhouden tab opens the app the way e-Boekhouden itself does after login (`/bh?v2Url=…`). With more than one e-Boekhouden tab open, the switcher asks first, because unsaved input in those tabs is lost.
- **Administratie toevoegen** (*Sessie toevoegen* in the legacy design) saves the current session and opens an empty login screen for the next administration.
- **Status per entry:** *Actief* (the one you are in), *Klaar* (ready to switch to), *Verlopen* in red (e-Boekhouden ended that session; picking it opens the login screen), *Inloggen* (known, but no session in memory).
- **Profile pictures** (new design only). Hover an entry and click the camera to pick a picture. It replaces the initials circle in the e-Boekhouden header while that administration is active, and shows in the list. Pictures are cropped to 128 px and stored locally; they are never uploaded.
- **Remove an entry** with the bin icon on hover. Logging in again adds it back.

Sessions live in memory, so after restarting Chrome each administration asks for one login again. Names, numbers and pictures stay.

## ⏱️ Re-login dialog

<img alt="The re-login dialog over a dimmed page" src="assets/relogin.png" width="100%">

When a session expires, e-Boekhouden sends the main frame to its login page, its *sessie verlopen* page, or a JWT error page. The extension remembers the last page you had open in that tab and shows the real login form as a centered dialog instead. After you log in, the extension opens the page you were on again, including the classic page inside the Angular shell.

A real logout (the power button) does not trigger the dialog. **Gewoon inloggen** under the form drops the return and shows the normal login screen.

> [!NOTE]
> By the time e-Boekhouden shows its login page, the old page is already gone, and so is its session on the server. The dialog cannot keep the old page alive behind it. It brings you back to it, as a fresh load. Input that was not saved yet is lost, just as it is without the extension.

## 🔒 Security

- **No passwords.** The extension never reads, stores or fills a password. You type it or 1Password fills it into e-Boekhouden's own form, which posts straight to e-Boekhouden.
- **Session cookies in `chrome.storage.session` only.** That storage lives in memory and is wiped when Chrome quits or the extension reloads. Its access level is set to trusted contexts, so content scripts on e-Boekhouden pages cannot read it. Cookie values never leave the service worker: pages only get names and flags.
- **Why not encrypted local storage?** Storing on disk would keep sessions across restarts, but the key would have to live next to the data in the same profile, so the encryption would protect against very little. A session cookie is as good as a login, so it stays in memory. One login per administration after a restart is the price.
- **What is stored on disk**, in `chrome.storage.local`: the administration names and numbers, whether a session expired, which one is active, and your profile pictures. Pages read this to draw the switcher. No cookies, no customer data.
- **Minimum permissions.** `cookies` and `storage`, and host access to `https://*.e-boekhouden.nl/*`, which covers the `secure*` hosts and the cookies e-Boekhouden sets on `.e-boekhouden.nl`. The content script only runs on `secure*.e-boekhouden.nl`. No `tabs` permission, no access to other sites, no remote code.
- **No financial actions.** The extension never submits a form, never clicks for you, and never touches bookings. It only changes how the login form looks when a session expired, and which page loads after login or a switch.

## 🧪 Development

No build step. Edit the files and reload the extension in `chrome://extensions`.

```bash
npm test          # service worker tests, with an in-memory fake of the chrome.* APIs
npm run check     # syntax check of both scripts
```

The tests cover the cookie swap (host-only and domain cookies, expired cookies), the confirm step with several tabs, slots matched by administration name, expired and logged-out sessions, profile picture validation, the re-login return including the inner classic page, and that no cookie value reaches a page.

<details>
<summary><b>Project layout</b></summary>

<br>

| Path                      | What it holds                                                                 |
| ------------------------- | ----------------------------------------------------------------------------- |
| `manifest.json`           | Manifest V3: permissions, the content script and the service worker.         |
| `src/background.js`       | Service worker: saved sessions, the cookie swap, re-login state per tab.     |
| `src/content.js`          | Runs in every e-Boekhouden frame: navbar switcher, re-login dialog.          |
| `tests/`                  | `node --test` tests for the service worker and the fake `chrome.*` APIs.     |
| `icons/`                  | The extension icon as SVG, and the PNG sizes Chrome uses.                    |
| `assets/`                 | Images for this README. Screenshots use made-up administration names.       |

</details>

<details>
<summary><b>How the frames are told apart</b></summary>

<br>

| Frame        | Recognised by                                     | What the extension does there                          |
| ------------ | ------------------------------------------------- | ------------------------------------------------------ |
| top          | top window on `/bh/`                              | Reports the title (the administration name).           |
| `mainframe`  | `window.name === 'mainframe'`, parent is top      | Navbar switcher, page tracking.                        |
| inner        | child of `mainframe`                              | Tracks the classic page; re-login dialog.              |

</details>

## 📄 License

MIT. See [LICENSE](LICENSE).
