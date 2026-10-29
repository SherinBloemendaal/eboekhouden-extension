// The storage layer (store.js) on the fake chrome.storage of a jsdom page.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, page } from './dom.mjs';

after(closeAll);

const URL_V2 = 'https://secure20.e-boekhouden.nl/boekhouden/archief';
const plain = (value) => JSON.parse(JSON.stringify(value));

function storePage(store = {}) {
  const p = page('<!doctype html><html><body></body></html>', { url: URL_V2, store });
  p.load('shared.js', 'store.js');
  return { ...p, api: p.window.EBS.store };
}

test('get, set, delete and list, with JSON values under store:<administration>/<feature>/<name>', async () => {
  const p = storePage();
  const { api } = p;
  assert.equal(await api.get('1000001/archive/view'), null);
  await api.set('1000001/archive/view', { sort: 'datum', folders: [1, 2] });
  assert.deepEqual(plain(await api.get('1000001/archive/view')), { sort: 'datum', folders: [1, 2] });
  const record = p.store['store:1000001/archive/view'];
  assert.deepEqual(plain(record.v), { sort: 'datum', folders: [1, 2] });
  assert.equal(record.by, 'local');
  assert.ok(Number.isFinite(record.at));

  // A copy each time: changing what get gave does not change the store.
  const value = await api.get('1000001/archive/view');
  value.sort = 'naam';
  assert.equal((await api.get('1000001/archive/view')).sort, 'datum');

  await api.set('1000001/archive/folder/3', 'open');
  await api.set('1000002/archive/view', { sort: 'naam' });
  assert.deepEqual(plain(await api.list('1000001/archive/')), [
    { key: '1000001/archive/folder/3', value: 'open' },
    { key: '1000001/archive/view', value: { sort: 'datum', folders: [1, 2] } },
  ]);
  await api.delete('1000001/archive/folder/3');
  assert.equal(await api.get('1000001/archive/folder/3'), null);
  assert.deepEqual(plain(await api.list('1000001/archive/')).map((entry) => entry.key), ['1000001/archive/view']);
  assert.equal(p.store['store:1000001/archive/folder/3'].deleted, true, 'a delete leaves a dated record, for sync later');
  p.close();
});

test('keys and values are checked', async () => {
  const { api, close } = storePage();
  for (const key of ['archive/view', '1000001/archive', '1000001/Archive/view', 'abc/archive/view', '1000001/archive//x', '../x/y/z', 42]) {
    await assert.rejects(api.get(key), { code: 'key' }, String(key));
  }
  await assert.rejects(api.set('1000001/archive/x', undefined), { code: 'value' });
  await assert.rejects(api.set('1000001/archive/x', { f() {} }.f), { code: 'value' });
  await assert.rejects(api.set('1000001/archive/x', 'x'.repeat(1024 * 1024 + 1)), { code: 'quota' });
  assert.equal(await api.get('default/import/prefs'), null, 'default is the administration of a page without a number');
  close();
});

test('feature(): one feature in one administration, with short keys', async () => {
  const p = storePage();
  const archive = p.api.feature('archive', { administration: '1000001' });
  const other = p.api.feature('archive', { administration: '1000002' });
  await archive.set('view', { sort: 'datum' });
  assert.equal(await other.get('view'), null, 'another administration does not see it');
  assert.deepEqual(plain(await archive.list()), [{ key: 'view', value: { sort: 'datum' } }]);
  assert.ok('store:1000001/archive/view' in p.store);
  assert.throws(() => p.api.feature('Archive', { administration: '1' }), { code: 'key' });
  assert.throws(() => p.api.feature('archive', {}), { code: 'key' });
  p.close();
});

test('onChange reports changes under a prefix, deletes as null', async () => {
  const p = storePage();
  const changes = [];
  const stop = p.api.onChange('1000001/templates/', (change) => changes.push(plain(change)));
  const short = [];
  p.api.feature('templates', { administration: '1000001' }).onChange('', (change) => short.push(change.key));
  await p.api.set('1000001/templates/mail', 'Beste [RELAANHEF],');
  await p.api.set('1000002/templates/mail', 'not this one');
  await p.api.set('1000001/templates/mail', 'Hallo');
  await p.api.delete('1000001/templates/mail');
  assert.deepEqual(changes, [
    { key: '1000001/templates/mail', value: 'Beste [RELAANHEF],', previous: null, source: 'local' },
    { key: '1000001/templates/mail', value: 'Hallo', previous: 'Beste [RELAANHEF],', source: 'local' },
    { key: '1000001/templates/mail', value: null, previous: 'Hallo', source: 'local' },
  ]);
  assert.deepEqual(short, ['mail', 'mail', 'mail']);
  stop();
  await p.api.set('1000001/templates/mail', 'weer');
  assert.equal(changes.length, 3);
  p.close();
});

test('the current administration comes from the active entry', async () => {
  const slots = [{ id: 'a', name: 'Voorbeeld B.V.', number: '1000001' }, { id: 'b', name: 'Studio Noord', number: null }];
  const p = storePage({ slots, view: { activeSlotId: 'a', loggedIn: true, ready: ['a'] } });
  assert.equal(await p.api.currentAdministration(), '1000001');
  await p.window.chrome.storage.local.set({ view: { activeSlotId: 'b', loggedIn: true, ready: [] } });
  assert.equal(await p.api.currentAdministration(), null, 'no number known yet');
  await p.window.chrome.storage.local.set({ view: { activeSlotId: 'a', loggedIn: false, ready: [] } });
  assert.equal(await p.api.currentAdministration(), null, 'logged out');
  p.close();
});

