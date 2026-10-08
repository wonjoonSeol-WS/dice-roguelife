/* ============ log rendering ============ */
import { $, esc, fmt, MARK_RE, stripMarks, toast } from './util.js';
import { T, tIn } from './i18n.js';
import { storyLang } from './settings.js';
import { cmdName, EMO_FB, moneyText, normEmo, STAT_LABEL } from './data.js';
import { withWeekday } from './calendar.js';
import { platform } from './db.js';
import { app, exclusive, waitingForReply } from './app.js';
import { critOf, statusVisible, TITLES_MAX, titlesOn } from './rules.js';
import {
  isCheckLine,
  isPivotal,
  isStarHead,
  isWorldHead,
  matchOdds,
  stripOdds,
  stripWorldPrefix,
  sysKind as sysKindOf,
  sysTag,
  titleGained,
} from './reply-words.js';
import { charSetsAll, imgById, imgUrl, sceneHtml, turnImg, turnPeople } from './images.js';
import { startNewLifeForm } from './new-life.js';
import { loadEarlier, pushTurn } from './persistence.js';
import { changeFaceIn } from './face-picker.js';
import { renderWidget, widgetOf } from './widgets.js';
import { fitInput, input, parseCmd, saveDraft } from './composer.js';
import { runTurn, send } from './turn.js';
import { fork, rerollWithReason } from './reroll.js';
import { deathPanel, ledgerCard, runLedger } from './death.js';
import { entryFrom, openShareCard, shareToHall } from './hall.js';

// the live box's banner and face: the preview once the streaming reply has named them, an empty slot before
function liveSceneHtml(turn) {
  const p = turn && turn.preview;
  if (!p) return '<div id="liveScene"></div>';
  const sc = imgById(p.scene),
    ch = imgById(p.char);
  return sc || ch ? sceneHtml(sc, ch ? [{ x: ch, npc: turn.previewNpc }] : []) : '';
}
// the streaming reply in the live box: the banner and face once picked, the ADMIN line, the narration so far
export function showLiveReply(turn, f) {
  const slot = $('#liveScene');
  if (slot && turn.preview) slot.outerHTML = liveSceneHtml(turn);
  const ad = $('#liveAdmin');
  if (ad && f.admin) {
    ad.classList.remove('hidden');
    ad.lastChild.textContent = f.admin;
  }
  const el = $('#livePrev');
  if (el && f.narration !== null) el.innerHTML = narrHtml(f.narration);
}
export function renderLog(scroll = 'bottom') {
  const log = $('#log');
  const keep = log.scrollTop;
  if (!app.state) {
    log.innerHTML = `<p class="muted pad">${T('Loading...')}</p>`;
    return;
  }
  const lastAi = [...app.turns].reverse().find(t => t.kind === 'ai');
  const first = app.turns[0];
  const more =
    first && first.i > 0 && !platform.memMode
      ? `<div class="row log-more"><button class="btn ghost" id="moreBtn">${T('Earlier turns')}</button></div>`
      : '';
  const lastT = app.turns[app.turns.length - 1];
  const retry =
    !waitingForReply() && lastT && (lastT.kind === 'user' || (lastT.kind === 'system' && app.state.introText))
      ? `<div class="row log-more"><button class="btn" id="retryBtn">${T('Retry')}</button></div>`
      : '';
  log.innerHTML =
    more +
    app.turns.map(t => renderTurn(t, t === lastAi)).join('') +
    retry +
    (waitingForReply()
      ? '<div class="turn"><div class="ai" id="liveBox">' +
        liveSceneHtml(app.turn) +
        '<div class="body">' +
        (app.turn && app.turn.head ? `<div class="sysmsg turn-head"><span>[ ${T(app.turn.head)} ]</span></div>` : '') +
        '<p class="admin hidden" id="liveAdmin"><b>ADMIN</b><span></span></p><div class="narr" id="livePrev"></div><div class="typing"><i></i><i></i><i></i></div></div></div></div>'
      : '') +
    (app.state.dead && !waitingForReply() ? deathPanel() : '');
  $('#composer').classList.toggle('hidden', !platform.sample || app.state.dead);
  syncInputHint();
  if (scroll === 'bottom') log.scrollTop = log.scrollHeight;
  else if (scroll === 'keep') log.scrollTop = keep;
  else if (scroll === 'live') {
    const lb = $('#liveBox');
    if (lb) log.scrollTop = Math.max(0, lb.offsetTop - log.offsetTop - 8);
  }
}
const SYS_LINE_RE =
  /(?:^|\n+)[ \t]*(\[[^\[\]\n]{2,140}\]|【[^【】\n]{2,180}】|〈[^〈〉\n]{2,180}〉|《[^《》\n]{2,180}》)[ \t]*(?=\n|$)/g;
