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
- **スマホ確認用リンク(毎回渡す)**: https://claude.ai/artifact/TVwH1EijKM5bLocKZNQfsL — `npm run build:artifact`(`build/artifact.mjs`)で `dist-artifact/`(git 管理外)を作り、Artifact ツールでこの URL に publish(`file_path: dist-artifact/index.html`。BGM `assets/bgm/stage<N>.mp3` は内容が変わったときだけ `files` で送る。現在の一覧は `action:list, scope:files`)。Artifact ホストの制約: **同じ場所のファイルでも `<script src>` は拒否される**(JS はページに埋め込む)、ページは 16MB まで、`<head>`/`<body>` はホスト側、Service Worker 不可。なのでゲーム本体と画像(WebP の data:)はページに埋め込み、BGM だけ別ファイル。エラーは画面下に赤枠で表示される(実機で原因を見るため)。リンクは今のところ非公開のまま(BGM 入り。共有は指示があってから)。
- 画像の読み込みは `Assets.setPreferences({ preferWorkers:false, preferCreateImageBitmap:false })`(main.js)で `<img>` 経由。Pixi 既定の fetch→ImageBitmap は data: でも connect-src に掛かり、CSP のある環境で起動しなくなる。
- `build/pwa.mjs` — PWA ビルド。`dist/`(git 管理外)に静的サイトとして出力する。画像は bundle から抜き出して WebP 化(地面タイルは可逆、車・プロップは near-lossless)、manifest・アイコン(`build/pwa/icons/`)・Service Worker(`build/pwa/sw.js`: 起動に要る全ファイルをビルド単位でキャッシュ、BGM は初回再生時にキャッシュして Range 要求に 206 で応答)を付ける。**https で配信しないと SW が動かない**(localhost は可)。`npm run build:pwa` は BGM(`assets/bgm/`)とエンディング動画(`assets/ending/`)入り(どちらも提供元の許可・自作でユーザー了承済みなので公開配信してよい。何かあればユーザーが消す)、`npm run build:pwa:nobgm` は BGM なし。BGM は初回再生時に取ってキャッシュ、動画は事前キャッシュしない。画像変換に `sharp` を使う。
- **GitHub Pages 公開**(`.github/workflows/pages.yml`): `main` への push(または Actions タブから手動)で、`npm ci` → `npm test` → `npm run build:pwa` → `dist/` を Pages に公開。初回だけ GitHub の Settings → Pages → Source を「GitHub Actions」にする必要がある(このセッションからは設定を変えられない)。`main` 以外のブランチからは公開されない(Pages の環境の既定)。URL は `https://<所有者>.github.io/<リポジトリ名>/`。サブパス配信でも動くことは確認済み(manifest・sw・アセットは相対パス、SW のスコープ `/HiRoCF/`)。
- **manifest に `id` を書かない**: `id: './'` は**オリジンの直下**(`https://<所有者>.github.io/`)に解決され、同じ github.io 上の他のアプリと同じアプリ ID になる → Chrome が「インストール済み」と見て Install を出さず、ホーム画面にショートカットを作るだけになった(Android で発生)。省略すれば `start_url`(パス込みの URL)が ID になり、アプリごとに別になる。確認は CDP の `Page.getAppId`。
- **PWA のインストール診断**: Android Chrome の「ホーム画面に追加」で「このアプリはインストールできません」と出た件の対策として、`display` を `standalone`+`display_override: ['fullscreen','standalone']` にし、SW は `load` を待たず即登録した(`build/pwa.mjs` の html テンプレート)。URL に `?pwadebug` を付けると画面下に「beforeinstallprompt が来たか(= Chrome がインストール可能と判断したか)・SW の状態・standalone か」が出る。コンソールの無いスマホ用。
- **スタート/ゴールの光る線**(`render/goalline.js`): ライン(path の 1.5 区間目)に、路肩の少し外まで届く**金白に光る横線**を、路面の上・車の下に加算合成で 1 本描く(スプライト 2 枚、テクスチャはキャンバス生成)。ゆっくり脈打ち、約 2.8 秒ごとに明るいハイライトが左から右へ走る。チェッカーの門(`gantry.js`)は「見づらい」ので外し、その代わり。サーキット系ステージの**路面に塗っていたチェッカーも外した**(線の下で濁るため。`surfaces.js` の `PAINT_START_CHEQUER`、true で戻る)。ステージ 2 の横断歩道・ステージ 4 の高速ゲートの帯はそのまま(その上に光る線が重なる)。
- **ベストランのゴースト**(`game/ghost.js`): 走行を 1/30 秒ごとの位置・向き(16bit 整数、3 分で約 43KB)で記録し、**ベスト更新時だけ**ステージ×難易度ごとに localStorage へ保存(`hirocf_ghost_v1_<id>_<難易度>`、`index.html` の `paintRecord` → `game.saveGhost(out.best)`)。次のレースでは `loadStage` が読み、プレイヤー車の絵を青白い半透明(tint 0x9fd8ff・alpha 0.36)にしたスプライトをプレイヤーの下に出し、レース時間で補間して再生(走り終えたら消える・当たり判定なし)。記録は各サンプルをその時刻の状態に補間して取る(フレームのずれで遅れない)。保存できない環境ではゴーストが無いだけで続行。
- **PWA アイコン**(`build/pwa/icons/`、コミット済み。`build/pwa.mjs` はコピーするだけ): `node build/tools/make-icons.mjs` で再生成(sharp。元絵は `build/pwa/icon-src/car.png` = プレイヤー車の切り抜き)。絵柄は、赤白の縁石で挟んだ暗いアスファルトの帯を斜め 35° に走る白い車(赤いグロー・影付き)+タイトルと同じ配色の HiRoCF 文字。`maskable-512.png` だけは文字なし・車小さめ(丸/角丸マスクで中央 66% しか残らないため)。文字は生成時のフォント(Liberation Sans)で PNG に焼くのでビルドはフォントに依存しない。
- `build/lib/page.mjs` — standalone / PWA 共通の index.html 分解と bundle。`build/lib/images.mjs` — 同じく共通の WebP 変換。
- **アンチエイリアス**(`main.js` の `app.init`): `devicePixelRatio` が 2 以上(スマホ)では MSAA を切る(1x の PC だけ有効)。ソフトウェア描画での相対測定(実機 GPU は未測定)で、STAGE2 のフレーム時間 −24%、STAGE5 −33%。縁(車線・横断歩道)が 3 倍拡大で少しギザつく程度で、画面全体の平均差は 1.0/255。JS 側は 1 フレーム 0.2ms 未満で既に軽く、重さの本体は GPU の塗りつぶし(解像度に比例)。解像度は `makeQualityGovernor` が遅いときだけ段階的に下げる。戻すなら `antialias: true`。
- ステージ切替時は旧ステージの表示ツリーを `destroyStageTree`(main.js)で破棄する。PixiJS 任せだと 60〜90 秒解放されず、リトライのたびにメモリが積み上がって iPhone で落ちる原因になる。Graphics は `destroy({context:true})` でないと自前の context が残る点に注意。
- **ゴール演出の瞬間**(`render/finishfx.js`): 放射状スピードライン+水色の稲妻(`boltPath`)の元の演出のまま。一度リング+星のきらめきに替えたが、ユーザー判断で**元に戻した**(`818d27c` の内容)。
- **BGM の見張り**(`audio/bgm.js` の `watch`): 「レースの途中から BGM が鳴らなくなる」報告への対策。**原因は再現できず未確認**(Chromium では通常のレース・トラック終端のループ・リトライ・ステージ切替・ポーズ/復帰・背景/復帰・ミュート切替・PWA の SW 経由のどれでも止まらなかった。iPhone/Android 実機は未確認)。想定した原因は、ストリームの途切れ・ホストが Range 非対応・ブラウザが要素を止める/終わらせる・AudioContext が OS に止められる、のどれか。そこで **鳴っているはずの間(`active`、かつポーズ/非表示で意図して止めていない=`held` でない)、1 秒ごとに状態を見て**、止まっていれば `play()`、エラーまたは約 5 秒動かなければ src を読み直して直前の位置へ seek してから `play()`(2.5 秒以内に連続しない)。ctx が running でなければ `resume()` も試す。Chromium で、外から pause・ループ無効で終端・壊れた src のいずれも 1〜4 秒で復帰、通常再生・意図したポーズ中は何もしない(再起動イベント 0)ことを確認。再発したら、端末・OS・どのステージで何分後か・戻った直後か、を聞く。
- **BGM の診断表示**(`bgm.js`): 「3 ぐらいから無くなる」(3 周目/3 面/3 分のどれかは未確認。再現できず、ステージ 1〜5 の順の遷移・2→3 周目・出力レベル(AnalyserNode)でも異常なし。レース時間は実測で 1 面 79 秒・2 面 92 秒・高速 194 秒・峠 126 秒・最終 169 秒、曲は 300/187/300/291/233 秒なのでレース中にループはしない)への対策。コンソールの無いスマホ用に、左上に BGM の状態(再生/停止・位置・readyState・networkState・ctx 状態・gain・エラー)と直近 6 件のイベント(play/pause/ended/error/stalled/waiting/seeked、ページ非表示/復帰、ctx の状態変化、見張りの介入)を緑文字で出す。**`?bgmdebug` を付けたとき、または localhost / github.io 以外のホスト(= スマホ確認用リンク)で出る**。公開(github.io)では出ない。
- **レース終了**: どちらか先にゴールラインを越えた時点で終わる(`race.js` の `winner`。プレイヤーが越えなくても終了)。ゴール後のカメラは勝者に固定・進行方向も勝者に合わせる(`main.js` の `finishFocus`)。プレイヤーが完走していない負け(`result.finished === false`)はベストタイムに記録しない(`records.js`)。
- **ゴール後の自動運転**(`main.js` の `finished` 分岐): 画面ブレ(`p.shake`)は `player.update` でしか減衰しないので、ゴール後は分岐内で減衰させる(しないと接触で入ったブレが残る)。渋滞車とお見合いして止まる(プレイヤーは車を避けて減速・車はプレイヤーを避けて減速、で永久に動かない)のを `trackPostStall` で検出し、1 秒でほぼ動かない/1.5 秒で速度 100 未満なら 1400 単位進むまで全接触を無効(通り抜け)にする。再現は STAGE4 で渋滞車に全速で追突してからゴールを 250 回ランダムに試す方法(修正前は 250 回中 11 回でブレ固着・3 回で完全停止)。
- **レーサー同士の当たり判定**(`game/hull.js`, `race.js` の `resolveContacts`): プレイヤーとライバルの判定形状は、**描画されている車のシルエット**(スプライトの透明度)の凸包を 24 頂点に間引いた多角形で、分離軸判定(SAT)で接触・深さ・法線・接触点を出す(`main.js` の `spriteHull`。テクスチャごとにキャッシュ)。以前の「円 3 つ + CAR_HULL_SCALE/OFFSET の手調整」は、見た目に対して追突方向で最大 44 単位の隙間、STAGE4 のトラックは最大 40 単位のめり込みだった(→ 隙間 16・めり込み 0)。多角形を持たない size(単体テスト・アザーカー `traffic.js`)は従来の円判定のまま。物差しは `node build/tools/hullgauge.mjs [circles|poly]`(描画シルエットのマスクと判定の接触距離の差を、向き・方位を振って測る)、シナリオは `node build/tools/collidescenes.mjs`(追突・横当たり・直角・正面のめり込み残り・向きの変化)。接触で車の向きが変わる(`yawKick`): 接触の最初のフレームだけ、接触点が車の中心から外れているほど、法線方向の接近速度に応じて角速度を与え(最大 `YAW_KICK` 2.0 rad/s、`YAW_DECAY` 4/s で減衰、向きの変化は最大約 29°、プレイヤーは 0.6 倍、重い相手には大きく・自分が重ければ小さく)、`main.js` が毎フレーム積分する。
- **押し合い**(`race.js` の `resolveContacts`): 分離の分担は「押す力」で決まる。プレイヤーは `PLAYER_PUSH` 0.85(ブースト中 +0.10)、ライバルは `pushPower`(既定 0.25)× `pushBonus`、それ以外(アザーカー・単体テスト)は 0.45。`pushBonus` は `rival.js` が毎フレーム決める: ラインから 40 以上外れて戻ろうとしている間は距離に応じて ×1〜×3(160 で最大)、STAGE2 で妨害中は最低 ×2。**プレイヤーに押されても、ライン復帰では押し返す**ため。プレイヤー対ライバルは重なりより `DUEL_REBOUND` 0.6 だけ余計に離す(反発)。STAGE4 のトラックは `pushPower: 0.45` で従来どおり。測定は `shove2.mjs` 相当(横から寄せる・ラインとの間に入って塞ぐ、を接触なしの対照走行と比べる)。STAGE1 で押し出されて大減速する件の原因は、**横からの接触でも「前の車に追突したので減速」のブレーキ(`BACK_OFF_BRAKE`)が掛かっていた**こと。プレイヤーがライバルの前方コーン(dot > 0.7)にいるときだけ掛けるように修正。コースアウト自体のペナルティは無い(壁は ×0.93)。
- **STAGE2 の蛇行・妨害**: 前に出たら最初の一振りが最大になるよう位相を山から始める(`_wasWeaving`)。前に出て蛇行中は接触直後のライン引き戻し(`contactRecoveryTimer`)を掛けない(パス自体が接触で、掛けると最初の一振りが遅れた)。プレイヤーが近い間(`harass`)は路面内(`weaveLimit` を `harassing` で路面幅へ寄せる)。**小刻みに蛇行**: `weaveSpeed` 5.0(既定 2.6)・`weaveAhead` 0.6・`harass.weave` 0.35・`weaveLook` 0.9(前に出て 100〜800 離れた区間の測定で、極値の回数 0.5〜0.9→約 1.2 回/s、振れ幅 150〜280→90〜140)。**突っ込む妨害**: `sideBlock` 0.8・`sideBlockRate` 4・`sideBlockInto` 30(横に並んだプレイヤーの車線の**30 単位向こう**まで舵を切る。固定量の寄せだと届かず抜かれる)。前に出て 80 以上離れたら寄せは効かない(そこから先は蛇行の仕事。これが無いと並んだまま蛇行が始まらない)。妨害テスト(`harass4.mjs` の opp、遅い相手)で、抜かれた回数 4→0・塞いだ割合 16→27%。
- **STAGE3 のブースト**(`finalLapCornerBoost`): ファイナルラップだけ、周回の `finalLapCornerBoostFrom`(0.42 = 登りの 6 連ヘアピンの後)以降の大コーナー(`bigCurve ≥ 0.2`)の**出口側**(長曲線量が下降中)で、`cornerLimit`(減速 430/s の保守モデル)× 0.92 に 110 以上の余裕があるとき点火。ブースト中の速度上限はその値、余裕が無くなれば消す(ブーストはコーナリング制動を飛ばすので、ヘアピンの手前で焚くと外へ膨らむ)。1 コーナー 1 発。それ以前のラップと登りの区間、直線のブーストは無し。実測は 4 か所で 0.6〜1.3 秒、壁への食い込みなし(上限は `cornerLimit`×0.98、余裕 12 以上で継続、80 以上で点火)。**ブースト後の減速**: 以前は終了と同時に最高速(613)へ 1 フレームで頭打ちされ(723→610)ガクッと落ちていた。今は超過分を `BOOST_BLEED` 140/s で抜き、通常の減速(`430×curveAhead`)も超過中は半分に(`_boostedAt`)。**羽根**は開始から最低 `WINGS_MIN_OPEN` 1.5 秒開いたまま(`wingsOpen`。ブーストが短く切れても閉じない)、畳む速さも 3.5→1.3/s(`wingsfx.js`)。
- **STAGE1 ライバルの減速と壁**: コーナーの制動は `brake.plan`(0.3)で計画し(`cornerLimit` が減速を `decel×plan` として見積もり、実際は `decel` 900 で掛ける)、曲がり始める前に速度を落とし終える(最初のコーナーで 進入 497→437、頂点 457→430。周回は約 +0.7 秒)。壁: `holdOpeningStraight`(最初の直線は舵を切らない)の間に接触・壁擦りが起きると、その場で保持を解除して舵を戻す(`update` 冒頭。以前は壁に押し付けられたまま直線を最後まで壁沿いに走った。開始 2 秒でプレイヤーに壁へ押された 12 回の平均で壁接触 4.4 秒→0)。
- **STAGE3 ライバルのドリフト時の減速**: 以前はヘアピン進入 459→399 のあと頂点まで 399 のまま(減速して見えない)。`cornerSlow` 0.48→0.59 で 459→366、ドリフトの速度ゲートを `driftSpeed` [326,450]→[290,400] に下げて、遅くなってもドリフト量は落ちない(頂点で 0.6→0.8)。周回は約 +1.5 秒(3.4%)。出足の `accel` は据え置き。
- **ステージの順番**(`config.js` の `STAGE_ORDER` = [1, 2, 4, 3, 5]): 高速(id 4)が 3 面目、峠(id 3)が 4 面目。**id はコースそのもの**(レイアウト・BGM `stage<id>.mp3`・ベストタイム・エンジン・渋滞)のまま、表示される番号(`name` 'STAGE N'、タイトルのチップ、確認用の旗のバッジ、クレジット)・解放の連鎖(`records.js` の既定 `stageIds`)・NEXT STAGE・エンディング(最終=id 5)が並び順に従う。保存済みのベスト・★は id に付いているので引き継がれる(解放は新しい順で判定: 峠は高速に勝つまで閉じる)。コードのコメントや `g.loadStage(n)`・測定スクリプトの「stage 3/4」は id のこと。難易度の表示は NORMAL のとき出さない(`withDiff`、HARD のときだけ名前を付ける)。
- **ゴール後の走行**(`main.js` の `finished` 分岐): プレイヤーもライバルも同じ一定速度 `POST_RACE_SPEED` 400(autoDrivePostRace の単位。渋滞車・相手が前にいても減速しない)。避けるのは舵だけ: 双方が `postRaceLane`(`traffic.planPass` で空いている車線へ)で、渋滞車と互いを避ける。当たり判定は生きたまま(逃げ場が無ければ当たる。完全に止まった車だけ `trackPostStall` が通り抜けさせる)。STAGE4(id 4)で渋滞車に全速で追突してからゴール 30 回、ライバル相手 20 回で、止まる・動かないは 0、揺れが 0.5 秒超残ったのが 1 回(再接触)。
- **STAGE5 ライバルのブースト演出**(`render/aurafx.js`、config `boostFx: 'aura'`): 車体を緑で包む(車のシルエットを緑にして縮小→拡大でぼかした光の輪+車の絵そのものを緑の加算で重ねる。iPhone の Safari に `ctx.filter` が無いのでぼかしは半分ずつ縮める方式)。**進行方向の先(鼻先)から後ろへ流れる緑の筋**(プール 64 粒、毎秒 120 本、ボディ沿いから少し開いて尾へ抜ける)、開始時に緑のリング 1 発。**後方は炎の形**: 尾の後ろに緑の炎の舌 3 本(中央が大きく両脇が小さい。ニトロの炎と同じ先細りの舌テクスチャ `makeFlameTexture` を緑に、芯は淡い緑白。長さ約 1.3 車長、ちらつき、ブーストの立ち上がり/終わりに伸び縮み)と、そこから離れる緑の火の粉(プール 36)。鼻先からの筋は 70 本/秒に減らした。プレイヤーの炎・STAGE3(峠 id 3)の羽根はそのまま。
- **表示番号と id**: ユーザーの言う「STAGE3」は今は**高速(id 4、トラック)**、「STAGE4」は峠(id 3、AE86)。CLAUDE.md や測定スクリプトの番号は id。トラックのカーブ減速は `cornerSlow` 1.0→1.2、STAGE5 のコーナー前の制動は `brake.plan` 0.3(早めに計画し実際は 900 で掛ける)と `grip` 0.9→0.82(頂点 −6〜8%、周回 +0.3 秒)。
- **ブースト演出**: 既定は炎(`render/boostfx.js`)。ライバルの config に `boostFx: 'wings'` を書くと、炎の代わりに光の翼(`render/wingsfx.js`: 羽根 12 枚+翼の面をキャンバスで生成、ブースト開始でオーバーシュートして開き、走行中は羽ばたき、終了でゆっくり畳む。舞う羽根はプール 40 枚、開始時に光の脈動)になる。現在は STAGE3(AE86)だけ。1 回の update は約 0.02ms。`main.js` の loadStage で選ぶ。
- **接触音**(`sfx.js` の `crash`): 重さは 120Hz〜1kHz の「胴」で決まる(スマホは 100Hz 未満を鳴らせない)。以前は胴が超低域・高域より 18dB 抜けて軽く聞こえた。測定は OfflineAudioContext に `buildAudio` を描画して帯域別 RMS を見る(強さ 1: 120-300Hz -60.8→-40.4dB、300-1k -61.9→-49.3dB、4kHz 以上 -4dB)。
- **エンディング**: 最終ステージに勝つとリザルトカードを挟まずゴール演出の直後にエンディングへ入り(負け・他ステージは従来どおりカード)、動画(`assets/ending/ending.mp4`=iPhone 用 H.264、`ending.webm`=VP9。リポジトリに入っている(ユーザー指示で追加)。元動画は `/root/.claude/uploads/.../grok_video_*.mp4`)→クレジット(ライバル名・★合計・ベスト合計は保存内容から生成)→TITLE。動画は、ゴール演出中に fetch で blob に先読み→blob URL で再生、だめなら各形式のファイル URL、自動再生を拒否されたら PLAY ボタン、どれも失敗すれば理由を画面下の赤枠に出してクレジットだけ(`index.html` の `playEnding`)。iPhone で自動再生に近づけるため、START のタップ内でエンディング用 `<video>` に無音の極小 MP4(`SILENT_MP4`)を再生して要素をアンロックしておく(BGM 要素と同じ手。差し替え後も許可が残るかは Safari 次第で**実機未確認**、ダメなら PLAY ボタン)。終了時は黒の上でタイトルを立ててから黒を引く(ゲーム画面を見せない)。`build:artifact` は `assets/ending/` があればリンクにも同梱する。このサンドボックスの Chromium は H.264 を再生できないので、動画の確認は WebM 側で行い、MP4 の実再生は実機で確認する。変換: pip の `imageio-ffmpeg`(`pip install --target <scratch> imageio-ffmpeg` の同梱 ffmpeg)で `libx264 -crf 27` / `libvpx-vp9 -crf 36`。
- `assets/bgm/stage<N>.mp3` — ステージ BGM。提供元から許可をもらったもの(ユーザー確認済み)で、リポジトリにも入れている(`assets/bgm/`)。公開配信物にも入れてよい(問題が出たらユーザーが削除する)。`node build/tools/make-bgm.mjs 1=<mp3> 2=<mp3> ...` で音量を揃えて 96kbps(5分超はフェードで切る。単一HTMLを 30MB 未満に収めるため)に再エンコードして置き、`build:standalone` が見つかった分だけ埋め込む。無ければその面は無音で動く。

