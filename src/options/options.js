// The settings page of the AI writing help (options_ui), per AISettings.dc.html:
// the switch, the provider, the key with a test, the model, and what is sent.
//
// The key is saved only after Chrome granted the provider's address (an
// optional host permission, asked for in the click on Opslaan; refused
// means nothing is saved). A new key replaces the old one at once, also when
// the provider then refuses it: the old key never stays in use unseen. The
// test is a small GET to the provider without any text (engine.test). The
// service worker mirrors what pages may know into aiView (src/bg/ai.js).
//
// The keys go to the extension's IndexedDB (keys, src/offscreen/keys.js),
// never to chrome.storage: Chrome hands its change events, values included,
// to the content scripts in the e-Boekhouden tabs. Only the provider, the
// models and the test results go to chrome.storage.local (aiConfig). After a
// key changes, ai:keys tells the service worker to update aiView.

import { PROVIDERS, checkKey, checkModel } from '../offscreen/protocol.js';

const ORDER = ['openrouter', 'openai', 'anthropic'];

function clock(date) {
  return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function when(at, now) {
  const date = new Date(at);
  const today = date.toDateString() === now.toDateString();
  return today ? `vandaag om ${clock(date)}` : `op ${date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'numeric' })} om ${clock(date)}`;
}

function failureText(code, status, provider) {
  const { label, host } = PROVIDERS[provider];
  const suffix = status ? ` (${status})` : '';
  switch (code) {
    case 'auth': return `${label} weigert deze sleutel${suffix}. Controleer of hij klopt en nog actief is.`;
    case 'credits': return `${label} meldt dat het tegoed op is${suffix}.`;
    case 'rate': return `${label} krijgt nu te veel verzoeken${suffix}. Probeer het zo opnieuw.`;
    case 'network': return `Geen verbinding met ${label}. Controleer je internetverbinding.`;
    case 'timeout': return `${label} gaf geen antwoord. Probeer het zo opnieuw.`;
    case 'permission': return `Zonder toestemming van Chrome kan de extensie ${host} niet bereiken.`;
    case 'format': return `${label} gaf een antwoord dat de extensie niet begrijpt.`;
    default: return `${label} gaf een fout${suffix}.`;
  }
}

export function mount({ document, chrome, engine, keys, EBS, now = () => new Date() }) {
  const $ = (id) => document.getElementById(id);
  const ui = {
    enabled: $('enabled'), providers: $('providers'), key: $('key'), test: $('test'), keyNote: $('key-note'),
    model: $('model'), models: $('models'), modelHint: $('model-hint'), consent: $('consent'), consentText: $('consent-text'),
    remove: $('remove'), save: $('save'),
  };
  const state = {
    settings: EBS.settingsWithDefaults(),
    keys: {},
    config: {},
    granted: {},
    selected: 'openrouter',
    // A note that answers the last click; cleared when the inputs change.
    message: null,
    consent: null,
    modelWarning: null,
    busy: null,
  };

  $('mark').append(EBS.icon('sparkles', { size: 18 }));
  const cards = new Map();
  for (const provider of ORDER) {
    const { label, hint } = PROVIDERS[provider];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'provider';
    card.setAttribute('role', 'radio');
    card.dataset.provider = provider;
    const name = document.createElement('span');
    name.className = 'provider-name';
    name.textContent = label;
    const small = document.createElement('span');
    small.className = 'provider-hint';
    small.textContent = hint;
    card.append(name, small);
    card.addEventListener('click', () => pick(provider));
    card.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const next = ORDER[(ORDER.indexOf(provider) + step + ORDER.length) % ORDER.length];
      pick(next);
      cards.get(next).focus();
    });
    ui.providers.append(card);
    cards.set(provider, card);
  }

  const saved = () => state.keys[state.selected] ?? '';
  const savedModel = () => state.config.models?.[state.selected] ?? '';
  const status = () => state.config.status?.[state.selected] ?? null;

  function setBusy(node, label) {
    if (label) {
      node.dataset.label ??= node.textContent;
      node.textContent = label;
      node.disabled = true;
      node.setAttribute('aria-busy', 'true');
    } else {
      if (node.dataset.label) node.textContent = node.dataset.label;
      delete node.dataset.label;
      node.disabled = false;
      node.removeAttribute('aria-busy');
    }
  }

  function note(kind, text, icon = null) {
    ui.keyNote.className = `note${kind ? ` ${kind}` : ''}`;
    ui.keyNote.replaceChildren(...(icon ? [EBS.icon(icon, { size: 14 })] : []), text);
  }

  function renderNote() {
    const { label, host } = PROVIDERS[state.selected];
    const typed = ui.key.value.trim();
    ui.key.classList.toggle('bad', false);
    if (state.message) {
      note(state.message.kind, state.message.text, state.message.icon);
      ui.key.classList.toggle('bad', state.message.kind === 'bad' && state.message.field === 'key');
      return;
    }
    if (!saved()) {
      note('', typed ? 'Nog niet opgeslagen.' : 'Maak een sleutel aan bij de aanbieder en plak hem hier.');
      return;
    }
    if (typed !== saved()) {
      note('', 'Nog niet opgeslagen. De opgeslagen sleutel blijft in gebruik tot je opslaat.');
      return;
    }
    if (!state.settings.aiWriter) {
      note('', 'Sleutel bewaard. AI-schrijfhulp staat uit.');
      return;
    }
    if (!state.granted[state.selected]) {
      note('warn', `Chrome heeft nog geen toestemming gegeven voor ${host}. Klik op Opslaan om die te geven.`, 'triangle-alert');
      return;
    }
    const last = status();
    if (last?.ok) note('ok', `Sleutel werkt. Laatst getest ${when(last.at, now())}.`, 'circle-check');
    else if (last && last.code === 'auth') {
      note('bad', failureText(last.code, last.status, state.selected), 'triangle-alert');
      ui.key.classList.add('bad');
    } else if (last) note('warn', `Laatste test ${when(last.at, now())}: ${failureText(last.code, last.status, state.selected)}`, 'triangle-alert');
    else note('', `Sleutel opgeslagen voor ${label}, nog niet getest.`);
  }

  function renderConsent() {
    const { host } = PROVIDERS[state.selected];
    ui.consent.classList.toggle('asking', state.consent === 'asking');
    const bold = document.createElement('b');
    bold.textContent = host;
    if (state.consent === 'asking') ui.consentText.replaceChildren('Chrome vraagt nu of de extensie met ', bold, ' mag praten. Alleen dat adres, alleen voor deze functie.');
    else if (state.consent === 'denied') ui.consentText.replaceChildren('Chrome gaf geen toestemming voor ', bold, '. Er is niets opgeslagen.');
    else if (state.granted[state.selected]) ui.consentText.replaceChildren('De extensie mag met ', bold, ' praten. Alleen dat adres, alleen voor deze functie.');
    else ui.consentText.replaceChildren('Bij Opslaan vraagt Chrome toestemming voor alleen ', bold, '. Weiger je, dan wordt er niets opgeslagen.');
  }

  function renderModels() {
    const list = state.config.modelLists?.[state.selected] ?? [];
    ui.models.replaceChildren(...list.map((id) => {
      const option = document.createElement('option');
      option.value = id;
      return option;
    }));
    const { label, model } = PROVIDERS[state.selected];
    ui.model.placeholder = model || `Kies een model van ${label}`;
    if (state.modelWarning) {
      ui.modelHint.className = 'hint note warn';
      ui.modelHint.textContent = state.modelWarning;
      return;
    }
    ui.modelHint.className = 'hint';
    ui.modelHint.textContent = model
      ? `Je kiest zelf het model; de lijst komt van de aanbieder. Bij ${label} bijvoorbeeld ${model}.`
      : `Je kiest zelf het model; na Sleutel testen staat hier de lijst van ${label}.`;
  }

  function render() {
    const on = Boolean(state.settings.aiWriter);
    ui.enabled.setAttribute('aria-checked', String(on));
    document.body.classList.toggle('off', !on);
    for (const [provider, card] of cards) {
      const chosen = provider === state.selected;
      card.setAttribute('aria-checked', String(chosen));
      card.tabIndex = chosen ? 0 : -1;
    }
    ui.key.placeholder = PROVIDERS[state.selected].placeholder;
    if (state.busy !== 'remove') ui.remove.disabled = !saved();
    renderNote();
    renderConsent();
    renderModels();
  }

  // The inputs show what is saved for the chosen provider.
  function fillInputs() {
    ui.key.value = saved();
    ui.model.value = savedModel() || PROVIDERS[state.selected].model;
  }

  function pick(provider) {
    if (provider === state.selected || state.busy) return;
    state.selected = provider;
    state.message = null;
    state.consent = null;
    state.modelWarning = null;
    fillInputs();
    render();
  }

  async function grantedNow() {
    const entries = await Promise.all(ORDER.map(async (provider) => {
      try {
        return [provider, Boolean(await chrome.permissions.contains({ origins: [PROVIDERS[provider].origin] }))];
      } catch {
        return [provider, false];
      }
    }));
    state.granted = Object.fromEntries(entries);
  }

  async function readKeys() {
    try {
      return await keys.all();
    } catch {
      return {};
    }
  }

  // The service worker keeps aiView in step; a key is not in chrome.storage,
  // so its change has no storage event there.
  function keysChanged() {
    try {
      Promise.resolve(chrome.runtime.sendMessage({ type: 'ai:keys' })).catch(() => {});
    } catch {
      // No worker to tell: it reads the keys when it starts.
    }
  }

  async function load({ inputs = false } = {}) {
    const [{ settings, aiConfig = {} }, saved] = await Promise.all([chrome.storage.local.get(['settings', 'aiConfig']), readKeys()]);
    state.settings = EBS.settingsWithDefaults(settings);
    state.keys = saved;
    state.config = aiConfig && typeof aiConfig === 'object' ? aiConfig : {};
    await grantedNow();
    if (inputs) {
      state.selected = PROVIDERS[state.config.provider] ? state.config.provider : 'openrouter';
      fillInputs();
    }
    render();
  }

  async function writeConfig(change) {
    const { aiConfig = {} } = await chrome.storage.local.get('aiConfig');
    const next = { ...aiConfig, ...change(aiConfig) };
    await chrome.storage.local.set({ aiConfig: next });
    state.config = next;
  }

  async function recordTest(provider, key, outcome) {
    // Only the saved key's result counts for the editors (aiView).
    if ((state.keys[provider] ?? '') !== key) return;
    await writeConfig((config) => ({
      status: { ...config.status, [provider]: { ok: outcome.ok, code: outcome.code ?? null, status: outcome.status ?? null, at: now().getTime() } },
      ...(outcome.models ? { modelLists: { ...config.modelLists, [provider]: outcome.models } } : {}),
    }));
  }

  async function runTest(provider, key, model) {
    try {
      const result = await engine.test({ provider, key, model });
      if (result.models?.length) state.config = { ...state.config, modelLists: { ...state.config.modelLists, [provider]: result.models } };
      state.modelWarning = result.modelKnown === false ? `Het model ${model} staat niet in de lijst van ${PROVIDERS[provider].label}. Kies er een uit de lijst.` : null;
      await recordTest(provider, key, { ok: true, models: result.models });
      return { ok: true };
    } catch (error) {
      const code = error?.code ?? 'provider';
      const status = Number.isInteger(error?.status) ? error.status : null;
      await recordTest(provider, key, { ok: false, code, status });
      return { ok: false, code, status };
    }
  }

  function validKey() {
    try {
      return checkKey(ui.key.value);
    } catch {
      state.message = { kind: 'bad', field: 'key', icon: 'triangle-alert', text: ui.key.value.trim() ? 'Een sleutel is één woord zonder spaties. Plak hem opnieuw.' : 'Plak eerst een sleutel.' };
      render();
      ui.key.focus();
      return null;
    }
  }

  // Asks Chrome inside the click, unless the address is granted already.
  function askPermission(provider) {
    if (state.granted[provider]) return Promise.resolve(true);
    state.consent = 'asking';
    renderConsent();
    let request;
    try {
      request = chrome.permissions.request({ origins: [PROVIDERS[provider].origin] });
    } catch {
      request = Promise.resolve(false);
    }
    return Promise.resolve(request).then((granted) => {
      state.consent = granted ? null : 'denied';
      state.granted[provider] = Boolean(granted);
      return Boolean(granted);
    }, () => {
      state.consent = 'denied';
      return false;
    });
  }

  ui.enabled.addEventListener('click', async () => {
    const { settings } = await chrome.storage.local.get('settings');
    const next = { ...EBS.settingsWithDefaults(settings), aiWriter: !state.settings.aiWriter };
    state.settings = next;
    render();
    await chrome.storage.local.set({ settings: next });
  });

  for (const input of [ui.key, ui.model]) {
    input.addEventListener('input', () => {
      state.message = null;
      if (input === ui.model) state.modelWarning = null;
      if (state.consent === 'denied') state.consent = null;
      render();
    });
  }

  ui.test.addEventListener('click', () => {
    if (state.busy) return;
    const key = validKey();
    if (!key) return;
    const provider = state.selected;
    const model = ui.model.value.trim();
    state.busy = 'test';
    setBusy(ui.test, 'Testen…');
    state.message = { kind: '', text: 'Bezig met testen…' };
    render();
    askPermission(provider).then(async (granted) => {
      const outcome = granted ? await runTest(provider, key, model) : { ok: false, code: 'permission' };
      state.message = outcome.ok
        ? { kind: 'ok', icon: 'circle-check', text: `Sleutel werkt. Laatst getest ${when(now().getTime(), now())}.${key === saved() ? '' : ' Nog niet opgeslagen.'}` }
        : { kind: outcome.code === 'auth' ? 'bad' : 'warn', field: 'key', icon: 'triangle-alert', text: failureText(outcome.code, outcome.status, provider) };
    }).finally(() => {
      state.busy = null;
      setBusy(ui.test, null);
      render();
    });
  });

  ui.save.addEventListener('click', () => {
    if (state.busy) return;
    const key = validKey();
    if (!key) return;
    let model;
    try {
      model = checkModel(ui.model.value);
    } catch {
      state.message = { kind: 'bad', icon: 'triangle-alert', text: ui.model.value.trim() ? 'Dit is geen geldige naam van een model.' : 'Kies eerst een model.' };
      render();
      ui.model.focus();
      return;
    }
    const provider = state.selected;
    state.busy = 'save';
    setBusy(ui.save, 'Bezig…');
    state.message = { kind: '', text: 'Wordt opgeslagen zodra Chrome toestemming geeft.' };
    render();
    askPermission(provider).then(async (granted) => {
      if (!granted) {
        state.message = { kind: 'bad', icon: 'triangle-alert', text: `${failureText('permission', null, provider)} De sleutel is niet opgeslagen.` };
        return;
      }
      await keys.set(provider, key);
      state.keys = await readKeys();
      await writeConfig((config) => ({
        provider,
        models: { ...config.models, [provider]: model },
        status: { ...config.status, [provider]: null },
      }));
      // Addresses of providers without a key are not needed any more.
      const unused = ORDER.filter((other) => other !== provider && !state.keys[other] && state.granted[other]);
      if (unused.length) {
        try {
          await chrome.permissions.remove({ origins: unused.map((other) => PROVIDERS[other].origin) });
        } catch {
          // Chrome keeps them; harmless.
        }
        await grantedNow();
      }
      keysChanged();
      const outcome = await runTest(provider, key, model);
      state.message = outcome.ok
        ? { kind: 'ok', icon: 'circle-check', text: `Opgeslagen. Sleutel werkt. Laatst getest ${when(now().getTime(), now())}.` }
        : { kind: outcome.code === 'auth' ? 'bad' : 'warn', field: 'key', icon: 'triangle-alert', text: `Opgeslagen, maar: ${failureText(outcome.code, outcome.status, provider)}` };
    }).catch(() => {
      state.message = { kind: 'bad', icon: 'triangle-alert', text: 'Opslaan lukte niet. Probeer het opnieuw.' };
    }).finally(() => {
      state.busy = null;
      setBusy(ui.save, null);
      render();
    });
  });

  ui.remove.addEventListener('click', async () => {
    if (state.busy || !saved()) return;
    const provider = state.selected;
    state.busy = 'remove';
    setBusy(ui.remove, 'Bezig…');
    try {
      await keys.remove(provider);
      state.keys = await readKeys();
      keysChanged();
      await writeConfig((config) => ({ status: { ...config.status, [provider]: null } }));
      try {
        await chrome.permissions.remove({ origins: [PROVIDERS[provider].origin] });
      } catch {
        // Nothing to take back.
      }
      await grantedNow();
      ui.key.value = '';
      state.message = { kind: '', text: `Sleutel verwijderd. De toestemming voor ${PROVIDERS[provider].host} is ook ingetrokken.` };
    } catch {
      state.message = { kind: 'bad', icon: 'triangle-alert', text: 'Verwijderen lukte niet. Probeer het opnieuw.' };
    } finally {
      state.busy = null;
      setBusy(ui.remove, null);
      render();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.settings || changes.aiConfig) || state.busy) return;
    load();
  });
  chrome.permissions.onAdded?.addListener(() => grantedNow().then(render));
  chrome.permissions.onRemoved?.addListener(() => grantedNow().then(render));

  const ready = load({ inputs: true });
  return { ready, state };
}
