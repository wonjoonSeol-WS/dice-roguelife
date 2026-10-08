/* ============ casting: a portrait set for each person ============ */
import { pick, toast } from './util.js';
import { EMOS, normGender } from './data.js';
import { platform } from './db.js';
import { app } from './app.js';
import { logErr } from './diag.js';
import { T } from './i18n.js';
import { LIMITS } from './limits.js';
import { charSets, charSetsAll, fitsWorld, genderOf, imagesVer, pickEmotion } from './images.js';

const normName = x =>
  String(x || '')
    .replace(/\s+/g, '')
    .toLowerCase();
function namedSetFor(name) {
  const n = normName(name);
  if (!n) return null;
  const sets = charSets();
  for (const k of Object.keys(sets)) {
    const m = app.setMeta[k] || {};
    if (!m.charName) continue;
    const all = [m.charName, ...(m.aliases || [])].map(normName);
    if (all.includes(n)) return k;
  }
  for (const k of Object.keys(sets)) {
    const m = app.setMeta[k] || {};
    if (!m.charName) continue;
    const all = [m.charName, ...(m.aliases || [])].map(normName).filter(a => a.length >= 2);
    if (all.some(a => n.includes(a))) return k;
  }
  return null;
}
export const TIERS_CAST = ['extra', 'minor', 'major'];
// faceless figures any number of extras can share: marked on the set card (tier generic) or named shadow_ / generic_ / silhouette_. An explicit standing wins
// a printed name is never a silhouette
export const isGeneric = k => {
  const m = app.setMeta[k] || {};
  if (m.charName) return false;
  const t = m.tier;
  if (t === 'generic') return true;
  if (TIERS_CAST.includes(t)) return false;
  return /^(shadow|generic|silhouette)/i.test(k);
};
export function setTier(k) {
  const m = app.setMeta[k] || {};
  if (isGeneric(k)) return 'extra';
  if (TIERS_CAST.includes(m.tier)) return m.tier;
  const n = (charSets()[k] || []).length;
  return n <= 1 ? 'extra' : n <= 3 ? 'minor' : 'major';
}
function normWeight(w) {
  w = String(w || '').toLowerCase();
  return TIERS_CAST.includes(w) ? w : 'minor';
}
const SPLIT_RE = /[\s,/·()（）\[\]{}"'“”‘’:：;!?。、]+/;
export const wordSet = parts => new Set(parts.filter(Boolean).join(' ').toLowerCase().split(SPLIT_RE).filter(Boolean));
const lookToks = (x, common) =>
  (Array.isArray(x) ? x : String(x || '').split(/[,/·]+/))
    .flatMap(p => String(p).toLowerCase().trim().split(SPLIT_RE))
    .filter(t => t.length >= 2 && !(common && common.has(t)));
// identity tags: key:value names what a person belongs to (faction:사천당가, planet:화성, company:넥슨). The value is kept as written and matched by containment; plain tags describe looks and are matched word by word. The code never lists the keys
const ID_RE = /^([^\s:：]{1,20})\s*[:：]\s*(\S.*)$/;
export const isIdTag = t => ID_RE.test(String(t || '').trim());
const idOf = t => {
  const m = ID_RE.exec(String(t || '').trim());
  return m ? { key: m[1].toLowerCase(), val: m[2].trim() } : null;
};
const idNorm = v =>
  String(v || '')
    .replace(/\(.*?\)|（.*?）|[\s,.]/g, '')
    .toLowerCase();
const descTags = list => (list || []).filter(t => !isIdTag(t));
// the cap is for description tags only
export const capTags = list => {
  const u = [...new Set((list || []).map(t => String(t).trim()).filter(Boolean))];
  return [...u.filter(isIdTag), ...u.filter(t => !isIdTag(t)).slice(0, 10)];
};
// a name on any frame is true of the set
export function setIds(k) {
  return [...new Set((charSetsAll()[k] || []).flatMap(x => (x.tags || []).filter(isIdTag)))].map(idOf).filter(Boolean);
}
function splitLook(look) {
  const items = (Array.isArray(look) ? look : String(look || '').split(/[,/·]+/))
    .map(x => String(x).trim())
    .filter(Boolean);
  return { desc: items.filter(x => !isIdTag(x)), ids: items.map(idOf).filter(Boolean) };
}
const idMatch = (a, b) => {
  const x = idNorm(a.val),
    y = idNorm(b.val);
  return !!(x && y && x.length >= 2 && y.length >= 2 && (x === y || x.includes(y) || y.includes(x)));
};
// scored from the person's side: how many of their identities this set answers (+12 each, +1 when the kind agrees). A set naming only other identities is a small minus; nothing on either side is 0
function idScore(k, ids) {
  if (!ids || !ids.length) return 0;
  const s = setIds(k);
  if (!s.length) return 0;
  let n = 0;
  for (const a of ids) {
    const m = s.find(b => idMatch(a, b));
    if (m) {
      n += 12;
      if (m.key === a.key) n += 1;
    }
  }
  return n || -4;
}
// every real face that died in this life, whoever wore it; silhouettes are a kind, not a person, and never retire
export const retiredSets = () =>
  new Set(
    Object.values(app.state.deadNpc || {})
      .filter(d => d.set && !isGeneric(d.set))
      .map(d => d.set),
  );
function hayWords(k) {
  const m = app.setMeta[k] || {};
  return wordSet([
    m.role,
    m.vibe,
    m.look,
    ...(m.kw || []),
    k,
    ...descTags((charSetsAll()[k] || []).flatMap(x => x.tags || [])),
  ]);
}
// words on more than half of the sets (hair, smile, female) tell one person from another no better than chance: zero weight, no word list needed
let commonMemo = { key: '', set: new Set() };
export function commonWords() {
  const key = app.images.length + ':' + imagesVer();
  if (commonMemo.key === key) return commonMemo.set;
  const ks = Object.keys(charSetsAll());
  const df = new Map();
  for (const k of ks) for (const w of hayWords(k)) df.set(w, (df.get(w) || 0) + 1);
  const set = new Set([...df.entries()].filter(([, c]) => c > ks.length / 2).map(([w]) => w));
  commonMemo = { key, set };
  return set;
}
// one shared vocabulary: the most used character tags in the library, given to the narrator and to the tag translator
let vocabMemo = { key: '', list: [] };
// tags shared by most frames of a set describe the person (silver hair, armor); a tag on one frame describes that expression (tears, smirk)
function setLevelTags(k, imgs) {
  imgs = imgs || charSetsAll()[k] || [];
  const c = new Map();
  for (const x of imgs)
    for (const t of new Set((x.tags || []).map(t => String(t).toLowerCase().trim()).filter(Boolean)))
      c.set(t, (c.get(t) || 0) + 1);
  const need = imgs.length <= 2 ? 1 : Math.ceil(imgs.length * 0.7);
  return [...c.entries()].filter(([t, n]) => n >= need && t !== k.toLowerCase()).map(([t]) => t);
}
export function tagVocab(n = 60) {
  const key = app.images.length + ':' + imagesVer();
  if (vocabMemo.key === key) return vocabMemo.list.slice(0, n);
  const cnt = new Map();
  for (const [k, imgs] of Object.entries(charSetsAll())) {
    if (isGeneric(k)) continue;
    const seen = setLevelTags(k, imgs).filter(t => /^[\x00-\x7F]+$/.test(t) && !isIdTag(t) && !EMOS.includes(t));
    for (const t of seen) cnt.set(t, (cnt.get(t) || 0) + 1);
  }
  const list = [...cnt.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);
  vocabMemo = { key, list };
  return list.slice(0, n);
}
// tags are matching keys in English; anything typed in another language is translated once when it is added
// spelling, with the library as the dictionary: a typed English word that is not a known tag word but sits one or two edits from one becomes that word. Correct new words pass untouched
function editDist(a, b) {
  const m = a.length,
    n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
let tagWordsMemo = { key: '', set: new Set() };
function tagWords() {
  const key = app.images.length + ':' + imagesVer();
  if (tagWordsMemo.key === key) return tagWordsMemo.set;
  const set = new Set();
  for (const x of app.images)
    for (const t of descTags(x.tags || []))
      if (/^[\x00-\x7F]+$/.test(t))
        for (const w of String(t)
          .toLowerCase()
          .split(/[\s,]+/))
          if (w.length >= 3) set.add(w);
  tagWordsMemo = { key, set };
  return set;
}
// a typo rarely changes the first letter, and that rule keeps holster from becoming monster
function spellFix(tag) {
  if (isIdTag(tag) || /[^\x00-\x7F]/.test(tag)) return tag;
  const pool = tagWords();
  if (!pool.size) return tag;
  return String(tag)
    .split(/\s+/)
    .map(w => {
      const lw = w.toLowerCase();
      if (lw.length < 3 || pool.has(lw)) return w;
      const lim = lw.length >= 6 ? 2 : 1;
      let best = null,
        bd = lim + 1;
      for (const c of pool) {
        if (c[0] !== lw[0] || Math.abs(c.length - lw.length) > lim) continue;
        const d = editDist(lw, c);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      return best && bd <= lim ? best : w;
    })
    .join(' ');
}
export async function toEnglishTags(list) {
  list = list.map(t => {
    const f = spellFix(t);
    if (f !== t) toast(T('{from} → {to} (spelling fixed)', { from: t, to: f }), 3500);
    return f;
  });
  const need = list.filter(t => !isIdTag(t) && /[^\x00-\x7F]/.test(t));
  /* only non-English goes to the model */ if (!need.length || !platform.sample) return list;
  const voc = tagVocab(80);
  try {
    const r = await platform.sample.json(
      // i18n-ignore: Korean examples for the translator
      `Translate each appearance tag to a short lowercase English keyword, using the most common word (e.g. 정장 -> suit, 교복 -> school uniform, 은발 -> silver hair, 갑옷 -> armor). Keep proper nouns (sect, faction, place or person names such as 남만야수궁) exactly as written.${voc.length ? ` If one of these existing tags means the same thing, use it exactly: ${voc.join(', ')}.` : ''} Reply with only a JSON array of strings in the same order.\n${JSON.stringify(need)}`,
      { modelTier: 'quick' },
    );
    if (Array.isArray(r) && r.length === need.length) {
      const m = new Map(
        need.map((t, i) => [
          t,
          String(r[i] || t)
            .toLowerCase()
            .trim() || t,
        ]),
      );
      return list.map(t => m.get(t) || t);
    }
  } catch (e) {
    logErr('tagtr', e);
  }
  return list;
}
let promotedNames = []; // people who just left a shared extra's face for one of their own: the turn reports each once
// the open save is being left: picks still running for it must not land in the next one
export function forgetPendingCasts() {
  for (const k of Object.keys(AI_PENDING)) delete AI_PENDING[k];
  promotedNames = [];
}
export function takePromoted() {
  const names = promotedNames;
  promotedNames = [];
  return names;
}
// A person to cast, as a reply describes them: { name, gender, role, weight, look }. gender is normalized
// (normGender); weight is extra, minor or major (anything else counts as minor); look is a list (or a comma string) of
// look words and identity tags (faction:사천당가).

// the people a reply names, in that shape
export const speakerOf = o => ({
  name: String(o.speaker || '').slice(0, LIMITS.text.name),
  gender: normGender(o.speaker_gender),
  role: o.speaker_role,
  weight: o.speaker_weight,
  look: o.speaker_look,
});
export const presentOf = p => ({
  name: String(p.name || '').slice(0, LIMITS.text.name),
  gender: normGender(p.gender),
  role: p.role,
  weight: p.weight,
  look: p.look,
});

const metaOf = k => app.setMeta[k] || {};
const worldId = () => app.state.life.world.id;
const genderKey = gender => (gender === 'female' || gender === 'male' ? gender : null);
// a set may dress someone of gender g: unlabeled sets fit anyone. A set labeled other (기타: beasts, spirits) is never
// given to a man or a woman automatically; it stays for those without a gender (the face window still offers it)
function fitsGender(k, g) {
  const kg = genderOf(k);
  return !g || !kg || kg === g;
}
// the people other than `except` who wear set k
const holders = (k, except) => Object.keys(app.state.cast).filter(n => n !== except && app.state.cast[n] === k);

// how a person is described, in the words set cards use. withName: the name counts as looks too ("정장 사내"), and role
// words already among the looks are dropped
function describe(who, withName) {
  const { desc, ids } = splitLook(who.look);
  const common = commonWords();
  const toks = x => lookToks(x, common);
  const look = withName ? [...new Set([...toks(desc), ...toks(who.name)])] : toks(desc);
  const role = withName ? toks(who.role).filter(w => !look.includes(w)) : toks(who.role);
  return { look, role, ids };
}
const overlap = (words, hay) => words.filter(w => hay.has(w)).length;
// a set's standing against the one wanted: the same +3, one apart +1, two apart -2
function tierFit(k, want) {
  const d = Math.abs(TIERS_CAST.indexOf(setTier(k)) - TIERS_CAST.indexOf(want));
  return d === 0 ? 3 : d === 1 ? 1 : -2;
}
const whyOf = d => ({ look: [...d.look, ...d.ids.map(i => i.key + ':' + i.val)], role: d.role });
function assign(name, k, why) {
  if (why) {
    app.state.castWhy = app.state.castWhy || {};
    app.state.castWhy[name] = why;
  }
  app.state.cast[name] = k;
  return k;
}

// the face this person wears in this life, picking one the first time (null: no face)
export function castFor(who) {
  const res = castFor0(who);
  const { name, weight } = who;
  if (res) {
    app.state.castW = app.state.castW || {};
    if (!app.state.castW[name] || weight) app.state.castW[name] = normWeight(weight);
  }
  if (promotedNames.includes(name) && (!res || isGeneric(res))) promotedNames = promotedNames.filter(n => n !== name);
  return res;
}
// a shadow for someone who gets no face (a concealed identity, a passer-by with nothing left, a person the model could not place): a dedicated silhouette set, or nothing
export function shadowFor(who) {
  const gk = bestGeneric({ ...who, look: [] });
  if (!gk) return null;
  const im = pickEmotion(gk, 'neutral', []);
  return im ? { im } : null;
}

// ranking a set for this person by identities, looks, role and standing; hits alone is the looks and role part
function ranking(who) {
  const { look, role, ids } = describe(who, false);
  const want = normWeight(who.weight);
  const hits = k => {
    const h = hayWords(k);
    return overlap(look, h) * 4 + overlap(role, h) * 2;
  };
  const score = k => hits(k) + idScore(k, ids) + tierFit(k, want) - (isGeneric(k) && want !== 'extra' ? 6 : 0);
  return { hits, ids, score };
}
// how well each set fits this person (the face window ranks its grid with it)
export const castScorer = who => ranking(who).score;
// sets this person may wear: their world and gender, not retired or someone's own named face, and not a face another
// person wears unless both are small enough to share it
function wearable(who) {
  const w = worldId(),
    g = genderKey(who.gender),
    want = normWeight(who.weight),
    W = app.state.castW || {};
  const retired = retiredSets();
  return k => {
    if (!fitsWorld(metaOf(k), w) || retired.has(k) || metaOf(k).charName) return false;
    if (!fitsGender(k, g)) return false;
    if (isGeneric(k)) return true;
    const o = holders(k, who.name);
    if (!o.length) return true;
    if (want === 'extra') return setTier(k) === 'extra' && o.every(n => W[n] !== 'major');
    if (want === 'minor') return o.every(n => W[n] !== 'major');
    return false;
  };
}
// the K nearest faces this person may wear, for the model to choose from
export function castCandidates(who, K = 12) {
  const { hits, ids, score } = ranking(who);
  const all = Object.keys(charSets()).filter(wearable(who));
  const signal = all.some(k => hits(k) > 0 || idScore(k, ids) > 0);
  // nothing overlaps anywhere: the words told us nothing, so hand the model a wider shelf
  return all
    .map(k => [k, score(k) + Math.random() * 0.5])
    .sort((a, b) => b[1] - a[1])
    .slice(0, signal ? K : 40)
    .map(([k]) => k);
}
// the silhouette that fits best: an armored one for a soldier, a suited one for a bodyguard
function bestGeneric(who) {
  const w = worldId(),
    g = genderKey(who.gender);
  const gen = Object.keys(charSets()).filter(k => isGeneric(k) && fitsWorld(metaOf(k), w) && fitsGender(k, g));
  if (!gen.length) return null;
  const { look, role } = describe(who, false);
  const sc = k => {
    const h = hayWords(k);
    return overlap(look, h) * 4 + overlap(role, h) * 2 + (genderOf(k) === g ? 1 : 0);
  };
  const top = Math.max(...gen.map(sc));
  return pick(gen.filter(k => sc(k) === top));
}
const AI_PENDING = {}; // name -> Promise<key|'none'|null>, started while the reply is still streaming
function isNewLead({ name, weight }) {
  return (
    !!name &&
    !app.state.cast[name] &&
    !(app.state.deadNpc || {})[name] &&
    !namedSetFor(name) &&
    !(app.state.noFace || []).includes(name) &&
    normWeight(weight) !== 'extra'
  );
}
export let startAiPick = function startAiPick(c) {
  if (!platform.sample || AI_PENDING[c.name] || !isNewLead(c)) return;
  let cands = [];
  const pr = (async () => {
    try {
      cands = castCandidates(c);
      if (cands.length < 2) return cands[0] || null;
      const L = splitLook(c.look);
      const sets = charSets();
      const line = k => {
        const m = app.setMeta[k] || {};
        const ids = setIds(k)
          .map(i => i.key + ':' + i.val)
          .join(', ');
        const tags = [...new Set([...(m.kw || []), ...descTags((sets[k] || []).flatMap(x => x.tags || []))])]
          .slice(0, 10)
          .join(', ');
        return `- ${k} | ${isGeneric(k) ? 'silhouette' : setTier(k)} | ${ids || '-'} | ${m.role || ''} | ${tags}`;
      };
      const rel = (app.state.relations || {})[c.name];
      const lore = (app.state.lore || {})[c.name];
      const loreT = lore && (lore.text || lore);
      const r = await platform.sample.json(
        `Pick the portrait that best fits this character. Judge by what they belong to first (a matching faction, house or company outranks looks), then appearance (clothing, era, genre), then role and how important they are. A silhouette is only right for a faceless passer-by. If no candidate plausibly fits (wrong era or genre), answer "none".\nWorld: ${app.state.life.world.name}\nCharacter: ${c.name} | gender ${c.gender || '?'} | belongs ${L.ids.map(i => i.key + ':' + i.val).join(', ') || '?'} | role ${c.role || '?'} | look ${L.desc.join(', ') || '?'} | importance ${normWeight(c.weight)}${rel ? `\nRelationship notes: ${String(rel.note || rel).slice(0, 200)}` : ''}${loreT ? `\nLore: ${String(loreT).slice(0, 200)}` : ''}\nCandidates (key | standing | belongs | role | tags):\n${cands.map(line).join('\n')}\nReply with only JSON {"pick":"<key or none>"}.`,
        { modelTier: 'quick' },
      );
      const k = r && String(r.pick || '').trim();
      return k === 'none' ? 'none' : cands.includes(k) ? k : cands[0];
    } catch (e) {
      logErr('aicast', e);
      return cands[0] || null;
    }
  })();
  pr.info = c;
  AI_PENDING[c.name] = pr;
};
// always on; without a model the word-score path (castFor) takes over
export const aiWillPick = who => !!platform.sample && (!!AI_PENDING[who.name] || isNewLead(who));
function applyPick(n, k, info) {
  // a finished pick: the face for the rest of this life, or a silhouette when the model found nothing
  if (!k || app.state.cast[n]) return false;
  app.state.castWhy = app.state.castWhy || {};
  const L = splitLook(info.look),
    common = commonWords();
  const why = {
    look: [...new Set([...lookToks(L.desc, common), ...lookToks(n, common)]), ...L.ids.map(i => i.key + ':' + i.val)],
    role: lookToks(info.role, common),
    ai: true,
  };
  if (k === 'none') {
    const gk = bestGeneric(info);
    if (gk) app.state.cast[n] = gk;
    else app.state.noFace = [...new Set([...(app.state.noFace || []), n])];
    why.none = true;
    app.state.castWhy[n] = why;
    return true;
  } // noFace stops the retries; the turn shows a dedicated silhouette if one exists, else no portrait
  app.state.cast[n] = k;
  app.state.castW = app.state.castW || {};
  app.state.castW[n] = normWeight(info.weight);
  app.state.castWhy[n] = why;
  return true;
}
export let earlyCast = async function earlyCast(o) {
  // picks started while the reply streamed are usually done by the time it ends: use them on this very turn, else they land on the next appearance
  const people = [...(o.speaker && !o.speaker_hidden ? [speakerOf(o)] : []), ...(o.also_present || []).map(presentOf)];
  for (const c of people) if (aiWillPick(c)) startAiPick(c);
  const pend = people.map(c => c.name).filter(n => AI_PENDING[n]);
  if (!pend.length) return;
  const wait = new Promise(r => setTimeout(() => r('__wait'), 1200));
  await Promise.all(
    pend.map(async n => {
      const pr = AI_PENDING[n];
      const k = await Promise.race([pr, wait]);
      if (k === '__wait' || AI_PENDING[n] !== pr) return;
      delete AI_PENDING[n];
      applyPick(n, k, pr.info || {});
    }),
  );
};
// after the turn is on screen: the faces picked for it land now and show from the next appearance. Resolves true
// when a face changed (the caller saves the state).
export async function resolveAiPicks() {
  const names = Object.keys(AI_PENDING);
  if (!names.length) return;
  let changed = false;
  await Promise.all(
    names.map(async n => {
      const pr = AI_PENDING[n];
      const k = await pr;
      if (AI_PENDING[n] !== pr) return;
      delete AI_PENDING[n];
      if (applyPick(n, k, pr.info || {})) changed = true;
    }),
  );
  return changed;
}

function castFor0(who) {
  const { name } = who;
  if ((app.state.noFace || []).includes(name)) return null;
  if (app.state.deadNpc && app.state.deadNpc[name]) return app.state.deadNpc[name].set || null;
  return keptFace(who) || namedFace(who) || (normWeight(who.weight) === 'extra' ? castExtra(who) : castLead(who));
}
// the face they already wear, unless it left this world or they rose from a shared extra's face to a part of their own
function keptFace(who) {
  const { name, weight } = who;
  const k = app.state.cast[name];
  if (!k) return null;
  const ok = charSets()[k] && fitsWorld(metaOf(k), worldId());
  const shared = isGeneric(k) || holders(k, name).length > 0;
  const promoted = weight && normWeight(weight) !== 'extra' && (app.state.castW || {})[name] === 'extra' && shared;
  if (ok && !promoted) return k;
  delete app.state.cast[name];
  if (promoted) promotedNames.push(name);
  return null;
}
// a set card that names this character: free, or held under one of their own names (same person, different address)
function namedFace(who) {
  const named = namedSetFor(who.name);
  if (!named) return null;
  const others = holders(named, who.name);
  if (others.length && !others.every(h => namedSetFor(h) === named)) return null;
  return assign(who.name, named);
}
// passers-by share a small pool of faces (extra-tier sets) or silhouettes
function castExtra(who) {
  const d = describe(who, true);
  const w = worldId(),
    g = genderKey(who.gender);
  const retired = retiredSets();
  const share = Object.keys(charSets()).filter(
    k =>
      (isGeneric(k) || setTier(k) === 'extra') &&
      !metaOf(k).charName &&
      !retired.has(k) &&
      fitsWorld(metaOf(k), w) &&
      fitsGender(k, g),
  );
  if (share.length) {
    const lh = k => overlap(d.look, hayWords(k));
    const faces = share.filter(k => !isGeneric(k) && (lh(k) >= 2 || idScore(k, d.ids) > 0)),
      gens = share.filter(isGeneric);
    // a passer-by stays faceless unless a face clearly matches how they were described, or answers to the same faction
    const pool = faces.length ? faces : gens.length ? gens : share;
    const sc = k => lh(k) * 4 + overlap(d.role, hayWords(k)) * 2 + idScore(k, d.ids);
    const top = Math.max(...pool.map(sc));
    return assign(who.name, pick(pool.filter(x => sc(x) === top)), whyOf(d));
  }
  // the extra pool is empty (every extra face died, no silhouettes): a passer-by goes without a portrait rather than spending a lead's face. More images fix this, so say so once per life
  if (!app.state.faceOut) {
    app.state.faceOut = true;
    toast(
      T('Out of faces for extras. Upload more silhouettes (shadow_) or extra images and they will get faces again.'),
      6000,
    );
  }
  return null;
}
// a part of their own: a free face of their world and gender that matches their looks, role and standing
function castLead(who) {
  const g = genderKey(who.gender),
    w = worldId(),
    want = normWeight(who.weight);
  const used = new Set(Object.values(app.state.cast));
  let pool = Object.keys(charSets()).filter(
    k => !isGeneric(k) && !used.has(k) && !metaOf(k).charName && fitsWorld(metaOf(k), w),
  );
  if (g) pool = pool.filter(k => fitsGender(k, g)).sort((a, b) => (genderOf(b) === g) - (genderOf(a) === g));
  if (!pool.length && want === 'minor') pool = sharedForMinor(g, w);
  if (!pool.length) {
    // nothing else left: anyone may wear a silhouette (it is never retired)
    const k = bestGeneric(who);
    return k ? assign(who.name, k, { look: [], role: [] }) : null;
  }
  const d = describe(who, true); // what they look like counts most: 정장, 갑옷, 교복
  const lookHits = k => overlap(d.look, hayWords(k));
  const score = k => {
    const h = hayWords(k);
    return (
      overlap(d.look, h) * 4 +
      overlap(d.role, h) * 2 +
      (genderOf(k) === g ? 2 : 0) +
      tierFit(k, want) +
      idScore(k, d.ids)
    );
  };
  app.state.castWhy = app.state.castWhy || {};
  app.state.castWhy[who.name] = whyOf(d);
  // described by looks but nothing in the library matches them: a silhouette beats a wrong face
  if (
    want !== 'major' &&
    (d.look.length || d.ids.length) &&
    !pool.some(k => lookHits(k) > 0 || idScore(k, d.ids) > 0)
  ) {
    const k = bestGeneric(who);
    if (k) return assign(who.name, k);
  }
  const top = Math.max(...pool.map(score));
  return assign(who.name, pick(pool.filter(x => score(x) === top)));
}
// the library ran out of free faces: anyone but a lead may share one, the least worn first
function sharedForMinor(g, w) {
  const sets = charSets();
  const retired = retiredSets();
  const W = app.state.castW || {};
  return Object.keys(sets)
    .filter(
      k =>
        !isGeneric(k) &&
        !metaOf(k).charName &&
        !retired.has(k) &&
        fitsWorld(metaOf(k), w) &&
        fitsGender(k, g) &&
        holders(k).every(n => W[n] !== 'major'),
    )
    .sort((a, b) => holders(a).length - holders(b).length)
    .slice(0, Math.max(1, Math.ceil(sets ? Object.keys(sets).length / 4 : 1)));
}

// the functions above that tests may replace (window.DR.mock): each setter swaps the binding every caller uses
export const mocks = {
  startAiPick: f => (startAiPick = f),
  earlyCast: f => (earlyCast = f),
};
