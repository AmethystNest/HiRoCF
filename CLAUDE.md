# HiRoCF — 開発メモ

トップダウン視点のモバイルレーシングゲーム。PixiJS v8 製、単一 HTML ファイルとして配布する。

## 構成

- `index.html` — ページ全体、HUD、タッチ操作。`src/main.js` を ES モジュールとして読み込む。
- `src/` — ゲーム本体(ES モジュール、開発中はバンドラ不要)
  - `main.js`, `config.js`, `pixi.js`(バンドル済み PixiJS)
  - `game/` — プレイヤー物理、ライバル AI、レース進行、記録（`records.js`: ベストタイム・★・ステージ解放・難易度を localStorage に保存。使えない環境でも落ちずにその回だけ保持）
  - `track/` — コース中心線、ステージレイアウト
  - `render/` — 路面・リボン・ミニマップ・プロップ・エフェクト、STAGE4 のモブ車画像(`mobcars.js`: 写真+塗装レイヤーを tint でランダム色に。夜の高速で路面に紛れるので黒は使わない=オレンジ・ティール)
- `build/standalone.mjs` — esbuild で `src/` を単一 HTML(`build/index.standalone.html`)にまとめる。配布物はこれ。画像は `build/lib/images.mjs` で WebP に再エンコードして埋め込み(PWA と同じ設定)、BGM はゲーム本体の script の**後ろ**に置く(回線越しでも BGM を読み終える前に START できる。`bgm.js` は未到着のトラックを DOMContentLoaded 後に拾う)。
- **スマホ確認用リンク(毎回渡す)**: https://claude.ai/artifact/TVwH1EijKM5bLocKZNQfsL — `npm run build:artifact`(`build/artifact.mjs`)で `dist-artifact/`(git 管理外)を作り、Artifact ツールでこの URL に publish(`file_path: dist-artifact/index.html`。BGM `assets/bgm/stage<N>.mp3` は内容が変わったときだけ `files` で送る。現在の一覧は `action:list, scope:files`)。Artifact ホストの制約: **同じ場所のファイルでも `<script src>` は拒否される**(JS はページに埋め込む)、ページは 16MB まで、`<head>`/`<body>` はホスト側、Service Worker 不可。なのでゲーム本体と画像(WebP の data:)はページに埋め込み、BGM だけ別ファイル。エラーは画面下に赤枠で表示される(実機で原因を見るため)。BGM 入りなのでリンクは**非公開のまま**(共有しない)。
- 画像の読み込みは `Assets.setPreferences({ preferWorkers:false, preferCreateImageBitmap:false })`(main.js)で `<img>` 経由。Pixi 既定の fetch→ImageBitmap は data: でも connect-src に掛かり、CSP のある環境で起動しなくなる。
- `build/pwa.mjs` — PWA ビルド。`dist/`(git 管理外)に静的サイトとして出力する。画像は bundle から抜き出して WebP 化(地面タイルは可逆、車・プロップは near-lossless)、manifest・アイコン(`build/pwa/icons/`)・Service Worker(`build/pwa/sw.js`: 起動に要る全ファイルをビルド単位でキャッシュ、BGM は初回再生時にキャッシュして Range 要求に 206 で応答)を付ける。**https で配信しないと SW が動かない**(localhost は可)。`npm run build:pwa` は BGM なし(公開配信してよい)、`npm run build:pwa:bgm` は BGM 入り(**非公開の配信先専用**)。画像変換に `sharp` を使う。
- `build/lib/page.mjs` — standalone / PWA 共通の index.html 分解と bundle。`build/lib/images.mjs` — 同じく共通の WebP 変換。
- ステージ切替時は旧ステージの表示ツリーを `destroyStageTree`(main.js)で破棄する。PixiJS 任せだと 60〜90 秒解放されず、リトライのたびにメモリが積み上がって iPhone で落ちる原因になる。Graphics は `destroy({context:true})` でないと自前の context が残る点に注意。
- **レース終了**: どちらか先にゴールラインを越えた時点で終わる(`race.js` の `winner`。プレイヤーが越えなくても終了)。ゴール後のカメラは勝者に固定・進行方向も勝者に合わせる(`main.js` の `finishFocus`)。プレイヤーが完走していない負け(`result.finished === false`)はベストタイムに記録しない(`records.js`)。
- **ゴール後の自動運転**(`main.js` の `finished` 分岐): 画面ブレ(`p.shake`)は `player.update` でしか減衰しないので、ゴール後は分岐内で減衰させる(しないと接触で入ったブレが残る)。渋滞車とお見合いして止まる(プレイヤーは車を避けて減速・車はプレイヤーを避けて減速、で永久に動かない)のを `trackPostStall` で検出し、1 秒でほぼ動かない/1.5 秒で速度 100 未満なら 1400 単位進むまで全接触を無効(通り抜け)にする。再現は STAGE4 で渋滞車に全速で追突してからゴールを 250 回ランダムに試す方法(修正前は 250 回中 11 回でブレ固着・3 回で完全停止)。
- **レーサー同士の当たり判定**(`game/hull.js`, `race.js` の `resolveContacts`): プレイヤーとライバルの判定形状は、**描画されている車のシルエット**(スプライトの透明度)の凸包を 24 頂点に間引いた多角形で、分離軸判定(SAT)で接触・深さ・法線・接触点を出す(`main.js` の `spriteHull`。テクスチャごとにキャッシュ)。以前の「円 3 つ + CAR_HULL_SCALE/OFFSET の手調整」は、見た目に対して追突方向で最大 44 単位の隙間、STAGE4 のトラックは最大 40 単位のめり込みだった(→ 隙間 16・めり込み 0)。多角形を持たない size(単体テスト・アザーカー `traffic.js`)は従来の円判定のまま。物差しは `node build/tools/hullgauge.mjs [circles|poly]`(描画シルエットのマスクと判定の接触距離の差を、向き・方位を振って測る)、シナリオは `node build/tools/collidescenes.mjs`(追突・横当たり・直角・正面のめり込み残り・向きの変化)。接触で車の向きが変わる(`yawKick`): 接触の最初のフレームだけ、接触点が車の中心から外れているほど、法線方向の接近速度に応じて角速度を与え(最大 `YAW_KICK` 2.0 rad/s、`YAW_DECAY` 4/s で減衰、向きの変化は最大約 29°、プレイヤーは 0.6 倍、重い相手には大きく・自分が重ければ小さく)、`main.js` が毎フレーム積分する。
- **押し合い**(`race.js` の `resolveContacts`): 分離の分担は「押す力」で決まる。プレイヤーは `PLAYER_PUSH` 0.85(ブースト中 +0.10)、ライバルは `pushPower`(既定 0.25)× `pushBonus`、それ以外(アザーカー・単体テスト)は 0.45。`pushBonus` は `rival.js` が毎フレーム決める: ラインから 40 以上外れて戻ろうとしている間は距離に応じて ×1〜×3(160 で最大)、STAGE2 で妨害中は最低 ×2。**プレイヤーに押されても、ライン復帰では押し返す**ため。プレイヤー対ライバルは重なりより `DUEL_REBOUND` 0.6 だけ余計に離す(反発)。STAGE4 のトラックは `pushPower: 0.45` で従来どおり。測定は `shove2.mjs` 相当(横から寄せる・ラインとの間に入って塞ぐ、を接触なしの対照走行と比べる)。STAGE1 で押し出されて大減速する件の原因は、**横からの接触でも「前の車に追突したので減速」のブレーキ(`BACK_OFF_BRAKE`)が掛かっていた**こと。プレイヤーがライバルの前方コーン(dot > 0.7)にいるときだけ掛けるように修正。コースアウト自体のペナルティは無い(壁は ×0.93)。
- **STAGE2 の蛇行・妨害**: 前に出たら最初の一振りが最大になるよう位相を山から始める(`_wasWeaving`)。前に出て蛇行中は接触直後のライン引き戻し(`contactRecoveryTimer`)を掛けない(パス自体が接触で、掛けると最初の一振りが遅れた)。プレイヤーが近い間(`harass`)は路面内(`weaveLimit` を `harassing` で路面幅へ寄せる)。**小刻みに蛇行**: `weaveSpeed` 5.0(既定 2.6)・`weaveAhead` 0.6・`harass.weave` 0.35・`weaveLook` 0.9(前に出て 100〜800 離れた区間の測定で、極値の回数 0.5〜0.9→約 1.2 回/s、振れ幅 150〜280→90〜140)。**突っ込む妨害**: `sideBlock` 0.8・`sideBlockRate` 4・`sideBlockInto` 30(横に並んだプレイヤーの車線の**30 単位向こう**まで舵を切る。固定量の寄せだと届かず抜かれる)。前に出て 80 以上離れたら寄せは効かない(そこから先は蛇行の仕事。これが無いと並んだまま蛇行が始まらない)。妨害テスト(`harass4.mjs` の opp、遅い相手)で、抜かれた回数 4→0・塞いだ割合 16→27%。
- **STAGE3 のブースト**(`finalLapCornerBoost`): ファイナルラップだけ、周回の `finalLapCornerBoostFrom`(0.42 = 登りの 6 連ヘアピンの後)以降の大コーナー(`bigCurve ≥ 0.2`)の**出口側**(長曲線量が下降中)で、`cornerLimit`(減速 430/s の保守モデル)× 0.92 に 110 以上の余裕があるとき点火。ブースト中の速度上限はその値、余裕が無くなれば消す(ブーストはコーナリング制動を飛ばすので、ヘアピンの手前で焚くと外へ膨らむ)。1 コーナー 1 発。それ以前のラップと登りの区間、直線のブーストは無し。実測は 4 か所で 0.4〜1.2 秒、壁への食い込みなし。
- **ブースト演出**: 既定は炎(`render/boostfx.js`)。ライバルの config に `boostFx: 'wings'` を書くと、炎の代わりに光の翼(`render/wingsfx.js`: 羽根 12 枚+翼の面をキャンバスで生成、ブースト開始でオーバーシュートして開き、走行中は羽ばたき、終了でゆっくり畳む。舞う羽根はプール 40 枚、開始時に光の脈動)になる。現在は STAGE3(AE86)だけ。1 回の update は約 0.02ms。`main.js` の loadStage で選ぶ。
- **接触音**(`sfx.js` の `crash`): 重さは 120Hz〜1kHz の「胴」で決まる(スマホは 100Hz 未満を鳴らせない)。以前は胴が超低域・高域より 18dB 抜けて軽く聞こえた。測定は OfflineAudioContext に `buildAudio` を描画して帯域別 RMS を見る(強さ 1: 120-300Hz -60.8→-40.4dB、300-1k -61.9→-49.3dB、4kHz 以上 -4dB)。
- **エンディング**: 最終ステージに勝つとリザルトカードを挟まずゴール演出の直後にエンディングへ入り(負け・他ステージは従来どおりカード)、動画(`assets/ending/ending.mp4`=iPhone 用 H.264、`ending.webm`=VP9。`.gitignore` 済み・公開リポジトリには載せない。元動画は `/root/.claude/uploads/.../grok_video_*.mp4`)→クレジット(ライバル名・★合計・ベスト合計は保存内容から生成)→TITLE。動画は、ゴール演出中に fetch で blob に先読み→blob URL で再生、だめなら各形式のファイル URL、自動再生を拒否されたら PLAY ボタン、どれも失敗すれば理由を画面下の赤枠に出してクレジットだけ(`index.html` の `playEnding`)。iPhone で自動再生に近づけるため、START のタップ内でエンディング用 `<video>` に無音の極小 MP4(`SILENT_MP4`)を再生して要素をアンロックしておく(BGM 要素と同じ手。差し替え後も許可が残るかは Safari 次第で**実機未確認**、ダメなら PLAY ボタン)。終了時は黒の上でタイトルを立ててから黒を引く(ゲーム画面を見せない)。`build:artifact` は `assets/ending/` があればリンクにも同梱する。このサンドボックスの Chromium は H.264 を再生できないので、動画の確認は WebM 側で行い、MP4 の実再生は実機で確認する。変換: pip の `imageio-ffmpeg`(`pip install --target <scratch> imageio-ffmpeg` の同梱 ffmpeg)で `libx264 -crf 27` / `libvpx-vp9 -crf 36`。
- `assets/bgm/stage<N>.mp3` — ステージ BGM。市販曲なので **git 管理外**(`.gitignore`)。`node build/tools/make-bgm.mjs 1=<mp3> 2=<mp3> ...` で音量を揃えて 96kbps(5分超はフェードで切る。単一HTMLを 30MB 未満に収めるため)に再エンコードして置き、`build:standalone` が見つかった分だけ埋め込む。無ければその面は無音で動く。

