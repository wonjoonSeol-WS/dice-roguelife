/* ============ applying a reply ============ */
import { cutLine, MARK_RE, pick } from './util.js';
import { currencyOf, moneyText, normEmo, REALMS, STAT_LABEL, SUB_STATS, tierRank, TIERS } from './data.js';
import { ART_SLOT_LABEL, ART_SLOTS, artsToEnums, SKILL_SRC } from './enums.js';
import { T, tIn } from './i18n.js';
import { LIMITS } from './limits.js';
import { addDaysISO, clockMin, fmtKDate, parseKDate } from './calendar.js';
import { app } from './app.js';
import { storyLang } from './settings.js';
import { costPct, growthLevel, sameQuest, TITLES_MAX, titlesOn } from './rules.js';
import { markSeen, renamePerson } from './people.js';
import { bgKey, imgById, pickEmotion } from './images.js';
import { baseOfKey, findPlace } from './places.js';
import { aiWillPick, castFor, presentOf, setTier, shadowFor, speakerOf, startAiPick } from './casting.js';

// applyOut turns one normalized narrator reply into state changes. Each step owns one part of the reply, and all of
// them write what the player should see into the shared result: deltas (the number chips), notes (system lines) and
// img (the scene and the people on screen). The steps run in this order; later ones may read what earlier ones did.
const APPLY_STEPS = [
  applyWindfall,
  applyMainStats,
  applySubStats,
  applyEnergy,
  applyMoneyUnit,
  clampStats,
  applyTitle,
  applyStatusUnlock,
  applyItems,
  applyEquipment,
  applyLedger,
  applyChannel,
  applyRace,
  applyLevelUps,
  applyEvolutions,
  applyNewSkills,
  applySkillCosts,
  applyRemovedSkills,
  applyLore,
  applyRelations,
  applyRenames,
  applyStateNote,
  applyDeaths,
  applyQuests,
  applyClock,
  applyMurim,
  applyScene,
  applySpeaker,
  applyCast,
  applyPlaces,
  applyDeath,
];

const WINDFALL_WINDOW = 30; // turns: a second windfall inside it counts at half strength
const NEW_DAY_GAP = 360; // minutes: the clock going back this far without days passing means the night went by

// turn: the reply being written (turn.js runTurn); applying reads its fate and the streamed preview
export function applyOut(reply, turn = {}) {
  const ctx = {
    reply,
    stats: app.state.stats,
    deltas: {},
    notes: [],
    img: {},
    newSkills: [],
    events: new Set(), // 'realm' | 'title' | 'quest' | 'skill': what the turn's sound cue plays for
    isJackpot: turn.fate === 'jackpot',
    preview: turn.preview || null, // the banner and face picked while the reply streamed
    growth: growthLevel(),
    hasWindfall: !!reply.windfall,
    windfallStrength: 0, // 1 for a windfall, 0.5 for a second one inside WINDFALL_WINDOW
    growthMult: 1, // growth multiplier for this reply
    bannerBase: '', // the place the scene banner shows
  };
  for (const step of APPLY_STEPS) step(ctx);
  return {
    deltas: ctx.deltas,
    newSkills: ctx.newSkills,
    notes: ctx.notes,
    img: ctx.img,
    events: ctx.events,
  };
}

/* ---- stats ---- */
function applyWindfall(ctx) {
  const soon = ctx.hasWindfall && app.state.next - (app.state.lastWindfall ?? -Infinity) < WINDFALL_WINDOW;
  ctx.windfallStrength = ctx.hasWindfall ? (soon ? 0.5 : 1) : 0; // a second windfall inside the window still counts, at half strength
  if (ctx.hasWindfall) {
    app.state.lastWindfall = app.state.next;
    ctx.notes.push(soon ? T('✦ Windfall (halved: too soon after the last)') : T('✦ Windfall'));
  }
  ctx.growthMult = ctx.growth.gm * (1 + ctx.windfallStrength);
}

