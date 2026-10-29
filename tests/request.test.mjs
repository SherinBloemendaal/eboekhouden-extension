// The request layer (request.js), run as Chrome runs it (a classic script),
// in a sandbox with a fake clock, fake timers and a fetch that counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createBudget } from '../src/bg/requests.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFileSync(join(root, 'src', file), 'utf8');
const flush = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

// The service worker's budget over every frame (src/bg/requests.js), on a
// clock of the test's own; frames of one test share it.
function sharedBudget() {
  const clock = { time: 1_000_000 };
  const data = {};
  const area = {
    async get(key) {
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
  };
  return { clock, area, budget: createBudget({ now: () => clock.time, area }) };
}

function sandbox({ url = 'https://secure20.e-boekhouden.nl/boekhouden/archief', shared = sharedBudget(), worker = true } = {}) {
  let time = 1_000_000;
  const { clock, budget } = shared;
  const slots = [];
  let nextTimer = 1;
  const timers = [];
  const listeners = {};
  const calls = [];
  let running = 0;
  let maxRunning = 0;
  const FakeDate = class extends Date {
    static now() {
      return time;
    }
  };
  const context = {
    console, URL, AbortController, DOMException, Response,
    Date: FakeDate,
    location: new URL(url),
    setTimeout: (fn, ms) => {
      const id = nextTimer;
      nextTimer += 1;
      timers.push({ id, at: time + Math.max(0, Number(ms) || 0), fn });
      return id;
    },
    clearTimeout: (id) => {
      const at = timers.findIndex((timer) => timer.id === id);
      if (at >= 0) timers.splice(at, 1);
    },
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
    chrome: worker ? {
      runtime: {
        async sendMessage(message) {
          clock.time = Math.max(clock.time, time);
          if (message.type === 'requests:slot') {
            const answer = await budget.slot();
            slots.push(answer);
            return answer;
          }
          if (message.type === 'requests:done') return budget.done(message);
          return {};
        },
      },
    } : undefined,
    fetch: (href, init) => new Promise((resolve, reject) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      const done = () => {
        running -= 1;
      };
      const call = {
        url: href, init,
        respond(body, { status = 200, headers = { 'content-type': 'application/json' } } = {}) {
          done();
          resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers }));
        },
        fail() {
          done();
          reject(new TypeError('Failed to fetch'));
        },
      };
      init.signal.addEventListener('abort', () => {
        done();
        reject(new DOMException('Aborted', 'AbortError'));
      });
      calls.push(call);
    }),
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source('shared.js'), context, { filename: 'shared.js' });
  vm.runInContext(source('request.js'), context, { filename: 'request.js' });
  // Answers come from the sandbox's realm: hand them over as plain data.
  const plain = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
  const layer = context.EBS.request;
  const request = {
    ...layer,
    bulk: (...args) => layer.bulk(...args).then(plain),
    item: (...args) => layer.item(...args).then(plain),
  };
  return {
    request,
    calls,
    maxRunning: () => maxRunning,
    // A real click of the user (event.isTrusted), and one a page script made.
    slots,
    click: (isTrusted = true) => (listeners.click ?? []).forEach((fn) => fn({ type: 'click', isTrusted })),
    key: (key, repeat = false) => (listeners.keydown ?? []).forEach((fn) => fn({ type: 'keydown', key, repeat, isTrusted: true })),
    // Another screen of the app (e-Boekhouden changes the URL for each).
    go: (href) => {
      context.location = new URL(href, context.location.href);
    },
    leave: () => (listeners.pagehide ?? []).forEach((fn) => fn({ type: 'pagehide' })),
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        time = next.at;
        next.fn();
        await flush();
      }
      time = end;
      await flush();
    },
  };
}

const outcome = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));

test('a list of 1000 rows joined from one bulk call makes exactly 1 request', async () => {
  const s = sandbox();
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1 }));
  const first = s.request.bulk('archive:files', '/api/folder/files');
  await flush();
  s.calls[0].respond(rows.map((row) => ({ id: row.id, name: `Bestand ${row.id}.pdf` })));
  const names = new Map((await first).map((file) => [file.id, file.name]));
  // Every row looks its data up again, the way a careless feature would.
  const joined = [];
  for (const row of rows) {
    const files = await s.request.bulk('archive:files', '/api/folder/files');
    joined.push({ ...row, name: files.find((file) => file.id === row.id).name });
  }
  assert.equal(joined.length, 1000);
  assert.equal(joined[999].name, names.get(1000));
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].init.method, 'GET');
  assert.equal(s.calls[0].init.credentials, 'include');
});

