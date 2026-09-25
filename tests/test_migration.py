"""更新時の部屋の引っ越しの確認（Render の切り替えを手元で再現）。実行: python3 tests/test_migration.py（1分ほど）
Render の入口の代わりに中継サーバーを立て、つなぐ先を古いサーバー A → 新しいサーバー B に切り替える（Render の更新と同じく、
切り替えのあとも A につながったままの接続はそのまま）。A は切り替わりに気づいて部屋を B へ送り、接続を切る。
画面の代わりのクライアントは画面と同じように 0.3 秒後につなぎ直し（同じ pid・token）、同じ部屋・同じ手札・同じ点数のまま続きを遊べるかを見る。
  - 対戦中（選ぶ時間・1人は出した後・チャットあり・観戦者あり）、ロビー（ボット入り）、結果表示中の3部屋
  - 先に合言葉の違うサーバーに切り替えると送れない → A で遊び続けられ、あとで正しい B に切り替えたときに送れる
  - つなぎ直さない人は、待ち時間（MIGRATE_GRACE）のあと切断扱い。待っている間にラウンドが勝手に決まらない
  - 全員がいったん切れていた部屋（アプリを裏に回した等）も送る。切り替え直後、部屋が届く前につなぎ直した人は待たされてから入れる
  - ロビーでつなぎ直さない人は、開始のときに外れる（いない人に手札を配らない）
  - 引っ越したあと、切り替えが一瞬古いサーバーに戻っても、古い方へ送り返さない。送り終えたサーバーは受け取らない"""
import asyncio, json, os, subprocess, sys, tempfile, time
import aiohttp
from aiohttp import web

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROXY, A, B_BAD, B = 8290, 8291, 8293, 8292
KEY = 'test-migrate-key'
GRACE = 3
backend = {'port': A}


# ---------- Render の入口の代わり（HTTP と WebSocket を今の行き先へ中継。切り替えても、つながったままの接続は元のサーバーのまま）
async def proxy_handler(request):
    port = backend['port']
    if request.headers.get('Upgrade', '').lower() == 'websocket':
        client = web.WebSocketResponse()
        await client.prepare(request)
        async with aiohttp.ClientSession() as s:
            try:
                back = await s.ws_connect(f'ws://127.0.0.1:{port}{request.path_qs}')
            except Exception:
                await client.close()
                return client

            async def c2b():
                async for m in client:
                    if m.type == aiohttp.WSMsgType.TEXT:
                        await back.send_str(m.data)
                await back.close()

            async def b2c():
                async for m in back:
                    if m.type == aiohttp.WSMsgType.TEXT:
                        await client.send_str(m.data)
                await client.close()
            await asyncio.wait([asyncio.create_task(c2b()), asyncio.create_task(b2c())], return_when=asyncio.FIRST_COMPLETED)
            await back.close()
            await client.close()
        return client
    async with aiohttp.ClientSession() as s:
        headers = {k: v for k, v in request.headers.items() if k.lower() in ('content-type', 'x-migrate-key', 'cache-control')}
        async with s.request(request.method, f'http://127.0.0.1:{port}{request.path_qs}', headers=headers, data=await request.read()) as r:
            return web.Response(status=r.status, body=await r.read(), content_type=r.content_type)


def start_server(port, key, log_path):
    env = {**os.environ, 'PORT': str(port), 'MIGRATE_KEY': key, 'MIGRATE_URL': f'http://127.0.0.1:{PROXY}', 'MIGRATE_POLL': '0.5', 'MIGRATE_GRACE': str(GRACE), 'MIGRATE_BATCH': '2'}   # 2部屋ずつ送る（何回かに分けて送れるかも見る）
    env.pop('GEOKING_DEMO', None)
    return subprocess.Popen([sys.executable, 'server.py'], cwd=ROOT, env=env, stdout=open(log_path, 'w'), stderr=subprocess.STDOUT)