const unesc = x =>
  x
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const sysCore = x =>
  String(x || '')
    .replace(/^[\s\[【〈《]+|[\s\]】〉》]+$/g, '')
    .replace(/^SYSTEM\s*[:：]\s*/i, '')
    .replace(/[\s:：\-·,.]/g, '');
// h is escaped text; windows go in as \u0000 segments
function inlineSys(h, cap = 2) {
  const shown = [],
    over = [];
  let personal = 0;
  h = h.replace(SYS_LINE_RE, (m, line) => {
    const raw = unesc(line);
    const head = raw.replace(/^\[\s*/, '');
    const mine = /^\[/.test(raw) && !isWorldHead(head) && !isStarHead(head); // world news and constellations break in where they happen; only the player's own windows are capped
    if (mine) {
      if (personal >= cap) {
        over.push(raw);
        return '';
      }
      personal++;
    }
    shown.push(raw);
    return `\u0000<div class="sysmsg inl">${sysHtml(raw)}</div>\u0000`;
  });
  h = h.replace(/\u0000\n+/g, '\u0000');
  return { h, shown, over };
}
const fmtText = h =>
  h
    .split('\u0000')
    .map((seg, i) =>
      i % 2
        ? seg
        : seg
            .replace(/\*([^*\n]{1,120})\*/g, '<em>$1</em>')
            .replace(/(&quot;|“)([^&“”\n]{1,200}?)(&quot;|”)/g, '<span class="dlg">$1$2$3</span>'),
    )
    .join('');
function narrHtml(text) {
  return fmtText(inlineSys(esc(stripMarks(text))).h);
}
function narrWithImages(o, ti, people, sc) {
  // put portraits and scene changes where the narrator marked them
  const used = new Set();
  let h = esc(String(o.narration || '').replace(/\n*(\[\[[^\[\]\n]{1,32}\]\])\n*/g, '$1'));
  const IS = inlineSys(h);
  h = IS.h;
  const P = {};
  for (const p of people) P[p.npc] = p;
  const places = ti.places || [];
  h = h.replace(MARK_RE, (m, at, name) => {
    name = name.trim();
    if (at) {
      const pl = places.find(x => x.name === name);
      const x = pl && turnImg(ti, pl.id);
      if (!x || used.has('@' + name) || x === sc) return '';
      used.add('@' + name);
      return `\u0000<div class="scene inl" style="background-image:url('${imgUrl(x.id)}')"></div>\u0000`;
    }
    const p = P[name];
    if (!p || used.has(name)) return '';
    used.add(name);
    return `\u0000<div class="castrow n1 inl"><figure><img class="char" alt="" src="${imgUrl(p.x.id)}"><figcaption>${esc(name)}</figcaption></figure></div>\u0000`;
  });
  // people the narrator didn't mark: after the first paragraph that names them, else after the first line of dialogue
  const figOf = p =>
    `\u0000<div class="castrow n1 inl"><figure><img class="char" alt="" src="${imgUrl(p.x.id)}"><figcaption>${esc(p.npc)}</figcaption></figure></div>\u0000`;
  for (const p of people) {
    if (used.has(p.npc) || !p.npc) continue;
    const paras = h.split('\n');
    let at = paras.findIndex(x => !x.includes('\u0000') && x.includes(esc(p.npc)));
    if (at < 0) at = paras.findIndex(x => !x.includes('\u0000') && /(&quot;|“)/.test(x));
    if (at < 0) at = paras.findIndex(x => x.trim() && !x.includes('\u0000'));
    if (at < 0) continue;
    const firstText = paras.findIndex(x => x.trim());
    if (at === firstText) continue; // present from the opening line: stays in the top row with the scene
    paras.splice(at + 1, 0, figOf(p));
    if (paras[at + 2] === '') paras.splice(at + 2, 1);
    h = paras.join('\n');
    used.add(p.npc);
  }
  h = fmtText(h);
  return { html: h, used, sysShown: IS.shown, sysOver: IS.over };
}
/* ---- capture mode: hide names on screen only (history untouched) ---- */
export function captureWords() {
  const c = app.settings.capture || {};
  let w = (c.words || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
  if (!w.length && app.state && app.state.life && app.state.life.name) {
    const n = app.state.life.name.trim();
    w = [n];
    if (/^[가-힣]{3}$/.test(n)) w.push(n.slice(1));
  }
  return [...new Set(w)].sort((a, b) => b.length - a.length);
}
let masking = false;
export function maskNames(root) {
  const c = app.settings.capture || {};
  if (!c.on || masking) return;
  const words = captureWords();
  if (!words.length) return;
  masking = true;
  try {
    const re = new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: n => {
        const p = n.parentElement;
        if (!p || p.closest('script,style,textarea,input,.nm-mask,#settingsBox')) return NodeFilter.FILTER_REJECT;
        re.lastIndex = 0;
        return re.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const frag = document.createDocumentFragment();
      let last = 0;
      const v = n.nodeValue;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(v))) {
        frag.append(v.slice(last, m.index));
        const sp = document.createElement('span');
        sp.className = 'nm-mask' + (c.mode === 'alias' ? ' alias' : '');
        sp.textContent = c.mode === 'alias' ? c.alias || '{user}' : m[0];
        frag.append(sp);
        last = m.index + m[0].length;
      }
      frag.append(v.slice(last));
      n.replaceWith(frag);
    }
  } finally {
    masking = false;
  }
}
let maskTimer = null;
export function watchCaptureMask() {
  // capture mode: names are masked again whenever the page changes
  new MutationObserver(() => {
    if (masking || !(app.settings.capture || {}).on) return;
    clearTimeout(maskTimer);
    maskTimer = setTimeout(() => maskNames(document.body), 30);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
}
function choiceHtml(c) {
  const m = matchOdds(c);
  if (!m) return esc(c);
  const big = isPivotal(m.rest);
  return `${esc(c.slice(0, m.index))}<span class="odds${big ? ' big' : ''}" title="${big ? T('Decisive check: the dice show whatever the result') : T('Decided by the dice')}">🎲${big ? '❗' : ''} ${m.p}%</span>`;
}
// three tiers by bracket: [ ] the player's own window, 【 】 an announcement the whole world hears, 〈 〉 a constellation speaking
function sysHtml(m) {
  const raw = String(m || '')
    .trim()
    .replace(/^`+|`+$/g, '');
  const inner = raw
    .replace(/^[\[【〈《]\s*/, '')
    .replace(/\s*[\]】〉》]$/, '')
    .replace(/^SYSTEM\s*[:：]\s*/i, '');
  const head = inner.split(/[:：\-]/)[0].trim();
  if (/^【/.test(raw) || isWorldHead(head)) {
    const body = stripWorldPrefix(inner);
    return `<div class="world"><div class="h">WORLD MESSAGE</div><div class="b">${esc(body || inner)}</div></div>`;
  }
  if (/^[〈《]/.test(raw) || isStarHead(head)) return `<div class="star">〈 ${esc(inner)} 〉</div>`;
  const kind = sysKind(m);
  let t = inner;
  const k = t.search(/[:：]/);
  if (k > 0 && k < 14) t = t.slice(0, k).trim() + ' : ' + t.slice(k + 1).trim();
  const tag = kind === 'sys-bad' ? 'WARNING' : kind === 'sys-good' ? sysTag(head) || 'REWARD' : 'SYSTEM';
  const title = titleGained(inner);
  const tfx = title && titleFxOf(title.trim());
  return `<div class="win ${kind}" data-tag="${tag}">${esc(t)}${tfx ? `<div class="fx">${esc(tfx)}</div>` : ''}</div>`;
}
let fxContext = null; // the title effects in force while one turn is drawn (its own snapshot), else the live state
export function toggleTitle(t) {
  const on = titlesOn();
  const i = on.indexOf(t);
  if (i >= 0) on.splice(i, 1);
  else {
    if (on.length >= TITLES_MAX) return false;
    on.push(t);
  }
  app.state.titlesOn = on;
  app.state.title = on[0] || '';
  return true;
}
function titleFxOf(name) {
  const fx = fxContext || (app.state && app.state.titleFx) || {};
  if (fx[name]) return fx[name];
  const k = Object.keys(fx).find(x => x.replace(/\s+/g, '') === name.replace(/\s+/g, ''));
  return k ? fx[k] : '';
}
function sysKind(m) {
  const head = String(m || '')
    .replace(/^[\s\[`]*(SYSTEM\s*[:：]\s*)?/i, '')
    .split(/[:：\-]/)[0];
  return sysKindOf(head);
}
export function adminFace(emo) {
  const imgs = charSetsAll().admin;
  if (!imgs || !imgs.length) return null;
  const by = e => imgs.filter(x => (x.emotion || 'neutral') === e);
  return by(emo)[0] || by(EMO_FB[emo] || '')[0] || by('smirk')[0] || by('neutral')[0] || imgs[0];
}
function adminLine(o) {
  const f = adminFace(normEmo(o.admin_emotion || 'smirk'));
  return `<p class="admin">${f ? `<img class="adm" alt="" src="${imgUrl(f.id)}">` : ''}<b>ADMIN</b>${esc(o.admin)}</p>`;
}
const choiceRow = c =>
  `<div class="crow"><button class="cedit" data-cedit="${esc(c)}" title="${T('Put it in the input box to edit (long-press or right-click works too)')}" aria-label="${T('Put this choice in the input box to edit')}">✎</button><button data-choice="${esc(c)}">${choiceHtml(c)}</button></div>`;
// a choice copied into the box: the action without its odds, ready to extend. Sent unchanged it is still that choice; changed, it is free input
export const inputPh = () => T('*scene*, *thoughts*, speech, actions, /commands');
let choiceHinted = false;
const HINT_LS = 'dr:inputHint';
function inputHintState() {
  try {
    return JSON.parse(localStorage.getItem(HINT_LS) || '{}');
  } catch (e) {
    return {};
  }
}
export function syncInputHint() {
  const h = $('#inputHint');
  if (!h) return;
  const st = inputHintState();
  h.classList.toggle('hidden', !!st.done || !app.state || app.state.dead);
  h.querySelector('button').onclick = () => {
    try {
      localStorage.setItem(HINT_LS, JSON.stringify({ done: 1 }));
    } catch {
      // browser storage may be unavailable (private mode): the hint just shows again
    }
    h.classList.add('hidden');
  };
}
// gone after five sends, or when closed
export function countInputHint() {
  const st = inputHintState();
  if (st.done) return;
  st.sent = (st.sent || 0) + 1;
  if (st.sent >= 5) st.done = 1;
  try {
    localStorage.setItem(HINT_LS, JSON.stringify(st));
  } catch {
    // browser storage may be unavailable (private mode): the hint just shows again
  }
  syncInputHint();
}
function choiceToInput(c) {
  const a = stripOdds(c).trim();
  const cur = input.value.replace(/\s+$/, '');
  input.value = cur ? cur + '\n' + a + ' ' : a + ' '; // below whatever is already typed
  fitInput();
  input.focus();
  try {
    input.setSelectionRange(input.value.length, input.value.length);
  } catch {
    // some inputs refuse a selection range: the caret stays where it is
  }
  saveDraft();
  let seen = choiceHinted;
  try {
    seen = seen || !!localStorage.getItem('dr:choiceHint');
    localStorage.setItem('dr:choiceHint', '1');
  } catch {
    // browser storage may be unavailable (private mode): the hint just shows again
  }
  choiceHinted = true; // the hint once per browser
  if (!seen) toast(T("It's in the input box. If you change it, it's judged as free input"), 3500);
}
// the roll belongs to the player's line just before this reply
function turnRoll(t) {
  const i = app.turns.indexOf(t);
  const u = i > 0 ? app.turns[i - 1] : null;
  const r = u && u.kind === 'user' ? u.roll : null;
  return r && r.p != null ? r : null;
}
function rollWin(r) {
  const crit = critOf(r);
  const label = r.ok ? (crit ? T('Critical success') : T('Success')) : crit ? T('Critical failure') : T('Failure');
  const cls = r.ok ? (crit ? 'sys-good' : '') : 'sys-bad';
  const tip = T('The die is 1-100, lower is better. At a {p}% chance, {p} or less succeeds', { p: r.p });
  const need = T('Needs {p} or less: 🎲 {d}', { p: r.p, d: r.d });
  const what = r.what ? `<div class="what">${esc(r.what)}</div>` : '';
  if (crit)
    return `<div class="win big ${cls}" data-tag="CRITICAL" title="${tip}">${what}<div class="t">${r.ok ? T('★ Critical success ★') : T('☠ Critical failure ☠')}</div><div class="n">${need}</div></div>`;
  return `<div class="win ${cls}" data-tag="CHECK" title="${tip}">${what}${need} → ${label}</div>`;
}
const userHtml = x =>
  esc(x)
    .replace(/\*([^*\n]{1,300})\*/g, '<em class="thought">*$1*</em>')
    .replace(/(&quot;|“)([^&“”\n]{1,300}?)(&quot;|”)/g, '<span class="said">$1$2$3</span>');
function chipLabel(k, v, t) {
  const energy = t.snap && t.snap.energy ? t.snap.energy.name : T('Energy');
  if (k === 'energy') return energy;
  if (k === 'energyMax') return T('{name} max', { name: energy });
  if (k === 'hp') return v > 0 ? T('♥ Healed') : 'HP';
  return STAT_LABEL[k] ? T(STAT_LABEL[k]) : k;
}
// money and age are known to the character, so they show as amounts even before awakening; other stats stay arrows
function chipValue(k, v, t, shown) {
  if (!shown && k !== 'gold' && k !== 'age') return v > 0 ? '↑' : '↓';
  const sign = v > 0 ? '+' : '';
  if (k === 'gold')
    return sign + moneyText(v, (((t.snap && t.snap.life) || (app.state && app.state.life) || {}).world || {}).id);
  if (k === 'age') return T('{n} {n|yr|yrs}', { n: sign + fmt(v) });
  return sign + fmt(v);
}
export function renderTurn(t, isLast) {
  fxContext = Object.assign({}, (app.state && app.state.titleFx) || {}, (t && t.snap && t.snap.titleFx) || {});
  try {
    return renderTurnInner(t, isLast);
  } finally {
    fxContext = null;
  }
}
function renderTurnInner(t, isLast) {
  if (t.kind === 'user')
    return `<div class="turn u"><p>${userHtml(stripOdds(t.text || '').trim() || t.text)}</p></div>`; // the roll is shown with the reply, in its result window
  if (t.kind === 'system') return `<p class="sysline">${esc(t.text)}</p>`;
  if (t.kind === 'ledger') return `<div class="turn">${ledgerCard(t.out, t.i)}</div>`;
  const o = t.out || {};
  const ti = t.img || {};
  let img = '';
  const sc = turnImg(ti, ti.scene);
  const ppl = turnPeople(ti, o);
  const NW = narrWithImages(o, ti, ppl, sc);
  const rest = ppl.filter(p => !NW.used.has(p.npc));
  if (sc || rest.length) img = sceneHtml(sc, rest);
  const RS = o.reasons || {};
  const SV = statusVisible();
  const deltas =
    t.deltas &&
    Object.entries(t.deltas)
      .filter(([, v]) => v)
      .map(
        ([k, v]) =>
          `<span class="${k === 'hp' && v > 0 ? 'heal' : k === 'energy' ? 'mana' : v > 0 ? 'up' : 'down'}${RS[k] ? ' why' : ''}" ${RS[k] ? `data-why="${esc(RS[k])}" role="button" tabindex="0" title="${esc(RS[k])}"` : ''}>${esc(chipLabel(k, v, t))} ${esc(chipValue(k, v, t, SV))}</span>`,
      )
      .join('');
  const ck = t.clock;
  const head =
    ck && (ck.date || ck.place)
      ? `<div class="clock">D+${ck.day} | ${[ck.date && withWeekday(ck.date), ck.time, ck.weather, ck.place].filter(Boolean).map(esc).join(' | ')}</div>`
      : '';
  if (o.judge)
    return `<div class="turn"><div class="ai judge"><div class="body"><div class="sysmsg turn-head"><span>[ ${o.judge === 'skills' ? T('Skills') : T('Why the check went this way')} ]</span></div><div class="narr judge-narr">${narrHtml(o.narration)}</div>
    ${isLast && !app.state.dead && o.choices && o.choices.length ? `<div class="choices">${o.choices.map(choiceRow).join('')}</div>` : ''}</div></div></div>`;
  const er = t.errata
    ? `<details class="objection"><summary>${T('⚖ Correction: {fact}', { fact: esc(t.errata.fact || '') })}</summary>${t.errata.q ? `<div class="oq">${T('Question: {q}', { q: esc(t.errata.q) })}</div>` : ''}<div class="oq">${T('This record stays as it was; the fix was applied to the state after it.')}</div></details>`
    : '';
  const obj = t.objection
    ? `<details class="objection"${isLast ? ' open' : ''}><summary>${T('⚖ Objection upheld: {fact}', { fact: esc(t.objection.fact || '') })}</summary>${t.objection.q ? `<div class="oq">${T('Question: {q}', { q: esc(t.objection.q) })}</div>` : ''}${t.objection.text ? `<div class="narr oj">${narrHtml(t.objection.text)}</div>` : ''}</details>`
    : '';
  return `<div class="turn"><div class="ai">${img}<div class="body">${head}${obj}${er}
    ${o.admin ? adminLine(o) : ''}
    ${o.narration ? `<div class="narr">${NW.html}</div>` : o.widget ? '' : `<p class="muted empty-reply">${T('(Empty reply) Press Rewrite below')}</p>`}
    ${o.lang_note ? `<p class="langnote">${esc(o.lang_note)}</p>` : ''}
    ${(() => {
      const seen = new Set((NW.sysShown || []).map(sysCore));
      const roll = turnRoll(t);
      const end = [...(o.system || []), ...(NW.sysOver || [])].filter(m => {
        const c = sysCore(m);
        if (seen.has(c) || (roll && isCheckLine(c))) return false;
        seen.add(c);
        return true;
      });
      return end.length || roll
        ? `<div class="sysmsg">${roll ? rollWin(roll) : ''}${end.map(sysHtml).join('')}</div>`
        : '';
    })()}
    ${
      deltas || (t.newSkills && t.newSkills.length) || (t.notes && t.notes.length)
        ? `<div class="deltas">${deltas || ''}${(t.newSkills || [])
            .filter(k => typeof k === 'string')
            .map(k => `<span class="up">${T('Skill {name}', { name: esc(k) })}</span>`)
            .join('')}${(t.notes || [])
            .filter(k => !/이하 필요/.test(k)) // roll notes saved before v2.5 (the roll window shows the roll)
            .map(
              k =>
                `<span class="${k.startsWith('☠') ? 'down' : k.startsWith('★') || k.startsWith('✦') ? 'jack' : 'up'}">${esc(k)}</span>`,
            )
            .join('')}</div>`
        : ''
    }
    ${o.widget ? renderWidget(o.widget, t.i) : ''}
    ${isLast && !app.state.dead && ((o.choices && o.choices.length) || o.widget) ? `<div class="choices">${(o.choices || []).map(choiceRow).join('')}${widgetFollowups(o.widget)}</div>` : ''}
    </div><div class="tools">${isLast && !waitingForReply() ? `<button data-reroll="${t.i}">${T('Rewrite')}</button>` : ''}${turnPeople(t.img || {}, o).some(p => p.npc) ? `<button data-face="${t.i}">${T('Change face')}</button>` : ''}<button data-fork="${t.i}">${T('Branch here')}</button></div></div></div>`;
}
// the buttons a screen offers under itself (widgets.js), each sending its text or running its action (followUp)
function widgetFollowups(w) {
  const def = widgetOf(w);
  if (!def) return '';
  return def
    .followups(w)
    .map(([act, label]) => `<button data-act="${esc(act)}" class="fu">${esc(label)}</button>`)
    .join('');
}
// a quest taken from a board: added to the quest list, noted in the log
export async function acceptQuest(btn) {
  const t = app.turns.find(x => x.i === +btn.dataset.turn);
  const q = t && t.out.widget.quests[+btn.dataset.accept];
  if (!q) return;
  app.state.quests.push({ title: q.title, status: 'active', note: [q.client, q.reward].filter(Boolean).join(', ') });
  btn.disabled = true;
  btn.textContent = T('Accepted');
  await pushTurn({ kind: 'system', text: tIn(storyLang(), 'Quest accepted: {title}', { title: q.title }) });
  renderLog();
}

// What each button in the log does, by its data attribute (or, for the few one-off buttons, its id). The log is
// redrawn after every change, so instead of every render binding its buttons again, bindLogEvents (wired once from
// main.js) listens on #log and runs the action of the innermost button that was hit.
const LOG_ACTIONS = {
  choice: b => send(b.dataset.choice),
  cedit: b => choiceToInput(b.dataset.cedit),
  face: b => changeFaceIn(+b.dataset.face),
  why: b => toast(b.textContent.trim() + ': ' + b.dataset.why, 5000),
  act: b => followUp(b.dataset.act),
  reroll: () => rerollWithReason(),
  fork: b => fork(+b.dataset.fork),
  accept: b => acceptQuest(b),
  open: b => send(`${b.dataset.via || cmdName('board')} ${T('open "{title}"', { title: b.dataset.open })}`),
  hall: b => shareToHall(+b.dataset.hall),
  card: b => {
    const t = app.turns.find(x => x.i === +b.dataset.card);
    if (t) openShareCard(entryFrom(t.out, t));
  },
};
const LOG_BUTTONS = {
  ledgerBtn: () => runLedger(),
  regressBtn: () => startNewLifeForm(app.state.pendingInherit || {}),
  retryBtn: () => retryLast(),
  moreBtn: () => loadEarlier(),
};
// the innermost element from the target up to #log that is a log button, with its action
function logButton(target, log) {
  for (let el = target; el && el !== log; el = el.parentElement) {
    if (LOG_BUTTONS[el.id]) return { el, run: LOG_BUTTONS[el.id] };
    const key = Object.keys(LOG_ACTIONS).find(k => k in el.dataset);
    if (key) return { el, key, run: LOG_ACTIONS[key] };
  }
  return null;
}
// a screen's follow-up: most send their line; reply and comment only start one in the input
function followUp(act) {
  const start = { reply: cmdName('chat') + ' ', comment: `${cmdName('board')} ${T('comment:')} ` }[act];
  if (start === undefined) return send(act);
  input.value = start;
  input.focus();
}
// a retry is the same send: same dice, same request id
function retryLast() {
  return exclusive(() => {
    const u = app.turns[app.turns.length - 1];
    if (u.kind === 'user')
      return runTurn(u.text, parseCmd(u.text), {
        roll: u.roll || null,
        req: u.req || null,
        luck: u.luck || null,
        fate: u.fate || null,
      });
    return runTurn(app.state.introText, null, { intro: true });
  });
}
export function bindLogEvents() {
  const log = $('#log');
  // holding a choice for half a second (touch) puts it in the input to edit, and the click that ends that hold (on
  // the same button, right after) is dropped; a right click does the same with a mouse
  let holdTimer = null,
    held = null; // { el, at }: the choice just held
  log.addEventListener('click', e => {
    const hit = logButton(e.target, log);
    if (!hit) return;
    const endsHold = hit.key === 'choice' && held && held.el === hit.el && Date.now() - held.at < 1500;
    held = null;
    if (endsHold) {
      e.preventDefault();
      return;
    }
    hit.run(hit.el);
  });
  log.addEventListener('keydown', e => {
    const hit = e.key === 'Enter' && logButton(e.target, log);
    if (hit && hit.key === 'why') hit.run(hit.el); // the reason chips are spans, so Enter is not a click there
  });
  log.addEventListener('contextmenu', e => {
    const b = e.target.closest('[data-choice]');
    if (!b || !log.contains(b)) return;
    e.preventDefault();
    choiceToInput(b.dataset.choice);
  });
  log.addEventListener(
    'touchstart',
    e => {
      const b = e.target.closest('[data-choice]');
      if (!b || !log.contains(b)) return;
      held = null;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        held = { el: b, at: Date.now() };
        choiceToInput(b.dataset.choice);
      }, 500);
    },
    { passive: true },
  );
  for (const ev of ['touchend', 'touchmove', 'touchcancel'])
    log.addEventListener(ev, () => clearTimeout(holdTimer), { passive: true });
}
