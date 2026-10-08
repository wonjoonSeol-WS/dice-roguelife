/* ============ prompt ============ */
import PR_DEFAULT from '../../prompts.json' with { type: 'json' };
import { stripMarks } from './util.js';
import { askOf, cmdIs, moneyText, powerGrade, REALMS } from './data.js';
import { ART_SLOT_LABEL, ART_SLOTS, GENDER_LABEL, SKILL_SRC, STANCE_LABEL } from './enums.js';
import { LIMITS } from './limits.js';
import { withWeekday } from './calendar.js';
import { platform, thaw } from './db.js';
import { app } from './app.js';
import { promptLang, setting, storyLang } from './settings.js';
import { N_, T, tIn } from './i18n.js';
import { logErr } from './diag.js';
import { growthLevel, itemBonus, lifeDiff, rollGrade, rule, statusVisible, titlesOn } from './rules.js';
import { stripOdds } from './reply-words.js';
import { activeRel, canonName } from './people.js';
import { charSets, fitsWorld } from './images.js';
import { placeVocab } from './places.js';
import { setIds } from './casting.js';
import { widgetOf } from './widgets.js';

export let prompts = PR_DEFAULT; // narrator prompt text; config/prompt in the db overrides field by field
// a prompts.json map keyed by story language ("lang", "tip", "ledgerLang", "summaryLang")
export const prLang = k => ((prompts && prompts[k]) || {})[storyLang()] || '';
// a prompts.json entry; an English story reads prompts.en's version when there is one
export const pr = k => {
  const en = promptLang() === 'en' && prompts.en;
  return en && en[k] !== undefined ? en[k] : prompts[k];
};
export const pl = (en, vars) => tIn(promptLang(), en, vars);
// an enum's label in the prompt's language (an unknown value as it is)
export const plLabel = (labels, v) => (labels[v] ? pl(labels[v]).toLowerCase() : v);
export const fillTemplate = (str, v) =>
  String(str || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m));
export async function loadPromptConfig() {
  try {
    const d = await platform.shared.doc('config/prompt').get();
    const v = d.exists ? thaw(d.data()) : null;
    prompts = v && v.rules ? Object.assign({}, PR_DEFAULT, v) : PR_DEFAULT;
  } catch (e) {
    prompts = PR_DEFAULT;
  }
}

