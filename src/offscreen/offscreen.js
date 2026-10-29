// Offscreen document for the AI writing help (setting aiWriter). A foundation
// stub: nothing listens yet. The AI worker runs its model calls here, created
// from src/bg/ai.js with chrome.offscreen.createDocument once the manifest has
// the "offscreen" permission (requested through the orchestrator). Messages
// for this document carry { target: 'offscreen' }; API keys stay in the
// extension and are never sent to a page.
