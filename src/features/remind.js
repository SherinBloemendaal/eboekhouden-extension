// EB Sessions: the reminder dialog from the open posts, in Better design. Setting: betterDesign.
//
// A foundation stub: it reads its switch and does nothing yet. The openposts worker
// builds the feature in this file; shared files stay as they are.

(() => {
  if (window.__ebsRemindLoaded) return;
  window.__ebsRemindLoaded = true;

  let enabled = false;
  EBS.watchSettings((settings) => {
    enabled = Boolean(settings.betterDesign);
  });
})();
