"""スプレッドシートへの記録（server.py の sheet_log）の確認。手元に「Apps Script のウェブアプリ」の作り物を立て、
サーバーを SHEET_LOG_URL / SHEET_LOG_KEY つきで動かして、部屋やゲームの出来事が届くかを見る。1分ほど。
- 作り物は本物と同じく、受け取ったら別のアドレスへ転送（302）して、そこで返事を返す
- 1回目の送信はわざと失敗させ、次の回に送り直されること（なくならない・二重にならない）
- 2回目は「書き込めたのに返事だけ失敗」させ、同じ id で送り直されて、作り物（本物と同じく同じ id は2回書かない）で二重にならないこと
- 止める合図（SIGTERM）のとき、間隔を待たずに残りを送ること
実行: python3 tests/test_sheet_log.py"""
import asyncio, json, os, signal, subprocess, sys, time
import aiohttp
from aiohttp import web

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FAKE, SERVER, SERVER2 = 18841, 18842, 18843
KEY = 'test-sheet-key'
got = []            # 届いた行
posts = {'n': 0, 'fail_first': True, 'bad_key': 0, 'ids': [], 'lose_reply_once': True}
seen = set()        # 書き込んだまとまりの id（本物の Apps Script と同じく、同じ id は2回書かない）


async def fake_exec(request):   # 本物の Apps Script（…/exec）と同じ形: 受け取って書き込み、転送先で返事
    posts['n'] += 1
    body = await request.json()
    if body.get('key') != KEY:
        posts['bad_key'] += 1
        raise web.HTTPFound('/echo?ok=0')
    posts['ids'].append(body.get('id'))
    if posts['fail_first']:
        posts['fail_first'] = False
        return web.Response(status=500, text='temporary error')
    if body.get('id') not in seen:
        seen.add(body.get('id'))
        got.extend(body['rows'])
    if posts['lose_reply_once'] and posts['n'] >= 3:   # 書き込んだあと、転送先の返事だけ失敗させる
        posts['lose_reply_once'] = False
        posts['lost_at'] = len(posts['ids']) - 1
        raise web.HTTPFound('/echo?ok=lost')
    raise web.HTTPFound('/echo?ok=1')


async def fake_echo(request):
    if request.query.get('ok') == 'lost':
        return web.Response(status=502, text='<html>Bad Gateway</html>')
    return web.json_response({'ok': request.query.get('ok') == '1'})


