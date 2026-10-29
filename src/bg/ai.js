// Service worker part of the AI writing help (setting aiWriter). A foundation
// stub: it registers no handlers yet. The AI worker adds them here only:
//
//   export function register(router) {
//     router.on('ai:write', handler, { serialized: false });
//   }
//
// A model call can take many seconds, so its handlers opt out of the session
// mutex with { serialized: false }; a short step that reads or writes session
// state can still take the mutex with router.serialized(task).
//
// Provider access is optional_host_permissions in the manifest (OpenRouter,
// OpenAI, Anthropic), asked for at runtime with chrome.permissions.request.
// The offscreen document (src/offscreen/) needs the "offscreen" permission,
// which is not in the manifest yet: the AI worker asks the orchestrator to
// add it together with the code that creates the document.

export function register(router) {}
