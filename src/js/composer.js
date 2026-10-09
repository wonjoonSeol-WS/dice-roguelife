/* ============ composer & slash menu ============ */
import { $, toast } from './util.js';
import { allCmdNames, cmdName, cmdNames, CMDS } from './data.js';
import { app } from './app.js';
import { openStatus } from './status.js';
import { inputPh } from './log.js';
import { N_, T } from './i18n.js';
import { pl } from './prompt.js';

import { openSettingsSheet } from './settings-sheet.js';
import { send } from './turn.js';

export const input = document.getElementById('input');
const INPUT_MAX_HEIGHT = 140; // px: the box grows with its text up to this
export function fitInput() {
  input.style.height = 'auto';
  input.style.height = Math.min(INPUT_MAX_HEIGHT, input.scrollHeight) + 'px';
}
// a line that did not go through goes back into the box, unless the player has already typed something new
export function offerInput(text) {
  if (input.value.trim()) return;
  input.value = text;
  fitInput();
  saveDraft();
}
export function bindComposer() {
  input.addEventListener('input', () => {
    fitInput();
    slashMenu();
  });
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const send = enterSends() ? !e.shiftKey : e.ctrlKey || e.metaKey || e.shiftKey;
    if (send) {
      e.preventDefault();
      $('#form').requestSubmit();
    }
  });
  $('#gearBtn').onclick = openSettingsSheet;
  $('#enterTog').onchange = e => {
    setEnterPref(e.target.checked ? 'always' : 'never');
    applyEnterHint();
    toast(
      e.target.checked
        ? T('This browser: Enter sends (Shift+Enter for a new line)')
        : T('This browser: Enter adds a new line, Shift+Enter sends'),
    );
  };
  input.addEventListener('input', () => {
    clearTimeout(draftT);
    draftT = setTimeout(saveDraft, 300);
  });
  $('#form').onsubmit = e => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    input.value = '';
    input.style.height = '';
    saveDraft();
    $('#slash').classList.add('hidden');
    send(v);
  };
}
const isTouch = () => matchMedia('(pointer:coarse)').matches;
// the Enter key is a per-device habit: kept in this browser only, never in the account settings that follow you to other devices
const ENTER_LS = 'dr:enterSend';
export function enterPref() {
  try {
    const v = localStorage.getItem(ENTER_LS);
    if (v === 'always' || v === 'never') return v;
  } catch {
    // browser storage may be unavailable: the Enter preference is not remembered
  }
  return null;
}
export function setEnterPref(v) {
  try {
    if (v) localStorage.setItem(ENTER_LS, v);
    else localStorage.removeItem(ENTER_LS);
  } catch {
    // browser storage may be unavailable: the Enter preference is not remembered
  }
}
export function enterSends() {
  const v = enterPref();
  return v == null ? !isTouch() : v !== 'never';
}
export function syncEnterTog() {
  const c = $('#enterTog');
  if (c) c.checked = enterSends();
}
export function applyEnterHint() {
  syncEnterTog();
  input.placeholder = isTouch()
    ? inputPh()
    : enterSends()
      ? inputPh() + T(' (Shift+Enter for a new line)')
      : inputPh() + T(' (Shift+Enter to send)');
}
export function setSendMode(abort) {
  // given the reply's AbortController, the send button becomes a stop button for it
  const stop = !!abort;
  const b = $('#sendBtn');
  if (!b) return;
  b.disabled = false;
  b.title = '';
  b.dataset.en = stop ? N_('Stop') : N_('Send'); // translateStatic keeps the label in the screen's language
  b.textContent = T(b.dataset.en);
  b.classList.toggle('danger', stop);
  b.classList.toggle('primary', !stop);
  b.type = stop ? 'button' : 'submit';
  b.onclick = stop
    ? e => {
        e.preventDefault();
        e.stopPropagation();
        abort.abort();
      }
    : null;
}
const draftKey = () => (app.currentSave ? 'dr:draft:' + app.currentSave.id : null);
export function saveDraft() {
  const k = draftKey();
  if (!k) return;
  try {
    if (input.value) localStorage.setItem(k, input.value);
    else localStorage.removeItem(k);
  } catch {
    // browser storage may be unavailable: no draft is kept
  }
}
export function restoreDraft() {
  const k = draftKey();
  if (!k || input.value) return;
  try {
    const v = localStorage.getItem(k);
    if (v) {
      input.value = v;
      fitInput();
    }
  } catch {
    // browser storage may be unavailable: no draft to restore
  }
}
let draftT = null;
// a Japanese IME types the slash as "／" or, in kana mode, "・", and letters full width
const cmdWord = w => w.normalize('NFKC').replace(/^・/, '/').toLowerCase();
function slashMenu() {
  const lv = cmdWord(input.value),
    box = $('#slash');
  if (!lv.startsWith('/') || /\s/.test(lv)) {
    box.classList.add('hidden');
    return;
  }
  const m = CMDS.filter(c => allCmdNames(c).some(k => k.startsWith(lv)));
  if (!m.length) {
    box.classList.add('hidden');
    return;
  }
  box.innerHTML = m
    .map(
      c =>
        `<button type="button" data-id="${c.id}"><code>${cmdName(c.id)}</code><span class="muted">${T(c.d)} <span class="cmd-alias">${cmdNames(c).slice(1).join(' ')}</span></span></button>`,
    )
    .join('');
  box.classList.remove('hidden');
  box.querySelectorAll('button').forEach(
    b =>
      (b.onclick = () => {
        const c = CMDS.find(x => x.id === b.dataset.id);
        box.classList.add('hidden');
        if (c.t === 'status') {
          input.value = '';
          openStatus();
          return;
        }
        input.value = cmdName(c.id) + ' ';
        input.focus();
      }),
  );
}
export function parseCmd(text) {
  const [, word, rest] = text.trim().match(/^(\S+)\s*([\s\S]*)$/) || [];
  const w = word && cmdWord(word);
  const c = w && CMDS.find(c => allCmdNames(c).includes(w));
  if (!c) return null;
  return {
    type: c.t,
    id: c.id,
    arg: [c.preset && pl(c.preset), rest].filter(Boolean).join(' '),
    ...(c.look ? { look: c.look } : {}),
  };
}
