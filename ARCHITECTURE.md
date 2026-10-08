# 구조

이 문서는 코드를 처음 보는 사람(또는 새 세션)이 어디서 무엇이 일어나는지 찾을 수 있게 하는 지도입니다. 함수 이름은
코드 그대로 적었습니다. 줄 번호는 금방 바뀌므로 적지 않았습니다.

## 한눈에

- 게임은 HTML 파일 하나입니다. claude.ai 아티팩트로 게시되고, 아티팩트가 주는 기능(`db`, `sample`, `user`, `assets`,
  `downloads`)으로 저장하고 Claude를 부릅니다. 서버는 없습니다. 이 기능들은 호스트 어댑터(`host.js`) 하나를 거쳐서만
  닿습니다(아래 "호스트 어댑터").
- 소스는 `src/`에 있고 게임 코드는 ES 모듈입니다. `tools/build.js`가 esbuild로 모듈을 묶어 스타일과 함께 한 파일
  (`dist/dice-roguelife.html`)로 만듭니다.
- 규칙(확률, 상한, 저장)은 코드가 정하고, 이야기는 Claude(내레이터)가 JSON으로 답합니다. 코드는 그 답을 검사하고 상한을
  씌운 뒤 상태에 반영합니다.

## 소스 구성

| 경로 | 내용 |
| --- | --- |
| `src/index.html` | 페이지 틀. `<!-- build:styles -->`, `<!-- build:scripts -->`, `<!-- build:version -->` 자리에 빌드가 내용을 넣습니다. |
| `src/styles.css` | 전체 스타일. 라이트, 다크, 은밀 모드(`html.discreet`) 테마 변수 포함 |
| `src/js/*.js` | 게임 코드 (아래 표) |
| `prompts.json` | 내레이터 프롬프트 문장들. `prompt.js`가 가져와(`import`) `PR_DEFAULT`가 됩니다. 영어 이야기는 `en` 아래의 영어판을 씁니다(`pr`). |
| `src/locales/ko.json` | 화면 글자의 한국어(영어 원문 → 한국어). 아래 "번역" |
| `tools/build.js` | 페이지 조립: esbuild로 `src/js/main.js`부터 모든 모듈과 `prompts.json`을 스크립트 하나로 묶고(버전은 `__APP_VERSION__`), `index.html`에 스타일, 스크립트, 버전을 넣습니다. |
| `tools/release.js` | 검사, 테스트, 버전 올리기, 패키지 ([RELEASING.md](RELEASING.md)) |
| `tools/comment-scan.js` | `//` 주석이 코드를 삼킨 흔적 찾기 |
| `tools/i18n-check.js` | 번역 검사: 한국어가 없는 키, 코드에 남은 한국어 (`npm run lint`에 포함) |
| `tools/shot-sys-lines.js` | 시스템 줄 배치를 눈으로 확인할 스크린샷 (테스트 아님) |
| `tools/shots.js` | 가이드 사이트 스크린샷: `node tools/shots.js en` → `docs/images/<이름>-en.png`. 장면 속 이야기는 `tools/shots/<언어>.json`의 가짜 텍스트, 얼굴은 그려 넣은 임시 그림 (`DR_SHOT_ART`로 실제 그림). 화면이 바뀌었을 때만 다시 찍어요. 찍은 뒤 `tools/site-sizes.js`가 이미지 크기를 `docs/index.html`에 적어요 |
| `tests/` | Playwright 테스트(`*.spec.js`, 설정은 `playwright.config.js`). `support/test.js`(페이지를 여는 `game` 픽스처), `support/harness.js`(목 DB, 가짜 Claude, 새 삶 시작, `check`), `support/global-setup.js`(한 번 빌드), `support/dbmock.js`, `fixtures/library.json`(축소한 실제 이미지 목록). 페이지 안은 `window.DR`로 들여다봅니다. |

### 모듈 규칙

- `src/js/`의 파일은 ES 모듈입니다. 다른 파일이 쓰는 이름만 `export`하고, 쓰는 파일이 `import`합니다.
- 모듈은 선언만 합니다. 이벤트 연결과 시작(`boot`)은 진입점 `main.js`가 모든 모듈이 로드된 뒤 차례로 부릅니다. 그래서
  모듈이 실행되는 순서에 기대는 코드가 없습니다. 최상위에서 다른 모듈의 값을 읽거나 함수를 부르지 않습니다.
- 가져온 이름에는 값을 대입할 수 없습니다. 여러 모듈이 바꾸는 상태는 그 상태를 가진 모듈의 객체 속성으로 둡니다
  (`app`, `platform`, `turnStore`).
- 테스트가 바꿔 끼우는 함수(`toast`, `rnd`, `askConfirm` 등)는 `export let name = function name() {...}`로 선언하고,
  그 모듈의 `mocks`에 바꾸는 함수를 둡니다. 부르는 쪽은 모두 같은 바인딩을 보므로 바꾼 함수가 어디서나 쓰입니다.
