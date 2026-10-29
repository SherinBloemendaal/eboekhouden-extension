// Entry of the settings page. The key test needs no AI SDK (a GET to the
// provider), so this page does not load vendor/ai-sdk.mjs.
import { createEngine } from '../offscreen/engine.js';
import { mount } from './options.js';

mount({ document, chrome, EBS: window.EBS, engine: createEngine({ sdk: null }) });
