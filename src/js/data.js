/* ============ data tables (code owns the rules) ============ */
import { rnd } from './util.js';
import { catalogEntry, locale, N_, tIn, UI_LANGS, uiLang } from './i18n.js';
import { MONEY, STANCES } from './enums.js';

export const TIERS = ['EX', 'SSS', 'S', 'A', 'B', 'C', 'D', 'E', 'F'];
export const TIER_P = [
  ['EX', 0.5],
  ['SSS', 1.5],
  ['S', 4],
  ['A', 9],
  ['B', 16],
  ['C', 24],
  ['D', 22],
  ['E', 13],
  ['F', 10],
];
export const WORLDS = [
  {
    id: 'hunter',
    diff: [2, 4],
    name: N_('Modern Hunter'),
    risk: N_('Gates open without warning'),
    opp: N_('One awakening turns a life upside down'),
    entry: { transfer: 0.15, possess: 0.1 },
    sponsor: 0.4,
    from: N_('a world of swords and magic'),
  },
  {
    id: 'apoc',
    diff: [4, 5],
    name: N_('Apocalypse'),
    desc: N_('A world after civilization fell'),
    risk: N_('People die over a bottle of water'),
    opp: N_('In a fallen world, anyone can be king'),
    entry: { transfer: 0.1, possess: 0.05 },
    sponsor: 0.35,
  },
  {
    id: 'academy',
    diff: [1, 4],
    name: N_('Academy'),
    desc: N_('An elite school that trains awakened and mages'),
    risk: N_('Your class rank is your caste'),
    opp: N_('One diploma changes your standing'),
    entry: { transfer: 0.1, possess: 0.25 },
    sponsor: 0.3,
  },
  {
    id: 'tower',
    diff: [4, 5],
    name: N_('Tower Climbing'),
    desc: N_('A tower said to grant a wish to whoever reaches the top'),
    risk: N_('Death waits on every floor'),
    opp: N_('Everything is at the top'),
    entry: { transfer: 0.2, possess: 0.05 },
    sponsor: 0.4,
  },
  {
    id: 'vrmmo',
    diff: [2, 4],
    name: 'VR MMO',
    desc: N_("Inside a VR game. You can't log out"),
    risk: N_('Death in the game may be real'),
    opp: N_('Bugs and hidden quests are your chance'),
    entry: { transfer: 0.05, possess: 0.05 },
    sponsor: 0.3,
  },
  {
    id: 'fantasy',
    diff: [2, 4],
    name: N_('High Fantasy'),
    risk: N_('Death is common and class is set in stone'),
    opp: N_('Fortune lies at the bottom of the dungeon'),
    entry: { transfer: 0.2, possess: 0.1 },
    sponsor: 0.15,
  },
  {
    id: 'rofan',
    diff: [1, 4],
    name: N_('Romance Fantasy'),
    risk: N_('Rumors are deadlier than swords'),
    opp: N_('Marriage is a weapon'),
    entry: { transfer: 0.1, possess: 0.35 },
    sponsor: 0.05,
  },
  {
    id: 'murim',
    diff: [3, 5],
    name: N_('Murim'),
    risk: N_('One move can cost your head'),
    opp: N_('Your realm is your rank'),
    entry: { transfer: 0.1, possess: 0.15 },
    sponsor: 0.1,
  },
  {
    id: 'palace',
    diff: [3, 5],
    name: N_('Imperial Palace'),
    desc: N_('Intrigue in the palace, the harem and the court'),
    risk: N_('One wrong word and three generations die'),
    opp: N_('One moment of favor and you touch the sky'),
    entry: { transfer: 0.1, possess: 0.3 },
    sponsor: 0.05,
  },
  {
    id: 'cyber',
    diff: [3, 5],
    name: N_('Cyberpunk'),
    risk: N_('You live on what you sell of your body'),
    opp: N_('Corporations are gods, and gods make deals'),
    entry: { transfer: 0.05, possess: 0.05 },
    sponsor: 0.1,
  },
  {
    id: 'monster',
    diff: [5, 5],
    name: N_('Monster Realm'),
    risk: N_('Everything is prey, and so are you'),
    opp: N_('You grow stronger with what you eat, and change as you grow'),
    entry: { transfer: 0.15, possess: 0.05 },
    sponsor: 0.2,
  },
];
// retired world ids: what they were is now a background plus an entry (how the player arrived)
export const WORLD_ALIAS = {
  gamehunter: ['hunter'],
  isekai: ['fantasy', 'transfer'],
  reverse: ['hunter', 'transfer'],
  possess: ['rofan', 'possess'],
};
export function worldIn(w, lang) {
  const tr = x => (x ? tIn(lang, x) : x);
  return { ...w, name: tr(w.name), desc: tr(w.desc), risk: tr(w.risk), opp: tr(w.opp), from: tr(w.from) };
}
// per ADMIN persona, in STANCES order
const STANCE_P = {
  star: [0.3, 0.35, 0.25, 0.1],
  dealer: [0.25, 0.45, 0.2, 0.1],
  archivist: [0.6, 0.15, 0.15, 0.1],
  fan: [0.1, 0.4, 0.3, 0.2],
};
export function rollEntry(world, aff) {
  const e = world.entry || {};
  let t = e.transfer || 0,
    p = e.possess || 0;
  if (aff && aff.entry === 'possess') p = Math.min(0.8, p * 3 + 0.1);
  if (aff && aff.entry === 'transfer') t = Math.min(0.8, t * 3 + 0.1);
  const r = rnd();
  return r < p ? 'possess' : r < p + t ? 'transfer' : 'native';
}
export function rollSponsor(world, force, persona) {
  if (force === 'off') return null;
  if (force !== 'on' && rnd() >= (world.sponsor || 0)) return null;
  const w = STANCE_P[persona] || [0.3, 0.3, 0.25, 0.15]; // the ADMIN persona leans the constellation's stance
  let r = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < STANCES.length; i++) {
    if ((r -= w[i]) < 0) return { stance: STANCES[i] };
  }
  return { stance: STANCES[1] };
}
export const TRANSFER_RACES = {
  modern: [
    N_('Human (transmigrator)'),
    N_('Human (transmigrator)'),
    N_('Human (transmigrator)'),
    N_('A body mutated in transit'),
  ],
  other: [
    N_('Elf'),
    N_('Demon'),
    N_('Dragon in human form'),
    N_('Hero from another world'),
    N_('Demon King from another world'),
    N_('Goblin'),
  ],
};
export const RACES = {
  vrmmo: [
    N_('Human player'),
    N_('Human player'),
    N_('Elf player'),
    N_('Beastkin player'),
    N_('An NPC who became self-aware'),
    N_('Bugged character'),
  ],
  academy: [N_('Human'), N_('Human'), N_('Elf'), N_('Beastkin'), N_('Half-blood'), N_('Demon exchange student')],
  tower: [N_('Human'), N_('Human'), N_('Beastkin'), N_('Fairy'), N_('Giant'), N_('Native of the tower')],
  apoc: [
    N_('Human'),
    N_('Human'),
    N_('Human'),
    N_('Mutant human'),
    N_('Immune to the infection'),
    N_('Mechanically modified human'),
  ],
  palace: [N_('Human'), N_('Human'), N_('Human'), N_('Fox spirit'), N_('Demigod')],
  fantasy: [N_('Human'), N_('Human'), N_('Human'), N_('Elf'), N_('Dwarf'), N_('Beastkin'), N_('Half-orc'), N_('Demon')],
  murim: [N_('Human'), N_('Human'), N_('Human'), N_('Yokai'), N_('Half-yokai'), N_('Spirit beast')],
  hunter: [
    N_('Human (unawakened)'),
    N_('Human (unawakened)'),
    N_('Human (awakening-prone)'),
    N_('Gate monster'),
    N_('Half-blood awakened'),
  ],
  cyber: [N_('Human'), N_('Human'), N_('Cyborg'), N_('Android'), N_('Awakened AI'), N_('Mutant')],
  monster: [
    N_('Slime'),
    N_('Goblin'),
    N_('Lich'),
    N_('Mimic'),
    N_('Dragon hatchling'),
    N_('Mold colony'),
    N_('Undead'),
  ],
  rofan: [
    N_('Human (noble)'),
    N_('Human (commoner)'),
    N_('Human (commoner)'),
    N_('Fairy'),
    N_('Black magic bloodline'),
    N_('Half-dragon'),
  ],
};
export const ORIGINS = {
  EX: [N_('Demon King'), N_('The chosen hero'), N_('Descendant of the creator god'), N_('System administrator')],
  SSS: [
    N_("Heir to the nation's top guild"),
    N_('Young master of the Demonic Cult'),
    N_('Only child of the Northern Grand Duke'),
    N_('Ancient dragon'),
    N_("Clone of a megacorp's board chair"),
    N_("The emperor's legitimate heir"),
    N_('Last egg of a sovereign species'),
    N_('Third-generation chaebol heir'),
    N_("The great sage's last disciple"),
  ],
  S: [
    N_('Heir to a ducal house'),
    N_('Adopted child of a major guild master'),
    N_('Saintess'),
    N_('S-rank hunter'),
    N_('Illegitimate child of a demon duke'),
    N_('Apprentice of an archmage'),
    N_('High demon'),
  ],
  A: [
    N_("Child of a count's house"),
    N_('Disciple of a renowned orthodox sect'),
    N_('A-rank awakened'),
    N_('Son of a knight commander'),
    N_('Apprentice court mage'),
  ],
  B: [
    N_("Youngest of a baron's house"),
    N_('Mercenary'),
    N_("Merchant's son"),
    N_('Squire'),
    N_("Adventurers' Guild rookie"),
  ],
  C: [N_('Commoner'), N_("Farmer's child"), N_('Village hunter'), N_('Inn worker'), N_('Low-ranking soldier')],
  D: [N_('Orphan'), N_('Slum pickpocket'), N_('Wandering medicine peddler'), N_('Child of a bankrupt merchant')],
  E: [N_('Slave'), N_('Mine convict'), N_('Child sold to pay a debt'), N_('Terminally ill'), N_('Cursed child')],
  F: [N_('Otherworld slime'), N_('Goblin whelp'), N_('Scarecrow'), N_('Village dog')],
};
export const TALENTS = {
  EX: [
    [N_('Causality Manipulation'), N_('Once a day, reroll the outcome of what just happened')],
    [N_('Beloved of the World'), N_('Cancels one fatal crisis')],
    [N_('Admin Privileges'), N_('Can talk and trade with ADMIN directly')],
  ],
  SSS: [
    [N_('Sense of Endings'), N_('Faintly foresees the outcome of one choice')],
    [N_('Absolute Talent'), N_('All proficiency grows 5x faster')],
    [N_('Golden Touch'), N_('Every deal you touch turns a profit')],
  ],
  S: [
    [N_('Berserker'), N_('The more cornered you are (HP under 30%), the more checks favor you')],
    [N_('Sword Genius'), N_('Your body remembers any sword form it sees once')],
    [N_('Mana Affinity'), N_('Mana recovers abnormally fast')],
  ],
  A: [
    [N_('First Impression'), N_('NPCs you meet for the first time are one step friendlier')],
    [N_('Fast Growth'), N_('Double experience')],
    [N_('Lucky One'), N_('Small luck follows you often')],
  ],
  B: [
    [N_('Iron Constitution'), N_('Resistant to illness and poison')],
    [N_('Handy'), N_('Fixes anything in no time')],
    [N_('Perceptive'), N_('Vaguely senses lies')],
  ],
  C: [
    [N_('Diligence'), N_('Improves little by little with steady work')],
    [N_('Ordinary Health'), N_('Never catches minor illnesses')],
    [N_('Knacks'), N_('Good at cooking and cleaning')],
  ],
  D: [
    [N_('Insomnia'), N_('Awake at night but always tired')],
    [N_('Dull Senses'), N_('Feels less pain, but notices danger late')],
    [N_('Coward'), N_('Fast on your feet only when running away')],
  ],
  E: [
    [N_('Cursed Luck'), N_('Bad luck at every important moment')],
    [N_('Frail Constitution'), N_('Max HP drops easily')],
    [N_('Amnesia'), N_('Cannot recall the past')],
  ],
  F: [
    [N_('Tenacity'), N_('Turns one death into a grave wound (once a life)')],
    [N_('Zero Presence'), N_('No one pays you any attention')],
    [N_('Weed'), N_('Trampled today, back up tomorrow. Only your recovery is fast')],
  ],
};
// others: gold x1; LOCAL: the life's own money (life.money)
const LOCAL = 'local';
const CURRENCY = {
  hunter: LOCAL,
  academy: LOCAL,
  cyber: [N_('credits'), 10],
  apoc: [N_('ration tickets'), 1],
  murim: [N_('nyang'), 1],
  palace: [N_('nyang'), 1],
};
const MONEY_UNIT = {
  [MONEY.WON]: [N_('won'), 1000],
  [MONEY.YEN]: [N_('yen'), 100],
  [MONEY.DOLLARS]: [N_('dollars'), 1],
};
const LOCAL_MONEY = { ko: MONEY.WON, ja: MONEY.YEN, en: MONEY.DOLLARS };
export const moneyFor = lang => LOCAL_MONEY[lang] || MONEY.DOLLARS;
export function currencyOf(life) {
  const c = CURRENCY[life && life.world && life.world.id];
  // lives from before 2.10 have no money and were in won
  const base = c === LOCAL ? MONEY_UNIT[life.money] || MONEY_UNIT[MONEY.WON] : c || [N_('gold'), 1];
  // a conversion rescaled the money (life.scale)
  return [base[0], (life && life.scale) || base[1]];
}
// the narrator's own word (life.unit) is shown as written
export const moneyUnit = (life, lang = uiLang()) => (life && life.unit) || tIn(lang, currencyOf(life)[0]);
export function moneyText(n, life, lang = uiLang()) {
  return tIn(lang, '{amount} {unit}', {
    amount: Number(n || 0).toLocaleString(locale(lang)),
    unit: moneyUnit(life, lang),
  });
}
export const BASE = {
  EX: { hp: 999, power: 120000, gold: 50000 },
  SSS: { hp: 500, power: 15000, gold: 200000 },
  S: { hp: 300, power: 3000, gold: 20000 },
  A: { hp: 200, power: 600, gold: 5000 },
  B: { hp: 120, power: 150, gold: 500 },
  C: { hp: 100, power: 40, gold: 100 },
  D: { hp: 80, power: 20, gold: 10 },
  E: { hp: 50, power: 10, gold: 0 },
  F: { hp: 10, power: 3, gold: 0 },
};
// The English names work in every language. A language's own names are its catalog's '<first English name>|command'
// entry, space separated (ko.json: "/news|command": "/뉴스"); the screen lists its own names, else the English ones.
export const CMDS = [
  { id: 'news', names: ['/news'], t: 'news', d: N_("The world's newspaper") },
  { id: 'quest', names: ['/quest', '/q'], t: 'quest', d: N_('Quest board') },
  { id: 'board', names: ['/board', '/gallery'], t: 'gallery', d: N_('Community board') },
  { id: 'reddit', names: ['/reddit'], t: 'gallery', look: 'reddit', d: N_('Community board, always in Reddit style') },
  { id: '5ch', names: ['/5ch'], t: 'gallery', look: '5ch', d: N_('Community board, always in 5ch style') },
  { id: 'dc', names: ['/dc'], t: 'gallery', look: 'dc', d: N_('Community board, always in DC Inside style') },
  {
    id: 'nico',
    names: ['/nico', '/niconico'],
    t: 'gallery',
    look: 'nico',
    d: N_('Community board, always in Niconico style (comments fly across the video)'),
  },
  {
    id: 'star',
    names: ['/star'],
    t: 'gallery',
    d: N_("The constellations' viewing gallery (in a life with constellations, after the channel opens)"),
    preset: N_(
      "A constellation gallery. The constellations watching this player's channel (spectators named after star signs) sponsor, mock and place bets in posts and comments. Name the site to suit the world.",
    ),
  },
  { id: 'chat', names: ['/chat', '/talk', '/dm'], t: 'messenger', d: N_('Send a message on the messenger') },
  { id: 'why', names: ['/why'], t: 'judge', d: N_('Ask why a check went the way it did (no time passes)') },
  {
    id: 'skill',
    names: ['/skill', '/skills'],
    t: 'skills',
    d: N_('Hear your skills and their costs from ADMIN (no time passes)'),
  },
  { id: 'status', names: ['/status', '/st'], t: 'status', d: N_('Open the status window') },
];
const ownNames = (c, lang) => (catalogEntry(lang, c.names[0] + '|command') || '').split(' ').filter(Boolean);
export const cmdNames = c => (n => (n.length ? n : c.names))(ownNames(c, uiLang()));
export const allCmdNames = c => [...c.names, ...UI_LANGS.flatMap(l => ownNames(c, l))];
export const cmdName = id => cmdNames(CMDS.find(x => x.id === id))[0];

