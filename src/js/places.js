/* ============ places: scene words to background images ============ */
import { pick } from './util.js';
import { EMOS } from './data.js';
import { app } from './app.js';
import { bgKey, fitsWorld, turnImg } from './images.js';

function bgList() {
  const w = app.state.life.world.id,
    m = {};
  for (const x of app.images) {
    if (x.kind !== 'scene' || x.off) continue;
    if (!fitsWorld(x, w)) continue;
    const k = bgKey(x);
    (m[k] = m[k] || []).push(x);
  }
  return m;
}
const TIME_RE = /_(day|night|sunset|indoor|morning|evening|dawn|noon|dusk|rain|snow)\d*$/;
function timeWanted(txt) {
  txt = String(txt || '');
  if (/밤|새벽|자정|심야|야간|night/i.test(txt)) return 'night';
  if (/저녁|노을|황혼|해질|석양|sunset|evening|dusk/i.test(txt)) return 'sunset';
  return 'day';
}
// places are searched, not listed: the narrator describes the place in English words, kind first ("station, locker"); the code finds a picture in the live library
const PLACE_STOP = new Set([
  'the',
  'of',
  'a',
  'an',
  'and',
  'in',
  'at',
  'near',
  'with',
  'on',
  'by',
  'to',
  'bg',
  'into',
  'inside',
  'outside',
  'front',
]);
const TIME_WORDS = new Set([
  'day',
  'night',
  'sunset',
  'indoor',
  'outdoor',
  'morning',
  'evening',
  'dawn',
  'noon',
  'dusk',
  'rain',
  'snow',
]);
const placeWords = x =>
  String(x || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(w => w.replace(/\d+$/, ''))
    .filter(w => w.length >= 2 && !PLACE_STOP.has(w));
const placeJunk = w => TIME_WORDS.has(w) || EMOS.includes(w) || /^(male|female|other)$/.test(w); // time variants, and character frames filed as places
export const baseOfKey = k =>
  String(k || '')
    .replace(TIME_RE, '')
    .replace(/^bg[_-]/, '')
    .toLowerCase();
let placeMemo = { key: '', P: null, freq: null };
function placeIndex() {
  const BG = bgList();
  const key =
    Object.keys(BG).length +
    ':' +
    (app.state && app.state.life ? app.state.life.world.id : '') +
    ':' +
    app.images.length;
  if (placeMemo.key === key) return placeMemo;
  const P = {};
  for (const k of Object.keys(BG)) {
    const base = baseOfKey(k);
    const o = (P[base] = P[base] || { keys: [], toks: new Set(), words: placeWords(base).filter(w => !placeJunk(w)) });
    o.keys.push(k);
    for (const w of o.words) o.toks.add(w);
    for (const x of BG[k])
      for (const t of x.tags || []) for (const w of placeWords(t)) if (!placeJunk(w)) o.toks.add(w);
  }
  const freq = {};
  for (const o of Object.values(P)) for (const w of new Set(o.words)) freq[w] = (freq[w] || 0) + 1;
  placeMemo = { key, P, freq };
  return placeMemo;
}
// every place word in this world's library, read live
export function placeVocab() {
  const w = new Set();
  for (const o of Object.values(placeIndex().P)) for (const x of o.words) w.add(x);
  return [...w].sort();
}
const sameWord = (a, b) => a === b || a.replace(/s$/, '') === b || a === b.replace(/s$/, '');
export function findPlace(name, clockTime, label) {
  // {base,list,via} or null
  const BG = bgList();
  name = String(name || '').trim();
  if (!name) return null;
  const { P, freq } = placeIndex();
  const want = (name.match(TIME_RE) || [])[1] || timeWanted(clockTime);
  const of = (base, via) => {
    const keys = P[base].keys;
    const byTime = keys.filter(k => (k.match(TIME_RE) || [])[1] === want);
    return { base, via, list: BG[pick(byTime.length ? byTime : keys)] };
  };
  if (BG[name]) return { base: baseOfKey(name), via: 'exact', list: BG[name] };
  if (P[baseOfKey(name)]) return of(baseOfKey(name), 'exact'); // an old-style place name (bus-stop)
  const items = name
    .split(/[,;/]/)
    .map(x => x.trim())
    .filter(Boolean);
  const kind = placeWords(items[0] || '').filter(w => !placeJunk(w));
  const mods = placeWords(items.slice(1).join(' ')).filter(w => !placeJunk(w));
  const mapped = label && app.state && app.state.placeMap && app.state.placeMap[label];
  const remembered = mapped && P[mapped] ? mapped : null; // a spot seen before keeps its picture
  if (!kind.length) return remembered ? of(remembered, 'memory') : null;
  const asked = w => kind.some(k => sameWord(k, w)) || mods.some(m => sameWord(m, w));
  const cands = Object.keys(P).filter(b => {
    const o = P[b];
    if (!kind.every(k => [...o.toks].some(t => sameWord(t, k)))) return false; // every word of the kind must be there: "police station" is not a station lobby
    return !o.words.some(w => !asked(w) && (freq[w] || 0) <= 1);
  }); // a word only this place has, and nobody asked for, makes it someone else's place (hobbit-house, arukram-market)
  if (!cands.length) return remembered ? of(remembered, 'memory') : null; // nothing close: no picture beats a wrong one
  if (remembered && cands.includes(remembered)) return of(remembered, 'memory');
  const recent = new Set(
    app.turns
      .slice(-12)
      .map(t => t.img && turnImg(t.img, t.img.scene))
      .filter(Boolean)
      .map(x => baseOfKey(bgKey(x))),
  );
  const score = b => {
    const o = P[b];
    return (
      mods.filter(m => [...o.toks].some(t => sameWord(t, m))).length * 2 -
      o.words.filter(w => !asked(w)).length +
      (recent.has(b) ? 0.5 : 0)
    );
  };
  const best = Math.max(...cands.map(score));
  const top = cands.filter(b => score(b) === best);
  return of(pick(top), 'search');
}
export function resolveScene(name, clockTime, label) {
  const f = findPlace(name, clockTime, label);
  return f ? f.list : null;
}
