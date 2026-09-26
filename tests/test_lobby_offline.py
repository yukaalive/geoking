"""ロビーに戻ったとき、接続が切れたままの人は自動で退出させる（ロビーで切れた人はすぐ抜けるのと同じ）。戻ってきた人は、もう一度ロビーに入れる。
2026-09-27: 対戦中に切れた人が、ホストが「ロビーへ」を押したあともロビーに「切断」のまま残っていた。
外れた人が戻る前に席が埋まったときは、満員（room_full）ではなく rejoin_full を返して画面をホームに戻す。
確認用サーバーを動かしてから: GEOKING_WS=ws://localhost:8090/ws python3 tests/test_lobby_offline.py（20秒ほど）"""
import asyncio, json, os
import aiohttp
URL = os.environ.get('GEOKING_WS', 'ws://localhost:8090/ws')


async def recv(ws, want=None, timeout=20):
    while True:
        d = json.loads((await asyncio.wait_for(ws.receive(), timeout)).data)
        if d['type'] == 'error':
            raise RuntimeError(d.get('code'))
        if d['type'] == 'state' and (want is None or want(d)):
            return d


def names(st):
    return sorted(p['name'] for p in st['players'])


async def room_of(s, host_name, others, rounds=3):
    ws = [await s.ws_connect(URL) for _ in range(1 + len(others))]
    await ws[0].send_json({'type': 'create', 'name': host_name})
    st = await recv(ws[0]); code = st['room']
    await ws[0].send_json({'type': 'settings', 'settings': {'rounds': rounds, 'hand_size': 4, 'timer': 0}})
    await recv(ws[0], lambda d: d['settings']['rounds'] == rounds)
    sts = [st]
    for w, n in zip(ws[1:], others):
        await w.send_json({'type': 'join', 'room': code, 'name': n}); sts.append(await recv(w))
    return ws, code, sts


