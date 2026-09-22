# GeoKing 地理王 — 国旗王インスパイアのオンライン対戦ゲーム

**公開URL: https://geoking-vlgh.onrender.com**

国旗カードを手札にして、「面積が大きい国は？」「年平均気温が高い国は？」「イスラム教徒の割合が高い国は？」といった
お題に**裏面のデータを見ずに**一番合いそうな国旗を出し、裏返して勝負するパーティーゲームのオンライン版です。

## 遊び方
1. `python3 server.py` を起動し `http://localhost:8080` を開く
2. 名前を入れて「部屋を作る」→ 4文字の部屋コードか招待リンクを友だちに共有（同じLAN/公開サーバー上で）
3. ホストが部屋の名前と公開/非公開を設定（ラウンド数7・手札8枚・全カテゴリは固定。変更はサーバー側の DEFAULT_SETTINGS で可能）
4. 各ラウンド全員が同時に1枚選ぶ → 全員出そろったら一斉に公開 → 最もお題に合った人に1点（同値は全員1点）→ 5秒後に自動で次のラウンドへ
5. 規定ラウンド終了で最多得点者が「地理王」

ひとりで試す場合はロビーで「ボットを追加」（ボットはランダムに出します）。

- ホストは「部屋の名前」を付けられます（公開部屋一覧やヘッダーに表示）
- ゲーム開始後でも途中参加できます。途中参加者には残りラウンド数＋1枚が配られます
- 画面右上の「退出」でいつでも部屋を抜けられます。ホストが抜けると次の人がホストになります
- 公開後のカードには正式名称（例：スペイン王国、朝鮮民主主義人民共和国）を表示します

## テスト
```bash
python3 tests/e2e_two_players.py                                   # ローカル
GEOKING_WS=wss://geoking-vlgh.onrender.com/ws python3 tests/e2e_two_players.py  # 本番
```

## セットアップ
```bash
pip install aiohttp
python3 data/build_data.py   # データ更新時のみ（World Bank APIから再取得したraw JSONが必要）
python3 server.py            # PORT環境変数で変更可
```

## 公開（Render 無料プラン）
1. GitHub にリポジトリを作り、このフォルダを push する
2. https://render.com にログイン → New → **Blueprint** → リポジトリを選ぶ（`render.yaml` を自動で読みます）
   （または New → Web Service → Runtime: Python, Build: `pip install -r requirements.txt`, Start: `python3 server.py`）
3. 数分で `https://geoking-xxxx.onrender.com` が発行される。これが世界中の人と遊べるURL
- 無料プランは15分アクセスが無いとスリープし、次の初回アクセスに30〜60秒かかります
- 部屋はメモリ上にあるため、再デプロイ・スリープで消えます（ゲーム中でなければ問題なし）
- Fly.io なら `fly launch` （`fly.toml` 同梱）、Docker 環境なら `Dockerfile` が使えます

## 構成
- `server.py` — aiohttp サーバー。部屋管理・進行・WebSocket配信
- `prompts.py` — お題定義（カテゴリ、比較するフィールド、max/min、難易度★）。ここに1行足せばお題が増えます
- `data/build_data.py` — mledoze/countries + World Bank API + 手動データを `data/countries.json` に統合
- `data/manual_data.py` — 年平均気温・宗教構成の手動データ（概算、要検証）
- `static/` — クライアント（vanilla JS）

## データの注意
- 面積・地理: mledoze/countries（REST Countries のソース）
- 人口・GDP・寿命・降水量・森林率など: World Bank Open Data API（各指標の最新年）
- 宗教構成: Pew Research Center を参考にした概算値。年平均気温: Wikipedia 等を参考にした概算値
- バチカン・クック諸島・ニウエ・北朝鮮の一部指標は推定値で補完
- **公開前に `data/manual_data.py` の数値を一次資料で確認してください**

## 国旗王との違い
| | 国旗王（原作） | GeoKing |
|---|---|---|
| お題 | 面積・人口・GDP・正式名称・南北・軍事費など | 原作系＋気候・宗教・社会の4カテゴリ28種 |
| カード | 197カ国の物理カード | 同じ197カ国（国連193＋バチカン・コソボ・クック諸島・ニウエ） |
| 判定 | 裏面を見て手動で比較 | 自動判定・順位表示・全データ閲覧 |
| 人数 | 2〜8人 | 2〜8人（ボット可）＋オンライン再接続 |