function applyMainStats(ctx) {
  const { reply, stats, deltas, notes, growthMult } = ctx;
  const ch = reply.stat_changes || {};
  const cap = {
    power: Math.round(Math.max(60, stats.power * 0.6) * growthMult),
    maxHp: Math.round(Math.max(40, stats.maxHp * 0.5) * growthMult),
    gold: Math.round(Math.max(2000 * currencyOf(app.state.life)[1], stats.gold * 5) * growthMult),
    fame: Math.round(Math.max(30, stats.fame * 0.6) * growthMult),
  };
  for (const k of ['hp', 'maxHp', 'power', 'gold', 'fame']) {
    let v = Math.round(Number(ch[k]) || 0);
    if (!v) continue;
    if (!ctx.isJackpot && v > 0 && cap[k] && v > cap[k]) {
      v = cap[k];
      notes.push(T('{stat} gain capped', { stat: T(STAT_LABEL[k] || STAT_LABEL.maxHp) }));
    }
    deltas[k] = v;
    stats[k] = (stats[k] || 0) + v;
  }
}

function applySubStats(ctx) {
  const { reply, stats, deltas, notes, isJackpot, hasWindfall, windfallStrength } = ctx;
  const ch = reply.stat_changes || {};
  app.state.statUp = app.state.statUp || {};
  const subMax = ctx.growth.subMax,
    cool = ctx.growth.cool;
  for (const [k, label] of SUB_STATS) {
    let v = Math.round(Number(ch[k]) || 0);
    if (!v) continue;
    const lim = hasWindfall
      ? Math.max(Math.round(subMax * (1 + 2 * windfallStrength)), Math.ceil((stats[k] || 5) * 0.2 * windfallStrength))
      : subMax;
    if (!isJackpot) v = Math.max(-lim, Math.min(lim, v));
    if (
      v > 0 &&
      !isJackpot &&
      !hasWindfall &&
      cool &&
      app.state.statUp[k] != null &&
      app.state.next - app.state.statUp[k] < cool
    ) {
      const n = cool - (app.state.next - app.state.statUp[k]);
      notes.push(T('{stat} growth on cooldown ({n} {n|turn|turns} left)', { stat: T(label), n }));
      continue;
    }
    const before = stats[k] || 5;
    if (v > 0) app.state.statUp[k] = app.state.next;
    stats[k] = Math.max(1, Math.min(LIMITS.statMax, before + v));
    deltas[k] = stats[k] - before;
  }
}

// the power pool: created when the character gains a power system; only the label differs per character (기, 마나, 오러...)
function applyEnergy(ctx) {
  const { deltas, notes } = ctx;
  const e = ctx.reply.energy;
  if (!e || typeof e !== 'object') return;
  const name = String(e.name || (app.state.energy && app.state.energy.name) || tIn(storyLang(), 'Mana')).slice(
    0,
    LIMITS.text.energyName,
  );
  const mx = Math.round(Number(e.max) || 0);
  const d = Math.round(Number(e.delta) || 0);
  if (!app.state.energy && mx > 0) {
    app.state.energy = { name, cur: mx, max: mx };
    notes.push(T('{name} awakened ({max})', { name, max: mx }));
  } else if (app.state.energy) {
    app.state.energy.name = name;
    if (mx > app.state.energy.max) {
      const lim = ctx.isJackpot || ctx.hasWindfall ? mx : Math.round(app.state.energy.max * 1.2 + 10);
      const nm = Math.min(mx, lim);
      deltas.energyMax = nm - app.state.energy.max;
      app.state.energy.max = nm;
    }
    if (d) {
      const before = app.state.energy.cur;
      app.state.energy.cur = Math.max(0, Math.min(app.state.energy.max, before + d));
      if (app.state.energy.cur !== before) deltas.energy = app.state.energy.cur - before;
    }
  }
}

function clampStats(ctx) {
  const { stats } = ctx;
  stats.maxHp = Math.max(1, stats.maxHp);
  stats.hp = Math.min(stats.hp, stats.maxHp);
  stats.gold = Math.max(0, stats.gold);
  stats.power = Math.max(0, stats.power);
}

// another currency on the player's word; money_rate (new units per old) converts what they hold, within sane bounds
function applyMoneyUnit(ctx) {
  const u = ctx.reply.money_unit;
  if (typeof u !== 'string' || !u.trim()) return;
  const life = app.state.life;
  const rate = Number(ctx.reply.money_rate);
  const from = moneyText(ctx.stats.gold, life);
  life.unit = cutLine(u, LIMITS.text.name);
  if (!(rate >= 1e-4 && rate <= 1e4)) return;
  life.scale = currencyOf(life)[1] * rate;
  ctx.stats.gold = Math.round(ctx.stats.gold * rate);
  ctx.notes.push(T('Money: {from} → {to}', { from, to: moneyText(ctx.stats.gold, life) }));
}

