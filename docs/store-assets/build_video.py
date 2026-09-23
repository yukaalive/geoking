"""宣伝用ショート動画（1080x1920, 30fps）を録画から組み立てる。
手順:
 1. iPhone シミュレーターで `xcrun simctl io <UDID> recordVideo --codec h264 raw.mp4` を回しながら1ゲーム遊ぶ
    （2人目は video_player2.py <部屋コード> を別ターミナルで動かすとチャットや選択をしてくれる）。
    図鑑は zukan.mp4 / rank.mp4 として別に録る（Safari で開くと下にURLバーが出るので bottom_crop で切る）
 2. fonts/ に DelaGothicOne-Regular.ttf と MPLUS1p-Black.ttf（Google Fonts, OFL）を置く
 3. python3 -m pip install imageio-ffmpeg → 録画と同じフォルダで実行。seg/timeline.json を出すので build_audio.py が読む
 4. SEGS の秒数は録画ごとに変わるので、`ffmpeg -i raw.mp4 -vf "fps=1/2,scale=110:-1,tile=16x8" sheet.png` で見て合わせる
"""
import subprocess, os, json, re, imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()
F_HEAD = 'fonts/DelaGothicOne-Regular.ttf'; F_BODY = 'fonts/MPLUS1p-Black.ttf'
BG = '0xf7f1df'; INK = '0x1c2b22'; GREEN = '0x1f6f4a'; ACCENT = '0xf4c542'
W, H, BAND = 1080, 1920, 170
os.makedirs('seg', exist_ok=True)
def tf(name, text):
    p = f'seg/{name}.txt'; open(p, 'w').write(text); return p
def run(args):
    subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)
def dur(path):
    out = subprocess.run([FF, '-hide_banner', '-i', path], capture_output=True, text=True).stderr
    h, m, s = re.search(r'Duration: (\d+):(\d+):([\d.]+)', out).groups(); return int(h) * 3600 + int(m) * 60 + float(s)
ENC = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-preset', 'medium', '-crf', '20', '-an']

