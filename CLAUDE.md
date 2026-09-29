# HiRoCF — 開発メモ

トップダウン視点のモバイルレーシングゲーム。PixiJS v8 製、単一 HTML ファイルとして配布する。

## 構成

- `index.html` — ページ全体、HUD、タッチ操作。`src/main.js` を ES モジュールとして読み込む。
- `src/` — ゲーム本体(ES モジュール、開発中はバンドラ不要)
  - `main.js`, `config.js`, `pixi.js`(バンドル済み PixiJS)
  - `game/` — プレイヤー物理、ライバル AI、レース進行、記録（`records.js`: ベストタイム・★・ステージ解放・難易度を localStorage に保存。使えない環境でも落ちずにその回だけ保持）
  - `track/` — コース中心線、ステージレイアウト
  - `render/` — 路面・リボン・ミニマップ・プロップ・エフェクト、STAGE4 のモブ車画像(`mobcars.js`: 写真+塗装レイヤーを tint でランダム色に)
- `build/standalone.mjs` — esbuild で `src/` を単一 HTML(`build/index.standalone.html`)にまとめる。配布物はこれ。画像は `build/lib/images.mjs` で WebP に再エンコードして埋め込み(PWA と同じ設定)、BGM はゲーム本体の script の**後ろ**に置く(回線越しでも BGM を読み終える前に START できる。`bgm.js` は未到着のトラックを DOMContentLoaded 後に拾う)。
- **スマホ確認用リンク(毎回渡す)**: https://claude.ai/artifact/TVwH1EijKM5bLocKZNQfsL — `npm run build:artifact`(`build/artifact.mjs`)で `dist-artifact/`(git 管理外)を作り、Artifact ツールでこの URL に publish(`file_path: dist-artifact/index.html`。BGM `assets/bgm/stage<N>.mp3` は内容が変わったときだけ `files` で送る。現在の一覧は `action:list, scope:files`)。Artifact ホストの制約: **同じ場所のファイルでも `<script src>` は拒否される**(JS はページに埋め込む)、ページは 16MB まで、`<head>`/`<body>` はホスト側、Service Worker 不可。なのでゲーム本体と画像(WebP の data:)はページに埋め込み、BGM だけ別ファイル。エラーは画面下に赤枠で表示される(実機で原因を見るため)。BGM 入りなのでリンクは**非公開のまま**(共有しない)。
- 画像の読み込みは `Assets.setPreferences({ preferWorkers:false, preferCreateImageBitmap:false })`(main.js)で `<img>` 経由。Pixi 既定の fetch→ImageBitmap は data: でも connect-src に掛かり、CSP のある環境で起動しなくなる。
- `build/pwa.mjs` — PWA ビルド。`dist/`(git 管理外)に静的サイトとして出力する。画像は bundle から抜き出して WebP 化(地面タイルは可逆、車・プロップは near-lossless)、manifest・アイコン(`build/pwa/icons/`)・Service Worker(`build/pwa/sw.js`: 起動に要る全ファイルをビルド単位でキャッシュ、BGM は初回再生時にキャッシュして Range 要求に 206 で応答)を付ける。**https で配信しないと SW が動かない**(localhost は可)。`npm run build:pwa` は BGM なし(公開配信してよい)、`npm run build:pwa:bgm` は BGM 入り(**非公開の配信先専用**)。画像変換に `sharp` を使う。
- `build/lib/page.mjs` — standalone / PWA 共通の index.html 分解と bundle。`build/lib/images.mjs` — 同じく共通の WebP 変換。
- ステージ切替時は旧ステージの表示ツリーを `destroyStageTree`(main.js)で破棄する。PixiJS 任せだと 60〜90 秒解放されず、リトライのたびにメモリが積み上がって iPhone で落ちる原因になる。Graphics は `destroy({context:true})` でないと自前の context が残る点に注意。
- **レース終了**: どちらか先にゴールラインを越えた時点で終わる(`race.js` の `winner`。プレイヤーが越えなくても終了)。ゴール後のカメラは勝者に固定・進行方向も勝者に合わせる(`main.js` の `finishFocus`)。プレイヤーが完走していない負け(`result.finished === false`)はベストタイムに記録しない(`records.js`)。
- **エンディング**: 最終ステージに勝つとリザルトカードを挟まずゴール演出の直後にエンディングへ入り(負け・他ステージは従来どおりカード)、動画(`assets/ending/ending.mp4`=iPhone 用 H.264、`ending.webm`=VP9。`.gitignore` 済み・公開リポジトリには載せない。元動画は `/root/.claude/uploads/.../grok_video_*.mp4`)→クレジット(ライバル名・★合計・ベスト合計は保存内容から生成)→TITLE。動画は、ゴール演出中に fetch で blob に先読み→blob URL で再生、だめなら各形式のファイル URL、自動再生を拒否されたら PLAY ボタン、どれも失敗すれば理由を画面下の赤枠に出してクレジットだけ(`index.html` の `playEnding`)。iPhone で自動再生に近づけるため、START のタップ内でエンディング用 `<video>` に無音の極小 MP4(`SILENT_MP4`)を再生して要素をアンロックしておく(BGM 要素と同じ手。差し替え後も許可が残るかは Safari 次第で**実機未確認**、ダメなら PLAY ボタン)。終了時は黒の上でタイトルを立ててから黒を引く(ゲーム画面を見せない)。`build:artifact` は `assets/ending/` があればリンクにも同梱する。このサンドボックスの Chromium は H.264 を再生できないので、動画の確認は WebM 側で行い、MP4 の実再生は実機で確認する。変換: pip の `imageio-ffmpeg`(`pip install --target <scratch> imageio-ffmpeg` の同梱 ffmpeg)で `libx264 -crf 27` / `libvpx-vp9 -crf 36`。
- `assets/bgm/stage<N>.mp3` — ステージ BGM。市販曲なので **git 管理外**(`.gitignore`)。`node build/tools/make-bgm.mjs 1=<mp3> 2=<mp3> ...` で音量を揃えて 96kbps(5分超はフェードで切る。単一HTMLを 30MB 未満に収めるため)に再エンコードして置き、`build:standalone` が見つかった分だけ埋め込む。無ければその面は無音で動く。

