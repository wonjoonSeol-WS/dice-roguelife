// Screenshots for the guide site, one language per run: docs/images/<name>-<lang>.png
//   node tools/shots.js en              every shot
//   node tools/shots.js ja play extra   some groups (new, play, misc, desk, images, styles, promo, hero, pc, extra)
// The story in the shots is fake (tools/shots/<lang>.json) and the faces are drawn placeholders. The image-tab shots
// can show real art instead: DR_SHOT_ART=<folder> with <id>.webp files named as in ART below, or named by image id
// (female1_smile.webp, bg_castle-gate_day.webp); with it the play shots show real art too.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import UPNG from 'upng-js';
import { build, writePage } from './build.js';
import { siteSizes } from './site-sizes.js';
import { claudeMock } from '../tests/support/harness.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOCALES = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP' };
const [lang, ...only] = process.argv.slice(2);
if (!LOCALES[lang]) {
  console.log('usage: node tools/shots.js <ko|en|ja> [new play misc desk images styles promo hero pc extra]');
  process.exit(1);
}
const S = JSON.parse(readFileSync(join(ROOT, 'tools', 'shots', `${lang}.json`), 'utf8'));
const out = name => join(ROOT, 'docs', 'images', `${name}-${lang}.png`);
const PROMO = join(ROOT, 'tests', 'shots', 'promo');

