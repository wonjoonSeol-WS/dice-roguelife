# 배포 절차

게임은 claude.ai 아티팩트 하나로 운영됩니다. 저장 데이터가 그 아티팩트의 데이터베이스에 묶여 있으므로, 배포는 항상
**같은 아티팩트 링크를 덮어쓰는 것**입니다. 새 아티팩트를 만들면 플레이하던 저장이 빈 채로 시작됩니다.

## 1. 검사와 테스트

```
npm ci            # 작업본마다 처음 한 번
npm run lint
npm test
```

`npm run lint`는 esbuild, ESLint, Prettier(테스트는 Playwright)가 설치되어 있지 않거나 `package.json`에 고정한 버전과 다르면 멈춥니다. 린트가
실제로 돌지 않았는데 통과로 표시되는 일은 없습니다.

## 2. 릴리스 빌드

```
npm run release -- 2.2.0          # 테스트까지
npm run release -- 2.2.0 --fast   # 테스트 생략
```

순서대로 다음을 합니다.

1. 새 버전으로 빌드합니다(esbuild로 모듈을 묶음, 아직 아무 파일도 바꾸지 않음).
2. 묶은 스크립트의 문법, ESLint(`src/js`, `tools`, `tests`), Prettier 형식, 주석에 삼켜진 코드를 검사합니다. 오류 위치는
   `파일:줄`로 나옵니다.
3. 검사를 통과하면 `package.json`과 `package-lock.json`의 버전을 올리고 `dist/dice-roguelife.html`을 씁니다.
4. 전체 테스트를 돌립니다(`--fast`면 생략).
5. 결과물을 출력 폴더에 둡니다. 기본은 `./dist`이고 `OUT_DIR`로 바꿀 수 있습니다.
   - `dice-roguelife.html`: 게시할 페이지
   - `dice-roguelife-standalone-v2_2_0.zip`: 독립 실행판. 서버 파일과 미리 빌드한 페이지(`standalone/page.html`)라서 받은
     사람은 설치 없이 `npm start`만 합니다. 페이지는 아티팩트 페이지와 함께 빌드하고 문법을 검사합니다. 브라우저 테스트는
     `npm test`에 들어가지 않으니 릴리스 전에 `npm run test:standalone`도 돌립니다.
   - `dice-roguelife-handoff-v2_2_0.zip`: 소스 전체 묶음(설치물, 빌드 결과, 스크린샷 제외). 다른 세션에 넘길 때 씁니다.
6. 프롬프트가 지난 배포 이후 바뀌었는지 알려 줍니다.

## 3. 프롬프트가 바뀐 경우

마지막 줄에 `PROMPT CHANGED`가 나오면 라이브 프롬프트도 갱신해야 합니다.

1. 아티팩트 데이터베이스에서 `config/prompt` 문서를 읽고 그 버전을 확인합니다.
2. `dist/livedb/prompt_release.json`의 내용을 `config/prompt`에 씁니다. **방금 읽은 버전을 `if_version`으로 걸어서**,
   그사이 다른 곳에서 바뀌었다면 덮어쓰지 않게 합니다.
3. 기록을 남깁니다. 릴리스 때와 같은 `OUT_DIR`로 실행하면 패키지 안의 기록도 함께 갱신됩니다.
   ```
   npm run release -- --mark-prompt
   ```

`tools/.released_prompt.json`이 "지금 라이브에 있는 프롬프트"의 기록입니다. 이 파일은 패키지에 함께 들어가므로, 패키지를
새로 풀어도 오탐이 나지 않습니다.

## 4. 같은 링크에 게시

`dist/dice-roguelife.html`을 **기존 아티팩트 링크에 그대로** 게시합니다. 새 아티팩트를 만들면 안 됩니다.

- 페이지가 쓰는 기능(`db`, `sample`, `user`, `assets`, `downloads`)은 이전 버전에서 그대로 이어집니다.
- 게시 후 링크가 바뀌지 않았는지, 데이터베이스(`config/prompt` 버전 등)가 그대로인지 확인합니다.

## 5. 공개 저장소

GitHub 릴리스 태그는 앱 버전과 같은 형식(`v2.2.0`)으로 맞춥니다. 게임 안의 "업데이트 확인" 안내가 저장소의 릴리스
페이지를 가리킵니다. 릴리스에는 `dice-roguelife.html`, 독립 실행판 zip, 넘겨주기 zip을 올리고 최신(latest)으로 표시합니다.
README의 설치 요청과 게임 안의 업데이트 안내가 `releases/latest/download/dice-roguelife.html`을 받으므로, 최신 릴리스에는
늘 아티팩트 페이지가 이 이름으로 있어야 하고 다른 파일에 이 이름을 쓰지 않습니다.

## 바꾸면 안 되는 것

이미 저장된 데이터와 내보낸 파일이 계속 읽혀야 하므로, 아래는 이름과 형식을 바꾸지 않습니다.

- 데이터베이스 경로와 문서 필드 이름(`saves/items/<id>`, `states/items/<id>`, 페이지 문서, `sv`, `store`, `z` 등)
- 브라우저 저장 키(`dr:` 접두사, `dr-db-<userId>`)
- 저장 파일 형식(`app: 'dice-roguelife'`, `format: 3`, 안쪽 `appVersion` 문구)
- 아티팩트 링크
- 릴리스의 아티팩트 페이지 파일 이름 `dice-roguelife.html`(README의 설치 요청과 게임 안의 업데이트 안내가 받는 이름)

구조를 바꾸는 작업은 먼저 이 저장소의 관리자와 상의합니다.
