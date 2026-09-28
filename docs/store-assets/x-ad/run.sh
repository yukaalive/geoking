#!/bin/bash
# X 広告用の15秒動画（4:5 と 9:16）を作り直す。先に確認用サーバー（geoking-check, 8090番）を立てておく。
# 本物の画面（http://localhost:8090）を、ヘッドレス Chrome でスマホの大きさにして、場面の台本（v_*.js）どおりに動かして撮る。
# 字幕は captions.json、場面の長さは compose.py の SEG。できた動画は ../promo/geoking_x_ad_4x5.mp4 と geoking_x_ad_9x16.mp4
set -e
cd "$(dirname "$0")"
python3 make_assets.py   # 字幕の帯とスマホの枠の絵
for L in 45 916; do
  if [ $L = 45 ]; then VH=631; OW=680; else VH=699; OW=820; fi
  for s in pick reveal prompts end lobby; do cat common_state.js v_$s.js > vs_$s.js; REC_PRE="window.AD_BAND=0" REC_OUTW=$OW python3 rec.py ${L}_$s http://localhost:8090/static/index.html vs_$s.js 390 $VH; done
  cp v_home.js vs_home.js; REC_PRE="window.AD_BAND=0" REC_OUTW=$OW python3 rec.py ${L}_home http://localhost:8090/static/index.html vs_home.js 390 $VH
done
python3 compose.py 45 ../promo/geoking_x_ad_4x5.mp4
python3 compose.py 916 ../promo/geoking_x_ad_9x16.mp4
