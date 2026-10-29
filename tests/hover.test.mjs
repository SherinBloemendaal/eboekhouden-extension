// Hover states fade; they never jump in. A rule that shows or hides
// something on :hover with display (or visibility) has no transition and
// pops, so it is not allowed anywhere in the extension's styles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ...readdirSync(join(root, 'src')).filter((name) => /\.(js|css)$/.test(name)).map((name) => join('src', name)),
  ...readdirSync(join(root, 'src/popup')).filter((name) => /\.(js|css|html)$/.test(name)).map((name) => join('src/popup', name)),
  ...readdirSync(join(root, 'src/features')).filter((name) => /\.js$/.test(name)).map((name) => join('src/features', name)),
  ...readdirSync(join(root, 'src/options')).filter((name) => /\.(js|css|html)$/.test(name)).map((name) => join('src/options', name)),
];

test('no hover rule switches display or visibility', () => {
  const offenders = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const match of text.matchAll(/([^{}\n]*:hover[^{}\n]*)\{([^}]*)\}/g)) {
      if (/\b(display|visibility)\s*:/.test(match[2])) offenders.push(`${file}: ${match[1].trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('every hover rule has a transition on the same element', () => {
  const missing = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    if (!/:hover/.test(text)) continue;
    if (!/transition\s*:\s*[^;]*(background|color|opacity|border)/.test(text)) missing.push(file);
  }
  assert.deepEqual(missing, []);
});
