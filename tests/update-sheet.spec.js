// the version comes from package.json, and the update sheet hands over a request that fetches the release with curl and names this artifact
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './support/test.js';
import { claudeMock } from './support/harness.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

test('update sheet', async ({ game }) => {
  const { pg, errs } = await game(claudeMock(), { size: [420, 900] });
  await pg.waitForSelector('#rollBtn');
  const header = await pg.textContent('#brandSub');
  console.log('header:', header, '| APP_VERSION:', await pg.evaluate('DR.APP_VERSION'));
  if (header !== `Dice Roguelife, v${VERSION}`) errs.push('header version is not package.json');
  await pg.click('#gearBtn');
  await pg.click('#updBtn');
  const text = await pg.inputValue('#updText');
  console.log('request:', text.replaceAll('\n', ' / '));
  for (const want of [
    '컴퓨터 도구(bash)',
    'curl -L -o dice-roguelife.html https://github.com/wonjoonSeol/dice-roguelife/releases/latest/download/dice-roguelife.html',
    '덮어써',
    '(여기에 내 아티팩트 링크)',
  ]) {
    if (!text.includes(want)) errs.push(`request lacks ${want}`);
  }
  const link = 'https://claude.ai/artifact/EXAMPLE';
  await pg.fill('#updLink', link);
  await pg.dispatchEvent('#updLink', 'change');
  if (!(await pg.inputValue('#updText')).includes(link)) errs.push('request does not follow the link field');
  await pg.waitForFunction(`DR.app.settings.artifactLink===${JSON.stringify(link)}`, null, { timeout: 5000 });
  await pg.evaluate('DR.closeSheet()');
  await pg.click('#gearBtn');
  await pg.click('#updBtn');
  const kept = await pg.inputValue('#updLink');
  console.log('link kept for next time:', kept === link);
  if (kept !== link) errs.push('artifact link not remembered');
  expect(errs).toEqual([]);
});
