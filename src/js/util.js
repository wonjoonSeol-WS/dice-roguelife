/* ============ honest dice ============ */
import { locale } from './i18n.js';

export let rnd = function rnd() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
};
export function pick(arr) {
  return arr[Math.floor(rnd() * arr.length)];
}

/* ============ utilities ============ */
export const $ = s => document.querySelector(s);
export const esc = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const clone = o => JSON.parse(JSON.stringify(o));
export const pad = n => String(n).padStart(6, '0');
export const nowIso = () => new Date().toISOString();
export const uid = () => Date.now().toString(36) + Math.floor(rnd() * 1e8).toString(36);
export let toast = function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
};
export function fmt(n) {
  return Number(n || 0).toLocaleString(locale());
}

// Errors a caller deliberately survives (a cleanup that may fail, a capability that may be missing). They are kept
// here instead of thrown so ⚙ → Diagnostics can show what went wrong on a phone, where there is no console.
export const IGNORED = [];
export function noteIgnored(where, e) {
  IGNORED.unshift({
    t: new Date().toLocaleTimeString(locale()),
    where,
    msg: String((e && (e.code || e.message)) || e).slice(0, 160),
  });
  IGNORED.length = Math.min(IGNORED.length, 20);
  console.warn('[ignored]', where, e);
}

// the SHA-256 of a file or blob as hex: how a picture is recognized when it is uploaded again
export async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
// run fn over items, a few at a time
export async function inParallel(items, n, fn) {
  const queue = [...items];
  const worker = async () => {
    while (queue.length) await fn(queue.shift());
  };
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, worker));
}

export function cutLine(v, n) {
  const t = String(v).replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const h = t.slice(0, n - 1);
  const k = Math.max(h.lastIndexOf(' '), h.lastIndexOf(','));
  return (k > n * 0.6 ? h.slice(0, k) : h).replace(/[ ,.]+$/, '') + '…';
}

export function shortWhat(x) {
  const t = String(x || '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 24 ? t.slice(0, 23) + '…' : t;
}

export const MARK_RE = /\[\[\s*(@?)([^\[\]\n]{1,30}?)\s*\]\]/g;

export const stripMarks = t =>
  String(t || '')
    .replace(MARK_RE, '')
    .replace(/\n{3,}/g, '\n\n');

// the functions above that tests may replace (window.DR.mock): each setter swaps the binding every caller uses
export const mocks = {
  rnd: f => (rnd = f),
  toast: f => (toast = f),
};
