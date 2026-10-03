"""更新のときにランキングが消えないか（Render の切り替えを手元で再現）。実行: python3 tests/test_rating_handoff.py（20秒ほど）
Render の入口の代わりに中継サーバーを立てる（test_migration.py と同じ考え方）。古いサーバー A でバトルをして、部屋がなくなってから
新しいサーバー B を起動する。B は外から入れるようになる前に、中継（まだ A につながっている）から A のレートを全部もらう（server.py の rating_pull）。
中継を B に切り替えたあと、ランキングが A と同じかを見る（2026-10-03「アプリをアップデートするだけで、ランキングがなくなっちゃいます」）。
  - A は合言葉なしでは渡さない（404）。合言葉の違うサーバー C はもらえない（ランキングは空のまま起動する）
  - 返事が来ない先（眠りから起きるときの Render の入口の代わり）でも、D は RATING_PULL_TIMEOUT であきらめて起動する"""
import asyncio, json, os, secrets, subprocess, sys, tempfile, time
import aiohttp
from aiohttp import web

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROXY, A, B, C, D, HOLE = 8390, 8391, 8392, 8393, 8394, 8395
KEY = 'test-handoff-key'
backend = {'port': A}
LOGS = tempfile.mkdtemp()


async def proxy_handler(request):   # Render の入口の代わり（HTTP だけ、今の行き先へ中継）
    async with aiohttp.ClientSession() as s:
        headers = {k: v for k, v in request.headers.items() if k.lower() in ('content-type', 'x-migrate-key')}
        try:
            async with s.request(request.method, f"http://127.0.0.1:{backend['port']}{request.path_qs}", headers=headers, data=await request.read()) as r:
                return web.Response(status=r.status, body=await r.read(), content_type=r.content_type)
        except aiohttp.ClientConnectionError:
            return web.Response(status=502)


async def hole(reader, writer):   # つながるが返事をしない（眠っているサーバーが起きるまで Render の入口が待たせるのと同じ）
    await asyncio.sleep(60)
    writer.close()


def start_server(port, key, url, extra=None):
    env = {**os.environ, 'PORT': str(port), 'MIGRATE_KEY': key, 'MIGRATE_URL': url, **(extra or {})}
    for k in ('GEOKING_DEMO', 'SHEET_LOG_URL', 'SHEET_LOG_KEY'):
        env.pop(k, None)
    return subprocess.Popen([sys.executable, 'server.py'], cwd=ROOT, env=env, stdout=open(os.path.join(LOGS, f'{port}.log'), 'w'), stderr=subprocess.STDOUT)


async def wait_up(s, port, limit=20):
    t0 = time.time()
    while time.time() - t0 < limit:
        try:
            async with s.get(f'http://127.0.0.1:{port}/healthz') as r:
                if r.status == 200:
                    return time.time() - t0
        except aiohttp.ClientConnectionError:
            pass
        await asyncio.sleep(0.1)
    raise AssertionError(f'server {port} did not start')


async def recv_state(ws, pred=lambda d: True, timeout=10):
    while True:
        d = json.loads((await asyncio.wait_for(ws.receive(), timeout)).data)
        if d.get('type') == 'error':
            raise RuntimeError(d.get('code'))
        if d.get('type') == 'state' and pred(d):
            return d


async def battle(s, port, win, lose):   # win が部屋を作り、lose が入って抜ける → win の勝ち。終わったら win も出る（部屋は残らない）
    url = f'ws://127.0.0.1:{port}/ws'
    a = await s.ws_connect(url); await a.send_json({'type': 'hello', 'rk': win[1]}); await a.send_json({'type': 'create', 'name': win[0]})
    room = (await recv_state(a))['room']
    b = await s.ws_connect(url); await b.send_json({'type': 'hello', 'rk': lose[1]}); await b.send_json({'type': 'join', 'room': room, 'name': lose[0]})
    await recv_state(b, lambda d: len(d['players']) == 2)
    await a.send_json({'type': 'start'}); await recv_state(a, lambda d: d['phase'] == 'pick')
    await b.send_json({'type': 'leave'}); await recv_state(a, lambda d: d['phase'] == 'end')
    await a.send_json({'type': 'leave'}); await a.close(); await b.close()