- 아래쪽 모듈은 위쪽(UI, 흐름)을 import하지 않습니다. 표의 위에서 아래 순서가 대략 그 층입니다. 화면과 흐름을 맡은
  15개(`turn`, `persistence`, `log`, 각 탭과 시트 등)는 서로를 부르지만, 나머지(규칙, 저장소, 데이터, 이미지, 캐스팅,
  위젯, 답 반영, 프롬프트)는 순환 없이 아래로만 의존합니다.
- `window.DR`(`debug.js`)은 모든 모듈의 export를 읽는 디버그 핸들입니다. 테스트와 브라우저 콘솔에서 `DR.app.state`처럼
  읽고, `DR.mock('toast', fn)`이나 `DR.toast = fn`으로 바꿔 끼우고, `DR.mock('toast', null)`로 되돌립니다.

| 파일 | 맡은 일 |
| --- | --- |
| **바탕** | |
| `host.js`, `host-claude.js` | 호스트 어댑터: 게임이 쓰는 기능의 계약과 claude.ai 아티팩트 구현(아래 "호스트 어댑터") |
| `i18n.js` | 화면 언어(`uiLang`), 번역(`T`, `Tc`, `tIn`, `N_`), 고정 글자 번역(`translateStatic`) |
| `enums.js` | 저장하고 비교하는 값(성별, 출신, 성좌 관계, 스킬 출처, 무공 칸)과 그 이름, 옛 저장의 한국어 값(`LEGACY`) |
| `util.js` | 정직한 주사위(`rnd`는 `crypto.getRandomValues`), 공용 도우미(`$`, `esc`, `clone`, `toast`, `noteIgnored`, `cutLine`, `sha256Hex`), 서술 표시(`MARK_RE`) |
| `data.js` | 데이터 테이블: 등급과 확률(`rollTier`, `tierRank`), 세계, 종족, 신분, 재능, 명령어(`CMDS`, 특성 표 `COMMAND_TYPES`와 `cmdIs`), 감정, 무림 경지 |
| `limits.js` | 남기는 양(`LIMITS`): 답 하나의 글자 수와 항목 수, 저장이 평생 들고 있는 양(`kept`), 한 답이 움직일 수 있는 양(`move`) |
| `calendar.js` | 게임 안 날짜와 시각: `parseKDate`, `addDaysISO`, `clockMin`, `withWeekday` |
| `db.js` | 기능 핸들과 저장 모드(`platform`), 특권 사용자(`isPrivileged`), 메모리 DB, 압축(gzip + base64, 내보내기용 Z85), `packTurn`/`inflate`, `userDoc`/`userCol`, `dget`/`dset` |
| `turn-store.js` | `turnStore`: 턴을 크기 제한 페이지 문서로 묶어 저장, 충돌 감지(`StoreConflict`), `NEW_SAVES`/`GONE_SAVES` |
| `app.js` | 앱 정보(`APP_VERSION`, `REPO_URL`), 공유 상태(`app`), 한 번에 동작 하나(`exclusive`, `app.phase`, `abandonAction`) |
| `settings.js` | 설정 읽기(`setting`, `SETTING_DEFAULTS`)와 순서대로 쓰기(`saveSettings`) |
| `diag.js` | 최근 오류 기록(`logErr`, `ERRLOG`)과 페이지 오류 잡기 |
| **규칙** | |
| `rules.js` | 저장이 시작 때 고정한 규칙(`snapshotRules`, `rule`), 성장 속도, 상태창 공개, 주사위(`ODDS_RE`, `PIVOTAL_RE`, `rollGrade`, `critOf`), 칭호, 의뢰 같음 판정 |
| `people.js` | 인물: 별칭 정리(`canonName`, `aliasOut`), 이름 합치기(`renamePerson`), 최근 관계(`activeRel`), 등장 기록(`markSeen`) |
| `compat.js` | 옛 저장을 지금 형식으로(`compat`) |
| **이미지와 캐스팅** | |
| `library.js` | 이미지 색인(`IMGX`, 공유 `imgidx` 문서), 세트 카드, 매니페스트 복원, 옛 구조 이전, 파일 해시(`fillHashes`), 저장 파일의 그림 키(`withPicKeys`) |
| `images.js` | 이미지 찾기: `imgById`(id 색인), 턴의 그림(`turnImg`: 내용 키, 그다음 id), 캐릭터 세트(`charSets`), 세계 맞춤(`fitsWorld`, `setWorlds`), 표정 고르기(`pickEmotion`), 장면 HTML |
| `places.js` | 배경 검색: 내레이터가 영어 단어로 묘사한 장소 → 배경 이미지(`findPlace`) |
| `casting.js` | 캐스팅: 인물(`{ name, gender, role, weight, look }`, 답에서는 `speakerOf`, `presentOf`)에게 초상화 세트 배정(외모, 역할, 소속 태그 점수), AI 선택, 그림자. 성별이 있는 인물에게는 `기타` 세트를 자동으로 주지 않습니다(얼굴 고르기 창에서는 고를 수 있음). |
| `widgets.js` | 위젯 레지스트리 `WIDGETS`: 뉴스, 의뢰 게시판, 커뮤니티, 메신저마다 렌더, 접기 라벨, 후속 버튼, 마크다운 내보내기. 새 위젯은 항목 하나와 `prompts.json`의 스키마로 추가합니다. 게시판과 메신저는 생김새가 여럿(`BOARDS`: DC, 레딧, 5ch, 니코니코 / `CHATS`: 카카오톡, 왓츠앱, 라인)이고 데이터는 같아요. 설정 `boardStyle`, `chatStyle`, 자동이면 이야기 언어로 (`settings.js` `widgetStyle`). |
| **답과 프롬프트** | |
| `apply.js` | 답 반영(`applyOut`): 단계별 함수(`APPLY_STEPS`)가 공유 맥락 `ctx`를 받아 스탯, 아이템, 스킬, 기억, 시간, 장면과 초상화를 차례로 바꿉니다 |
| `prompt.js` | 프롬프트 조립(`buildPrompt`), 내레이터 호출(`callNarrator`), 스트리밍 중 필드 읽기(`peekReply`), JSON 복구, `normalize` |
| `summaries.js` | 지난 이야기 요약 |
| **흐름과 화면** | |
| `sheet.js` | 아래에서 올라오는 시트(`openSheet`)와 질문(`openDialog`, `askConfirm`, `askPrompt`) |
| `shell.js` | 은밀 모드, 제목 세 번 탭, 탭 전환(탭 화면은 `main.js`가 넘겨줌) |
| `sound.js` | 효과음(Web Audio로 합성, 파일 없음) |
| `boot.js` | 시작: 기능 요청, 저장 모드 결정, 설정과 저장 목록 불러오기 |
| `persistence.js` | 턴 추가(`pushTurn`), 상태 저장(`persist`, `sv`), 저장 열기(`openSave`)와 떠나기(`leaveOpenSave`), 저장 오류 안내(`storeError`) |
| `turn.js` | 턴 엔진: `send`, 주사위, `runTurn`과 그 단계(`narrate`, `settleDice`, `turnNotes`...), 스트리밍 미리보기 |
| `reroll.js` | 다시 쓰기, 판정 질문 처리, 정정, 분기 |
| `death.js` | 사망과 인생 결산 |
| `new-life.js` | 새 삶 화면, 운명 굴리기(`rollLife`), 시작(`beginLife`) |
| `status.js` | 상태줄과 상태창 |
| `log.js` | 로그 렌더링, 실시간 상자, 시스템 줄과 칭호, 선택지, 이름 가리기(캡처 모드). 로그의 버튼은 `#log`에 한 번 건 리스너(`bindLogEvents`)가 `data-` 속성별 동작 표(`LOG_ACTIONS`)로 처리합니다. |
| `face-picker.js` | 얼굴 바꾸기 시트(`openCast`): 단서, 태그, 후보 세트, 맞바꾸기 |
| `composer.js` | 입력창, 엔터 설정, 슬래시 메뉴, 초안, 보내기/중지 버튼 |
| `settings-sheet.js` | ⚙ 설정 시트: 설정 하나에 컨트롤 하나(`PLAIN_SETTINGS`), 모델 티어 확인, 캡처 모드, 진단 |
| `update.js` | 업데이트 확인 안내(릴리스 페이지 링크, 요청 문구) |
| `hall.js` | 전당(공유 랭킹) |
| `saves-view.js` | 저장 탭, 저장 공간 계측, 이야기 내보내기, 저장 파일 내보내기와 가져오기 |
| `memory-view.js` | 기억 탭 |
| `images-view.js` | 이미지 탭: 업로드, 자동 분류, 매니페스트 저장, 중복 정리 |
| `debug.js` | 디버그 핸들 `window.DR` (위 "모듈 규칙") |
| `main.js` | 진입점: 이벤트 연결, 탭 화면 넘기기, 그다음 `boot` |

