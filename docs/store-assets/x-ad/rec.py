"""ヘッドレス Chrome で地理王のページを開き、場面の台本（JS）を動かしながら画面を録る。
python3 rec.py 名前 URL 台本.js [幅 高さ]  → clips/名前.mp4 と clips/名前.events.json（効果音のタイミング）"""
import asyncio, base64, json, os, subprocess, sys, tempfile, shutil
import aiohttp, imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()
H = os.path.dirname(os.path.abspath(__file__))
NAME, URL, SCRIPT = sys.argv[1], sys.argv[2], sys.argv[3]
VW, VH = (int(sys.argv[4]), int(sys.argv[5])) if len(sys.argv) > 5 else (390, 693)
OUTW = int(os.environ.get('REC_OUTW', '1080')); DPR = OUTW / VW   # REC_OUTW: 書き出す幅（スマホの枠の中の幅）
PORT = 9460 + (abs(hash(NAME)) % 30)
os.makedirs(os.path.join(H, 'clips'), exist_ok=True)
fdir = os.path.join(H, 'frames', NAME); shutil.rmtree(fdir, ignore_errors=True); os.makedirs(fdir)
chrome = subprocess.Popen(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--headless=new', '--disable-gpu', f'--remote-debugging-port={PORT}',
                           f'--user-data-dir={tempfile.mkdtemp()}', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

async def main():
    async with aiohttp.ClientSession() as s:
        for _ in range(60):
            try:
                async with s.get(f'http://127.0.0.1:{PORT}/json') as r: pages = [p for p in await r.json() if p['type'] == 'page']; break
            except Exception: await asyncio.sleep(0.2)
        ws = await s.ws_connect(pages[0]['webSocketDebuggerUrl'], max_msg_size=0)
        futs, n, frames = {}, 0, []
        async def reader():
            async for m in ws:
                d = json.loads(m.data)
                if 'id' in d and d['id'] in futs: futs.pop(d['id']).set_result(d.get('result', d))
                elif d.get('method') == 'Page.screencastFrame':
                    p = d['params']; i = len(frames)
                    open(os.path.join(fdir, f'{i:05d}.jpg'), 'wb').write(base64.b64decode(p['data']))
                    frames.append(p['metadata']['timestamp'])
                    asyncio.create_task(cmd('Page.screencastFrameAck', sessionId=p['sessionId']))
        async def cmd(method, **params):
            nonlocal n; n += 1; my = n; f = asyncio.get_event_loop().create_future(); futs[my] = f
            await ws.send_json({'id': my, 'method': method, 'params': params}); return await f
        rt = asyncio.create_task(reader())
        await cmd('Page.enable')
        await cmd('Emulation.setDeviceMetricsOverride', width=VW, height=VH, deviceScaleFactor=DPR, mobile=True)
        await cmd('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'light'}])
        await cmd('Page.navigate', url=URL); await asyncio.sleep(3.0)
        helpers = os.environ.get('REC_PRE', '') + ';\n' + open(os.path.join(H, 'helpers.js')).read()   # REC_PRE: 道具より先に動かす設定（window.AD_SAFE_TOP など）
        await cmd('Runtime.evaluate', expression=helpers + ';document.fonts.ready.then(()=>true)', awaitPromise=True)
        # 台本の「準備」部分（録画の前に画面を整える）→ 録画を始める → 本番
        script = open(SCRIPT).read()
        await cmd('Runtime.evaluate', expression=f'window.__scene = (async () => {{ {script} }})(); true', awaitPromise=True)
        await cmd('Runtime.evaluate', expression='window.__ready ? window.__ready : Promise.resolve(true)', awaitPromise=True)
        await asyncio.sleep(0.3)
        await cmd('Page.startScreencast', format='jpeg', quality=92, maxWidth=OUTW, maxHeight=int(VH * DPR), everyNthFrame=1)
        await asyncio.sleep(0.25)
        await cmd('Runtime.evaluate', expression='AD.clipStart = performance.now(); AD.goEpoch = Date.now() / 1000; window.__go && window.__go(); true')
        r = await cmd('Runtime.evaluate', expression='window.__scene.then(() => JSON.stringify({ events: AD.events, go: AD.goEpoch, end: Date.now() / 1000 }))', awaitPromise=True, returnByValue=True)
        await asyncio.sleep(0.2)
        await cmd('Page.stopScreencast'); await asyncio.sleep(0.3)
        info = json.loads(r['result']['value'])
        rt.cancel(); await ws.close()
        return frames, info
try:
    frames, info = asyncio.run(main())
finally:
    chrome.terminate()
# 可変間隔のコマ → 30fps の動画（コマごとの長さを指定してつなぐ）
t0 = frames[0]
lst = os.path.join(fdir, 'list.txt')
with open(lst, 'w') as f:
    for i, ts in enumerate(frames):
        d = (frames[i + 1] - ts) if i + 1 < len(frames) else max(1 / 30, info['end'] - ts)   # 最後のコマは台本が終わるまで出す（止まった画面ではコマが来ない）
        f.write(f"file '{os.path.join(fdir, f'{i:05d}.jpg')}'\nduration {max(d, 0.001):.4f}\n")
    f.write(f"file '{os.path.join(fdir, f'{len(frames) - 1:05d}.jpg')}'\n")
out = os.path.join(H, 'clips', NAME + '.mp4')
subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-vf', f'fps=30,scale={OUTW}:-2:flags=lanczos,format=yuv420p',
                '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-an', out], check=True)
# 録画を始めた時刻（最初のコマ）と台本の0秒のずれを直して、効果音の時刻を保存
off = info['go'] - t0   # 動画の0秒から台本の0秒まで
events = [[n, round(t + off, 3)] for n, t in info['events']]
json.dump({'frames': len(frames), 'duration': info['end'] - t0, 'events': events}, open(os.path.join(H, 'clips', NAME + '.events.json'), 'w'), ensure_ascii=False)
print(NAME, 'frames', len(frames), 'sec', round(info['end'] - t0, 2), 'events', len(events))