/* ---- titles, items, ledger ---- */
function applyTitle(ctx) {
  const o = ctx.reply;
  if (!o.title || (app.state.titles || []).includes(String(o.title).slice(0, LIMITS.text.label))) return;
  const nt = String(o.title).slice(0, LIMITS.text.label);
  app.state.titles = [...new Set([...(app.state.titles || []), nt])].slice(-LIMITS.kept.titles);
  app.state.titleFx = app.state.titleFx || {};
  if (o.title_effect) app.state.titleFx[nt] = String(o.title_effect).slice(0, LIMITS.text.note);
  const on = titlesOn();
  if (on.length < TITLES_MAX) {
    on.push(nt);
    app.state.titlesOn = on;
  }
  app.state.title = titlesOn()[0] || nt;
  ctx.notes.push(
    T('Title: {title}', { title: nt + (app.state.titleFx[nt] ? ' (' + app.state.titleFx[nt] + ')' : '') }),
  );
  ctx.events.add('title');
}

function applyStatusUnlock(ctx) {
  if (ctx.reply.status_unlock === true && !app.state.statusUnlocked) {
    app.state.statusUnlocked = true;
    ctx.notes.push(T('Status window unlocked'));
  }
}

function applyItems(ctx) {
  const notes = ctx.notes;
  app.state.items = app.state.items || [];
  app.state.equipped = app.state.equipped || [];
  for (const it of ctx.reply.items) {
    const name = String(it.name).trim().slice(0, LIMITS.text.name);
    if (!name) continue;
    const q = Math.round(Number(it.qty));
    const d = isNaN(q) || q === 0 ? 1 : q;
    let ex = app.state.items.find(x => x.name === name);
    if (!ex) {
      if (d < 0) continue;
      ex = {
        name,
        qty: 0,
        grade: TIERS.includes(it.grade) ? it.grade : null,
        note: String(it.note || '').slice(0, LIMITS.text.note),
        slot: ['weapon', 'armor', 'accessory'].includes(it.slot) ? it.slot : null,
        power: Math.max(0, Math.round(Number(it.power) || 0)),
      };
      app.state.items.push(ex);
    } else {
      if (it.note && !ex.note) ex.note = String(it.note).slice(0, LIMITS.text.note);
      if (it.power != null && !ex.power) ex.power = Math.max(0, Math.round(Number(it.power) || 0));
      if (it.slot && !ex.slot && ['weapon', 'armor', 'accessory'].includes(it.slot)) ex.slot = it.slot;
    }
    ex.qty = Math.max(0, ex.qty + d);
    notes.push(
      d > 0
        ? T('Gained: {item}', { item: name + (d > 1 ? ' x' + d : '') })
        : T('Used: {item}', { item: name + (-d > 1 ? ' x' + -d : '') }),
    );
    if (ex.qty <= 0) {
      app.state.items = app.state.items.filter(x => x !== ex);
      app.state.equipped = app.state.equipped.filter(n => n !== name);
    }
  }
  if (app.state.items.length > LIMITS.kept.items) app.state.items = app.state.items.slice(-LIMITS.kept.items);
}

// whether something can be worn was the narrator's call; the code only keeps the list honest
function applyEquipment(ctx) {
  const { reply, notes } = ctx;
  for (const n0 of reply.unequip) {
    const n = String(n0).trim();
    if (app.state.equipped.includes(n)) {
      app.state.equipped = app.state.equipped.filter(x => x !== n);
      notes.push(T('Unequipped: {item}', { item: n }));
    }
  }
  for (const n0 of reply.equip) {
    const n = String(n0).trim();
    if (!app.state.items.find(x => x.name === n) || app.state.equipped.includes(n)) continue;
    if (app.state.equipped.length >= LIMITS.kept.equipped) break;
    app.state.equipped.push(n);
    notes.push(T('Equipped: {item}', { item: n }));
  }
}

