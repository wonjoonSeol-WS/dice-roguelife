/* ============ new life ============ */
import { $, clone, esc, noteIgnored, nowIso, pick, rnd, toast, uid } from './util.js';
import {
  BASE,
  cmdName,
  CMDS,
  currencyOf,
  moneyFor,
  initMurim,
  ORIGINS,
  RACES,
  rollEntry,
  rollSponsor,
  rollSubStats,
  rollTier,
  TALENTS,
  TIER_P,
  tierRank,
  TIERS,
  TRANSFER_RACES,
  WORLDS,
  worldIn,
} from './data.js';
import { langOptions, N_, T, tIn, uiLang } from './i18n.js';
import { ENTRY_LABEL, GENDER, GENDER_LABEL, GENDERS, SKILL_SRC, STANCE_LABEL } from './enums.js';
import { isPrivileged, platform } from './db.js';
import { NEW_SAVES, turnStore } from './turn-store.js';
import { app, exclusive } from './app.js';
import { saveSettings, setting, storyLang } from './settings.js';
import { snapshotRules } from './rules.js';
import { showTab } from './shell.js';
import { cueBlip, cueReveal } from './sound.js';
import { ensureSample } from './boot.js';
import { liveWorldIds } from './images.js';
import { leaveOpenSave, pushTurn, showPlay } from './persistence.js';
import { lifeExtra, runTurn } from './turn.js';
import { fillTemplate, pr } from './prompt.js';
import { chooseUiLang } from './settings-sheet.js';

const TALENT_MAX = 5;
let tierLocked = false;
// free setup for players without owner rights stops at C
function lockTierSel(sel) {
  if (!sel) return;
  [...sel.options].forEach(o => {
    o.setAttribute('value', o.value);
    if (tierRank(o.value) < tierRank('C')) {
      o.disabled = true;
      o.textContent = o.value + T(' (locked)');
    }
  });
  sel.value = 'C';
}
const talentRow = first =>
  `<div class="trow"><div class="row talent-row"><select class="tt" aria-label="${T('Talent grade')}">${TIERS.map(t => `<option ${t === 'C' ? 'selected' : ''}>${t}</option>`).join('')}</select><input class="tn grow" maxlength="30" placeholder="${first ? T('e.g. Obsessed with the sword') : T('Talent name')}">${first ? '' : `<button type="button" class="tx" aria-label="${T('Remove this talent')}">×</button>`}</div><input class="td talent-desc" maxlength="80" placeholder="${T('Effect in one line')}"></div>`;
