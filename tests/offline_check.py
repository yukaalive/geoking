"""オフラインでボットと遊ぶ（static/offline.js・sw.js）の確認。実行: python3 tests/offline_check.py [幅] [ja|en]（1〜2分。Mac の Google Chrome を使う）
ウェブ版を一度開いて国旗を覚えさせたあと、通信を切って（ページの通信を止め、サーバーも止める）開き直し、
「部屋を作る」→ ボットとバトルを最後まで → 結果発表の仮のレート → 通信を戻して部屋から出る → サーバーのレートとランキングに入る、を通しで見る。
撮った画面は一時フォルダに残す（最後に場所を出す）"""
import asyncio, base64, json, os, subprocess, sys, tempfile, time, aiohttp
ROOT = '/Users/yukaumezawa/Documents/geoking'; PORT = 9655; WEB = 8098; HTTP = f'http://localhost:{WEB}'
OUT = tempfile.mkdtemp(prefix='geoking-offline-')
W, LANG = int(sys.argv[1]) if len(sys.argv) > 1 else 375, sys.argv[2] if len(sys.argv) > 2 else 'ja'
start_srv = lambda: subprocess.Popen([sys.executable, 'server.py'], cwd=ROOT, env={**os.environ, 'PORT': str(WEB)}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
srv = start_srv()
chrome = subprocess.Popen(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--headless=new', '--disable-gpu', f'--remote-debugging-port={PORT}',
                           f'--user-data-dir={tempfile.mkdtemp()}', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
async def main():
    global srv
    async with aiohttp.ClientSession() as s:
        async def up():
            for _ in range(100):
                try:
                    async with s.get(f'{HTTP}/healthz') as r:
                        if r.status == 200: return True
                except Exception: pass
                await asyncio.sleep(0.2)
        await up()
        pages = []
        for _ in range(240):
            try:
                async with s.get(f'http://127.0.0.1:{PORT}/json') as r: pages = [p for p in await r.json() if p['type'] == 'page']
                if pages: break
            except Exception: pass
            await asyncio.sleep(0.5)
        ws = await s.ws_connect(pages[0]['webSocketDebuggerUrl'], max_msg_size=0); n = 0
        async def cmd(m, **p):
            nonlocal n; n += 1; my = n; await ws.send_json({'id': my, 'method': m, 'params': p})
            async for x in ws:
                d = json.loads(x.data)
                if d.get('id') == my: return d.get('result', d)
        async def ev(e):
            r = await cmd('Runtime.evaluate', expression=e, awaitPromise=True, returnByValue=True)
            if r.get('exceptionDetails'): print('JS error', json.dumps(r['exceptionDetails'])[:400])
            return r.get('result', {}).get('value')
        async def shot(name):
            r = await cmd('Page.captureScreenshot', format='png'); open(os.path.join(OUT, f'{W}_{LANG}_{name}.png'), 'wb').write(base64.b64decode(r['data']))
        SLEEP = "const sleep = ms => new Promise(r => setTimeout(r, ms));"
        await cmd('Page.enable'); await cmd('Network.enable')
        await cmd('Emulation.setDeviceMetricsOverride', width=W, height=800, deviceScaleFactor=2, mobile=True)
        await cmd('Page.navigate', url=f'{HTTP}/static/index.html'); await asyncio.sleep(1.5)
        await ev(f"(() => {{ localStorage.clear(); localStorage.setItem('geoking_lang', '{LANG}'); localStorage.setItem('geoking_name', 'はなこ'); return 1; }})()")
        await cmd('Page.navigate', url=f'{HTTP}/static/index.html'); await asyncio.sleep(2)
        t0 = time.time()
        while time.time() - t0 < 90:   # 国旗を全部覚えるまで待つ（197か国 × 3つの大きさ）
            k = await ev("caches.open('geoking-flags-v1').then(c => c.keys()).then(k => k.length)")
            if k and k >= 197 * 3: break
            await asyncio.sleep(2)
        print('flags cached:', k, f'({time.time() - t0:.0f}s)', 'sw:', await ev("navigator.serviceWorker.controller ? 'on' : 'off'"))
        # 通信を切る（ページの通信を止め、サーバーも止める）→ 開き直す
        await cmd('Network.emulateNetworkConditions', offline=True, latency=0, downloadThroughput=-1, uploadThroughput=-1)
        srv.terminate(); srv.wait(5)
        await cmd('Page.navigate', url=f'{HTTP}/static/index.html'); await asyncio.sleep(2.5)
        for _ in range(30):   # 通信のない読み込みは、国旗を覚えている最中などで遅いことがある（2.5秒では画面の部品がまだ動いていなかった）
            if await ev("typeof META !== 'undefined' && !!META"): break
            await asyncio.sleep(0.5)
        print('offline home:', await ev("JSON.stringify({ online: navigator.onLine, note: !document.getElementById('offlineNote').classList.contains('hidden'), noteText: document.getElementById('offlineNote').innerText, rooms: document.getElementById('publicRoomList').innerText, meta: !!META, docW: document.documentElement.scrollWidth })"))
        await shot('1_home')
        await ev(f"(async () => {{ {SLEEP} document.getElementById('createBtn').click(); for (let i = 0; i < 50 && !(state && state.phase === 'lobby'); i++) await sleep(100); return 1; }})()")
        print('offline lobby:', await ev("JSON.stringify({ phase: state && state.phase, offline: state && state.offline, cls: document.body.classList.contains('offline-room'), hidden: ['copyLink','lobbyNote','setTitleRow','setPublicRow','chatCard'].map(id => [id, getComputedStyle(document.getElementById(id)).display]), btn: document.getElementById('startBtn').textContent, docW: document.documentElement.scrollWidth })"))
        await ev(f"(async () => {{ {SLEEP} send({{ type: 'add_bot' }}); await sleep(300); return 1; }})()")
        await shot('2_lobby')
        await ev("document.getElementById('startBtn').click(), 1")
        res = await ev(f"""(async () => {{ {SLEEP} let picks = 0, last = -1, imgs = [0, 0];
            for (let i = 0; i < 2400 && !(state && state.phase === 'end'); i++) {{
              if (state && state.phase === 'pick' && state.hand && state.hand.length && state.round !== last && !(state.players.find(p => p.pid === pid) || {{}}).out_round) {{
                await sleep(400);
                const im = [...document.querySelectorAll('#hand img')]; imgs[0] += im.filter(x => x.complete && x.naturalWidth).length; imgs[1] += im.length;
                send({{ type: 'pick', card: state.hand[0] }}); last = state.round; picks++; }}
              await sleep(100);
            }}
            return JSON.stringify({{ phase: state && state.phase, round: state && state.round, picks, flagsShown: imgs }}); }})()""")
        print('offline battle:', res)
        await ev("window.scrollTo(0, 0), 1"); await asyncio.sleep(0.4); await shot('3_end_start'); await asyncio.sleep(5); await shot('4_end')
        print('end panel:', await ev("document.getElementById('ratePanel').innerText.replace(/\\s+/g, ' ')"), '| queue:', await ev("localStorage.getItem('geoking_offline_games')"), '| prov:', await ev("localStorage.getItem('geoking_offline_rate')"))
        # 通信を戻す → 部屋から出る → 送られて、レートとランキングに入る
        srv = start_srv(); await up()
        await cmd('Network.emulateNetworkConditions', offline=False, latency=0, downloadThroughput=-1, uploadThroughput=-1)
        await ev(f"(async () => {{ {SLEEP} document.getElementById('leaveBtn').click(); await sleep(300); const ok = document.querySelector('#modal:not(.hidden) .primary, #modal:not(.hidden) button.danger'); if (ok) ok.click(); for (let i = 0; i < 50 && state; i++) await sleep(100); await sleep(2500); return 1; }})()")
        rk = await ev("localStorage.getItem('geoking_rk')")
        async with s.post(f'{HTTP}/api/rating', json={'rk': rk}) as r: me = (await r.json()).get('me')
        print('after reconnect: queue', await ev("localStorage.getItem('geoking_offline_games')"), '| server me', me, '| home card', await ev("document.getElementById('rateCard').innerText.replace(/\\s+/g, ' ')"))
        assert me and me['n'] >= 1 and me['rank'] and not await ev("localStorage.getItem('geoking_offline_games')"), 'つながったあと、オフラインの試合がサーバーに入っていない'
        await ev("document.getElementById('rankCard').scrollIntoView({ block: 'center' }), 1"); await asyncio.sleep(0.4); await shot('5_home_after')
        await ws.close()
try: asyncio.run(main())
finally:
    chrome.terminate()
    if srv.poll() is None: srv.terminate()
print('画面:', OUT)
print('ALL OK')