## 번역

규칙은 [CLAUDE.md](CLAUDE.md)의 "Translation"에 있습니다. 요점만:

- 원문은 영어입니다. 코드는 `T('Saved')`처럼 영어를 쓰고, 한국어는 `src/locales/ko.json`에 영어를 키로 둡니다. 일본어는
  같은 키로 `ja.json`을 더하면 됩니다.
- 화면 언어(`uiLang`)와 이야기 언어는 따로입니다. 이야기 언어는 저장마다 `state.lang`에 있고, 첫 삶을 시작할 때 설정 `lang`(없으면 화면
  언어)으로 정해집니다. v2.6 이전 저장은 `compat.js`가 세계 이름으로 정해요. 새 삶의 세계, 종족, 신분, 재능은 이야기 언어로
  저장되고, 프롬프트도 이야기 언어로 만듭니다(`promptLang`, `pr`, `pl`).
- 처음 온 플레이어는 브라우저 언어(한국어가 아니면 영어)로 시작하고, 설정이 있던 기존 플레이어는 한국어를 유지합니다(`boot.js`).
- 저장하는 값은 언어와 무관한 값(`enums.js`)입니다. 옛 저장의 한국어 값은 `compat`이 바꿉니다.
- 현대 세계(헌터, 아카데미)의 소지금은 삶을 시작할 때 이야기 언어의 돈(한국어 원, 일본어 엔, 영어 달러)으로 정해집니다
  (`life.money`, `moneyFor`). 서술에는 다른 통화가 나와도 되고, 금액 변화는 소지금 단위로 바꿔 받습니다. 플레이어가 다른
  통화를 원하면 내레이터가 `money_unit`으로 단위 이름만 바꿉니다(`life.unit`, 금액은 그대로). 2.10 이전의 삶은 원입니다.