// the numbers the story counts live here, not in prose
function applyLedger(ctx) {
  const { reply, notes } = ctx;
  if (!reply.ledger) return;
  app.state.ledger = app.state.ledger || {};
  for (const [k0, v] of Object.entries(reply.ledger).slice(0, LIMITS.perReply.ledger)) {
    const k = String(k0).trim().slice(0, LIMITS.text.name);
    if (!k) continue;
    if (v === null || v === '') {
      if (k in app.state.ledger) {
        delete app.state.ledger[k];
        notes.push(T('Ledger closed: {entry}', { entry: k }));
      }
      continue;
    }
    const nv = cutLine(v, LIMITS.kept.ledgerLine);
    if (app.state.ledger[k] !== nv) {
      app.state.ledger[k] = nv;
      notes.push(T('Ledger: {entry}', { entry: `${k} ${nv}` }));
    }
  }
  const ks = Object.keys(app.state.ledger);
  if (ks.length > 12) for (const k of ks.slice(0, ks.length - 12)) delete app.state.ledger[k];
}

// ignored in a life without constellations
function applyChannel(ctx) {
  if (ctx.reply.channel_open === true && app.state.life.sponsor && !app.state.channelOpen) {
    app.state.channelOpen = true;
    app.state.channelAt = app.state.next;
    ctx.notes.push(T('Constellation channel opened'));
  }
}

function applyRace(ctx) {
  const o = ctx.reply;
  if (o.race && typeof o.race === 'string' && o.race.trim() && o.race.trim() !== app.state.life.race) {
    const nr = o.race.trim().slice(0, LIMITS.text.name);
    ctx.notes.push(T('Race changed: {from} → {to}', { from: app.state.life.race, to: nr }));
    app.state.life.race = nr;
  }
}

/* ---- skills ---- */
function applyLevelUps(ctx) {
  const o = ctx.reply;
  for (const nm of [...new Set((Array.isArray(o.level_ups) ? o.level_ups : []).map(String))].slice(
    0,
    LIMITS.perReply.levelUps,
  )) {
    const k = app.state.skills.find(x => x.name === String(nm));
    if (!k) continue;
    k.lv = Math.min(LIMITS.skillLevelMax, (k.lv || 1) + 1);
    ctx.notes.push(`${k.name} Lv.${k.lv}`);
    ctx.events.add('skill');
  }
}

function applyEvolutions(ctx) {
  const o = ctx.reply;
  for (const ev of (Array.isArray(o.evolve_skills) ? o.evolve_skills : []).slice(0, LIMITS.perReply.evolveSkills)) {
    if (!ev || !ev.from || !ev.to) continue;
    const froms = (Array.isArray(ev.from) ? ev.from : [ev.from]).map(String);
    const ks = froms.map(n => app.state.skills.find(x => x.name === n));
    if (ks.some(k => !k)) continue;
    const best = ks.reduce((a, k) => (tierRank(k.grade) < tierRank(a) ? k.grade : a), ks[0].grade);
    const g = TIERS.includes(ev.grade) ? ev.grade : best;
    if (!ctx.isJackpot && !ctx.hasWindfall && tierRank(g) < tierRank(best) - 1) continue;
    const to = String(ev.to).slice(0, LIMITS.text.name);
    app.state.skills = app.state.skills.filter(k => !ks.includes(k));
    const nk = {
      name: to,
      grade: g,
      desc: String(ev.desc || ks[0].desc || '').slice(0, LIMITS.text.desc),
      src: ks.length > 1 ? SKILL_SRC.MERGED : SKILL_SRC.EVOLVED,
      lv: 1,
      at: app.state.next,
    };
    const ec = costPct(ev.cost) || ks[0].cost;
    if (ec) nk.cost = ec;
    app.state.skills.push(nk);
    ctx.notes.push(
      ks.length > 1
        ? T('Skills merged: {from} → {to}', { from: froms.join(' + '), to })
        : T('Skill evolved: {from} → {to}', { from: froms[0], to }),
    );
    ctx.events.add('skill');
  }
}

// a new skill is capped one grade above the best the character already has (origin, talent or skills)
function applyNewSkills(ctx) {
  const best = Math.min(
    tierRank(app.state.life.originTier),
    tierRank(app.state.life.talentTier),
    ...app.state.skills.map(k => tierRank(k.grade)),
  );
  for (const k of (ctx.reply.add_skills || []).slice(0, LIMITS.perReply.addSkills)) {
    if (!k || !k.name) continue;
    let g = TIERS.includes(k.grade) ? k.grade : 'C';
    if (!ctx.isJackpot && tierRank(g) < Math.max(0, best - 1)) {
      g = TIERS[Math.max(0, best - 1)];
      ctx.notes.push(T('Skill grade capped ({grade})', { grade: g }));
    }
    if (!app.state.skills.find(x => x.name === k.name)) {
      const sk = {
        name: String(k.name).slice(0, LIMITS.text.name),
        grade: g,
        desc: String(k.desc || '').slice(0, LIMITS.text.desc),
        src: SKILL_SRC.GAINED,
        at: app.state.next,
      };
      const c = costPct(k.cost);
      if (c) sk.cost = c;
      app.state.skills.push(sk);
      ctx.newSkills.push(k.name);
    }
  }
}

