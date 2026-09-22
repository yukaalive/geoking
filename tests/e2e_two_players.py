"""ヘッドレス2人対戦テスト: 部屋作成→参加→設定→全ラウンド進行→終了まで。"""
import asyncio, json, random, sys, aiohttp

import os
URL = os.environ.get('GEOKING_WS', 'ws://localhost:8080/ws')

async def recv_state(ws, want=None, timeout=5):
    while True:
        msg = await asyncio.wait_for(ws.receive(), timeout)
        d = json.loads(msg.data)
        if d['type'] == 'error':
            raise RuntimeError(d['message'])
        if d['type'] == 'state' and (want is None or want(d)):
            return d

async def main():
    async with aiohttp.ClientSession() as s:
        a = await s.ws_connect(URL); b = await s.ws_connect(URL)
        await a.send_json({'type': 'create', 'name': 'Alice'})
        st = await recv_state(a); room = st['room']; pidA, tokA = st['you'], st['token']; print('room', room)
        assert tokA and len(tokA) == 32
        await b.send_json({'type': 'join', 'room': room, 'name': 'Bob<img src=x onerror=alert(1)>'})
        st = await recv_state(b, lambda d: len(d['players']) == 2); pidB, tokB = st['you'], st['token']
        assert st['token'] != tokA and all(('token' not in pl) for pl in st['players']), 'token leaked in players list'
        await recv_state(a, lambda d: len(d['players']) == 2)
        # 参加者は設定変更できない（無視される）
        await b.send_json({'type': 'settings', 'settings': {'rounds': 3}})
        await a.send_json({'type': 'settings', 'settings': {'rounds': 'abc', 'timer': None}})  # 不正値は無視され接続は維持される
        await a.send_json({'type': 'settings', 'settings': {'rounds': 4, 'hand_size': 5, 'categories': ['religion', 'climate'], 'timer': 0}})
        st = await recv_state(a, lambda d: d['settings']['rounds'] == 4)
        assert st['settings']['hand_size'] == 5 and st['settings']['categories'] == ['religion', 'climate'], st['settings']
        await b.send_json({'type': 'start'})  # 非ホストは開始不可
        try:
            await recv_state(b, lambda d: d['phase'] == 'pick', timeout=1); raise SystemExit('non-host could start!')
        except asyncio.TimeoutError: pass
        await a.send_json({'type': 'start'})
        sa = await recv_state(a, lambda d: d['phase'] == 'pick'); sb = await recv_state(b, lambda d: d['phase'] == 'pick')
        assert len(sa['hand']) == 5 and not set(sa['hand']) & set(sb['hand']), 'hands overlap'
        assert sa['prompt']['cat'] in ('religion', 'climate')
        scores = {}
        for rnd in range(1, 5):
            if rnd > 1:
                sa = await recv_state(a, lambda d: d['phase'] == 'pick' and d['round'] == rnd)
                sb = await recv_state(b, lambda d: d['phase'] == 'pick' and d['round'] == rnd)
            await a.send_json({'type': 'pick', 'card': 'zz'})  # 手札に無いカードは無視
            await a.send_json({'type': 'pick', 'card': sa['hand'][0]})
            await b.send_json({'type': 'pick', 'card': sb['hand'][-1]})
            ra = await recv_state(a, lambda d: d['phase'] == 'reveal')
            rows = ra['reveal']['rows']; pr = ra['reveal']['prompt']
            vals = [r['value'] for r in rows if r['value'] is not None]
            if vals:
                best = max(vals) if pr['dir'] == 'max' else min(vals)
                assert all((r['value'] == best) == r['winner'] for r in rows), rows
            print(f"R{rnd} {pr['text']:<22} " + ' | '.join(f"{r['name']}:{r['card']}={r['value']}{'👑' if r['winner'] else ''}" for r in rows))
            assert len(ra['hand']) == 5 - rnd, 'card not removed from hand'
            await asyncio.sleep(0.8)  # チャット連投制限（0.7秒）を待つ
            await b.send_json({'type': 'chat', 'text': f'ブラフ！{rnd}'})
            await recv_state(a, lambda d: any(c['text'] == f'ブラフ！{rnd}' for c in d['chat']))
            await a.send_json({'type': 'next'})
        ea = await recv_state(a, lambda d: d['phase'] == 'end')
        total = sum(p['score'] for p in ea['players'])
        print('END scores', {p['name']: p['score'] for p in ea['players']}, 'total', total)
        assert total >= 4, 'each round should award at least one point'
        # 再接続: Bobが切断→同じpidで戻る
        await b.close()
        b2 = await s.ws_connect(URL)
        # なりすまし: 他人のpidでトークン無し → 拒否
        await b2.send_json({'type': 'join', 'room': room, 'name': 'Evil', 'pid': pidA, 'token': 'nope'})
        try:
            await recv_state(b2, timeout=1); raise SystemExit('impersonation accepted!')
        except RuntimeError as e:
            assert '認証' in str(e), e
        await b2.send_json({'type': 'join', 'room': room, 'name': 'Bob', 'pid': pidB, 'token': tokB})
        st = await recv_state(b2, lambda d: d['phase'] == 'end')
        assert [p['name'] for p in st['players']][0] == 'Alice' and st['you'] == pidB, st['players']
        # リマッチ
        await a.send_json({'type': 'start'})
        st = await recv_state(a, lambda d: d['phase'] == 'pick' and d['round'] == 1)
        assert all(p['score'] == 0 for p in st['players'])
        print('OK: full flow, token auth, impersonation blocked, reconnect, rematch')

asyncio.run(main())