test('ten identical bulk calls at once share one request, and get their own copy', async () => {
  const s = sandbox();
  const all = Array.from({ length: 10 }, () => s.request.bulk('open:posts', '/api/openpost/grid'));
  await flush();
  assert.equal(s.calls.length, 1);
  s.calls[0].respond({ rows: [{ id: 1 }] });
  const answers = await Promise.all(all);
  assert.ok(answers.every((answer) => answer.rows[0].id === 1));
  answers[0].rows[0].id = 99;
  assert.equal(answers[1].rows[0].id, 1, 'one caller cannot change what another got');
  assert.equal(s.calls.length, 1);
});

test('an item request needs { userAction: true } and a real click, one request per click', async () => {
  const s = sandbox();
  await assert.rejects(s.request.item('file:1', '/api/folder/1'), { code: 'user-action' });
  await assert.rejects(s.request.item('file:1', '/api/folder/1', { userAction: false }), { code: 'user-action' });
  await assert.rejects(s.request.item('file:1', '/api/folder/1', { userAction: true }), { code: 'user-action' }, 'no click yet');
  s.click(false);
  await assert.rejects(s.request.item('file:1', '/api/folder/1', { userAction: true }), { code: 'user-action' }, 'a click from a page script does not count');

  s.click();
  const one = s.request.item('file:1', '/api/folder/1', { userAction: true });
  // A loop over rows in the same click handler gets an error for the rest.
  await assert.rejects(s.request.item('file:2', '/api/folder/2', { userAction: true }), { code: 'user-action' });
  await flush();
  s.calls[0].respond({ id: 1 });
  assert.deepEqual(await one, { id: 1 });
  // The cached item needs no new click, and makes no request.
  assert.deepEqual(await s.request.item('file:1', '/api/folder/1', { userAction: true }), { id: 1 });
  s.click();
  s.request.item('file:2', '/api/folder/2', { userAction: true });
  await flush();
  assert.equal(s.calls.length, 2);
});

test('never more than 2 requests at a time', async () => {
  const s = sandbox();
  const all = Array.from({ length: 6 }, (_, i) => s.request.bulk(`screen:${i}`, `/api/screen/${i}`));
  await flush();
  assert.equal(s.calls.length, 2);
  for (let i = 0; i < 6; i += 1) {
    s.calls[i].respond({ i });
    await flush();
  }
  assert.equal(s.calls.length, 6);
  assert.deepEqual((await Promise.all(all)).map((answer) => answer.i), [0, 1, 2, 3, 4, 5]);
  assert.equal(s.maxRunning(), 2);
});

test('at most 20 requests a minute: the 21st waits for the minute to pass', async () => {
  const s = sandbox();
  for (let i = 0; i < 20; i += 1) {
    const answer = s.request.bulk(`screen:${i}`, `/api/screen/${i}`);
    await flush();
    s.calls[i].respond({ i });
    await answer;
  }
  const late = s.request.bulk('screen:20', '/api/screen/20');
  await flush();
  assert.equal(s.calls.length, 20);
  assert.equal(s.request.stats().queued, 1);
  await s.advance(59_999);
  assert.equal(s.calls.length, 20);
  await s.advance(1);
  assert.equal(s.calls.length, 21);
  s.calls[20].respond({ i: 20 });
  assert.deepEqual(await late, { i: 20 });
});

