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

## 4. 1.0 提出の準備（バージョン情報）
### スクリーンショット
- iPhone 6.5インチの欄: `docs/store-assets/promo/appstore65-1.png` 〜 `appstore65-4.png`（1284×2778）をこの順で
- 6.9インチの欄がある場合: `appstore69-1.png` 〜 `appstore69-4.png`（1320×2868）。6.7インチ（1290×2796）は `appstore-1..4.png`
- iPad は対象外（ビルド2以降は iPhone のみ）

### プロモーション用テキスト（170字まで）
国旗だけを見て「面積が大きい国は？」「気温が高い国は？」に答える、みんなで遊べる地理カードゲーム。知識がなくても勘で勝てる。

### 概要
国旗カードを8枚配られ、「面積が大きい国は？」「年平均気温が高い国は？」「イスラム教徒の割合が高い国は？」といったお題に、裏面のデータを見ずに一番合いそうな国旗を出します。めくって、最もお題に近い人が1点。7ラウンドで一番多く取った人が「地理王」。

- 197の国と地域の国旗と、面積・人口・GDP・気温・降水量・宗教・寿命など約30種のデータ
- 友だちと部屋コードで対戦。公開部屋で世界の誰かとも
- 途中入室は観戦モード。誰がどのカードを選んでいるかがリアルタイムで見える
- 国旗をタップすると国のデータと世界地図上の位置を表示
- 知識がなくても勘で勝てる。外れた分だけ国旗と世界を覚える
- ひとりで遊ぶときはボットを追加

チャットは不適切な表現・URL・連絡先を自動で除外し、相手のミュート・通報もできます。

### キーワード（100字まで、カンマ区切り）
国旗,地理,クイズ,パーティー,カードゲーム,世界,国,対戦,オンライン,トリビア,教育,勉強

### サポートURL
https://github.com/yukaalive/geoking/issues

### マーケティングURL（任意）
https://geoking-vlgh.onrender.com

### 著作権
2026 yukaalive

### バージョン
1.0

### ビルド
「＋」から処理済みの最新ビルド（1.0 (2)）を選択

## 5. App Review に関する情報
- サインインが必要: **いいえ**
- 連絡先情報: 氏名・電話番号・メールアドレス（審査担当者からの連絡用。公開されない）
- メモ（英語推奨、そのまま貼り付け可）:

```
GeoKing (地理王) is a party trivia card game about country flags.
How to test: enter any nickname, tap "部屋を作る" (Create room), tap "ボットを追加" (Add bot) to add an AI player,
then tap "ゲーム開始" (Start). Each round shows a prompt such as "Which country has the larger area?";
tap a flag card twice to play it. Cards are revealed automatically and the round advances after 5 seconds.
No account or purchase is required. The chat is text-filtered on the server (profanity, URLs, contact info are blocked),
and players can mute or report each other from the score list.
The game server is https://geoking-vlgh.onrender.com (may take up to 60 seconds to wake on first request).
```

## 6. 提出
- 「審査に提出」→ 広告識別子（IDFA）の質問は **「いいえ」**
- 審査は通常 24〜48 時間。結果はメールで届く