async def wait_up(port):
    async with aiohttp.ClientSession() as s:
        for _ in range(100):
            try:
                async with s.get(f'http://127.0.0.1:{port}/healthz') as r:
                    return await r.json()
            except Exception:
                await asyncio.sleep(0.1)
    raise SystemExit(f'server :{port} did not start')


async def health(port):
    async with aiohttp.ClientSession() as s:
        async with s.get(f'http://127.0.0.1:{port}/healthz') as r:
            return await r.json()


# ---------- 画面の代わり（切れたら 0.3 秒後に同じ pid・token でつなぎ直す）
class Client:
    def __init__(self, session, name, reconnect=True):
        self.s, self.name, self.reconnect = session, name, reconnect
        self.ws, self.state, self.reconnects, self.closed_at = None, None, 0, None

    async def open(self):
        self.ws = await self.s.ws_connect(f'ws://127.0.0.1:{PROXY}/ws')

    async def send(self, msg):
        await self.ws.send_json(msg)

    async def wait(self, pred=lambda d: True, timeout=12):
        end = time.time() + timeout
        while True:
            left = end - time.time()
            if left <= 0:
                raise AssertionError(f'{self.name}: timeout (last phase={self.state and self.state["phase"]})')
            try:
                msg = await asyncio.wait_for(self.ws.receive(), left)
            except asyncio.TimeoutError:
                continue
            if msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSING):
                if not self.reconnect or not self.state:
                    raise ConnectionError(f'{self.name}: closed')
                self.closed_at = time.time()
                await asyncio.sleep(0.3)   # 画面（app.js）と同じ: 1回目はすぐつなぎ直す
                await self.open()
                self.reconnects += 1
                await self.send({'type': 'join', 'room': self.state['room'], 'name': self.name, 'pid': self.state['you'], 'token': self.state['token']})
                continue
            d = json.loads(msg.data)
            if d['type'] == 'error':
                raise AssertionError(f'{self.name}: error {d.get("code")}')
            if d['type'] == 'state':
                self.state = d
                if pred(d):
                    return d


def left_sec(st):
    return (st['deadline'] or 0) - time.time()


