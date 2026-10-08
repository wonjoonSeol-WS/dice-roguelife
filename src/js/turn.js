/* ============ turn engine ============ */
import { clone, noteIgnored, pick, rnd, shortWhat, toast, uid } from './util.js';
import { isPivotal, matchOdds, mentionsStars, stripOdds } from './reply-words.js';
import { askOf, cmdIs, normEmo } from './data.js';
import { ENTRY_LABEL, STANCE_LABEL } from './enums.js';
import { T } from './i18n.js';
import { platform } from './db.js';
import { NEW_SAVES, turnStore } from './turn-store.js';
import { app, currentRun, exclusive } from './app.js';
import { critOf, rollGrade, rule } from './rules.js';
import { aliasOut } from './people.js';
import { cueDeath, cueDoom, cueFanfare, cueItem, cueQuest, cueRealm, cueReveal, cueSkill } from './sound.js';
import { ensureSample } from './boot.js';
import { imgUrl, pickEmotion } from './images.js';
import { resolveScene } from './places.js';
import { aiWillPick, castFor, earlyCast, presentOf, resolveAiPicks, startAiPick, takePromoted } from './casting.js';
import { closeGone, openSave, persist, pushTurn, staleSave, storeError } from './persistence.js';
import { openStatus, renderStrip } from './status.js';
import { adminFace, countInputHint, renderLog, showLiveReply } from './log.js';
import { fitInput, input, offerInput, parseCmd, saveDraft, setSendMode } from './composer.js';
import { applyOut } from './apply.js';
import { callNarrator, peekReply, pl, plLabel } from './prompt.js';
import { applyErratum, upholdObjection } from './reroll.js';
import { maybeSummarize } from './summaries.js';

