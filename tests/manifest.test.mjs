// Every file the manifest points at must exist, or Chrome refuses to load
// the folder. The popup's own references are checked too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

function referencedFiles() {
  const files = [
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    manifest.action?.default_popup,
    manifest.background?.service_worker,
    manifest.options_ui?.page,
  ];
  for (const script of manifest.content_scripts ?? []) files.push(...(script.js ?? []), ...(script.css ?? []));
  for (const entry of manifest.web_accessible_resources ?? []) files.push(...(entry.resources ?? []));
  return files.filter(Boolean);
}

test('every file in manifest.json exists', () => {
  const missing = referencedFiles().filter((file) => !existsSync(join(root, file)));
  assert.deepEqual(missing, []);
});

test('every script and stylesheet the popup loads exists', () => {
  const popup = join(root, manifest.action.default_popup);
  const html = readFileSync(popup, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]).filter((ref) => !/^[a-z]+:/i.test(ref));
  const missing = refs.filter((ref) => !existsSync(join(dirname(popup), ref)));
  assert.ok(refs.length >= 3, 'the popup references its files');
  assert.deepEqual(missing, []);
});

test('the manifest is MV3 with the minimum host access', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, ['https://*.e-boekhouden.nl/*']);
  assert.deepEqual([...manifest.permissions].sort(), ['cookies', 'offscreen', 'storage']);
});

const [mainWorld, isolated] = manifest.content_scripts;

test('the MAIN-world script runs where the content scripts run, at document_start, in every frame', () => {
  assert.equal(manifest.content_scripts.length, 2);
  assert.deepEqual(mainWorld.js, ['src/main-world.js']);
  assert.equal(mainWorld.world, 'MAIN');
  assert.equal(isolated.world, undefined, 'the rest stays in the isolated world');
  assert.deepEqual(mainWorld.matches, isolated.matches);
  assert.deepEqual(mainWorld.include_globs, isolated.include_globs);
  assert.equal(mainWorld.run_at, 'document_start');
  assert.equal(mainWorld.all_frames, true);
});

test('shared modules load before the scripts that use them, every feature file is loaded, features last', () => {
  const list = isolated.js;
  const at = (file) => list.indexOf(file);
  assert.equal(list[0], 'src/shared.js');
  for (const shared of ['src/store.js', 'src/icons.js', 'src/dialog.js', 'src/bridge.js', 'src/request.js']) {
    assert.ok(at(shared) > 0 && at(shared) < at('src/import.js'), shared);
  }
  assert.ok(at('src/bridge.js') < at('src/request.js'), 'request.js claims the bridge');
  const features = readdirSync(join(root, 'src/features')).filter((file) => file.endsWith('.js')).map((file) => `src/features/${file}`);
  assert.deepEqual(features.filter((file) => !list.includes(file)), []);
  const firstFeature = Math.min(...features.map(at));
  assert.ok(list.slice(firstFeature).every((file) => file.startsWith('src/features/')));
});

test('AI providers are optional hosts, asked for at runtime; offscreen is for the AI writing help', () => {
  assert.deepEqual(manifest.optional_host_permissions, ['https://openrouter.ai/*', 'https://api.openai.com/*', 'https://api.anthropic.com/*']);
  assert.ok(manifest.permissions.includes('offscreen'));
  assert.equal(readFileSync(join(root, 'src/bg/ai.js'), 'utf8').includes("'src/offscreen/offscreen.html'"), true, 'the worker opens the document the manifest allows');
});

test('the AI settings page is the options page, in a tab, and its files exist', () => {
  assert.deepEqual(manifest.options_ui, { page: 'src/options/options.html', open_in_tab: true });
  const file = join(root, manifest.options_ui.page);
  const refs = [...readFileSync(file, 'utf8').matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(refs, ['options.css', '../shared.js', '../icons.js', 'main.js']);
  assert.ok(refs.every((ref) => existsSync(join(dirname(file), ref))));
});

test('the offscreen document stub loads files that exist', () => {
  const file = join(root, 'src/offscreen/offscreen.html');
  const refs = [...readFileSync(file, 'utf8').matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(refs, ['offscreen.js']);
  assert.ok(refs.every((ref) => existsSync(join(dirname(file), ref))));
});
