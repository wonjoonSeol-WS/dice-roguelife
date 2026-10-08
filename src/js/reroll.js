/* ============ reroll & fork ============ */
import { $, clone, cutLine, noteIgnored, nowIso, toast, uid } from './util.js';
import { cmdIs, currencyOf, moneyText } from './data.js';
import { dset } from './db.js';
import { turnStore } from './turn-store.js';
import { app, currentRun, exclusive, isIdle } from './app.js';
import { compat } from './compat.js';
import { answerDialog, askConfirm, askPrompt, openDialog } from './sheet.js';
import { openSave, persist, storeError } from './persistence.js';
import { renderStrip } from './status.js';
import { renderLog } from './log.js';
import { parseCmd } from './composer.js';
import { lifeExtra, runTurn } from './turn.js';
import { fillTemplate, pl, pr } from './prompt.js';
import { N_, T, tIn } from './i18n.js';
import { storyLang } from './settings.js';

// A rewrite takes the last reply back and asks again with the same line, dice and fate. It may carry a fix:
//   reason     what was wrong, told to the narrator for this reply
//   remember   also keep the reason in the corrections the next replies see
//   noCheck    the line should never have been a check: drop its die
//   objection  the upheld /판정 this rewrite answers, kept on the new reply
const REROLL_REASONS = [
  ['impersonate', N_("Decided my character's lines, feelings or actions")],
  ['hostile', N_('Read my words in bad faith')],
  ['stall', N_('The story stalled')],
  ['repeat', N_('Repeated the last turn')],
  ['lore', N_('Contradicted the lore or memory')],
  ['custom', N_('Write my own')],
];
// prompt text, given to the narrator with pl()
const REASON_TEXT = {
  impersonate: N_(
    "The narrator decided the player character's feelings and actions. Use only the lines and actions in the player's input for the player character.",
  ),
  hostile: N_(
    "The narrator read the player's words in bad faith. Read the player's input literally and in good faith.",
  ),
  stall: N_('The story did not move. This time, clearly move events one step forward and offer new choices.'),
  repeat: N_('The reply repeated the last turn. Write new developments and new lines.'),
  lore: N_(
    'The reply contradicted the lore or memory. Check the related lore, relationships and story summary again and match them.',
  ),
};
export async function rerollWithReason() {
  if (!isIdle()) return;
  const last = app.turns[app.turns.length - 1];
  if (!last || last.kind !== 'ai') return;
  const answer = openDialog(
    `<h3>${T('Rewrite')}</h3><p class="muted sheet-intro">${T('Pick the problem: the last reply is rolled back and written again with that fixed.')}</p><div class="choices">${REROLL_REASONS.map(([k, l]) => `<button data-rr="${k}">${T(l)}</button>`).join('')}<button data-rr="" class="fu">${T('Just rewrite, no reason')}</button></div>`,
  );
  $('#sheetInner')
    .querySelectorAll('[data-rr]')
    .forEach(b => (b.onclick = () => answerDialog(b.dataset.rr)));
  const pick = await answer;
  if (pick === null) return;
  let reason = '';
  if (pick === 'custom') {
    const t = await askPrompt(T('What was wrong?'));
    if (t === null) return;
    reason = t.trim();
  } else if (pick) reason = REASON_TEXT[pick] ? pl(REASON_TEXT[pick]) : '';
  await reroll({ reason, remember: true });
}
export function applyErratum(fact, ago, remember, fix, q, out) {
  /* an error some replies back: the record stays, the state is put right now, and the next reply mends the story */
  const replies = app.turns.filter(t => t.kind === 'ai' && !(t.out && t.out.judge));
  const target = replies[replies.length - 1 - ago] || null;
  const notes = applyFix(fix);
  if (target) {
    target.errata = { fact, q };
    turnStore.update(target).catch(e => noteIgnored('reroll: turnStore.update', e));
  }
  if (remember) {
    app.state.corrections = (app.state.corrections || []).filter(c => c.until >= app.state.next);
    app.state.corrections.push({
      text: pl('Contradicted the lore or memory: {fact}', { fact }),
      until: app.state.next + 10,
    });
    app.state.corrections = app.state.corrections.slice(-3);
  }
  app.state.errataNote = fact;
  out.narration =
    String(out.narration || '') +
    '\n\n' +
    tIn(storyLang(), '[ Correction applied: {what} ]', { what: notes.length ? notes.join(', ') : fact.slice(0, 60) });
  toast(T('Corrected and applied to the current state'), 3500);
}
export function seenSpan(name) {
  const m = ((app.state && app.state.meta) || {})[name];
  if (!m || m.l == null) return '';
  const ago = (app.state.next || 0) - m.l;
  const last = ago <= 0 ? T('now') : T('{n} {n|turn|turns} ago', { n: ago });
  const span = m.f === m.l ? T('turn {n}', { n: m.f }) : T('turns {a}-{b}', { a: m.f, b: m.l });
  return `<span class="muted seen-span">${span}${ago > 0 ? ', ' + last : ''}</span>`;
}
function applyFix(fix) {
  const notes = [];
  if (!fix || typeof fix !== 'object') return notes; /* only bounded, plausible corrections */
  const cf = currencyOf(app.state.life)[1];
  const cap = Math.max(1, 1000 * cf, Math.abs(app.state.stats.gold || 0) * 2);
  const g = Math.round(Number(fix.gold) || 0);
  if (g && Math.abs(g) <= cap) {
    app.state.stats.gold = Math.max(0, (app.state.stats.gold || 0) + g);
    notes.push(
      tIn(storyLang(), 'Money {delta}', { delta: (g > 0 ? '+' : '') + moneyText(g, app.state.life, storyLang()) }),
    );
  }
  for (const it of (Array.isArray(fix.items) ? fix.items : []).slice(0, 6)) {
    const name = String((it && it.name) || '')
      .trim()
      .slice(0, 30);
    const q = Math.round(Number(it && it.qty) || 0);
    if (!name || !q || Math.abs(q) > 20) continue;
    const ex = (app.state.items || []).find(x => x.name === name);
    if (q > 0) {
      if (ex) ex.qty = (ex.qty || 1) + q;
      else
        (app.state.items = app.state.items || []).push({
          name,
          qty: q,
          grade: 'F',
          note: String(it.note || '').slice(0, 60),
          slot: null,
          power: 0,
        });
      notes.push(`${name} +${q}`);
    } else if (ex) {
      const take = Math.min(ex.qty || 1, -q);
      ex.qty = (ex.qty || 1) - take;
      if (ex.qty <= 0) app.state.items = app.state.items.filter(x => x !== ex);
      notes.push(`${name} -${take}`);
    }
  }
  if (fix.ledger && typeof fix.ledger === 'object') {
    app.state.ledger = app.state.ledger || {};
    for (const [k0, v] of Object.entries(fix.ledger).slice(0, 4)) {
      const k = String(k0).trim().slice(0, 30);
      if (!k) continue;
      if (v === null || v === '') {
        if (k in app.state.ledger) {
          delete app.state.ledger[k];
          notes.push(tIn(storyLang(), 'Ledger closed: {entry}', { entry: k }));
        }
      } else {
        app.state.ledger[k] = cutLine(v, 60);
        notes.push(tIn(storyLang(), 'Ledger: {entry}', { entry: k }));
      }
    }
  }
  for (const r of (Array.isArray(fix.relations) ? fix.relations : []).slice(0, 3)) {
    if (r && r.name) {
      app.state.relations[String(r.name).slice(0, 30)] = String(r.note || '').slice(0, 200);
      notes.push(tIn(storyLang(), 'Relationship: {name}', { name: String(r.name).slice(0, 20) }));
    }
  }
  return notes;
}
export async function upholdObjection(fact, judge, { remember, noCheck }) {
  // the record proves the last reply wrong: the /판정 line and that reply go, and the reply is written again with the fact (its outcome stays)
  const run = currentRun();
  const ju = app.turns[app.turns.length - 1];
  if (ju && ju.kind === 'user') {
    try {
      await turnStore.popTail(ju.i);
    } catch (e) {
      await storeError(e);
      return;
    }
    if (!run || run.abandoned) return;
    app.turns.pop();
    app.state.next = ju.i;
    await persist();
    if (!app.state || run.abandoned) return;
  }
  toast(T('Objection upheld. Rewriting.'), 3500);
  renderLog('keep');
  // only a lasting fact goes into the corrections kept for the next turns; a passing detail fixes this reply and nothing more
  await rewriteLast({
    reason: pl('Contradicted the lore or memory: {fact}', { fact }),
    remember,
    noCheck,
    objection: Object.assign({ fact }, judge || {}),
  });
}
export function reroll(fix) {
  return exclusive(() => rewriteLast(fix));
}
// the rewrite itself, inside an action that already holds the game (reroll, or a /판정 reply being handled)
async function rewriteLast(fix = null, again = false) {
  const run = currentRun();
  const last = app.turns[app.turns.length - 1];
  if (!last || last.kind !== 'ai') return;
  const prevUser = [...app.turns].reverse().find(t => (t.kind === 'user' || t.kind === 'system') && t.i < last.i);
  if (prevUser && prevUser.kind === 'system') {
    await rerollIntro(last, prevUser, fix);
    return;
  }
  const prevSnap = [...app.turns].reverse().find(t => t.snap && t.i < last.i);
  if (!prevSnap) {
    toast(T('Nothing to roll back to'));
    return;
  }
  try {
    await turnStore.popTail(last.i);
  } catch (e) {
    if (e && e.code === 'conflict' && !again) {
      const want = { i: last.i, at: last.at };
      await storeError(e);
      const now = app.turns[app.turns.length - 1]; // another device or tab moved this save on: reload, then carry on only if the same reply is still the last
      if (now && now.kind === 'ai' && now.i === want.i && now.at === want.at) {
        toast(T('Loaded the latest; continuing the rewrite'));
        return rewriteLast(fix, true);
      }
      toast(T('The story moved on somewhere else, so the rewrite stopped. Press it again on the latest screen'), 4500);
      return;
    }
    await storeError(e);
    return;
  }
  if (!run || run.abandoned) return; // the save was left during the rollback
  app.turns.pop();
  const tn = app.state.turnNo,
    pc = parseCmd(prevUser.text || ''),
    counted = !cmdIs(pc, 'browse');
  const next = app.state.next - 1;
  app.state = compat(clone(prevSnap.snap));
  app.state.next = next;
  if (app.state.turnNo == null && tn != null) app.state.turnNo = Math.max(0, tn - (counted ? 1 : 0)); // an older snapshot without the count takes it from before
  await persist();
  if (run.abandoned) return;
  renderStrip();
  const noCheck = !!(fix && fix.noCheck);
  if (noCheck) prevUser.roll = null; /* an upheld objection said this should never have been a check */
  prevUser.req = uid();
  turnStore.update(prevUser).catch(e => noteIgnored('reroll: turnStore.update', e));
  let r = noCheck ? null : prevUser.roll || null;
  if (r && !r.fixed) r = r.p != null ? Object.assign({}, r, { fixed: true }) : null; // a rewrite fixes the prose, not the outcome: the first answer's chance and result stand, and a turn judged without a check stays without one
  await runTurn(prevUser.text, parseCmd(prevUser.text), {
    run,
    roll: r,
    req: prevUser.req,
    luck: prevUser.luck || null,
    fate: prevUser.fate || null,
    fix,
  });
}
async function rerollIntro(last, sys, fix) {
  const run = currentRun();
  try {
    await turnStore.popTail(last.i);
  } catch (e) {
    await storeError(e);
    return;
  }
  if (!run || run.abandoned) return;
  app.turns.pop();
  const next = app.state.next - 1;
  app.state = compat(clone(sys.snap));
  app.state.next = next;
  app.state.introReq = uid();
  app.state.introText =
    app.state.introText ||
    fillTemplate(pr('intro'), {
      extra: lifeExtra(app.state.life),
      opening: '',
      world: app.state.life.world.name,
      race: app.state.life.race,
      origin: app.state.life.origin,
      originTier: app.state.life.originTier,
      talent: app.state.life.talent.name,
      talentTier: app.state.life.talentTier,
    });
  await persist();
  if (run.abandoned) return;
  renderStrip();
  await runTurn(app.state.introText, null, { run, intro: true, fix });
}
export async function fork(i) {
  if (!isIdle()) return;
  const t = app.turns.find(x => x.i === i);
  if (!t || !t.snap) {
    toast(T("You can't branch from here"));
    return;
  }
  if (!(await askConfirm(T('Start a new branch from this point? The original record stays as it is.')))) return;
  await exclusive(() => makeBranch(t, i));
}
// a new save holding the rows up to turn i and the state saved with it; the original is not touched
async function makeBranch(t, i) {
  const parent = Object.assign(
    { id: app.currentSave.id, name: app.currentSave.name, turn: i },
    t.snap.turnNo != null ? { turnNo: t.snap.turnNo } : {},
  );
  const meta = {
    id: uid(),
    name: T('{name} (branch)', { name: app.currentSave.name }),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    parent,
    lifeNo: t.snap.lifeNo,
    turns: i + 1,
    store: 2,
    pages: 0,
  };
  toast(T('Copying the branch...'));
  try {
    meta.pages = await turnStore.copyUpTo(app.currentSave.id, meta.id, i);
  } catch (e) {
    await storeError(e);
    return;
  }
  const st = compat(clone(t.snap));
  st.next = i + 1;
  await dset(`states/items/${meta.id}`, st);
  await dset(`saves/items/${meta.id}`, meta);
  app.saves.unshift(meta);
  await openSave(meta.id, { keepAction: true });
  toast(T('Continuing in the new branch'));
}
