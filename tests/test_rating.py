"""バトルのレートと全国ランキング（rating.py と server.py）の確認。実行: GEOKING_WS=ws://localhost:8090/ws python3 tests/test_rating.py
1. 計算（rating.py を直接）: 最初は1000、同じ強さの2人なら勝ち +24・負け −24（はじめの10試合）、4人なら +24・+8・−8・−24。
   強い人に勝つほど大きく上がる。ボットは1000の相手で、ボットに勝って上がる上限はない（高くなるほど上がりにくい。負けたらふつうに下がる）。
   人と戦った試合だけ「人との試合」に数える。同じ端末（同じ番号）が2人いる試合は、その番号を数えない
2. ランキング: 1回でもバトルした人が載る（ボット戦も数える。2026-10-03 から。前は人と10試合）・同じレートは同じ順位・名前を出さない設定・自分の順位
3. 端末の控え: サーバーが忘れても、署名つきの控えで戻る。書き換えた控え・古い控えは受け取らない。スプレッドシート・引っ越しから受け取るときは試合数の多い方
4. 部屋（server.py の Room を直接）: バトルが終わるとレートが動き、最後の順位の行に前・後、本人に全国の順位の前後。途中で抜けた人も負けとして動く。
   1ゲームに1回だけ。パーティーでは動かない。引っ越し（room_to_dict → room_from_dict）でレートの番号と動きを引き継ぐ
5. つないで遊ぶ（WebSocket）: hello で合言葉を送って部屋を作り・入り、バトルで相手が抜けて決着 → 結果発表に自分のレートの動き、
   /api/rating と /api/ranking と名前を出さない設定。合言葉のない古い画面の人はレートが動かない
6. 国旗クイズのレート（2026-10-12）: 国旗モード・国名モードの10問の正解数で、同じ一つのレートが動く（ふつうは小さく・激ムズは大きく。
   上手な人ほどふつうでは上がりにくい。首都モードは入れない）。
   ランキングはバトルと別（kind='flag'）。控え・スプレッドシート・引っ越しでも消えない（国旗クイズの欄がない古い行も受け取る）。
   /api/rating/quiz（同じ回は2回数えない・形がおかしい回は数えない）と /api/ranking の kind"""
