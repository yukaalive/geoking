"""バトルのレートと全国ランキング（rating.py と server.py）の確認。実行: GEOKING_WS=ws://localhost:8090/ws python3 tests/test_rating.py
1. 計算（rating.py を直接）: 最初は1000、同じ強さの2人なら勝ち +24・負け −24（はじめの10試合）、4人なら +24・+8・−8・−24。
   強い人に勝つほど大きく上がる。ボットは1000の相手で、ボットに勝って上がるのは1200まで（負けたらふつうに下がる）。
   人と戦った試合だけ「人との試合」に数える。同じ端末（同じ番号）が2人いる試合は、その番号を数えない
2. ランキング: 人と10試合した人だけ載る・同じレートは同じ順位・名前を出さない設定・自分の順位
3. 端末の控え: サーバーが忘れても、署名つきの控えで戻る。書き換えた控え・古い控えは受け取らない。スプレッドシート・引っ越しから受け取るときは試合数の多い方
4. 部屋（server.py の Room を直接）: バトルが終わるとレートが動き、最後の順位の行に前・後、本人に全国の順位の前後。途中で抜けた人も負けとして動く。
   1ゲームに1回だけ。パーティーでは動かない。引っ越し（room_to_dict → room_from_dict）でレートの番号と動きを引き継ぐ
5. つないで遊ぶ（WebSocket）: hello で合言葉を送って部屋を作り・入り、バトルで相手が抜けて決着 → 結果発表に自分のレートの動き、
   /api/rating と /api/ranking と名前を出さない設定。合言葉のない古い画面の人はレートが動かない"""
import asyncio, json, os, secrets, sys
import aiohttp

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
URL = os.environ.get('GEOKING_WS', 'ws://localhost:8090/ws')
HTTP = URL.replace('ws://', 'http://').replace('wss://', 'https://').rsplit('/ws', 1)[0]


def rk():
    return secrets.token_hex(16)