function offeredChoices() {
  const lastAi = [...app.turns].reverse().find(t => t.kind === 'ai' && t.out && !t.out.judge);
  return (lastAi && lastAi.out.choices) || [];
}
function makeRoll(text) {
  // one d100 per turn position; an offered choice sent as-is fixes the chance, anything else is judged by the narrator
  if (rule('dice') === false) return { text, roll: null };
  const memo = app.state.rollMemo && app.state.rollMemo.at === app.state.next ? app.state.rollMemo.roll : null;
  const d = memo && memo.d != null ? memo.d : 1 + Math.floor(rnd() * 100);
  const norm = x => String(x).replace(/\s+/g, '');
  const pick = offeredChoices().find(c => norm(c) === norm(text) || norm(stripOdds(c)) === norm(text));
  if (pick) {
    const m = matchOdds(pick);
    if (m) {
      const p = Math.max(1, Math.min(99, m.p));
      const r = {
        d,
        p,
        ok: d <= p,
        pivotal: isPivotal(m.rest),
        fixed: true,
        what: shortWhat(stripOdds(pick)),
      };
      r.crit = critOf(r);
      return { text: stripOdds(text).trim() || text, roll: r };
    }
  }
  return { text: matchOdds(text) ? stripOdds(text).trim() : text, roll: { d, p: null } }; // a chance the player wrote is not binding
}
export let showDice = function showDice(r) {
  return new Promise(res => {
    if (!r || !r.crit) {
      res();
      return;
    }
    const key = x => [x.name, ...(x.tags || [])].join(' ').toLowerCase();
    const fx = app.images.filter(x => x.kind === 'fx' && !x.off && /dice/.test(key(x)));
    const okRe = /succ|crit|win|high|(^|[^0-9])20($|[^0-9])/,
      badRe = /fail|lose|low|(^|[^0-9])1($|[^0-9])/;
    const good = fx.filter(x => (r.ok ? okRe : badRe).test(key(x)));
    const neutral = fx.filter(x => !okRe.test(key(x)) && !badRe.test(key(x)));
    const pic = good.length ? pick(good) : neutral.length ? pick(neutral) : fx.length ? pick(fx) : null; // name or tags: dice_success / dice_high / dice20 win, dice_fail / dice_low / dice1 lose
    const face = !pic ? adminFace(r.ok ? 'joy' : 'smirk') : null;
    const label = { critSuccess: 'CRITICAL SUCCESS', success: 'SUCCESS', fail: 'FAIL', critFail: 'CRITICAL FAIL' }[
      rollGrade(r)
    ];
    const el = document.createElement('div');
    el.className = 'dice-ov ' + (r.ok ? 'ok' : 'bad');
    el.innerHTML = `<div class="box"><div class="die">${pic ? `<img alt="" src="${imgUrl(pic.id)}">` : face ? `<img alt="" src="${imgUrl(face.id)}" class="round-face">` : `<div class="d20">${r.d}</div>`}</div>${pic || face ? `<div class="num">${r.d}</div>` : ''}<div class="lbl">${label}</div><div class="sub">${T('Needs {p} or less: 🎲 {d} (lower is better)', { p: r.p, d: r.d })}</div></div>`;
    document.body.appendChild(el);
    try {
      r.ok ? cueFanfare() : cueDeath();
    } catch {
      // sound is decoration: it never stops the dice reveal
    }
    const done = () => {
      el.remove();
      res();
    };
    el.onclick = done;
    setTimeout(done, 2600);
  });
};
export function send(text) {
  if (!app.state || app.state.dead) return;
  return exclusive(() => sendInner(text));
}
async function sendInner(text) {
  const run = currentRun();
  const raw = text;
  const cmd = parseCmd(text);
  if (cmd && cmd.type === 'status') {
    openStatus();
    return;
  }
  if (cmd && cmd.type === 'gallery' && (cmd.id === 'star' || mentionsStars(cmd.arg || ''))) {
    if (!app.state.life.sponsor) {
      toast(T('This world has no constellations'));
      return;
    }
    if (!app.state.channelOpen) {
      toast(
        T(
          "The constellations aren't watching you yet. You can see them once an awakening or a big event opens the channel",
        ),
        4500,
      );
      return;
    }
  }
  if (app.currentSave && !NEW_SAVES.has(app.currentSave.id)) {
    const st = await staleSave(app.currentSave.id);
    if (st) {
      offerInput(raw);
      if (st === 'gone') closeGone(app.currentSave.id, T('This save was deleted somewhere else, so it was closed'));
      else {
        toast(T('This save changed somewhere else, so the latest was loaded. Please send again'), 4500);
        await openSave(app.currentSave.id);
      }
      return;
    }
  }
  if (!run || run.abandoned) return; // the save was left while it was being checked
  {
    const lt = app.turns[app.turns.length - 1];
    if (lt && lt.kind === 'user') {
      // the previous line never got its answer: this one takes its place
      try {
        await turnStore.popTail(lt.i);
      } catch (e) {
        await storeError(e);
        return;
      }
      app.turns.pop();
      app.state.next = lt.i;
      app.state.rollMemo = memoOf(lt);
      await persist();
      if (run.abandoned) return;
    }
  }
  let roll = null,
    luck = null,
    fate = null;
  if (!cmd) {
    const keep = app.state.rollMemo && app.state.rollMemo.at === app.state.next && 'luck' in app.state.rollMemo;
    luck = rule('dice') === false ? null : keep ? app.state.rollMemo.luck : rollLuck();
    fate = keep && 'fate' in app.state.rollMemo ? app.state.rollMemo.fate : rollFate(null, false);
    const mr = makeRoll(text);
    text = mr.text;
    roll = mr.roll;
  }
  delete app.state.rollMemo;
  countInputHint();
  const req = uid();
  const ut0 = { kind: 'user', text, req };
  if (roll) ut0.roll = roll;
  if (luck) ut0.luck = luck;
  if (fate) ut0.fate = fate;
  const ut = await pushTurn(ut0);
  if (!ut) {
    offerInput(raw); // not saved: the words go back to the box
    return;
  }
  if (run.abandoned) return;
  await runTurn(text, cmd, { run, roll, req, luck, fate, sent: { i: ut.i, text } });
}
// the die, luck and fate of a line that got no answer: the same turn position keeps them, whatever is typed next
function memoOf(row) {
  return { at: row.i, roll: row.roll || null, luck: row.luck || null, fate: row.fate || null };
}
// a send stopped before its reply: the line comes off the page and goes back into the box
async function undoLastSend(u, quiet) {
  const last = app.turns[app.turns.length - 1];
  if (u && last && last.kind === 'user' && last.i === u.i) {
    try {
      await turnStore.popTail(u.i);
    } catch (e) {
      noteIgnored('undo send: drop the user row', e);
    }
    app.state.rollMemo = memoOf(last);
    app.turns.pop();
    app.state.next = u.i;
    await persist();
    input.value = u.text;
    fitInput();
    saveDraft();
    input.focus();
    if (!quiet) toast(T('Send cancelled. Your text is back in the input box'));
  } else if (!quiet) toast(T('Stopped'));
  renderStrip();
  renderLog('keep');
}
export function lifeExtra(l) {
  const x = [];
  if (l.entry && l.entry !== 'native') x.push(pl(', arrival: {entry}', { entry: plLabel(ENTRY_LABEL, l.entry) }));
  if (l.sponsor)
    x.push(
      pl(', has constellations (stance toward ADMIN: {stance})', { stance: plLabel(STANCE_LABEL, l.sponsor.stance) }),
    );
  return x.join('');
}
const LUCK_P = { bad: 0.03, good: 0.03 };
// everyday luck, apart from what the player does: rare bad and good turns the narrator does not have to invent
export let rollLuck = function rollLuck() {
  const d = 1 + Math.floor(rnd() * 100);
  return d <= Math.round(LUCK_P.bad * 100) ? 'bad' : d > 100 - Math.round(LUCK_P.good * 100) ? 'good' : null;
};
export let rollFate = function rollFate(cmd, intro) {
  if (!rule('gambler') || cmd || intro) return null;
  const p = Number(rule('gamblerP')) || 0.15;
  const r = rnd();
  return r < p ? 'jackpot' : r < 2 * p ? 'doom' : null;
};
// Asks the narrator for one reply and applies it. Called by an action that holds the game (see exclusive()).
//   text, cmd   what to answer: the player's line and its parsed /command, or the opening text
//   opts.intro  this is the opening reply of a life
//   opts.roll, opts.luck, opts.fate  what was rolled for this line at send time; a retry or a rewrite passes the same
//   opts.req    the request id: the same send keeps it, so an answer that finished while the page was away replays
//   opts.sent   { i, text } of the line this send just saved, taken back if the player stops the reply
//   opts.fix    a rewrite: { reason, remember, noCheck, objection } (reroll.js)
//   opts.run    the action this reply belongs to (exclusive): passed by callers that waited before calling
export async function runTurn(text, cmd, opts = {}) {
  const { intro = false, fix = null, sent = null } = opts;
  let req = opts.req;
  if (!req) {
    if (intro) {
      if (!app.state.introReq) {
        app.state.introReq = uid();
        persist().catch(e => noteIgnored('turn: persist', e));
      }
      req = app.state.introReq;
    } else req = uid();
  }
  const run = opts.run || currentRun(); // the action this reply belongs to; leaving the save abandons it
  if (!run || run.abandoned) return;
  if (!platform.sample && !(await ensureSample())) {
    toast(T("Can't call Claude"));
    return;
  }
  if (run.abandoned) return;
  const turn = {
    run,
    req,
    roll: opts.roll || null, // the d100: a free roll gets its chance from the narrator below
    luck: (!cmd && !intro && opts.luck) || null,
    fate: cmd || intro ? null : opts.fate || null, // decided at send and kept with the turn: a retry or a rewrite never re-rolls it
    redo: (fix && fix.reason) || '', // what the rewrite must fix, told to the narrator
    objection: (fix && fix.objection) || null, // the upheld /판정 a rewrite answers, kept on the reply
    sent, // the line to take back if the player stops the reply
    head: askOf(cmd) ? askOf(cmd).head : null, // the live box heading (English; log.js shows it with T)
    preview: null, // the banner and face picked while the reply streamed (once per reply)
    previewNpc: '', // whose face that is
    abort: new AbortController(), // the stop button
  };
  turn.onText = streamedReply(turn, cmd);
  if (fix && fix.remember && fix.reason) {
    app.state.corrections = (app.state.corrections || []).filter(
      c => c.until >= app.state.next && c.text !== fix.reason,
    );
    app.state.corrections.push({ text: fix.reason, until: app.state.next + 10 });
    app.state.corrections = app.state.corrections.slice(-3);
  }
  app.phase = 'narrating';
  app.turn = turn;
  setSendMode(turn.abort);
  renderLog('live');
  try {
    await narrate(text, cmd, intro, turn);
  } finally {
    if (app.turn === turn) app.turn = null;
    if (!run.abandoned && app.phase === 'narrating') {
      // left before the reply settled (a rewrite that never started, a save closed under it, an error): take the live box down
      app.phase = 'busy';
      renderLog('keep');
    }
  }
}
// What happens while a reply streams in: the banner and the speaker's face are picked once, as soon as the reply
// names them (a screen you read, like the news or a messenger, has neither), and the live box shows what is in so far.
function streamedReply(turn, cmd) {
  const screen = cmdIs(cmd, 'screen');
  return ({ text }) => {
    if (!document.getElementById('livePrev')) return; // the live box is not on screen
    const f = peekReply(text);
    if (!screen && !turn.preview && f.sceneReady) {
      turn.preview = pickPreview(f);
      turn.previewNpc = String(f.speaker || '');
    }
    showLiveReply(turn, f);
  };
}
// The banner and face a streaming reply asks for. A speaker who still needs a face gets an AI pick started now; it is
// used at the end of this turn if it is done, otherwise from their next appearance.
function pickPreview(f) {
  const img = {};
  const place = resolveScene(f.scene, f.time || app.state.clock.time, app.state.clock.place || '');
  if (place) img.scene = pick(place).id;
  const person = presentOf({ ...f, name: f.speaker }); // peekReply names the speaker's fields without the speaker_ prefix
  if (!person.name || f.hidden) return img;
  if (aiWillPick(person)) {
    startAiPick(person);
    return img;
  }
  const k = castFor(person);
  const im = k && pickEmotion(k, normEmo(f.emotion), []);
  if (im) img.char = im.id;
  return img;
}
// One reply, start to end: ask, handle a /판정 the record upholds, keep a screen command from changing the story,
// settle the dice, apply the reply, save it with its notes, then the sound. Each wait is followed by a check that the
// save was not left meanwhile (run.abandoned).
async function narrate(text, cmd, intro, turn) {
  let out;
  try {
    out = await callNarrator(text, cmd, turn);
  } catch (e) {
    if (!turn.run.abandoned) await replyFailed(e, turn, cmd, intro);
    return;
  }
  if (turn.run.abandoned) return;
  setSendMode(null);
  if (cmd && cmd.type === 'judge' && (await objectionHandled(out, cmd, text))) return;
  maskReply(out, cmd, turn);
  if (cmd && cmd.look && out.widget) out.widget.look = cmd.look; // /reddit: this board keeps that look whatever the setting
  await settleDice(turn, out);
  aliasOut(out);
  await earlyCast(out);
  if (turn.run.abandoned) return;
  const before = clone(app.state); // the state before this reply, in case the reply cannot be saved
  const res = applyOut(out, turn);
  const browsing = cmdIs(cmd, 'browse');
  delete app.state.introText;
  if (app.state.turnNo != null && !browsing) app.state.turnNo++;
  if (app.state.errataNote && !browsing) delete app.state.errataNote; // mended in this reply
  res.notes = turnNotes(res.notes || [], turn);
  const live = app.state;
  const saved = await pushTurn(
    Object.assign(
      {
        kind: 'ai',
        out,
        deltas: res.deltas,
        newSkills: res.newSkills,
        notes: res.notes,
        img: res.img,
        fate: turn.fate,
        clock: clone(app.state.clock),
        snap: clone(app.state),
      },
      turn.objection ? { objection: turn.objection } : {},
    ),
  );
  if (turn.run.abandoned) return;
  app.phase = 'busy';
  if (!saved) {
    // the reply is not on the page, so its changes must not stay either; 다시 시도 asks again. A conflict or a
    // deleted save already put a different state (or none) in place.
    if (app.state === live) app.state = before;
    renderLog('keep');
    return;
  }
  renderStrip();
  renderLog('keep');
  resolveAiPicks()
    .then(changed => changed && persist())
    .catch(e => noteIgnored('turn: resolveAiPicks', e));
  playTurnCue(res, turn);
  maybeSummarize();
}
// the narrator call failed: stopping takes the line back; anything else leaves it for 다시 시도 with the same dice
async function replyFailed(e, turn, cmd, intro) {
  app.phase = 'busy';
  setSendMode(null);
  if (e && e.code === 'cancelled') {
    await undoLastSend(turn.sent);
    return;
  }
  renderLog();
  if (!cmd && !intro) {
    const u = app.turns[app.turns.length - 1];
    if (u && u.kind === 'user') {
      app.state.rollMemo = memoOf(u);
      offerInput(u.text);
    }
  }
  sampleError(e);
}
// A /판정 the narrator upheld from the record: an error some replies back is put right now (applyErratum), the last
// reply itself is written again (upholdObjection, which takes over this turn: true).
async function objectionHandled(out, cmd, text) {
  const ob = out && out.objection;
  const fact =
    ob &&
    ob.upheld === true &&
    String(ob.fact || '')
      .trim()
      .slice(0, 200);
  if (!fact) return false;
  const ago = Math.max(0, Math.min(5, Math.round(Number(ob.turn_ago) || 0)));
  const q = String(cmd.arg || text).slice(0, 300);
  if (ago >= 1) {
    applyErratum(fact, ago, ob.remember === true, ob.fix, q, out);
    return false;
  }
  await upholdObjection(
    fact,
    { q, text: String(out.narration || '').slice(0, 2000) },
    { remember: ob.remember === true, noCheck: ob.no_check === true },
  );
  return true;
}
// what a command reply may not do. /판정 and /스킬 answer a question: no scene, no growth, the choices stay as they
// were. A screen you read (news, quests, the gallery, a messenger) is not a place: no banner, no portraits, and the
// browsing ones change nothing in the story.
function maskReply(out, cmd, turn) {
  if (!cmd) return;
  if (cmdIs(cmd, 'ask')) {
    out.widget = null;
    out.admin = '';
    out.scene = null;
    out.speaker = null;
    out.reasons = {};
    out.memory = {};
    out.judge = cmd.type;
    out.money_unit = null;
    out.money_rate = null;
    out.also_present = [];
    out.level_ups = [];
    out.evolve_skills = [];
    out.add_skills = [];
    const prevAi = [...app.turns].reverse().find(t => t.kind === 'ai' && t.out && !t.out.judge);
    out.choices = prevAi ? prevAi.out.choices || [] : [];
  }
  if (cmdIs(cmd, 'screen')) {
    out.scene = null;
    out.speaker = null;
    out.also_present = [];
    turn.preview = null;
  }
  if (cmdIs(cmd, 'browse')) {
    out.stat_changes = {};
    out.add_skills = [];
    out.remove_skills = [];
    out.title = null;
    out.dead = false;
    out.murim = null;
    out.money_unit = null;
    out.money_rate = null;
    if (out.clock) out.clock.days_passed = 0;
    if (out.memory) out.memory = { lore: out.memory.lore || [] };
  }
}
// A free roll gets its chance from the narrator's check and is written onto the player's line; a critical result
// (either kind of roll) plays the dice reveal.
async function settleDice(turn, out) {
  const roll = turn.roll;
  if (!roll) return;
  if (!roll.fixed && roll.d != null) {
    const ck = out.check;
    if (!(ck && typeof ck === 'object' && Number(ck.p) > 0)) return;
    roll.p = Math.max(1, Math.min(99, Math.round(+ck.p)));
    roll.ok = roll.d <= roll.p;
    roll.what = shortWhat(ck.what) || null;
    roll.pivotal = !!ck.decisive;
    roll.crit = critOf(roll);
    const ut = [...app.turns].reverse().find(t => t.kind === 'user');
    if (ut) {
      ut.roll = Object.assign({}, roll);
      turnStore.update(ut).catch(e => noteIgnored('turn: turnStore.update', e));
    }
    if (roll.crit) await showDice(roll);
    return;
  }
  if (roll.fixed && roll.crit) await showDice(roll);
}
// the reply's notes plus what the turn itself brought: fate first, then luck and new faces
function turnNotes(notes, turn) {
  const { fate, luck } = turn;
  if (fate) notes.unshift(fate === 'jackpot' ? T('★ Jackpot') : T('☠ Doom'));
  if (luck) notes.push(luck === 'bad' ? T('☁ Daily luck: a little bad luck') : T('🍀 Daily luck: a little good luck'));
  for (const n of takePromoted()) notes.push(T('{name}: face settled', { name: n }));
  return notes;
}
// one sound for the turn, the loudest event winning: death, a critical failure, then a realm or a title, a skill,
// a finished quest, money. A jackpot or doom fate and a realm rise sound on top.
function playTurnCue(res, turn) {
  const ev = res.events;
  const dead = app.state.dead;
  if (!dead && ev.has('realm')) cueRealm();
  if (turn.fate === 'jackpot' && !dead) cueReveal('SSS');
  else if (turn.fate === 'doom' && !dead) cueDoom();
  if (dead) cueDeath();
  else if (turn.roll && turn.roll.crit && !turn.roll.ok)
    cueDoom(); // a critical failure: no fanfare for a title it happened to bring
  else if (ev.has('realm') || ev.has('title')) cueFanfare();
  else if ((res.newSkills && res.newSkills.length) || ev.has('skill')) cueSkill();
  else if (ev.has('quest')) cueQuest();
  else if ((res.deltas.gold || 0) >= 100) cueItem();
}
export function sampleError(e) {
  const c = e && e.code;
  toast(
    c === 'rate_limited'
      ? T('Too many requests. Try again in a moment')
      : c === 'not_granted'
        ? T('Permission to use Claude is needed')
        : c === 'prompt_too_large'
          ? T('The memory is too long. Trim the lore in the Memory tab')
          : c === 'refused'
            ? T(
                'This input was caught by the safety filter. Leave out real-world how-to details, or recast it as part of the setting, and send again',
              )
            : T('Error: {msg}', { msg: (e && e.message) || c || T('unknown') }),
    4000,
  );
}

// the functions above that tests may replace (window.DR.mock): each setter swaps the binding every caller uses
export const mocks = {
  showDice: f => (showDice = f),
  rollLuck: f => (rollLuck = f),
  rollFate: f => (rollFate = f),
};