export const EMOS = [
  'neutral',
  'smile',
  'joy',
  'anger',
  'sadness',
  'surprise',
  'smirk',
  'shy',
  'fear',
  'serious',
  'crying',
  'determined',
];
export const EMO_FB = {
  joy: 'smile',
  smile: 'joy',
  crying: 'sadness',
  sadness: 'crying',
  determined: 'serious',
  serious: 'neutral',
  smirk: 'smile',
  shy: 'smile',
  fear: 'surprise',
  surprise: 'neutral',
  anger: 'serious',
};
export const REALMS = [
  N_('Unranked'),
  N_('Third-rate'),
  N_('Second-rate'),
  N_('First-rate'),
  N_('Peak'),
  N_('Transcendent'),
  N_('Harmony'),
  N_('Mystic'),
  N_('Life and Death'),
];
const REALM_START = { EX: 6, SSS: 4, S: 3, A: 2, B: 1 };
const NEIGONG_START = { EX: 120, SSS: 60, S: 20, A: 10, B: 3 };
const EMO_KO = {
  중립: 'neutral',
  기본: 'neutral',
  미소: 'smile',
  웃음: 'joy',
  기쁨: 'joy',
  행복: 'joy',
  분노: 'anger',
  화남: 'anger',
  슬픔: 'sadness',
  우울: 'sadness',
  놀람: 'surprise',
  경악: 'surprise',
  비웃음: 'smirk',
  능글: 'smirk',
  부끄러움: 'shy',
  수줍음: 'shy',
  공포: 'fear',
  두려움: 'fear',
  진지: 'serious',
  심각: 'serious',
  눈물: 'crying',
  울음: 'crying',
  결의: 'determined',
  각오: 'determined',
  happy: 'joy',
  laugh: 'joy',
  sad: 'sadness',
  angry: 'anger',
  surprised: 'surprise',
  scared: 'fear',
  cry: 'crying',
  embarrassed: 'shy',
  smug: 'smirk',
};
export function normEmo(e) {
  e = String(e || '')
    .trim()
    .toLowerCase();
  if (EMOS.includes(e)) return e;
  return EMO_KO[e] || 'neutral';
}
export function normGender(g) {
  g = String(g || '')
    .trim()
    .toLowerCase();
  if (/^(female|여|여성|여자|f)$/.test(g)) return 'female';
  if (/^(male|남|남성|남자|m)$/.test(g)) return 'male';
  return g ? 'other' : null;
}
export const STAT_LABEL = {
  power: N_('Combat power'),
  gold: N_('Money'),
  fame: N_('Fame'),
  age: N_('Age'),
  maxHp: N_('Max HP'),
  neigong: N_('Inner energy (yrs)'),
  con: N_('Constitution'),
  str: N_('Strength'),
  mag: N_('Magic'),
  agi: N_('Agility'),
  int: N_('Intelligence'),
  cha: N_('Charm'),
};
export const SUB_STATS = ['con', 'str', 'mag', 'agi', 'int', 'cha'].map(k => [k, STAT_LABEL[k]]);
const SUB_BONUS = { EX: 12, SSS: 8, S: 5, A: 3, B: 1, C: 0, D: 0, E: -1, F: -2 };
export function rollSubStats(tier) {
  const o = {};
  for (const [k] of SUB_STATS) o[k] = Math.max(1, 3 + Math.floor(rnd() * 5) + (SUB_BONUS[tier] || 0));
  return o;
}
export function powerGrade(p) {
  return p >= 500000
    ? 'EX'
    : p >= 100000
      ? 'SSS'
      : p >= 50000
        ? 'SS'
        : p >= 10000
          ? 'S'
          : p >= 5000
            ? 'A'
            : p >= 1000
              ? 'B'
              : p >= 500
                ? 'C'
                : p >= 100
                  ? 'D'
                  : p >= 50
                    ? 'E'
                    : 'F';
}
export function initMurim(tier) {
  return {
    realm: REALM_START[tier] || 0,
    neigong: NEIGONG_START[tier] || 0,
    faction: '',
    rank: '',
    alias: '',
    constitution: '',
    arts: {},
  };
}
export function rollTier() {
  let r = rnd() * 100;
  for (const [t, p] of TIER_P) {
    if ((r -= p) < 0) return t;
  }
  return 'F';
}
export function tierRank(t) {
  return TIERS.indexOf(t);
}
// What each command type is, asked through cmdIs(cmd, trait):
//   screen  a screen you read (news, a board, a chat), not a place: no scene, banner or portraits
//   browse  reading it changes nothing in the story: no stats, skills, title, death or time
//   ask     a question to ADMIN that takes no time: no scene, growth or memory, and the choices stay as they were.
//           It names its prompt template (a prompts.json key), the question when none is typed, and the heading of
//           the live box while the answer streams
// status has none: it opens the status window and asks the model nothing
export const COMMAND_TYPES = {
  news: { screen: true, browse: true },
  quest: { screen: true, browse: true },
  gallery: { screen: true, browse: true },
  messenger: { screen: true },
  judge: {
    screen: true,
    browse: true,
    ask: { prompt: 'cmdJudge', q: N_('Why did the last check go this way?'), head: N_('Why the check went this way') },
  },
  skills: { screen: true, browse: true, ask: { prompt: 'cmdSkills', q: '', head: N_('Skills') } },
  status: {},
};
export const cmdIs = (cmd, trait) => !!(cmd && COMMAND_TYPES[cmd.type] && COMMAND_TYPES[cmd.type][trait]);
export const askOf = cmd => (cmdIs(cmd, 'ask') ? COMMAND_TYPES[cmd.type].ask : null);
