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
s = s.replace('<script src="/static/app.js"></script>',
              f'<script>window.GEOKING_SERVER = "{server}";</script>\n<script src="/static/app.js"></script>\n<script src="/static/native.js"></script>')
s = re.sub(r'<script>if \("serviceWorker" in navigator\).*?</script>', '', s, flags=re.S)   # アプリ版では Service Worker 不要
open('www/index.html', 'w', encoding='utf-8').write(s)
PY
echo "www/ を生成しました（サーバー: $SERVER）"