// Placeholder pictures: a gradient portrait with a face for an emotion, or a skyline for a background.
const svg = s => 'data:image/svg+xml,' + encodeURIComponent(s).replace(/'/g, '%27');
const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;
function face(hue, emo) {
  const mouth =
    {
      smile: '<path d="M158 238 Q180 258 202 238" stroke="#783232" stroke-width="4" fill="none"/>',
      anger:
        '<path d="M158 250 Q180 232 202 250" stroke="#783232" stroke-width="4" fill="none"/><path d="M137 165 L166 177 M223 165 L194 177" stroke="#281e1e" stroke-width="4"/>',
    }[emo] || '<path d="M162 244 H198" stroke="#783232" stroke-width="4"/>';
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="480" viewBox="0 0 360 480">
<defs><linearGradient id="g" x2="0" y2="1"><stop offset="0" stop-color="${hsl(hue * 360, 45, 72)}"/><stop offset="1" stop-color="${hsl(hue * 360, 30, 34)}"/></linearGradient></defs>
<rect width="360" height="480" fill="url(#g)"/><ellipse cx="180" cy="460" rx="110" ry="160" fill="${hsl(hue * 360, 40, 18)}"/>
<ellipse cx="180" cy="160" rx="66" ry="76" fill="#ebcdb9"/><path d="M100 150 A80 80 0 0 1 260 150 Z" fill="${hsl(hue * 360, 40, 18)}"/>
<circle cx="155" cy="180" r="5" fill="#281e1e"/><circle cx="205" cy="180" r="5" fill="#281e1e"/>${mouth}</svg>`);
}
function scene(hue) {
  const blocks = [0, 1, 2, 3, 4]
    .map(
      i =>
        `<rect x="${48 + i * 96}" y="${150 - ((i * 30) % 90)}" width="66" height="${170 + ((i * 30) % 90)}" fill="${hsl(hue * 360, 45, 22)}"/>`,
    )
    .join('');
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
<defs><linearGradient id="g" x2="0" y2="1"><stop offset="0" stop-color="${hsl(hue * 360, 40, 30)}"/><stop offset="1" stop-color="${hsl(hue * 360, 35, 62)}"/></linearGradient></defs>
<rect width="480" height="320" fill="url(#g)"/>${blocks}<circle cx="384" cy="54" r="40" fill="#fff0c8"/></svg>`);
}
const silhouette = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="480" viewBox="0 0 360 480">
<rect width="360" height="480" fill="#2a3040"/><circle cx="180" cy="170" r="70" fill="#0d1018"/><ellipse cx="180" cy="470" rx="120" ry="170" fill="#0d1018"/></svg>`);

const PICS = {};
const ROWS = [];
const char = (set, emo, tags, src) => {
  const id = `${set}_${emo}`;
  PICS[id] = src;
  ROWS.push({
    id,
    kind: 'char',
    name: id,
    set,
    emotion: emo,
    file: id + '.png',
    tags: [set, emo, ...tags],
    worlds: [],
  });
};
for (const [set, hue, emos] of [
  ['female1', 0.95, ['neutral', 'smile', 'anger']],
  ['male1', 0.58, ['neutral', 'smile']],
  ['female2', 0.12, ['neutral', 'smirk']],
  ['creature1', 0.33, ['neutral']],
])
  for (const e of emos) char(set, e, [], face(hue, e));
for (const e of ['neutral', '2']) char('shadow_male', e, ['shadow', 'silhouette'], silhouette);
for (const [n, hue] of [
  ['bg_tavern_night', 0.08],
  ['bg_castle-gate_day', 0.6],
  ['bg_alley_day', 0.75],
]) {
  PICS[n] = scene(hue);
  ROWS.push({ id: n, kind: 'scene', name: n.slice(3), file: n + '.png', tags: ['sample'], worlds: [] });
}
for (const n of ['dice', 'dice_success', 'dice_fail']) {
  PICS[n] = scene(0.5);
  ROWS.push({ id: n, kind: 'fx', name: n, file: n + '.png', tags: ['dice'] });
}
// the hero shot's hunter and gate (real art with DR_SHOT_ART)
const HERO_ROWS = [
  { id: 'hunter1_smirk', kind: 'char', name: 'hunter1_smirk', set: 'hunter1', emotion: 'smirk', tags: ['hunter'] },
  { id: 'bg_gate-portal_night', kind: 'scene', name: 'gate-portal_night', tags: ['gate', 'city', 'night'] },
];
// with real art, the play shot shows one story illustration as the scene picture (bg_city-night_cg), as players do
const CG_ROW = { id: 'bg_city-night_cg', kind: 'scene', name: 'city-night_cg', tags: ['city', 'night'] };
PICS[CG_ROW.id] = scene(0.6);
PICS.hunter1_smirk = face(0.9, 'smile');
PICS['bg_gate-portal_night'] = scene(0.7);
const SETS = {
  female1: {
    gender: 'female',
    role: 'knight, noble, earnest, long wavy brown hair, blue eyes, silver plate armor, red cape, sword',
    worlds: ['hunter', 'tower', 'vrmmo', 'fantasy', 'rofan', 'monster'],
  },
  male1: {
    gender: 'male',
    role: 'dark knight commander, stern, battle-hardened, elf, spiky silver hair, blue eyes, black and gold ornate armor',
    worlds: ['hunter', 'tower', 'vrmmo', 'fantasy', 'rofan', 'monster'],
  },
  female2: {
    gender: 'female',
    role: 'elf archer, gentle, proud, elf, long white braided hair, blue eyes, red and black ranger coat, bow',
    worlds: ['fantasy', 'rofan', 'tower'],
  },
  shadow_male: { gender: 'male', tier: 'generic' },
};
// real art for the image-tab shots: asset ids of the sets above in the owner's library
const ART = {
  female1_neutral: 'e97c47d760da962429078cb74ba63d3f',
  female1_smile: '8a151e4f995c5444642d0efda3a67fe7',
  female1_anger: '4d703afd02b1c90b90d258e0735c608d',
  male1_neutral: '92afe4a7aa1898314844a266a2637614',
  male1_smile: '8b63df231e1687434bd648caf07cb01e',
  female2_neutral: '463a0be72364ff3f5c8bdbbd82e9971c',
  female2_smirk: '4a42ecf93d63543ec10fc2f586a2588e',
  hunter1_smirk: '18824610c4ab7e8e219c70dc3bd3895c',
  'bg_gate-portal_night': '56f16c5fde20f9c82b03b5f00e5e7e3c',
};
const ART_DIR = process.env.DR_SHOT_ART;
const REAL = {};
if (ART_DIR)
  for (const id of new Set([...Object.keys(ART), ...Object.keys(PICS)])) {
    const p = [id, ART[id]]
      .filter(Boolean)
      .map(n => join(ART_DIR, n + '.webp'))
      .find(existsSync);
    if (p) REAL[id] = 'data:image/webp;base64,' + readFileSync(p).toString('base64');
  }

// the narrator: replies[window.__scn] (the next reply is picked before each send), over an empty reply
const BASE = { admin: '', narration: '', system: [], choices: [], stat_changes: {}, memory: {}, dead: false };
const REPLY = `async()=>{const k=window.__scn||'aftermath';window.__scn=null;return Object.assign({},window.__B,window.__R[k]);}`;
const MOCK = claudeMock(REPLY, {
  // the input tip already dismissed: it would cover the bottom of every play shot
  before: `window.__R=${JSON.stringify(S.replies)};window.__B=${JSON.stringify(BASE)};localStorage.setItem('dr:inputHint','{"done":1}');`,
});
// the same rolls every run and in every language: the same life, translated
const seed = pg =>
  pg.evaluate(() => {
    let a = 20261007;
    DR.rnd = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });

const wait = (pg, ms = 500) => pg.waitForTimeout(ms);
const say = async (pg, text, scn, ms = 1300) => {
  await pg.evaluate(k => (window.__scn = k), scn);
  await pg.fill('#input', text);
  await pg.press('#input', 'Enter');
  await wait(pg, ms);
};
const clean = pg => pg.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
// 256 colors: a third of the size, and the repository keeps every version of every shot
const save = (name, png) => {
  const img = UPNG.decode(png);
  writeFileSync(out(name), Buffer.from(UPNG.encode(UPNG.toRGBA8(img), img.width, img.height, 256)));
  console.log('  ' + name);
};
const snap = async (pg, name, opts = {}) => {
  await clean(pg);
  save(name, await pg.screenshot(opts));
};
const snapEl = async (pg, sel, name) => {
  await clean(pg);
  const el = pg.locator(sel).last();
  await el.scrollIntoViewIfNeeded();
  await wait(pg, 300);
  save(name, await el.screenshot());
};
const lastWidget = async (pg, name) => {
  await pg.evaluate(() => [...document.querySelectorAll('#log .w')].pop()?.scrollIntoView({ block: 'center' }));
  await wait(pg, 400);
  await snap(pg, name);
};
const closeSheet = async pg => {
  await pg.evaluate(() => document.querySelector('#sheetInner [data-close]')?.click());
  await wait(pg, 300);
};
const gear = async pg => {
  await pg.click('#gearBtn');
  await wait(pg, 600);
};
const setv = async (pg, sel, val) => {
  await gear(pg);
  if (typeof val === 'boolean') {
    if ((await pg.isChecked(sel)) !== val) await pg.click(sel);
  } else await pg.selectOption(sel, val);
  await wait(pg, 400);
  await closeSheet(pg);
};
const seedImages = (pg, real = false) =>
  pg.evaluate(
    ([P, rows, sets]) => {
      DR.claudeHost.assetUrl = id => P[id] || P.dice;
      DR.app.images.push(...rows);
      Object.assign(DR.app.setMeta, sets);
      DR.platform.limits = Object.assign({}, DR.platform.limits, { images: true });
      DR.platform.assets = {
        upload: async () => ({ id: 'x' }),
        delete: async () => {},
        list: async () => ({
          assets: [],
          usage: { files: rows.length, maxFiles: 5000, bytes: 2.4e6, maxBytes: 1024 * 1048576 },
        }),
      };
    },
    [real ? { ...PICS, ...REAL } : PICS, ROWS, SETS],
  );

// a phone (shown 640 wide, like the Korean shots) or a desktop window
const SIZES = { phone: [420, 900, 640 / 420], desk: [770, 900, 1], wide: [900, 1068, 1], mid: [700, 1200, 1] };
async function open(browser, size = 'phone') {
  const [w, h, scale] = SIZES[size];
  const ctx = await browser.newContext({
    locale: LOCALES[lang],
    viewport: { width: w, height: h },
    deviceScaleFactor: scale,
  });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('  page error:', e.message));
  await pg.addInitScript(MOCK);
  await pg.goto(PAGE);
  await pg.waitForSelector('#rollBtn');
  await seed(pg);
  await wait(pg, 500);
  return { ctx, pg };
}
async function begin(pg, { dice = true, fateShot = null } = {}) {
  await pg.fill('#nm', S.name);
  await pg.click('[data-w="hunter"]');
  await pg.evaluate(d => {
    const x = document.querySelector('#diceMode');
    if (x) x.checked = d;
  }, dice);
  await pg.click('#rollBtn');
  await wait(pg, 2000);
  if (fateShot) await fate(pg, fateShot);
  await pg.evaluate(() => (window.__scn = 'intro'));
  await pg.click('#acceptBtn');
  await wait(pg, 1400);
}
const fate = async (pg, name) => {
  await pg.locator('#fate').scrollIntoViewIfNeeded();
  await wait(pg, 2500); // the cards' flip animation
  await snapEl(pg, '#fate', name);
};
// the opening scene with a background and a face, as the narrator would have placed them
async function openScene(pg) {
  await seedImages(pg, true);
  // real art: a single story illustration as the scene picture; otherwise a background and a portrait
  const cg = REAL['bg_city-night_cg'];
  await say(pg, S.inputs.look, 'open', 1500);
  await pg.evaluate(
    async ([friend, cg]) => {
      if (cg && !DR.app.images.some(x => x.id === cg.id)) DR.app.images.push(cg);
      const t = DR.app.turns.at(-1);
      t.img = cg
        ? { scene: cg.id }
        : { scene: 'bg_alley_day', char: 'female1_smile', chars: [{ id: 'female1_smile', npc: friend }] };
      await DR.turnStore.update(t);
      DR.renderLog('keep');
    },
    [S.replies.open.memory.relations[2].name, cg && CG_ROW],
  );
  await wait(pg, 700);
}

const GROUPS = {
  async new(browser) {
    const { ctx, pg } = await open(browser);
    await snap(pg, 'newlife');
    await snapEl(pg, '.dm', 'dice-panel');
    await pg.fill('#nm', S.name);
    await pg.click('[data-w="hunter"]');
    await pg.click('#mseg [data-m="free"]');
    await pg.fill('#fOrigin', S.free.origin);
    await pg.fill('#worldNote', S.free.worldNote);
    await pg.evaluate(() => document.querySelector('#freeBox').scrollIntoView());
    await wait(pg, 300);
    await snap(pg, 'custom-start');
    await ctx.close();
  },

  async play(browser) {
    const { ctx, pg } = await open(browser);
    await begin(pg, { fateShot: 'fate' });
    await openScene(pg);
    await pg.evaluate(() => {
      // start at the scene picture so the background and the face are both in the shot
      const i =
        [...document.querySelectorAll('#log .scene')].pop() || [...document.querySelectorAll('#log img.char')].pop();
      if (i) i.scrollIntoView({ block: 'start' });
      document.querySelector('#log').scrollTop -= 30;
    });
    await wait(pg, 500);
    await snap(pg, 'play');
    await pg.evaluate(() => (document.querySelector('#log').scrollTop = 1e6));
    await wait(pg, 400);
    await snap(pg, 'dice-on-choices');
    await pg.fill('#input', '/');
    await wait(pg, 400);
    await snap(pg, 'slash');
    await pg.fill('#input', '');
    await pg.evaluate(() => {
      window.__scn = 'roll';
      DR.rnd = () => 0.85; // a 86: the broom misses the 60
    });
    await pg.click('#log .choices [data-choice]');
    await wait(pg, 2800);
    await seed(pg);
    await pg.evaluate(() => (document.querySelector('#log').scrollTop = 1e6));
    await wait(pg, 300);
    await snap(pg, 'dice-on-roll');
    await pg.fill('#input', S.inputs.judgeTyping);
    await wait(pg, 400);
    await snap(pg, 'judge-type');
    await say(pg, S.inputs.judge, 'judge', 1600);
    await snap(pg, 'judge-result');
    for (const [cmd, scn, name] of [
      [S.inputs.chat, 'messenger', 'w-messenger'],
      [S.inputs.news, 'news', 'w-news'],
      [S.inputs.quest, 'quest', 'w-quest'],
    ]) {
      await say(pg, cmd, scn, 1400);
      await lastWidget(pg, name);
    }
    await pg.evaluate(
      ([titles, on]) => {
        const s = DR.app.state;
        s.titles = titles.map(t => t[0]);
        s.titleFx = Object.fromEntries(titles);
        s.titlesOn = on.map(i => titles[i][0]);
        s.title = s.titlesOn[0];
      },
      [S.titles, S.titlesOn],
    );
    await pg.click('#strip');
    await wait(pg, 700);
    await pg.evaluate(() => (document.querySelector('#sheetInner').scrollTop = 400));
    await wait(pg, 300);
    await snap(pg, 'status-titles');
    await closeSheet(pg);
    await pg.click('[data-tab="memory"]');
    await wait(pg, 800);
    await pg.selectOption(`[data-merge="${S.merge[0]}"]`, S.merge[1]);
    await wait(pg, 700);
    await snap(pg, 'merge-confirm');
    await pg.evaluate(() => document.querySelector('#dlgNo')?.click());
    await wait(pg, 300);
    await pg.click('[data-tab="saves"]');
    await wait(pg, 900);
    await snap(pg, 'saves-export');
    await pg.click('[data-tab="play"]');
    await wait(pg, 400);
    await pg.evaluate(() => DR.storeError({ code: 'quota_exceeded' }));
    await wait(pg, 700);
    await snap(pg, 'quota-full');
    await ctx.close();
  },

  async misc(browser) {
    let { ctx, pg } = await open(browser);
    await begin(pg, { dice: false });
    await say(pg, S.inputs.look, 'nodice', 1500);
    await snap(pg, 'dice-off-choices');
    await ctx.close();

    ({ ctx, pg } = await open(browser));
    await begin(pg);
    await say(pg, S.inputs.look, 'open', 1500);
    await pg.click('#strip');
    await wait(pg, 700);
    await snap(pg, 'status-before');
    await closeSheet(pg);
    await pg.evaluate(() => (DR.app.state.statusUnlocked = true));
    await say(pg, S.inputs.walk, 'aftermath', 1500);
    await pg.click('#strip');
    await wait(pg, 700);
    await snap(pg, 'status-after');
    await ctx.close();

    for (const sp of ['on', 'off']) {
      ({ ctx, pg } = await open(browser));
      await pg.fill('#nm', S.name);
      await pg.click('[data-w="hunter"]');
      await pg.click('#mseg [data-m="free"]');
      await pg.click(`#spseg [data-sp="${sp}"]`);
      await pg.evaluate(() => document.querySelector('#spseg').scrollIntoView({ block: 'center' }));
      await wait(pg, 300);
      if (sp === 'on') await snap(pg, 'sponsor-opt-on');
      await pg.click('#rollBtn');
      await wait(pg, 2400);
      await fate(pg, `sponsor-fate-${sp}`);
      if (sp === 'on') {
        await pg.evaluate(() => (window.__scn = 'intro'));
        await pg.click('#acceptBtn');
        await wait(pg, 1400);
        await pg.evaluate(() => (DR.app.state.channelOpen = true));
        await say(pg, S.inputs.star, 'star', 1500);
        await lastWidget(pg, 'sponsor-gallery');
      }
      await ctx.close();
    }
  },

  // settings and widget looks, at desktop width
  async desk(browser) {
    const { ctx, pg } = await open(browser, 'desk');
    await begin(pg);
    await openScene(pg);
    await gear(pg);
    await snap(pg, 'settings');
    await pg.evaluate(() => (document.querySelector('#sheetInner').scrollTop = 700));
    await wait(pg, 300);
    await snap(pg, 'settings2');
    await pg.evaluate(() => {
      document.querySelector('#recentSel').scrollIntoView({ block: 'start' });
      document.querySelector('#sheetInner').scrollTop -= 60;
    });
    await wait(pg, 300);
    await snap(pg, 'context-size');
    await pg.evaluate(() => document.querySelector('#updBtn').scrollIntoView({ block: 'center' }));
    await pg.click('#updBtn');
    await wait(pg, 700);
    await snap(pg, 'update-sheet');
    await closeSheet(pg);
    await say(pg, S.inputs.news, 'news', 1400);
    await lastWidget(pg, 'news-broadcast');
    await setv(pg, '#newsSel', 'paper');
    await lastWidget(pg, 'news-paper');
    await say(pg, S.inputs.quest, 'quest', 1400);
    await lastWidget(pg, 'quest-board');
    await setv(pg, '#questSel', 'ui');
    await lastWidget(pg, 'quest-ui');
    await say(pg, S.inputs.chatAgain, 'messenger', 1400);
    await lastWidget(pg, 'msg-light');
    await setv(pg, '#wdark', true);
    await lastWidget(pg, 'msg-dark');
    await say(pg, S.inputs.board, 'gallery', 1400);
    await lastWidget(pg, 'gal-dark');
    await setv(pg, '#wdark', false);
    await lastWidget(pg, 'gal-light');
    await pg.click('[data-tab="memory"]');
    await wait(pg, 800);
    await snapEl(pg, '.sec:has([data-merge])', 'memory-merge');
    await pg.click('[data-tab="play"]');
    await wait(pg, 500);
    await gear(pg);
    await pg.evaluate(() => document.querySelector('#capOn').scrollIntoView({ block: 'center' }));
    await wait(pg, 300);
    await snap(pg, 'capture-opts');
    await pg.click('#capOn');
    await wait(pg, 400);
    await closeSheet(pg);
    await pg.evaluate(() => (document.querySelector('#log').scrollTop = 0));
    await wait(pg, 400);
    await snap(pg, 'capture-on');
    await setv(pg, '#capOn', false);
    await setv(pg, '#discreet', true);
    await wait(pg, 500);
    await snap(pg, 'discreet');
    await ctx.close();
  },

  async images(browser) {
    let { ctx, pg } = await open(browser, 'desk');
    await begin(pg);
    await seedImages(pg);
    await pg.click('[data-tab="images"]');
    await pg.waitForSelector('.set-card');
    await wait(pg, 800);
    await pg.evaluate(() => (document.querySelector('.img-guide').open = true));
    await snapEl(pg, '.img-guide', 'img-help');
    await pg.evaluate(() => (document.querySelector('.img-guide').open = false));
    await snapEl(pg, '.img-toolbar', 'img-toolbar');
    await snapEl(pg, '.set-card[data-set="female1"]', 'img-setcard');
    await ctx.close();

    ({ ctx, pg } = await open(browser));
    await begin(pg);
    await seedImages(pg);
    await pg.click('[data-tab="images"]');
    await pg.waitForSelector('.set-card');
    await wait(pg, 800);
    await snapEl(pg, '.set-card[data-set="shadow_male"]', 'img-shadow-card');
    await snapEl(pg, '.img[data-id="female1_neutral"]', 'img-framecard');
    await ctx.close();

    ({ ctx, pg } = await open(browser, 'wide'));
    await begin(pg);
    await seedImages(pg, true);
    await pg.click('[data-tab="images"]');
    await pg.waitForSelector('.set-card');
    await wait(pg, 1200);
    await pg.setViewportSize({ width: 900, height: 1426 });
    await pg.evaluate(() => document.querySelector('#v-images').scrollTo(0, 0));
    await snap(pg, 'images-pack');
    await pg.evaluate(text => {
      const card = document.querySelector('.set-card[data-set="female1"]');
      card.style.position = 'relative';
      const flags = card.querySelector('.flags');
      Object.assign(flags.style, { outline: '2px solid #f5b83d', outlineOffset: '4px', borderRadius: '6px' });
      const note = document.createElement('div');
      note.textContent = text.join('\n');
      Object.assign(note.style, {
        position: 'absolute',
        right: '24px',
        top: '84px',
        whiteSpace: 'pre',
        textAlign: 'right',
        color: '#f5b83d',
        font: '700 16px/1.35 sans-serif',
        textShadow: '0 1px 3px #000',
      });
      card.append(note);
    }, S.callout);
    await snapEl(pg, '.set-card[data-set="female1"]', 'img-shadow-callout');
    await ctx.close();
  },

  // every board and messenger look (settings boardStyle, chatStyle) with the same post and chat
  async styles(browser) {
    const { ctx, pg } = await open(browser);
    await begin(pg);
    await pg.evaluate(() => {
      const b = window.__R.board.widget;
      const post = { ...b.post, body: b.post.body.slice(0, 70) + '…' };
      window.__R.styles = { ...window.__R.board, widget: { ...b, posts: b.posts.slice(0, 2), post } };
    });
    await pg.setViewportSize({ width: 420, height: 3000 }); // the whole widget above the input bar
    for (const [cmd, scn, key, looks] of [
      [S.inputs.board, 'styles', 'boardStyle', ['dc', 'reddit', '5ch', 'nico']],
      [S.inputs.chatAgain, 'messenger', 'chatStyle', ['kakao', 'whatsapp', 'line']],
    ]) {
      await say(pg, cmd, scn, 1400);
      for (const look of looks) {
        await pg.evaluate(
          ([key, look]) => {
            DR.app.settings[key] = look;
            DR.renderLog('keep');
          },
          [key, look],
        );
        await wait(pg, 300);
        await snapEl(pg, '#log .w', `style-${look}`);
      }
    }
    await ctx.close();
  },

  // phone screens for posts elsewhere: the board and the messenger inside the chat, from the player's command down
  async promo(browser) {
    const { ctx, pg } = await open(browser);
    await begin(pg);
    await openScene(pg);
    await pg.evaluate(() => {
      const b = window.__R.board;
      window.__R.promo = { ...b, widget: { ...b.widget, posts: b.widget.posts.slice(0, 3) } };
    });
    const fromCommand = async name => {
      await pg.evaluate(() => {
        const u = [...document.querySelectorAll('#log .turn.u')].pop();
        document.querySelector('#log').scrollTop += u.getBoundingClientRect().top - 290;
      });
      await wait(pg, 400);
      await snap(pg, name);
    };
    await say(pg, S.inputs.board, 'promo', 1500);
    await fromCommand('promo-board');
    await say(pg, S.inputs.chat, 'messenger', 1500);
    await fromCommand('promo-chat');
    await ctx.close();
  },

  // One tall phone screen that tells the game in three beats: an offer with odds, the d100 deciding it, and the
  // forum reacting. English only (tools/shots/en.json replies hero1-3); saved as JPEG, since real art bands at 256 colors.
  async hero(browser) {
    if (!S.replies.hero1) return console.log('  (no hero scene for this language)');
    const ctx = await browser.newContext({
      locale: LOCALES[lang],
      viewport: { width: 420, height: 900 },
      deviceScaleFactor: 2,
    });
    const pg = await ctx.newPage();
    await pg.addInitScript(MOCK);
    await pg.goto(PAGE);
    await pg.waitForSelector('#rollBtn');
    await seed(pg);
    await begin(pg);
    await seedImages(pg, true);
    await pg.evaluate(rows => DR.app.images.push(...rows), HERO_ROWS);
    await say(pg, S.inputs.hero, 'hero1', 1500);
    await pg.evaluate(async () => {
      const t = DR.app.turns.at(-1);
      t.img = {
        scene: 'bg_gate-portal_night',
        char: 'hunter1_smirk',
        chars: [{ id: 'hunter1_smirk', npc: t.out.speaker }],
      };
      await DR.turnStore.update(t);
      DR.renderLog('keep');
    });
    await pg.evaluate(() => {
      window.__scn = 'hero2';
      DR.rnd = () => 0.22; // a 23: the map is real
    });
    await pg.click('#log .choices [data-choice]');
    await wait(pg, 2800);
    await seed(pg);
    await say(pg, S.inputs.heroBoard, 'hero3', 1500);
    // a viewport tall enough to show everything from the player's first line down, above the input bar
    const span = await pg.evaluate(() => {
      const log = document.querySelector('#log');
      const first = [...log.querySelectorAll('.turn.u')][0];
      const top = first.getBoundingClientRect().top - log.getBoundingClientRect().top + log.scrollTop;
      return { top, content: log.scrollHeight - top, chrome: window.innerHeight - log.clientHeight };
    });
    await pg.setViewportSize({ width: 420, height: Math.ceil(span.content + span.chrome + 12) });
    await pg.evaluate(top => (document.querySelector('#log').scrollTop = top - 8), span.top);
    await wait(pg, 600);
    await clean(pg);
    await pg.screenshot({ path: join(ROOT, 'docs', 'images', `promo-hero-${lang}.jpg`), type: 'jpeg', quality: 88 });
    console.log('  promo-hero');
    await ctx.close();
  },

  // Full-width (760 px, the app's column) at 2x for posts: the system boxes in any language; in English also the hero
  // scene's play screen and the status window over it, as JPEG for the real art.
  async pc(browser) {
    const ctx = await browser.newContext({
      locale: LOCALES[lang],
      viewport: { width: 760, height: 1300 },
      deviceScaleFactor: 2,
    });
    const pg = await ctx.newPage();
    await pg.addInitScript(MOCK);
    await pg.goto(PAGE);
    await pg.waitForSelector('#rollBtn');
    await seed(pg);
    await begin(pg);
    await seedImages(pg, true);
    await pg.evaluate(rows => DR.app.images.push(...rows), HERO_ROWS);
    await say(pg, S.inputs.walk, 'boxes', 1500);
    await snapEl(pg, '#log .turn .ai .body', 'pc-system');
    if (!S.replies.hero1) return ctx.close();
    await say(pg, S.inputs.hero, 'hero1', 1500);
    await pg.evaluate(async () => {
      const t = DR.app.turns.at(-1);
      t.img = {
        scene: 'bg_gate-portal_night',
        char: 'hunter1_smirk',
        chars: [{ id: 'hunter1_smirk', npc: t.out.speaker }],
      };
      await DR.turnStore.update(t);
      DR.renderLog('keep');
    });
    await pg.evaluate(() => {
      window.__scn = 'hero2';
      DR.rnd = () => 0.22;
    });
    await pg.click('#log .choices [data-choice]');
    await wait(pg, 2800);
    await seed(pg);
    // dir: docs/images for the guide, tests/shots/promo (not committed) for images only used in posts
    const shotFrom = async (text, name, dir = join(ROOT, 'docs', 'images')) => {
      const span = await pg.evaluate(text => {
        const log = document.querySelector('#log');
        const first = [...log.querySelectorAll('.turn.u')].filter(t => t.textContent.includes(text)).pop();
        const top = first.getBoundingClientRect().top - log.getBoundingClientRect().top + log.scrollTop;
        return { top, content: log.scrollHeight - top, chrome: window.innerHeight - log.clientHeight };
      }, text);
      await pg.setViewportSize({ width: 760, height: Math.ceil(span.content + span.chrome + 12) });
      await pg.evaluate(top => (document.querySelector('#log').scrollTop = top - 8), span.top);
      await wait(pg, 600);
      await clean(pg);
      mkdirSync(dir, { recursive: true });
      await pg.screenshot({ path: join(dir, `${name}-${lang}.jpg`), type: 'jpeg', quality: 90 });
      console.log('  ' + name);
    };
    await shotFrom(S.inputs.hero, 'pc-play');
    // the status window a few turns on: awakened, titled, with skills and a new quest (tools/shots/<lang>.json heroStatus)
    await pg.evaluate(h => {
      const s = DR.app.state;
      s.statusUnlocked = true;
      s.life.race = h.race;
      Object.assign(s.stats, {
        hp: 96,
        maxHp: 120,
        power: 340,
        fame: 45,
        str: 6,
        con: 7,
        agi: 9,
        int: 11,
        cha: 5,
        mag: 8,
      });
      s.energy = { name: h.energy, cur: 42, max: 60 };
      s.titles = h.titles.map(t => t[0]);
      s.titleFx = Object.fromEntries(h.titles);
      s.titlesOn = h.titlesOn.map(i => h.titles[i][0]);
      for (const k of h.skills) s.skills.push({ ...k, src: 'gained', ...(k.new ? { at: s.next } : {}) });
      s.quests.push({ ...h.quest, status: 'active' });
      s.stateNote = h.stateNote;
    }, S.heroStatus);
    await pg.setViewportSize({ width: 760, height: 1500 });
    await pg.click('#strip');
    await wait(pg, 900);
    await clean(pg);
    await pg.screenshot({ path: join(ROOT, 'docs', 'images', `pc-status-${lang}.jpg`), type: 'jpeg', quality: 90 });
    console.log('  pc-status');
    await closeSheet(pg);
    // the city reacting on every board look, then Mira's messages on every messenger look
    for (const look of ['reddit', '5ch', 'nico', 'dc']) {
      await say(pg, '/' + look, 'hero3', 1500);
      await shotFrom('/' + look, `pc-board-${look}`, PROMO);
    }
    for (const look of ['whatsapp', 'line', 'kakao']) {
      await pg.evaluate(l => (DR.app.settings.chatStyle = l), look);
      await say(pg, S.inputs.heroChat, 'heroChat', 1500);
      await shotFrom(S.inputs.heroChat, `pc-chat-${look}`, PROMO);
    }
    // the guild's quest board and the evening news, each in both of its looks
    for (const [scn, input, key, looks] of [
      ['heroQuest', S.inputs.quest, 'questStyle', ['board', 'ui']],
      ['heroNews', S.inputs.news, 'newsStyle', ['broadcast', 'paper']],
    ]) {
      if (!S.replies[scn]) continue;
      await say(pg, input, scn, 1500);
      for (const look of looks) {
        await pg.evaluate(
          ([k, l]) => {
            DR.app.settings[k] = l;
            DR.renderLog('keep');
          },
          [key, look],
        );
        await shotFrom(input, `pc-${scn === 'heroQuest' ? 'quest' : 'news'}-${look}`, PROMO);
      }
    }
    await ctx.close();
  },

  // the system boxes, a forum board and the status window in play
  async extra(browser) {
    let { ctx, pg } = await open(browser, 'mid');
    await begin(pg);
    await say(pg, S.inputs.walk, 'boxes', 1500);
    await snapEl(pg, '#log .turn .ai .body', 'system-boxes');
    const a = S.awaken;
    await pg.evaluate(
      ([a, lang]) => {
        const s = DR.app.state;
        Object.assign(s.life, { origin: a.origin, race: a.race, originTier: 'D' });
        s.stats.age = a.age;
        s.stats.gold = a.gold;
        s.statusUnlocked = false;
        s.clock = { day: 0, date: DR.fmtKDate(a.date, lang), time: a.time, weather: a.weather, place: a.place };
        s.skills = [{ ...a.skill, lv: 1, src: 'talent' }];
        s.quests = a.quests.map(q => ({ ...q, status: 'active' }));
        s.stateNote = a.stateNote;
        s.titles = [];
        s.titlesOn = [];
      },
      [a, lang],
    );
    await pg.click('#strip');
    await wait(pg, 700);
    await snapEl(pg, '#sheetInner .sw', 'status-awaken');
    await ctx.close();

    ({ ctx, pg } = await open(browser, 'wide'));
    await begin(pg);
    await say(pg, S.inputs.board, 'board', 1500);
    await pg.evaluate(() => {
      const w = [...document.querySelectorAll('#log .w')].pop();
      document.querySelector('#log').scrollTop += w.getBoundingClientRect().top - 140;
    });
    await wait(pg, 400);
    await snap(pg, 'board-dc');
    await ctx.close();
  },
};

const PAGE = process.env.DR_URL || pathToFileURL(writePage((await build()).html)).href;
const browser = await chromium.launch();
for (const g of only.length ? only : Object.keys(GROUPS)) {
  console.log(g);
  try {
    await GROUPS[g](browser);
  } catch (e) {
    console.log(`  ${g} failed:`, e.message.split('\n')[0]);
    process.exitCode = 1;
  }
}
await browser.close();
siteSizes();
