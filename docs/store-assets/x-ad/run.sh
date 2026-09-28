#!/bin/bash
# X 広告用の動画（音なし。6・10・15・30秒 × 4:5 と 9:16 の8本）を作り直す。先に確認用サーバー（geoking-check, 8090番）を立てておく。
# 本物の画面（http://localhost:8090）を、ヘッドレス Chrome でスマホの大きさにして、場面の台本（v_*.js）どおりに動かして撮る。
# 字幕は captions.json、長さごとの場面の並びと長さは compose.py の VARIANTS。できた動画は ../promo/geoking_x_ad_{6,10,15,30}s_{4x5,9x16}.mp4（と _thumb.png）
# 2026-09-28 から音（ナレーション・BGM・効果音）はなし。前の声つき15秒の作り方は git の履歴にある（make_voice.py は今は使わない）
set -e
cd "$(dirname "$0")"
python3 make_assets.py   # 字幕の帯とスマホの枠の絵
for L in 45 916; do
  if [ $L = 45 ]; then VH=631; OW=680; else VH=699; OW=820; fi
  for s in pick reveal prompts end lobby battle modesel battle_end; do cat common_state.js v_$s.js > vs_$s.js; REC_PRE="window.AD_BAND=0" REC_OUTW=$OW python3 rec.py ${L}_$s http://localhost:8090/static/index.html vs_$s.js 390 $VH; done
  cp v_home.js vs_home.js; REC_PRE="window.AD_BAND=0" REC_OUTW=$OW python3 rec.py ${L}_home http://localhost:8090/static/index.html vs_home.js 390 $VH
  cp v_quiz.js vs_quiz.js; REC_PRE="window.AD_BAND=0" REC_OUTW=$OW python3 rec.py ${L}_quiz http://localhost:8090/static/quiz.html vs_quiz.js 390 $VH
done
for V in 6 10 15 30; do
  python3 compose.py 45 $V ../promo/geoking_x_ad_${V}s_4x5.mp4
  python3 compose.py 916 $V ../promo/geoking_x_ad_${V}s_9x16.mp4
done
