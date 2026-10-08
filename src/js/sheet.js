/* ============ sheet: the bottom sheet and the questions asked in it ============ */
import { $, esc } from './util.js';
import { T } from './i18n.js';

let dlgResolve = null;
export function openSheet(html, opts = {}) {
  settleDialog(null); // a new sheet replaces any question still open: its asker gets null
  $('#sheetInner').innerHTML = html;
  $('#sheet').classList.toggle('center', !!opts.center);
  $('#sheet').classList.toggle('wide', !!opts.wide);
  $('#sheet').classList.remove('hidden');
}
export function closeSheet() {
  $('#sheet').classList.add('hidden');
  settleDialog(null);
}
function settleDialog(value) {
  const r = dlgResolve;
  dlgResolve = null;
  if (r) r(value);
}
// A question in the sheet. The promise settles with what answerDialog() is given, or null when the sheet is closed
// any other way (a tap outside, a newer sheet). The markup is in place when this returns, so bind its buttons next.
export function openDialog(html, opts) {
  openSheet(html, opts);
  return new Promise(res => (dlgResolve = res));
}
export function answerDialog(value) {
  const r = dlgResolve;
  dlgResolve = null;
  closeSheet();
  if (r) r(value);
}
// pics(i): picture URLs shown on row i, so the player can compare them
export function askReview(title, pairs, { checked = () => true, pics } = {}) {
  // a checklist before a bulk change: unchecked rows are left alone
  const on = pairs.map((_, i) => !!checked(i));
  const thumbs = i =>
    pics
      ? pics(i)
          .map(u => `<img class="review-pic" src="${esc(u)}" loading="lazy" decoding="async" alt="">`)
          .join('')
      : '';
  const answer = openDialog(
    `<p class="dlg-msg pre">${esc(title)}</p><div class="review-list">${pairs.map(([a, b], i) => `<label class="row review-item"><input type="checkbox" data-rv="${i}" ${on[i] ? 'checked' : ''} class="review-check">${thumbs(i)} <span>${esc(a)} → <b>${esc(b)}</b></span></label>`).join('')}</div><div class="row actions"><button class="btn primary" id="rvOk">${T('Apply')}</button>${on.includes(false) ? `<button class="btn" id="rvAll">${T('Check all')}</button>` : ''}<button class="btn ghost" id="rvNo">${T('Cancel')}</button></div>`,
  );
  const boxes = [...document.querySelectorAll('[data-rv]')];
  // a tap on a picture enlarges it instead of ticking its row
  $('.review-list').onclick = e => {
    if (!e.target.classList.contains('review-pic')) return;
    e.preventDefault();
    e.target.classList.toggle('big');
  };
  $('#rvOk').onclick = () => answerDialog(boxes.filter(c => c.checked).map(c => pairs[+c.dataset.rv]));
  $('#rvNo').onclick = () => answerDialog(null);
  if ($('#rvAll')) $('#rvAll').onclick = () => boxes.forEach(c => (c.checked = true));
  return answer;
}
export let askConfirm = function askConfirm(msg, ok = T('OK')) {
  const answer = openDialog(
    `<p class="dlg-msg pre confirm">${esc(msg)}</p><div class="row"><button class="btn primary" id="dlgOk">${esc(ok)}</button><button class="btn ghost" id="dlgNo">${T('Cancel')}</button></div>`,
  );
  $('#dlgOk').onclick = () => answerDialog(true);
  $('#dlgNo').onclick = () => answerDialog(false);
  return answer.then(v => !!v);
};
export let askPrompt = function askPrompt(msg, def = '') {
  const answer = openDialog(
    `<p class="dlg-msg">${esc(msg)}</p><input id="dlgIn" class="btn dlg-field" value="${esc(def)}"><div class="row"><button class="btn primary" id="dlgOk">${T('OK')}</button><button class="btn ghost" id="dlgNo">${T('Cancel')}</button></div>`,
  );
  const inp = $('#dlgIn');
  inp.focus();
  inp.onkeydown = e => {
    if (e.key === 'Enter') $('#dlgOk').click();
  };
  $('#dlgOk').onclick = () => answerDialog(inp.value);
  $('#dlgNo').onclick = () => answerDialog(null);
  return answer;
};
export function bindSheet() {
  // a tap outside the panel, or on anything marked data-close, closes the sheet
  $('#sheet').onclick = e => {
    if (e.target.id === 'sheet' || e.target.closest('[data-close]')) closeSheet();
  };
  $('#sheet').onkeydown = e => {
    if (e.key === 'Enter' && e.target.matches('[role="button"][data-close]')) closeSheet(); // a <button> clicks itself on Enter
  };
}

// the functions above that tests may replace (window.DR.mock): each setter swaps the binding every caller uses
export const mocks = {
  askConfirm: f => (askConfirm = f),
  askPrompt: f => (askPrompt = f),
};
