# 地理王（GeoKing）

国旗で対戦する地理カードゲーム。サーバーは `server.py`（aiohttp）、画面は `static/` の素の HTML/CSS/JS。iPhone・Android アプリ（`mobile/`、Capacitor）は Render のサイトをそのまま読み込むので、Web の変更は Render の Manual sync（ユーザーが行う）で両方のアプリに反映され、アプリの作り直しはいらない。

## 画面を変えるとき

- `static/` の HTML・CSS・JS・文言や、画面に出るサーバーの動きを変えるときは、**必ず `geoking-ui-change` スキルの手順に従う**（変更前の記録 → 変更 → 変更前後の比較と確認スクリプト → 報告）。
- **頼まれた所だけ変える。** 作業中やレビューで気づいた別の見た目の問題は、直さずに報告して、直すか聞く。頼んでいない所の見た目が変わるのが、ユーザーにとっていちばん困ること。
- 「直りました」と言うのは、確認スクリプトが全部 OK で、変えた画面を 375px・320px・英語で目で見てから。実機でしか分からない所は、確かめていないとはっきり書く。

## 確認の道具（`tests/`）

- 確認用サーバーは `.claude/launch.json` の `geoking-check`（PORT=8090, GEOKING_DEV=1）。8080 番は別のセッションの古いサーバーのことがある。
- ブラウザで使うもの（`/dev/tests/…` から読み込む。読み込み方はスキルに書いてある）: `layout_snapshot.js`（変更前後の比較）、`layout_check.js`（横はみ出し）、`contrast_check.js`（文字の見やすさ。ダークモードも）、`app_frame_check.js`（アプリ内フレームの開き方・戻り方）、`result_size_check.js`（結果画面のカード・国旗の大きさを幅ごとに。iPhone はシミュレーターの Safari で `/dev/tests/result_size.html`）、`spectator_check.js`（観戦中の「みんなの手札」。iPhone は `/dev/tests/spectator.html`）、`update_reload_check.js`（更新の自動読み直し）
- サーバーのテスト: `GEOKING_WS=ws://localhost:8090/ws python3 tests/e2e_two_players.py` と `tests/e2e_solo_bot.py`。更新時の部屋の引っ越し（古いサーバー → 新しいサーバー）は `python3 tests/test_migration.py`（手元で Render の切り替えを再現する。部屋の中身の項目を足したら room_to_dict / room_from_dict にも足す）。別のアプリ（LINE など）に行って戻ったときに部屋に戻れるか（切断の猶予・つなぎ直し）は `python3 tests/test_away_return.py`

## そのほか

- 別の Claude セッションが同じ作業ツリーを同時に編集・コミットしていることがある。コミットは自分が変えたファイルだけを名前を指定して add する。
- ユーザーへの返事は日本語で、専門用語は少なめに。
