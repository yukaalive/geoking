"""場面を決めた長さに切ってつなぎ、スマホの枠と字幕の帯・BGM・効果音を付けて、広告用の動画にする。
python3 compose.py 45|916 6|10|15|30|60 出力.mp4   （45 = 4:5 の 1080×1350、916 = 9:16 の 1080×1920）
2026-09-28: 音は BGM と効果音（前と同じ曲・同じ混ぜ方）。ナレーションはなし。長さは 6・10・15・30・60 秒の5つ。バトル（体力を減らし合うゲーム）の場面を足した"""
import json, os, subprocess, sys, wave
import numpy as np, imageio_ffmpeg
H = os.path.dirname(os.path.abspath(__file__)); FF = imageio_ffmpeg.get_ffmpeg_exe(); SR = 48000
BGM = os.path.join(os.path.dirname(H), 'bgm_chiisana_synth_no_niwa.mp3')   # 前の広告と同じ曲
# 効果音: アプリ（static/sfx.js）と同じ音を作る部分を build_audio.py から借りる（tone・noise・SFX）
exec(open(os.path.join(os.path.dirname(H), 'build_audio.py')).read().split('# ---------- タイムライン')[0].split('import numpy')[1].split('\n', 1)[1].replace('SR = 44100', ''))
def app_sounds(evs):
    """バトルと1位の演出の音（shine・fanfare・charge・whoosh・smash・shatter など）: 録画のときにアプリが鳴らした時刻と強さ（common_state.js が記録）で、
    アプリの sfx.js をそのままヘッドレス Chrome の OfflineAudioContext で鳴らして作る（音の大きさをならす compressor もアプリと同じ）。
    evs: [(関数の名前, 引数, 動画の時刻)]。返り値: (最初の音の時刻, 音)。撮ったサーバー（AD_BASE）の sfx.js を使う"""
    import asyncio, base64, tempfile, aiohttp
    base, port = os.environ.get('AD_BASE', 'http://localhost:8090'), 9620
    t0 = max(0.0, min(at for _, _, at in evs) - 0.05); T = max(at for _, _, at in evs) - t0 + 2.5
    calls = [[m, a, round(at - t0, 4)] for m, a, at in evs]
    js = ("(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 50 && typeof sfx === 'undefined'; i++) await sleep(100);"
          f"const off = new OfflineAudioContext(1, Math.ceil({T:.3f} * {SR}), {SR}); let now = 0;"
          "window.AudioContext = function () { return new Proxy(off, { get: (o, k) => k === 'currentTime' ? now : k === 'state' ? 'running' : (typeof o[k] === 'function' ? o[k].bind(o) : o[k]) }); };"
          f"for (const [m, a, at] of {json.dumps(calls)}) {{ now = at; sfx[m](...a); }}"
          "const u = new Uint8Array((await off.startRendering()).getChannelData(0).buffer); let s = '';"
          "for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); })()")
    chrome = subprocess.Popen(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--headless=new', '--disable-gpu', f'--remote-debugging-port={port}',
                               f'--user-data-dir={tempfile.mkdtemp()}', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    async def main():
        async with aiohttp.ClientSession() as s:
            for _ in range(60):
                try:
                    async with s.get(f'http://127.0.0.1:{port}/json') as r: pages = [p for p in await r.json() if p['type'] == 'page']; break
                except Exception: await asyncio.sleep(0.2)
            ws = await s.ws_connect(pages[0]['webSocketDebuggerUrl'], max_msg_size=0); n = 0
            async def cmd(m, **p):
                nonlocal n; n += 1; my = n; await ws.send_json({'id': my, 'method': m, 'params': p})
                async for x in ws:
                    d = json.loads(x.data)
                    if d.get('id') == my: return d.get('result', d)
            await cmd('Page.enable'); await cmd('Page.navigate', url=base + '/static/zukan.html'); await asyncio.sleep(2.0)   # 図鑑のページにも sfx.js がある（つながない・音を出さない）
            r = await cmd('Runtime.evaluate', expression=js, awaitPromise=True, returnByValue=True); await ws.close()
            if 'exceptionDetails' in r: sys.exit('アプリの音を作れなかった: ' + json.dumps(r['exceptionDetails'])[:300])
            return r['result']['value']
    try: b64 = asyncio.run(main())
    finally: chrome.terminate()
    snd = np.frombuffer(base64.b64decode(b64), dtype=np.float32).astype(np.float64)
    if not np.abs(snd).max() > 0.01: sys.exit('アプリの音が無音だった（sfx.js の音の作り方が変わった？）')
    return t0, snd
LAY, VAR, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
L = json.load(open(os.path.join(H, 'assets', 'layouts.json')))[LAY]
# 長さごとの場面: (場面, 録画の何秒目から, 何秒使うか, 字幕)。録画の頭の 0.2〜0.25 秒は、録り始めてから台本が動くまでの間
VARIANTS = {   # 2026-09-28: 画面が変わるのが早すぎると言われ、1場面 3〜6 秒に（短い版ほど場面を減らす）。60秒の長い版を足した。バトルは新しい演出（脱落まで約4.2秒）が入るように 5秒以上
    '6':  [('pick', 1.90, 2.60, 'pick'), ('reveal', 0.24, 3.40, 'reveal')],
    '10': [('pick', 1.30, 3.00, 'pick'), ('reveal', 0.24, 3.80, 'reveal'), ('home', 0.25, 3.20, 'home')],
    '15': [('pick', 1.40, 3.00, 'pick'), ('reveal', 0.24, 3.80, 'reveal'), ('battle', 0.40, 5.20, 'battle'), ('home', 0.25, 3.00, 'home')],
    '30': [('pick', 1.00, 3.40, 'pick'), ('reveal', 0.24, 4.40, 'reveal'), ('prompts', 0.24, 3.40, 'prompts'), ('end', 0.20, 3.40, 'end'),
           ('modesel', 0.25, 3.40, 'modesel'), ('battle', 0.24, 5.40, 'battle'), ('lobby', 0.30, 3.20, 'lobby'), ('home', 0.25, 3.40, 'home')],
    '60': [('pick', 0.24, 4.60, 'pick'), ('reveal', 0.24, 5.60, 'reveal'), ('modal', 0.25, 5.00, 'modal'), ('prompts', 0.24, 4.20, 'prompts'),
           ('end', 0.20, 4.40, 'end'), ('modesel', 0.25, 4.60, 'modesel'), ('battle', 0.24, 6.00, 'battle'), ('battle_end', 0.20, 4.40, 'battle_end'),
           ('lobby', 0.25, 4.60, 'lobby'), ('quiz', 0.30, 5.20, 'quiz'), ('zukan', 0.30, 5.20, 'zukan'), ('home', 0.25, 6.20, 'home')],
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
appev = [(n.split(':', 2)[1], json.loads(n.split(':', 2)[2]), at) for n, at in events if n.startswith('app:')]   # バトルと1位の演出の音（アプリの sfx.js で作る）
if appev:
    a0, snd = app_sounds(appev); i0 = int(round(a0 * SR)); e = min(len(sfx), i0 + len(snd)); sfx[i0:e] += snd[:e - i0]
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
print('done', OUT, round(TOTAL, 2), 's', [(c, round(a, 2)) for c, a, _ in bands], 'sfx', [(n, round(a, 2)) for n, a in events if n in SFX or n.startswith('app:')])