def unit_tests():
    import rating as RT

    def fresh():
        RT.RATINGS.clear(); RT.DIRTY.clear()

    # 1. 計算
    fresh()
    a, b = RT.rid_of(rk()), RT.rid_of(rk())
    assert a and b and a != b and RT.rid_of('short') is None and RT.rid_of(None) is None
    k = rk(); assert RT.rid_of(k) == RT.rid_of(k)
    res = RT.apply_game([{'rid': a, 'is_bot': False, 'place': 1, 'name': 'A'}, {'rid': b, 'is_bot': False, 'place': 2, 'name': 'B'}])
    assert round(res[a]['after']) == 1024 and round(res[b]['after']) == 976, res
    assert RT.RATINGS[a]['n'] == 1 and RT.RATINGS[a]['h'] == 1 and RT.RATINGS[a]['name'] == 'A' and a in RT.DIRTY
    fresh()
    ids = [RT.rid_of(rk()) for _ in range(4)]
    res = RT.apply_game([{'rid': x, 'is_bot': False, 'place': i + 1, 'name': f'P{i}'} for i, x in enumerate(ids)])
    assert [round(res[x]['after']) for x in ids] == [1024, 1008, 992, 976], [res[x]['after'] for x in ids]
    print('OK rating: start 1000, equal players move +-24 (2 players) / +24 +8 -8 -24 (4 players)')
    # 強い人に勝つほど大きく上がる
    fresh()
    weak, strong = RT.rid_of(rk()), RT.rid_of(rk())
    RT.get(weak, True).update({'r': 1000.0, 'n': 20}); RT.get(strong, True).update({'r': 1300.0, 'n': 20})
    up = RT.apply_game([{'rid': weak, 'is_bot': False, 'place': 1}, {'rid': strong, 'is_bot': False, 'place': 2}])
    assert up[weak]['after'] - up[weak]['before'] > 27 and up[strong]['after'] - up[strong]['before'] < -27, up
    print('OK rating: beating a stronger player gives more')
    # ボット: 1000 の相手。ボットに勝って上がるのは1200まで
    fresh()
    me = RT.rid_of(rk())
    RT.get(me, True).update({'r': 1195.0, 'n': 30})   # 1195 でボットに勝つと +8 ほど → 1200 で止まる
    res = RT.apply_game([{'rid': me, 'is_bot': False, 'place': 1}, {'rid': None, 'is_bot': True, 'place': 2}])
    assert res[me]['cap'] and round(res[me]['after'], 6) == 1200.0, res
    assert RT.RATINGS[me]['h'] == 0, 'ボットだけの試合は人との試合に数えない'
    res = RT.apply_game([{'rid': me, 'is_bot': False, 'place': 1}, {'rid': None, 'is_bot': True, 'place': 2}])
    assert res[me]['cap'] and res[me]['after'] == res[me]['before'], res
    res = RT.apply_game([{'rid': me, 'is_bot': False, 'place': 2}, {'rid': None, 'is_bot': True, 'place': 1}])
    assert res[me]['after'] < 1200 - 20 and not res[me]['cap'], res
    print('OK rating: bots count as 1000; wins against bots stop at 1200; losing to a bot still lowers it')
    # 人とボットがまざった試合: 人に勝った分はボットの上限に関係なく入る
    fresh()
    p, q = RT.rid_of(rk()), RT.rid_of(rk())
    RT.get(p, True).update({'r': 1250.0, 'n': 30})
    res = RT.apply_game([{'rid': p, 'is_bot': False, 'place': 1}, {'rid': q, 'is_bot': False, 'place': 2}, {'rid': None, 'is_bot': True, 'place': 3}])
    assert res[p]['after'] > 1250 and res[p]['cap'] and RT.RATINGS[p]['h'] == 1 and RT.RATINGS[q]['h'] == 1, res
    # 同じ番号が2人（同じ端末の2つの画面）: その番号は数えない
    fresh()
    s1, s2 = RT.rid_of(rk()), RT.rid_of(rk())
    res = RT.apply_game([{'rid': s1, 'is_bot': False, 'place': 1}, {'rid': s1, 'is_bot': False, 'place': 3}, {'rid': s2, 'is_bot': False, 'place': 2}])
    assert res == {}, res   # s1 を外すと人が1人だけ → 試合にならない
    print('OK rating: human wins count beyond the bot cap; the same device twice in one game is not counted')

    # 2. ランキング
    fresh()
    players = []
    for i, r in enumerate([1300, 1200, 1200, 1100, 1500]):
        x = RT.rid_of(rk()); players.append(x)
        RT.get(x, True).update({'r': float(r), 'n': 12, 'h': 12 if i != 4 else 9, 'name': f'N{i}'})
    rk_ = RT.ranking(players[1])
    assert [t['rate'] for t in rk_['top']] == [1300, 1200, 1200, 1100] and [t['rank'] for t in rk_['top']] == [1, 2, 2, 4], rk_['top']
    assert rk_['total'] == 4 and rk_['me']['rank'] == 2 and [t['rank'] for t in rk_['top'] if t['me']] == [2], rk_   # 同じレートの2人の並びは決まっていない
    assert RT.summary(players[4])['rank'] is None and RT.summary(players[4])['need'] == 1, '人と9試合では載らない'
    RT.set_hide(players[0], True)
    assert RT.ranking()['top'][0]['name'] is None and RT.ranking()['top'][0]['rate'] == 1300
    print('OK ranking: only players with 10 games against people, same rate same rank, hidden names, my rank')

    # 3. 端末の控え
    fresh()
    k = rk(); me = RT.rid_of(k)
    RT.apply_game([{'rid': me, 'is_bot': False, 'place': 1}, {'rid': None, 'is_bot': True, 'place': 2}])
    cp = RT.copy_of(me)
    assert cp and RT.copy_of(RT.rid_of(rk())) is None
    rate = RT.RATINGS[me]['r']
    RT.RATINGS.clear()   # サーバーが忘れた（Render の無料プランが止まった）
    assert RT.restore(me, cp['c'], cp['s']) and abs(RT.RATINGS[me]['r'] - rate) < 0.01 and RT.RATINGS[me]['n'] == 1
    RT.RATINGS.clear()
    bad = cp['c'].replace('"n":1', '"n":9')
    assert not RT.restore(me, bad, cp['s']), '書き換えた控えは受け取らない'
    assert not RT.restore(RT.rid_of(rk()), cp['c'], cp['s']), 'ほかの人の控えは受け取らない'
    assert RT.restore(me, cp['c'], cp['s'])
    RT.apply_game([{'rid': me, 'is_bot': False, 'place': 1}, {'rid': None, 'is_bot': True, 'place': 2}])
    assert not RT.restore(me, cp['c'], cp['s']) and RT.RATINGS[me]['n'] == 2, '今の記録より古い控えは使わない'
    # スプレッドシート・引っ越しから: 試合数の多い方
    rows = RT.export_rows()
    RT.RATINGS[me]['n'] = 5
    assert RT.merge(rows) == 0 and RT.RATINGS[me]['n'] == 5
    rows[0]['n'] = 7
    assert RT.merge(rows) == 1 and RT.RATINGS[me]['n'] == 7
    assert RT.merge([{'rid': 'bad', 'r': 1, 'n': 1, 'h': 1}]) == 0
    print('OK copy: restored after the server forgot; tampered, other, older copies refused; merges keep more games')

    # 4. 部屋（Room を直接）
    import server
    fresh()

    def battle_room(names, bots=0):
        r = server.Room('RATE', 'p0')
        r.settings['rule'] = 'survival'
        for i, nm in enumerate(names):
            p = server.Player(f'p{i}', nm); p.rid = RT.rid_of(rk()); p.connected = True
            r.players[p.pid] = p; r.order.append(p.pid)
        for _ in range(bots):
            server.add_bot(r)
        r.start()
        return r

    r = battle_room(['A', 'B', 'C'])
    r.players['p1'].hp = 0; r.players['p1'].out_round = 2
    r.players['p2'].hp = 0; r.players['p2'].out_round = 1
    r.round = 3
    r.finish()
    fin = {e['name']: e for e in r.final}
    assert fin['A']['place'] == 1 and fin['A']['rate_after'] > fin['A']['rate_before'] == 1000, fin
    assert fin['C']['rate_after'] < fin['B']['rate_after'] < fin['A']['rate_after'], fin
    info = r.rate_info['p0']
    assert info['before'] == 1000 and info['after'] == fin['A']['rate_after'] and info['first'] is True and info['h'] == 1 and info['need'] == 9, info
    st = r.state_for('p0')
    assert st['rate_me'] == info and st['rate_copy'] and next(p for p in st['players'] if p['pid'] == 'p0')['rate'] == info['after']
    n_before = RT.RATINGS[r.players['p0'].rid]['n']
    r.finish(); r.apply_ratings()
    assert RT.RATINGS[r.players['p0'].rid]['n'] == n_before, '1ゲームに1回だけ'
    print('OK room: battle end moves ratings (final rows before/after, my rank info, copy), once per game')
    # 途中で抜けた人も、そのときの順位で動く
    r = battle_room(['D', 'E'])
    gone = r.players['p1'].rid
    r.round = 2
    r.remove_player('p1')
    r.finish()
    assert round(RT.RATINGS[gone]['r']) == 976 and r.final[0]['name'] == 'D' and r.final[0]['rate_after'] == 1024, (RT.RATINGS[gone], r.final)
    print('OK room: a player who left mid-battle loses rating as their final place')
    # パーティーでは動かない・合言葉のない人は数えない
    r = battle_room(['F', 'G'])
    r.settings['rule'] = 'points'
    r.finish()
    assert not r.rate_info and all('rate_before' not in e for e in r.final)
    r = battle_room(['H', 'I'])
    r.players['p1'].rid = None
    r.players['p1'].hp = 0; r.players['p1'].out_round = 1
    r.finish()
    assert not r.rate_info, '相手がレートなし（古い画面）だけなら、人との試合にならない'
    print('OK room: party games and old screens without a key do not move ratings')
    # 引っ越し
    r = battle_room(['J', 'K'], bots=1)
    r.players['p1'].hp = 0; r.players['p1'].out_round = 1
    r.round = 1
    r.finish()
    d = json.loads(json.dumps(server.room_to_dict(r, 0)))
    server.rooms.pop('RATE', None)
    r2 = server.room_from_dict(d, 0, source='t')
    assert r2.players['p0'].rid == r.players['p0'].rid and r2.rated and r2.rate_info == r.rate_info
    assert [(e.get('rate_before'), e.get('rate_after')) for e in r2.final] == [(e.get('rate_before'), e.get('rate_after')) for e in r.final]
    server.rooms.pop('RATE', None)
    print('OK room: moving to a new server keeps rating ids and the rating changes')