ステージは前のステージに（どの難易度でも）勝つと解放され、解放済みのステージはタイトル画面から選べる。**未解放のステージのチップはタイトルに出さない**(全ステージ数が分からないように。`paintStages` が `display:none`。チップは固定幅・中央寄せで、1 個でも 5 個でも同じ大きさ。`?unlockall` では全部出る。確認用の旗のメニューは対象外)。難易度は NORMAL（ライバル速度・加速を落とした標準）と HARD（各ステージの元の調整そのまま、全ステージクリアで解放）。**HARD は現在保留で非表示**(`index.html` の `HARD_ON` で戻せる)。リザルトの TITLE ボタンからタイトルに戻り、解放済みステージを選べる。HUD の旗アイコン(`#stagePick`)は確認用の全ステージジャンプ、その下段の GOAL アイコン(`#goalPick`)は確認用の即ゴール(レース中に押すとプレイヤーがラインを越える)。**公開版では出さない**: URL に `?test` を付けたときだけ表示される(`body.testmode`、CSS `.testOnly`。ステージ数のネタバレ防止)。速度表示(`.hud .speed`)はニトロゲージの真上(下端 +55px、狭い画面 +40px)に置く(高いと車の後ろに被る。標準の拡大率で 390x844 など 4 サイズは被り 0、最大拡大では車自体がゲージまで届くので被る)。STAGE5 のライバル音(V10)は `makeV10Engine` の `pitch: 1.09`(全回転域で +9%)。タイトルへ戻るときはフェードせず即表示(`showTitle`。フェードすると裏のゲーム画面が透ける)。確認用に URL に `?unlockall` を付けると保存内容を変えずに全ステージと HARD を開ける（例 `build/index.standalone.html?unlockall`）。

## 開発コマンド

```
npm install
npm run dev             # http-server . -p 8080 -c-1 でローカル配信
npm test                 # vitest run
npm run lint              # eslint src
npm run format            # prettier --write .
npm run build:standalone  # build/index.standalone.html を生成
npm run build:pwa         # dist/ に PWA(BGM・エンディング動画入り)を生成。build:pwa:nobgm で BGM なし
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
