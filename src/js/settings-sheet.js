/* ============ settings sheet ============ */
import { host } from './host.js';
import { $, esc, IGNORED, noteIgnored, nowIso, toast } from './util.js';
import { platform } from './db.js';
import { app, APP_VERSION } from './app.js';
import { saveSettings, setting, SETTING_DEFAULTS, storyLang } from './settings.js';
import { persist } from './persistence.js';
import { LANG_NAMES, langOptions, locale, N_, setUiLang, SOURCE_LANG, T, translateStatic, uiLang } from './i18n.js';
import { ERRLOG } from './diag.js';
import { GROWTH_LEVELS, growthLevel, lifeDiff, rule } from './rules.js';
import { closeSheet, openSheet } from './sheet.js';
import { activeTab, applyDiscreet, showTab } from './shell.js';
import { audioInit, cueSkill } from './sound.js';
import { charSets } from './images.js';
import { renderStrip } from './status.js';
import { captureWords, maskNames, renderLog, syncInputHint } from './log.js';
import { redrawNewLifeForm } from './new-life.js';
import { redrawNoSample } from './boot.js';
import { applyEnterHint, enterPref, setEnterPref, syncEnterTog } from './composer.js';
import { openUpdateSheet } from './update.js';
import { ADMIN_PERSONAS, promptStats, recentBudget, recentLine } from './prompt.js';

let lastTierCheck = null; // what the platform actually served for the tier we asked (a plan may substitute a cheaper one)

export function openSettingsSheet() {
  openSheet(
    `<h3>${T('Settings')}</h3>${settingsHtml()}<div class="row settings-actions"><button class="btn" data-close>${T('Close')}</button></div>`,
  );
  bindSettings($('#sheetInner'));
}
const options = list => list.map(([v, label]) => `<option value="${v}">${T(label)}</option>`).join('');
const tierProbeHtml = c =>
  T('Last check: asked for {asked} → <b>{applied}</b> served ({at})', {
    asked: esc(c.asked),
    applied: esc(c.applied),
    at: c.at,
  });