test('a failure pauses the next request: 2 s, then 4 s; a 429 waits as long as Retry-After says', async () => {
  const s = sandbox();
  const first = outcome(s.request.bulk('a', '/api/a'));
  await flush();
  s.calls[0].respond('', { status: 500 });
  assert.equal((await first).error.code, 'http');
  assert.equal((await first).error.status, 500);

  // The user asks again (a click on "Opnieuw"): it waits for the pause.
  s.click();
  const second = outcome(s.request.bulk('a', '/api/a'));
  await flush();
  assert.equal(s.calls.length, 1, 'nothing is retried at once');
  await s.advance(1_999);
  assert.equal(s.calls.length, 1);
  await s.advance(1);
  assert.equal(s.calls.length, 2);
  s.calls[1].fail();
  assert.equal((await second).error.code, 'network');

  s.click();
  const third = outcome(s.request.bulk('a', '/api/a'));
  await s.advance(3_999);
  assert.equal(s.calls.length, 2);
  await s.advance(1);
  assert.equal(s.calls.length, 3);
  s.calls[2].respond('', { status: 429, headers: { 'retry-after': '30' } });
  assert.equal((await third).error.status, 429);

  s.click();
  const fourth = s.request.bulk('a', '/api/a');
  await s.advance(29_999);
  assert.equal(s.calls.length, 3);
  await s.advance(1);
  assert.equal(s.calls.length, 4);
  s.calls[3].respond({ ok: true });
  assert.deepEqual(await fourth, { ok: true });
  // A success ends the pause.
  s.request.bulk('b', '/api/b');
  await flush();
  assert.equal(s.calls.length, 5);
});

test('only GET, only the same e-Boekhouden origin', async () => {
  const s = sandbox();
  await assert.rejects(s.request.bulk('k', '/api/x', { method: 'POST' }), { code: 'method' });
  await assert.rejects(s.request.bulk('k', '/api/x', { method: 'delete' }), { code: 'method' });
  await assert.rejects(s.request.bulk('k', '/api/x', { body: '{}' }), { code: 'method' });
  s.click();
  await assert.rejects(s.request.item('k', '/api/x', { userAction: true, method: 'PUT' }), { code: 'method' });
  await assert.rejects(s.request.bulk('k', 'https://example.com/api/x'), { code: 'origin' });
  await assert.rejects(s.request.bulk('k', 'https://secure.e-boekhouden.nl/bh/x.asp'), { code: 'origin' }, 'another e-Boekhouden host is another origin');
  await assert.rejects(s.request.bulk('k', 'http://secure20.e-boekhouden.nl/api/x'), { code: 'origin' });
  await assert.rejects(s.request.bulk('', '/api/x'), { code: 'key' });
  await assert.rejects(s.request.bulk('k', '/api/x', { as: 'blob' }), { name: 'TypeError' });
  assert.equal(s.calls.length, 0);
  s.request.bulk('k', '/api/x', { method: 'get' });
  assert.equal(s.request.stats().active + s.request.stats().queued, 1, 'GET in any case is fine');
});

test('every refusal is a rejected promise, never an exception at the call', () => {
  const s = sandbox();
  const layer = s.request;
  for (const call of [
    () => layer.item('k', '/api/x'),
    () => layer.bulk('k', '/api/x', { method: 'POST' }),
    () => layer.bulk('', '/api/x'),
    () => layer.bulk('k', 'https://example.com/'),
    () => layer.bulk('k', '/api/x', null),
  ]) {
    let promise;
    assert.doesNotThrow(() => {
      promise = call();
    });
    promise?.catch?.(() => {});
    assert.equal(typeof promise?.then, 'function');
  }
});

test('the layer only runs on e-Boekhouden app hosts', async () => {
  const s = sandbox({ url: 'https://www.e-boekhouden.nl/prijzen' });
  await assert.rejects(s.request.bulk('k', '/api/x'), { code: 'origin' });
});

test('abort cancels a running request without a pause, and frees its slot', async () => {
  const s = sandbox();
  const a = outcome(s.request.bulk('a', '/api/a'));
  const b = outcome(s.request.bulk('b', '/api/b'));
  const c = s.request.bulk('c', '/api/c');
  await flush();
  assert.equal(s.calls.length, 2);
  s.request.abort('a');
  assert.equal((await a).error.code, 'abort');
  await flush();
  assert.equal(s.calls.length, 3, 'c starts in the freed slot, without a backoff');
  s.calls[2].respond({ c: true });
  assert.deepEqual(await c, { c: true });

  // A caller's own signal: the request stops once nobody waits for it.
  const controller = new AbortController();
  const d = outcome(s.request.bulk('d', '/api/d', { signal: controller.signal }));
  await flush();
  controller.abort();
  assert.equal((await d).error.code, 'abort');
  s.leave();
  assert.equal((await b).error.code, 'abort', 'leaving the page stops everything');
  await flush();
  assert.equal(s.request.stats().active, 0);
});