// a cost is set once; the narrator reads it back from the skills block
function applySkillCosts(ctx) {
  const o = ctx.reply;
  for (const [n, v] of Object.entries(o.skill_costs && typeof o.skill_costs === 'object' ? o.skill_costs : {}).slice(
    0,
    LIMITS.perReply.skillCosts,
  )) {
    const k = app.state.skills.find(x => x.name === String(n));
    const c = costPct(v);
    if (k && c && !k.cost) {
      k.cost = c;
      ctx.notes.push(T('{skill} cost {cost}%', { skill: k.name, cost: c }));
    }
  }
}

// an inherited skill cannot be taken away
function applyRemovedSkills(ctx) {
  for (const n of ctx.reply.remove_skills || [])
    app.state.skills = app.state.skills.filter(x => x.name !== n || x.src === SKILL_SRC.INHERITED);
}

/* ---- memory ---- */
function applyLore(ctx) {
  const m = ctx.reply.memory || {};
  for (const l of (m.lore || []).slice(0, LIMITS.perReply.lore)) {
    if (l && l.key)
      app.state.lore[String(l.key).slice(0, LIMITS.text.name)] = String(l.text || '').slice(0, LIMITS.text.entry);
  }
  const lk = Object.keys(app.state.lore);
  if (lk.length > LIMITS.kept.lore) for (const k of lk.slice(0, lk.length - LIMITS.kept.lore)) delete app.state.lore[k];
}

function applyRelations(ctx) {
  const m = ctx.reply.memory || {};
  for (const rel of (m.relations || []).slice(0, LIMITS.perReply.relations)) {
    if (rel && rel.name) {
      const nm = String(rel.name).slice(0, LIMITS.text.name);
      app.state.relations[nm] = String(rel.note || '').slice(0, LIMITS.text.remark);
      markSeen(nm);
    }
  }
}

// two labels for one person become one: one face, one set of notes
function applyRenames(ctx) {
  const o = ctx.reply;
  if (!o.renames || typeof o.renames !== 'object') return;
  for (const [from, to] of Object.entries(o.renames).slice(0, LIMITS.perReply.renames)) {
    const a = String(from).trim().slice(0, LIMITS.text.name),
      b = String(to || '')
        .trim()
        .slice(0, LIMITS.text.name);
    if (a && b && a !== b && renamePerson(a, b)) ctx.notes.push(T('Same person: {from} → {to}', { from: a, to: b }));
  }
}

function applyStateNote(ctx) {
  const m = ctx.reply.memory || {};
  if (m.state_note) app.state.stateNote = String(m.state_note).slice(0, LIMITS.text.remark);
}

// a death retires the face the person wore (cast now if they never had one), so nobody else wears it later
function applyDeaths(ctx) {
  const o = ctx.reply;
  const m = o.memory || {};
  for (const nm of (Array.isArray(m.died) ? m.died : []).slice(0, LIMITS.perReply.died)) {
    const n = String(nm || '')
      .trim()
      .slice(0, LIMITS.text.name);
    if (!n) continue;
    app.state.deadNpc = app.state.deadNpc || {};
    if (app.state.deadNpc[n]) continue;
    let k = app.state.cast[n];
    if (!k) {
      const c = [speakerOf(o), ...(o.also_present || []).map(presentOf)].find(p => p.name === n);
      if (c) k = castFor(c);
    }
    const tier = k ? setTier(k) : 'extra';
    app.state.deadNpc[n] = { tier, set: k || null, at: app.state.next };
    ctx.notes.push(T('Died: {name}', { name: n }));
  }
}

