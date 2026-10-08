/* ============ enums: stored values; labels are shown through T() ============ */
import { N_ } from './i18n.js';

export const GENDER = Object.freeze({ MALE: 'male', FEMALE: 'female', OTHER: 'other' });
export const GENDERS = Object.freeze(Object.values(GENDER));
export const GENDER_LABEL = Object.freeze({ male: N_('Male'), female: N_('Female'), other: N_('Other') });

export const ENTRY_LABEL = Object.freeze({
  native: N_('Native'),
  transfer: N_('Transmigrator'),
  possess: N_('Possessor'),
});

export const MONEY = Object.freeze({ WON: 'won', YEN: 'yen', DOLLARS: 'dollars' }); // a modern life's money

export const STANCE = Object.freeze({ INDIFFERENT: 'indifferent', RIVAL: 'rival', HOSTILE: 'hostile', ALLY: 'ally' });
export const STANCES = Object.freeze(Object.values(STANCE)); // the order data.js STANCE_P weighs them in
export const STANCE_LABEL = Object.freeze({
  indifferent: N_('Indifferent'),
  rival: N_('Rivals'),
  hostile: N_('Hostile'),
  ally: N_('Allies'),
});

export const SKILL_SRC = Object.freeze({
  TALENT: 'talent',
  INHERITED: 'inherited', // from a past life
  GAINED: 'gained',
  EVOLVED: 'evolved',
  MERGED: 'merged',
});
export const SKILL_SRC_LABEL = Object.freeze({
  talent: N_('Talent'),
  inherited: N_('Inherited'),
  gained: N_('Gained'),
  evolved: N_('Evolved'),
  merged: N_('Merged'),
});

// state.murim.arts keys
export const ART_SLOT = Object.freeze({ SWORD: 'sword', MIND: 'mind', MOVEMENT: 'movement', OTHER: 'other' });
export const ART_SLOTS = Object.freeze(Object.values(ART_SLOT));
export const ART_SLOT_LABEL = Object.freeze({
  sword: N_('Sword art'),
  mind: N_('Inner art'),
  movement: N_('Lightness skill'),
  other: N_('Other art'),
});

// Korean values in saves before v2.5 (compat.js) and in Korean replies (apply.js)
// i18n-ignore-start
export const LEGACY = Object.freeze({
  stance: { 무관심: STANCE.INDIFFERENT, 경쟁: STANCE.RIVAL, 적대: STANCE.HOSTILE, 협력: STANCE.ALLY },
  skillSrc: {
    재능: SKILL_SRC.TALENT,
    계승: SKILL_SRC.INHERITED,
    획득: SKILL_SRC.GAINED,
    진화: SKILL_SRC.EVOLVED,
    합성: SKILL_SRC.MERGED,
  },
  artSlot: { 검법: ART_SLOT.SWORD, 심법: ART_SLOT.MIND, 경공: ART_SLOT.MOVEMENT, 기타: ART_SLOT.OTHER },
  noTitle: '없음',
});
// i18n-ignore-end
export const fromLegacy = (kind, value) => (LEGACY[kind] && LEGACY[kind][value]) || value;
// martial arts keyed by slot value, from keys that may be the old Korean slot names
export const artsToEnums = arts => {
  const out = {};
  for (const [k, v] of Object.entries(arts || {})) out[fromLegacy('artSlot', String(k).trim().toLowerCase())] = v;
  return out;
};
