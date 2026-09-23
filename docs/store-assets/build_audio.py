"""宣伝動画の音声（ナレーション原稿は build_video と同じフォルダの voice/*.wav。「日本」は「ニッポン」とカタカナで書くと say がそう読む）: 効果音（app.js の sfx を numpy で再現）＋ナレーション（macOS say/Kyoko）＋BGM（声の間は自動で小さく）。
build_video.py で作った geoking_promo.mp4 に合成して geoking_promo_sound.mp4 を出す。"""
import numpy as np, wave, subprocess, math, os, imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe(); SR = 44100
BGM_SRC = '/Users/yukaumezawa/Documents/geoking/docs/store-assets/bgm_chiisana_synth_no_niwa.mp3'

# ---------- 効果音の合成（app.js sfx と同じパラメータ）
def tone(buf, at, wave_type, f, t, d, v=.18, slide=None):
    n = int(d * SR); i = np.arange(n); tt = i / SR
    freq = f * (slide / f) ** (tt / d) if slide else np.full(n, float(f))
    phase = 2 * np.pi * np.cumsum(freq) / SR
    if wave_type == 'sine': w = np.sin(phase)
    elif wave_type == 'square': w = np.sign(np.sin(phase)) * 0.6
    else: w = 2 / np.pi * np.arcsin(np.sin(phase))          # triangle
    a = int(0.01 * SR)
    env = np.concatenate([np.geomspace(1e-4, v, max(a, 1)), np.geomspace(v, 1e-4, max(n - a, 1))])[:n]
    s = int((at + t) * SR); e = min(s + n, len(buf)); buf[s:e] += (w * env)[:e - s]