test('answers are cached for 60 s; on the same screen fetched again only after a click', async () => {
  const s = sandbox();
  const first = s.request.bulk('a', '/api/a');
  await flush();
  s.calls[0].respond({ n: 1 });
  await first;
  await s.advance(59_000);
  assert.deepEqual(await s.request.bulk('a', '/api/a'), { n: 1 });
  assert.equal(s.calls.length, 1);
  await s.advance(1_000);
  assert.deepEqual(await s.request.bulk('a', '/api/a'), { n: 1 }, 'the same screen, nobody did anything: its own answer');
  assert.equal(s.calls.length, 1);
  s.click();
  const second = s.request.bulk('a', '/api/a');
  await flush();
  assert.equal(s.calls.length, 2, 'after a click of the user');
  s.calls[1].respond({ n: 2 });
  assert.deepEqual(await second, { n: 2 });

  // Another screen that needs the same data, after the cache ran out.
  await s.advance(60_000);
  s.go('/boekhouden/archief/2025');
  s.request.bulk('a', '/api/a');
  await flush();
  assert.equal(s.calls.length, 3);
});

test('a full queue refuses more instead of piling up', async () => {
  const s = sandbox();
  const all = Array.from({ length: 23 }, (_, i) => outcome(s.request.bulk(`k:${i}`, `/api/${i}`)));
  const refused = await all[22];
  assert.equal(refused.error.code, 'rate');
  assert.equal(s.request.stats().queued, 20);
});

test('text answers and broken JSON', async () => {
  const s = sandbox();
  const page = s.request.bulk('page', '/boekhouden/lijst', { as: 'text' });
  const broken = outcome(s.request.bulk('broken', '/api/broken'));
  await flush();
  s.calls[0].respond('<table></table>', { headers: { 'content-type': 'text/html' } });
  s.calls[1].respond('<html>not json</html>');
  assert.equal(await page, '<table></table>');
  assert.equal((await broken).error.code, 'parse');
});

test('a feature that asks per row (another key per row) is cut off: 2 running and 20 waiting, the rest refused', async () => {
  const s = sandbox();
  const rows = Array.from({ length: 1000 }, (_, i) => outcome(s.request.bulk(`row:${i}`, `/api/row/${i}`)));
  await flush();
  const refused = (await Promise.all(rows.slice(22))).filter((result) => result.error?.code === 'rate');
  assert.equal(refused.length, 978);
  assert.equal(s.calls.length, 2);
  for (let i = 0; i < 22; i += 1) {
    await s.advance(60_000);
    for (const call of s.calls.filter((one) => !one.done)) {
      call.done = true;
      call.respond({});
    }
    await flush();
  }
  assert.equal(s.calls.length, 22, 'never more than 22 requests for 1000 rows');
  assert.equal(s.request.stats().queued, 0);
});

test('items for every row in one click: one request', async () => {
  const s = sandbox();
  s.click();
  const rows = Array.from({ length: 1000 }, (_, i) => outcome(s.request.item(`row:${i}`, `/api/row/${i}`, { userAction: true })));
  await flush();
  assert.equal(s.calls.length, 1);
  assert.equal((await Promise.all(rows.slice(1))).filter((result) => result.error?.code === 'user-action').length, 999);
});

test('a timer cannot poll: the same bulk on the same screen every minute makes one request', async () => {
  const s = sandbox();
  for (let minute = 0; minute < 30; minute += 1) {
    const answer = outcome(s.request.bulk('open:posts', '/api/openpost/grid'));
    await flush();
    for (const call of s.calls.filter((one) => !one.done)) {
      call.done = true;
      call.respond({ minute });
    }
    assert.deepEqual((await answer).value, { minute: 0 });
    await s.advance(61_000);
  }
  assert.equal(s.calls.length, 1);
  // A held Enter key is one action, not one per repeat.
  s.key('Enter');
  for (let i = 0; i < 5; i += 1) s.key('Enter', true);
  await flush();
  s.request.bulk('open:posts', '/api/openpost/grid');
  await flush();
  assert.equal(s.calls.length, 2);
});

