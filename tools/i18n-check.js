// Checks screen text against the catalogs in src/locales (see CLAUDE.md, "Translation").
//   node tools/i18n-check.js [--list]     exit 1 on an error; npm run lint runs it too
// Errors: a T/Tc/tIn/pl/N_ key or an index.html data-t text with no Korean entry, a screen key (anything but pl())
// with no Japanese entry, placeholders that differ, T() given a ${} template, and Korean in a string of the game's
// code (use the catalog, a regex, enums.js LEGACY, or an i18n-ignore comment).
import { readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as espree from 'espree';
import { oneLine } from '../src/js/i18n.js'; // the key normalization translateStatic uses

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const JS = join(ROOT, 'src', 'js');
const LOCALES = join(ROOT, 'src', 'locales');
const HANGUL = /[가-힣ㄱ-ㆎ]/;
const CALLS = { T: 0, N_: 0, pl: 0, Tc: 1, tIn: 1 }; // name -> index of the key argument
const rel = p => relative(ROOT, p).split(sep).join('/');

// main.js and what it imports, so stray files in src/js are never read
function modules() {
  const seen = new Set();
  const walk = file => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?['"](\.[^'"]+\.js)['"]/gm))
      walk(join(dirname(file), m[1]));
  };
  walk(join(JS, 'main.js'));
  return [...seen].sort();
}

function* nodes(n) {
  if (!n || typeof n.type !== 'string') return;
  yield n;
  for (const [k, v] of Object.entries(n)) {
    if (k === 'loc' || k === 'range') continue;
    if (Array.isArray(v)) for (const c of v) yield* nodes(c);
    else if (v && typeof v.type === 'string') yield* nodes(v);
  }
}
const literalOf = a =>
  !a
    ? null
    : a.type === 'Literal' && typeof a.value === 'string'
      ? a.value
      : a.type === 'TemplateLiteral' && !a.expressions.length
        ? a.quasis[0].value.cooked
        : null;

export function scanModules(files = modules()) {
  const keys = new Map(); // key -> file:line
  const uses = new Map(); // key -> the functions that take it
  const errors = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    const blocks = [];
    lines.forEach((l, i) => {
      if (/i18n-ignore-start/.test(l)) blocks.push([i + 1, lines.length]);
      else if (/i18n-ignore-end/.test(l) && blocks.length) blocks[blocks.length - 1][1] = i + 1;
    });
    const ignored = line =>
      blocks.some(([a, b]) => line >= a && line <= b) ||
      /i18n-ignore(?!-)/.test(lines[line - 1] || '') ||
      /i18n-ignore(?!-)/.test(lines[line - 2] || '');
    const ast = espree.parse(src, { ecmaVersion: 'latest', sourceType: 'module', loc: true });
    const keyArgs = new Set();
    for (const n of nodes(ast)) {
      if (n.type !== 'CallExpression' || n.callee.type !== 'Identifier' || !(n.callee.name in CALLS)) continue;
      const a = n.arguments[CALLS[n.callee.name]];
      if (!a) continue;
      keyArgs.add(a);
      const at = `${rel(file)}:${n.loc.start.line}`;
      if (a.type === 'TemplateLiteral' && a.expressions.length) {
        errors.push(`${at}: ${n.callee.name}() with a \${...} template: use {placeholders} and vars`);
        continue;
      }
      let key = literalOf(a);
      if (key === null) continue; // a variable: checked where its text is defined (N_)
      if (n.callee.name === 'Tc' && literalOf(n.arguments[0]) !== null) key += '|' + literalOf(n.arguments[0]);
      if (!keys.has(key)) keys.set(key, at);
      (uses.get(key) || uses.set(key, new Set()).get(key)).add(n.callee.name);
    }
    for (const n of nodes(ast)) {
      const text =
        n.type === 'Literal' && typeof n.value === 'string'
          ? n.value
          : n.type === 'TemplateElement'
            ? n.value.cooked
            : null;
      if (text === null || !HANGUL.test(text) || keyArgs.has(n) || ignored(n.loc.start.line)) continue;
      errors.push(`${rel(file)}:${n.loc.start.line}: Korean outside the catalog: ${JSON.stringify(text.slice(0, 50))}`);
    }
  }
  return { keys, uses, errors };
}