def noise(buf, at, t, d, v=.12, freq=1800, q=.8, slide_to=None):
    n = int(d * SR); x = (np.random.rand(n) * 2 - 1) * (1 - np.arange(n) / n)
    y = np.zeros(n); x1 = x2 = y1 = y2 = 0.0
    for k in range(0, n, 64):                                # バンドパス（biquad）を64サンプルごとに係数更新
        fc = freq * (slide_to / freq) ** (k / n) if slide_to else freq
        w0 = 2 * np.pi * fc / SR; al = np.sin(w0) / (2 * q)
        b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * np.cos(w0); a2 = 1 - al
        for j in range(k, min(k + 64, n)):
            yv = (b0 * x[j] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
            x2, x1, y2, y1 = x1, x[j], y1, yv; y[j] = yv
    s = int((at + t) * SR); e = min(s + n, len(buf)); buf[s:e] += (y * v)[:e - s]
SFX = {
 'tap':     lambda b, a: tone(b, a, 'square', 660, 0, .04, .05),
 'enter':   lambda b, a: (tone(b, a, 'triangle', 523, 0, .1, .14), tone(b, a, 'triangle', 784, .1, .18, .14)),
 'joined':  lambda b, a: (tone(b, a, 'triangle', 988, 0, .18, .2), tone(b, a, 'triangle', 784, .2, .32, .2)),
 'chat':    lambda b, a: tone(b, a, 'sine', 1400, 0, .05, .05),
 'start':   lambda b, a: ([tone(b, a, 'square', f, i * .07, .1, .1) for i, f in enumerate([392, 523, 659, 784])], tone(b, a, 'triangle', 1047, .3, .3, .18)),
 'select':  lambda b, a: tone(b, a, 'square', 880, 0, .05, .08),
 'confirm': lambda b, a: (tone(b, a, 'triangle', 520, 0, .08, .2), tone(b, a, 'triangle', 780, .07, .12, .2)),
 'reveal':  lambda b, a: (noise(b, a, 0, .18), tone(b, a, 'triangle', 300, .05, .12, .12, 600)),
 'win':     lambda b, a: [tone(b, a, 'triangle', f, i * .09, .22, .2) for i, f in enumerate([523, 659, 784, 1047])],
 'lose':    lambda b, a: (noise(b, a, 0, .6, .16, 1400, .6, 300), tone(b, a, 'sine', 330, 0, .5, .06, 220)),
 'open':    lambda b, a: tone(b, a, 'sine', 700, 0, .06, .07, 900),
 'champion':lambda b, a: [tone(b, a, 'triangle', f, i * .12, .3, .2) for i, f in enumerate([523, 659, 784, 1047, 784, 1047, 1319])],
}
# ---------- タイムライン（build_video.py が出す seg/timeline.json: 名前 -> [開始秒, 長さ]）
import json as _json
TL = _json.load(open('seg/timeline.json')); OFF = {k: v[0] for k, v in TL.items()}
TOTAL = max(v[0] + v[1] for v in TL.values())
print('offsets', {k: round(v, 2) for k, v in OFF.items()}, 'total', round(TOTAL, 2))
# 効果音（動画のコマを見て合わせた。撮り直したら再確認）
EVENTS = [
 ('tap', OFF['s0'] + 2.2), ('enter', OFF['s0'] + 2.5),
 ('joined', OFF['s1'] + 1.0), ('chat', OFF['s1'] + 1.5),
 ('tap', OFF['s2'] + 0.9), ('start', OFF['s2'] + 1.1),
 ('select', OFF['s3b'] + 0.5), ('confirm', OFF['s3b'] + 1.7), ('reveal', OFF['s3b'] + 2.1), ('win', OFF['s3b'] + 2.5),
 ('champion', OFF['s5a'] + 0.3),
 ('tap', OFF['z1'] + 0.1), ('select', OFF['z2'] + 0.2), ('open', OFF['z2'] + 0.35), ('tap', OFF['z4'] + 0.1),
]
# ナレーション: 区間名 -> [(音声ファイル, 区間先頭からの秒), ...]
VOICE = {'intro': [('intro', 0.25)], 's0': [('s0', 0.25)], 's1': [('s1', 0.25)],
         's3a': [('s3a1', 0.3), ('s3a2', 3.85)],   # 「お題は…」→1秒あけて「うーん…」
         's3b': [('s3b', 2.3)], 's3c': [('s3c', 0.3)], 's5a': [('s5', 0.3)],
         'z1': [('z1', 0.3)], 'z4': [('z4', 0.4)], 'outro': [('outro', 0.25)]}
N = int(TOTAL * SR)
sfx = np.zeros(N)
for name, at in EVENTS: SFX[name](sfx, at)
sfx *= 0.9

# ---------- ナレーション
def read_wav(path):
    with wave.open(path) as w:
        d = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
        if w.getnchannels() == 2: d = d.reshape(-1, 2).mean(axis=1)
        return d
voice = np.zeros(N)
for seg, clips in VOICE.items():
    for clip, rel in clips:
        v = read_wav(f'voice/{clip}.wav'); st = int((OFF[seg] + rel) * SR); en = min(st + len(v), N); voice[st:en] += v[:en - st]
voice *= 1.0

# ---------- BGM（mp3→wav、声のあるところは自動で下げる）
subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', BGM_SRC, '-vn', '-ac', '1', '-ar', str(SR), 'bgm.wav'], check=True)
bgm = read_wav('bgm.wav')[:N]
if len(bgm) < N: bgm = np.pad(bgm, (0, N - len(bgm)))
fade_in = int(1.0 * SR); fade_out = int(2.5 * SR)
bgm[:fade_in] *= np.linspace(0, 1, fade_in); bgm[-fade_out:] *= np.linspace(1, 0, fade_out)
# ダッキング: 声の音量包絡（50msブロック）→ 声があるとき BGM を 0.35 倍、無いとき 1.0 倍。なめらかに追従
blk = int(0.05 * SR); env = np.array([np.abs(voice[i:i + blk]).max() for i in range(0, N, blk)])
gain_blk = np.where(env > 0.02, 0.35, 1.0)
# release をゆるく（下げるときは即、戻すときは 0.6 秒）
g = np.ones_like(gain_blk); cur = 1.0
for i, target in enumerate(gain_blk):
    cur = target if target < cur else min(1.0, cur + 0.05 / 0.6)
    g[i] = cur
gain = np.repeat(g, blk)[:N]
bgm = bgm * gain * 0.28

mix = voice + sfx + bgm
mix = np.tanh(mix * 1.1) * 0.95                              # ソフトクリップ
out = (mix * 32767).astype(np.int16)
with wave.open('mix.wav', 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(out.tobytes())
subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', 'mix.wav', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', str(SR), 'mix_norm.wav'], check=True)   # 配信向けの音量（-14 LUFS）
subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', 'geoking_promo.mp4', '-i', 'mix_norm.wav', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', 'geoking_promo_sound.mp4'], check=True)
print('done')