ステージは前のステージに（どの難易度でも）勝つと解放され、解放済みのステージはタイトル画面から選べる。難易度は NORMAL（ライバル速度・加速を落とした標準）と HARD（各ステージの元の調整そのまま、全ステージクリアで解放）。**HARD は現在保留で非表示**(`index.html` の `HARD_ON` で戻せる)。リザルトの TITLE ボタンからタイトルに戻り、解放済みステージを選べる。HUD の旗アイコン(`#stagePick`)は確認用の全ステージジャンプ、その下段の GOAL アイコン(`#goalPick`)は確認用の即ゴール(レース中に押すとプレイヤーがラインを越える)で、どちらもユーザーの指示があるまで残す(後で削除予定)。速度表示(`.hud .speed`)はニトロゲージの真上(下端 +55px、狭い画面 +40px)に置く(高いと車の後ろに被る。標準の拡大率で 390x844 など 4 サイズは被り 0、最大拡大では車自体がゲージまで届くので被る)。STAGE5 のライバル音(V10)は `makeV10Engine` の `pitch: 1.09`(全回転域で +9%)。タイトルへ戻るときはフェードせず即表示(`showTitle`。フェードすると裏のゲーム画面が透ける)。確認用に URL に `?unlockall` を付けると保存内容を変えずに全ステージと HARD を開ける（例 `build/index.standalone.html?unlockall`）。

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