async def main():
    logs = {n: tempfile.NamedTemporaryFile('w+', suffix=f'-{n}.log', delete=False).name for n in ('A', 'B_BAD', 'B')}
    papp = web.Application(client_max_size=16 * 1024 * 1024)
    papp.router.add_route('*', '/{tail:.*}', proxy_handler)
    prunner = web.AppRunner(papp); await prunner.setup(); await web.TCPSite(prunner, '127.0.0.1', PROXY).start()
    procs = [start_server(A, KEY, logs['A'])]
    try:
        a_boot = (await wait_up(A))['boot']
        async with aiohttp.ClientSession() as s:
            # 部屋1: 対戦中（2人。制限時間60秒。Alice は出した後。チャットあり。途中から入った観戦者 Erin はつなぎ直さない）
            alice, bob, erin = Client(s, 'Alice'), Client(s, 'Bob'), Client(s, 'Erin', reconnect=False)
            for c in (alice, bob, erin):
                await c.open()
            await alice.send({'type': 'create', 'name': 'Alice'})
            st = await alice.wait(); room1 = st['room']
            await alice.send({'type': 'settings', 'settings': {'rounds': 3, 'hand_size': 4, 'timer': 60}})
            await alice.wait(lambda d: d['settings']['timer'] == 60)
            await bob.send({'type': 'join', 'room': room1, 'name': 'Bob'})
            await bob.wait()
            await alice.send({'type': 'start'})
            st1 = await alice.wait(lambda d: d['phase'] == 'pick')
            await bob.wait(lambda d: d['phase'] == 'pick')
            await erin.send({'type': 'join', 'room': room1, 'name': 'Erin'})
            await erin.wait(lambda d: d['phase'] == 'pick')
            alice_card = st1['hand'][0]
            await alice.send({'type': 'pick', 'card': alice_card})
            await alice.wait(lambda d: d['my_pick'] == alice_card)
            await alice.send({'type': 'chat', 'text': 'こんにちは'})
            await bob.wait(lambda d: any(c.get('text') == 'こんにちは' for c in d['chat']))
            bob_hand = bob.state['hand']
            # 部屋2: ロビー（ボット入り）
            carol = Client(s, 'Carol'); await carol.open()
            await carol.send({'type': 'create', 'name': 'Carol'})
            st = await carol.wait(); room2 = st['room']
            await carol.send({'type': 'add_bot'})
            await carol.wait(lambda d: len(d['players']) == 2)
            harry = Client(s, 'Harry', reconnect=False); await harry.open()
            await harry.send({'type': 'join', 'room': room2, 'name': 'Harry'})
            await carol.wait(lambda d: len(d['players']) == 3)

            # 先に合言葉の違うサーバーへ切り替える → 送れない → A のまま遊び続けられる
            procs.append(start_server(B_BAD, 'wrong-key', logs['B_BAD']))
            await wait_up(B_BAD)
            backend['port'] = B_BAD
            await asyncio.sleep(2.5)
            assert alice.reconnects == 0 and bob.reconnects == 0, 'sockets were closed although the move failed'
            assert (await health(A))['rooms'] == 2, 'A lost its rooms after a failed move'
            assert 'migrate out failed' in open(logs['A']).read(), 'A did not try (or did not log the failure)'
            await bob.send({'type': 'chat', 'text': 'まだAです'})
            await alice.wait(lambda d: any(c.get('text') == 'まだAです' for c in d['chat']))
            procs.pop().terminate()
            backend['port'] = A   # 失敗した更新を取り消した扱い（新しい接続もまた A へ）
            print('OK: 合言葉が違うサーバーには送れず、A のまま遊び続けられる')

            # 部屋3: 結果表示中（ひとり＋ボット、制限時間なし）
            dave = Client(s, 'Dave'); await dave.open()
            await dave.send({'type': 'create', 'name': 'Dave'})
            st = await dave.wait(); room3 = st['room']
            await dave.send({'type': 'settings', 'settings': {'rounds': 3, 'hand_size': 4, 'timer': 0}})
            await dave.wait(lambda d: d['settings']['timer'] == 0)
            await dave.send({'type': 'start', 'with_bot': True})
            st = await dave.wait(lambda d: d['phase'] == 'pick')
            await dave.send({'type': 'pick', 'card': st['hand'][0]})
            st3 = await dave.wait(lambda d: d['phase'] == 'reveal')
            dave_score = {p['name']: p['score'] for p in st3['players']}
            # 部屋4: ひとり＋ボットで対戦中、Frank の接続が切れている（アプリを裏に回した等）→ 人が「つながっていない」部屋も送る
            frank = Client(s, 'Frank'); await frank.open()
            await frank.send({'type': 'create', 'name': 'Frank'})
            st = await frank.wait(); room4 = st['room']
            await frank.send({'type': 'settings', 'settings': {'rounds': 3, 'hand_size': 4, 'timer': 60}})
            await frank.wait(lambda d: d['settings']['timer'] == 60)
            await frank.send({'type': 'start', 'with_bot': True})
            st4 = await frank.wait(lambda d: d['phase'] == 'pick')
            st4 = await frank.wait(lambda d: all(p['picked'] for p in d['players'] if p['is_bot']))   # ボットが出してから切る（切れた後にボットが出すと、古いサーバーでもその場で結果に進む）
            await frank.ws.close()
            await asyncio.sleep(0.5)

            # 正しい合言葉の新しいサーバー B に切り替える → A が気づいて部屋を B へ送り、接続を切る → 画面がつなぎ直す
            procs.append(start_server(B, KEY, logs['B']))
            b_boot = (await wait_up(B))['boot']
            assert b_boot != a_boot
            before_left = left_sec(alice.state)
            backend['port'] = B
            t0 = time.time()
            # 切り替えの直後（部屋が B に届く前）に Frank がつなぎ直す → B は部屋が届くのを待ってから入れる（ホームに戻さない）
            await frank.open()
            await frank.send({'type': 'join', 'room': room4, 'name': 'Frank', 'pid': st4['you'], 'token': st4['token']})
            st_f = await frank.wait(lambda d: d['room'] == room4, timeout=12)
            assert st_f['phase'] == 'pick' and st_f['hand'] == st4['hand'], st_f
            print(f'OK: 切れていた人の部屋も送られ、部屋が届く前につなぎ直した人も待ってから入れた（{time.time() - t0:.1f} 秒）')
            st_a = await alice.wait(lambda d: alice.reconnects == 1, timeout=10)
            st_b = await bob.wait(lambda d: bob.reconnects == 1, timeout=10)
            st_c = await carol.wait(lambda d: carol.reconnects == 1, timeout=10)
            st_d = await dave.wait(lambda d: dave.reconnects == 1, timeout=10)
            gap = max(c.closed_at for c in (alice, bob, carol, dave)) - t0
            h_a, h_b = await health(A), await health(B)
            assert h_a['rooms'] == 0 and h_b['rooms'] == 4, (h_a, h_b)
            assert 'migrate out: 4 room(s) moved' in open(logs['A']).read(), open(logs['A']).read()[-800:]
            # 部屋1: 同じ部屋・同じ手札・出したカード・チャットがそのまま。残り時間は減らずに少し増える
            assert st_a['room'] == room1 and st_a['phase'] == 'pick' and st_a['round'] == 1
            assert st_a['my_pick'] == alice_card and alice_card in st_a['hand'], st_a['hand']
            assert st_b['hand'] == bob_hand and st_b['my_pick'] is None
            assert any(c.get('text') == 'こんにちは' for c in st_a['chat'])
            assert left_sec(st_a) > before_left - (time.time() - t0) + 1.5, (left_sec(st_a), before_left)
            # 部屋2: ロビーのまま、ボットもホストもそのまま（つなぎ直さない Harry も待ち時間まではいる）
            assert st_c['room'] == room2 and st_c['phase'] == 'lobby' and len(st_c['players']) == 3 and st_c['host'] == st_c['you']
            # 部屋3: 結果表示の続きから（点数そのまま）→ 次のラウンドへ進む
            assert st_d['room'] == room3 and {p['name']: p['score'] for p in st_d['players']} == dave_score
            print(f'OK: 4部屋とも新しいサーバーへ引っ越し、画面がつなぎ直した（切り替えから切断まで {gap:.1f} 秒）')
            # ロビーでつなぎ直さない Harry は、開始のときに外れる（手札を配らない）
            await carol.send({'type': 'start', 'with_bot': True})
            st = await carol.wait(lambda d: d['phase'] == 'pick')
            assert sorted(p['name'] for p in st['players'] if not p['is_bot']) == ['Carol'], st['players']
            print('OK: ロビーでつなぎ直さない人は、開始のときに外れる')

            # 観戦者 Erin はつなぎ直さない → 待ち時間までは「いる」扱い。その間にラウンドは勝手に決まらない
            await asyncio.sleep(1)
            assert bob.state['phase'] == 'pick', 'round was decided while waiting for players to reconnect'
            erin_p = next(p for p in bob.state['players'] if p['name'] == 'Erin')
            assert erin_p['connected'], erin_p
            await bob.wait(lambda d: not next(p for p in d['players'] if p['name'] == 'Erin')['connected'], timeout=GRACE + 5)
            print('OK: つなぎ直さない人は、待ち時間のあと切断扱い（その間ラウンドは決まらない）')

            # 続きを遊べる: 部屋1で Bob が出す → 結果 → 次のラウンド。部屋3は次のラウンドへ進む
            await bob.send({'type': 'pick', 'card': st_b['hand'][0]})
            r = await bob.wait(lambda d: d['phase'] == 'reveal')
            assert len(r['reveal']['rows']) == 2
            await bob.wait(lambda d: d['phase'] == 'pick' and d['round'] == 2, timeout=20)
            st = await dave.wait(lambda d: d['phase'] == 'pick' and d['round'] == 2, timeout=25)
            await dave.send({'type': 'pick', 'card': st['hand'][0]})
            await dave.wait(lambda d: d['phase'] == 'reveal' and d['round'] == 2)
            print('OK: 引っ越したあとも続きを遊べる（出す→結果→次のラウンド）')

            # 古いサーバーへ直接つないでも、すぐ切られる（部屋はもうない）
            w = await s.ws_connect(f'ws://127.0.0.1:{A}/ws')
            m = await asyncio.wait_for(w.receive(), 3)
            assert m.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED), m
            print('OK: 送ったあとの古いサーバーは、新しい接続をすぐ切る')

            # 切り替えが一瞬古いサーバー A に戻っても、B は古い方へ送り返さない。送り終えた A は受け取らない
            rooms_b = (await health(B))['rooms']
            backend['port'] = A
            await asyncio.sleep(2.5)
            backend['port'] = B
            assert (await health(B))['rooms'] == rooms_b and 'migrate out' not in open(logs['B']).read(), open(logs['B']).read()[-600:]
            assert bob.reconnects == 1
            async with s.post(f'http://127.0.0.1:{A}/internal/migrate', json={'v': 1, 'from': 'x', 'rooms': []}, headers={'X-Migrate-Key': KEY}) as r:
                assert r.status == 409, r.status
            print('OK: 切り替えが古いサーバーに戻っても送り返さない。送り終えたサーバーは受け取らない')

            # 送れたのに返事が届かず、同じ古いサーバーが送り直してきたとき: 前に受け取った部屋を新しい中身で置き換える。
            # 別のサーバーから同じコードの部屋が来たら受け取らない（新しいサーバーで先にできていた部屋を守る）
            def fake_room(title):
                return {'code': 'ZZZ9', 'host': 'h1', 'order': ['h1'], 'settings': {}, 'phase': 'lobby', 'round': 0, 'prompts': [], 'reveal': None,
                        'chat': [], 'title': title, 'deck': [], 'history': [], 'deadline_in': None, 'next_in': None, 'age': 1, 'empty_for': None,
                        'players': [{'pid': 'h1', 'name': 'H', 'name_en': None, 'is_bot': False, 'hand': [], 'score': 0, 'won': [], 'pick': None,
                                     'selecting': None, 'connected': True, 'token': 't', 'spectator': False, 'muted': [], 'reported_by': [], 'chat_banned': False}]}
            async def post(src, title):
                async with s.post(f'http://127.0.0.1:{B}/internal/migrate', json={'v': 1, 'from': src, 'rooms': [fake_room(title)]}, headers={'X-Migrate-Key': KEY}) as r:
                    return await r.json()
            assert (await post('old-1', '送り直し前'))['skipped'] == []
            assert (await post('old-1', '送り直し後'))['skipped'] == []
            async with s.get(f'http://127.0.0.1:{B}/api/room/ZZZ9') as r:
                assert (await r.json())['title'] == '送り直し後'
            assert (await post('someone-else', '別のサーバー'))['skipped'] == ['ZZZ9']
            async with s.post(f'http://127.0.0.1:{B}/internal/migrate', json={'v': 1, 'from': 'x', 'rooms': []}, headers={'X-Migrate-Key': 'wrong'}) as r:
                assert r.status == 404
            print('OK: 送り直しは置き換え、別のサーバーからの同じコードは受け取らない、合言葉が違えば受け付けない')
        print('ALL OK')
    finally:
        for p in procs:
            p.terminate()
        for p in procs:
            try:
                p.wait(5)
            except Exception:
                p.kill()
        await prunner.cleanup()


asyncio.run(main())
