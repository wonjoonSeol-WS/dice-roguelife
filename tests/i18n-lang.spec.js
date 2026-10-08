// An English or Japanese browser gets the game in its language: screens, a new life, the narrator's prompt.
import { test, expect } from './support/test.js';
import { check, claudeMock, startLife } from './support/harness.js';

const answer = (narration, choice, time) =>
  `async(p)=>{(window.__prompts=window.__prompts||[]).push(p);return {admin:'...',narration:${JSON.stringify(narration)},system:[],choices:[${JSON.stringify(choice)},'...'],stat_changes:{gold:10},reasons:{gold:'.'},clock:{days_passed:0,time:${JSON.stringify(time)}},memory:{},dead:false}}`;

const LANGS = [
  {
    lang: 'en',
    locale: 'en-US',
    saves: 'Saves',
    answer: answer('You wake up in an alley.', 'Run (success chance 60%)', '9:10 PM'),
    world: /^Modern Hunter$/,
    money: 'dollars',
    unit: / dollars/,
  },
  {
    lang: 'ja',
    locale: 'ja-JP',
    saves: 'セーブ',
    answer: answer('路地裏で目を覚ます。', '走る（成功率 60%）', '午後9時10分'),
    world: /^現代ハンターもの$/,
    money: 'yen',
    unit: /円|yen/,
  },
];

// Hangul in text or attributes a player can see (language pickers excepted: they name each language in itself)
const hangulOnScreen = pg =>
  pg.evaluate(() => {
    const out = [];
    const visible = el => {
      if (!el || el.closest('select,script,style,.hidden')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());)
      if (/[가-힣]/.test(n.nodeValue) && visible(n.parentElement)) out.push(n.nodeValue.trim().slice(0, 50));
    for (const el of document.querySelectorAll('[placeholder],[aria-label],[title]'))
      for (const a of ['placeholder', 'aria-label', 'title'])
        if (/[가-힣]/.test(el.getAttribute(a) || '') && visible(el)) out.push(`${a}: ${el.getAttribute(a)}`);
    return out;
  });

for (const L of LANGS)
  test(`${L.lang} player`, async ({ game }) => {
    const { pg, errs } = await game(claudeMock(L.answer), { locale: L.locale });
    await pg.waitForSelector('#rollBtn');
    check(errs, `the page is in ${L.lang}`, (await pg.evaluate('document.documentElement.lang')) === L.lang);
    check(errs, 'the tabs are translated', (await pg.textContent('nav.tabs [data-tab="saves"]')) === L.saves);
    let ko = await hangulOnScreen(pg);
    check(errs, `new life form has no Korean: ${ko.join(' | ')}`, ko.length === 0);

    await startLife(pg, { name: 'Jin', dice: true });
    await pg.waitForTimeout(800);
    const life = await pg.evaluate('DR.app.state.life');
    check(errs, `the life is written in ${L.lang}: ${life.world.name}`, L.world.test(life.world.name));
    check(errs, 'no Korean in the life', !/[가-힣]/.test(JSON.stringify(life)));
    check(errs, 'gender is stored as an enum', life.gender === 'male');
    check(errs, `a modern world pays in the story's money: ${life.money}`, life.money === L.money);
    ko = await hangulOnScreen(pg);
    check(errs, `play screen has no Korean: ${ko.join(' | ')}`, ko.length === 0);
    check(errs, "the choice's chance is read", (await pg.textContent('#log')).includes('60%'));

    const prompt = await pg.evaluate('(window.__prompts||[]).slice(-1)[0]||""');
    const promptKo = (prompt.match(/[^\n]*[가-힣][^\n]*/g) || []).slice(0, 3);
    check(errs, `the narrator's prompt has no Korean: ${promptKo.join(' | ')}`, prompt.length > 0 && !promptKo.length);
    check(errs, 'the prompt is the English one', prompt.includes('Rules:') && prompt.includes('[World]'));
    check(errs, "the prompt counts money in the story's unit", L.unit.test(prompt));
    if (L.lang === 'ja') check(errs, 'a Japanese story is told to write in Japanese', prompt.includes('[言語]'));

    await pg.click('#gearBtn');
    await pg.waitForTimeout(300);
    ko = await hangulOnScreen(pg);
    check(errs, `settings have no Korean: ${ko.join(' | ')}`, ko.length === 0);
    await pg.click('#sheetInner [data-close]');

    for (const tab of ['saves', 'memory', 'images', 'hall']) {
      await pg.click(`nav.tabs [data-tab="${tab}"]`);
      await pg.waitForTimeout(500);
      ko = await hangulOnScreen(pg);
      check(errs, `${tab} tab has no Korean: ${ko.join(' | ')}`, ko.length === 0);
    }
    await pg.click('nav.tabs [data-tab="play"]');

    await pg.click('#gearBtn');
    await pg.selectOption('#uiLangSel', 'ko');
    await pg.waitForTimeout(300);
    check(
      errs,
      'switching to Korean redraws the tabs and keeps the choice',
      (await pg.textContent('nav.tabs [data-tab="saves"]')) === '저장' &&
        (await pg.evaluate('DR.app.settings.uiLang')) === 'ko',
    );
    expect(errs).toEqual([]);
  });

test('returning korean player on an english browser stays korean', async ({ game }) => {
  const { pg, errs } = await game(
    claudeMock(undefined, { before: "__store.set('data/users/u_test/settings',{tier:'default'});" }),
    { locale: 'en-US' },
  );
  await pg.waitForSelector('#rollBtn');
  await pg.waitForTimeout(300);
  check(errs, 'screen is Korean', (await pg.textContent('nav.tabs [data-tab="play"]')) === '플레이');
  check(errs, 'uiLang resolved to ko', (await pg.evaluate('DR.app.settings.uiLang')) === 'ko');
  expect(errs).toEqual([]);
});

test('changing the language on a rolled fate keeps the form and the fate', async ({ game }) => {
  const { pg, errs } = await game(claudeMock(), { locale: 'en-US' });
  await pg.waitForSelector('#rollBtn');
  await pg.fill('#nm', 'Jin');
  await pg.click('#gseg [data-g="female"]');
  await pg.click('[data-w="murim"]');
  await pg.click('#rollBtn');
  await pg.waitForTimeout(1500);
  const before = await pg.evaluate('JSON.stringify(DR.app.pendingRoll.life)');
  await pg.selectOption('#nlLang', 'ko');
  await pg.waitForTimeout(300);
  check(errs, 'the form is Korean', (await pg.textContent('#rollBtn')).includes('운명'));
  check(errs, 'the fate is the same', (await pg.evaluate('JSON.stringify(DR.app.pendingRoll.life)')) === before);
  check(errs, 'the fate cards are shown', (await pg.locator('#fate .card').count()) >= 4);
  check(errs, 'gender stays female', (await pg.getAttribute('#gseg [data-g="female"]', 'aria-pressed')) === 'true');
  check(errs, 'world stays murim', (await pg.getAttribute('[data-w="murim"]', 'aria-pressed')) === 'true');
  check(errs, 'the name stays', (await pg.inputValue('#nm')) === 'Jin');
  expect(errs).toEqual([]);
});