test('the 0.2.x import prefs move over once, and the old keys stay', async () => {
  const old = { hidden: ['29-09-2026|NL00|28-09-2026|3500|Factuur'], groups: ['Bank'], groupOf: { x: 'Bank' } };
  const p = storePage({ 'import:1000001': old, 'import:default': { hidden: [], groups: ['Los'], groupOf: {} }, 'import:abc': { hidden: [] } });
  assert.deepEqual(plain(await p.api.get('1000001/import/prefs')), old);
  assert.deepEqual(plain(await p.api.get('default/import/prefs')).groups, ['Los']);
  assert.deepEqual(plain(p.store['import:1000001']), old, 'the old copy is kept as it was');
  assert.ok(!('store:abc/import/prefs' in p.store), 'only real administration keys');
  assert.deepEqual(plain(p.store.storeMigrations), ['import-prefs']);

  // Once done, it is not done again: newer data is never overwritten by the old copy.
  await p.api.set('1000001/import/prefs', { hidden: [], groups: ['Nieuw'], groupOf: {} });
  const again = page('<!doctype html><html><body></body></html>', { url: URL_V2, store: p.store });
  again.load('shared.js', 'store.js');
  assert.deepEqual(plain(await again.window.EBS.store.get('1000001/import/prefs')).groups, ['Nieuw']);

  // A run that was cut short (no marker) still keeps what is there.
  delete p.store.storeMigrations;
  const rerun = page('<!doctype html><html><body></body></html>', { url: URL_V2, store: p.store });
  rerun.load('shared.js', 'store.js');
  assert.deepEqual(plain(await rerun.window.EBS.store.get('1000001/import/prefs')).groups, ['Nieuw']);
  p.close();
});

test('sync and opmerking are not configured; a registered remote gets queued writes and sends changes back', async () => {
  const p = storePage();
  const { api } = p;
  // The store warns about the offline write and the bad change below.
  const warnings = [];
  p.window.console.warn = (...args) => warnings.push(args.join(' '));
  await assert.rejects(api.useRemote('sync'), { code: 'not-configured' });
  await assert.rejects(api.useRemote('opmerking'), { code: 'not-configured' });
  assert.throws(() => api.registerBackend('local', {}), { code: 'backend' });
  assert.throws(() => api.registerBackend('dropbox', {}), { code: 'backend' });

  // A stand-in for the end-to-end encrypted sync client.
  const sent = [];
  let online = false;
  let push = null;
  api.registerBackend('sync', {
    async get() { return null; },
    async set(key, record) {
      if (!online) throw new Error('offline');
      sent.push([key, plain(record)]);
    },
    async delete() {},
    async list() { return []; },
    subscribe(fn) {
      push = fn;
      return () => { push = null; };
    },
  });
  assert.throws(() => api.registerBackend('sync', { get() {}, set() {}, delete() {}, list() {} }), { code: 'backend' });
  await api.useRemote('sync');
  const changes = [];
  api.onChange('1000001/', (change) => changes.push(plain(change)));

  // Offline: the local write lands at once, the remote one waits.
  await api.set('1000001/archive/view', { sort: 'datum' });
  assert.deepEqual(plain(await api.get('1000001/archive/view')), { sort: 'datum' });
  assert.equal(changes.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(api.pending(), 1);
  await api.set('1000001/archive/view', { sort: 'naam' });
  assert.equal(api.pending(), 1, 'a newer write of a key replaces the waiting one');
  api.stopRemote();
  assert.equal(api.pending(), 0);

  online = true;
  await api.useRemote('sync');
  await api.set('1000001/archive/view', { sort: 'bedrag' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(sent.map(([key, record]) => [key, record.v]), [['1000001/archive/view', { sort: 'bedrag' }]]);
  assert.equal(api.pending(), 0);

  // A change from elsewhere: newer wins and says where it came from, older is ignored.
  const local = p.store['store:1000001/archive/view'];
  await push({ key: '1000001/archive/view', record: { v: { sort: 'oud' }, at: local.at - 1000, by: 'local' } });
  assert.equal((await api.get('1000001/archive/view')).sort, 'bedrag');
  await push({ key: '1000001/archive/view', record: { v: { sort: 'elders' }, at: local.at + 1000, by: 'local' } });
  assert.equal((await api.get('1000001/archive/view')).sort, 'elders');
  assert.deepEqual(changes.at(-1), { key: '1000001/archive/view', value: { sort: 'elders' }, previous: { sort: 'bedrag' }, source: 'remote' });
  await push({ key: '1000001/archive/view', record: { v: null, at: local.at + 2000, by: 'local', deleted: true } });
  assert.equal(await api.get('1000001/archive/view'), null);
  await push({ key: 'not a key', record: { v: 1, at: 1 } });
  assert.deepEqual(warnings.map((text) => text.split(',')[0]), ['EB Sessions: remote store write failed', 'EB Sessions: remote store change ignored EBS.store: "not a key" is not <administration>/<feature>/<name>']);
  api.stopRemote();
  p.close();
});