- 내레이터 답에서 코드가 읽는 표시(성공 확률, 날짜, 시각, 시스템 줄)는 정규식이 한국어와 영어를 모두 받습니다.

## 호스트 어댑터

게임은 호스트(지금은 claude.ai 아티팩트 런타임)에 직접 닿지 않고 `host()`가 고른 어댑터를 거칩니다. `window.claude`와
파일 주소(`/_blob/`)는 `host-claude.js` 안에만 있습니다.

- 어댑터: `id`, `available()`, `connect(capability)`(핸들 또는 `null`), `assetUrl(id)`, 선택으로 `bindSettings(root)`.
- 핸들이 지켜야 할 모양(게임이 쓰는 것만)은 `host.js` 머리 주석에 적혀 있습니다: `db`(문서 저장소), `sample`(모델 호출과
  오류 코드), `assets`(파일 저장소), `user`, `downloads`.
- 다른 호스트(예: Gemini 아티팩트)는 같은 모양을 주는 어댑터 파일을 만들고 `HOSTS`에 넣으면 됩니다. 아무 호스트도 없으면
  기능 없이 메모리에서 돕니다.
- 선택 애드온인 독립 실행판(`standalone/`, [standalone/README.md](standalone/README.md))은 이 빌드 밖의 어댑터입니다. 자기
  진입점에서 `registerHost()`로 끼어들고, 설정 시트에는 선택 훅 `bindSettings(root)`로만 닿습니다. 아티팩트 빌드에는
  들어가지 않습니다.

## 턴 하나의 흐름

1. **입력**: 보내기 버튼(`#form.onsubmit`)이나 선택지 버튼이 `send(text)`를 부릅니다. `send`는 다른 동작이 돌고 있으면
   무시하고, 아니면 `exclusive`로 게임을 잡은 채 `sendInner`를 실행합니다(아래 "턴을 조율하는 상태").
2. **`sendInner`**
   - `parseCmd`로 명령어를 가립니다. `/상태`는 상태창만 엽니다.
   - `staleSave`로 다른 기기에서 저장이 바뀌거나 지워졌는지 봅니다. 바뀌었으면 입력을 입력창에 돌려놓고 저장을 다시 엽니다.
   - 답을 못 받은 플레이어 줄이 남아 있으면 거둬들이고, 그 줄의 주사위는 `app.state.rollMemo`로 이어 씁니다.
   - **주사위**(명령어가 아닐 때만): `rollLuck`(생활 운), `rollFate`(도박꾼의 초석), `makeRoll`(d100). 자세한 내용은
     아래 "주사위와 판정".
   - 플레이어 줄을 **호출 전에** 저장합니다(`pushTurn`). 실패하면 입력을 돌려놓고 멈춥니다.
3. **`runTurn`**: 이번 답의 맥락 `turn`(주사위, 생활 운, 초석, 요청 id, 중지용 `AbortController` 등)을 만들고,
   `app.phase`를 `'narrating'`으로 바꾼 뒤 보내기 버튼을 중지 버튼으로 바꿉니다. 다시 쓰기가 교정을 남기라고 했으면
   (`fix.remember`) 그 사유를 `app.state.corrections`로 옮깁니다.
4. **`callNarrator`**
   - `buildPrompt(text, cmd, turn)`에 요청 id(`turn.req`)를 붙여 보냅니다. 같은 보내기를 다시 시도하면 같은 id라서, 페이지를 떠나 있던 사이
     끝난 답을 비용 없이 다시 받습니다.
   - **스트리밍**: `turn.onText`(`turn.js`의 `streamedReply`)가 받는 중인 JSON을 `peekReply`로 읽어, 배경과 초상화를
     답 하나에 한 번만 고르고(`turn.preview`) ADMIN 한마디와 서술을 실시간 상자에 띄웁니다(`showLiveReply`). 로그를
     다시 그려도 고른 것이 유지됩니다.
   - **시도 순서**: `platform.sample.json` → 텍스트 모드 + `extractJson` → 짧은 형식(`fallbackCompact`, 빠른 모델). 모두 실패하면
     `no_json`.
   - `extractJson`은 코드 블록을 벗기고, 느슨한 파싱(끝 쉼표, 제어 문자)과 잘린 답 닫기까지 시도합니다.
   - `normalize`는 줄표를 바꾸고(`noDash`), 목록 개수를 `LIMITS.perReply`로 자르고, 형식이 맞지 않는 값을 버립니다.
