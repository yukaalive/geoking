"""ひとりで「botとゲーム開始」: ボットが1体入って最後まで遊べる／人数がいるときは足さない／ホスト以外は始められない。"""
import asyncio, json, os, aiohttp

URL = os.environ.get('GEOKING_WS', 'ws://localhost:8080/ws')

async def recv_state(ws, want=None, timeout=12):
    while True:
        msg = await asyncio.wait_for(ws.receive(), timeout)
        d = json.loads(msg.data)
        if d['type'] == 'error':
            raise RuntimeError(d.get('code') or d['message'])
        if d['type'] == 'state' and (want is None or want(d)):
            return d

async def main():
    async with aiohttp.ClientSession() as s:
        a = await s.ws_connect(URL)
        await a.send_json({'type': 'create', 'name': 'Alice'})
        st = await recv_state(a); room, pidA = st['room'], st['you']
        await a.send_json({'type': 'settings', 'settings': {'rounds': 3, 'hand_size': 4, 'timer': 0}})
        await recv_state(a, lambda d: d['settings']['rounds'] == 3)
        # 以前の開始（with_bot なし）はひとりだと断られる
        await a.send_json({'type': 'start'})
        try:
            await recv_state(a, lambda d: d['phase'] == 'pick', timeout=2); raise SystemExit('started alone without a bot!')
        except RuntimeError as e:
            assert str(e) == 'need_two', e
        # 「botとゲーム開始」: ボットが1体入って始まる
        await a.send_json({'type': 'start', 'with_bot': True})
        st = await recv_state(a, lambda d: d['phase'] == 'pick')
        bots = [p for p in st['players'] if p['is_bot']]
        assert len(st['players']) == 2 and len(bots) == 1, st['players']
        assert bots[0]['hand_count'] == 4 and bots[0]['name_en'], bots[0]
        assert st['round'] == 1 and len(st['hand']) == 4
        for rnd in range(1, 4):
            if rnd > 1:
                st = await recv_state(a, lambda d: d['phase'] == 'pick' and d['round'] == rnd)
            await a.send_json({'type': 'pick', 'card': st['hand'][0]})
            r = await recv_state(a, lambda d: d['phase'] == 'reveal')
            assert len(r['reveal']['rows']) == 2, r['reveal']['rows']   # ボットも毎回出している
            print(f"R{rnd} " + ' | '.join(f"{x['name']}:{x['card']}={x['value']}{'👑' if x['winner'] else ''}" for x in r['reveal']['rows']))
        e = await recv_state(a, lambda d: d['phase'] == 'end')
        assert [h['round'] for h in e['history']] == [1, 2, 3] and all(len(h['rows']) == 2 for h in e['history'])
        # もう一戦: すでに2人いるのでボットは増えない
        await a.send_json({'type': 'start', 'with_bot': True})
        st = await recv_state(a, lambda d: d['phase'] == 'pick' and d['round'] == 1)
        assert len(st['players']) == 2, st['players']
        # ロビーでボットを外してひとりに戻る → もう一度「botとゲーム開始」で新しいボットが1体入る
        await a.send_json({'type': 'to_lobby'})
        st = await recv_state(a, lambda d: d['phase'] == 'lobby')
        await a.send_json({'type': 'kick', 'pid': bots[0]['pid']})
        st = await recv_state(a, lambda d: len(d['players']) == 1)
        await a.send_json({'type': 'start', 'with_bot': True})
        st = await recv_state(a, lambda d: d['phase'] == 'pick')
        assert len(st['players']) == 2 and sum(p['is_bot'] for p in st['players']) == 1 and bots[0]['pid'] not in {p['pid'] for p in st['players']}
        # 「ボットを追加」もこれまでどおり動く（ロビーのみ）
        await a.send_json({'type': 'to_lobby'})
        await recv_state(a, lambda d: d['phase'] == 'lobby')
        await a.send_json({'type': 'add_bot'})
        st = await recv_state(a, lambda d: len(d['players']) == 3)
        assert sum(p['is_bot'] for p in st['players']) == 2 and len({p['name'] for p in st['players']}) == 3, st['players']
        # ホスト以外は with_bot でも始められない
        b = await s.ws_connect(URL)
        await b.send_json({'type': 'join', 'room': room, 'name': 'Bob'})
        await recv_state(b, lambda d: any(p['name'] == 'Bob' for p in d['players']))
        await b.send_json({'type': 'start', 'with_bot': True})
        try:
            await recv_state(b, lambda d: d['phase'] == 'pick', timeout=1.5); raise SystemExit('non-host started!')
        except asyncio.TimeoutError:
            pass
        await a.close(); await b.close()
        # ひとりでロビーにいてリロード（切断→同じトークンで再接続）してもホストのまま。ボットがいてもボットにホストは移らない
        for with_bot in (False, True):
            c = await s.ws_connect(URL)
            await c.send_json({'type': 'create', 'name': 'Carol'})
            st = await recv_state(c); room2, pid2, tok2 = st['room'], st['you'], st['token']
            if with_bot:
                await c.send_json({'type': 'start', 'with_bot': True})
                await recv_state(c, lambda d: d['phase'] == 'pick')
                await c.send_json({'type': 'to_lobby'})
                await recv_state(c, lambda d: d['phase'] == 'lobby')
            await c.close()
            await asyncio.sleep(0.3)
            c = await s.ws_connect(URL)
            await c.send_json({'type': 'join', 'room': room2, 'name': 'Carol', 'pid': pid2, 'token': tok2})
            st = await recv_state(c, lambda d: any(p['name'] == 'Carol' for p in d['players']))
            assert st['host'] == st['you'], ('host lost after reload', with_bot, st['host'], st['players'])
            if with_bot:
                assert any(p['is_bot'] for p in st['players'])
                await c.send_json({'type': 'start', 'with_bot': True})   # ボットがいるので足さずに始まる
                st = await recv_state(c, lambda d: d['phase'] == 'pick')
                assert len(st['players']) == 2, st['players']
            await c.close()
        print('OK: solo start with bot, full game, rematch keeps 2, re-adds after kick, add_bot still works, non-host blocked, host kept after reload')

asyncio.run(main())
