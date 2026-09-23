"""録画 raw.mp4 から宣伝用ショート動画（1080x1920, 30fps）を組み立てる。"""
import subprocess, os, imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()
F_HEAD = 'fonts/DelaGothicOne-Regular.ttf'; F_BODY = 'fonts/MPLUS1p-Black.ttf'
BG = '0xf7f1df'; INK = '0x1c2b22'; GREEN = '0x1f6f4a'; ACCENT = '0xf4c542'
W, H, BAND = 1080, 1920, 170
os.makedirs('seg', exist_ok=True)
def tf(name, text):
    p = f'seg/{name}.txt'; open(p, 'w').write(text); return p
def run(args):
    subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)
ENC = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-preset', 'medium', '-crf', '20', '-an']

# ---- ゲーム画面の区間: (開始, 終了, 見出し, 速度)
SEGS = [
 (6.5, 9.5,   '名前を入れて\n部屋を作る', 1.0),
 (24.0, 30.0, '友だちが入室！\nチャットが画面を流れる', 1.0),
 (55.0, 58.5, 'ひとりならボットを追加\nゲームスタート', 1.0),
 (72.5, 84.0, 'お題に合う国旗を勘で1枚！\nめくって答え合わせ', 1.0),
 (126.5, 138.0, '世界順位で\n金・銀・銅バッジ！', 1.0),
 (229.0, 256.0, '7ラウンドで一番勝った人が\n地理王！', 1.7),
]
parts = []
for i, (s, e, cap, speed) in enumerate(SEGS):
    out = f'seg/s{i}.mp4'
    # 端末のステータスバー(上120px)を切り、高さ1750に縮小して中央に置く。上に見出し帯
    vf = (f"crop=1206:2457:0:165,scale=-2:{H-BAND}," 
          f"pad={W}:{H}:(ow-iw)/2:{BAND}:color={BG},"
          f"drawbox=0:0:{W}:{BAND}:color={GREEN}:t=fill,"
          f"drawtext=fontfile={F_BODY}:textfile={tf('c'+str(i), cap)}:fontcolor=white:fontsize=52:line_spacing=10:text_align=C:x=(w-text_w)/2:y=({BAND}-text_h)/2,"
          f"setpts=PTS/{speed}")
    run(['-ss', str(s), '-to', str(e), '-i', 'raw.mp4', '-vf', vf, *ENC, out]); parts.append(out)

# ---- タイトルカード
def card(name, dur, lines):
    vf = ''.join(lines)
    run(['-f', 'lavfi', '-i', f'color=c={BG}:s={W}x{H}:d={dur}:r=30', '-vf', vf.rstrip(','), *ENC, f'seg/{name}.mp4'])
    return f'seg/{name}.mp4'
intro = card('intro', 4.0, [
    f"drawbox=0:0:{W}:{H}:color={BG}:t=fill,",
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
open('seg/list.txt', 'w').write(''.join(f"file '{os.path.abspath(p)}'\n" for p in [intro, *parts, outro]))
run(['-f', 'concat', '-safe', '0', '-i', 'seg/list.txt', '-c', 'copy', '-movflags', '+faststart', 'geoking_promo.mp4'])
print('done')