export const recentBudget = () => Math.max(10000, Math.min(200000, Number(app.settings.recentBytes) || 40000)); // bytes of raw recent turns before the summaries take over
const ENCODER = new TextEncoder();
export const tbytes = x => ENCODER.encode(x).length;
// counted in exchanges (one narrator reply with the player's line before it), the same unit as the top bar
function recentEstimate() {
  const pool = app.turns.slice(-80);
  const ai = pool.filter(t => t.kind === 'ai').length;
  if (!ai) return null;
  const bytes = pool.reduce((a, t) => a + tbytes(turnText(t, true)), 0);
  return Math.max(3, Math.round(recentBudget() / Math.max(400, bytes / ai)));
}
export function recentLine() {
  if (!app.state) return '';
  const est = recentEstimate();
  return (
    T('Right now {n} {n|turn is|turns are} included. ', { n: recentWindow().filter(t => t.kind === 'ai').length }) +
    (est ? T("At this game's average turn size, up to about {m} turns fit. ", { m: est }) : '')
  );
}
export function recentWindow() {
  // the newest turns, taken from the end until the budget is spent (older player turns count trimmed); at least six
  const pool = app.turns.filter(t => t.i > app.state.summarizedUpto);
  const out = [];
  let used = 0;
  for (let i = pool.length - 1; i >= 0; i--) {
    const t = pool[i];
    const b = tbytes(turnText(t, i < pool.length - 1));
    if (out.length >= 6 && used + b > recentBudget()) break;
    out.unshift(t);
    used += b;
  }
  return out;
}
export function turnText(t, trim, noAdmin) {
  if (t.kind === 'user') {
    const x = String(t.text || '');
    return pl('Player: {text}', { text: trim && x.length > 300 ? x.slice(0, 300) + '…' : x });
  }
  if (t.kind === 'system') return pl('[System] {text}', { text: t.text });
  if (t.kind === 'ledger') return pl('[Life ledger] {text}', { text: (t.out && t.out.summary) || '' });
  const o = t.out || {};
  let s = '';
  if (o.admin && !noAdmin) s += `ADMIN: ${o.admin}\n`;
  s += stripMarks(o.narration).slice(0, 1400);
  if (o.widget)
    s += pl('\n(widget: {type}{headline})', {
      type: o.widget.type,
      headline: o.widget.headline ? ' ' + o.widget.headline : '',
    });
  if (o.choices && o.choices.length) s += pl('\nChoices: {list}', { list: o.choices.join(' / ') });
  return s;
}
// names in the screen's language, texts in the prompt's
export const ADMIN_PERSONAS = () => {
  const ko = (prompts && prompts.personas) || {};
  const en = (prompts && prompts.en && prompts.en.personas) || {};
  const out = {};
  for (const k of Object.keys(ko))
    out[k] = {
      name: en[k] && en[k].name ? T(en[k].name) : ko[k].name,
      text: (promptLang() === 'en' && en[k] && en[k].text) || ko[k].text,
    };
  out.custom = { name: T('Write your own'), text: '' };
  return out;
};
function adminBlock() {
  const AP = ADMIN_PERSONAS();
  const k = setting('adminPersona');
  if (k === 'custom') return app.settings.adminCustom ? `[ADMIN] ${app.settings.adminCustom}` : '';
  return (AP[k] || AP.star || AP.dealer || {}).text || '';
}
// The player's language, length and correction settings sit just before the rules list, after the output format.
// The list's heading was '규칙:' and is now 'Rules:'; with neither, the settings follow the whole rules text.
function withPlayerSettings(rules, extra) {
  if (!extra) return rules;
  // i18n-ignore: an older live prompt's heading
  for (const head of ['\nRules:\n', '\n규칙:\n']) {
    const i = rules.indexOf(head);
    if (i >= 0) return rules.slice(0, i) + '\n' + extra + rules.slice(i);
  }
  return rules + '\n\n' + extra;
}
// The blocks after the rules, in the order the narrator reads them. Empty blocks are left out.
const PROMPT_ORDER = [
  'adminp',
  'cheat',
  'growth',
  'know',
  'world',
  'me',
  'profile',
  'entry',
  'sponsor',
  'stat',
  'ledger',
  'gear',
  'inv',
  'murim',
  'clock',
  'skill',
  'note',
  'quest',
  'rel',
  'lore',
  'past',
  'sum',
  'user',
  'named',
  'bg',
  'widgets',
  'recent',
  'cmd',
  'corr',
  'redo',
  'errata',
  'fate',
  'luck',
  'nodice',
  'jcore',
  'roll',
  'input',
];
// recent turns for the prompt: older player turns are trimmed (the action survives, the long deliberation does not),
// and only the last three remarks ADMIN actually made are kept
function recentForPrompt() {
  const recent = recentWindow();
  const aiIdx = recent.map((t, i) => (t.kind === 'ai' && t.out && t.out.admin ? i : -1)).filter(i => i >= 0);
  const keepAdmin = new Set(aiIdx.slice(-3)); // the last three remarks ADMIN actually made
  const recentStr = recent
    .map((t, i) =>
      i === recent.length - 1 ? turnText(t, false, !keepAdmin.has(i)) : turnText(t, true, !keepAdmin.has(i)),
    )
    .join('\n\n'); // older player turns are trimmed: the action survives, the long deliberation does not
  return recentStr;
}
function meBlock() {
  const l = app.state.life,
    s = app.state.stats;
  const on = titlesOn(),
    fx = app.state.titleFx || {};
  const act = on.length ? on.map(t => `${t}${fx[t] ? `(${fx[t]})` : ''}`).join(', ') : pl('None');
  const held = (app.state.titles || []).filter(t => !on.includes(t));
  return pl(
    '[Player] {name}, {gender}, age {age}, race {race}, standing {origin} ({tier}), titles {titles}, life #{n}',
    {
      name: l.name,
      gender: plLabel(GENDER_LABEL, l.gender),
      age: s.age,
      race: l.race,
      origin: l.origin,
      tier: l.originTier,
      titles: act + (held.length ? pl(' (also held: {list})', { list: held.join(', ') }) : ''),
      n: app.state.lifeNo,
    },
  );
}
function statBlock() {
  const l = app.state.life,
    s = app.state.stats,
    E = app.state.energy;
  const bonus = itemBonus();
  const energy = E
    ? `, ${E.name} ${E.cur}/${E.max}${(r =>
        r <= 0
          ? pl(' (exhausted: no power can be used and the body will not obey)')
          : r < 0.1
            ? pl(' (nearly exhausted)')
            : r < 0.3
              ? pl(' (running low)')
              : '')(E.cur / Math.max(1, E.max))}`
    : pl(', no power resource (no power system yet)');
  return (
    pl('[Stats]') +
    (statusVisible()
      ? ''
      : pl(' (the player cannot see numbers yet: when an awakening or a measurement comes, status_unlock)')) +
    pl(
      ' HP {hp}/{maxHp}, power {power}{bonus}({grade}), Constitution {con} Strength {str} Magic {mag} Agility {agi} Intelligence {int} Charm {cha} (1-10 is the human range, above it superhuman)',
      {
        hp: s.hp,
        maxHp: s.maxHp,
        power: s.power,
        bonus: bonus ? pl('+{bonus}(gear)={total}', { bonus, total: s.power + bonus }) : '',
        grade: powerGrade(s.power + bonus),
        con: s.con,
        str: s.str,
        mag: s.mag,
        agi: s.agi,
        int: s.int,
        cha: s.cha,
      },
    ) +
    energy +
    pl(', money {money}, fame {fame}', { money: moneyText(s.gold, l, promptLang()), fame: s.fame })
  );
}
function murimBlock() {
  const M = app.state.murim;
  if (!M) return '';
  const realm = i => pl(REALMS[i]);
  const arts = ART_SLOTS.filter(k => M.arts[k])
    .map(k => pl(ART_SLOT_LABEL[k]) + ':' + M.arts[k])
    .join(' / ');
  return `${fillTemplate(pr('murim'), { realms: REALMS.map(r => pl(r)).join(' > ') })}\n${pl(
    '[Murim status] realm {realm}{next}, inner energy {neigong} years, faction {faction}{rank}, epithet {alias}{constitution}, arts {arts}',
    {
      realm: realm(M.realm),
      next: M.realm < REALMS.length - 1 ? pl(' (next {realm})', { realm: realm(M.realm + 1) }) : '',
      neigong: M.neigong,
      faction: M.faction || pl('None'),
      rank: M.rank ? '/' + M.rank : '',
      alias: M.alias || pl('None'),
      constitution: M.constitution ? pl(', constitution {c}', { c: M.constitution }) : '',
      arts: arts || pl('None'),
    },
  )}`;
}
function relationsBlock() {
  return Object.keys(app.state.relations).length
    ? (() => {
        const al = {};
        for (const [a, b] of Object.entries(app.state.aliases || {}))
          (al[canonName(b)] = al[canonName(b)] || []).push(a);
        const active = activeRel();
        return active.length
          ? pl('[Relations] {list}', {
              list: active
                .map(([n, v]) => `${n}${al[n] ? `(= ${al[n].slice(0, 4).join(', ')})` : ''}: ${v}`)
                .join(' | '),
            })
          : '';
      })()
    : '';
}
// named characters with portraits, grouped by the set's first identity tag so one line holds a whole sect; groups
// the story mentions come first and the rest rotate over turns, within about 500 bytes
function namedBlock(hay) {
  const l = app.state.life,
    M = app.state.murim;
  const used = new Set(Object.values(app.state.cast));
  const w = l.world.id;
  const ctx = hay + ' ' + (app.state.stateNote || '') + ' ' + ((M && M.faction) || '');
  const list = Object.keys(charSets())
    .map(k => [k, app.setMeta[k] || {}])
    .filter(([k, m]) => m.charName && !used.has(k) && fitsWorld(m, w));
  if (!list.length) return '';
  // grouped by the set's first identity tag, so one line holds a whole sect; groups the story mentions come first, the rest rotate over turns
  const groups = new Map();
  for (const [k, m] of list) {
    const ids = setIds(k);
    const gname = ids.length ? ids[0].val : pl('Other');
    if (!groups.has(gname)) groups.set(gname, { name: gname, vals: [], members: [] });
    const g = groups.get(gname);
    for (const i of ids) if (!g.vals.includes(i.val)) g.vals.push(i.val);
    const segs = String(m.role || '')
      .split(/[,，]/)
      .map(t => {
        for (const i of ids) t = t.split(i.val).join('');
        return t.replace(/\(.*?\)|（.*?）/g, '').trim();
      });
    const short = (segs.find(t => t.length >= 3) || segs[0] || '').slice(0, 12).trim(); // the first phrase that still says something once the identity is removed
    g.members.push({
      name: m.charName,
      g: m.gender === 'female' ? pl('F') : m.gender === 'male' ? pl('M') : '?',
      short,
      hit: ctx.includes(m.charName) ? 1 : 0,
    });
  }
  const N = groups.size,
    r = app.state.next % N;
  const gs = [...groups.values()]
    .map((g, i) => [g, g.vals.some(v => v && ctx.includes(v)) ? 1 : 0, (i - r + N) % N])
    .sort((a, b) => b[1] - a[1] || a[2] - b[2])
    .map(([g]) => g);
  const bytes = x => new TextEncoder().encode(x).length;
  const parts = [];
  let size = 0;
  for (const g of gs) {
    const n = g.members.length,
      r2 = app.state.next % n;
    const ms = g.members
      .map((x, i) => [x, (i - r2 + n) % n])
      .sort((a, b) => b[0].hit - a[0].hit || a[1] - b[1])
      .map(([x]) => x);
    const names = [];
    for (const x of ms.slice(0, 6)) {
      const t = `${x.name}(${x.g}${x.short ? ', ' + x.short : ''})`;
      if (size + bytes(t) + bytes(g.name) + 6 > 500) break;
      names.push(t);
      size += bytes(t) + 2;
    } // at most six per group, so several groups fit; the rest rotate in
    if (names.length) {
      parts.push(`${g.name}: ${names.join(', ')}`);
      size += bytes(g.name) + 4;
    }
    if (size >= 480) break;
  }
  return parts.length ? fillTemplate(pr('named'), { list: parts.join(' | ') }) : '';
}
function widgetsBlock(cmd) {
  const W = pr('widgets') || {};
  if (cmdIs(cmd, 'ask')) return '';
  if (cmd && W[cmd.type]) return fillTemplate(pr('widgetsCmd'), { schema: W[cmd.type] });
  return pr('widgetsIdle');
}
function cmdBlock(cmd) {
  if (!cmd) return '';
  const ask = askOf(cmd);
  if (ask) return fillTemplate(pr(ask.prompt), { q: cmd.arg || pl(ask.q) });
  const how = cmdIs(cmd, 'browse') ? pr('cmdBrowse') : pr('cmdAct');
  return `${pl('[Command] Always fill the {type} widget. {arg}', {
    type: cmd.type,
    arg: cmd.arg ? pl('Content: {arg}', { arg: cmd.arg }) : '',
  })}\n${how}`;
}
const GRADE_WORDS = {
  critSuccess: N_('critical success'),
  success: N_('success'),
  fail: N_('failure'),
  critFail: N_('critical failure'),
};
function rollBlock(roll) {
  return !roll
    ? ''
    : roll.fixed
      ? fillTemplate(pr('roll'), { result: pl(GRADE_WORDS[rollGrade(roll)]), d: roll.d, p: roll.p })
      : roll.d != null
        ? fillTemplate(pr('rollFree'), { d: roll.d })
        : '';
}
const ifAny = (items, f) => (items.length ? f(items.join(' | ')) : '');