let formInherit; // for redrawNewLifeForm
export function startNewLifeForm(inherit) {
  formInherit = inherit;
  tierLocked = false;
  if (!inherit) {
    leaveOpenSave(); // a new game leaves the open save; a regression continues it
    app.currentSave = null;
  }
  $('#strip').classList.add('hidden');
  $('#composer').classList.add('hidden');
  const log = $('#log');
  const sel = { world: 'random', gender: GENDER.MALE, mode: 'gacha' }; // the form's choices
  log.innerHTML = newLifeHtml(inherit);
  bindChoice(log, '#gseg', 'g', v => (sel.gender = v));
  bindChoice(log, '#wseg', 'w', v => (sel.world = v));
  bindChoice(log, '#spseg', 'sp', v => (sel.sponsor = v));
  bindChoice(log, '#mseg', 'm', v => {
    sel.mode = v;
    $('#freeBox').classList.toggle('hidden', v !== 'free');
  });
  const ts = $('#toSaves');
  if (ts) ts.onclick = () => showTab('saves');
  bindTalentRows();
  lockFreeSetup(inherit);
  bindProfileCount();
  bindFormLang();
  $('#rollBtn').onclick = () => rollFromForm(inherit, sel);
}
function bindFormLang() {
  const el = $('#nlLang');
  if (!el) return;
  el.value = uiLang();
  el.onchange = () => chooseUiLang(el.value);
}
// keeps what was typed and a fate already rolled
export function redrawNewLifeForm() {
  const form = $('#log .newlife');
  if (!form) return;
  const fields = [...form.querySelectorAll('input[id],textarea[id],select[id]')].filter(el => el.id !== 'nlLang');
  const kept = fields.map(el => [el.id, el.type === 'checkbox' ? el.checked : el.value]);
  const pressed = [...form.querySelectorAll('.seg button[aria-pressed="true"]')].map(b => [
    b.parentElement.id,
    b.dataset,
  ]);
  const talents = [...form.querySelectorAll('#talents .trow')].map(r =>
    [...r.querySelectorAll('select,input')].map(x => x.value),
  );
  const pending = app.pendingRoll;
  startNewLifeForm(formInherit);
  for (const [id, data] of pressed) {
    const [k, v] = Object.entries(data)[0] || [];
    const b = k && $(`#${id} button[data-${k}="${v}"]`);
    if (b && !b.disabled) b.click();
  }
  for (let i = 1; i < talents.length; i++) $('#addTalent').click();
  [...document.querySelectorAll('#talents .trow')].forEach((r, i) =>
    [...r.querySelectorAll('select,input')].forEach((x, j) => {
      if (talents[i] && talents[i][j] !== undefined && !x.disabled) x.value = talents[i][j];
    }),
  );
  for (const [id, v] of kept) {
    const el = $('#' + id);
    if (!el || el.closest('.trow')) continue;
    if (el.type === 'checkbox') el.checked = v;
    else el.value = v;
  }
  $('#prof').dispatchEvent(new Event('input'));
  if (pending) {
    app.pendingRoll = pending;
    revealFate(pending.life, pending.inherit, true);
  }
}
// a row of toggle buttons: pressing one marks it and reports its data-<key> value
function bindChoice(root, seg, key, onPick) {
  const buttons = root.querySelectorAll(seg + ' button');
  buttons.forEach(
    b =>
      (b.onclick = () => {
        onPick(b.dataset[key]);
        buttons.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      }),
  );
}
function newLifeHtml(inherit) {
  const worlds = ['random', ...WORLDS.map(w => w.id)];
  return `<div class="newlife">
    <div class="row nl-head"><h2>${inherit ? T('Regression') : T('A New Life')}</h2><label class="nl-lang"><span aria-hidden="true">🌐</span><select id="nlLang" aria-label="Language">${langOptions()}</select></label></div>
    ${
      inherit
        ? ''
        : `<div class="sysmsg intro-head"><span>${T('[ SYSTEM: Player Registration ]')}</span></div>
    <p class="narr intro-narr">${T('Converting your soul to data. Your world, race, standing and talent are all left to luck. This world will be unfair, cruel, and wickedly fun. When you die, you come back holding the one ability that made your last life special.')}</p>`
    }
    <p class="muted intro-note">${inherit ? T('You are reborn holding a fragment of your past life. Your world and standing are left to luck once more.') : T('Choose a name and gender; the dice decide your world, race, standing and talent. There are no take-backs.')}</p>
    ${
      inherit
        ? ''
        : `<div class="field"><label for="nm">${T('Name')}</label><input id="nm" maxlength="20" placeholder="${T('Name')}"></div>
    <div class="field"><label>${T('Gender')}</label><div class="seg" id="gseg">${GENDERS.map(g => `<button type="button" data-g="${g}" aria-pressed="${g === GENDER.MALE}">${T(GENDER_LABEL[g])}</button>`).join('')}</div></div>`
    }
    <div class="field"><label for="prof">${T('Character profile (optional): looks, personality, verbal tics, backstory, anything weird you like')}</label><textarea id="prof" rows="3" maxlength="600" placeholder="${esc(T('e.g. Worked the night shift at a convenience store in a past life and is obsessed with instant noodles. Ends every sentence with "I mean, though." Loses all reason around cats.'))}">${esc(inherit ? app.state.life.profile || '' : app.settings.profile || '')}</textarea><div class="row profile-head"><label class="row profile-toggle"><input type="checkbox" id="profSave" checked> ${T('Save as the default for my next life')}</label><span class="muted count-note" id="profCount"></span></div></div>
    <div class="field"><label>${T('World')}</label><div class="seg" id="wseg">${worlds.map(w => `<button type="button" data-w="${w}" aria-pressed="${w === 'random'}">${w === 'random' ? T('Random') : T(WORLDS.find(x => x.id === w).name)}</button>`).join('')}</div></div>
    ${
      inherit
        ? ''
        : `<div class="field dm"><label class="row dm-head"><input type="checkbox" id="diceMode" ${app.settings.dice !== false ? 'checked' : ''}> ${T('🎲 Roll the dice every turn')} <span class="dm-tag">${T('2d100 (choices, daily luck)')}</span></label>
      <div class="dm-desc">
        <p>${T('<b>On:</b> <span class="dm-up">harder ↑ more thrilling ↑</span>')}</p>
        <p class="li">${T('- <b>Choice dice</b>: decide risky actions and choices that show a chance')}</p>
        <p class="li">${T('- <b>Daily dice</b>: the occasional good or bad luck, whatever you do')}</p>
        <p class="li">${T("- The code rolls them, not the AI, so results don't lean either way")}</p>
        <p class="gap">${T('<b>Off:</b> relaxed, the way you want it')}</p>
        <p class="li">${T('- The story goes by what is plausible, no dice')}</p>
        <p class="li">${T('- So results may lean a little in your favor')}</p>
        <p class="gap muted">${T('Once you start, this stays fixed for the whole save.')}</p>
      </div></div>`
    }
    <div class="field"><label>${T('How to start')}</label><div class="seg" id="mseg"><button type="button" data-m="gacha" aria-pressed="true">${T('Luck (dice)')}</button><button type="button" data-m="free" aria-pressed="false">${T('Custom')}</button></div></div>
    <div id="freeBox" class="hidden free-box">
      <div class="field"><label for="fRace">${T('Race')}</label><input id="fRace" maxlength="20" placeholder="${T('Leave blank for random')}"></div>
      <div class="row"><div class="field talent-grade-field"><label for="fOT">${T('Standing grade')}</label><select id="fOT">${TIERS.map(t => `<option ${t === 'C' ? 'selected' : ''}>${t}</option>`).join('')}</select></div><div class="field grow"><label for="fOrigin">${T('Standing')}</label><input id="fOrigin" maxlength="30" placeholder="${T('e.g. Lowest disciple of the Mount Hua Sect')}"></div></div>
      <div class="field"><label>${T('Talents (grade, name, effect in one line)')}</label><div id="talents">${talentRow(true)}</div><button type="button" class="btn ghost add-talent" id="addTalent">${T('+ Add a talent')}</button></div>
      <div class="field"><label for="fAge">${T('Starting age')}</label><input id="fAge" type="number" min="0" max="90" placeholder="${T('Leave blank for random')}"></div>
      <div class="field"><label for="worldNote">${T('Setting and characters (optional)')}</label><textarea id="worldNote" rows="3" maxlength="1200" placeholder="${T('e.g. There is no magic in this world and the guilds rule the cities. My childhood friend Seoyun lives next door. Blunt on the outside, but always looking out for me.')}">${esc(app.settings.worldNote || '')}</textarea><p class="muted field-note">${T('This goes into your notes, so it shapes the story from the first scene. You can edit it later in the Memory tab.')}</p></div>
      <div class="field"><label>${T('Constellations')}</label><div class="seg" id="spseg"><button type="button" data-sp="random" aria-pressed="true">${T('Random')}</button><button type="button" data-sp="on" aria-pressed="false">${T('Yes')}</button><button type="button" data-sp="off" aria-pressed="false">${T('None')}</button></div></div>
    </div>
    <details class="odds guide"><summary>${T('How to play')}</summary>
      <p>${T('<b>Commands</b> (type them in the input box)')}</p>
      <div class="g">${CMDS.map(c => `<code>${cmdName(c.id)}</code><span>${T(c.d)}</span>`).join('')}</div>
      <p>${T('<b>Input</b>: write speech and actions as they are, and put only thoughts or scene notes inside *asterisks*. No one in the scene hears what is inside asterisks. Quotes around speech are optional.')}</p>
      <p>${T('<b>Turns</b>: in a save with the dice on, risky actions and choices that show a chance roll a 1-100 die. <b>Lower is better</b>: at a 30% chance, 30 or under succeeds. An offered choice uses the chance it shows; for anything you type, the narrator sets the chance. A save with the dice off goes by what is plausible. Tap a stat chip under a turn to see why it changed; Rewrite asks for a reason and fixes that.')}</p>
      <p>${T('<b>Death</b>: after your life is tallied, you regress carrying one ability from it. You keep your memories.')}</p>
    </details>
    <details class="odds guide"><summary>${T('Odds')}</summary>
      <p>${T('<b>Standing and talent</b> are rolled separately: {odds}.', { odds: TIER_P.map(([t, p]) => `<code>${t}</code> ${p}%`).join(', ') })}</p>
      <p>${T("<b>World</b>: one of 11 at random (or pick one). <b>Difficulty</b> ★1-5 is rolled each life within the world's range. Monster Realm is always ★5.")}</p>
      <p>${T('<b>Arrival</b> (native, transmigrator, possessor) and <b>whether there are constellations</b> are also rolled by world. Possession is common in romance fantasy and palace worlds, constellations in hunter and tower worlds. If there are constellations, their stance toward ADMIN (indifferent, rivals, hostile, allies) is rolled too.')}</p>
      <p>${T('<b>Your profile</b> leans the world, race, arrival, and which standing and talent you get within a grade, but never the odds of a grade.')}</p>
    </details>
    <div class="row"><button class="btn primary" id="rollBtn">${T('Roll your fate')}</button>${app.saves.length && !inherit ? `<button class="btn ghost" id="toSaves">${T('See saved lives')}</button>` : ''}</div>
    <div id="fate"></div></div>`;
}
// the free setup's talent rows: add up to TALENT_MAX, remove any
function bindTalentRows() {
  const box = $('#talents'),
    add = $('#addTalent');
  if (!box || !add) return;
  const sync = () => {
    add.disabled = box.querySelectorAll('.trow').length >= TALENT_MAX;
    box.querySelectorAll('.tx').forEach(
      x =>
        (x.onclick = () => {
          x.closest('.trow').remove();
          sync();
        }),
    );
  };
  add.onclick = () => {
    if (box.querySelectorAll('.trow').length >= TALENT_MAX) return;
    box.insertAdjacentHTML('beforeend', talentRow(false));
    sync();
    const rows = box.querySelectorAll('.trow');
    const last = rows[rows.length - 1];
    if (tierLocked) lockTierSel(last.querySelector('.tt'));
    last.querySelector('.tn').focus();
  };
  sync();
}
// before the second life (and for anyone but the owner) free setup is closed and tiers are rolled, not chosen
async function lockFreeSetup(inherit) {
  const priv = await isPrivileged();
  const first = !inherit;
  const fb = $('#mseg [data-m="free"]');
  if (!priv) {
    if (first) {
      fb.disabled = true;
      fb.title = T('Custom setup opens from your second life');
      fb.textContent = T('Custom (from your 2nd life)');
    }
    tierLocked = true;
    lockTierSel($('#fOT'));
    document.querySelectorAll('#talents .tt').forEach(lockTierSel);
  }
}
// the profile box shows how much of its 600 characters is used
function bindProfileCount() {
  const ta = $('#prof'),
    pc = $('#profCount');
  const upd = () => {
    pc.textContent = T('{n} / 600 characters', { n: ta.value.length });
  };
  ta.oninput = upd;
  upd();
}
// the free-setup fields as rollLife takes them: the first talent row is the talent, the rest are extras
function readFreeSetup(sel) {
  const talents = [...document.querySelectorAll('#talents .trow')].map(r => ({
    tier: r.querySelector('.tt').value,
    name: r.querySelector('.tn').value.trim(),
    desc: r.querySelector('.td').value.trim(),
  }));
  const first = talents[0] || { tier: 'C', name: '', desc: '' };
  return {
    race: $('#fRace').value.trim(),
    originTier: $('#fOT').value,
    origin: $('#fOrigin').value.trim(),
    talentTier: first.tier,
    talent: first.name,
    talentDesc: first.desc,
    extraTalents: talents
      .slice(1)
      .filter(t => t.name)
      .slice(0, TALENT_MAX - 1),
    age: $('#fAge').value,
    sponsor: sel.sponsor || 'random',
  };
}
// the roll button: read the form, ask the narrator how the player's own setup leans (gacha only), roll, show the fate
async function rollFromForm(inherit, sel) {
  const rb = $('#rollBtn');
  if (rb.disabled) return;
  const name = inherit ? app.state.life.name : $('#nm').value.trim();
  if (!name) {
    toast(T('Enter a name'));
    $('#nm').focus();
    return;
  }
  const gender = inherit ? app.state.life.gender : sel.gender;
  const free = sel.mode === 'free' ? readFreeSetup(sel) : null;
  const profTxt = ($('#prof').value || '').trim().slice(0, 600);
  let aff = null;
  if (profTxt && !free) {
    rb.disabled = true;
    rb.textContent = T('Reading your profile...');
    try {
      aff = await profileAffinity(profTxt);
    } catch (e) {
      noteIgnored('new life: profile affinity (rolling without it)', e);
    }
    rb.disabled = false;
    rb.textContent = T('Roll your fate');
  }
  const life = rollLife(name, gender, sel.world, free, aff);
  life.profile = profTxt;
  const wn = $('#worldNote');
  if (wn && sel.mode === 'free') life.seedNotes = wn.value.trim().slice(0, 1200); // the save's first user notes, so the opening scene knows them
  rememberFormDefaults(life);
  app.pendingRoll = { life, inherit, lang: storyLang() }; // the language the fate was rolled in, even if the screen changes before starting
  revealFate(life, inherit);
}
// the form's answers become the next new game's defaults (each save keeps the copy it started with)
function rememberFormDefaults(life) {
  const settings = app.settings;
  let changed = false;
  if ($('#profSave').checked && settings.profile !== life.profile) {
    settings.profile = life.profile;
    changed = true;
  }
  const dm = $('#diceMode');
  if (dm && settings.dice !== dm.checked) {
    settings.dice = dm.checked;
    changed = true;
  }
  if (life.seedNotes !== undefined && settings.worldNote !== life.seedNotes) {
    settings.worldNote = life.seedNotes;
    changed = true;
  }
  if (changed) saveSettings().catch(e => noteIgnored('new-life: dset settings', e));
}
function wpick(items) {
  const tot = items.reduce((a, [, p]) => a + p, 0);
  let r = rnd() * tot;
  for (const [x, p] of items) {
    if ((r -= p) < 0) return x;
  }
  return items[items.length - 1][0];
}
const AFF_FALLBACK = [
  [/무협|강호|내공|검객|문파|murim|wuxia|martial art|cultivat/i, 'murim'],
  [/헌터|게이트|각성|hunter|\bgate|awaken/i, 'hunter'],
  [/게임|레벨|유저|vr|mmo|\bgame|\blevel/i, 'vrmmo'],
  [/학원|아카데미|학생|입학|academy|school|student/i, 'academy'],
  [/사이버|해킹|안드로이드|기업|cyber|hack|android|megacorp/i, 'cyber'],
  [/영애|황녀|공녀|악녀|북부 대공|young lady|princess|villainess|grand duke/i, 'rofan'],
  [/좀비|멸망|생존|zombie|apocalyp|surviv/i, 'apoc'],
  [/후궁|황궁|조정|궁녀|harem|palace|imperial court|concubine/i, 'palace'],
  [/전이|트럭|소환|isekai|truck|summon/i, 'isekai'],
  [/마왕|용사|기사|마법|demon king|\bhero|knight|magic/i, 'fantasy'],
];
async function profileAffinity(text) {
  text = String(text || '').trim();
  if (!text) return null;
  if (app.settings.profileAff && app.settings.profileAff.text === text) return app.settings.profileAff.data;
  let data = null;
  if (platform.sample) {
    try {
      data = await Promise.race([
        platform.sample.json(
          fillTemplate(pr('affinity'), {
            worlds: WORLDS.map(w => w.id + '=' + tIn(storyLang(), w.name)).join(', '),
            profile: text,
          }),
          {
            modelTier: 'quick',
            cache: false,
          },
        ),
        new Promise(r => setTimeout(() => r(null), 7000)),
      ]);
    } catch (e) {
      data = null;
    }
  }
  if (!data || typeof data !== 'object') {
    data = {
      worlds: [...new Set(AFF_FALLBACK.filter(([re]) => re.test(text)).map(([, w]) => w))].slice(0, 3),
      races: [],
      keywords: [],
    };
  }
  const entryHint = /빙의|원작|possess|original (novel|story)|inside (a|the) novel/i.test(text)
    ? 'possess'
    : /전이|이세계로|떨어[졌진]|transport|transmigrat|another world|isekai/i.test(text)
      ? 'transfer'
      : null; // the player's own words about how they arrived
  data = {
    entry: entryHint,
    worlds: liveWorldIds(Array.isArray(data.worlds) ? data.worlds : []).slice(0, 3),
    races: (Array.isArray(data.races) ? data.races : []).map(String).slice(0, 3),
    keywords: (Array.isArray(data.keywords) ? data.keywords : []).map(String).filter(Boolean).slice(0, 8),
  };
  app.settings.profileAff = { text, data };
  saveSettings().catch(e => noteIgnored('new-life: dset settings', e));
  return data;
}
function pickWorld(gender, aff) {
  const w = WORLDS.map(x => [
    x,
    (x.id === 'rofan' ? (gender === GENDER.FEMALE ? 1.6 : gender === GENDER.MALE ? 0.7 : 1) : 1) *
      (aff && aff.worlds.includes(x.id) ? 3 : 1),
  ]);
  const tot = w.reduce((a, [, p]) => a + p, 0);
  let r = rnd() * tot;
  for (const [x, p] of w) {
    if ((r -= p) < 0) return x;
  }
  return WORLDS[0];
}
function affPick(list, text, kw) {
  if (!kw || !kw.length) return pick(list);
  const sc = x => kw.filter(k => text(x).toLowerCase().includes(k.toLowerCase())).length;
  const top = Math.max(...list.map(sc));
  if (top > 0 && rnd() < 0.7) return pick(list.filter(x => sc(x) === top));
  return pick(list);
}
// world, race, origin and talent are stored in the story's language
export let rollLife = function rollLife(name, gender, worldChoice, free, aff) {
  const L = storyLang();
  const tr = x => tIn(L, x);
  const table = (worldChoice !== 'random' && WORLDS.find(w => w.id === worldChoice)) || pickWorld(gender, aff);
  const world = worldIn(table, L);
  const entry = rollEntry(table, aff),
    sponsor = rollSponsor(table, free && free.sponsor, setting('adminPersona'));
  const rl = (
    entry === 'transfer' ? TRANSFER_RACES[table.from ? 'other' : 'modern'] : RACES[table.id] || [N_('Human')]
  ).map(tr);
  const rw =
    aff && aff.races.length
      ? rl.map(r => {
          const lr = r.toLowerCase();
          const base = lr.replace(/\(.*\)/, '').trim();
          const hit = aff.races.map(a => a.toLowerCase()).some(a => a && (lr.includes(a) || a.includes(base)));
          return [r, hit ? 4 : 1];
        })
      : rl.map(r => [r, 1]);
  const dr = Array.isArray(world.diff) ? world.diff : [3, 3];
  const diff = dr[0] + Math.floor(rnd() * (dr[1] - dr[0] + 1));
  let race = rnd() < 0.01 ? tIn(L, '[No data (ERROR)]') : wpick(rw);
  let ot = rollTier(),
    tt = rollTier();
  const kw = aff ? [...aff.keywords, ...aff.races] : [];
  let origin = tr(affPick(ORIGINS[ot], tr, kw));
  let [tn, td] = affPick(TALENTS[tt], x => tr(x[0]) + ' ' + tr(x[1]), kw).map(tr);
  let age = pick([0, 0, 7, 12, 16, 17, 19, 24, 31]);
  if (free) {
    if (free.race) race = free.race.slice(0, 20);
    ot = TIERS.includes(free.originTier) ? free.originTier : ot;
    origin = free.origin || tr(pick(ORIGINS[ot]));
    tt = TIERS.includes(free.talentTier) ? free.talentTier : tt;
    if (free.talent) {
      tn = free.talent;
      td = free.talentDesc || '';
    } else {
      [tn, td] = pick(TALENTS[tt]).map(tr);
    }
    if (free.age !== '') age = Math.max(0, Math.min(90, parseInt(free.age) || 0));
  }
  const extra =
    free && Array.isArray(free.extraTalents)
      ? free.extraTalents
          .map(t => ({
            name: String(t.name).slice(0, 30),
            grade: TIERS.includes(t.tier) ? t.tier : 'C',
            desc: String(t.desc || '').slice(0, 80),
          }))
          .filter(t => t.name)
      : [];
  return {
    name,
    gender,
    world,
    race,
    diff,
    originTier: ot,
    origin,
    talentTier: tt,
    talent: { name: tn, grade: tt, desc: td },
    age,
    free: !!free,
    entry,
    sponsor,
    ...(extra.length ? { extraTalents: extra } : {}),
  };
};
// again: redraw without the reveal animation
function revealFate(life, inherit, again) {
  const cards = [
    [
      T('World'),
      life.world.name,
      `${T('Difficulty')} ${'★'.repeat(life.diff || 3)}${'☆'.repeat(5 - (life.diff || 3))}. ${life.world.desc ? life.world.desc + '. ' : ''}${life.world.risk}. ${life.world.opp}.`,
      null,
    ],
    [T('Race'), life.race, '', null],
    [T('Standing'), life.origin, '', life.originTier],
    [T('Talent'), life.talent.name, life.talent.desc, life.talentTier],
  ];
  if (life.entry && life.entry !== 'native')
    cards.push([
      T('Arrival'),
      T(ENTRY_LABEL[life.entry]),
      life.entry === 'possess'
        ? T('In the body of a character from a novel about this world. You know how the story goes')
        : T('Fell here from {from}. Nothing makes sense, not even the language', {
            from: life.world.from || T('modern-day Earth'),
          }),
      null,
    ]);
  if (life.sponsor)
    cards.push([
      T('Constellations'),
      T('This world has constellations'),
      T('Stance toward ADMIN: {stance}. The channel is still closed', {
        stance: T(STANCE_LABEL[life.sponsor.stance] || life.sponsor.stance),
      }),
      null,
    ]);
  const f = $('#fate');
  f.innerHTML = `<div class="fate">${cards.map((c, i) => `<div class="card${again ? '' : ' flip'} ${c[3] ? 'glow-' + c[3] : ''}" style="animation-delay:${again ? 0 : i * 0.35}s"><small>${c[0]}</small>${c[3] ? `<span class="g ${c[3]}">${c[3]}</span>` : ''}<div class="v">${esc(c[1])}</div>${c[2] ? `<div class="d">${esc(c[2])}</div>` : ''}</div>`).join('')}</div>
   ${inherit && inherit.name ? `<div class="item fate-note"><div class="m">${T('Inherited')}</div><div class="t"><span class="tier ${inherit.grade}">${inherit.grade}</span> ${esc(inherit.name)}</div><div class="m">${esc(inherit.desc)}</div></div>` : ''}
   <div class="row fate-actions"><button class="btn primary" id="acceptBtn">${T('Begin with this fate')}</button></div>`;
  if (!again)
    cards.forEach((c, i) =>
      setTimeout(
        () => {
          if (c[3]) cueReveal(c[3]);
          else cueBlip();
        },
        i * 350 + 150,
      ),
    );
  $('#rollBtn').disabled = true;
  $('#rollBtn').textContent = life.free ? T('Your setup is set') : T('Your fate is sealed');
  document
    .querySelectorAll('#wseg button,#gseg button,#mseg button,#freeBox input,#freeBox select,#freeBox button')
    .forEach(b => (b.disabled = true));
  $('#acceptBtn').onclick = async () => {
    if (!platform.sample && !(await ensureSample())) {
      toast(T('Claude needs to be connected'));
      return;
    }
    beginLife();
  };
}
async function beginLife() {
  const { life, inherit, lang } = app.pendingRoll;
  app.pendingRoll = null;
  const b = BASE[life.originTier];
  const skills = [
    { ...life.talent, src: SKILL_SRC.TALENT },
    ...(life.extraTalents || []).filter(t => t.name !== life.talent.name).map(t => ({ ...t, src: SKILL_SRC.TALENT })),
  ];
  const seed = (life && life.seedNotes) || '';
  let past = [],
    lifeNo = 1,
    userNotes = seed,
    lore = {};
  if (life) delete life.seedNotes;
  if (inherit) {
    past = app.state.pastLives;
    lifeNo = app.state.lifeNo + 1;
    userNotes = app.state.userNotes || '';
    if (seed && !userNotes.includes(seed)) userNotes = (userNotes ? userNotes + '\n' : '') + seed;
    userNotes = userNotes.slice(0, 1200);
    if (inherit.name)
      skills.push({ name: inherit.name, grade: inherit.grade, desc: inherit.desc, src: SKILL_SRC.INHERITED });
    for (const s of app.state.skills.filter(s => s.src === SKILL_SRC.INHERITED))
      if (!skills.find(x => x.name === s.name)) skills.push(s);
  }
  life.money = moneyFor(lang);
  app.state = {
    v: 1,
    goldV: 2,
    rules: inherit ? app.state.rules : snapshotRules(),
    lang,
    life,
    lifeNo,
    stats: Object.assign(
      { hp: b.hp, maxHp: b.hp, power: b.power, gold: b.gold * currencyOf(life)[1], fame: 0, age: life.age },
      rollSubStats(life.originTier),
    ),
    title: '',
    skills,
    lifeStart: inherit ? app.state.next : 0,
    turnNo: 0,
    quests: [],
    lore,
    relations: {},
    cast: {},
    clock: { day: 0, date: '', time: '', weather: '', place: '' },
    murim: life.world.id === 'murim' ? initMurim(life.originTier) : null,
    summaries: inherit ? app.state.summaries : [],
    summarizedUpto: inherit ? app.state.summarizedUpto : -1,
    stateNote: '',
    pastLives: past,
    userNotes,
    dead: false,
    next: inherit ? app.state.next : 0,
  };
  if (!inherit) {
    app.currentSave = {
      id: uid(),
      name: T("{name}'s Fate", { name: life.name }),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      parent: null,
      lifeNo: 1,
      turns: 0,
      store: 2,
      pages: 0,
    };
    turnStore.tail = null;
    NEW_SAVES.add(app.currentSave.id);
    app.turns = [];
    app.settings.lastSave = app.currentSave.id;
    saveSettings().catch(e => noteIgnored('new-life: dset settings', e));
  } else {
    app.currentSave.lifeNo = lifeNo;
  }
  await pushTurn({
    kind: 'system',
    text: tIn(storyLang(), 'Life {n}: {world}, {race}, {origin} ({tier}), talent {talent} ({talentTier})', {
      n: lifeNo,
      world: life.world.name,
      race: life.race,
      origin: life.origin,
      tier: life.originTier,
      talent: life.talent.name,
      talentTier: life.talentTier,
    }),
    snap: clone(app.state),
  });
  app.state.introText = fillTemplate(pr('intro'), {
    opening: inherit ? pr('introOpeningRegress') : pr('introOpeningFirst'),
    world: life.world.name,
    race: life.race,
    origin: life.origin,
    originTier: life.originTier,
    talent: life.talent.name,
    talentTier: life.talentTier,
    extra: lifeExtra(life),
  });

  showPlay();
  await exclusive(() => runTurn(app.state.introText, null, { intro: true }));
}

// the functions above that tests may replace (window.DR.mock): each setter swaps the binding every caller uses
export const mocks = {
  rollLife: f => (rollLife = f),
};
