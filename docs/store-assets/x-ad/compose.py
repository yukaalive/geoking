"""場面を決めた長さに切ってつなぎ、スマホの枠と字幕の帯・BGM・効果音を付けて、広告用の動画にする。
python3 compose.py 45|916 6|10|15|30 出力.mp4   （45 = 4:5 の 1080×1350、916 = 9:16 の 1080×1920）
2026-09-28: 音は BGM と効果音（前と同じ曲・同じ混ぜ方）。ナレーションはなし。長さは 6・10・15・30 秒の4つ。バトル（体力を減らし合うゲーム）の場面を足した"""
import json, os, subprocess, sys, wave
import numpy as np, imageio_ffmpeg
H = os.path.dirname(os.path.abspath(__file__)); FF = imageio_ffmpeg.get_ffmpeg_exe(); SR = 48000
BGM = os.path.join(os.path.dirname(H), 'bgm_chiisana_synth_no_niwa.mp3')   # 前の広告と同じ曲
# 効果音: アプリ（static/sfx.js）と同じ音を作る部分を build_audio.py から借りる（tone・noise・SFX）
exec(open(os.path.join(os.path.dirname(H), 'build_audio.py')).read().split('# ---------- タイムライン')[0].split('import numpy')[1].split('\n', 1)[1].replace('SR = 44100', ''))
def saw(buf, at, f, t, d, v, slide):   # のこぎり波（build_audio.py の tone にはないので。sfx.js の ko で使う）
    n = int(d * SR); tt = np.arange(n) / SR; freq = f * (slide / f) ** (tt / d)
    w = 2 * ((np.cumsum(freq) / SR) % 1) - 1; a = int(0.01 * SR)
    env = np.concatenate([np.geomspace(1e-4, v, max(a, 1)), np.geomspace(v, 1e-4, max(n - a, 1))])[:n]
    st = int((at + t) * SR); e = min(st + n, len(buf)); buf[st:e] += (w * env)[:e - st]
def hit(n):   # sfx.js の hit(n): ダメージ（大きいほど低く強い「ドン」）
    v = min(.32, .12 + n * .035)
    return lambda b, a: (noise(b, a, 0, .18, v, 520, .8, 150), tone(b, a, 'square', 190 - n * 14, 0, .16, v * .45, 60))
SFX.update({   # バトルの答え合わせ（sfx.js の power・hit・ko と同じ）
    'power': lambda b, a: (tone(b, a, 'triangle', 392, 0, .14, .14, 784), [tone(b, a, 'triangle', f, .1 + i * .06, .24, .15) for i, f in enumerate([784, 988, 1319])],
                           noise(b, a, .05, .3, .05, 5000, .7, 9000)),
    'hit2': hit(2), 'hit4': hit(4), 'hit6': hit(6),
    'ko': lambda b, a: (noise(b, a, 0, .55, .2, 900, .6, 110), saw(b, a, 320, 0, .55, .09, 55), tone(b, a, 'square', 110, .08, .4, .06, 50)),
})
LAY, VAR, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
L = json.load(open(os.path.join(H, 'assets', 'layouts.json')))[LAY]
# 長さごとの場面: (場面, 録画の何秒目から, 何秒使うか, 字幕)。録画の頭の 0.2〜0.25 秒は、録り始めてから台本が動くまでの間
VARIANTS = {
    '6':  [('pick', 1.00, 2.20, 'pick'), ('reveal', 0.24, 2.10, 'reveal'), ('home', 0.90, 1.70, 'home')],
    '10': [('pick', 0.60, 2.60, 'pick'), ('reveal', 0.24, 2.40, 'reveal'), ('battle', 0.95, 2.70, 'battle'), ('home', 0.55, 2.30, 'home')],
    '15': [('pick', 0.24, 3.00, 'pick'), ('reveal', 0.24, 2.80, 'reveal'), ('battle', 0.60, 3.10, 'battle'), ('prompts', 0.24, 1.62, 'prompts'),
           ('lobby', 0.30, 2.28, 'lobby'), ('home', 0.25, 2.20, 'home')],
    '30': [('pick', 0.24, 3.08, 'pick'), ('reveal', 0.24, 3.40, 'reveal'), ('prompts', 0.24, 1.62, 'prompts'), ('end', 0.20, 2.60, 'end'),
           ('modesel', 0.25, 2.80, 'modesel'), ('battle', 0.24, 4.00, 'battle'), ('battle_end', 0.20, 2.90, 'battle_end'),
           ('lobby', 0.25, 2.75, 'lobby'), ('quiz', 0.30, 3.60, 'quiz'), ('home', 0.25, 3.25, 'home')],
}
def run(a): subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', *a], check=True)
parts, t, bands, events = [], 0.0, [], []
os.makedirs(os.path.join(H, 'seg'), exist_ok=True)
for name, s, d, cap in VARIANTS[VAR]:
    src = os.path.join(H, 'clips', f'{LAY}_{name}.mp4'); out = os.path.join(H, 'seg', f'{LAY}_{VAR}_{name}.mp4')
    info = json.load(open(os.path.join(H, 'clips', f'{LAY}_{name}.events.json'))); have = info['duration']
    if s + d > have - 0.02:
        sys.exit(f'{LAY}_{name}: 録画が {have:.2f} 秒しかない（{s} + {d} 秒を使いたい）。台本の終わりの止めを長くして録り直す')
    run(['-ss', f'{s}', '-i', src, '-vf', 'setpts=PTS-STARTPTS,fps=30,format=yuv420p,tpad=stop_mode=clone:stop_duration=0.5', '-frames:v', str(round(d * 30)),
         '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-an', out])   # コマの数（30コマ/秒）で長さを決める。時刻で切ると1コマ足りないことがあり、字幕の切り替えがずれた
    events += [(n, t + max(0.0, at - s)) for n, at in info['events'] if s - 0.08 <= at < s + d]   # その場面で鳴る効果音（録画の時刻 → 動画の時刻）
    bands.append((cap, t, t + d)); parts.append(out); t += d