test('after a failure the same screen does not try again by itself', async () => {
  const s = sandbox();
  const first = outcome(s.request.bulk('a', '/api/a'));
  await flush();
  s.calls[0].respond('', { status: 500 });
  assert.equal((await first).error.code, 'http');
  await s.advance(10 * 60_000);
  assert.equal((await outcome(s.request.bulk('a', '/api/a'))).error.code, 'repeat');
  assert.equal(s.calls.length, 1);
});

test('an aborted request is not joined by the next caller, and an aborted signal sends nothing', async () => {
  const s = sandbox();
  const a = outcome(s.request.bulk('a', '/api/a'));
  await flush();
  s.request.abort('a');
  const again = s.request.bulk('a', '/api/a');
  assert.equal((await a).error.code, 'abort');
  await flush();
  assert.equal(s.calls.length, 2, 'a request of its own, not the aborted one');
  s.calls[1].respond({ again: true });
  assert.deepEqual(await again, { again: true });

  const controller = new AbortController();
  controller.abort();
  assert.equal((await outcome(s.request.bulk('b', '/api/b', { signal: controller.signal }))).error.code, 'abort');
  await flush();
  assert.equal(s.calls.length, 2);
});

test('one budget over every frame and tab: 2 at a time and 20 a minute together', async () => {
  const shared = sharedBudget();
  const top = sandbox({ shared });
  const dialog = sandbox({ shared, url: 'https://secure20.e-boekhouden.nl/boekhouden/importeren' });
  const a = top.request.bulk('a', '/api/a');
  const b = top.request.bulk('b', '/api/b');
  await flush();
  const c = dialog.request.bulk('c', '/api/c');
  await flush();
  assert.equal(top.calls.length + dialog.calls.length, 2, 'the frame waits for a free slot of the two');
  top.calls[0].respond({ a: 1 });
  await a;
  await dialog.advance(250);
  assert.equal(dialog.calls.length, 1);
  top.calls[1].respond({});
  dialog.calls[0].respond({ c: 1 });
  await Promise.all([b, c]);

  // 3 done; 17 more fit in the minute, over both frames.
  for (let i = 0; i < 17; i += 1) {
    const frame = i % 2 ? top : dialog;
    const answer = frame.request.bulk(`k:${i}`, `/api/k/${i}`);
    await flush();
    frame.calls.at(-1).respond({});
    await answer;
  }
  const late = top.request.bulk('late', '/api/late');
  await flush();
  assert.equal(top.calls.length + dialog.calls.length, 20);
  assert.equal(top.request.stats().queued, 1, 'the 21st waits, although this frame made only 10');
  await top.advance(60_000);
  assert.equal(top.calls.length + dialog.calls.length, 21);
  top.calls.at(-1).respond({});
  await late;
});

test('a 429 in one frame pauses the other frames too', async () => {
  const shared = sharedBudget();
  const top = sandbox({ shared });
  const other = sandbox({ shared, url: 'https://secure20.e-boekhouden.nl/boekhouden/facturen' });
  const first = outcome(top.request.bulk('a', '/api/a'));
  await flush();
  top.calls[0].respond('', { status: 429, headers: { 'retry-after': '30' } });
  assert.equal((await first).error.status, 429);
  await flush();
  const waiting = other.request.bulk('b', '/api/b');
  await flush();
  await other.advance(29_000);
  assert.equal(other.calls.length, 0, 'the other frame waits for Retry-After as well');
  await other.advance(1_000);
  assert.equal(other.calls.length, 1);
  other.calls[0].respond({ b: 1 });
  assert.deepEqual(await waiting, { b: 1 });
});

test('without the service worker (an orphaned script) nothing is sent', async () => {
  const s = sandbox({ worker: false });
  assert.equal((await outcome(s.request.bulk('a', '/api/a'))).error.code, 'unavailable');
  assert.equal(s.calls.length, 0);
});
