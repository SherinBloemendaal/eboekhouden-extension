// EB Sessions: the e-mail and invoice templates in Better design. Setting: betterDesign.
//
// A foundation stub: it reads its switch and does nothing yet. The templates worker
// builds the feature in this file; shared files stay as they are.

(() => {
  if (window.__ebsTemplatesLoaded) return;
  window.__ebsTemplatesLoaded = true;

  let enabled = false;
  EBS.watchSettings((settings) => {
    enabled = Boolean(settings.betterDesign);
  });
})();
