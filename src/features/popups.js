// EB Sessions: e-Boekhouden's pop-up windows as a dialog in the page. Setting: popupDialogs.
//
// A foundation stub: it reads its switch and does nothing yet. The popups worker
// builds the feature in this file; shared files stay as they are.
// The page-world hooks it needs are in main-world.js:
// EBS.bridge.intercept('windowOpen' | 'formSubmit', ...).

(() => {
  if (window.__ebsPopupsLoaded) return;
  window.__ebsPopupsLoaded = true;

  let enabled = false;
  EBS.watchSettings((settings) => {
    enabled = Boolean(settings.popupDialogs);
  });
})();
