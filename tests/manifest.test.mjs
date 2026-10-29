// Every file the manifest points at must exist, or Chrome refuses to load
// the folder. The popup's own references are checked too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
  assert.deepEqual([...manifest.permissions].sort(), ['cookies', 'storage']);
});