ステージは前のステージに（どの難易度でも）勝つと解放され、解放済みのステージはタイトル画面から選べる。難易度は NORMAL（ライバル速度・加速を落とした標準）と HARD（各ステージの元の調整そのまま、全ステージクリアで解放）。**HARD は現在保留で非表示**(`index.html` の `HARD_ON` で戻せる)。リザルトの TITLE ボタンからタイトルに戻り、解放済みステージを選べる。HUD の旗アイコン(`#stagePick`)は確認用の全ステージジャンプ、その下段の GOAL アイコン(`#goalPick`)は確認用の即ゴール(レース中に押すとプレイヤーがラインを越える)で、どちらもユーザーの指示があるまで残す(後で削除予定)。タイトルへ戻るときはフェードせず即表示(`showTitle`。フェードすると裏のゲーム画面が透ける)。確認用に URL に `?unlockall` を付けると保存内容を変えずに全ステージと HARD を開ける（例 `build/index.standalone.html?unlockall`）。

## 開発コマンド

```
npm install
npm run dev             # http-server . -p 8080 -c-1 でローカル配信
npm test                 # vitest run
npm run lint              # eslint src
npm run format            # prettier --write .
npm run build:standalone  # build/index.standalone.html を生成
npm run build:pwa         # dist/ に PWA(BGM なし)を生成。build:pwa:bgm で BGM 入り
```

## このセッションの実行環境

Linux サンドボックス(このリポジトリのコンテナ)上で動く。ユーザーの手元は Windows/PowerShell だが、このセッションでは使えない。ここで実際に使えると確認済みのものだけを前提にする:

- Node.js, esbuild, ESLint, Prettier, Vitest(`devDependencies` に記載)
- Playwright(グローバルインストール済み、`/opt/node22/lib/node_modules/playwright` から `import`。ヘッドレス Chromium は `/opt/pw-browsers/chromium`)
- ローカル動作確認は `npx http-server -p 8099 -c-1 .` 等で静的配信してから Playwright で操作する

npm パッケージが実際に入っているか(`package.json`/`node_modules`)を見ずに「使えるはず」で進めない。

## 対象環境

- iPhone Safari / iOS PWA(最優先)
- Android Chrome
- PC ブラウザ

`file://` で直接開いても動くこと(ES モジュールの `import` がブロックされない)が単一 HTML 配布の前提。モジュール分割した `src/` を直接 `file://` で開くと壊れるので、配布・実機確認は必ず `build/index.standalone.html` を使う。

## 開発方針

- 品質レベルが未指定なら、「まず動けばよい」水準か「今の環境で出せる最高品質」かを確認してから進める。ただし安全に推定できて修正も容易な軽微な部分は聞かずに進めてよい。
- 最高品質を選んだ場合、「まず動けばよい」のような簡易方針を許可なく最終方針にしない。使えるライブラリ・API・既存コードを踏まえて目的に対する最適解を選ぶ。
- 実装中に制約(パフォーマンス、API の限界、既存コードとの整合性など)が判明したら、黙って簡易な方式に変えない。制約の内容・品質への影響・代替案をその場で伝える。
- 「エラーなく動いた」は完成の条件ではない。機能・見た目・操作性・性能(フレームレート等)・安定性を実際に検証してから完成とする。
- 成果物は**スマホ確認用リンク(上記 Artifact)を毎回更新して渡す**。単一 HTML(`build/index.standalone.html`)は必須ではない(ユーザー了承済み: PWA 版で良い)。ファイルを渡す場合も ZIP にしない。

## 検証の型(このプロジェクトで確立した方法)

「動くはず」で終わらせず、Playwright で実測する。具体的には:

- スクリーンショットでの見た目確認に加え、`page.evaluate()` で `window.__game` の内部状態(位置・ズーム・速度・当たり判定フラグなど)を直接読んで検証する。
- ゲーム内時間を早送りしたいときは `app.ticker.stop()` してから `g.update(dt)` を手動ループで進める(実時間待ちは headless の描画負荷で実際より遅く進むため、フレーム数ベースのテストと実時間ベースのテストを混同しない)。
- カメラ・エフェクトなど「毎フレーム変化する値」の不具合は、1点のスクリーンショットではなく、値を時系列でサンプリングして跳躍(discontinuity)やドリフトが無いかを数値で確認する。
- 5 ステージ通し走行(`g.update()` をライントレースで回し続ける)で回帰確認するスクリプトが有効。新機能・修正のたびに `npx eslint src` → `npx vitest run` → 5 ステージ通し → 該当箇所のスクリーンショット確認、の順で回す。
