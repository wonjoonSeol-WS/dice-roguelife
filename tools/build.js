// Assembles the single-file page that is published as the artifact.
//
//   node tools/build.js        writes dist/dice-roguelife.html (npm run build)
//
// The page is src/index.html with its markers filled in:
//   <!-- build:styles -->   becomes <style> with src/styles.css
//   <!-- build:scripts -->  becomes one <script> with the game: src/js/main.js and every module it imports, bundled
//                           by esbuild together with prompts.json, the prompt the page falls back to when the database
//                           has none
//   <!-- build:version -->  becomes the version from package.json (the bundle gets it as __APP_VERSION__)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as esbuild } from 'esbuild';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PAGE = join(ROOT, 'dist', 'dice-roguelife.html');

const read = path => readFileSync(join(ROOT, path), 'utf8');

export const version = () => JSON.parse(read('package.json')).version;

// one classic script: the artifact page has no module loader to rely on
export async function bundle(ver, entry = join(ROOT, 'src', 'js', 'main.js')) {
  const result = await esbuild({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    charset: 'utf8', // keep Korean text readable instead of \u escapes
    legalComments: 'none',
    define: { __APP_VERSION__: JSON.stringify(ver) },
    write: false,
    logLevel: 'error',
  });
  return result.outputFiles[0].text;
}

// { html, js }: the page and the bundled script in it. ver stamps a version other than package.json's (a release
// checks the new version before writing it); entry and css build another page from the same game (standalone/)
export async function build(ver = version(), { entry, css = '' } = {}) {
  const js = await bundle(ver, entry);
  const blocks = {
    '<!-- build:version -->': ver,
    '<!-- build:styles -->': `<style>\n${read('src/styles.css')}${css}</style>`,
    '<!-- build:scripts -->': `<script>\n${js}</script>`,
  };
  let html = read('src/index.html');
  for (const [marker, block] of Object.entries(blocks)) {
    if (html.split(marker).length !== 2) throw new Error(`build: ${marker} must appear once in src/index.html`);
    html = html.replace(marker, () => block); // a function, so a '$' in the script is never read as a pattern
  }
  return { html, js };
}

export function writePage(html, path = PAGE) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html, 'utf8');
  return path;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { html } = await build();
  console.log('built', writePage(html));
}
