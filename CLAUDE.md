# HiRoCF — 開発メモ

トップダウン視点のモバイルレーシングゲーム。PixiJS v8 製、単一 HTML ファイルとして配布する。

## 構成

- `index.html` — ページ全体、HUD、タッチ操作。`src/main.js` を ES モジュールとして読み込む。
- `src/` — ゲーム本体(ES モジュール、開発中はバンドラ不要)
  - `main.js`, `config.js`, `pixi.js`(バンドル済み PixiJS)
  - `game/` — プレイヤー物理、ライバル AI、レース進行、記録（`records.js`: ベストタイム・★・ステージ解放・難易度を localStorage に保存。使えない環境でも落ちずにその回だけ保持）
  - `track/` — コース中心線、ステージレイアウト
  - `render/` — 路面・リボン・ミニマップ・プロップ・エフェクト
- `build/standalone.mjs` — esbuild で `src/` を単一 HTML(`build/index.standalone.html`)にまとめる。配布物はこれ。
- `build/artifact.mjs` — Claude Artifact ホスト用の別ビルド(head 構成が異なるだけ)。
- `assets/bgm/stage<N>.mp3` — ステージ BGM。市販曲なので **git 管理外**(`.gitignore`)。`node build/tools/make-bgm.mjs 1=<mp3> 2=<mp3> ...` で音量を揃えて 96kbps(5分超はフェードで切る。単一HTMLを 30MB 未満に収めるため)に再エンコードして置き、`build:standalone` が見つかった分だけ埋め込む。無ければその面は無音で動く。

ステージは前のステージに（どの難易度でも）勝つと解放される。確認用に URL に `?unlockall` を付けると保存内容を変えずに全ステージを開ける（例 `build/index.standalone.html?unlockall`）。

## 開発コマンド

```
npm install
npm run dev             # http-server . -p 8080 -c-1 でローカル配信
npm test                 # vitest run
npm run lint              # eslint src
npm run format            # prettier --write .
npm run build:standalone  # build/index.standalone.html を生成
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
- 成果物一式を渡すときは ZIP にせず、`build/index.standalone.html` などのファイルをそのまま渡す。

## 検証の型(このプロジェクトで確立した方法)

「動くはず」で終わらせず、Playwright で実測する。具体的には:

- スクリーンショットでの見た目確認に加え、`page.evaluate()` で `window.__game` の内部状態(位置・ズーム・速度・当たり判定フラグなど)を直接読んで検証する。
- ゲーム内時間を早送りしたいときは `app.ticker.stop()` してから `g.update(dt)` を手動ループで進める(実時間待ちは headless の描画負荷で実際より遅く進むため、フレーム数ベースのテストと実時間ベースのテストを混同しない)。
- カメラ・エフェクトなど「毎フレーム変化する値」の不具合は、1点のスクリーンショットではなく、値を時系列でサンプリングして跳躍(discontinuity)やドリフトが無いかを数値で確認する。
- 5 ステージ通し走行(`g.update()` をライントレースで回し続ける)で回帰確認するスクリプトが有効。新機能・修正のたびに `npx eslint src` → `npx vitest run` → 5 ステージ通し → 該当箇所のスクリーンショット確認、の順で回す。