# ---------- 5. つないで遊ぶ
async def recv_state(ws, pred=lambda d: True, timeout=10):
    while True:
        d = json.loads((await asyncio.wait_for(ws.receive(), timeout)).data)
        if d.get('type') == 'error':
            raise RuntimeError(d.get('code') or d.get('message'))
        if d.get('type') == 'state' and pred(d):
            return d


async def ws_tests():
    async with aiohttp.ClientSession() as s:
        ka, kb = rk(), rk()
        a = await s.ws_connect(URL)
        await a.send_json({'type': 'hello', 'rk': ka})
        await a.send_json({'type': 'create', 'name': 'レートA'})
        st = await recv_state(a)
        room = st['room']
        assert st['settings']['rule'] == 'survival' and st['rate_copy'] is None, '試合をしたことがなければ控えはない'
        await a.send_json({'type': 'settings', 'settings': {'timer': 0}})
        b = await s.ws_connect(URL)
        await b.send_json({'type': 'hello', 'rk': kb})
        await b.send_json({'type': 'join', 'room': room, 'name': 'レートB'})
        await recv_state(b, lambda d: len(d['players']) == 2)
        await a.send_json({'type': 'start'})
        await recv_state(a, lambda d: d['phase'] == 'pick')
        await b.send_json({'type': 'leave'})   # 相手が抜けて決着 → A の勝ち
        st = await recv_state(a, lambda d: d['phase'] == 'end')
        me = st['rate_me']
        assert me and me['before'] == 1000 and me['after'] == 1024 and me['first'] and me['h'] == 1 and me['need'] == 9, me
        fin = {e['name']: e for e in st['final']}
        assert fin['レートA']['rate_after'] == 1024 and fin['レートB']['rate_after'] == 976, fin
        assert st['rate_copy'] and st['rate_copy']['c'] and st['rate_copy']['s']
        assert next(p for p in st['players'] if p['name'] == 'レートA')['rate'] == 1024
        async with s.post(HTTP + '/api/rating', json={'rk': ka}) as r:
            d = await r.json()
        assert d['ok'] and d['me']['rate'] == 1024 and d['me']['rank'] is None and d['me']['need'] == 9 and d['copy'], d
        async with s.post(HTTP + '/api/rating', json={'rk': kb}) as r:
            assert (await r.json())['me']['rate'] == 976
        async with s.post(HTTP + '/api/rating', json={'rk': 'x'}) as r:
            assert r.status == 400
        async with s.post(HTTP + '/api/ranking', json={'rk': ka}) as r:
            d = await r.json()
        assert d['ok'] and d['me']['rate'] == 1024 and isinstance(d['top'], list) and d['need_games'] == 10, d
        assert d['copy'] and d['copy']['c'] and d['copy']['s'], 'ホームのランキングの枠は1回の読み込みで端末の控えも受け取る'
        async with s.post(HTTP + '/api/ranking', json={}) as r:
            d = await r.json()
        assert d['ok'] and d['me'] is None and d['copy'] is None, 'レートのない人（合言葉なし）も上位は見られる'
        async with s.post(HTTP + '/api/rating/hide', json={'rk': ka, 'hide': True}) as r:
            d = await r.json()
        assert d['ok'] and d['me']['hide'] is True
        async with s.post(HTTP + '/api/rating/hide', json={'rk': rk(), 'hide': True}) as r:
            assert r.status == 404, 'レートのない人は切り替えられない'
        await a.close(); await b.close()
        print('OK ws: hello key -> battle end shows my rating change, final rows, copy; /api/rating, /api/ranking, hide')
        # 合言葉のない古い画面の人どうしでは動かない
        c = await s.ws_connect(URL)
        await c.send_json({'type': 'create', 'name': 'ふるいC'})
        await recv_state(c)
        await c.send_json({'type': 'start', 'with_bot': True})
        st = await recv_state(c, lambda d: d['phase'] == 'pick')
        assert all(p['rate'] is None for p in st['players']) and st['rate_me'] is None and st['rate_copy'] is None
        await c.close()
        print('OK ws: old screens without a key keep working (no rating)')


if __name__ == '__main__':
    unit_tests()
    asyncio.run(ws_tests())
    print('ALL OK')
