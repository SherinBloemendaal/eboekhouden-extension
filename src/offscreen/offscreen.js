// Offscreen document of the AI writing help (setting aiWriter). The service
// worker (src/bg/ai.js) creates it for the first model call and closes it
// when it has been idle for a minute: the 1.1 MB AI SDK is parsed here, not
// on every wake of the service worker, which also cannot load it (no
// top-level await, no dynamic import there).
//
// The messages are handled in host.js. The worker sends the provider and the
// model; the key is read here from the extension's IndexedDB (keys.js), so
// it never travels in a message.

import * as sdk from '../../vendor/ai-sdk.mjs';
import { createEngine } from './engine.js';
import { listen } from './host.js';
import { createKeyStore } from './keys.js';

// The SDK logs a warning per unknown model or ignored setting; the user
// cannot act on those.
globalThis.AI_SDK_LOG_WARNINGS = false;

listen({ chrome, engine: createEngine({ sdk }), keys: createKeyStore() });
