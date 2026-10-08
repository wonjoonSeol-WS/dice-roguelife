// money and age changes show their amounts in the chips even before awakening; hidden stats stay arrows
import { test, expect } from './support/test.js';
import { check, claudeMock, startLife } from './support/harness.js';

const A =
  "async()=>({admin:'',narration:'은닉금을 꺼낸다.',system:[],choices:['a'],stat_changes:{gold:65000,str:1},reasons:{gold:'보관함에서 꺼냄'},clock:{days_passed:0},memory:{},dead:false})";

// a new life answered by reply `answer`
async function startGame(game, answer) {
  const { pg, errs } = await game(claudeMock(answer), { size: [1280, 720] });
  await pg.waitForTimeout(500);
  await startLife(pg);
  await pg.evaluate('DR.statusVisible=()=>false;0');
  return { pg, errs };
}
// one turn, and the chips under it
async function chipsAfter(pg, text) {
  const n0 = await pg.evaluate('DR.app.turns.length');
  await pg.fill('#input', text);
  await pg.press('#input', 'Enter');
  await pg.waitForFunction(
    `DR.app.turns.length>=${n0}+2&&DR.isIdle()&&(()=>{const t=[...document.querySelectorAll('.turn')].slice(-1)[0];return t&&t.querySelectorAll('.deltas span').length>0})()`,
    null,
    { timeout: 15000 },
  );
  return pg.evaluate(
    "[...[...document.querySelectorAll('.turn')].slice(-1)[0].querySelectorAll('.deltas span')].map(e=>e.textContent)",
  );
}

test('money chip', async ({ game }) => {
  const { pg, errs } = await startGame(game, A);
  const chips = await chipsAfter(pg, '꺼낸다');
  console.log('chips before awakening:', chips);
  const life = await pg.evaluate(
    '[DR.app.state.life.world.id,DR.app.state.rules&&DR.app.state.rules.dice,JSON.stringify(DR.app.turns[DR.app.turns.length-1].deltas)]',
  );
  const ok = chips.some(c => '소지금 +65,000원' === c) && !chips.some(c => c.startsWith('근력') && /[+-]\d/.test(c)); // a hidden stat may show an arrow or a growth cooldown, never a number
  if (!ok) errs.push('chips wrong: ' + JSON.stringify(chips) + ' life ' + JSON.stringify(life));
  expect(errs).toEqual([]);
});

// the player asks for another currency: the narrator renames it (the amount stays), then converts at 0.1 before
// the reply's own money moves; the narrator's history shows the change; the same request echoed later converts
// nothing; a life from before 2.10 is in won
test('money unit and conversion from the narrator', async ({ game }) => {
  const asked = A.replace(
    'async()=>({',
    "async(p)=>(window.__p=p,{...(/환전/.test(p)?{money_unit:'엔',money_rate:0.1}:/금화/.test(p)?{money_unit:'금화'}:{}),",
  );
  const { pg, errs } = await startGame(game, asked);
  const renamed = await chipsAfter(pg, '금화로 세 줘');
  check(errs, `renamed, the amount kept: ${renamed}`, renamed.includes('소지금 +65,000금화'));
  check(
    errs,
    'a note shows the rename',
    renamed.some(c => /^소지금: [\d,]+원 → [\d,]+금화$/.test(c)),
  );
  const gold1 = await pg.evaluate('DR.app.state.stats.gold');
  const converted = await chipsAfter(pg, '엔으로 환전해 줘');
  const gold2 = await pg.evaluate('DR.app.state.stats.gold');
  check(errs, `converted at 0.1, then +65,000엔: ${gold1} -> ${gold2}`, gold2 === Math.round(gold1 * 0.1) + 65000);
  check(errs, `the turn's gain is in yen: ${converted}`, converted.includes('소지금 +65,000엔'));
  check(
    errs,
    'a note shows the conversion',
    converted.some(c => /^소지금: [\d,]+금화 → [\d,]+엔$/.test(c)),
  );
  // the history still holds the request, so the mock sends money_unit '엔' and money_rate 0.1 again
  await chipsAfter(pg, '또 꺼낸다');
  const gold3 = await pg.evaluate('DR.app.state.stats.gold');
  check(errs, `the echoed request converts nothing: ${gold2} -> ${gold3}`, gold3 === gold2 + 65000);
  const prompt = await pg.evaluate('window.__p');
  check(errs, "the narrator's history shows the conversion", /소지금: [\d,]+금화 → [\d,]+엔/.test(prompt));
  const old = await pg.evaluate("DR.currencyOf({ world: { id: 'hunter' } })");
  check(errs, `a life from before 2.10 is in won: ${old}`, old[0] === 'won' && old[1] === 1000);
  expect(errs).toEqual([]);
});