function settingsHtml() {
  const langLabel = uiLang() === SOURCE_LANG ? 'Language' : `${T('Language')} · Language`;
  return `<div class="row verrow"><span class="muted">${T('Version v{version}', { version: esc(APP_VERSION) })}</span><button class="btn ghost" id="updBtn" type="button">${T('Check for updates')}</button></div>
    <div class="field ui-lang-field"><label for="uiLangSel">${langLabel}</label><select id="uiLangSel">${langOptions()}</select></div>
    <div class="row"><div class="field grow"><label for="tierSel">${T('Narration model')}</label><select id="tierSel">${options(
      [
        ['quick', N_('Fast (quick)')],
        ['default', N_('Standard (default)')],
        ['complex', N_('Deep (complex)')],
      ],
    )}</select></div>
    <div class="field grow"><label for="lenSel">${T('Narration length')}</label><select id="lenSel">${options([
      ['short', N_('Short')],
      ['normal', N_('Up to the model')],
      ['long', N_('Long')],
    ])}</select></div></div>
    <p class="muted tier-probe"><span id="tierProbe">${lastTierCheck ? tierProbeHtml(lastTierCheck) : T('Your plan may substitute a lower tier for the narration model.')}</span><button class="btn ghost chip-sm" id="tierCheck">${T('Check now')}</button></p>
    <div class="field recent-field"><label for="recentSel">${T('Recent memory (how much goes in word for word; older turns are summarized)')}</label><select id="recentSel">${options(
      [
        ['20000', N_('Small (20KB)')],
        ['40000', N_('Medium (40KB, default)')],
        ['80000', N_('Large (80KB)')],
        ['150000', N_('Very large (150KB)')],
      ],
    )}</select><p class="muted recent-note"><span id="recentNow">${recentLine()}</span>${T('Short turns fit more, long turns fewer. At 150KB replies slow down and may hit the limit.')}</p></div>
    <div class="row lang-row"><div class="field grow"><label for="langSel">${app.state ? T('Story language (this save)') : T('Story language for new games')}</label><select id="langSel">${app.state ? '' : `<option value="">${T('Same as the screen')}</option>`}${langOptions(Object.keys(LANG_NAMES))}</select></div>
    <label class="row opt lang-tip"><input type="checkbox" id="langTip"> ${T('Show corrections of my input')}</label></div>
    <label class="row opt settings-opt"><input type="checkbox" id="discreet"> ${T('Discreet mode: the title becomes Claude, and images, the status window, colors and sounds are hidden (or tap the title three times)')}</label>
    <div id="discreetNav" class="row discreet-nav hidden">${[
      ['play', N_('Play')],
      ['saves', N_('Saves')],
      ['memory', N_('Memory')],
      ['images', N_('Images')],
      ['hall', N_('Hall')],
    ]
      .map(([go, label]) => `<button class="btn" data-go="${go}">${T(label)}</button>`)
      .join('')}</div>
    <div class="field settings-field"><label for="adminSel">${T('ADMIN persona')}</label><select id="adminSel">${Object.entries(
      ADMIN_PERSONAS(),
    )
      .map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`)
      .join('')}</select></div>
    <div class="field admin-custom hidden" id="adminCustomBox"><label for="adminCustom">${T('ADMIN description (write your own)')}</label><textarea id="adminCustom" rows="4" maxlength="600" placeholder="${esc(T("e.g. ADMIN is a retired demon king who calls the player 'successor candidate'..."))}">${esc(app.settings.adminCustom || '')}</textarea></div>
    <div class="field settings-field"><label for="enterSel">${T('Enter key (saved in this browser only)')}</label><select id="enterSel">${options(
      [
        ['auto', N_('Auto (sends on PC, new line on phones)')],
        ['always', N_('Enter sends, Shift+Enter for a new line')],
        ['never', N_('Enter adds a new line, Shift+Enter sends')],
      ],
    )}</select></div>
    <label class="row opt settings-opt after-field"><input type="checkbox" id="knowGuard"> ${T("Limit outside knowledge: knowledge from the real world, a past life or the character's home world never turns into power or money in one go; it hits walls while you are weak and opens up as you grow")}</label>
    <label class="row opt settings-opt after-field"><input type="checkbox" id="gambler"> ${T("Gambler's Stone: any turn can roll a jackpot (sure success + a big reward) or a doom (sure failure + a big penalty)")}</label>
    <div class="field gambler-odds"><label for="gamblerP">${T('Chance of a jackpot, and of a doom')}</label><select id="gamblerP">${options(
      [
        ['0.1', N_('10% each (20% together)')],
        ['0.15', N_('15% each (30% together)')],
        ['0.25', N_('25% each (50% together)')],
      ],
    )}</select></div>
    <div class="field cap-box">
      <label class="row opt"><input type="checkbox" id="capOn"> ${T('Capture mode: hides names on screen only (the record is unchanged)')}</label>
      <div class="row cap-row"><select id="capMode">${options([
        ['blur', N_('Blur')],
        ['alias', N_('Another name')],
      ])}</select><input id="capAlias" placeholder="{user}" maxlength="12" class="cap-alias"></div>
      <input id="capWords" placeholder="${esc(T("Words to hide (comma-separated). Empty: the character's name"))}" class="cap-words">
    </div>
    <div class="field settings-field"><label for="statusSel">${T('Status window numbers')}</label><select id="statusSel">${options(
      [
        ['auto', N_('Auto: in worlds with a system, after awakening')],
        ['always', N_('Always shown')],
        ['awaken', N_('After awakening, in every world')],
        ['never', N_('Hidden: no numbers even after awakening, story only')],
      ],
    )}</select></div>
    <div class="field settings-field"><label for="growthSel">${T('Growth pace (how generous stat growth is)')}</label><select id="growthSel">${options(
      [
        ['auto', N_("Auto: by the world's difficulty and ADMIN's personality")],
        ['stingy', N_('Stingy: only at big moments, 8-turn cooldown per stat')],
        ['normal', N_('Normal')],
        ['generous', N_('Generous: 1.5x caps')],
      ],
    )}</select><p class="muted field-note" id="growthNow"></p></div>
    <div class="field settings-field near"><label for="questSel">${T('Quest style')}</label><select id="questSel">${options(
      [
        ['board', N_('Guild board (paper on wood)')],
        ['ui', N_('Game quest window (dark, gold trim)')],
      ],
    )}</select></div>
    <div class="field settings-field near"><label for="newsSel">${T('News style')}</label><select id="newsSel">${options(
      [
        ['broadcast', N_('TV news (navy header)')],
        ['paper', N_('Newspaper (serif)')],
      ],
    )}</select></div>
    <div class="field settings-field near"><label for="boardSel">${T('Board style')}</label><select id="boardSel">${options(
      [
        ['auto', N_('Auto: by story language')],
        ['dc', N_('DC Inside (Korean forum)')],
        ['reddit', N_('Reddit')],
        ['5ch', N_('5ch (Japanese threads)')],
        ['nico', N_('Niconico (comments across a video)')],
      ],
    )}</select></div>
    <div class="field settings-field near"><label for="chatSel">${T('Messenger style')}</label><select id="chatSel">${options(
      [
        ['auto', N_('Auto: by story language')],
        ['kakao', N_('KakaoTalk')],
        ['whatsapp', N_('WhatsApp')],
        ['line', N_('LINE')],
      ],
    )}</select></div>
    <label class="row opt settings-opt"><input type="checkbox" id="wdark"> ${T('Dark mode for messenger and board widgets too')}</label>
    <label class="row opt settings-opt"><input type="checkbox" id="soundOn"> ${T('Sound effects (fate reveal, realm and title fanfares, skills, items and money, quest complete, death, Life Review)')}</label>
    <details class="diag-box"><summary class="muted">${T('Diagnostics')}</summary><div id="diag" class="muted diag-body">${T('Checking...')}</div></details>
    <details class="diag-box"><summary class="muted">${T('Recent errors')} ${ERRLOG.length ? `(${ERRLOG.length})` : ''}</summary><div class="diag-body diag-log">${ERRLOG.map(e => `[${e.t}] ${e.stage} ${e.code} ${esc(e.msg)}${e.text ? '\n  → ' + esc(e.text) : ''}`).join('\n\n') || T('None')}</div></details>
    <details class="diag-box"><summary class="muted">${T('Skipped errors')} ${IGNORED.length ? `(${IGNORED.length})` : ''}</summary><div class="diag-body diag-log">${IGNORED.map(e => `[${e.t}] ${esc(e.where)}: ${esc(e.msg)}`).join('\n') || T('None')}</div></details>
    <p class="muted settings-help">${T('Narration model: Fast is light and quick; Deep uses the strongest model.<br>Narration length: by default the model decides.<br>Story language: each save keeps the one it began in, and narration, dialogue, choices and widgets all come in it.<br>Input corrections: shows one line fixing what you wrote (spelling and spacing for Korean, grammar and word choice for English and Japanese).<br>All take effect from the next turn.')}</p>`;
}
async function runDiag(el) {
  const out = [];
  out.push(T('Version: v{version}', { version: APP_VERSION }));
  out.push(T('Host: {id}', { id: host().id }));
  out.push(T('Save path: {path}', { path: platform.userPath }));
  out.push(
    T('Capabilities: {list}', {
      list: `db ${!!(platform.db && !platform.memMode)}, sample ${!!platform.sample}, assets ${!!platform.assets}, user ${!!platform.user}`,
    }),
  );
  out.push(
    T('Mode: {mode}', {
      mode: platform.memMode
        ? T('Preview (not saved)')
        : platform.localMode
          ? T('This device only')
          : T('Saved on the server'),
    }),
  );
  try {
    if (platform.user) {
      out.push(T('Owner: {v}', { v: await platform.user.isOwner() }));
      out.push(T('Shared data write: {v}', { v: await platform.user.can('data.write') }));
      out.push(T('Image write: {v}', { v: await platform.user.can('assets.write') }));
    } else out.push(T('No user info'));
  } catch (e) {
    out.push(T('Permission check failed: {err}', { err: e.code || e.message }));
  }
  try {
    await platform.shared.doc('images/_probe').set({ t: nowIso() });
    await platform.shared.doc('images/_probe').delete();
    out.push(T('Image list write: OK'));
  } catch (e) {
    out.push(T('Image list write: failed ({err})', { err: e.code || e.message }));
  }
  try {
    await platform.shared.doc('sets/_probe').set({ t: nowIso() });
    await platform.shared.doc('sets/_probe').delete();
    out.push(T('Set write: OK'));
  } catch (e) {
    out.push(T('Set write: failed ({err})', { err: e.code || e.message }));
  }
  out.push(
    T('{images} images, {sets} sets, {cards} set cards', {
      images: app.images.length,
      sets: Object.keys(charSets()).length,
      cards: Object.keys(app.setMeta).length,
    }),
  );
  if (el) el.textContent = out.join('\n');
}

// One control per setting: `show` maps the stored value to the control, `parse` back, `apply` runs before the save,
// `saved` is the toast's English (translated when shown).
const NEXT_TURN = N_('Saved. From the next turn');
const SAVED = N_('Saved');
const redrawLog = () => {
  if (app.state) renderLog('keep');
};
const PLAIN_SETTINGS = [
  { id: 'tierSel', key: 'tier', saved: SAVED },
  { id: 'lenSel', key: 'len', saved: SAVED },
  {
    id: 'recentSel',
    key: 'recentBytes',
    show: () => recentBudget(),
    parse: Number,
    apply: q => showRecentNow(q),
    saved: NEXT_TURN,
  },
  { id: 'langTip', key: 'langTip' },
  {
    id: 'discreet',
    key: 'discreet',
    apply: () => {
      applyDiscreet();
      if (app.state) renderLog();
    },
  },
  {
    id: 'adminSel',
    key: 'adminPersona',
    apply: q => {
      showAdminCustom(q);
      showGrowthNow(q);
    },
    saved: NEXT_TURN,
  },
  { id: 'adminCustom', key: 'adminCustom', show: v => v || '', parse: v => v.trim(), saved: SAVED },
  { id: 'knowGuard', key: 'knowledgeGuard', show: v => v !== false, saved: NEXT_TURN },
  {
    id: 'gambler',
    key: 'gambler',
    saved: v => (v ? N_("Gambler's Stone on. From the next turn") : N_("Gambler's Stone off")),
  },
  { id: 'gamblerP', key: 'gamblerP', parse: Number },
  {
    id: 'statusSel',
    key: 'statusMode',
    apply: () => {
      renderStrip();
      redrawLog();
    },
  },
  { id: 'growthSel', key: 'growth', apply: q => showGrowthNow(q), saved: NEXT_TURN },
  {
    id: 'questSel',
    key: 'questStyle',
    apply: redrawLog,
    saved: SAVED,
  },
  {
    id: 'newsSel',
    key: 'newsStyle',
    apply: redrawLog,
    saved: SAVED,
  },
  { id: 'boardSel', key: 'boardStyle', apply: redrawLog, saved: SAVED },
  { id: 'chatSel', key: 'chatStyle', apply: redrawLog, saved: SAVED },
  { id: 'wdark', key: 'wdark', apply: () => applyDiscreet() },
  {
    id: 'soundOn',
    key: 'sound',
    show: v => v !== false,
    apply: (q, on) => {
      if (!on) return;
      audioInit(); // inside the tap, so the browser lets the sound start
      setTimeout(cueSkill, 50);
    },
  },
];

function bindSettings(root) {
  const q = id => root.querySelector('#' + id);
  for (const c of PLAIN_SETTINGS) bindPlainSetting(q, c);
  bindUiLang(q);
  bindStoryLang(q);
  showAdminCustom(q);
  bindTierCheck(q);
  bindDiscreetNav(q);
  bindEnterKey(q);
  bindCapture(q);
  noteFrozenRules(q);
  notePromptSize(q);
  showGrowthNow(q);
  q('updBtn').onclick = openUpdateSheet;
  q('diag')
    .closest('details')
    .addEventListener('toggle', e => e.target.open && runDiag(q('diag')), { once: true });
  if (host().bindSettings) host().bindSettings(root);
}
function bindPlainSetting(q, { id, key, show, parse, apply, saved }) {
  const el = q(id);
  const box = el.type === 'checkbox';
  const shown = show ? show(app.settings[key]) : key in SETTING_DEFAULTS ? setting(key) : app.settings[key];
  if (box) el.checked = !!shown;
  else el.value = String(shown ?? '');
  el.onchange = async () => {
    const v = box ? el.checked : parse ? parse(el.value) : el.value;
    app.settings[key] = v;
    if (apply) apply(q, v);
    try {
      await saveSettings();
    } catch (e) {
      toast(T('Save failed: {err}', { err: e.code || e.message }));
      return;
    }
    const msg = typeof saved === 'function' ? saved(v) : saved;
    if (msg) toast(T(msg));
  };
}
function bindUiLang(q) {
  const el = q('uiLangSel');
  el.value = uiLang();
  el.onchange = () => {
    const top = $('#sheetInner') ? $('#sheetInner').scrollTop : 0;
    chooseUiLang(el.value);
    openSettingsSheet();
    if ($('#sheetInner')) $('#sheetInner').scrollTop = top;
  };
}
// With a save open the story language is that save's (the screen language never changes it); otherwise it is the
// language new games start in, by default the screen's.
function bindStoryLang(q) {
  const el = q('langSel');
  el.value = app.state ? storyLang() : app.settings.lang || '';
  el.onchange = async () => {
    try {
      if (app.state) {
        app.state.lang = el.value;
        await persist();
      } else {
        app.settings.lang = el.value || null;
        await saveSettings();
      }
    } catch (e) {
      toast(T('Save failed: {err}', { err: e.code || e.message }));
      return;
    }
    redrawLog(); // 'auto' board and messenger styles follow it
    toast(
      app.state ? T('Saved. This save continues in it from the next turn; earlier turns stay as written') : T(SAVED),
    );
  };
}
// the player picks a screen language: kept in the settings and applied
export function chooseUiLang(lang) {
  app.settings.uiLang = lang;
  applyUiLang(lang);
  saveSettings().catch(e => noteIgnored('settings: save the screen language', e));
}
// redraws everything on screen; lines already saved keep the language they were written in
export function applyUiLang(lang) {
  setUiLang(lang);
  translateStatic();
  applyDiscreet();
  redrawNoSample();
  if ($('#log .newlife')) redrawNewLifeForm();
  else if (app.state) {
    renderStrip();
    renderLog('keep');
    syncInputHint();
  }
  const tab = activeTab();
  if (tab !== 'play') showTab(tab);
}
function showAdminCustom(q) {
  q('adminCustomBox').classList.toggle('hidden', app.settings.adminPersona !== 'custom');
}
function showRecentNow(q) {
  const now = q('recentNow');
  if (now && app.state) now.textContent = recentLine();
}
function showGrowthNow(q) {
  const el = q('growthNow');
  if (!el) return;
  const L = growthLevel();
  el.textContent = app.state
    ? T('In this life: {growth} (difficulty {stars}, ADMIN {persona})', {
        growth: T(L.name),
        stars: '★'.repeat(lifeDiff()),
        persona: (ADMIN_PERSONAS()[setting('adminPersona')] || {}).name || '',
      })
    : '';
}
// asks for the chosen tier once and shows which tier the platform actually used
function bindTierCheck(q) {
  q('tierCheck').onclick = async () => {
    if (!platform.sample) {
      toast(T("Can't call Claude"));
      return;
    }
    const b = q('tierCheck');
    b.disabled = true;
    b.textContent = T('Checking');
    try {
      const asked = setting('tier');
      const r = await platform.sample('Reply with the single word ok.', { modelTier: asked, cache: false });
      lastTierCheck = {
        asked,
        applied: (r && r.modelTierApplied) || '?',
        at: new Date().toLocaleTimeString(locale()),
      };
      q('tierProbe').innerHTML = tierProbeHtml(lastTierCheck);
      toast(T('Asked for {asked} → {applied} served', lastTierCheck));
    } catch (e) {
      toast(T('Check failed: {err}', { err: e.code || e.message }));
    }
    b.disabled = false;
    b.textContent = T('Check now');
  };
}
// in discreet mode the tab bar is hidden, so the sheet offers the tabs
function bindDiscreetNav(q) {
  const dn = q('discreetNav');
  if (!dn) return;
  dn.classList.toggle('hidden', !app.settings.discreet);
  dn.querySelectorAll('[data-go]').forEach(
    b =>
      (b.onclick = () => {
        closeSheet();
        showTab(b.dataset.go);
      }),
  );
}
function bindEnterKey(q) {
  q('enterSel').value = enterPref() || 'auto';
  q('enterSel').onchange = e => {
    setEnterPref(e.target.value === 'auto' ? null : e.target.value);
    applyEnterHint();
    syncEnterTog();
  };
}
// capture mode masks names on screen only: on/off, blur or an alias, and which words
function bindCapture(q) {
  const c = (app.settings.capture = app.settings.capture || {});
  q('capOn').checked = !!c.on;
  q('capMode').value = c.mode || 'blur';
  q('capAlias').value = c.alias || '';
  q('capWords').value = c.words || '';
  q('capWords').placeholder = T("Words to hide (comma-separated). Empty: the character's name ({n})", {
    n: captureWords().length,
  });
  const save = async () => {
    c.on = q('capOn').checked;
    c.mode = q('capMode').value;
    c.alias = q('capAlias').value.trim();
    c.words = q('capWords').value;
    await saveSettings().catch(e => noteIgnored('settings: dset capture', e));
    if (!c.on || c.mode) {
      if (app.state) {
        renderLog('keep');
        renderStrip();
      }
      maskNames(document.body);
    }
  };
  for (const id of ['capOn', 'capMode', 'capAlias', 'capWords']) q(id).onchange = save;
}
// the rules a save froze when it started: changing the control only affects new saves, so say what this one uses
function noteFrozenRules(q) {
  if (!app.state) return;
  const FROZEN = {
    growth: ['growthSel', v => T((GROWTH_LEVELS[v] || { name: N_('Auto') }).name)],
    knowledgeGuard: ['knowGuard', v => (v === false ? T('Off') : T('On'))],
    gambler: [
      'gambler',
      v => (v ? T('On ({n}%)', { n: Math.round((Number(rule('gamblerP')) || 0.15) * 100) }) : T('Off')),
    ],
  };
  for (const [k, [id, label]] of Object.entries(FROZEN)) {
    const el = q(id);
    if (!el) continue;
    const host = el.closest('label,.field') || el.parentElement;
    const n = document.createElement('p');
    n.className = 'muted frozen-note';
    n.textContent = T('This save: {value} (fixed at the start; changes apply to new saves)', { value: label(rule(k)) });
    host.after(n);
  }
}
function notePromptSize(q) {
  const el = document.createElement('p');
  el.className = 'muted prompt-size';
  const n = promptStats.length;
  el.textContent = n
    ? T(
        'Prompt size: last turn about {last} tokens, average of the last {n} {n|turn|turns} about {avg} tokens (estimate)',
        {
          last: promptStats[n - 1].toLocaleString(locale()),
          n,
          avg: Math.round(promptStats.reduce((a, b) => a + b, 0) / n).toLocaleString(locale()),
        },
      )
    : T('Prompt size: no turns yet in this session');
  q('growthSel').closest('.field').after(el);
}
