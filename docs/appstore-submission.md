# App Store 審査提出の入力メモ（コピペ用）

App Store Connect → マイApp → 地理王 で、以下を順に入力する。

## 1. App情報（左メニュー「App情報」）
| 項目 | 入力 |
|---|---|
| 名前 | 地理王 |
| サブタイトル | 国旗から、どんな国かを推測せよ！ |
| プライマリカテゴリ | ゲーム ＞ トリビア |
| セカンダリカテゴリ | 教育 |
| コンテンツ配信権 | **「はい。サードパーティ製のコンテンツを含み、必要な権利を保有している」** を選択（国旗画像 flagcdn、World Bank CC BY 4.0、mledoze ODbL、Natural Earth PD、Google Fonts。いずれも利用条件を満たし、アプリ内「データ出典」に明記） |
| 年齢制限指定 | 質問票にすべて「なし／いいえ」。ユーザー生成コンテンツ（チャット）の項目は「はい」→ フィルタ・通報・ブロックあり。結果は 4+ または 9+ |

## 2. 価格および配信状況
- 価格: 無料（0円）
- 配信国: すべての国または地域

## 3. App のプライバシー
- プライバシーポリシー URL: https://geoking-vlgh.onrender.com/static/privacy.html
- データ収集: **「はい、このアプリからデータを収集します」**（2026-09-26 から。出来事を Google スプレッドシートに90日以内まで保存するため。docs/sheet-log/）
  - 変え方: App Store Connect →「アプリ」→ 地理王 → 左の「App のプライバシー」→「データタイプ」の「編集」→「はい、…収集します」→ 次の3つにチェック → それぞれの質問に答える →「保存」→ 右上の「公開」。アプリの新しい版や審査はいらない
  - **ID ＞ ユーザ ID**（ニックネーム。Apple の例に「スクリーンネーム」がある。連絡先情報の「名前」は本名のことなので選ばない）
  - **使用状況データ ＞ 製品の操作**（部屋を作った・入った・出た、ゲームの開始・終了、画面を開いた時刻と滞在時間）
  - **ユーザコンテンツ ＞ ゲームプレイのコンテンツ**（部屋名、参加者と得点）
  - 3つとも: 目的は「アプリの機能」と「アナリティクス」だけ／ユーザに関連付けられている: **はい**（どの行にもニックネームがあるので、控えめに「はい」）／トラッキング: **いいえ**
  - 選ばないもの: 連絡先情報・位置情報・デバイス ID・メッセージ（スプレッドシートにはチャットの中身を残さない）
  （以前の答え: 「いいえ、このAppからデータを収集しません」。ニックネーム・チャットは対戦中だけメモリに保持していた）

## 4. バージョン情報（1.1 から。コピペ用）
### スクリーンショット（2026-09-26 に今の画面で撮り直し。`docs/store-assets/make_promo.py appstore` で作る。元の画面は `docs/store-assets/ios-*.png`）
- iPhone 6.9インチの欄: `docs/store-assets/promo/appstore69-1.png` 〜 `appstore69-6.png`（1320×2868）をこの順で6枚
- 6.5インチの欄: `appstore65-1.png` 〜 `appstore65-6.png`（1284×2778）。6.7インチ（1290×2796）は `appstore-1..6.png`
- 1〜4: 対戦（ホーム・お題・答え合わせ・国データ）、5: 図鑑（ランキング）、6: ひとりで国旗クイズ。5・6 は App Store だけ（Play 用は作らない）
- iPad は対象外（iPhone のみ）
- 画像の文には「裏」「めくる」を使わない（このゲームは裏返さない。2026-09-26 に直した）

### プロモーション用テキスト（170字まで。審査なしでいつでも変えられる）
国旗だけを見て「面積が大きい国は？」「人口密度が高い国は？」に答える、みんなで遊べる地理カードゲーム。知識がなくても勘で勝てるかも？ ひとりでも、ボットとの対戦・国旗クイズ・図鑑で楽しめます。

### 概要
国旗カードを8枚配られ、「面積が大きい国は？」「年平均気温が高い国は？」「イスラム教徒の割合が高い国は？」といったお題に、国旗だけを見て一番合いそうな1枚を出します。全員が出したら答え合わせ。いちばんお題に近い国旗を出した人が1点。7ラウンドで一番多く取った人が「地理王」。

