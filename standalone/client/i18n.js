// The add-on's own screen text: its catalogs (../locales), then the game's (words both use, such as 'Settings').
import { SOURCE_LANG, T, tIn, uiLang } from '../../src/js/i18n.js';
import KO from '../locales/ko.json' with { type: 'json' };
import JA from '../locales/ja.json' with { type: 'json' };

const CATALOGS = { ko: KO, ja: JA };

export function tr(en, vars) {
  const own = (CATALOGS[uiLang()] || {})[en];
  return own !== undefined ? tIn(SOURCE_LANG, own, vars) : T(en, vars);
}
