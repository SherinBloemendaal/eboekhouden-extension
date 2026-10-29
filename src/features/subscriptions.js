// EB Sessions: the subscription screens (billing) in Better design. Setting: betterDesign.
//
// A foundation stub: it reads its switch and does nothing yet. The billing worker
// builds the feature in this file; shared files stay as they are.

(() => {
  if (window.__ebsSubscriptionsLoaded) return;
  window.__ebsSubscriptionsLoaded = true;

  let enabled = false;
  EBS.watchSettings((settings) => {
    enabled = Boolean(settings.betterDesign);
  });
})();
