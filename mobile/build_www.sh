#!/bin/bash
# Web クライアント（../static）をアプリ同梱用の www/ にまとめる。対戦は本番サーバーに接続する。
set -e
cd "$(dirname "$0")"
SERVER="${GEOKING_SERVER:-https://geoking-vlgh.onrender.com}"
rm -rf www && mkdir -p www/static
cp -R ../static/. www/static/
# index.html をルートに置き、サーバーURLとネイティブ連携スクリプトを埋め込む
python3 - "$SERVER" <<'PY'
import sys, re
server = sys.argv[1]
s = open('www/static/index.html', encoding='utf-8').read()
s = s.replace('<link rel="manifest" href="/manifest.json">', '')
s = s.replace('initial-scale=1, viewport-fit=cover', 'initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover')
s = s.replace('<script src="/static/app.js"></script>',
              f'<script>window.GEOKING_SERVER = "{server}";</script>\n<script src="/static/app.js"></script>\n<script src="/static/native.js"></script>')
s = re.sub(r'<script>if \("serviceWorker" in navigator\).*?</script>', '', s, flags=re.S)   # アプリ版では Service Worker 不要
open('www/index.html', 'w', encoding='utf-8').write(s)
PY
cat > www/offline.html <<'HTML'
<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>地理王</title><link rel="stylesheet" href="/static/style.css"></head>
<body><main style="max-width:520px;margin:40px auto;padding:16px"><div class="card" style="text-align:center">
<h1>接続できませんでした</h1><p class="muted">サーバーの起動に少し時間がかかることがあります（最大1分）。もう一度お試しください。</p>
<button class="primary big" onclick="location.replace('https://geoking-vlgh.onrender.com/static/index.html')">再読み込み</button></div></main>
<script src="/static/native.js"></script>
<script>setTimeout(function(){ location.replace('https://geoking-vlgh.onrender.com/static/index.html'); }, 15000);</script></body></html>
HTML
echo "www/ を生成しました（アプリは本番 $SERVER を表示。www は接続失敗時の案内のみ）"
