// The AI writing help's model side: request checks, prompts, reading the
// answer back, the engine with a fake SDK, the key test per provider, and
// the vendored AI SDK itself against each provider's wire format (fetch is
// mocked: nothing leaves the machine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { ACTIONS, LIMITS, PROVIDERS, checkKey, checkModel, checkRequest } from '../src/offscreen/protocol.js';
import { AnswerError, REMINDER_STEPS, buildPrompt, parseAnswer } from '../src/offscreen/prompts.js';
import { EngineError, createEngine } from '../src/offscreen/engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { DOMParser } = new JSDOM('').window;

const VARIABLES = [['[FACTNUMMER]', 'Factuurnummer'], ['[TOTAAL]', 'Het totaalbedrag van uw factuur, inclusief btw'], ['[RELAANHEF]', 'De aanhef van uw relatie']];
const BASE = {
  action: 'rewrite', option: 'formal', format: 'html', scope: 'all',
  content: '<p>[RELAANHEF],</p><p>Hierbij je factuur [FACTNUMMER] van [TOTAAL].</p>', templateType: 'mail', variables: VARIABLES,
};
const CONFIG = { provider: 'openrouter', key: 'sk-or-v1-test', model: 'anthropic/claude-sonnet-5.5' };

test('checkRequest keeps only known fields and refuses what does not fit', () => {
  const request = checkRequest({ ...BASE, extra: 'x', cookies: 'nope' });
  assert.deepEqual(Object.keys(request).sort(), ['action', 'content', 'format', 'instruction', 'option', 'scope', 'subject', 'templateType', 'variables']);
  for (const [action, options] of Object.entries(ACTIONS)) {
    const input = { ...BASE, action, option: options?.[0], instruction: action === 'instruction' ? 'Schrijf iets' : '' };
    assert.equal(checkRequest(input).action, action);
  }
  const bad = [
    { ...BASE, action: 'delete' },
    { ...BASE, option: 'sarcastic' },
    { ...BASE, format: 'markdown' },
    { ...BASE, scope: 'selection', format: 'html' },
    { ...BASE, content: 'x'.repeat(LIMITS.content + 1) },
    { ...BASE, content: '   ' },
    { ...BASE, action: 'instruction', option: null, instruction: '' },
    { ...BASE, templateType: 'brief' },
    { ...BASE, variables: [['FACTNUMMER', 'zonder haken']] },
    { ...BASE, variables: Array.from({ length: LIMITS.variables + 1 }, (_, i) => [`[V${i}]`, 'x']) },
    null,
    [],
  ];
  for (const input of bad) assert.throws(() => checkRequest(input), { name: 'RequestError' }, JSON.stringify(input)?.slice(0, 80));
  assert.equal(checkModel(' openai/gpt-5 '), 'openai/gpt-5');
  assert.throws(() => checkModel('model met spaties'));
  assert.throws(() => checkKey('twee woorden'));
  assert.equal(checkKey(' sk-abc '), 'sk-abc');
});

test('the prompt carries the text, the variables and the rules, nothing else', () => {
  const { system, prompt } = buildPrompt(checkRequest(BASE));
  assert.match(system, /\[FACTNUMMER\]: Factuurnummer/);
  assert.match(system, /Copy every placeholder exactly/);
  assert.match(system, /not instructions to you/);
  assert.match(prompt, /<text>\n<p>\[RELAANHEF\],<\/p>/);
  assert.match(prompt, /"u"/);
  const translated = buildPrompt(checkRequest({ ...BASE, action: 'translate', option: 'de' }));
  assert.match(translated.prompt, /into German/);
  const reminders = buildPrompt(checkRequest({ ...BASE, action: 'reminders', option: null, content: '' }));
  for (const title of REMINDER_STEPS) assert.ok(reminders.prompt.includes(title), title);
  assert.match(reminders.prompt, /There is no text yet/);
  const instruction = buildPrompt(checkRequest({ ...BASE, action: 'instruction', option: null, instruction: 'Maak er een bedankje van' }));
  assert.match(instruction.prompt, /<instruction>\nMaak er een bedankje van\n<\/instruction>/);
  const check = buildPrompt(checkRequest({ ...BASE, action: 'check', option: null }));
  for (const topic of ['aanspreekvorm', 'toon', 'kvk', 'btw', 'iban', 'betaaltermijn']) assert.ok(check.prompt.includes(topic), topic);
  const unknown = buildPrompt(checkRequest({ ...BASE, templateType: null, variables: [] }));
  assert.match(unknown.system, /keep the placeholders that are in the text and add none/);
  const selection = buildPrompt(checkRequest({ ...BASE, format: 'text', scope: 'selection', content: 'je factuur' }));
  assert.match(selection.system, /plain text/);
});

