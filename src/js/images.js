/* ============ images: lookups over the image library (by id, character sets, worlds, portraits) ============ */
import { host } from './host.js';
import { esc, pick } from './util.js';
import { EMO_FB, WORLD_ALIAS, WORLDS } from './data.js';
import { app } from './app.js';
import { canonName } from './people.js';
import { T } from './i18n.js';

export const imgUrl = id => host().assetUrl(id);
export function sceneHtml(sc, people) {
  // background banner on top, the people present in a row underneath (never layered)
  const ppl = (people || []).filter(p => p && p.x).slice(0, 3);
  const bg = sc ? `<div class="scene" style="background-image:url('${imgUrl(sc.id)}')"></div>` : '';
  const row = ppl.length
    ? `<div class="castrow n${ppl.length}">${ppl.map(p => `<figure><img class="char" alt="" src="${imgUrl(p.x.id)}">${p.npc ? `<figcaption>${esc(p.npc)}</figcaption>` : ''}</figure>`).join('')}</div>`
    : '';
  return bg + row;
}
export function turnPeople(ti, o) {
  // [{x,npc}] for a turn, main speaker first; older turns only have img.char
  const list =
    Array.isArray(ti.chars) && ti.chars.length ? ti.chars : ti.char ? [{ id: ti.char, npc: o.speaker || '' }] : [];
  return list.map(c => ({ x: turnImg(ti, c.id), npc: canonName(c.npc || ''), hidden: !!c.hidden })).filter(p => p.x);
}
// a picture's content keys (ARCHITECTURE.md, 저장 파일 내보내기)
export const picKeys = x => [
  ...new Set([x.shash, x.hash].filter(h => typeof h === 'string' && h).map(h => h.slice(0, 16))),
];
// bumped on every write of the list (library.js), since rows also change in place; what is built from the list keys on it
let ver = 0;
export const imagesChanged = () => ver++;
export const imagesVer = () => ver;
let IX = null;
function imgIndex() {
  const list = app.images;
  if (IX && IX.list === list && IX.n === list.length && IX.ver === ver) return IX;
  IX = { list, n: list.length, ver, id: new Map(), key: new Map() };
  for (const x of list) {
    if (!IX.id.has(x.id)) IX.id.set(x.id, x);
    for (const k of picKeys(x)) if (!IX.key.has(k)) IX.key.set(k, x);
  }
  return IX;
}
export function imgById(id) {
  if (!id) return null;
  const ix = imgIndex();
  const m = (app.settings.dupMap || {})[id];
  return ix.id.get(id) || (m && ix.id.get(m)) || null;
}
// the content keys a turn from another install carries for one of its picture ids
export const turnKeys = (ti, id) => {
  const k = ti && ti.keys && ti.keys[id];
  return Array.isArray(k) ? k : [];
};
// a picture a turn names (ti: the turn's img): by content key first, then by id
export function turnImg(ti, id) {
  const keys = turnKeys(ti, id);
  if (!keys.length) return imgById(id);
  const ix = imgIndex();
  for (const k of keys) if (ix.key.has(k)) return ix.key.get(k);
  const x = ix.id.get(id);
  // no key matched, so a hashed row under this id is another picture; a dedupe redirect is the same picture
  if (x) return x.shash || x.hash ? null : x;
  return imgById(id);
}
const listOf = v => (Array.isArray(v) ? v.filter(Boolean) : []);
export const picIds = ti =>
  [ti.scene, ti.char, ...listOf(ti.chars).map(c => c.id), ...listOf(ti.places).map(p => p.id)].filter(Boolean);
export function setCover(k, imgs) {
  imgs = imgs || charSetsAll()[k] || [];
  const c = (app.setMeta[k] || {}).cover;
  return (
    (c && imgs.find(x => x.id === c)) ||
    imgs.find(x => x.emotion === 'neutral') ||
    imgs.find(x => x.emotion === 'smile') ||
    imgs[0]
  );
}
export function charSetsAll() {
  const m = {};
  for (const x of app.images) {
    if (x.kind !== 'char') continue;
    const k = x.set || x.name;
    (m[k] = m[k] || []).push(x);
  }
  return m;
}
export function charSets() {
  const m = {};
  for (const x of app.images) {
    if (x.kind !== 'char' || x.off || (app.setMeta[x.set || x.name] || {}).off || (x.set || x.name) === 'admin')
      continue;
    const k = x.set || x.name;
    (m[k] = m[k] || []).push(x);
  }
  return m;
}
export function genderOf(k) {
  const g = (app.setMeta[k] || {}).gender;
  if (g) return g;
  return /^female/.test(k) ? 'female' : /^male/.test(k) ? 'male' : null;
}
// possess named no background, so the label just drops
export const liveWorldIds = list => [
  ...new Set(
    list
      .map(v => (WORLD_ALIAS[v] ? (v === 'possess' ? null : WORLD_ALIAS[v][0]) : v))
      .filter(v => v && WORLDS.some(o => o.id === v)),
  ),
];
export function worldsOf(x) {
  if (!x) return [];
  let w = x.worlds;
  if (typeof w === 'string')
    w = w
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
  if (Array.isArray(w)) return liveWorldIds(w);
  return x.world && x.world !== 'any' && x.world !== 'multi' ? liveWorldIds([x.world]) : [];
}
// an image or set card fits these worlds (ids); none means every world. `world` is the older single label kept in step.
export function setWorlds(x, ids) {
  x.worlds = ids;
  x.world = ids.length === 1 ? ids[0] : ids.length ? 'multi' : 'any';
}
// labels are the source of truth: list every world an image fits
export function fitsWorld(x, w) {
  const ws = worldsOf(x);
  return !ws.length || ws.includes(w);
}
export function worldChips(sel, attr) {
  const cur = new Set(sel || []);
  return `<div class="seg world-chips">${WORLDS.map(w => `<button type="button" ${attr}="${w.id}" aria-pressed="${cur.has(w.id)}" class="chip-sm">${T(w.name)}</button>`).join('')}</div><div class="muted world-chips-note">${T('None selected means every world')}</div>`;
}
export function bgKey(x) {
  return String(x.name || '').replace(/^bg[_-]/, '');
}
export function pickEmotion(k, emo, look) {
  const imgs = charSets()[k];
  if (!imgs || !imgs.length) return null;
  const by = e => imgs.filter(x => (x.emotion || 'neutral') === e);
  let c = by(emo);
  if (!c.length && EMO_FB[emo]) c = by(EMO_FB[emo]);
  if (!c.length) c = by('neutral');
  if (!c.length) c = imgs;
  const want = (Array.isArray(look) ? look : []).map(x => String(x).toLowerCase()).filter(Boolean);
  if (want.length) {
    const hit = c.filter(x =>
      [...(x.tags || []), x.variant || '']
        .join(' ')
        .toLowerCase()
        .split(/[\s,_]+/)
        .some(t => t && want.includes(t)),
    );
    if (hit.length) c = hit;
  }
  return pick(c);
}
