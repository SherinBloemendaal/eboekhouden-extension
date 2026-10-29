// EB Sessions: the loader shown while e-Boekhouden opens a page. Setting: betterDesign.
//
// A foundation stub: it reads its switch and does nothing yet. The loader worker
// builds the feature in this file; shared files stay as they are.
// Part of Better design, so it has no switch of its own (see
// SETTINGS_DEFAULTS).

(() => {
  if (window.__ebsLoaderLoaded) return;
  window.__ebsLoaderLoaded = true;

  let enabled = false;
  EBS.watchSettings((settings) => {
    enabled = Boolean(settings.betterDesign);
  });
})();