import asyncio, json, os, secrets, sys, time
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
    # ボット: 1000 の相手。上限なし（2026-10-05 から）。高くなるほど勝っても上がりにくく、負けると大きく下がる
    fresh()
    me = RT.rid_of(rk())
    RT.get(me, True).update({'r': 1195.0, 'n': 30})   # 1195 でボットに勝つと +7.7 ほど（前は 1200 で止まっていた）
    res = RT.apply_game([{'rid': me, 'is_bot': False, 'place': 1}, {'rid': None, 'is_bot': True, 'place': 2}])
    assert 1202 < res[me]['after'] < 1204 and set(res[me]) == {'before', 'after'}, res
    assert RT.RATINGS[me]['h'] == 0, 'ボットだけの試合は人との試合に数えない'
    RT.RATINGS[me]['r'] = 1400.0
    res = RT.apply_game([{'rid': me, 'is_bot': False, 'place': 1}, {'rid': None, 'is_bot': True, 'place': 2}])
    assert 2.5 < res[me]['after'] - res[me]['before'] < 3.2, res   # 1400 でボットに勝つと +2.9
    res = RT.apply_game([{'rid': me, 'is_bot': False, 'place': 2}, {'rid': None, 'is_bot': True, 'place': 1}])
    assert -29.5 < res[me]['after'] - res[me]['before'] < -28.5, res   # 負けると −29
    fresh()
    solo = RT.rid_of(rk())
    RT.apply_game([{'rid': solo, 'is_bot': False, 'place': 1}, {'rid': None, 'is_bot': True, 'place': 2}])
    assert RT.rank_of(solo) == (1, 1) and RT.summary(solo)['need'] == 0, 'ボットと1回バトルしただけでランキングに載る'
    print('OK rating: bots count as 1000 with no cap (smaller gains as you go up, bigger losses); losing to a bot lowers it')
    # 人とボットがまざった試合: 人もボットも同じ計算（ボットは 1000）。人と戦った試合数も数える
    fresh()
    p, q = RT.rid_of(rk()), RT.rid_of(rk())
    RT.get(p, True).update({'r': 1250.0, 'n': 30})
    res = RT.apply_game([{'rid': p, 'is_bot': False, 'place': 1}, {'rid': q, 'is_bot': False, 'place': 2}, {'rid': None, 'is_bot': True, 'place': 3}])
    assert res[p]['after'] > 1250 and RT.RATINGS[p]['h'] == 1 and RT.RATINGS[q]['h'] == 1, res
    # 同じ番号が2人（同じ端末の2つの画面）: その番号は数えない
    fresh()
    s1, s2 = RT.rid_of(rk()), RT.rid_of(rk())
    res = RT.apply_game([{'rid': s1, 'is_bot': False, 'place': 1}, {'rid': s1, 'is_bot': False, 'place': 3}, {'rid': s2, 'is_bot': False, 'place': 2}])
    assert res == {}, res   # s1 を外すと人が1人だけ → 試合にならない
    print('OK rating: humans and bots in one game; the same device twice in one game is not counted')

    # 2. ランキング
    fresh()
    players = []
    for i, r in enumerate([1300, 1200, 1200, 1100, 1500]):
        x = RT.rid_of(rk()); players.append(x)
        RT.get(x, True).update({'r': float(r), 'n': 12 if i != 4 else 0, 'h': 12 if i != 4 else 0, 'name': f'N{i}'})
    bot_only = RT.rid_of(rk())
    RT.get(bot_only, True).update({'r': 1050.0, 'n': 1, 'h': 0, 'name': 'B'})   # ボットと1回だけ
    rk_ = RT.ranking(players[1])
    assert [t['rate'] for t in rk_['top']] == [1300, 1200, 1200, 1100, 1050] and [t['rank'] for t in rk_['top']] == [1, 2, 2, 4, 5], rk_['top']
    assert rk_['total'] == 5 and rk_['need_games'] == 1 and rk_['me']['rank'] == 2 and [t['rank'] for t in rk_['top'] if t['me']] == [2], rk_   # 同じレートの2人の並びは決まっていない
    assert RT.summary(bot_only)['rank'] == 5 and RT.summary(bot_only)['need'] == 0, 'ボットと1回バトルしただけでも載る'
    assert RT.summary(players[4])['rank'] is None and RT.summary(players[4])['need'] == 1, 'まだ1回もバトルしていない記録は載らない'
    RT.set_hide(players[0], True)
    assert RT.ranking()['top'][0]['name'] is None and RT.ranking()['top'][0]['rate'] == 1300
    print('OK ranking: players with 1+ battle (bot games count), same rate same rank, hidden names, my rank')

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
    # スプレッドシートを設定したとき: シートにない・シートより新しい記録だけを送るものに入れる
    fresh()
    a, b, c, d = (RT.rid_of(rk()) for _ in range(4))
    RT.get(a, True).update({'r': 1050.0, 'n': 3, 't': 100.0}); RT.get(b, True).update({'r': 1010.0, 'n': 2, 't': 90.0}); RT.get(c, True).update({'r': 990.0, 'n': 1, 't': 80.0})
    RT.DIRTY.clear()
    sheet = [{'rid': a, 'n': 3, 't': 100}, {'rid': b, 'n': 1, 't': 50}, {'rid': d, 'n': 5, 't': 70}]   # a は同じ、b はシートが古い、c はシートにない、d はシートだけ
    assert RT.mark_unsaved(sheet) == 2 and RT.DIRTY == {b, c}, RT.DIRTY
    print('OK copy: restored after the server forgot; tampered, other, older copies refused; merges keep more games; records missing from the sheet are sent')

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
    assert info['before'] == 1000 and info['after'] == fin['A']['rate_after'] and info['first'] is True and info['h'] == 1 and info['need'] == 0, info
    assert info['rank_before'] is None and info['rank_after'] == 1, 'はじめてのバトルで全国の順位に登場する'
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

    # 6. 国旗クイズ
    fresh()
    k = rk(); me = RT.rid_of(k)
    expect = {('normal', 10): 8.0, ('normal', 8): 4.8, ('normal', 5): 0.0, ('hard', 10): 24.31, ('hard', 8): 17.91, ('hard', 5): 8.31}
    for (level, correct), dv in expect.items():
        RT.RATINGS.clear()
        got = RT.apply_quiz(me, level, correct)
        assert abs(got['before'] - 1000) < 1e-9 and abs(got['after'] - 1000 - dv) < 0.01, (level, correct, got)
    for (level, correct), dv in {('normal', 10): 2.42, ('normal', 8): -0.78, ('normal', 5): -5.58, ('hard', 10): 11.52, ('hard', 8): 5.12, ('hard', 5): -4.48}.items():
        RT.RATINGS.clear()
        RT.get(me, True)['qr'] = 1300.0
        got = RT.apply_quiz(me, level, correct)
        assert abs(got['after'] - 1300 - dv) < 0.01, (level, correct, got)
    print('OK flag quiz: normal moves a little, hard a lot (1,000: +8/+5/0 vs +24/+18/+8; 1,300: +2/-1/-6 vs +12/+5/-4)')
    fresh()
    q, b = RT.rid_of(rk()), RT.rid_of(rk())
    for bad in [('x', 5, 10), ('normal', 11, 10), ('normal', '8', 10), ('normal', True, 10), ('normal', 5, 0), (['hard'], 5, 10)]:
        assert RT.apply_quiz(q, *bad) is None and q not in RT.RATINGS, bad
    RT.apply_quiz(q, 'hard', 9, name='クイズ子')
    RT.apply_game([{'rid': b, 'is_bot': False, 'place': 1, 'name': 'バトル子'}, {'rid': None, 'is_bot': True, 'place': 2}])
    rec = RT.RATINGS[q]
    assert rec['qn'] == 1 and rec['n'] == 0 and rec['r'] == 1000 and rec['qbest'] == rec['qr'] > 1000 and rec['name'] == 'クイズ子', rec
    assert RT.rate_of(q) is None and RT.rate_of(b) == 1024, 'クイズだけの人には、ロビーなどでバトルのレートを出さない'
    fl, bt = RT.ranking(q, 'flag'), RT.ranking(q)
    assert fl['total'] == 1 and [x['name'] for x in fl['top']] == ['クイズ子'] and fl['me']['rank'] == 1 and fl['me']['n'] == 1 and fl['kind'] == 'flag', fl
    assert bt['total'] == 1 and [x['name'] for x in bt['top']] == ['バトル子'] and bt['me']['rank'] is None and bt['me']['need'] == 1, bt
    RT.apply_game([{'rid': q, 'is_bot': False, 'place': 2}, {'rid': None, 'is_bot': True, 'place': 1}])
    assert RT.RATINGS[q]['qn'] == 1 and RT.ranking(q)['total'] == 2 and RT.ranking(q, 'flag')['total'] == 1
    RT.set_hide(q, True)
    assert RT.ranking(None, 'flag')['top'][0]['name'] is None, '名前を出さない設定はバトルと共通'
    print('OK flag quiz: own ranking (separate from battles), bad results not counted, hide is shared')
    # 控え・スプレッドシート・引っ越し
    cp = RT.copy_of(q)
    qr = RT.RATINGS[q]['qr']
    RT.RATINGS.clear()
    assert RT.restore(q, cp['c'], cp['s']) and abs(RT.RATINGS[q]['qr'] - qr) < 0.01 and RT.RATINGS[q]['qn'] == 1 and RT.RATINGS[q]['n'] == 1
    RT.apply_quiz(q, 'normal', 10)
    assert not RT.restore(q, cp['c'], cp['s']), '国旗クイズを遊んだあとの記録は、前の控えで戻さない'
    RT.RATINGS.clear()
    cq = RT.rid_of(rk()); RT.apply_quiz(cq, 'normal', 7)
    cp = RT.copy_of(cq)
    assert cp and '"qn":1' in cp['c'], '国旗クイズだけ遊んだ人にも控えがある'
    rows = RT.export_rows()
    assert rows[0]['qn'] == 1 and rows[0]['n'] == 0 and abs(rows[0]['qr'] - RT.RATINGS[cq]['qr']) < 0.01
    RT.RATINGS.clear()
    old = {'rid': cq, 'r': 1010, 'n': 1, 'h': 0, 'best': 1010, 'name': 'む', 'hide': False, 't': 50}   # 国旗クイズの欄がない（前のサーバー・シート）
    assert RT.merge([old]) == 1 and RT.RATINGS[cq]['qn'] == 0 and RT.RATINGS[cq]['qr'] == 1000
    assert RT.merge([{**old, 'qr': 1020.5, 'qn': 2, 'qbest': 1030, 't': 40}]) == 1 and RT.RATINGS[cq]['qn'] == 2 and RT.RATINGS[cq]['qbest'] == 1030, '国旗クイズの回数が多い方を残す'
    assert RT.merge([{**old, 't': 99}]) == 0, '回数（バトル＋国旗クイズ）の少ない行では戻らない'
    RT.DIRTY.clear()
    assert RT.mark_unsaved([{**old, 'qn': 1}]) == 1 and RT.DIRTY == {cq}, 'シートの国旗クイズが古ければ送り直す'
    RT.DIRTY.clear()
    assert RT.mark_unsaved([{**old, 'qn': 2, 't': 40}]) == 0
    # 2026-10-17: シートに足した列が日付の形になり、国旗クイズの欄が日付（とても大きな負の数）で返ってきた。行ごと捨てるとバトルのランキングまで空になる
    RT.RATINGS.clear(); RT.DIRTY.clear()
    dated = {**old, 'n': 40, 'r': 1222.09, 't': 60, 'qr': -2091196656000, 'qn': -2206429200000, 'qbest': -2091196656000}
    assert RT.merge([dated]) == 1 and RT.RATINGS[cq]['n'] == 40 and RT.RATINGS[cq]['r'] == 1222.09 and RT.RATINGS[cq]['qn'] == 0 and RT.RATINGS[cq]['qr'] == 1000, RT.RATINGS[cq]
    assert RT.ranking(None)['total'] == 1, 'バトルのランキングに残る'
    RT.RATINGS[cq].update({'qn': 32, 'qr': 1365.71, 'qbest': 1365.71})
    assert RT.mark_unsaved([dated]) == 1 and RT.DIRTY == {cq}, '国旗クイズの欄がおかしい行は送り直して直す'
    print('OK flag quiz: kept by the device copy, the sheet and server moves (old rows without quiz fields still load; rows with broken quiz fields keep their battle data)')


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
        assert me and me['before'] == 1000 and me['after'] == 1024 and me['first'] and me['h'] == 1 and me['need'] == 0 and me['rank_before'] is None and me['rank_after'] >= 1, me
        fin = {e['name']: e for e in st['final']}
        assert fin['レートA']['rate_after'] == 1024 and fin['レートB']['rate_after'] == 976, fin
        assert st['rate_copy'] and st['rate_copy']['c'] and st['rate_copy']['s']
        assert next(p for p in st['players'] if p['name'] == 'レートA')['rate'] == 1024
        async with s.post(HTTP + '/api/rating', json={'rk': ka}) as r:
            d = await r.json()
        assert d['ok'] and d['me']['rate'] == 1024 and d['me']['rank'] >= 1 and d['me']['need'] == 0 and d['copy'], d
        async with s.post(HTTP + '/api/rating', json={'rk': kb}) as r:
            assert (await r.json())['me']['rate'] == 976
        async with s.post(HTTP + '/api/rating', json={'rk': 'x'}) as r:
            assert r.status == 400
        async with s.post(HTTP + '/api/ranking', json={'rk': ka}) as r:
            d = await r.json()
        assert d['ok'] and d['me']['rate'] == 1024 and isinstance(d['top'], list) and d['need_games'] == 1, d
        assert d['copy'] and d['copy']['c'] and d['copy']['s'], 'ホームのランキングの枠は1回の読み込みで端末の控えも受け取る'
        async with s.post(HTTP + '/api/ranking', json={}) as r:
            d = await r.json()
        assert d['ok'] and d['me'] is None and d['copy'] is None, 'レートのない人（合言葉なし）も上位は見られる'
        async with s.post(HTTP + '/api/rating/hide', json={'rk': ka, 'hide': True}) as r:
            d = await r.json()
        assert d['ok'] and d['me']['hide'] is True
        # オフラインで遊んだボットとのバトル（2026-10-05）: 端末がためた結果を、つないだときに受け取ってレートを動かす。同じ試合は2回数えない
        ko = rk(); now = time.time()
        games = [{'id': 'g' + secrets.token_hex(6), 't': now - 60, 'place': 1, 'bots': [2]},            # ボット1体に勝った（1,000 → 1,024）
                 {'id': 'g' + secrets.token_hex(6), 't': now - 30, 'place': 3, 'bots': [1, 2]},         # ボット2体に負けた（最下位）
                 {'id': 'bad', 't': now, 'place': 9, 'bots': [1]}]                                    # 形がおかしい（id が短い）→ 受け取らない
        async with s.post(HTTP + '/api/rating/offline', json={'rk': ko, 'name': 'オフ子', 'games': games}) as r:
            d = await r.json()
        assert d['ok'] and d['applied'] == 2 and set(d['done']) == {games[0]['id'], games[1]['id']} and d['me']['n'] == 2 and d['me']['rank'] and d['copy'], d
        rate2 = d['me']['rate']
        assert rate2 < 1024, d   # 2試合目で下がった
        async with s.post(HTTP + '/api/rating/offline', json={'rk': ko, 'games': games[:2]}) as r:
            d = await r.json()
        assert d['applied'] == 0 and set(d['done']) == {games[0]['id'], games[1]['id']} and d['me']['rate'] == rate2, '同じ試合は2回数えない'
        async with s.post(HTTP + '/api/ranking', json={'rk': ko}) as r:
            d = await r.json()
        assert d['me']['rate'] == rate2 and any(x['me'] and x['name'] == 'オフ子' for x in d['top']), d
        async with s.post(HTTP + '/api/rating/offline', json={'rk': 'x', 'games': games}) as r:
            assert r.status == 400
        async with s.post(HTTP + '/api/rating/hide', json={'rk': rk(), 'hide': True}) as r:
            assert r.status == 404, 'レートのない人は切り替えられない'
        await a.close(); await b.close()
        print('OK ws: hello key -> battle end shows my rating change, final rows, copy; /api/rating, /api/ranking, hide; offline games (applied once)')
        # 国旗クイズ（2026-10-12）: 10問の結果を送るとレートが動き、国旗クイズのランキングに載る（バトルのランキングには載らない）
        kq = rk(); now = time.time()
        g1 = {'id': 'q' + secrets.token_hex(6), 't': now - 5, 'level': 'hard', 'correct': 10, 'total': 10}
        bads = [{'id': 'q-bad-level', 't': now, 'level': 'x', 'correct': 5, 'total': 10}, {'id': 'q' + secrets.token_hex(6), 't': now, 'level': 'normal', 'correct': 11, 'total': 10},
                {'id': 'q' + secrets.token_hex(6), 't': now, 'level': 'normal', 'correct': 5, 'total': 20}, {'id': 'q' + secrets.token_hex(6), 't': now - 40 * 86400, 'level': 'normal', 'correct': 5, 'total': 10}]
        async with s.post(HTTP + '/api/rating/quiz', json={'rk': kq, 'name': 'クイズ子', 'games': [g1] + bads}) as r:
            d = await r.json()
        res = d['res']
        assert d['ok'] and res['id'] == g1['id'] and res['before'] == 1000 and res['after'] == 1024 and res['first'] and res['rank_before'] is None and res['rank_after'] >= 1, d
        assert d['me']['n'] == 1 and d['me']['rate'] == 1024 and set(d['done']) == {g['id'] for g in [g1] + bads} and d['copy'], d
        async with s.post(HTTP + '/api/rating/quiz', json={'rk': kq, 'games': [g1]}) as r:
            d = await r.json()
        assert d['res'] is None and d['done'] == [g1['id']] and d['me']['rate'] == 1024, '同じ回は2回数えない'
        g2 = {'id': 'q' + secrets.token_hex(6), 't': now, 'level': 'normal', 'correct': 2, 'total': 10}   # ふつうで2問 → 下がる
        async with s.post(HTTP + '/api/rating/quiz', json={'rk': kq, 'name': 'クイズ子', 'games': [g2]}) as r:
            d = await r.json()
        assert d['res']['before'] == 1024 and d['res']['after'] < 1024 and not d['res']['first'] and d['res']['rank_before'] >= 1, d
        # 国名モードも同じ一つのレート（「国旗クイズでも国名クイズでも、同じ一つのレートに」）。首都モードは数えない。端末の時計が進んでいても数える
        rate2 = d['res']['after']
        g3 = {'id': 'q' + secrets.token_hex(6), 't': now + 3600, 'mode': 'name', 'level': 'hard', 'correct': 10, 'total': 10}
        gc = {'id': 'q' + secrets.token_hex(6), 't': now, 'mode': 'capital', 'level': 'hard', 'correct': 10, 'total': 10}
        async with s.post(HTTP + '/api/rating/quiz', json={'rk': kq, 'name': 'クイズ子', 'games': [g3, gc]}) as r:
            d = await r.json()
        assert d['res']['id'] == g3['id'] and d['res']['mode'] == 'name' and d['res']['before'] == rate2 and d['res']['after'] > rate2 and d['me']['n'] == 3, d
        assert set(d['done']) == {g3['id'], gc['id']}, d
        async with s.post(HTTP + '/api/ranking', json={'rk': kq, 'kind': 'flag'}) as r:
            d = await r.json()
        assert d['kind'] == 'flag' and d['me']['n'] == 3 and any(x['me'] and x['name'] == 'クイズ子' for x in d['top']), d
        async with s.post(HTTP + '/api/ranking', json={'rk': kq, 'kind': ['flag']}) as r:
            d = await r.json()
        assert d['kind'] == 'battle' and d['me']['rank'] is None and not any(x['name'] == 'クイズ子' for x in d['top']), 'バトルのランキングには載らない'
        async with s.post(HTTP + '/api/rating/quiz', json={'rk': 'x', 'games': [g2]}) as r:
            assert r.status == 400
        print('OK ws: flag and name mode results move the same flag-quiz rating once (capital mode and bad ones ignored); /api/ranking kind=flag; not in the battle ranking')
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