async def ranking(s, base, rk=None):
    async with s.post(base + '/api/ranking', json={'rk': rk} if rk else {}) as r:
        return await r.json()


async def main():
    papp = web.Application()
    papp.router.add_route('*', '/{tail:.*}', proxy_handler)
    prunner = web.AppRunner(papp); await prunner.setup(); await web.TCPSite(prunner, '127.0.0.1', PROXY).start()
    hole_server = await asyncio.start_server(hole, '127.0.0.1', HOLE)
    procs = []
    try:
        async with aiohttp.ClientSession() as s:
            # 古いサーバー A（起動するときは、中継の先がまだ自分＝待ち受けていないので、もらうものはない）
            procs.append(start_server(A, KEY, f'http://127.0.0.1:{PROXY}'))
            await wait_up(s, A)
            ken, hana, sora = ('Ken', secrets.token_hex(16)), ('はなこ', secrets.token_hex(16)), ('そら', secrets.token_hex(16))
            await battle(s, A, ken, hana)
            await battle(s, A, ken, sora)
            await battle(s, A, hana, sora)
            before = await ranking(s, f'http://127.0.0.1:{A}')
            rows = [(t['rank'], t['name'], t['rate']) for t in before['top']]
            assert len(rows) == 3 and before['total'] == 3, before
            async with s.post(f'http://127.0.0.1:{A}/internal/ratings') as r:
                assert r.status == 404, '合言葉なしでは渡さない'
            print('OK old server A: 3 players ranked after battles (everyone left the rooms); /internal/ratings needs the key')

            # 新しいサーバー B: 中継はまだ A。B は起動の途中で A からもらう → 中継を B に切り替える
            procs.append(start_server(B, KEY, f'http://127.0.0.1:{PROXY}'))
            await wait_up(s, B)
            backend['port'] = B
            after = await ranking(s, f'http://127.0.0.1:{PROXY}')
            assert [(t['rank'], t['name'], t['rate']) for t in after['top']] == rows and after['total'] == 3, (rows, after)
            me = (await ranking(s, f'http://127.0.0.1:{PROXY}', ken[1]))['me']
            assert me and me['n'] == 2 and me['rank'] == next(t['rank'] for t in before['top'] if t['name'] == 'Ken'), me
            assert 'ratings: pulled 3 of 3' in open(os.path.join(LOGS, f'{B}.log'), encoding='utf-8').read()
            print('OK new server B: took all ratings from A before opening (same ranking after the switch, my record too)')

            # 合言葉の違うサーバー C（中継を A に戻して起動）: もらえない
            backend['port'] = A
            procs.append(start_server(C, 'wrong-key', f'http://127.0.0.1:{PROXY}'))
            await wait_up(s, C)
            assert (await ranking(s, f'http://127.0.0.1:{C}'))['total'] == 0
            print('OK server with a wrong key gets nothing')

            # 返事が来ない先（眠りから起きるとき）: D は待ち時間であきらめて起動する
            t0 = time.time()
            procs.append(start_server(D, KEY, f'http://127.0.0.1:{HOLE}', {'RATING_PULL_TIMEOUT': '2'}))
            took = await wait_up(s, D, limit=15)
            assert took < 9 and (await ranking(s, f'http://127.0.0.1:{D}'))['total'] == 0, took
            print(f'OK no answer (waking from sleep): gave up and started in {took:.1f}s')
    finally:
        for p in procs:
            p.terminate()
        for p in procs:
            try:
                p.wait(5)
            except subprocess.TimeoutExpired:
                p.kill()
        hole_server.close()
        await prunner.cleanup()
    print('ALL OK')


if __name__ == '__main__':
    asyncio.run(main())