・197の国と地域の国旗と、面積・人口・GDP・気温・宗教・平均寿命など約30種のお題
・友だちとは部屋の名前で対戦。友だちはトップの「友だちの部屋の名前」の欄に、部屋の名前（ロビーに表示。最初は部屋を作った人のニックネーム）を入れて「参加する」を押すだけ。招待リンクを送って誘うこともできる
・「公開部屋にする」をオンにした部屋は「公開中の部屋」に並び、世界の誰かとも遊べる
・途中入室は観戦モード。誰がどのカードを選んでいるかがリアルタイムで見える
・ひとりのときは「botとゲーム開始」でボットと対戦
・答え合わせや図鑑で国旗をタップすると、国のデータと世界順位、首都、世界地図上の位置を表示
・図鑑：国旗一覧（国名で検索・地域で絞り込み・並び替え）と、お題ごとの世界ランキング
・ひとりで国旗クイズ：国名から国旗を選ぶ「国旗モード」と、国旗から国名を選ぶ「国名モード」。10問・4択。終わったら、まちがえた国をタップしてデータを確かめたり、「同じ問題でもう一度」で同じ10問に再挑戦したりできる
・知識がなくても勘で勝てる。外れた分だけ国旗と世界を覚える
・日本語と英語を切り替えられる

チャットは不適切な表現・URL・連絡先を自動で除外し、相手のミュート・通報もできます。アカウント登録は不要で、広告もありません。

### このバージョンの最新情報（1.1）
・アプリのアイコンから黒い枠をなくしました
・「ひとりで国旗クイズ」を追加しました（国旗モード・国名モード、10問・4択。終わったら、まちがえた国を見直したり、「同じ問題でもう一度」で同じ10問に再挑戦したりできます）
・友だちの部屋の名前を入力するだけで参加できるようになりました（招待リンクもこれまでどおり使えます）
・英語の表示に対応しました（トップ画面のロゴの隣のボタンで日本語と英語を切り替え）
・別のアプリに少し切り替えて戻っても、同じ部屋で続けて遊べるようにしました
・ダークモードの文字や、結果画面・公開中の部屋の一覧を見やすくしました

### キーワード（100字まで、カンマ区切り）
国旗,地理,クイズ,パーティー,カードゲーム,世界,地図,対戦,オンライン,トリビア,教育,勉強,図鑑,雑学,友達,ひとり,国名,暗記,ランキング

### サポートURL
https://github.com/yukaalive/geoking/issues

### マーケティングURL（任意）
https://geoking-vlgh.onrender.com

### 著作権
2026 yukaalive

### バージョン
1.1（ビルド 7。1.0 はビルド 5 で公開＝アイコンに黒い枠あり）

## 5. App Review に関する情報
- サインインが必要: **いいえ**
- 連絡先情報: 氏名・電話番号・メールアドレス（審査担当者からの連絡用。公開されない）
- メモ（英語。そのまま貼り付け）:

