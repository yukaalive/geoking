"""字幕の帯（ロゴつき）とスマホの枠の絵を、アプリと同じ字体（Google Fonts）でヘッドレス Chrome に描かせて PNG にする"""
import asyncio, base64, json, os, subprocess, tempfile, sys
import aiohttp
H = os.path.dirname(os.path.abspath(__file__)); A = os.path.join(H, 'assets'); PORT = 9499
LAYOUTS = {   # 名前: 画面の大きさ、帯の位置と高さ、スマホの枠の位置と大きさ
  '45':  {'W': 1080, 'H': 1350, 'band_y': 0,   'band_h': 250, 'ph_x': 200, 'ph_y': 272, 'ph_w': 680, 'ph_h': 1100},
  '916': {'W': 1080, 'H': 1920, 'band_y': 165, 'band_h': 265, 'ph_x': 130, 'ph_y': 452, 'ph_w': 820, 'ph_h': 1470},
}
CAPS = json.load(open(os.path.join(H, 'captions.json')))   # [[id, "1行目", "2行目"], ...]（<b>…</b> は黄色）
FONTS = '<link href="https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=M+PLUS+1p:wght@800;900&display=swap" rel="stylesheet">'
icon = base64.b64encode(open('/Users/yukaumezawa/Documents/geoking/static/icons/icon-192.png', 'rb').read()).decode()
def band_html(L, l1, l2):
    return f'''<html><head><meta charset="utf-8">{FONTS}<style>html,body{{margin:0;background:transparent}}
.b{{width:{L['W']}px;height:{L['band_h']}px;background:#1f6f4a;box-shadow:inset 0 -8px 0 #1c2b22;position:relative;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:2px;color:#fff;font-family:'M PLUS 1p';font-weight:900;text-align:center}}
.l{{font-size:64px;line-height:1.18;letter-spacing:.01em}} .l b{{color:#f4c542;font-weight:900}}
.logo{{position:absolute;left:22px;top:14px;display:flex;align-items:center;gap:8px;font-family:'Dela Gothic One';font-size:30px;color:#fff;opacity:.95}} .logo img{{width:38px;height:38px;border-radius:9px;border:2px solid #1c2b22}}
.lines{{margin-top:{22 if L['band_h'] >= 250 else 16}px}}</style></head><body><div class="b"><div class="logo"><img src="data:image/png;base64,{icon}">地理王</div><div class="lines"><div class="l">{l1}</div>{f'<div class="l">{l2}</div>' if l2 else ''}</div></div></body></html>'''
def frame_html(L):
    r = 44
    return f'''<html><head><meta charset="utf-8"><style>html,body{{margin:0;background:transparent;overflow:hidden}}
.bg{{position:absolute;inset:0;overflow:hidden;width:{L['W']}px;height:{L['H']}px}}
.ph{{position:absolute;left:{L['ph_x'] - 12}px;top:{L['ph_y'] - 12}px;width:{L['ph_w'] + 24}px;height:{L['ph_h'] + 24 + 200}px;border-radius:{r + 12}px;box-shadow:0 0 0 3000px #f7f1df;}}
.in{{position:absolute;left:{L['ph_x'] - 12}px;top:{L['ph_y'] - 12}px;width:{L['ph_w'] + 24}px;height:{L['ph_h'] + 24 + 200}px;box-sizing:border-box;border:12px solid #1c2b22;border-radius:{r + 12}px}}
.sh{{position:absolute;left:{L['ph_x'] - 12 + 10}px;top:{L['ph_y'] - 12 + 10}px;width:{L['ph_w'] + 24}px;height:{L['ph_h'] + 24 + 200}px;border-radius:{r + 12}px;box-shadow:0 0 0 10px rgba(28,43,34,.25);clip-path:inset(-20px -20px -20px -20px)}}
</style></head><body><div class="bg"><div class="ph"></div><div class="in"></div></div></body></html>'''
async def shoot(ws, cmd, html, w, h, out):
    await cmd('Emulation.setDeviceMetricsOverride', width=w, height=h, deviceScaleFactor=1, mobile=False)
    await cmd('Emulation.setDefaultBackgroundColorOverride', color={'r': 0, 'g': 0, 'b': 0, 'a': 0})
    await cmd('Page.navigate', url='data:text/html;charset=utf-8;base64,' + base64.b64encode(html.encode()).decode())
    await asyncio.sleep(1.3)
    await cmd('Runtime.evaluate', expression='document.fonts.ready.then(()=>true)', awaitPromise=True)
    d = await cmd('Page.captureScreenshot', format='png', clip={'x': 0, 'y': 0, 'width': w, 'height': h, 'scale': 1})
    open(out, 'wb').write(base64.b64decode(d['data']))
async def main():
    chrome = subprocess.Popen(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--headless=new', '--disable-gpu', f'--remote-debugging-port={PORT}', f'--user-data-dir={tempfile.mkdtemp()}', '--hide-scrollbars', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        async with aiohttp.ClientSession() as s:
            for _ in range(60):
                try:
                    async with s.get(f'http://127.0.0.1:{PORT}/json') as r: pages = [p for p in await r.json() if p['type'] == 'page']; break
                except Exception: await asyncio.sleep(0.2)
            async with s.ws_connect(pages[0]['webSocketDebuggerUrl'], max_msg_size=0) as ws:
                n = 0
                async def cmd(m, **p):
                    nonlocal n; n += 1; my = n
                    await ws.send_json({'id': my, 'method': m, 'params': p})
                    async for x in ws:
                        d = json.loads(x.data)
                        if d.get('id') == my: return d.get('result', d)
                for name, L in LAYOUTS.items():
                    await shoot(ws, cmd, frame_html(L), L['W'], L['H'], os.path.join(A, f'frame_{name}.png'))
                    for cid, l1, l2 in CAPS:
                        await shoot(ws, cmd, band_html(L, l1, l2), L['W'], L['band_h'], os.path.join(A, f'band_{name}_{cid}.png'))
    finally:
        chrome.terminate()
    json.dump(LAYOUTS, open(os.path.join(A, 'layouts.json'), 'w'))
asyncio.run(main()); print('ok')