// turn: what runTurn rolled for this reply (roll, luck, fate) and what a rewrite must fix (redo)
export function buildPrompt(text, cmd, turn = {}) {
  const { roll = null, luck = null, fate = null, redo = '' } = turn;
  const l = app.state.life,
    ck = app.state.clock;
  const recentStr = recentForPrompt();
  const hay = recentStr.slice(-3000) + ' ' + text;
  const lore = Object.entries(app.state.lore)
    .filter(([k]) => hay.includes(k))
    .slice(0, 15);
  const vocab = placeVocab();
  const d = lifeDiff(l);
  const P = {
    adminp: adminBlock(),
    // the adjective describes the world's demands, not the narrator's attitude
    world: pl(
      "[World] {name}{desc}: {risk}. {opp}. This life's difficulty {d}/5: enemies, rivals and the world's standards and demands are {adj}.",
      {
        name: l.world.name,
        desc: l.world.desc ? ` (${l.world.desc})` : '',
        risk: l.world.risk,
        opp: l.world.opp,
        d,
        adj: d >= 5 ? pl('on the harsh side') : d <= 1 ? pl('on the lenient side') : pl('correspondingly high'),
      },
    ),
    me: meBlock(),
    cheat: pr('cheat'), // always on: asserting things you do not have is a lie inside the fiction
    growth: (() => {
      const k = growthLevel().key;
      return k ? (pr('growth') || {})[k] || '' : '';
    })(),
    know: rule('knowledgeGuard') !== false ? pr('knowledge') : '', // the player always brings knowledge from outside this world (their own, a past life, the character's origin); the rule is about the process, not the source
    profile: l.profile
      ? pl("[Player profile: always reflect it in this character's story and personality] {profile}", {
          profile: l.profile,
        })
      : '',
    entry:
      l.entry === 'possess'
        ? pr('entryPossess')
        : l.entry === 'transfer'
          ? fillTemplate(pr('entryTransfer'), { from: l.world.from || pl('modern-day Earth') })
          : '',
    sponsor: l.sponsor
      ? fillTemplate(app.state.channelOpen ? pr('sponsorOpen') : pr('sponsorClosed'), {
          stance: plLabel(STANCE_LABEL, l.sponsor.stance),
        })
      : '',
    stat: statBlock(),
    murim: murimBlock(),
    clock: `${pl('[Time]')} D+${ck.day}${ck.date ? ', ' + withWeekday(ck.date) : ''}${ck.time ? ', ' + ck.time : ''}${ck.weather ? ', ' + ck.weather : ''}${ck.place ? ', ' + ck.place : ''}`,
    skill: `${pl('[Skills]')} ${app.state.skills.map(k => `${k.name}(${k.grade}, Lv.${k.lv || 1}${k.cost ? pl(', cost {n}%', { n: k.cost }) : ''}${k.src === SKILL_SRC.INHERITED ? pl(', inherited from a past life') : ''}): ${k.desc}`).join(' | ')}`,
    note: app.state.stateNote ? pl('[Current situation] {note}', { note: app.state.stateNote }) : '',
    quest: ifAny(
      app.state.quests.filter(q => q.status === 'active').map(q => q.title + (q.note ? ` (${q.note})` : '')),
      list => pl('[Active quests] {list}', { list }),
    ),
    ledger: ifAny(
      Object.entries(app.state.ledger || {}).map(([k, v]) => `${k}: ${v}`),
      list => pl('[Ledger] {list}', { list }),
    ),
    gear: ifAny(
      (app.state.equipped || []).map(n => {
        const it = (app.state.items || []).find(x => x.name === n) || {};
        return `${n}(${it.grade || '-'}${it.power ? ', +' + it.power : ''}${it.note ? ': ' + it.note.slice(0, 40) : ''})`;
      }),
      list => pl('[Gear] {list}', { list }),
    ),
    inv: ifAny(
      (app.state.items || []).map(
        it =>
          `${it.name}${it.qty > 1 ? ' x' + it.qty : ''}${it.grade ? '(' + it.grade + ')' : ''}${it.note && !(app.state.equipped || []).includes(it.name) ? ': ' + it.note.slice(0, 30) : ''}`,
      ),
      list => pl('[Inventory] {list}', { list }),
    ),
    rel: relationsBlock(),
    lore: ifAny(
      lore.map(([k, v]) => `${k}: ${v}`),
      list => pl('[Related lore] {list}', { list }),
    ),
    past: ifAny(
      app.state.pastLives.slice(-5).map(p =>
        pl('life {n}: {world}/{origin} ({tier}), {epitaph}', {
          n: p.lifeNo,
          world: p.world,
          origin: p.origin,
          tier: p.tier,
          epitaph: p.epitaph,
        }),
      ),
      list => pl('[Past lives] {list}', { list }),
    ),
    sum: app.state.summaries.length
      ? `${pl('[Story so far]')}\n${app.state.summaries.map(x => '- ' + x.text).join('\n')}`
      : '',
    user: app.state.userNotes ? `${pl('[Player notes: always follow]')}\n${app.state.userNotes}` : '',
    named: namedBlock(hay),
    bg: pl('[Place words] {list}', { list: vocab.length ? vocab.join(', ') : pl('none. scene is null') }),
    recent: recentStr ? `${pl('[Recent]')}\n${recentStr}` : '',
    widgets: widgetsBlock(cmd),
    cmd: cmdBlock(cmd),
    redo: redo ? fillTemplate(pr('redo'), { reason: redo }) : '',
    errata:
      app.state.errataNote && !cmdIs(cmd, 'browse')
        ? fillTemplate(
            pr('errata') ||
              pl(
                '[Correction] An error in the earlier record was fixed: {fact}. Smooth it over naturally in a sentence or two at the start of this reply.',
              ),
            { fact: app.state.errataNote },
          )
        : '',
    corr: (app.state.corrections || []).filter(c => c.until >= app.state.next).length
      ? `${pr('corrHead')}\n${app.state.corrections
          .filter(c => c.until >= app.state.next)
          .map(c => '- ' + c.text)
          .join('\n')}`
      : '',
    fate: fate ? pr('fateHead') + (fate === 'jackpot' ? pr('fateJackpot') : pr('fateDoom')) : '',
    luck: luck === 'bad' ? pr('luckBad') || '' : luck === 'good' ? pr('luckGood') || '' : '',
    nodice: rule('dice') === false ? pr('noDice') || '' : '',
    jcore: roll || (cmd && cmd.type === 'judge') ? pr('judgeCore') || '' : '',
    roll: rollBlock(roll),
    input: `${pl('[This input] {text}', { text })}\n\n${pr('jsonTail')}`,
  };
  const LEN = { short: pr('lenShort'), normal: '', long: pr('lenLong') }[setting('len')] || '';
  const tip = app.settings.langTip ? prLang('tip') : '';
  const extra = prLang('lang') + (tip ? pl('\n[Extra output field] ') + tip : '');
  const rules = withPlayerSettings(pr('rules') || '', [LEN, extra].filter(Boolean).join('\n'));
  const build = skip =>
    rules +
    '\n\n' +
    PROMPT_ORDER.filter(k => P[k] && !skip.includes(k))
      .map(k => P[k])
      .join('\n\n');
  let p = build([]);
  const max = (platform.limits && platform.limits.maxPromptBytes) || 0;
  if (max && new Blob([p]).size > max * 0.9) p = build(['lore', 'bg', 'past']);
  return p;
}