```
GeoKing (地理王) is a party trivia card game about country flags. No account, sign-in or purchase is required.
The game server is https://geoking-vlgh.onrender.com (free hosting: after it has been idle, the first launch may take up to 60 seconds to load). If a Japanese screen 「接続できませんでした」 (Could not connect) appears while the server wakes up, please wait: it retries by itself after 15 seconds, or tap 「再読み込み」 (Reload).

Language: the app follows the device language. To switch between English and Japanese, tap the small language button next to the 地理王 logo on the home screen (it reads "EN" while in Japanese and "日本語" while in English). Labels below are given as Japanese (English).

How to test alone (1-2 minutes):
1. Enter any nickname in 「あなたの名前（必須）」 (Your name (required)) and tap 「部屋を作る」 (Create room).
2. In the lobby, tap 「botとゲーム開始」 (Start with a bot). One AI player joins and the game starts. Alternatively, tap 「ボットを追加」 (Add bot) one or more times before starting; the start button then reads 「ゲーム開始（7ラウンド）」 (Start game (7 rounds)).
3. Each round shows a prompt such as 「面積が大きい国は？」 (Which country has the largest area?). Tap one of your flag cards (8 at the start), then tap the same card again to play it. Each round has a 30-second limit; if time runs out, a random card is played.
4. When everyone has played, the cards are revealed with each country's value and world rank. The closest card scores 1 point (ties all score), and the next round starts automatically after 8 seconds. After 7 rounds the final results screen shows the winner.
To stop early, tap 「退出」 (Leave) at the top left. The host can also tap 「ロビーへ」 (Lobby) to stop the game and return to the lobby (scores are reset). Both buttons ask for confirmation.

Single-player features on the home screen:
- 「図鑑で学ぶ」 (Study mode): all 197 flags with search, rankings for each prompt, and a country sheet with data, world rank and a world map. Tap 「対戦へ戻る」 (Back to game) to return.
- 「ひとりで国旗クイズ」 (Solo flag quiz): 10 questions with 4 choices each (Flag mode / Name mode).

Playing with others (optional): in the lobby, tap the share icon at the top right to send an invite link with the iOS share sheet. On a second device, either open the link (it opens in Safari; enter a nickname and tap 「参加する」 (Join)), or in the app enter a nickname, type the room name shown in bold in the lobby (by default the host's nickname; a number is added if that name is already taken) into 「友だちの部屋の名前」 (Friend's room name) on the home screen, and tap 「参加する」 (Join). The shared message also shows a 4-letter room code; typing that code instead of the room name also works.

User-generated content: chat messages, nicknames and room names are filtered on the server (profanity, URLs and contact info are blocked). Mute and Report work on other human players only (not on bots), so they need the second device described above: tap the other player's name in the chat, or in the score list during a game, then choose 「ミュートする」 (Mute), or 「通報する」 (Report) and a reason. A player reported by two different people can no longer chat in that room, and reports are logged for the developer to review. The host can also remove a player from the lobby with the 「退出」 (Remove) button next to their name.

Native features: haptic feedback (on/off with the sound button at the top right), the iOS share sheet for invite links, and an offline screen (in Japanese, with a reload button; it retries automatically) if the server cannot be reached when the app opens.
```

## 6. 提出
- 「審査に提出」→ 広告識別子（IDFA）の質問は **「いいえ」**
- 審査は通常 24〜48 時間。結果はメールで届く

## 7. 新しい版を出す手順（1.1、2026-09-26）
アイコン（黒い枠なし）・スクリーンショット・概要を変えるには、新しい版を出して審査を受ける。プロモーション用テキストと「App のプライバシー」は審査なしでいつでも変えられる。

### A. アプリをアップロードする（Xcode、5分＋待ち時間）
1. Xcode を開く → 上のメニュー「Window」→「Organizer」
2. 左の「Archives」→「地理王」→ 一覧から **「地理王 1.1 (7)」**（2026/09/26）を選ぶ
   - アーカイブは `~/Library/Developer/Xcode/Archives/2026-09-26/地理王 1.1 (7).xcarchive`（作り方: `mobile/` で `bash build_www.sh` → `npx cap copy ios` → `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath <上の場所> CODE_SIGNING_ALLOWED=NO archive`）
3. 右の「Distribute App」→「App Store Connect」→「Distribute」（途中で聞かれることは、そのまま「Next」でよい）
4. 「Uploaded」と出たら完了。App Store Connect の「TestFlight」に 1.1 (7) が出るまで 10〜30分かかる（「処理中」の間は選べない）

### B. App Store Connect で新しい版を作る（15分）
1. App Store Connect →「アプリ」→ 地理王 → 左の「iOS アプリ」の横の「＋」（「バージョンまたはプラットフォームを追加」）→「iOS」→ バージョン「1.1」→「作成」
2. 「プレビューとスクリーンショット」: 前の版の画像が入っているので、6.9インチ（または6.5インチ）の欄の4枚を消し、新しい6枚（4 の「スクリーンショット」）を 1 → 6 の順にドラッグ
3. 「プロモーション用テキスト」「概要」「キーワード」「このバージョンの最新情報」に、4 の文をそのまま貼る
4. 「ビルド」の「＋」→ **1.1 (7)** を選ぶ → 完了（暗号化の質問は、アプリの設定で「使っていない」にしてあるので出ない）
5. 下の「App Review に関する情報」の「メモ」を、5 の英文に貼り替える
6. 右上「保存」→「審査用に追加」→「審査へ提出」
7. 審査は通常 24〜48 時間。通ると公開される（「このバージョンのリリース」を「自動」にしている場合）

### 提出の前に
- 地理王のサイトを一度開いてサーバーを起こしておく（審査の人が開いたときに1分待たされないように）
- スプレッドシートへの記録（docs/sheet-log/）を始めるなら、その前に 3 の「App のプライバシー」も直す（審査なし）
