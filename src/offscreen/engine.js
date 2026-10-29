// The model calls of the AI writing help, independent of where they run:
// the offscreen document hands in the vendored AI SDK (vendor/ai-sdk.mjs),
// the tests a fake one. Two things it does:
//
//   run(config, request, { signal })  one model call for one click of the user;
//                                     resolves the checked, sanitized answer
//   test(config, { signal })          is the key good? A small GET to the
//                                     provider, no text; resolves the model list
//
// config is { provider, key, model }. A failure is an EngineError with a code
// from ERROR_CODES and, for an HTTP error, its status. Neither ever carries
// the key or the provider's raw answer.

import { LIMITS, checkKey, checkModel, checkProvider, checkRequest } from './protocol.js';
import { AnswerError, buildPrompt, parseAnswer } from './prompts.js';
import { sanitizeHtml } from './sanitize.js';

const CALL_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 8_000;
const MAX_MODELS = 2_000;
const ANTHROPIC_VERSION = '2023-06-01';
// Anthropic answers a browser only with this header; it means "I know the
// key is in this client", which is the point of a key the user brings.
const ANTHROPIC_BROWSER = { 'anthropic-dangerous-direct-browser-access': 'true' };

export class EngineError extends Error {
  constructor(code, status = null) {
    super(status ? `${code} (${status})` : code);
    this.name = 'EngineError';
    this.code = code;
    this.status = status;
  }
}

function statusCode(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'credits';
  if (status === 404) return 'model';
  if (status === 429) return 'rate';
  return 'provider';
}

function failureOf(error, sdk, signal) {
  if (error instanceof EngineError) return error;
  if (error instanceof AnswerError) return new EngineError('format');
  if (error?.name === 'RequestError') return new EngineError('invalid');
  if (error?.name === 'TimeoutError' || signal?.reason?.name === 'TimeoutError') return new EngineError('timeout');
  if (error?.name === 'AbortError' || signal?.aborted) return new EngineError('aborted');
  if (sdk?.APICallError?.isInstance?.(error)) {
    if (error.cause?.name === 'TimeoutError') return new EngineError('timeout');
    if (error.cause?.name === 'AbortError') return new EngineError('aborted');
    const status = Number.isInteger(error.statusCode) ? error.statusCode : null;
    return status ? new EngineError(statusCode(status), status) : new EngineError('network');
  }
  if (error instanceof TypeError) return new EngineError('network');
  return new EngineError('provider');
}

function withTimeout(signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function createEngine({ sdk, fetch = (...args) => globalThis.fetch(...args), DOMParser = globalThis.DOMParser } = {}) {
  function languageModel(config) {
    const provider = checkProvider(config?.provider);
    const apiKey = checkKey(config?.key);
    const model = checkModel(config?.model);
    if (provider === 'openrouter') return sdk.createOpenRouter({ apiKey, fetch })(model);
    if (provider === 'openai') return sdk.createOpenAI({ apiKey, fetch })(model);
    return sdk.createAnthropic({ apiKey, fetch, headers: ANTHROPIC_BROWSER })(model);
  }

  function clean(request, answer) {
    if (request.format !== 'html') return answer;
    const sanitize = (content) => sanitizeHtml(content, { DOMParser, original: request.content });
    if (answer.content !== undefined) return { ...answer, content: sanitize(answer.content) };
    if (answer.steps) return { ...answer, steps: answer.steps.map((step) => ({ ...step, content: sanitize(step.content) })) };
    return answer;
  }

  async function run(config, input, { signal } = {}) {
    const combined = withTimeout(signal, CALL_TIMEOUT_MS);
    try {
      const request = checkRequest(input);
      const { system, prompt } = buildPrompt(request);
      const result = await sdk.generateText({
        model: languageModel(config),
        system,
        prompt,
        maxRetries: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: combined,
      });
      if (result.finishReason === 'length' || String(result.text ?? '').length > LIMITS.answer) throw new EngineError('length');
      return clean(request, parseAnswer(request, result.text));
    } catch (error) {
      throw failureOf(error, sdk, combined);
    }
  }

  async function getJson(url, headers, signal) {
    const response = await fetch(url, { method: 'GET', headers, signal, credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new EngineError(statusCode(response.status), response.status);
    try {
      return await response.json();
    } catch {
      throw new EngineError('format');
    }
  }

  function modelIds(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map((entry) => entry?.id).filter((id) => typeof id === 'string' && id.length <= LIMITS.model))].sort().slice(0, MAX_MODELS);
  }

  async function test(config, { signal } = {}) {
    const combined = withTimeout(signal, TEST_TIMEOUT_MS);
    try {
      const provider = checkProvider(config?.provider);
      const key = checkKey(config?.key);
      let models;
      if (provider === 'openrouter') {
        // The model list is public there; /key is what tells a bad key.
        await getJson('https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${key}` }, combined);
        models = modelIds((await getJson('https://openrouter.ai/api/v1/models', {}, combined))?.data);
      } else if (provider === 'openai') {
        models = modelIds((await getJson('https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` }, combined))?.data);
      } else {
        const headers = { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, ...ANTHROPIC_BROWSER };
        models = modelIds((await getJson('https://api.anthropic.com/v1/models?limit=1000', headers, combined))?.data);
      }
      const model = typeof config.model === 'string' ? config.model.trim() : '';
      return { ok: true, models, modelKnown: model ? models.includes(model) : null };
    } catch (error) {
      throw failureOf(error, sdk, combined);
    }
  }

  return Object.freeze({ run, test });
}
