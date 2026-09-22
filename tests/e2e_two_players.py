"""ヘッドレス2人対戦テスト: 部屋作成→参加→設定→全ラウンド進行→終了まで。"""
import asyncio, json, random, sys, time, aiohttp

import os
URL = os.environ.get('GEOKING_WS', 'ws://localhost:8080/ws')

async def recv_state(ws, want=None, timeout=9):
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
        for bad in ['   ', 'ばか太郎', 'yuka@example.com', 'LINE交換しよ']:   # 空・NGワード・連絡先・勧誘は拒否
            await b.send_json({'type': 'join', 'room': room, 'name': bad})
            try:
                await recv_state(b, timeout=1); raise SystemExit(f'bad name accepted: {bad}')
            except RuntimeError:
                pass
        await b.send_json({'type': 'join', 'room': room, 'name': '   '})   # （既存の流れ用）
        try:
            await recv_state(b, timeout=1); raise SystemExit('empty name accepted!')
        except RuntimeError as e:
            assert '名前' in str(e), e
        await b.send_json({'type': 'join', 'room': room, 'name': 'Bob<img src=x onerror=1>'})
        st = await recv_state(b, lambda d: len(d['players']) == 2); pidB, tokB = st['you'], st['token']
        assert st['token'] != tokA and all(('token' not in pl) for pl in st['players']), 'token leaked in players list'
        await recv_state(a, lambda d: len(d['players']) == 2)
        # 参加者は設定変更できない（無視される）
        await b.send_json({'type': 'settings', 'settings': {'rounds': 3}})
        await a.send_json({'type': 'settings', 'settings': {'rounds': 'abc', 'timer': None}})  # 不正値は無視され接続は維持される
        await a.send_json({'type': 'settings', 'settings': {'rounds': 4, 'hand_size': 5, 'categories': ['religion', 'climate'], 'timer': 0, 'title': 'テスト部屋<b>'}})
        st = await recv_state(a, lambda d: d['settings']['rounds'] == 4)
        assert st['title'] == 'テスト部屋<b>', st['title']
        assert st['settings']['hand_size'] == 5 and st['settings']['categories'] == ['religion', 'climate'], st['settings']
        await b.send_json({'type': 'start'})  # 非ホストは開始不可
        try:
            await recv_state(b, lambda d: d['phase'] == 'pick', timeout=1); raise SystemExit('non-host could start!')
        except asyncio.TimeoutError: pass
        await a.send_json({'type': 'start'})
        sa = await recv_state(a, lambda d: d['phase'] == 'pick'); sb = await recv_state(b, lambda d: d['phase'] == 'pick')
        assert len(sa['hand']) == 5 and not set(sa['hand']) & set(sb['hand']), 'hands overlap'
        assert sa['hands'][sb['you']] == sb['hand'] and sb['hands'][sa['you']] == sa['hand'], 'others hands not visible'
        assert sa['prompt']['cat'] in ('religion', 'climate')
        # 途中参加: Carol がラウンド1のpick中に入る → 残り4ラウンド+1 = 5枚
        c = await s.ws_connect(URL)
        await c.send_json({'type': 'join', 'room': room, 'name': 'Carol'})
        sc = await recv_state(c, lambda d: d['phase'] == 'pick')
        me_c = next(p for p in sc['players'] if p['pid'] == sc['you'])
        assert me_c['spectator'] and sc['hand'] == [], '途中参加はまず観戦のはず'
        assert any('さんが観戦しました' in m['text'] for m in sc['chat'])
        assert any('Bob<img src=x onさんが入室しました' in m['text'] for m in sc['chat'])
        await c.send_json({'type': 'pick', 'card': 'jp'})   # 観戦中は出せない（無視）
        # 観戦者にはライブ情報が届き、プレイヤー同士には届かない
        assert sc['live'] is not None and set(sc['live']) == {pidA, pidB}, sc.get('live')
        await a.send_json({'type': 'selecting', 'card': sa['hand'][2]})
        sc = await recv_state(c, lambda d: d['live'] and d['live'][pidA]['selecting'] == sa['hand'][2])
        sb_live = await recv_state(b, lambda d: True)
        assert sb_live.get('live') is None, 'players must not see live picks'
        await recv_state(a, lambda d: len(d['players']) == 3)
        # 退出: Carol が抜ける → left を受け取り、部屋は2人で続行
        await c.send_json({'type': 'leave'})
        msg = json.loads((await asyncio.wait_for(c.receive(), 5)).data)
        assert msg['type'] == 'left', msg
        await c.close()
        sa = await recv_state(a, lambda d: len(d['players']) == 2 and any('退出' in m['text'] for m in d['chat']))
        sb = await recv_state(b, lambda d: len(d['players']) == 2)
        scores = {}
        for rnd in range(1, 5):
            if rnd > 1:
                sa = await recv_state(a, lambda d: d['phase'] == 'pick' and d['round'] == rnd)
                sb = await recv_state(b, lambda d: d['phase'] == 'pick' and d['round'] == rnd)
            await a.send_json({'type': 'pick', 'card': 'zz'})  # 手札に無いカードは無視
            await a.send_json({'type': 'pick', 'card': sa['hand'][1]})
            st1 = await recv_state(a, lambda d: d['my_pick'] == sa['hand'][1])
            await a.send_json({'type': 'pick', 'card': sa['hand'][0]})   # 公開前なら変更できる
            await recv_state(a, lambda d: d['my_pick'] == sa['hand'][0])
            await b.send_json({'type': 'pick', 'card': sb['hand'][-1]})
            ra = await recv_state(a, lambda d: d['phase'] == 'reveal')
            rows = ra['reveal']['rows']; pr = ra['reveal']['prompt']
            vals = [r['value'] for r in rows if r['value'] is not None]
            if vals:
                best = max(vals) if pr['dir'] == 'max' else min(vals)
                assert all((r['value'] == best) == r['winner'] for r in rows), rows
            assert next(r for r in rows if r['pid'] == pidA)['card'] == sa['hand'][0], 'pick change not applied'
            print(f"R{rnd} {pr['text']:<22} " + ' | '.join(f"{r['name']}:{r['card']}={r['value']}{'👑' if r['winner'] else ''}" for r in rows))
            assert len(ra['hand']) == 5 - rnd, 'card not removed from hand'
            await asyncio.sleep(0.8)  # 連投制限（0.7秒）を待つ
            for bad in ['ばか', 'これ見て http://x.com', '090-1234-5678 に電話して']:   # NGワード・URL・電話番号は拒否
                await b.send_json({'type': 'chat', 'text': bad})
                try:
                    await recv_state(b, lambda d: any(c['text'] == bad for c in d['chat']), timeout=1); raise SystemExit(f'bad chat accepted: {bad}')
                except RuntimeError as e:
                    assert '送信できません' in str(e), e
            await asyncio.sleep(0.8)
            await b.send_json({'type': 'chat', 'text': f'ブラフ！{rnd}'})   # 普通の発言は流れる
            await recv_state(a, lambda d: any(c['text'] == f'ブラフ！{rnd}' for c in d['chat']))
            # 5秒後に自動で次へ進む（'next' は廃止）
        assert ra['next_at'] and ra['next_at'] - time.time() <= 5.5, ra.get('next_at')
        ea = await recv_state(a, lambda d: d['phase'] == 'end')
        total = sum(p['score'] for p in ea['players'])
        assert ea['history'] and [h['round'] for h in ea['history']] == [1, 2, 3, 4], 'history missing'
        assert all(len(h['rows']) == 2 for h in ea['history'])
        print('END scores', {p['name']: p['score'] for p in ea['players']}, 'total', total)
        assert total >= 4, 'each round should award at least one point'
        # ミュート: Alice が Bob をミュートすると Alice の画面から Bob の発言が消える
        await a.send_json({'type': 'mute', 'pid': pidB, 'on': True})
        st = await recv_state(a, lambda d: pidB in d.get('muted', []))
        assert not any(c.get('pid') == pidB for c in st['chat']), 'muted messages still visible'
        await a.send_json({'type': 'mute', 'pid': pidB, 'on': False})
        await recv_state(a, lambda d: pidB not in d.get('muted', []))
        # 通報: 1人目では制限されない
        await a.send_json({'type': 'report', 'pid': pidB, 'reason': '迷惑行為'})
        msg = json.loads((await asyncio.wait_for(a.receive(), 5)).data); assert msg['type'] == 'toast', msg
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
        print('OK: full flow, title, late join, leave, token auth, impersonation blocked, reconnect, rematch')

asyncio.run(main())