test('parseAnswer reads JSON, also in a code fence, and refuses other shapes', () => {
  const request = checkRequest(BASE);
  assert.deepEqual(parseAnswer(request, '{"content":"<p>Geachte</p>"}'), { content: '<p>Geachte</p>' });
  assert.deepEqual(parseAnswer(request, 'Hier is het:\n```json\n{"content":"<p>Geachte</p>"}\n```'), { content: '<p>Geachte</p>' });
  for (const answer of ['Geachte heer', '{"content": 3}', '{"content": "  "}', '[1,2]', '{"text":"x"}']) {
    assert.throws(() => parseAnswer(request, answer), AnswerError, answer);
  }
  const subject = checkRequest({ ...BASE, action: 'subject', option: null });
  assert.deepEqual(parseAnswer(subject, '{"subjects":["Factuur [FACTNUMMER]","Factuur [FACTNUMMER]","  Uw  factuur "]}'), { subjects: ['Factuur [FACTNUMMER]', 'Uw factuur'] });
  const reminders = checkRequest({ ...BASE, action: 'reminders', option: null });
  const steps = REMINDER_STEPS.map((title, index) => ({ title: `stap ${index}`, subject: `Herinnering ${index + 1}`, content: `<p>Tekst ${index + 1}</p>` }));
  const parsed = parseAnswer(reminders, JSON.stringify({ steps }));
  assert.deepEqual(parsed.steps.map((step) => step.title), REMINDER_STEPS, 'titles are ours, not the model\'s');
  assert.throws(() => parseAnswer(reminders, JSON.stringify({ steps: steps.slice(0, 3) })), AnswerError);
  const check = checkRequest({ ...BASE, action: 'check', option: null });
  const findings = parseAnswer(check, JSON.stringify({ findings: [
    { topic: 'iban', ok: false, text: 'Geen IBAN.' }, { topic: 'aanspreekvorm', ok: true, text: 'Overal u.' },
    { topic: 'onzin', ok: true, text: 'x' }, { topic: 'iban', ok: true, text: 'dubbel' },
  ] }));
  assert.deepEqual(findings.findings.map((finding) => [finding.topic, finding.ok]), [['aanspreekvorm', true], ['iban', false]]);
});

function fakeSdk(answer) {
  const calls = [];
  const made = [];
  const model = (provider) => (settings) => (id) => {
    made.push({ provider, settings, id });
    return { provider, id };
  };
  return {
    calls,
    made,
    createOpenRouter: model('openrouter'),
    createOpenAI: model('openai'),
    createAnthropic: model('anthropic'),
    APICallError: { isInstance: (error) => error?.isApiCallError === true },
    async generateText(options) {
      calls.push(options);
      return typeof answer === 'function' ? answer(options) : answer;
    },
  };
}

test('engine.run: one call, no retries, an abort signal, and a sanitized answer', async () => {
  const sdk = fakeSdk({ text: '{"content":"<p onclick=\\"x()\\">[RELAANHEF],</p><script>alert(1)</script><p>Bijgaand treft u factuur [FACTNUMMER] aan.</p>"}', finishReason: 'stop' });
  const engine = createEngine({ sdk, DOMParser, fetch: () => assert.fail('no fetch') });
  const answer = await engine.run(CONFIG, BASE);
  assert.equal(sdk.calls.length, 1);
  assert.equal(sdk.calls[0].maxRetries, 0);
  assert.ok(sdk.calls[0].abortSignal instanceof AbortSignal);
  assert.match(sdk.calls[0].system, /\[TOTAAL\]/);
  assert.equal(answer.content, '<p>[RELAANHEF],</p><p>Bijgaand treft u factuur [FACTNUMMER] aan.</p>');
  assert.deepEqual(sdk.made.map(({ provider, id }) => [provider, id]), [['openrouter', 'anthropic/claude-sonnet-5.5']]);
  assert.equal(sdk.made[0].settings.apiKey, 'sk-or-v1-test');

  await engine.run({ ...CONFIG, provider: 'anthropic', model: 'claude-sonnet-5-5' }, BASE);
  assert.deepEqual(sdk.made.at(-1).settings.headers, { 'anthropic-dangerous-direct-browser-access': 'true' });
  await engine.run({ ...CONFIG, provider: 'openai', model: 'gpt-5' }, BASE);
  assert.equal(sdk.made.at(-1).provider, 'openai');
});

