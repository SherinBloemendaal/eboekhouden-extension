// Builds vendor/ai-sdk.mjs: the Vercel AI SDK and its three providers as one
// ES module for the AI writing help's offscreen document. The extension
// itself has no build step; this runs only when the pinned versions in
// package.json change (npm run build:vendor), and its output is committed.
//
// The bundle must run under the extension's CSP (no eval, no new Function)
// and must not depend on Node: both are checked after the build, and the
// build fails when either check fails. The licenses of every package that
// ended up in the bundle are collected in vendor/ai-sdk.LICENSES.txt.

import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'vendor', 'ai-sdk.mjs');
const licenseFile = join(root, 'vendor', 'ai-sdk.LICENSES.txt');

// What the offscreen engine uses, and nothing more.
const ENTRY = `
export { generateText, APICallError } from 'ai';
export { createOpenAI } from '@ai-sdk/openai';
export { createAnthropic } from '@ai-sdk/anthropic';
export { createOpenRouter } from '@openrouter/ai-sdk-provider';
`;
const PINNED = ['ai', '@ai-sdk/openai', '@ai-sdk/anthropic', '@openrouter/ai-sdk-provider', 'zod', 'esbuild'];

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

// The installed versions must be the pinned ones: a stale node_modules
// would otherwise end up in the bundle unnoticed.
const wanted = readJson(join(root, 'package.json')).devDependencies;
const versions = {};
for (const name of PINNED) {
  const installed = readJson(join(root, 'node_modules', name, 'package.json')).version;
  if (installed !== wanted[name]) throw new Error(`${name} is ${installed} in node_modules, package.json pins ${wanted[name]}: run npm ci`);
  versions[name] = installed;
}

const result = await build({
  stdin: { contents: ENTRY, resolveDir: root, sourcefile: 'ai-sdk-entry.mjs', loader: 'js' },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome116',
  minify: true,
  legalComments: 'none',
  metafile: true,
  write: false,
  logLevel: 'warning',
});

const code = result.outputFiles[0].text;
const forbidden = [
  [/\beval\s*\(/, 'eval('],
  [/\bnew\s+Function\s*\(/, 'new Function('],
  [/\bFunction\s*\(\s*["'`]/, 'Function("...")'],
  [/\brequire\s*\(\s*["'`](?:node:)?(?:fs|path|http|https|net|tls|child_process|crypto|stream|zlib)["'`]\s*\)/, 'a Node module'],
];
for (const [pattern, label] of forbidden) {
  if (pattern.test(code)) throw new Error(`vendor/ai-sdk.mjs contains ${label}, which the extension's CSP or the browser refuses`);
}

// Which packages went into the bundle, from esbuild's own list of inputs.
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const parts = input.split(/[\\/]/);
  const at = parts.lastIndexOf('node_modules');
  if (at < 0) continue;
  const name = parts[at + 1].startsWith('@') ? `${parts[at + 1]}/${parts[at + 2]}` : parts[at + 1];
  const dir = join(root, ...parts.slice(0, at + 1 + name.split('/').length));
  if (!packages.has(name)) packages.set(name, dir);
}

function licenseText(dir) {
  const file = readdirSync(dir).find((entry) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(entry));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null;
}

const notices = [];
for (const [name, dir] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const pkg = readJson(join(dir, 'package.json'));
  const text = licenseText(dir);
  notices.push(`${name}@${pkg.version} (${pkg.license ?? 'see below'})\n${'-'.repeat(60)}\n${text ?? `No license file in the package; package.json says: ${pkg.license ?? 'nothing'}.`}`);
}

const header = `// Vendored by scripts/build-vendor.mjs; do not edit. Rebuild with npm run build:vendor.\n`
  + `// ${PINNED.filter((name) => name !== 'esbuild').map((name) => `${name}@${versions[name]}`).join(', ')}; esbuild@${versions.esbuild}.\n`
  + `// Licenses of the bundled packages: ai-sdk.LICENSES.txt next to this file.\n`;

if (!existsSync(dirname(outFile))) mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, header + code);
writeFileSync(licenseFile, `Third-party packages bundled into vendor/ai-sdk.mjs\n\n${notices.join('\n\n\n')}\n`);

const kb = Math.round(Buffer.byteLength(header + code) / 1024);
console.log(`${relative(root, outFile).split(sep).join('/')}: ${kb} KB, ${packages.size} packages`);
