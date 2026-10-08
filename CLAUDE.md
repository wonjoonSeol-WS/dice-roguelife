# Working on Dice Roguelife

See [ARCHITECTURE.md](ARCHITECTURE.md) for the module map and [RELEASING.md](RELEASING.md) for releases.

## Code comments

Short, and only where the code can't explain itself (a non-obvious why). Design notes and how-tos go here or in
ARCHITECTURE.md, not in code.

## The artifact comes first

The claude.ai artifact is the game. The optional standalone add-on (`standalone/`, its README) runs it on a local server
with API keys; it stays out of the artifact build and reaches the game only through `registerHost` and the host's
optional `bindSettings` (`src/js/host.js`). Don't add host checks or standalone code to `src/`. Its tests run with
`npm run test:standalone`, not `npm test`, and its screen text uses its own catalogs (`standalone/locales`, `tr()`).

## Translation (i18n)

English is the source language. Each other language is a JSON map keyed by the English: `src/locales/ko.json`,
`src/locales/ja.json`. A new screen language is a new map plus its code in `UI_LANGS` (`i18n.js`).

- Screen text: `T('Saved')`. Values go in placeholders, never `${}`: `T('{n} {n|turn|turns} ago', { n })`
  (`{n|one|other}` picks by whether `n` is 1). Korean: `"{n}턴 전"`.
- Text defined in a table or label map and translated where it is shown: `N_('Human')`, then `T(x)` at display.
- Same English with two meanings in another language: `Tc('tab', 'Save')`, catalog key `"Save|tab"`.
- A specific language: `tIn(lang, ...)`. Prompt fragments in `prompt.js`: `pl(...)` (prompt language).
- Fixed text in `src/index.html`: `data-t`, `data-t-html`, `data-t-attr="placeholder,aria-label"`.
- Two languages: the screen's (`uiLang()`, setting `uiLang`) and the story's (`storyLang()`): the open save's
  `app.state.lang`, set when its first life begins from `newStoryLang()` (setting `lang`, else the screen's); saves
  older than v2.6 get it in `compat.js` from the world's name. The player may type in any language; the prompts' `lang`
  block tells the narrator to answer in the story language and how to render other languages' speech. A new life stores world, race, origin and talent in the story language (`worldIn`, `tIn`).
  Prompts: a Korean story reads `prompts.json`; English and Japanese stories read `prompts.en` (`pr(key)`), and
  Japanese adds `prompts.lang.ja`.
- Slash commands: `CMDS` (`data.js`) holds the English names, which work in every language. A language's own names
  are catalog entries `"<first English name>|command": "/뉴스"` (several space separated, the first is shown); the
  screen lists its own names, else the English ones, and every language's names work when typed.
- Stored or compared values are enums (`src/js/enums.js`), never words. Labels are `N_()` maps shown with `T()`.
  Korean values in old saves map through `LEGACY` in `compat.js`.
- What the code reads in narrator replies (odds tags, dates, times, system-line words) is a per-language profile of
  regexes in `src/js/reply/<lang>.js`, read only through `reply-words.js` (`matchOdds`, `sysKind`, ...) and
  `calendar.js`. Named groups are the contract: odds `p`, `rest`; title `title`; clock `h`, `m`, `half`, `period`
  (classified by `pm`, `day`, `night`); date `y`, `m` or `mon` (with `months`), `d`. All profiles are tried, since
  a save can mix languages. A new story language needs a profile, and its prompt should ask for what it reads
  (`tests/i18n-parse.spec.js` checks the odds tag).
- `node tools/i18n-check.js --list` (also run by `npm run lint`) fails on a key without Korean, a screen key
  without Japanese (prompt-only `pl()` keys are exempt), differing placeholders, a `${}` inside `T()`, or Korean
  left in a code string. Mark deliberate Korean data with `// i18n-ignore` (or an
  `i18n-ignore-start` / `i18n-ignore-end` block).
- Tests run with a Korean browser (`locale: 'ko-KR'` in `tests/support/test.js`); pass `{ locale: 'en-US' }` or
  `'ja-JP'` to `game()` (`tests/i18n-lang.spec.js`).

## Guide screenshots

`node tools/shots.js <ko|en|ja> [groups]` captures the site's screenshots into `docs/images/<name>-<lang>.png` with a
mocked narrator (`tools/shots/<lang>.json`); the site swaps them by language. Recapture after a visible UI change.
It then writes every image's size per language into `docs/index.html` (`tools/site-sizes.js`), so the page doesn't
shift while lazy images load and `#section` links land in place. Run that alone after changing an image by hand.