# 録画は画面が変わった時だけコマを記録する（可変フレームレート）ので、まず 30fps 固定の中間ファイルに変換してから切る
def cfr(src):
    out = src.replace('.mp4', '_30.mp4')
    if not os.path.exists(out):
        run(['-i', src, '-vf', 'fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '18', '-an', out])
    return out

# ---- ゲーム画面の区間: dict(name, src, s, e, cap, speed, bcrop, hand=[(秒,x,y)...], taps=[秒...])
# 手カーソル用: 元画面(1206x2622)の座標 → 出力座標。カード中心（ラウンド4の手札の並び）
def P(xr, yr): return (round(110.5 + xr * 0.7122), round(170 + (yr - 165) * 0.7122))
VN, HU, LB, SS = P(315, 1546), P(891, 1546), P(315, 2058), P(891, 2058)
CAP3 = 'お題に合う国旗を勘で1枚！\n答え合わせ'
CAPZ = '図鑑モード\n197の国旗とお題別ランキング'
SEGS = [
 dict(name='s0', src='raw.mp4', s=6.5, e=9.5, cap='名前を入れて\n部屋を作る'),
 dict(name='s1', src='raw.mp4', s=24.0, e=30.0, cap='友だちが入室！\nチャットが画面を流れる'),
 dict(name='s2', src='raw.mp4', s=54.3, e=55.9, cap='ひとりならボットを追加\nゲームスタート'),
 dict(name='s3a', src='raw.mp4', s=140.5, e=147.0, cap=CAP3,
      hand=[(0.4, *VN), (1.3, *VN), (2.2, *HU), (3.0, *HU), (3.9, *LB), (4.6, *LB), (5.4, *SS), (6.5, *SS)]),
 dict(name='s3b', src='raw.mp4', s=148.8, e=158.0, cap=CAP3,
      hand=[(0.0, *SS), (0.7, *SS), (1.4, SS[0] + 18, SS[1] + 14), (2.1, *SS), (2.7, *SS)], taps=[0.6, 2.1]),
 dict(name='s5a', src='raw.mp4', s=232.3, e=235.3, cap='7ラウンドで一番勝った人が\n地理王！'),
 dict(name='s5b', src='raw.mp4', s=250.0, e=255.5, cap='7ラウンドで一番勝った人が\n地理王！', speed=1.5),
 dict(name='z1', src='zukan.mp4', s=77.3, e=81.0, cap=CAPZ, bcrop=250),
 dict(name='z2', src='zukan.mp4', s=91.3, e=94.3, cap=CAPZ, bcrop=250),
 dict(name='z3', src='zukan.mp4', s=105.0, e=109.5, cap=CAPZ, bcrop=250),
 dict(name='z4', src='rank.mp4', s=18.5, e=24.5, cap=CAPZ, speed=1.2, bcrop=250),
]
def lerp_expr(keys, idx):
    """キーフレーム [(t,x,y)] を t で線形補間する ffmpeg 式（idx=1:x, 2:y）"""
    expr = str(keys[-1][idx])
    for (t0, *a), (t1, *b) in reversed(list(zip(keys, keys[1:]))):
        expr = f"if(lt(t,{t1}),{a[idx-1]}+({b[idx-1]}-{a[idx-1]})*(t-{t0})/({t1}-{t0}),{expr})"
    return expr
HAND_SCALE = 1.0; HAND_TIP = (110, 12)   # hand.png(260px, Chrome headless で SVG→透過PNG) の指先の位置
parts = []
for g in SEGS:
    name, src, s, e, cap = g['name'], g['src'], g['s'], g['e'], g['cap']
    speed, bcrop = g.get('speed', 1.0), g.get('bcrop', 0)
    out = f'seg/{name}.mp4'
    ch = 2622 - 165 - bcrop
    # 端末のステータスバー(上165px)を切り、高さ1750に縮小して中央に置く。上に見出し帯
    main = (f"[0:v]setpts=(PTS-STARTPTS)/{speed},fps=30,crop=1206:{ch}:0:165,scale=-2:{H-BAND},"
            f"pad={W}:{H}:(ow-iw)/2:{BAND}:color={BG},"
            f"drawbox=0:0:{W}:{BAND}:color={GREEN}:t=fill,"
            f"drawtext=fontfile={F_BODY}:textfile={tf('c_'+name, cap)}:fontcolor=white:fontsize=52:line_spacing=10:text_align=C:x=(w-text_w)/2:y=({BAND}-text_h)/2[m]")
    inputs = ['-ss', str(s), '-t', str(e - s), '-i', cfr(src)]
    chain = [main]; last = 'm'
    if g.get('hand'):
        keys = g['hand']; inputs += ['-i', 'hand.png']
        chain.append(f"[1:v]scale=iw*{HAND_SCALE}:-1[hd]")
        chain.append(f"[{last}][hd]overlay=eval=frame:x='{lerp_expr(keys, 1)}-{HAND_TIP[0]}':y='{lerp_expr(keys, 2)}-{HAND_TIP[1]}':enable='between(t,{keys[0][0]},{keys[-1][0]})'[h]"); last = 'h'
        for i, tp in enumerate(g.get('taps', [])):
            inputs += ['-i', 'ring.png']
            x, y = [k for k in keys if k[0] <= tp][-1][1:]
            chain.append(f"[{last}][{2 + i}:v]overlay=x={x - 140}:y={y - 140}:enable='between(t,{tp},{tp + 0.3})'[r{i}]"); last = f'r{i}'
    run([*inputs, '-filter_complex', ';'.join(chain), '-map', f'[{last}]', *ENC, out]); parts.append((name, out))

# ---- タイトルカード
def card(name, d, lines):
    run(['-f', 'lavfi', '-i', f'color=c={BG}:s={W}x{H}:d={d}:r=30', '-vf', ''.join(lines).rstrip(','), *ENC, f'seg/{name}.mp4'])
    return (name, f'seg/{name}.mp4')
intro = card('intro', 4.0, [
    f"drawtext=fontfile={F_HEAD}:text='地理王':fontcolor={INK}:fontsize=230:x=(w-text_w)/2:y=560,",
    f"drawbox=0:850:{W}:8:color={INK}:t=fill,",
    f"drawtext=fontfile={F_BODY}:text='国旗から、どんな国かを推測せよ！':fontcolor={GREEN}:fontsize=64:x=(w-text_w)/2:y=920,",
    f"drawtext=fontfile={F_BODY}:text='みんなで遊べる 地理カードゲーム':fontcolor={INK}:fontsize=52:x=(w-text_w)/2:y=1040,",
    f"drawbox=140:1230:800:130:color={ACCENT}:t=fill,drawbox=140:1230:800:130:color={INK}:t=6,",
    f"drawtext=fontfile={F_BODY}:text='登録不要・無料・ブラウザですぐ':fontcolor={INK}:fontsize=50:x=(w-text_w)/2:y=1268,",
])
outro = card('outro', 4.5, [
    f"drawtext=fontfile={F_HEAD}:text='地理王':fontcolor={INK}:fontsize=170:x=(w-text_w)/2:y=520,",
    f"drawtext=fontfile={F_BODY}:text='友だちと部屋コードで対戦':fontcolor={GREEN}:fontsize=60:x=(w-text_w)/2:y=780,",
    f"drawtext=fontfile={F_BODY}:text='国旗をタップすると国のデータと地図':fontcolor={INK}:fontsize=48:x=(w-text_w)/2:y=880,",
    f"drawbox=90:1080:900:150:color={INK}:t=fill,",
    f"drawtext=fontfile={F_BODY}:text='geoking-vlgh.onrender.com':fontcolor=white:fontsize=58:x=(w-text_w)/2:y=1124,",
    f"drawtext=fontfile={F_BODY}:text='検索してもOK： 地理王 国旗':fontcolor={INK}:fontsize=44:x=(w-text_w)/2:y=1290,",
])
order = [intro, *parts, outro]
open('seg/list.txt', 'w').write(''.join(f"file '{os.path.abspath(p)}'\n" for _, p in order))
run(['-f', 'concat', '-safe', '0', '-i', 'seg/list.txt', '-c', 'copy', '-movflags', '+faststart', 'geoking_promo.mp4'])
# 音付け用のタイムライン（各区間の開始秒と長さ）
t = 0.0; timeline = {}
for name, p in order:
    d = dur(p); timeline[name] = [round(t, 3), round(d, 3)]; t += d
json.dump(timeline, open('seg/timeline.json', 'w'), ensure_ascii=False, indent=1)
print('done', {k: v[0] for k, v in timeline.items()}, 'total', round(t, 2))