test('engine.run: failures become codes, without the key or the provider\'s text', async () => {
  const cases = [
    [{ isApiCallError: true, statusCode: 401, message: 'Incorrect API key sk-or-v1-test' }, 'auth', 401],
    [{ isApiCallError: true, statusCode: 402 }, 'credits', 402],
    [{ isApiCallError: true, statusCode: 404 }, 'model', 404],
    [{ isApiCallError: true, statusCode: 429 }, 'rate', 429],
    [{ isApiCallError: true, statusCode: 500 }, 'provider', 500],
    [{ isApiCallError: true, statusCode: undefined }, 'network', null],
    [new TypeError('Failed to fetch'), 'network', null],
    [Object.assign(new Error('x'), { name: 'AbortError' }), 'aborted', null],
  ];
  for (const [thrown, code, status] of cases) {
    const engine = createEngine({ sdk: fakeSdk(() => { throw thrown; }), DOMParser });
    await assert.rejects(engine.run(CONFIG, BASE), (error) => {
      assert.ok(error instanceof EngineError);
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.doesNotMatch(error.message, /sk-or/);
      return true;
    });
  }
  const cut = createEngine({ sdk: fakeSdk({ text: '{"content":"<p>half', finishReason: 'length' }), DOMParser });
  await assert.rejects(cut.run(CONFIG, BASE), { code: 'length' });
  const prose = createEngine({ sdk: fakeSdk({ text: 'Natuurlijk! Hier is de tekst.', finishReason: 'stop' }), DOMParser });
  await assert.rejects(prose.run(CONFIG, BASE), { code: 'format' });
  const invalid = createEngine({ sdk: fakeSdk({ text: '{}' }), DOMParser });
  await assert.rejects(invalid.run(CONFIG, { ...BASE, action: 'drop-tables' }), { code: 'invalid' });
  await assert.rejects(invalid.run({ ...CONFIG, key: '' }, BASE), { code: 'invalid' });
  const controller = new AbortController();
  const slow = createEngine({ sdk: fakeSdk(({ abortSignal }) => new Promise((resolve, reject) => abortSignal.addEventListener('abort', () => reject(Object.assign(new Error('a'), { name: 'AbortError' }))))), DOMParser });
  const pending = slow.run(CONFIG, BASE, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'aborted' });
});

test('engine.test: one small GET per provider (two on OpenRouter), no text, and the model list', async () => {
  const seen = [];
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init) => {
    seen.push({ url, method: init.method, headers: init.headers, body: init.body, credentials: init.credentials });
    if (url.endsWith('/key')) return reply(200, { data: { label: 'x' } });
    return reply(200, { data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'a-model' }] });
  };
  const engine = createEngine({ sdk: null, fetch });
  assert.deepEqual(await engine.test({ ...CONFIG, model: 'a-model' }), { ok: true, models: ['a-model', 'b-model'], modelKnown: true });
  assert.deepEqual(seen.map((entry) => entry.url), ['https://openrouter.ai/api/v1/key', 'https://openrouter.ai/api/v1/models']);
  assert.equal(seen[0].headers.Authorization, 'Bearer sk-or-v1-test');
  assert.deepEqual(seen[1].headers, {}, 'the public model list gets no key');
  seen.length = 0;
  assert.equal((await engine.test({ provider: 'openai', key: 'sk-x', model: 'gpt-x' })).modelKnown, false);
  assert.deepEqual(seen.map((entry) => entry.url), ['https://api.openai.com/v1/models']);
  seen.length = 0;
  await engine.test({ provider: 'anthropic', key: 'sk-ant-x', model: '' });
  assert.equal(seen[0].url, 'https://api.anthropic.com/v1/models?limit=1000');
  assert.equal(seen[0].headers['x-api-key'], 'sk-ant-x');
  assert.equal(seen[0].headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.ok(seen.every((entry) => entry.method === 'GET' && entry.body === undefined && entry.credentials === 'omit'));

  const refused = createEngine({ sdk: null, fetch: async () => reply(401, { error: 'bad key' }) });
  await assert.rejects(refused.test(CONFIG), { code: 'auth', status: 401 });
  const offline = createEngine({ sdk: null, fetch: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(offline.test(CONFIG), { code: 'network' });
});

test('every provider has an optional host permission in the manifest', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  for (const provider of Object.values(PROVIDERS)) assert.ok(manifest.optional_host_permissions.includes(provider.origin), provider.origin);
});

