// EB Sessions: the Digitaal archief screen in Better design. Setting: betterDesign.
//
// A foundation stub: it reads its switch and does nothing yet. The archive worker
// builds the feature in this file; shared files stay as they are.

(() => {
  if (window.__ebsArchiveLoaded) return;
  window.__ebsArchiveLoaded = true;

  let enabled = false;
  EBS.watchSettings((settings) => {
    enabled = Boolean(settings.betterDesign);
  });
})();