5. **오류**: 취소면 `undoLastSend`로 되돌립니다. 그 밖에는 `sampleError`가 안내를 띄우고, 플레이어 줄은 남아서 "다시
   시도"가 같은 주사위로 이어집니다.
6. **반영**
   - 판정 질문, 열람 명령어(뉴스, 의뢰 등)는 상태 변화를 막습니다.
   - 자유 판정이면 내레이터가 정한 확률(`check.p`, 1~99로 제한)과 미리 굴린 주사위로 성패를 정하고 플레이어 줄에 기록합니다.
   - `earlyCast`로 스트리밍 중 시작한 초상화 선택을 기다립니다.
   - **`applyOut(out, turn)`**이 답을 상태에 반영합니다: 스탯(상한, 성장 쿨다운), 기력, 칭호, 아이템과 장비, 장부, 종족, 스킬(추가,
     레벨업, 진화, 비용), 기억(설정, 관계, 사망), 이름 바뀜, 시간과 날짜, 무림, 장면과 초상화. 글자 수는
     `LIMITS.text`로 자릅니다.
7. **저장**: AI 줄을 `pushTurn`으로 추가합니다. 이 줄에는 그 시점 상태 전체(`snap`)가 들어 있어 다시 쓰기와 분기의
   기준점이 됩니다. `pushTurn`은 `turnStore.append`로 페이지에 쓰고 `persist`로 상태와 저장 카드를 씁니다. 저장에
   실패하면 상태를 반영 전으로 되돌립니다. 충돌로 저장을 다시 불러왔거나 저장이 지워졌으면 그 결과를 그대로 둡니다.
8. **뒷정리**: 남은 AI 초상화 선택, 효과음, `maybeSummarize`(오래된 턴 요약).

### 명령어

`CMDS`: `/뉴스`, `/의뢰`, `/갤`, `/성좌`, `/톡`(메신저), `/판정`, `/스킬`, `/상태`. 명령어 종류마다의 성질은
`data.js`의 `COMMAND_TYPES` 한 곳에 있고, 코드는 `cmdIs(cmd, 'browse')`처럼 묻습니다.

- 명령어 턴에는 주사위, 생활 운, 도박꾼의 초석이 없고 턴 수도 늘지 않습니다.
- `screen`(뉴스, 갤, 의뢰, 메신저, 판정, 스킬): 장소가 아니라 읽는 화면이라 배너와 초상화가 없습니다.
- `browse`(뉴스, 갤, 의뢰, 판정, 스킬): 시간이 흐르지 않고 스탯, 스킬, 칭호, 사망을 바꾸지 않습니다. 메신저는 행동이라
  시간이 흐릅니다.
- `ask`(판정, 스킬): ADMIN에게 묻는 질문입니다. 프롬프트 템플릿, 기본 질문, 라이브 박스 제목을 함께 적어 둡니다.
- `/판정`과 `/스킬`은 위젯 없이 설명만 받고, 직전 선택지를 그대로 둡니다.

## 주사위와 판정

판정 방식은 삶마다 정해집니다(`snapshotRules`, `rule('dice')`).

- **고정 판정**: 플레이어가 내레이터가 제시한 선택지를 확률 표시(`ODDS_RE`, 예: "(성공 확률 60%)")와 함께 그대로
  보내면, 그 확률로 결과가 미리 정해지고 내레이터는 결과를 받아서 서술합니다(`prompts.roll`).
- **자유 판정**: 그 밖의 입력은 주사위만 미리 굴려 두고(`prompts.rollFree`), 판정할 일이 있을 때만 내레이터가 확률을
  정합니다. 플레이어가 직접 적은 확률은 효력이 없습니다.
- **주사위 없음**: `prompts.noDice`. 개연성으로 진행합니다.
- **대성공, 대실패**: 확률 20 이하 성공, 80 이상 실패(`rollGrade`). 결정적인 판정(`pivotal`)이거나 대성공, 대실패면 주사위
  연출(`showDice`)이 뜹니다.
- **생활 운**: 각 3% 확률로 작은 행운이나 불운이 행동과 무관하게 끼어듭니다(주사위 없는 삶에서는 생략).
- **도박꾼의 초석**: 설정에서 켜면 잭팟(무조건 성공과 큰 보상)과 나락(무조건 실패와 큰 대가)이 기본 15%씩 나옵니다.

판정 원칙(`prompts.judgeCore`)의 요지:

1. 세상의 저항(상대의 의지, 위험, 운)에 막힐 수 있을 때만 굴립니다. 플레이어가 스스로 정하는 것, 캐릭터 실력으로
   당연히 되는 일, 시간만 들면 끝나는 일은 판정하지 않습니다.
2. 1~99 전 구간을 실제 가능성대로 씁니다. 가운데로 몰지 않고, 난이도는 확률을 깎기보다 상대와 상황으로 드러냅니다.
3. 실패는 그 시도만 막습니다. 대가는 기록에 있는 것에서 하나, 다른 행동이나 사람으로 번지지 않습니다.

## 프롬프트 조립

`buildPrompt`는 `prompts.rules` 뒤에 블록을 정해진 순서로 붙입니다(빈 블록은 빠짐).

ADMIN 성격 → 치트 대응 → 성장 속도 → 바깥 지식 → 세계, 캐릭터, 프로필 → 출신(빙의, 전이) → 성좌 → 스탯, 장부, 장비,
소지품 → 무림 → 시각 → 스킬, 메모, 의뢰, 관계 → 설정(최근 글에 나온 항목만) → 전생 → 요약 → 플레이어 메모 → 등장
가능한 인물 → 배경 어휘 → 위젯 → **최근 기록** → 명령어 → 교정 → 재출력 요청 → 정정 → 도박꾼의 초석 → 생활 운 →
주사위 없음 → 판정 원칙 → 판정 결과 → 이번 입력.

- **최근 기록**: `recentWindow`가 요약되지 않은 턴을 최신부터 바이트 예산(`recentBudget`, 설정값, 기본 40000바이트)까지
  담습니다. 최소 6줄은 항상 담습니다.
- **크기 보호**: 프롬프트가 `platform.limits.maxPromptBytes`의 90%를 넘으면 설정, 배경 어휘, 전생 블록을 빼고 다시
  만듭니다.
- **라이브 프롬프트**: 시작할 때 `loadPromptConfig`가 데이터베이스 `config/prompt`를 읽어, `rules`가 있으면
  `PR_DEFAULT` 위에 항목별로 덮어씁니다(얕은 병합). 배포 때 이 문서를 갱신합니다([RELEASING.md](RELEASING.md)).

## 다시 쓰기, 판정 질문, 정정, 분기

- **다시 쓰기**(`rerollWithReason`, `reroll`): 사유를 고르면 그 사유가 `fix`(`reason`, `remember`)로 `runTurn`에
  넘어가, 이번 답의 재출력 요청과 다음 턴들이 볼 교정이 됩니다. 직전 AI 줄을 거두고 그 앞 줄의 `snap`으로 상태를 되돌린 뒤 새 요청 id로 다시
  부릅니다. 자유 판정에서 확률이 정해졌던 경우 같은 확률의 고정 판정으로 바꿔서, 서술만 바뀌고 결과는 그대로입니다.
- **판정 질문**(`/판정`): 내레이터가 이의를 받아들이면(`objection.upheld`)
  - 방금 턴이면 `upholdObjection`이 그 턴을 다시 씁니다(`rewriteLast`, `fix.objection`이 새 답에 남습니다).
  - 1~5턴 전이면 `applyErratum`이 금액, 아이템, 장부, 관계를 정해진 범위 안에서만 고치고, 다음 답 첫머리에 자연스럽게
    수습하라는 정정(`prompts.errata`)을 붙입니다.
- **분기**(`fork`): `snap`이 있는 아무 줄에서 그 지점까지의 턴을 복사해 새 저장을 만듭니다(`turnStore.copyUpTo`).

## 저장 구조

### 기능과 모드

- `db`가 없으면 **memMode**: 메모리에만 저장하고 새로고침하면 사라집니다.
- `db`는 있지만 쓰기가 막혀 있으면(보기 전용 방문자) **localMode**: 이 브라우저의 localStorage(`dr-db-<userId>`)에
  저장합니다.
- `user`가 id를 주면 개인 데이터는 `data/users/<id>` 아래(`userPath`), 아니면 `data/users/local` 아래에 둡니다.
- 공유 데이터(이미지 목록, 세트 카드, 전당, 설정 문서)는 항상 플랫폼 데이터베이스를 직접 씁니다(`platform.shared`).

### 데이터베이스 경로

`P`는 `userPath`입니다.

| 경로 | 내용 | 범위 |
| --- | --- | --- |
| `P/saves/items/<id>` | 저장 카드 | 개인 |
| `P/states/items/<id>` | 상태 전체 | 개인 |
| `P/saves/items/<id>/pages/<p>` | 턴 페이지 `{p, v, first, last, n, rows}` | 개인 |
| `P/settings` | 설정 | 개인 |
| `P/diag` | 최근 오류 8개 | 개인 |
| `P/hall/items/<id>` | "나만 보기" 전당 기록 | 개인 |
| `hall/<id>` | 공개 전당 기록 | 공유 |
| `imgidx/<p>` | 이미지 색인 페이지(최대 120행) | 공유 |
| `sets/<key>` | 캐릭터 세트 카드(성별, 등급, 역할, 이름, 별칭, 세계, 태그) | 공유 |
| `config/prompt` | 라이브 프롬프트 | 공유 |
| `config/whitelist` | 특권 사용자 id | 공유 |

