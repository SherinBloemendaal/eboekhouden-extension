// The AI writing help's shared rules, for the service worker (src/bg/ai.js),
// the offscreen document and the settings page: which providers exist, which
// actions a page may ask for, and how large each part of a request may be.
// The service worker checks every request from a page with checkRequest()
// before it goes anywhere; the offscreen document checks it again.

export const PROVIDERS = Object.freeze({
  openrouter: Object.freeze({
    label: 'OpenRouter',
    host: 'openrouter.ai',
    origin: 'https://openrouter.ai/*',
    hint: 'Eén sleutel, veel modellen',
    placeholder: 'sk-or-v1-…',
    model: 'anthropic/claude-sonnet-5.5',
  }),
  openai: Object.freeze({
    label: 'OpenAI',
    host: 'api.openai.com',
    origin: 'https://api.openai.com/*',
    hint: 'GPT-modellen',
    placeholder: 'sk-…',
    model: '',
  }),
  anthropic: Object.freeze({
    label: 'Anthropic',
    host: 'api.anthropic.com',
    origin: 'https://api.anthropic.com/*',
    hint: 'Claude-modellen',
    placeholder: 'sk-ant-…',
    model: 'claude-sonnet-5-5',
  }),
});

// action -> the options it takes (null: none).
export const ACTIONS = Object.freeze({
  rewrite: Object.freeze(['formal', 'friendly', 'shorter', 'clearer', 'spelling']),
  instruction: null,
  translate: Object.freeze(['nl', 'en', 'de']),
  subject: null,
  reminders: null,
  check: null,
});

// Actions whose answer must carry exactly the variables of the text. The
// others write something new: they may drop a variable, never invent one.
export const STRICT_VARIABLES = Object.freeze(new Set(['rewrite', 'translate']));

export const TEMPLATE_TYPES = Object.freeze(['mail', 'factuur', 'aanmaan']);

export const LIMITS = Object.freeze({
  content: 60_000,
  instruction: 2_000,
  subject: 500,
  variables: 200,
  variableCode: 40,
  variableLabel: 200,
  key: 400,
  model: 200,
  answer: 200_000,
});

// What a failed call reports to the page: a code, and for provider errors
// the HTTP status. Never the key, never the provider's raw error body.
export const ERROR_CODES = Object.freeze([
  'auth', 'permission', 'rate', 'credits', 'model', 'network', 'timeout', 'length', 'format',
  'aborted', 'busy', 'off', 'nokey', 'unavailable', 'provider', 'invalid',
]);

const VARIABLE = /^\[[A-Z][A-Z0-9_]*\]$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;
const KEY = /^[\x21-\x7e]+$/;

export class RequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RequestError';
    this.code = 'invalid';
  }
}

function string(value, max, what, { optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return '';
    throw new RequestError(`${what} is missing`);
  }
  if (typeof value !== 'string') throw new RequestError(`${what} must be text`);
  if (value.length > max) throw new RequestError(`${what} is longer than ${max} characters`);
  return value;
}

// A request from a page, as plain data with only the fields we know. Throws
// a RequestError for anything else.
export function checkRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RequestError('a request is an object');
  const action = string(input.action, 20, 'action');
  if (!Object.hasOwn(ACTIONS, action)) throw new RequestError(`unknown action ${action}`);
  const options = ACTIONS[action];
  let option = null;
  if (options) {
    option = string(input.option, 20, 'option');
    if (!options.includes(option)) throw new RequestError(`unknown option ${option} for ${action}`);
  }
  const format = input.format === 'text' ? 'text' : input.format === 'html' ? 'html' : null;
  if (!format) throw new RequestError('format is html or text');
  const scope = input.scope === 'selection' ? 'selection' : input.scope === 'all' ? 'all' : null;
  if (!scope) throw new RequestError('scope is all or selection');
  if (scope === 'selection' && format !== 'text') throw new RequestError('a selection is plain text');
  const content = string(input.content, LIMITS.content, 'content', { optional: true });
  const instruction = string(input.instruction, LIMITS.instruction, 'instruction', { optional: true }).trim();
  if (action === 'instruction' && !instruction) throw new RequestError('an instruction is missing');
  if (['rewrite', 'translate', 'check'].includes(action) && !content.trim()) throw new RequestError('there is no text to work on');
  const subject = string(input.subject, LIMITS.subject, 'subject', { optional: true });
  const templateType = input.templateType === null || input.templateType === undefined ? null : string(input.templateType, 20, 'templateType');
  if (templateType !== null && !TEMPLATE_TYPES.includes(templateType)) throw new RequestError(`unknown template type ${templateType}`);
  if (!Array.isArray(input.variables ?? [])) throw new RequestError('variables is a list');
  const list = input.variables ?? [];
  if (list.length > LIMITS.variables) throw new RequestError(`more than ${LIMITS.variables} variables`);
  const variables = list.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) throw new RequestError('a variable is [code, label]');
    const code = string(entry[0], LIMITS.variableCode, 'variable code');
    if (!VARIABLE.test(code)) throw new RequestError(`${code} is not a variable`);
    return [code, string(entry[1], LIMITS.variableLabel, 'variable label')];
  });
  return { action, option, format, scope, content, instruction, subject, templateType, variables };
}

export function checkProvider(provider) {
  if (typeof provider !== 'string' || !Object.hasOwn(PROVIDERS, provider)) throw new RequestError('unknown provider');
  return provider;
}

export function checkModel(model) {
  if (typeof model !== 'string' || !model.trim() || model.length > LIMITS.model || !MODEL.test(model.trim())) throw new RequestError('a model id is letters, digits and . _ : / @ + -');
  return model.trim();
}

export function checkKey(key) {
  if (typeof key !== 'string' || !key.trim() || key.length > LIMITS.key || !KEY.test(key.trim())) throw new RequestError('a key is one word of printable characters');
  return key.trim();
}