def start_server(port, every):
    env = {**os.environ, 'PORT': str(port), 'SHEET_LOG_URL': f'http://127.0.0.1:{FAKE}/exec', 'SHEET_LOG_KEY': KEY, 'SHEET_LOG_EVERY': str(every)}
    env.pop('MIGRATE_KEY', None)
    return subprocess.Popen([sys.executable, 'server.py'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


async def wait_up(port):
    async with aiohttp.ClientSession() as s:
        for _ in range(100):
            try:
                async with s.get(f'http://127.0.0.1:{port}/healthz') as r:
                    if r.status == 200:
                        return
            except aiohttp.ClientError:
                pass
            await asyncio.sleep(0.1)
    raise RuntimeError('server did not start')


async def recv_state(ws, want=None, timeout=15):
    while True:
        d = json.loads((await asyncio.wait_for(ws.receive(), timeout)).data)
        if d['type'] == 'error':
            raise RuntimeError(d.get('code'))
        if d['type'] == 'state' and (want is None or want(d)):
            return d


async def until(cond, timeout=10, what=''):
    end = time.time() + timeout
    while not cond():
        if time.time() > end:
            raise AssertionError('待っても届かない: ' + what + f'（届いた出来事: {[r["event"] for r in got]}）')
        await asyncio.sleep(0.1)


def rows(event):
    return [r for r in got if r['event'] == event]


async def main():
    fake = web.Application(); fake.router.add_post('/exec', fake_exec); fake.router.add_get('/echo', fake_echo)
    runner = web.AppRunner(fake); await runner.setup(); await web.TCPSite(runner, '127.0.0.1', FAKE).start()
    procs = []
    try:
        p = start_server(SERVER, 1); procs.append(p); await wait_up(SERVER)
        ws_url = f'ws://127.0.0.1:{SERVER}/ws'
        async with aiohttp.ClientSession() as s:
            a = await s.ws_connect(ws_url)
            await a.send_json({'type': 'create', 'name': 'たろう'})
            st = await recv_state(a); code = st['room']
            await a.send_json({'type': 'settings', 'settings': {'title': '国旗の部屋', 'public': True, 'rounds': 3, 'hand_size': 4, 'timer': 0}})
            await recv_state(a, lambda d: d['title'] == '国旗の部屋')
            b = await s.ws_connect(ws_url)
            await b.send_json({'type': 'join', 'room': code, 'name': 'はなこ'})
            await recv_state(b)
            await b.send_json({'type': 'leave'})
            d = await s.ws_connect(ws_url)   # ロビーで接続が切れる（アプリを裏に回した等）
            await d.send_json({'type': 'join', 'room': code, 'name': 'さぶろう'})
            await recv_state(d)
            await d.close()
            e = await s.ws_connect(ws_url)   # 使われている部屋名を入れたまま「公開部屋にする」を押した
            await e.send_json({'type': 'create', 'name': 'しろう'})
            await recv_state(e)
            await e.send_json({'type': 'settings', 'settings': {'title': '国旗の部屋', 'public': True}})
            try:
                await recv_state(e, timeout=3)
            except RuntimeError as err:
                assert str(err) == 'title_taken', err
            await e.send_json({'type': 'leave'})
            await a.send_json({'type': 'start', 'with_bot': True})
            st = await recv_state(a, lambda d: d['phase'] == 'pick')
            for rnd in range(1, 4):
                if rnd > 1:
                    st = await recv_state(a, lambda d: d['phase'] == 'pick' and d['round'] == rnd)
                await a.send_json({'type': 'pick', 'card': st['hand'][0]})
                await recv_state(a, lambda d: d['phase'] == 'reveal')
            await recv_state(a, lambda d: d['phase'] == 'end', timeout=20)
            await a.send_json({'type': 'leave'})
            async with s.post(f'http://127.0.0.1:{SERVER}/api/visit', json={'id': 'v1', 'mode': 'zukan', 'event': 'start', 'name': 'たろう', 'sec': 0}) as r:
                assert r.status == 200
            async with s.post(f'http://127.0.0.1:{SERVER}/api/visit', json={'id': 'v1', 'mode': 'zukan', 'event': 'ping', 'name': 'たろう', 'sec': 300}) as r:
                assert r.status == 200
            async with s.post(f'http://127.0.0.1:{SERVER}/api/visit', json={'id': 'v1', 'mode': 'zukan', 'event': 'leave', 'name': 'たろう', 'sec': 425}) as r:
                assert r.status == 200
            async with s.post(f'http://127.0.0.1:{SERVER}/api/visit', json={'id': 'v1', 'mode': 'zukan', 'event': 'leave', 'name': 'たろう', 'sec': 430}) as r:   # 同じ訪問の「離れた」がもう一度届いた
                assert r.status == 200
            async with s.post(f'http://127.0.0.1:{SERVER}/api/visit', json={'id': 'v2', 'mode': 'quiz', 'event': 'start', 'name': '09012345678', 'sec': 0}) as r:   # 部屋では断られる名前
                assert r.status == 200
            for i in range(300):   # 誰かが大量に送ってきた
                async with s.post(f'http://127.0.0.1:{SERVER}/api/visit', json={'id': f'f{i}', 'mode': 'game', 'event': 'start', 'name': 'flood', 'sec': 0}) as r:
                    assert r.status == 200
        await until(lambda: rows('図鑑を離れた'), 10, '図鑑を離れた')

        # 出来事ごとの中身
        mk = [r for r in rows('部屋作成') if r['name'] == 'たろう']; assert len(mk) == 1 and mk[0]['room'] == code and mk[0]['name'] == 'たろう' and mk[0]['title'] == 'たろう' and mk[0]['count'] == 1, mk
        print('OK: 部屋作成（部屋コード・部屋名・ニックネーム・人数）')
        ch = rows('部屋名変更'); assert len(ch) == 1 and ch[0]['detail'] == 'たろう → 国旗の部屋' and ch[0]['title'] == '国旗の部屋', ch
        assert len([r for r in rows('公開部屋にした') if r['name'] == 'たろう']) == 1
        print('OK: 部屋名変更（前 → 後）・公開部屋にした')
        jn = rows('入室'); assert [r['name'] for r in jn] == ['はなこ', 'さぶろう'] and jn[0]['count'] == 2 and jn[0]['title'] == '国旗の部屋', jn
        lv = rows('退出'); assert [r['name'] for r in lv] == ['はなこ', 'しろう', 'たろう'], lv
        print('OK: 入室・退出（ニックネームと部屋名）')
        gs = rows('ゲーム開始'); assert len(gs) == 1 and gs[0]['name'] == 'たろう' and '（ボット）' in gs[0]['detail'] and gs[0]['detail'].endswith('3ラウンド'), gs
        ge = rows('ゲーム終了'); assert len(ge) == 1 and '点' in ge[0]['detail'] and 'たろう' in ge[0]['detail'] and '（ボット）' in ge[0]['detail'], ge
        print('OK: ゲーム開始（参加者・ラウンド数）・ゲーム終了（勝った人・点数）:', ge[0]['name'], '/', ge[0]['detail'])
        cut = rows('切断'); assert len(cut) == 1 and cut[0]['name'] == 'さぶろう' and cut[0]['room'] == code, cut
        print('OK: ロビーで接続が切れた人も「切断」として残す')
        pub = [r for r in rows('公開部屋にした') if r['name'] == 'しろう']; assert len(pub) == 1, rows('公開部屋にした')
        print('OK: 使われている部屋名で断られても、公開部屋にしたことは残す')
        qv = rows('クイズを開いた'); assert len(qv) == 1 and qv[0]['name'] == '(名前なし)', qv
        print('OK: 部屋で断られる名前（電話番号など）は、画面を開いた記録にも残さない')
        await until(lambda: len(rows('対戦を開いた')) >= 100, 10, '大量に送られた分')
        await asyncio.sleep(2)
        fl = [r for r in rows('対戦を開いた') if r['name'] == 'flood']
        assert 100 <= len(fl) <= 240 and len(fl) < 300, len(fl)
        print(f'OK: 画面を開いた記録を大量に送られても、1分あたりの上限までしか残さない（300回送って {len(fl)} 行）')
        vo, vl = rows('図鑑を開いた'), rows('図鑑を離れた')
        assert len(vo) == 1 and len(vl) == 1 and vl[0]['detail'].startswith('滞在 7分05秒') and vo[0]['room'] == '' and vo[0]['count'] == '', (vo, vl)
        assert not [r for r in got if '滞在中' in r['event']], '5分ごとの「滞在中」まで残している'
        print('OK: 図鑑を開いた・離れた（滞在時間）は1回の訪問で1行ずつ。5分ごとの「滞在中」や、同じ訪問の「離れた」の2回目は残さない')
        keys = [(r['ts'], r['event'], r['name'], r['room'], r['detail']) for r in got]
        assert len(keys) == len(set(keys)), '同じ行が二重に届いた'
        assert posts['bad_key'] == 0
        print(f'OK: 1回目の送信を失敗させても、次の回に送り直して全部届いた（二重なし、送信 {posts["n"]} 回）')
        assert posts['lose_reply_once'] is False, '返事を失敗させる場面まで進んでいない'
        k = posts['lost_at']
        await until(lambda: len(posts['ids']) > k + 1, 5, '返事が失敗したあとの送り直し')
        assert posts['ids'][k + 1] == posts['ids'][k], f'返事が失敗したのに同じ id で送り直していない: {posts["ids"]}'
        keys = [(r['ts'], r['event'], r['name'], r['room'], r['detail']) for r in got]
        assert len(keys) == len(set(keys)), '送り直しで同じ行が二重に届いた'
        print('OK: 書き込めたのに返事だけ失敗したときは、同じ id で送り直し、二重に書かれない')

        # 止める合図（SIGTERM）のとき、間隔（60秒）を待たずに残りを送る
        before = len(got)
        p2 = start_server(SERVER2, 60); procs.append(p2); await wait_up(SERVER2)
        async with aiohttp.ClientSession() as s:
            c = await s.ws_connect(f'ws://127.0.0.1:{SERVER2}/ws')
            await c.send_json({'type': 'create', 'name': 'じろう'})
            await recv_state(c)
            t0 = time.time()
            p2.send_signal(signal.SIGTERM)
            await until(lambda: any(r['event'] == '部屋作成' and r['name'] == 'じろう' for r in got[before:]), 12, '止める前の残り')
        print(f'OK: 止める合図のとき、間隔を待たずに残りを送る（{time.time() - t0:.1f}秒で届いた）')
    finally:
        for pr in procs:
            if pr.poll() is None:
                pr.terminate()
                try:
                    pr.wait(10)
                except subprocess.TimeoutExpired:
                    pr.kill()
        await runner.cleanup()
    print('ALL OK')


asyncio.run(main())
