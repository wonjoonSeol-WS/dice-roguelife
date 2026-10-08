// The standalone page: the game with this add-on's client. A checkout builds it at start (esbuild, from `npm ci`); the
// standalone download ships it built (tools/release.js), so it runs with no installs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// { html, js }, as tools/build.js returns them
export async function buildPage(ver) {
  const { build } = await import('../tools/build.js').catch(e => {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    throw new Error(
      'This is the source code, which needs `npm ci` before `npm start`. To just play, download ' +
        'dice-roguelife-standalone-v….zip from https://github.com/wonjoonSeol-WS/dice-roguelife/releases/latest',
    );
  });
  const css = readFileSync(new URL('client/standalone.css', import.meta.url), 'utf8');
  return build(ver, { entry: fileURLToPath(new URL('client/main.js', import.meta.url)), css });
}