function applyQuests(ctx) {
  const m = ctx.reply.memory || {};
  for (const q of m.quests || []) {
    if (!q || !q.title) continue;
    const ex =
      app.state.quests.find(x => x.title === q.title) ||
      app.state.quests.find(x => x.status === 'active' && sameQuest(x.title, q.title));
    if (ex) {
      if (q.status === 'done' && ex.status !== 'done') {
        ctx.notes.push(T('Quest done: {title}', { title: ex.title }));
        ctx.events.add('quest');
      }
      ex.status = q.status || ex.status;
      if (q.note) ex.note = q.note;
    } else app.state.quests.push({ title: q.title, status: q.status || 'active', note: q.note || '' });
  }
  app.state.quests = app.state.quests.slice(-LIMITS.kept.quests);
}

/* ---- time and martial arts ---- */
// the code owns the day count, the calendar and aging; the narrator only reports how much time passed
function applyClock(ctx) {
  const { stats, deltas } = ctx;
  const c = ctx.reply.clock;
  if (!c || typeof c !== 'object') return;
  let d = Math.max(0, Math.min(LIMITS.move.days, Math.round(Number(c.days_passed) || 0)));
  const tPrev = clockMin(app.state.clock.time),
    tNew = c.time ? clockMin(c.time) : null;
  let keepTime = false;
  if (d === 0 && tPrev != null && tNew != null && tNew < tPrev) {
    if (tPrev - tNew >= NEW_DAY_GAP) d = 1;
    else keepTime = true;
  } /* night into morning is a new day even unreported; a few minutes back within a day keep the earlier time */
  if (!app.state.clock.anchor) {
    const iso = parseKDate(app.state.clock.date);
    if (iso) app.state.clock.anchor = { date: iso, day: app.state.clock.day };
  } /* a save from before the code counted dates: today's date becomes the anchor, so passing days move it */
  const before = app.state.clock.day;
  app.state.clock.day += d;
  const yrs = Math.floor(app.state.clock.day / 365) - Math.floor(before / 365);
  if (yrs > 0) {
    stats.age += yrs;
    deltas.age = yrs;
  }
  for (const k of ['weather', 'place']) if (c[k]) app.state.clock[k] = String(c[k]).slice(0, LIMITS.text.label);
  if (c.time && !keepTime) app.state.clock.time = String(c.time).slice(0, LIMITS.text.label);
  if (app.state.clock.anchor)
    app.state.clock.date = fmtKDate(
      addDaysISO(app.state.clock.anchor.date, app.state.clock.day - app.state.clock.anchor.day),
      storyLang(),
    ); /* a real calendar: the code counts the date */
  else if (c.date) {
    const iso = parseKDate(c.date);
    if (iso) {
      app.state.clock.anchor = { date: iso, day: app.state.clock.day };
      app.state.clock.date = fmtKDate(iso, storyLang());
    } else app.state.clock.date = String(c.date).slice(0, LIMITS.text.label);
  }
}

// one realm step at a time
function applyMurim(ctx) {
  const { reply, deltas, notes, events } = ctx;
  if (!app.state.murim || !reply.murim || typeof reply.murim !== 'object') return;
  const u = reply.murim,
    M = app.state.murim;
  if (u.realm_up === true && M.realm < REALMS.length - 1) {
    M.realm++;
    notes.push(T('Realm up: {realm}', { realm: T(REALMS[M.realm]) }));
    events.add('realm');
  }
  const ng = Math.max(-LIMITS.move.neigong, Math.min(LIMITS.move.neigong, Math.round(Number(u.neigong) || 0)));
  if (ng) {
    M.neigong = Math.max(0, M.neigong + ng);
    deltas.neigong = ng;
  }
  for (const k of ['faction', 'rank', 'alias', 'constitution'])
    if (u[k]) {
      const v = String(u[k]).slice(0, LIMITS.text.name);
      if (M[k] !== v) {
        M[k] = v;
        if (k === 'alias') notes.push(T('Epithet: {name}', { name: v }));
        if (k === 'faction') notes.push(T('Faction: {name}', { name: v }));
      }
    }
  // the Korean prompt names slots by their Korean words
  const arts = artsToEnums(u.arts && typeof u.arts === 'object' ? u.arts : {});
  for (const k of ART_SLOTS)
    if (arts[k]) {
      const v = String(arts[k]).slice(0, LIMITS.text.label);
      if (M.arts[k] !== v) {
        M.arts[k] = v;
        notes.push(`${T(ART_SLOT_LABEL[k])}: ${v}`);
      }
    }
}

