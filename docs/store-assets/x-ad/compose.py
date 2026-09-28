"""場面を決めた長さに切ってつなぎ、スマホの枠・字幕の帯・BGM・効果音を付けて広告用の動画にする: python3 compose.py 45|916 出力.mp4"""
import json, os, re, subprocess, sys, wave
import numpy as np, imageio_ffmpeg
H = os.path.dirname(os.path.abspath(__file__)); FF = imageio_ffmpeg.get_ffmpeg_exe(); SR = 48000
ROOT = '/Users/yukaumezawa/Documents/geoking/docs/store-assets'
exec(open(os.path.join(ROOT, 'build_audio.py')).read().split('# ---------- タイムライン')[0].split('import numpy')[1].split('\n', 1)[1].replace('SR = 44100', ''))
LAY, OUT = sys.argv[1], sys.argv[2]
L = json.load(open(os.path.join(H, 'assets', 'layouts.json')))[LAY]
# 場面: (名前, 切り出す始まり, 終わり, 字幕)。0.24秒ほどは録画を始めてから台本が動くまでの間なので切る
SEG = [('pick', 0.24, 3.32, 'pick'), ('reveal', 0.24, 3.24, 'reveal'), ('prompts', 0.24, 1.88, 'prompts'),
       ('end', 0.20, 2.40, 'end'), ('lobby', 0.25, 3.00, 'lobby'), ('home', 0.25, 2.59, 'home')]
# ナレーション: 場面の名前 → (声のファイル, 場面の頭からの秒)。voice/lines.txt を make_voice.py で読み上げたもの
VOICE = {'pick': ('v1', 0.10), 'reveal': ('v2', 0.42), 'prompts': ('v3', 0.02), 'end': ('v4', 0.12), 'lobby': ('v5', 0.08), 'home': ('v6', 0.15)}
def run(a): subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', *a], check=True)
parts, t, events, bands, voices = [], 0.0, [], [], []
for name, s, e, cap in SEG:
    src = os.path.join(H, 'clips', f'{LAY}_{name}.mp4'); out = os.path.join(H, 'seg', f'{LAY}_{name}.mp4'); os.makedirs(os.path.dirname(out), exist_ok=True)
    run(['-ss', f'{s}', '-i', src, '-t', f'{e - s}', '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-an', out])
    info = json.load(open(os.path.join(H, 'clips', f'{LAY}_{name}.events.json')))
    events += [(n, t + max(0.0, at - s)) for n, at in info['events'] if s - 0.08 <= at < e]
    if name in VOICE: voices.append((VOICE[name][0], t + VOICE[name][1]))
    bands.append((cap, t, t + (e - s))); parts.append(out); t += e - s
TOTAL = t
lst = os.path.join(H, 'seg', f'{LAY}_list.txt'); open(lst, 'w').write(''.join(f"file '{p}'\n" for p in parts))
app = os.path.join(H, 'seg', f'{LAY}_app.mp4')
run(['-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', app])
# 音: 効果音（アプリと同じ）＋ BGM。入りは0.3秒、終わりは1秒で小さく（くり返し再生で頭に戻っても急に変わらない）
N = int(TOTAL * SR); sfx = np.zeros(N + SR)
for n, at in events:
    if n in SFX: SFX[n](sfx, at)
sfx = sfx[:N]
run(['-i', os.path.join(ROOT, 'bgm_chiisana_synth_no_niwa.mp3'), '-vn', '-ac', '1', '-ar', str(SR), os.path.join(H, 'bgm48.wav')])
with wave.open(os.path.join(H, 'bgm48.wav')) as w: bgm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
bgm = np.pad(bgm[:N], (0, max(0, N - len(bgm))))
fi, fo = int(0.3 * SR), int(1.0 * SR); bgm[:fi] *= np.linspace(0.15, 1, fi); bgm[-fo:] *= np.linspace(1, 0.15, fo)
voice = np.zeros(N + 5 * SR)
for vid, at in voices:
    with wave.open(os.path.join(H, 'voice', vid + '.wav')) as w: v = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
    st = int(at * SR); voice[st:st + len(v)] += v
voice = voice[:N]
# 声がある間は BGM と効果音を小さく（すぐ下げ、0.4秒かけて戻す）
blk = int(0.03 * SR); env = np.array([np.abs(voice[i:i + blk]).max() for i in range(0, N, blk)])
g = np.ones(len(env)); cur = 1.0
for i, e in enumerate(env):
    cur = 0.38 if e > 0.02 else min(1.0, cur + 0.03 / 0.4); g[i] = cur
duck = np.repeat(g, blk)[:N]
mix = np.tanh((voice * 1.25 + sfx * 0.7 * (0.55 + 0.45 * duck) + bgm * 0.26 * duck) * 1.05) * 0.95
wav = os.path.join(H, f'mix_{LAY}.wav')
with wave.open(wav, 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
wavn = os.path.join(H, f'mix_{LAY}_n.wav'); run(['-i', wav, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', str(SR), '-ac', '2', wavn])
# 絵: クリーム色の地 → スマホの画面 → 枠（角を丸く切る）→ 字幕の帯（場面ごと）
inputs = ['-f', 'lavfi', '-i', f"color=c=0xf7f1df:s={L['W']}x{L['H']}:r=30:d={TOTAL}", '-i', app, '-i', os.path.join(H, 'assets', f'frame_{LAY}.png')]
chain = [f"[0][1]overlay=x={L['ph_x']}:y={L['ph_y']}:shortest=1[a]", "[a][2]overlay=0:0[b]"]; last = 'b'
for i, (cap, a, b) in enumerate(bands):
    inputs += ['-i', os.path.join(H, 'assets', f'band_{LAY}_{cap}.png')]
    chain.append(f"[{last}][{3 + i}]overlay=0:{L['band_y']}:enable='between(t,{a:.3f},{b - 0.001:.3f})'[c{i}]"); last = f'c{i}'
run([*inputs, '-i', wavn, '-filter_complex', ';'.join(chain), '-map', f'[{last}]', '-map', f'{3 + len(bands)}:a',
     '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-b:v', '8M', '-maxrate', '10M', '-bufsize', '16M', '-preset', 'slow',
     '-c:a', 'aac', '-b:a', '128k', '-ar', str(SR), '-t', f'{TOTAL:.3f}', '-movflags', '+faststart', OUT])
# サムネイル（答え合わせの金のカード）
run(['-ss', f'{bands[1][1] + 0.9:.2f}', '-i', OUT, '-frames:v', '1', OUT.replace('.mp4', '_thumb.png')])
print('done', OUT, round(TOTAL, 2), 's', 'voices', [(v, round(a, 2)) for v, a in voices], 'events', [(n, round(a, 2)) for n, a in events])