async def main():
    async with aiohttp.ClientSession() as s:
        # 1) 対戦の途中で1人が切れて、ホストが「ロビーへ」→ 切れた人はロビーにいない
        ws, code, sts = await room_of(s, 'あき', ['ふゆ', 'なつ'])
        me_natsu = sts[2]
        await ws[0].send_json({'type': 'start'})
        for w in ws:
            await recv(w, lambda d: d['phase'] == 'pick')
        await ws[2].close()   # なつ の接続が切れる（アプリを閉じた・電波が切れた）
        st = await recv(ws[0], lambda d: any(p['name'] == 'なつ' and not p['connected'] for p in d['players']))
        print('OK: 対戦中に切れた人は「切断」で残る（対戦中は今までどおり）:', [(p['name'], p['connected']) for p in st['players']])
        await ws[0].send_json({'type': 'to_lobby'})
        lob = await recv(ws[0], lambda d: d['phase'] == 'lobby')
        assert names(lob) == ['あき', 'ふゆ'], names(lob)
        assert all(p['connected'] for p in lob['players']), lob['players']
        lob1 = await recv(ws[1], lambda d: d['phase'] == 'lobby')
        assert names(lob1) == ['あき', 'ふゆ'], names(lob1)
        print('OK: ホストが「ロビーへ」を押すと、切れたままの人は退出（ほかの人の画面でも）:', names(lob))

        # 戻ってきた人（前の pid・token のまま）は、もう一度ロビーに入れる
        back = await s.ws_connect(URL)
        await back.send_json({'type': 'join', 'room': code, 'name': 'なつ', 'pid': me_natsu['you'], 'token': me_natsu['token']})
        st = await recv(back)
        assert st['phase'] == 'lobby' and names(st) == ['あき', 'なつ', 'ふゆ'], (st['phase'], names(st))
        assert st['host'] != st['you'], 'ホストが戻ってきた人に替わった'
        print('OK: 切れていた人が戻ると、もう一度ロビーに入れる（ホストは替わらない）:', names(st))
        for w in [ws[0], ws[1], back]:
            await w.close()

        # 2) 最後まで遊んで結果画面で1人が切れ、ホストが「ロビーへ」→ 切れた人はロビーにいない
        ws, code, sts = await room_of(s, 'たろう', ['はなこ', 'じろう'])
        await ws[0].send_json({'type': 'start'})
        for rnd in range(1, 4):
            cur = [await recv(w, lambda d: d['phase'] == 'pick' and d['round'] == rnd) for w in ws]
            for w, st in zip(ws, cur):
                await w.send_json({'type': 'pick', 'card': st['hand'][0]})
        for w in ws:
            await recv(w, lambda d: d['phase'] == 'end', timeout=30)
        await ws[1].close()   # はなこ が結果画面で切れる
        await recv(ws[0], lambda d: any(p['name'] == 'はなこ' and not p['connected'] for p in d['players']))
        await ws[0].send_json({'type': 'to_lobby'})
        lob = await recv(ws[0], lambda d: d['phase'] == 'lobby')
        assert names(lob) == ['じろう', 'たろう'], names(lob)
        print('OK: 結果画面で切れた人も、「ロビーへ」で退出:', names(lob))

        # 3) つながっている人は、ロビーに戻っても残る（ボットも）
        await ws[0].send_json({'type': 'add_bot'})
        st = await recv(ws[0], lambda d: len(d['players']) == 3)
        await ws[0].send_json({'type': 'start'})
        await recv(ws[0], lambda d: d['phase'] == 'pick')
        await ws[0].send_json({'type': 'to_lobby'})
        lob = await recv(ws[0], lambda d: d['phase'] == 'lobby')
        assert len(lob['players']) == 3 and any(p['is_bot'] for p in lob['players']), lob['players']
        print('OK: つながっている人とボットは、ロビーに戻っても残る:', names(lob))
        for w in [ws[0], ws[2]]:
            await w.close()

        # 4) 外れた人が戻る前に席が埋まったら、「満員」ではなく rejoin_full（画面はホームに戻る。room_full だと前の画面で止まっていた）
        ws, code, sts = await room_of(s, 'ホスト', [f'P{i}' for i in range(1, 8)])   # 8人
        gone = sts[7]
        await ws[0].send_json({'type': 'start'})
        for w in ws:
            await recv(w, lambda d: d['phase'] == 'pick')
        await ws[7].close()
        await recv(ws[0], lambda d: any(p['name'] == 'P7' and not p['connected'] for p in d['players']))
        await ws[0].send_json({'type': 'to_lobby'})
        await recv(ws[0], lambda d: d['phase'] == 'lobby' and len(d['players']) == 7)
        await ws[0].send_json({'type': 'add_bot'})
        await recv(ws[0], lambda d: len(d['players']) == 8)
        back = await s.ws_connect(URL)
        await back.send_json({'type': 'join', 'room': code, 'name': 'P7', 'pid': gone['you'], 'token': gone['token']})
        try:
            await recv(back); raise AssertionError('満員なのに入れた')
        except RuntimeError as e:
            assert str(e) == 'rejoin_full', e
        print('OK: 外れた人が戻る前に席が埋まったら rejoin_full（画面はホームに戻り「部屋が満員になったため、戻れませんでした」）')
        # はじめて入る人は、これまでどおり room_full
        new = await s.ws_connect(URL)
        await new.send_json({'type': 'join', 'room': code, 'name': 'Q'})
        try:
            await recv(new); raise AssertionError('満員なのに入れた')
        except RuntimeError as e:
            assert str(e) == 'room_full', e
        print('OK: はじめて入る人は、これまでどおり「満員です」')
        for w in ws[:7] + [back, new]:
            await w.close()

    # 5) 更新時の引っ越し: 前の版のサーバーで「切断」のままロビーに残っていた人も、新しいサーバーで外す
    import sys, time
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
    import server
    server.MIGRATE_GRACE = 0.05
    r = server.Room('LBOF', 'a')
    for pid, n in (('a', 'A'), ('c', 'C'), ('b', 'B')):
        r.players[pid] = server.Player(pid, n); r.order.append(pid)
    r.players['c'].connected = False   # 前の版で残っていた「切断」の人
    r.players['a'].connected = r.players['b'].connected = True
    d = json.loads(json.dumps(server.room_to_dict(r, time.time())))
    r2 = server.room_from_dict(d, time.time(), source='t'); server.rooms['LBOF'] = r2

    class FakeWS:   # つなぎ直した人（A・B）
        closed = False
        async def send_str(self, *_): pass
        async def send_json(self, *_): pass
    for pid in ('a', 'b'):
        r2.players[pid].ws, r2.players[pid].connected = FakeWS(), True
    await server.migrated_grace(r2)
    assert sorted(p.name for p in r2.players.values()) == ['A', 'B'], [(p.name, p.connected) for p in r2.players.values()]
    assert r2.host == 'a'
    server.rooms.pop('LBOF', None)
    print('OK: 引っ越してきたロビーで、前の版から「切断」のまま残っていた人も外す（ホストはそのまま）')
    print('ALL OK')

asyncio.run(main())