const FATAL = [
  'not_granted',
  'rate_limited',
  'refused',
  'cancelled',
  'sampling_disabled',
  'session_expired',
  'prompt_too_large',
];
export let promptStats = []; // estimated tokens of the last prompts, for the settings tab
// one id per send: a retry of the same send reuses it, so an answer that finished while the page was away replays at no cost; anything else (a new send, a rewrite, a branch) gets a new id and never sees an old answer
const REPLAY = { gcTime: 3600000 };
const STALE_REQ = new Set(); // request ids whose cached answer was unusable: the next try asks for a fresh one
// What a reply still streaming already says: the fields the live box shows early. A field not yet complete is null,
// except the narration, which is read as far as it has come. sceneReady: enough is in to pick the banner and the face.
export function peekReply(text) {
  const str = k => {
    const m = new RegExp('"' + k + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(text);
    return m ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : null;
  };
  const scene = str('scene'),
    speaker = str('speaker'),
    emotion = str('emotion');
  const narration = /"narration"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text);
  return {
    scene,
    speaker,
    emotion,
    gender: str('speaker_gender'),
    role: str('speaker_role'),
    weight: str('speaker_weight'),
    time: str('time'),
    hidden: /"speaker_hidden"\s*:\s*true/.test(text),
    look: ((/"speaker_look"\s*:\s*\[([^\]]*)\]/.exec(text) || [])[1] || '')
      .replace(/"/g, '')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean),
    admin: str('admin'),
    narration: narration ? narration[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : null,
    sceneReady:
      scene !== null &&
      (speaker !== null || /"speaker"\s*:\s*null/.test(text)) &&
      (emotion !== null || /"admin"/.test(text)),
  };
}
// turn: the reply being written (turn.js runTurn); its request id, its stop handle, and what to do as it streams (turn.onText)
export async function callNarrator(text, cmd, turn) {
  const req = turn.req;
  const prompt = buildPrompt(text, cmd, turn) + (req ? `\n(req ${req})` : '');
  const cacheOpt = () => (!req ? false : STALE_REQ.has(req) ? Object.assign({ refresh: true }, REPLAY) : REPLAY);
  const stale = () => {
    if (req) STALE_REQ.add(req);
  };
  try {
    const tok = Math.round(new TextEncoder().encode(prompt).length / 2.6);
    promptStats.push(tok);
    promptStats = promptStats.slice(-20);
  } catch {
    // prompt size stats are diagnostics only
  }
  const onText = turn.onText; // what to do with the reply as it streams (turn.js streamedReply)
  const ok = o => o && (String(o.narration || '').trim().length > 0 || o.widget);
  const signal = turn.abort && turn.abort.signal;
  try {
    const o = normalize(
      await platform.sample.json(prompt, {
        modelTier: setting('tier'),
        cache: cacheOpt(),
        onText,
        signal,
      }),
    );
    if (ok(o)) return o;
    stale();
    logErr('json', {
      code: 'empty_narration',
      message: 'JSON without narration',
      text: JSON.stringify(o).slice(0, 300),
    });
  } catch (e) {
    logErr('json', e);
    if (e && FATAL.includes(e.code)) throw e;
    if (e && e.text) {
      const j = extractJson(e.text);
      if (j && ok(normalize(j))) return normalize(j);
    }
  }
  {
    // fallback 1: plain text mode, then pull the JSON out ourselves
    if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    try {
      const r = await platform.sample(prompt + '\n\n' + pr('fallbackText'), {
        modelTier: setting('tier'),
        cache: cacheOpt(),
        onText,
        signal,
      });
      const j = extractJson((r && r.text) || '');
      if (j && ok(normalize(j))) return normalize(j);
      stale();
      logErr('text', { code: 'no_json', message: 'text reply without usable JSON', text: r && r.text });
    } catch (e2) {
      logErr('text', e2);
      if (e2 && FATAL.includes(e2.code)) throw e2;
    }
    // fallback 2: compact retry on the quick tier
    if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    try {
      const r = await platform.sample(prompt + '\n\n' + pr('fallbackCompact'), {
        modelTier: 'quick',
        cache: false,
        signal,
      });
      const j = extractJson((r && r.text) || '');
      if (j && ok(normalize(j))) return normalize(j);
      logErr('compact', { code: 'no_json', message: 'compact reply without usable JSON', text: r && r.text });
    } catch (e3) {
      logErr('compact', e3);
      if (e3 && FATAL.includes(e3.code)) throw e3;
    }
    throw Object.assign(new Error(T("Couldn't read the reply (see ⚙ → Recent errors)")), { code: 'no_json' });
  }
}
function extractJson(t) {
  if (!t) return null;
  t = String(t).replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{'),
    b = t.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  const body = t.slice(a, b + 1);
  try {
    return JSON.parse(body);
  } catch {
    // not plain JSON: try the lenient form below
  }
  try {
    return JSON.parse(body.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001f]+/g, ' '));
  } catch {
    // still not JSON: try closing a truncated object below
  }
  // truncated output: close open strings/brackets and retry
  let fixed = body;
  const q = (fixed.match(/(?<!\\)"/g) || []).length;
  if (q % 2) fixed += '"';
  let depth = 0;
  for (const ch of fixed) {
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  fixed = fixed.replace(/,\s*$/, '');
  while (depth-- > 0) fixed += '}';
  try {
    return JSON.parse(fixed);
  } catch (e) {
    return null;
  }
}
const noDash = t =>
  String(t)
    .replace(/\s*—+\s*/g, m => (/\s$/.test(m) && /^\s/.test(m) ? ', ' : ', '))
    .replace(/,\s*,/g, ',')
    .replace(/\(\s*,\s*/g, '(')
    .replace(/\s*,\s*\)/g, ')');
export function normalize(o) {
  if (!o || typeof o !== 'object') o = {};
  o.narration = noDash(o.narration || '');
  o.admin = noDash(o.admin || '');
  o.system = Array.isArray(o.system) ? o.system.map(x => noDash(x)).slice(0, LIMITS.perReply.system) : [];
  o.choices = Array.isArray(o.choices) ? o.choices.map(x => noDash(x)).slice(0, LIMITS.perReply.choices) : [];
  if (o.widget && typeof o.widget === 'object') {
    const walk = v =>
      typeof v === 'string'
        ? noDash(v)
        : Array.isArray(v)
          ? v.map(walk)
          : v && typeof v === 'object'
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
            : v;
    o.widget = walk(o.widget);
  }
  if (o.widget && !widgetOf(o.widget)) o.widget = null;
  if (o.reasons && typeof o.reasons === 'object') {
    const r = {};
    for (const [k, v] of Object.entries(o.reasons).slice(0, LIMITS.perReply.reasons))
      if (v) r[String(k).slice(0, LIMITS.text.statKey)] = String(v).slice(0, LIMITS.text.reason);
    o.reasons = r;
  } else o.reasons = {};
  o.windfall = o.windfall === true;
  if (o.check && (typeof o.check !== 'object' || !(Number(o.check.p) > 0))) o.check = null;
  o.also_present = Array.isArray(o.also_present)
    ? o.also_present.filter(p => p && typeof p === 'object' && p.name).slice(0, LIMITS.perReply.alsoPresent)
    : [];
  o.speaker_hidden = o.speaker_hidden === true;
  o.ledger = o.ledger && typeof o.ledger === 'object' && !Array.isArray(o.ledger) ? o.ledger : null;
  if (app.state && rule('dice') === false && Array.isArray(o.choices))
    o.choices = o.choices.map(c => stripOdds(c).trim());
  o.items = Array.isArray(o.items)
    ? o.items.filter(x => x && typeof x === 'object' && x.name).slice(0, LIMITS.perReply.items)
    : [];
  o.equip = Array.isArray(o.equip) ? o.equip.map(String) : [];
  o.unequip = Array.isArray(o.unequip) ? o.unequip.map(String) : [];
  return o;
}