/* ---- pictures: the code resolves the narrator's words to real images ---- */
function applyScene(ctx) {
  const { reply, img } = ctx;
  if (ctx.preview) Object.assign(img, ctx.preview); // already chosen while the reply streamed
  const spot = (reply.clock && reply.clock.place) || app.state.clock.place || '';
  if (reply.scene && !img.scene) {
    const f = findPlace(reply.scene, (reply.clock && reply.clock.time) || app.state.clock.time, spot);
    if (f) img.scene = pick(f.list).id;
    img.why = [
      `${String(reply.scene).slice(0, 60)} → ${f ? f.base + (f.via === 'memory' ? T(' (memory)') : '') : T('None')}`,
    ];
  } // what was asked and what was found, for when a picture looks wrong
  const x = imgById(img.scene);
  ctx.bannerBase = x ? baseOfKey(bgKey(x)) : '';
  if (reply.scene && ctx.bannerBase && spot) {
    app.state.placeMap = app.state.placeMap || {}; // a named spot keeps its picture next time
    delete app.state.placeMap[spot];
    app.state.placeMap[spot] = ctx.bannerBase;
    const ks = Object.keys(app.state.placeMap);
    if (ks.length > LIMITS.kept.places) delete app.state.placeMap[ks[0]];
  }
}

function applySpeaker(ctx) {
  const { reply, img } = ctx;
  if (!reply.speaker || img.char) return;
  const person = speakerOf(reply);
  if (reply.speaker_hidden) {
    const sh = shadowFor(person);
    if (sh) {
      img.char = sh.im.id;
      img.hidden = true;
    }
  }
  if (img.char) return;
  if (aiWillPick(person)) {
    startAiPick(person);
    return;
  }
  const k = castFor(person);
  if (k) {
    const im = pickEmotion(k, normEmo(reply.emotion), reply.speaker_look);
    if (im) img.char = im.id;
  } else {
    const sh = shadowFor(person);
    if (sh) {
      img.char = sh.im.id;
      img.hidden = true;
    }
  }
}

// everyone on screen: the speaker first, then up to two others
function applyCast(ctx) {
  const { reply, img } = ctx;
  const chars = [];
  if (img.char)
    chars.push(
      Object.assign(
        { id: img.char, npc: String(reply.speaker || '').slice(0, LIMITS.text.name) },
        img.hidden ? { hidden: true } : {},
      ),
    );
  for (const p of (reply.also_present || []).slice(0, LIMITS.perReply.alsoPresent)) {
    const person = presentOf(p);
    const who = person.name;
    if (!who || who === reply.speaker) continue;
    if (aiWillPick(person)) {
      startAiPick(person);
      continue;
    }
    const k = castFor(person);
    if (!k) {
      const sh = shadowFor(person);
      if (sh && !chars.some(c => c.id === sh.im.id)) chars.push({ id: sh.im.id, npc: who, hidden: true });
      continue;
    }
    const im = pickEmotion(k, normEmo(p.emotion), []);
    if (im && !chars.some(c => c.id === im.id)) chars.push({ id: im.id, npc: who });
  }
  if (chars.length) img.chars = chars;
  app.state.seen = app.state.seen || {};
  for (const c of chars)
    if (c.npc) {
      app.state.seen[c.npc] = (app.state.seen[c.npc] || 0) + 1;
      markSeen(c.npc);
    }
}

// places marked in the narration ([[@words]]) get inline pictures; the banner already shows its own place
function applyPlaces(ctx) {
  const { reply, img } = ctx;
  const places = [];
  for (const m of String(reply.narration || '').matchAll(MARK_RE)) {
    if (!m[1]) continue;
    const nm = m[2].trim();
    if (places.some(p => p.name === nm) || places.length >= 2) continue;
    const f = findPlace(nm, (reply.clock && reply.clock.time) || app.state.clock.time, null);
    if (f && f.base !== ctx.bannerBase && !places.some(p => p.base === f.base))
      places.push({ name: nm, id: pick(f.list).id, base: f.base });
  }
  if (places.length) img.places = places;
}

function applyDeath(ctx) {
  const { reply, stats, deltas, notes } = ctx;
  if (stats.hp <= 0 || reply.dead === true) {
    app.state.dead = true;
    if (stats.hp < 0) {
      deltas.hp = (deltas.hp || 0) - stats.hp;
      stats.hp = 0;
    }
    if (reply.dead !== true) notes.push(T('HP 0: dead'));
  }
}