옛 구조(`P/saves/items/<id>/turns/<i>`, 공유 `images/<id>`, `data/local/...`)는 읽어서 새 구조로 옮기는 코드만 남아
있습니다.

### 저장 카드와 상태

- **저장 카드**: `id, name, createdAt, updatedAt, parent, lifeNo, turns, lifeTurns, store, pages, sv`. `store: 2`는 페이지
  구조, `parent`는 분기 원본입니다.
- **상태**(`state`)의 주요 키: `life, lifeNo, stats, rules, titles, skills, items, equipped, energy, ledger, quests, lore,
  relations, cast, clock, murim, summaries, summarizedUpto, corrections, next, turnNo, dead` 등.
- **턴 줄**: `i, at, kind(user | ai | system | ledger), text, req, roll, luck, fate, out, deltas, notes, img, clock, snap`.
  `out`과 `snap`은 저장할 때 gzip + base64로 줄여 `z` 필드 하나에 넣고(`packTurn`), 읽을 때 되돌립니다(`inflate`).

### 턴 저장소(`turnStore`)

- 턴 줄은 페이지 문서에 차례로 쌓이고, 한 페이지가 `turnStore.pageMax`(200,000바이트, 플랫폼 문서 한도 256KiB 아래)를 넘으면
  다음 페이지로 넘어갑니다. 마지막 페이지(`tail`)만 메모리에 들고 씁니다.
- 쓰기는 큐(`writeTail`)로 순서를 지킵니다. 쓸 때마다 페이지의 `v`를 올리고, 쓰기 전에 데이터베이스의 `v`와 비교합니다.
  다르면 다른 기기가 먼저 쓴 것이므로 `StoreConflict`를 던집니다.
- 데이터베이스 문서 수 한도(`DB_DOC_CAP`, 5000)는 저장 탭의 계측과 "저장 공간이 가득 찼어요" 안내에 씁니다.

### `sv`(저장 카드 버전)

- `persistNow`가 상태와 카드를 쓸 때마다 `sv`를 1 올립니다. 쓰기가 성공한 뒤에만 올라가서, 실패한 쓰기가 "다른 곳에서
  바뀜"으로 보이지 않습니다. 저장을 열 때 데이터베이스의 `sv`를 다시 읽습니다.
- 쓰기 전과 보내기 전에 `staleSave`가 데이터베이스의 `sv`와 비교합니다. 카드가 없으면 `closeGone`으로 닫고, 다르면
  "다른 곳에서 이 저장이 바뀌어" 안내 뒤 최신으로 다시 엽니다.

### 브라우저 저장

localStorage만 씁니다: `dr:inputHint`(입력 요령 안내), `dr:choiceHint`, `dr:enterSend`(엔터 전송), `dr:draft:<saveId>`
(보내지 않은 입력), `dr-db-<userId>`(localMode 데이터베이스).

### 저장 파일 내보내기

- 바깥 봉투: `{app: 'dice-roguelife', format: 3, n, d}`. `d`는 안쪽 내용을 gzip한 뒤 Z85로 인코딩한 문자열입니다.
- 안쪽: `{app, format: 1, appVersion: 'Dice Roguelife, v<버전>', exportedAt, save, state, turns}`. 이미지는 넣지 않습니다.
- 가져오기는 새 id와 " (가져옴)" 이름으로 새 저장을 만들고, 턴을 다시 묶어 페이지, 상태, 카드 순서로 씁니다.
- 그림 id는 설치(아티팩트, 독립 실행판)마다 새로 매겨지므로, 파일에 담는 턴에는 `img.keys`(그 턴의 그림 id → 내용 키)를
  붙입니다(`withPicKeys`). 내용 키는 저장된 파일과 처음 올린 파일의 SHA-256 앞 16자(`picKeys`: `shash`, `hash`)입니다.
  이미지 팩은 저장된 파일을 그대로 담으므로, 다른 설치에서 팩을 올리면 그 `hash`가 이쪽의 `shash`와 같습니다. 같은 원본을
  올려도 `hash`가 같습니다. 이 설치의 턴 줄은 바꾸지 않습니다.
- 다시 내보낼 때는 이쪽 그림의 키에 그 턴이 가져온 키를 더합니다. 그래서 A → B → C로 옮겨도, 이쪽에 없는 그림이나 다른 바이트로
  저장된 그림의 키가 사라지지 않습니다. 그림마다 키는 많아야 4개(이쪽 것 먼저)입니다. 해시가 없는 옛 행은 내보낼 때 해시를
  채우는데(`fillHashes`), 공유 목록에 저장하는 것은 주인뿐입니다. 이미지 목록을 불러오지 못한 채 내보내면 알려 줍니다.
