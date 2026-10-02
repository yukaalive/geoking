# 地理王（GeoKing）

国旗で対戦する地理カードゲーム。サーバーは `server.py`（aiohttp）、画面は `static/` の素の HTML/CSS/JS。iPhone・Android アプリ（`mobile/`、Capacitor）は Render のサイトをそのまま読み込むので、Web の変更は Render の Manual sync（ユーザーが行う）で両方のアプリに反映され、アプリの作り直しはいらない。

## 考え方（いつも）

- **このプロジェクトでは、必ずオブジェクト指向（画面に出る「もの」から考え、操作や説明はそのもののそばに置く）とユーザー目線（はじめての人・ホスト・いつもの人・観戦・ひとり・英語・320px のスマホ）で考える。** 案を出す・機能や配置を決める・直し方を選ぶときは `geoking-design` スキルに従い、案A/B/C を比べて出して、ユーザーが選んでから作る。

## 画面を変えるとき

- `static/` の HTML・CSS・JS・文言や、画面に出るサーバーの動きを変えるときは、**必ず `geoking-ui-change` スキルの手順に従う**（変更前の記録 → 変更 → 変更前後の比較と確認スクリプト → 報告）。
- **頼まれた所だけ変える。** 作業中やレビューで気づいた別の見た目の問題は、直さずに報告して、直すか聞く。頼んでいない所の見た目が変わるのが、ユーザーにとっていちばん困ること。
- 「直りました」と言うのは、確認スクリプトが全部 OK で、変えた画面を 375px・320px・英語で目で見てから。実機でしか分からない所は、確かめていないとはっきり書く。

## 確認の道具（`tests/`）

- 確認用サーバーは `.claude/launch.json` の `geoking-check`（PORT=8090, GEOKING_DEV=1）。8080 番は別のセッションの古いサーバーのことがある。
- ブラウザで使うもの（`/dev/tests/…` から読み込む。読み込み方はスキルに書いてある）: `layout_snapshot.js`（変更前後の比較）、`layout_check.js`（横はみ出し）、`contrast_check.js`（文字の見やすさ。ダークモードも）、`app_frame_check.js`（アプリ内フレームの開き方・戻り方）、`result_size_check.js`（結果画面のカード・国旗の大きさを幅ごとに。iPhone はシミュレーターの Safari で `/dev/tests/result_size.html`）、`spectator_check.js`（観戦中の「みんなの手札」。iPhone は `/dev/tests/spectator.html`）、`update_reload_check.js`（更新の自動読み直し）、`quiz_hard_check.js`（クイズの「激ムズ」: 似ている国旗のグループから4択）、`quiz_capital_check.js`（クイズの「首都モード」: 全部の首都が320pxのボタンに収まるか・出さない国・激ムズのグループ）、`survival_check.js`（バトル（体力を減らし合うゲーム。中の名前は survival）: 部屋をバトルにして、ボットと最後まで遊んで、答え合わせの演出の途中のはみ出しと体力の数字を見る）、`window_check.js`（国の小窓とロビー: 紙吹雪の最中に小窓を開いてもページの幅が広がらず真ん中か・小窓の項目名と値の行の数・ロビーの枠の右の端。スマホの画面で起きることなので、ページごと対戦画面に入れ替える `/dev/tests/window_check.html` を、iPhone はシミュレーターの Safari、Android の代わりはスマホの大きさの Chrome で開く。`?fix=off` で直す前、`?step=lobby` でロビー、`?lang=en` で英語）
- サーバーのテスト: `GEOKING_WS=ws://localhost:8090/ws python3 tests/e2e_two_players.py` と `tests/e2e_solo_bot.py`。更新時の部屋の引っ越し（古いサーバー → 新しいサーバー）は `python3 tests/test_migration.py`（手元で Render の切り替えを再現する。部屋の中身の項目を足したら room_to_dict / room_from_dict にも足す）。別のアプリ（LINE など）に行って戻ったときに部屋に戻れるか（切断の猶予・つなぎ直し）は `python3 tests/test_away_return.py`。出来事を Google スプレッドシートに残すしくみ（`sheet_log`、設定は `docs/sheet-log/README.md`）は `python3 tests/test_sheet_log.py`（サーバー側）と `node tests/sheet_log_gs_test.js`（スプレッドシート側の Code.gs）。結果画面の順位（終わった時点のまま、退出しても変えない）は `GEOKING_WS=ws://localhost:8090/ws python3 tests/test_final_standings.py`。ロビーに戻ったときに切断中の人を外す（戻る前に席が埋まったら rejoin_full でホームへ）は `GEOKING_WS=ws://localhost:8090/ws python3 tests/test_lobby_offline.py`。バトル（体力を減らし合うゲーム。部屋の設定の「ゲーム」で選ぶ。中の名前は survival）は `GEOKING_WS=ws://localhost:8090/ws python3 tests/test_survival.py`（減り方の計算・脱落・最後の順位・引っ越し・ホストだけがゲームを変えられる）。バトルのレートと全国ランキング（rating.py・static/rating.js）は `GEOKING_WS=ws://localhost:8090/ws python3 tests/test_rating.py`（計算・ボットの上限・ランキングに載る条件・端末の控え・引っ越し・つないで遊んだときの結果発表と /api/rating・/api/ranking）。スプレッドシートの「レート」のやり取りは test_sheet_log.py と sheet_log_gs_test.js。国のデータ（`data/countries.json`）は `data/build_data.py` で作り直しても同じになること: `python3 tests/test_build_data.py`（首都などは `data/manual_data.py` を直してから作り直す。countries.json を手で直さない）。記録する出来事や列を変えたら、プライバシーポリシーとストアの申告（docs/appstore-submission.md・docs/googleplay-submission.md）も合わせる

## そのほか

- 別の Claude セッションが同じ作業ツリーを同時に編集・コミットしていることがある。コミットは自分が変えたファイルだけを名前を指定して add する。
- ユーザーへの返事は日本語で、専門用語は少なめに。
