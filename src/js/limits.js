/* ============ limits ============ */
// How much of a narrator reply the game keeps (normalize and applyOut). The prompt already tells the narrator the
// shapes it should answer in; these caps only stop a runaway reply from bloating the save. Text caps count characters,
// list caps count entries in one reply.
export const LIMITS = {
  text: {
    name: 30, // a person, item, skill, race, ledger line or lore key
    label: 40, // a title, a clock field (date, time, place, weather), a martial art
    note: 80, // an item note, what a title does
    desc: 120, // a skill description
    remark: 200, // a relationship note, the state note
    entry: 300, // a lore entry, merged rule text
    reason: 140, // why a stat moved
    statKey: 12, // the stat a reason belongs to
    energyName: 10, // the power pool's own word (기, 마나, 오러)
    moneyUnit: 24, // a currency the player switched to (금화, Australian dollars)
  },
  perReply: {
    system: 4, // system lines
    choices: 5,
    items: 6,
    alsoPresent: 2, // people on screen besides the speaker
    reasons: 12,
    ledger: 12,
    levelUps: 3,
    evolveSkills: 2,
    addSkills: 3,
    skillCosts: 5,
    lore: 5,
    relations: 5,
    renames: 4,
    died: 5,
  },
  // what a save keeps over a whole life: past these, the oldest entries go first
  kept: {
    titles: 20,
    items: 20,
    equipped: 10,
    quests: 20,
    lore: 80, // lore entries
    places: 60, // named spots remembered with their background
    ledgerLine: 60, // characters of one ledger line
  },
  statMax: 9999, // a main stat (hp, power, gold, fame) never goes above this
  skillLevelMax: 10,
  // how far one reply may move the story
  move: {
    days: 3650, // days that may pass in one reply
    neigong: 120, // years of inner power gained or lost in one reply
    moneyRate: 1e6, // a currency conversion, new units per old, both ways (dollars to dong: 25,000)
  },
};
