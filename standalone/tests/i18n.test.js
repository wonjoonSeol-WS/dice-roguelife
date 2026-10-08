// The add-on's screen text (tr() and N_() in standalone/client) has Korean and Japanese, in its own catalogs
// (standalone/locales) or the game's, with the same placeholders; and its catalogs hold nothing unused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const json = (...p) => JSON.parse(readFileSync(join(ROOT, ...p), 'utf8'));
const LANGS = ['ko', 'ja'];
const own = Object.fromEntries(LANGS.map(l => [l, json('standalone', 'locales', l + '.json')]));
const game = Object.fromEntries(LANGS.map(l => [l, json('src', 'locales', l + '.json')]));

function keys() {
  const dir = join(ROOT, 'standalone', 'client');
  const out = new Set();
  for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/\b(?:tr|N_)\(\s*'((?:[^'\\]|\\.)*)'/g)) out.add(m[1].replace(/\\'/g, "'"));
  }
  return out;
}
const holes = s => [...String(s).matchAll(/\{(\w+)[}|]/g)].map(m => m[1]).sort();

test('every add-on string is translated, with the same placeholders', () => {
  const used = keys();
  assert.ok(used.size > 20);
  for (const k of used)
    for (const l of LANGS) {
      const v = own[l][k] ?? game[l][k];
      assert.ok(v !== undefined, `${l}: no translation for ${JSON.stringify(k)}`);
      assert.deepEqual(holes(v), holes(k), `${l}: placeholders differ for ${JSON.stringify(k)}`);
      assert.ok(!/\?{2,}|�/.test(v), `${l}: possible encoding damage in ${JSON.stringify(k)}`);
    }
  for (const l of LANGS) for (const k of Object.keys(own[l])) assert.ok(used.has(k), `${l}: unused entry ${k}`);
});