TOTAL = t
lst = os.path.join(H, 'seg', f'{LAY}_{VAR}_list.txt'); open(lst, 'w').write(''.join(f"file '{p}'\n" for p in parts))
app = os.path.join(H, 'seg', f'{LAY}_{VAR}_app.mp4')
run(['-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', app])
# 音: 効果音 ＋ BGM（前の広告と同じ混ぜ方）。BGM は曲の頭から、入りは0.3秒・終わりは1秒で小さく（くり返し再生で頭に戻っても急に変わらない）。全体の音量は -16 LUFS にそろえる
N = int(round(TOTAL * SR)); bgmwav = os.path.join(H, 'bgm48.wav')
if not os.path.exists(bgmwav): run(['-i', BGM, '-vn', '-ac', '1', '-ar', str(SR), bgmwav])
with wave.open(bgmwav) as w: bgm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
bgm = np.pad(bgm[:N], (0, max(0, N - len(bgm))))
fi, fo = int(0.3 * SR), int(1.0 * SR); bgm[:fi] *= np.linspace(0.15, 1, fi); bgm[-fo:] *= np.linspace(1, 0.15, fo)
sfx = np.zeros(N + SR)
for n, at in events:
    if n in SFX: SFX[n](sfx, at)
sfx = sfx[:N]
mix = np.tanh((sfx * 0.85 + bgm * 0.26) * 1.1) * 0.95
wav = os.path.join(H, 'seg', f'{LAY}_{VAR}_mix.wav'); wavn = os.path.join(H, 'seg', f'{LAY}_{VAR}_mix_n.wav')
with wave.open(wav, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
run(['-i', wav, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', str(SR), '-ac', '2', wavn])
# 絵: クリーム色の地 → スマホの画面 → 枠（角を丸く切る）→ 字幕の帯（場面ごと）
inputs = ['-f', 'lavfi', '-i', f"color=c=0xf7f1df:s={L['W']}x{L['H']}:r=30:d={TOTAL}", '-i', app, '-i', os.path.join(H, 'assets', f'frame_{LAY}.png')]
chain = [f"[0][1]overlay=x={L['ph_x']}:y={L['ph_y']}:shortest=1[a]", "[a][2]overlay=0:0[b]"]; last = 'b'
for i, (cap, a, b) in enumerate(bands):
    inputs += ['-i', os.path.join(H, 'assets', f'band_{LAY}_{cap}.png')]
    chain.append(f"[{last}][{3 + i}]overlay=0:{L['band_y']}:enable='between(t,{a:.3f},{b - 0.001:.3f})'[c{i}]"); last = f'c{i}'
run([*inputs, '-i', wavn, '-filter_complex', ';'.join(chain), '-map', f'[{last}]', '-map', f'{3 + len(bands)}:a',
     '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-crf', '19', '-maxrate', '8M', '-bufsize', '16M', '-preset', 'slow',
     '-c:a', 'aac', '-b:a', '128k', '-ar', str(SR), '-t', f'{TOTAL:.3f}', '-movflags', '+faststart', OUT])
# サムネイル（答え合わせの金のカード）
rv = next(b for b in bands if b[0] == 'reveal')
run(['-ss', f'{rv[1] + min(1.4, (rv[2] - rv[1]) * 0.6):.2f}', '-i', OUT, '-frames:v', '1', OUT.replace('.mp4', '_thumb.png')])
print('done', OUT, round(TOTAL, 2), 's', [(c, round(a, 2)) for c, a, _ in bands], 'sfx', [(n, round(a, 2)) for n, a in events if n in SFX])