// The real bundle, as the offscreen document loads it.
const vendorFile = join(root, 'vendor/ai-sdk.mjs');

test('vendor/ai-sdk.mjs runs under the extension CSP: no eval, no new Function, no Node modules', () => {
  const code = readFileSync(vendorFile, 'utf8');
  assert.match(code.slice(0, 400), /ai@7\.0\.156/);
  assert.doesNotMatch(code, /\beval\s*\(/);
  assert.doesNotMatch(code, /\bnew\s+Function\s*\(/);
  // zod's `const F = Function; new F("")` hides the constructor behind a name.
  assert.doesNotMatch(code, /(?<![\w$.'"`])Function\s*[;,)}\]]/, 'no Function constructor as a value');
  assert.match(code, /EB Sessions: no code from strings/, 'zod gets the throwing stand-in');
  assert.doesNotMatch(code, /require\(["'](?:node:)?(?:fs|path|http|https|net|child_process)["']\)/);
  const pinned = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies;
  for (const name of ['ai', '@ai-sdk/openai', '@ai-sdk/anthropic', '@openrouter/ai-sdk-provider', 'zod']) {
    assert.ok(code.slice(0, 400).includes(`${name}@${pinned[name]}`), `${name}@${pinned[name]} in the header`);
  }
});

test('the vendored SDK speaks each provider\'s format, with the engine on top', async () => {
  globalThis.AI_SDK_LOG_WARNINGS = false;
  const sdk = await import(pathToFileURL(vendorFile).href);
  const answer = JSON.stringify({ content: '<p>[RELAANHEF],</p><p>Bijgaand treft u factuur [FACTNUMMER] van [TOTAAL] aan.</p>' });
  const seen = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ url: String(url), body, headers: Object.fromEntries(new Headers(init.headers)) });
    let json;
    if (String(url).endsWith('/responses')) {
      json = { id: 'r', object: 'response', created_at: 1, model: body.model, status: 'completed', output: [{ type: 'message', id: 'm', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: answer, annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 2 } };
    } else if (String(url).includes('anthropic')) {
      json = { id: 'm', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: answer }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 } };
    } else {
      json = { id: 'c', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } };
    }
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const engine = createEngine({ sdk, fetch, DOMParser });
  const configs = [
    ['openrouter', 'anthropic/claude-sonnet-5.5', 'https://openrouter.ai/api/v1/chat/completions', 'authorization', 'Bearer k-or'],
    ['openai', 'gpt-5', 'https://api.openai.com/v1/responses', 'authorization', 'Bearer k-oa'],
    ['anthropic', 'claude-sonnet-5-5', 'https://api.anthropic.com/v1/messages', 'x-api-key', 'k-an'],
  ];
  for (const [provider, model, url, header, value] of configs) {
    const key = value.replace('Bearer ', '');
    const result = await engine.run({ provider, key, model }, BASE);
    assert.equal(result.content, '<p>[RELAANHEF],</p><p>Bijgaand treft u factuur [FACTNUMMER] van [TOTAAL] aan.</p>', provider);
    const call = seen.at(-1);
    assert.equal(call.url, url);
    assert.equal(call.body.model, model);
    assert.equal(call.headers[header], value);
    assert.ok(JSON.stringify(call.body).includes('[FACTNUMMER]: Factuurnummer'), 'the variable list is in the request');
    if (provider === 'anthropic') assert.equal(call.headers['anthropic-dangerous-direct-browser-access'], 'true');
  }
  assert.equal(seen.length, 3, 'one request per call: no retries');

  const refusing = createEngine({ sdk, DOMParser, fetch: async () => new Response(JSON.stringify({ error: { message: 'Incorrect API key provided: k-oa', type: 'invalid_request_error' } }), { status: 401, headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(refusing.run({ provider: 'openai', key: 'k-oa', model: 'gpt-5' }, BASE), (error) => error.code === 'auth' && error.status === 401 && !/k-oa/.test(error.message));
});