export function scanPage(path = join(ROOT, 'src', 'index.html')) {
  const html = readFileSync(path, 'utf8');
  const keys = new Map();
  const errors = [];
  const at = i => `${rel(path)}:${html.slice(0, i).split('\n').length}`;
  for (const m of html.matchAll(/<(\w+)([^>]*?)\sdata-t(-html)?(?=[\s>])([^>]*)>([\s\S]*?)<\/\1\s*>/g))
    keys.set(m[3] ? oneLine(m[5]) : oneLine(m[5].replace(/<[^>]+>/g, '')), at(m.index));
  for (const m of html.matchAll(/<\w+([^>]*\sdata-t-attr="([^"]+)"[^>]*)>/g))
    for (const a of m[2].split(',').map(x => x.trim())) {
      const v = new RegExp(`\\s${a}="([^"]*)"`).exec(m[1]);
      if (v) keys.set(v[1], at(m.index));
    }
  const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '');
  for (const line of text.split('\n'))
    if (HANGUL.test(line)) errors.push(`${rel(path)}: Korean in the page: ${line.trim().slice(0, 60)}`);
  return { keys, errors };
}

export function check({ list = false } = {}) {
  const mod = scanModules();
  const page = scanPage();
  const cat = lang => JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), 'utf8'));
  const ko = cat('ko'),
    ja = cat('ja');
  const keys = new Map([...page.keys, ...mod.keys]);
  const errors = [...mod.errors, ...page.errors];
  // An ASCII shell pipe can destroy translations before a UTF-8 write occurs.
  const damaged = text => /\?{3,}|\uFFFD/.test(text);
  for (const [lang, catalog] of [
    ['ko', ko],
    ['ja', ja],
  ])
    for (const [key, value] of Object.entries(catalog))
      if (damaged(value)) errors.push(`src/locales/${lang}.json: possible encoding damage: ${JSON.stringify(key)}`);
  for (const name of ['README.md', 'README.ko.md', 'README.ja.md'])
    if (damaged(readFileSync(join(ROOT, name), 'utf8'))) errors.push(`${name}: possible encoding damage`);
  const has = (c, k) => k in c || k.split('|')[0] in c;
  const promptOnly = k => {
    const u = mod.uses.get(k);
    return !page.keys.has(k) && !!u && u.size === 1 && u.has('pl'); // a Japanese story reads the English prompt
  };
  for (const [k, at] of keys) {
    if (!has(ko, k)) errors.push(`${at}: no Korean for ${JSON.stringify(k.slice(0, 70))}`);
    if (!has(ja, k) && !promptOnly(k)) errors.push(`${at}: no Japanese for ${JSON.stringify(k.slice(0, 70))}`);
  }
  const holes = s => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const [lang, c] of [
    ['ko', ko],
    ['ja', ja],
  ])
    for (const [k, v] of Object.entries(c))
      if (holes(k) !== holes(v))
        errors.push(`src/locales/${lang}.json: placeholders differ: ${JSON.stringify(k.slice(0, 60))}`);
  const used = new Set([...keys.keys()].flatMap(k => [k, k.split('|')[0]]));
  // '<English command>|command' entries are a language's own command names, read by data.js CMDS
  const unused = lang => Object.keys(lang).filter(k => !used.has(k) && !k.endsWith('|command')).length;
  const shown = list ? errors : errors.slice(0, 40);
  for (const e of shown) console.log('  i18n:', e);
  if (shown.length < errors.length) console.log(`  i18n: ... ${errors.length - shown.length} more (--list)`);
  if (unused(ko) || unused(ja))
    console.log(`  i18n: entries no code uses: ko ${unused(ko)}, ja ${unused(ja)} (warning)`);
  console.log(
    `i18n: ${keys.size} keys, ko ${Object.keys(ko).length}, ja ${Object.keys(ja).length}, ${errors.length} errors`,
  );
  return errors.length === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(check({ list: process.argv.includes('--list') }) ? 0 : 1);
