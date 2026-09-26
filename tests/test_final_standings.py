"""結果画面の順位が、ゲームが終わった時点のまま変わらないこと（そのあと誰かが退出しても）。
2026-09-26: 結果画面で誰かが「退出」すると、その人が順位から消えて、ほかの人の順位が繰り上がっていた。
確認用サーバーを動かしてから: GEOKING_WS=ws://localhost:8090/ws python3 tests/test_final_standings.py（30秒ほど）"""
import asyncio, json, os, sys, time
import aiohttp
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
URL = os.environ.get('GEOKING_WS', 'ws://localhost:8090/ws')


async def recv(ws, want=None, timeout=20):
    while True:
        d = json.loads((await asyncio.wait_for(ws.receive(), timeout)).data)
        if d['type'] == 'error':
            raise RuntimeError(d.get('code'))
        if d['type'] == 'state' and (want is None or want(d)):
            return d


def order(st):
    return [(x['name'], x['score']) for x in st['final']]


async def play_to_end(s, names):
    ws = [await s.ws_connect(URL) for _ in names]
    await ws[0].send_json({'type': 'create', 'name': names[0]})
    st = await recv(ws[0]); code = st['room']
    await ws[0].send_json({'type': 'settings', 'settings': {'rounds': 3, 'hand_size': 4, 'timer': 0}})
    await recv(ws[0], lambda d: d['settings']['rounds'] == 3)
    for w, n in zip(ws[1:], names[1:]):
        await w.send_json({'type': 'join', 'room': code, 'name': n}); await recv(w)
    await ws[0].send_json({'type': 'start'})
    sts = [await recv(w, lambda d: d['phase'] == 'pick') for w in ws]
    for rnd in range(1, 4):
        if rnd > 1:
            sts = [await recv(w, lambda d: d['phase'] == 'pick' and d['round'] == rnd) for w in ws]
        for w, st in zip(ws, sts):
            await w.send_json({'type': 'pick', 'card': st['hand'][0]})
        for w in ws:
            await recv(w, lambda d: d['phase'] == 'reveal')
    ends = [await recv(w, lambda d: d['phase'] == 'end', timeout=30) for w in ws]
    return ws, code, ends


async def main():
    async with aiohttp.ClientSession() as s:
        names = ['たろう', 'はなこ', 'じろう']
        ws, code, ends = await play_to_end(s, names)
        first = order(ends[0])
        assert len(first) == 3 and [x[1] for x in first] == sorted([x[1] for x in first], reverse=True), first
        assert all(order(e) == first for e in ends), '人によって順位が違う'
        print('OK: 終わった時点の順位が全員に届く:', first)

        # 1位の人が退出 → 残った人の画面でも順位はそのまま（退出した人も残る）
        top = names.index(first[0][0])
        await ws[top].send_json({'type': 'leave'})
        other = (top + 1) % 3
        after = await recv(ws[other], lambda d: len(d['players']) == 2)
        assert after['phase'] == 'end' and order(after) == first, (order(after), first)
        print('OK: 結果画面で1位の人が退出しても、順位はそのまま:', order(after))

        # 途中から来た人（観戦）は、終わった時点の順位には入らない
        late = await s.ws_connect(URL)
        await late.send_json({'type': 'join', 'room': code, 'name': 'さぶろう'})
        st = await recv(late)
        assert st['phase'] == 'end' and order(st) == first, order(st)
        print('OK: 結果画面のときに入ってきた人には、同じ順位が見え、その人は順位に入らない')

        # 再戦・ロビーに戻ると、順位は消える（次のゲームの結果で作り直す）
        host = next(i for i, e in enumerate(ends) if e['you'] == after['host'])   # 退出でホストが替わっていることがある
        await ws[host].send_json({'type': 'to_lobby'})
        lob = await recv(ws[host], lambda d: d['phase'] == 'lobby')
        assert lob['final'] is None, lob['final']
        print('OK: ロビーに戻ると、前のゲームの順位は消える')
        for w in ws + [late]:
            await w.close()

    # 更新時の引っ越し: 順位も新しいサーバーへ送る。前の版のサーバー（順位なし）から来た部屋も受け取れる
    import server
    r = server.Room('ZZZZ', 'h')
    r.players['h'] = server.Player('h', 'Alice'); r.order.append('h')
    server.add_bot(r)
    r.settings.update({'rounds': 3, 'hand_size': 4, 'timer': 30})
    r.start()
    while r.phase != 'end':
        for p in r.players.values():
            p.pick = p.hand[0]
        r.do_reveal(); r.next_round()
    assert r.final and len(r.final) == 2
    d = json.loads(json.dumps(server.room_to_dict(r, time.time())))
    r2 = server.room_from_dict(d, time.time(), source='t')
    assert r2.final == r.final, (r2.final, r.final)
    server.rooms.pop('ZZZZ', None)
    del d['final']
    r3 = server.room_from_dict(d, time.time(), source='t')
    assert r3.final is None
    server.rooms.pop('ZZZZ', None)
    print('OK: 更新時の引っ越しでも順位を引き継ぐ（前の版から来た部屋も受け取れる）')
    print('ALL OK')

asyncio.run(main())
