// EB Sessions: the Openstaande posten screen in Better design. Setting: betterDesign.
//
// A foundation stub: it reads its switch and does nothing yet. The openposts worker
// builds the feature in this file; shared files stay as they are.

(() => {
  if (window.__ebsOpenpostsLoaded) return;
  window.__ebsOpenpostsLoaded = true;

  let enabled = false;
  EBS.watchSettings((settings) => {
    enabled = Boolean(settings.betterDesign);
  });
})();