- 턴의 그림은 `turnImg`가 내용 키, id, `dupMap` 순서로 찾습니다(`imgById`, 목록을 쓸 때마다 올라가는 `imagesVer`로 다시
  만드는 색인, 캐스팅의 메모도 같은 숫자를 봅니다). 키가 있는데 하나도 맞지 않으면, 같은 id라도 해시가 있는 행은 다른 그림으로
  보고 보여주지 않습니다. 중복 정리로 옮겨 간 id(`dupMap`)는 같은 그림이므로 그대로 따라갑니다. 키가 없는 옛 저장은 지금처럼
  id로만 찾습니다. 가장 옛 턴은 그림을 `out.scene_img`, `out.char_img`에 두었는데, 불러올 때(`inflate`) `img`로 옮깁니다.
- 세트 표지(`setMeta.cover`)는 id라서 이미지 팩의 `tags.json`에는 표지 그림의 파일 이름(`cover`)으로, 사본용 목록(매니페스트)에는
  그 파일의 `shash`로 담습니다.

### 이미지 라이브러리

- 파일은 아티팩트 에셋 저장소(`platform.assets`)에, 목록은 공유 `imgidx` 페이지에, 세트 정보는 `sets/<key>`에 있습니다.
- 이미지 행: `id, kind(char | scene | fx), set, emotion, name, file, hash, shash, world, worlds, tags, createdAt`.
  `fx`는 연출 이미지(주사위 `dice`, `dice_success`, `dice_fail`)라서 "자동 분류"가 건드리지 않습니다.
- **매니페스트**: 목록 전체를 JSON 에셋(`kind: 'dice-roguelife-manifest'`)으로도 남겨 둡니다. 아티팩트를 복제하면 에셋은
  따라오지만 데이터베이스는 비어 있으므로, 시작할 때 매니페스트에서 목록을 되살립니다(`shash`로 짝 맞춤).

## 턴을 조율하는 상태

보내기, 다시 쓰기, 다시 시도, 첫 답, 인생 결산, 분기는 `exclusive(action)`으로 게임을 잡고, 끝나면 어떻게 끝났든
놓습니다. 그래서 둘이 같은 저장에 동시에 쓰는 일이 없습니다. 한 턴에만 쓰는 값은 전역에 두지 않고 `turn` 객체에 담아
인자로 넘깁니다.

열린 저장을 떠나면(다른 저장 열기, 새 게임, 열린 저장 삭제) `leaveOpenSave`가 돌던 동작을 버립니다(`abandonAction`).
게임은 곧바로 쉬는 상태가 되고, 쓰던 답은 멈추며, 그 동작은 기다림이 끝날 때마다 `currentRun().abandoned`를 보고 손을
뗍니다. 그래서 늦게 온 답이 다음 저장에 들어가지 않습니다.

| 이름 | 뜻 |
| --- | --- |
| `app.phase` | `'idle'`, `'busy'`(줄 저장, 되돌리기), `'narrating'`(내레이터 답을 기다림), `'ledger'`(인생 결산을 기다림) |
| `isIdle()` | 새 동작을 받을 수 있는지. 얼굴 바꾸기, 인물 합치기도 이것을 봅니다 |
| `waitingForReply()` | 로그에 실시간 상자를 띄울지(`'narrating'`, `'ledger'`) |
| `turn` | `runTurn`이 만드는 답 하나의 맥락: `run`, `req`, `roll`, `luck`, `fate`, `redo`, `objection`, `sent`, `head`, `preview`, `onText`, `abort`. `buildPrompt`, `callNarrator`, `applyOut`이 인자로 받고, 로그는 실시간 상자 머리말을 `app.turn`에서 읽습니다 |
| `fix` | 다시 쓰기의 요청: `reason`(이번 답에 알릴 문제), `remember`(교정으로 남김), `noCheck`(판정이 아니었어야 함), `objection`(받아들여진 판정 질문) |
| `app.state.rollMemo` | 다시 시도할 때 이어 쓸 주사위 |

## 오류를 다루는 방식

- 내레이터 호출 오류는 `logErr`(`diag.js`)가 최근 8개를 `ERRLOG`와 `P/diag`에 남기고, ⚙ 설정의 "최근 오류"에 보입니다.
- 읽기 실패는 "없음"과 구별합니다: `dget`은 문서가 없을 때만 `null`이고 읽지 못하면 오류를 던집니다.
- 실패해도 계속 진행하는 곳(정리 삭제, 없을 수 있는 기능 등)은 `noteIgnored(where, e)`로 "넘어간 오류"(최근 20개)에
  남깁니다. 의도적으로 조용히 넘기는 곳(브라우저 저장소가 막힌 경우, JSON 파싱 시도 등)은 빈 `catch`에 이유를 주석으로
  적습니다.
