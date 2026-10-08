// money and age changes show their amounts in the chips even before awakening; hidden stats stay arrows
import { test, expect } from './support/test.js';
import { claudeMock, startLife } from './support/harness.js';

const A =
  "async()=>({admin:'',narration:'은닉금을 꺼낸다.',system:[],choices:['a'],stat_changes:{gold:65000,str:1},reasons:{gold:'보관함에서 꺼냄'},clock:{days_passed:0},memory:{},dead:false})";

// a new life, one turn with reply A, and the chips under it
async function chipsAfterTurn(game, answer) {
  const { pg, errs } = await game(claudeMock(answer), { size: [1280, 720] });
  await pg.waitForTimeout(500);
  await startLife(pg);
  await pg.evaluate('DR.statusVisible=()=>false;0');
  const n0 = await pg.evaluate('DR.app.turns.length');
  await pg.fill('#input', '꺼낸다');
  await pg.press('#input', 'Enter');
  await pg.waitForFunction(
    `DR.app.turns.length>=${n0}+2&&DR.isIdle()&&(()=>{const t=[...document.querySelectorAll('.turn')].slice(-1)[0];return t&&t.querySelectorAll('.deltas span').length>0})()`,
    null,
    { timeout: 15000 },
  );
  const chips = await pg.evaluate(
    "[...[...document.querySelectorAll('.turn')].slice(-1)[0].querySelectorAll('.deltas span')].map(e=>e.textContent)",
  );
  return { pg, errs, chips };
}

test('money chip', async ({ game }) => {
  const { pg, errs, chips } = await chipsAfterTurn(game, A);
  console.log('chips before awakening:', chips);
  const life = await pg.evaluate(
    '[DR.app.state.life.world.id,DR.app.state.rules&&DR.app.state.rules.dice,JSON.stringify(DR.app.turns[DR.app.turns.length-1].deltas)]',
  );
  const ok = chips.some(c => '소지금 +65,000원' === c) && !chips.some(c => c.startsWith('근력') && /[+-]\d/.test(c)); // a hidden stat may show an arrow or a growth cooldown, never a number
  if (!ok) errs.push('chips wrong: ' + JSON.stringify(chips) + ' life ' + JSON.stringify(life));
  expect(errs).toEqual([]);
});

// the player asked for another currency: the narrator renames it and the amount stays; a life from before 2.10 is in won
test('money unit from the narrator', async ({ game }) => {
  const { pg, errs, chips } = await chipsAfterTurn(game, A.replace('stat_changes:', "money_unit:'금화',stat_changes:"));
  if (!chips.includes('소지금 +65,000금화')) errs.push('chips: ' + JSON.stringify(chips));
  if ((await pg.evaluate('DR.app.state.life.unit')) !== '금화') errs.push('unit not kept');
  const old = await pg.evaluate("DR.currencyOf({ world: { id: 'hunter' } })");
  if (old[0] !== 'won' || old[1] !== 1000) errs.push('old life: ' + JSON.stringify(old));
  expect(errs).toEqual([]);
});

// converting on the player's word: money_rate (new per old) multiplies what they hold, once
test('money conversion from the narrator', async ({ game }) => {
  const once = A.replace(
    'async()=>({',
    "async()=>({...(window.__conv=(window.__conv||0)+1)>1?{money_unit:'엔',money_rate:0.1}:{},",
  );
  const { pg, errs, chips } = await chipsAfterTurn(game, once);
  const s = await pg.evaluate(() => ({ gold: DR.app.state.stats.gold, unit: DR.app.state.life.unit }));
  if (s.unit !== '엔') errs.push('unit: ' + s.unit);
  const [, before, after] = chips.join(' ').match(/소지금: ([\d,]+)원 → ([\d,]+)엔/) || [];
  const num = x => Number(String(x).replace(/,/g, ''));
  if (!before || Math.round(num(before) * 0.1) !== num(after) || num(after) !== s.gold)
    errs.push(`converted ${before} → ${after}, gold ${s.gold}, chips ${JSON.stringify(chips)}`);
  expect(errs).toEqual([]);
});
