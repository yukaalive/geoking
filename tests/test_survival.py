"""サバイバル（体力を減らし合う試作のルール）の確認。実行: GEOKING_WS=ws://localhost:8092/ws python3 tests/test_survival.py
1. 減り方の計算（サーバーの Room を直接動かす）: 1位は0・最下位は30・あいだは順位に合わせて四捨五入、同じ値は同じだけ、データのない国は最下位と同じ、
   全員データなしなら誰も減らない、体力0で脱落して手札を捨てる、残りが1人で決着、最後の順位（残った人 → あとまで残った人）
2. 部屋で遊ぶ（WebSocket）: ロビーでルールをサバイバルにして（試作用のサーバーは最初から）、ボット3体と最後まで。毎ラウンドの減り方・手札が8枚のまま（1枚引く）・
   脱落した人は出さない・最後の1人で終わる・もう一戦で体力が戻る。2人なら負けた方が30減る。ほかの人が抜けて1人になったら、その場で終わる。
   ひとりで「botとサバイバル開始」を押すとボットが2体入って3人で始まる（点のルールは1体）"""
import asyncio, json, os, sys
import aiohttp

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
URL = os.environ.get('GEOKING_WS', 'ws://localhost:8092/ws')


# ---------- 1. 減り方の計算
def expected_damage(rows):
    n = len(rows)
    anyone = any(not r['missing'] for r in rows)
    out = {}
    for r in rows:
        if not anyone or n < 2:
            out[r['pid']] = 0
        elif r['rank'] is None:
            out[r['pid']] = 30
        else:
            out[r['pid']] = int(30 * (r['rank'] - 1) / (n - 1) + 0.5)
    return out


def unit_tests():
    import server
    from prompts import PROMPT_BY_ID

    def room_with(n, prompt_id):
        r = server.Room('TEST', 'p0')
        r.settings['rule'] = 'survival'
        for i in range(n):
            p = server.Player(f'p{i}', f'P{i}', is_bot=True)
            r.players[p.pid] = p
            r.order.append(p.pid)
        r.start()
        r.prompts = [PROMPT_BY_ID[prompt_id]] * server.SURV_MAX_ROUNDS
        return r

    def play(r, cards):   # cards: pid -> 国コード（手札に入れてから出す）
        for pid, c in cards.items():
            p = r.players[pid]
            if c not in p.hand:
                p.hand[0] = c
            p.pick = c
        r.do_reveal()
        return {x['pid']: x for x in r.reveal['rows']}

    # 4人・面積が大きい国: ロシア > カナダ > 日本 > マルタ → 0, 10, 20, 30
    r = room_with(4, 'area_max')
    assert all(p.hp == 100 for p in r.players.values())
    rows = play(r, {'p0': 'ru', 'p1': 'ca', 'p2': 'jp', 'p3': 'mt'})
    assert [rows[f'p{i}']['damage'] for i in range(4)] == [0, 10, 20, 30], rows
    assert [r.players[f'p{i}'].hp for i in range(4)] == [100, 90, 80, 70]
    assert rows['p0']['hp_before'] == 100 and rows['p3']['hp'] == 70 and rows['p0']['winner']
    assert r.reveal['alive'] == 4 and r.reveal['last'] is False
    assert all(len(p.hand) == 7 for p in r.players.values())   # 出した分は減る（次のラウンドの前に引く）
    r.next_round()
    assert r.phase == 'pick' and r.round == 2 and all(len(p.hand) == 8 and p.new_card in p.hand for p in r.players.values())
    # 同じ値は同じ順位・同じだけ減る（ロシアが2人: どちらも0。日本・マルタは 1,1,3,4 の3位と4位）
    rows = play(r, {'p0': 'ru', 'p1': 'ru', 'p2': 'jp', 'p3': 'mt'})
    assert [rows[f'p{i}']['damage'] for i in range(4)] == [0, 0, 20, 30], rows

    # 8人: 最下位は30、あいだは 30×(順位-1)/7 を四捨五入 → 0,4,9,13,17,21,26,30
    r = room_with(8, 'area_max')
    rows = play(r, {'p0': 'ru', 'p1': 'ca', 'p2': 'cn', 'p3': 'br', 'p4': 'au', 'p5': 'in', 'p6': 'ar', 'p7': 'kz'})
    assert [rows[f'p{i}']['damage'] for i in range(8)] == [0, 4, 9, 13, 17, 21, 26, 30], [rows[f'p{i}']['damage'] for i in range(8)]
    for row in rows.values():
        assert row['damage'] == expected_damage(r.reveal['rows'])[row['pid']]

    # データのない国（バチカンの GDP）は最下位と同じだけ減る。ほかは順位のとおり
    r = room_with(3, 'gdp_max')
    rows = play(r, {'p0': 'us', 'p1': 'jp', 'p2': 'va'})
    assert rows['p2']['missing'] and rows['p2']['damage'] == 30 and rows['p0']['damage'] == 0, rows
    assert rows['p1']['damage'] == 15, rows   # データのある2人のうち2位 → 30×1/2
    # 全員データなし → 誰も減らない
    r = room_with(2, 'gdp_max')
    rows = play(r, {'p0': 'va', 'p1': 'va'})
    assert rows['p0']['damage'] == 0 and rows['p1']['damage'] == 0, rows

    # 脱落: 体力0で脱落、手札を捨て、次のラウンドは出さない。1位は減らないので全員同時に0にはならない
    r = room_with(3, 'area_max')
    r.players['p2'].hp = 5
    rows = play(r, {'p0': 'ru', 'p1': 'jp', 'p2': 'mt'})
    assert rows['p2']['out'] and r.players['p2'].hp == 0 and r.players['p2'].out_round == 1 and r.players['p2'].hand == []
    assert r.reveal['alive'] == 2 and not r.reveal['last']
    r.next_round()
    assert r.phase == 'pick' and r.players['p2'].new_card is None and len(r.players['p2'].hand) == 0
    assert not r.all_picked()
    r.players['p0'].pick = r.players['p0'].hand[0]
    r.players['p1'].pick = r.players['p1'].hand[0]
    assert r.all_picked()   # 脱落した人は待たない
    # 2人: 負けた方が30
    r.players['p1'].hp = 30
    rows = play(r, {'p0': 'ru', 'p1': 'mt'})
    assert set(rows) == {'p0', 'p1'} and rows['p1']['damage'] == 30 and rows['p1']['out'] and r.reveal['last'] is True
    r.next_round()
    assert r.phase == 'end'
    assert [(e['pid'], e['place']) for e in r.final] == [('p0', 1), ('p1', 2), ('p2', 3)], r.final   # 残った人 → R2で脱落 → R1で脱落
    assert r.final[0]['score'] == r.players['p0'].hp and r.final[1]['score'] == 0

    # 打ち切り: 上限のラウンドまで来たら、体力の多い人から（同じ体力は同じ順位）
    r = room_with(3, 'area_max')
    r.round = server.SURV_MAX_ROUNDS
    r.players['p0'].hp, r.players['p1'].hp, r.players['p2'].hp = 9, 9, 4
    r.phase = 'reveal'
    r.next_round()
    assert r.phase == 'end' and [e['place'] for e in r.final] == [1, 1, 3], r.final

    # 途中で抜けた人: そのときのラウンドで脱落したのと同じ
    r = room_with(3, 'area_max')
    play(r, {'p0': 'ru', 'p1': 'jp', 'p2': 'mt'})
    r.next_round()
    r.remove_player('p1')
    assert r.departed['p1']['out_round'] == 2 and r.departed['p1']['hp'] == 85
    r.players['p2'].hp = 1
    play(r, {'p0': 'ru', 'p2': 'mt'})
    r.next_round()
    assert r.phase == 'end' and [(e['pid'], e['place']) for e in r.final] == [('p0', 1), ('p2', 2), ('p1', 2)], r.final

    # 引っ越し（room_to_dict → room_from_dict）で体力・脱落・引いた国旗・最後の順位が引き継がれる
    import time
    r = room_with(3, 'area_max')
    play(r, {'p0': 'ru', 'p1': 'jp', 'p2': 'mt'})
    r.next_round()
    r.players['p2'].out_round, r.players['p2'].hp = 1, 0
    d = json.loads(json.dumps(server.room_to_dict(r, time.time())))
    server.rooms.pop('TEST', None)
    r2 = server.room_from_dict(d, time.time(), source='x')
    assert r2.settings['rule'] == 'survival' and r2.players['p1'].hp == 85 and r2.players['p2'].out_round == 1
    assert r2.players['p0'].new_card == r.players['p0'].new_card and r2.players['p0'].new_card in r2.players['p0'].hand
    d['settings'].pop('rule')   # 前の版のサーバー（ルールの項目がない）からの部屋は、点のルール
    assert server.room_from_dict(d, time.time(), source='y').settings['rule'] == 'points'
    print('OK unit: damage 0/10/20/30, ties, 8 players, missing data, all missing, knockout, 2 players, standings, round cap, leaver, migration')


# ---------- 2. 部屋で遊ぶ
async def recv_state(ws, want=None, timeout=15):
    while True:
        msg = await asyncio.wait_for(ws.receive(), timeout)
        if msg.type != aiohttp.WSMsgType.TEXT:
            raise RuntimeError(f'socket closed: {msg.type}')
        d = json.loads(msg.data)
        if d['type'] == 'error':
            raise RuntimeError(d.get('code') or d['message'])
        if d['type'] == 'state' and (want is None or want(d)):
            return d


async def make_room(s, name, bots, survival=True):
    a = await s.ws_connect(URL)
    await a.send_json({'type': 'create', 'name': name})
    st = await recv_state(a)
    await a.send_json({'type': 'settings', 'settings': {'timer': 0, 'rule': 'survival' if survival else 'points'}})
    await recv_state(a, lambda d: d['settings']['timer'] == 0)
    for i in range(bots):
        await a.send_json({'type': 'add_bot'})
        await recv_state(a, lambda d, n=i + 2: len(d['players']) == n)
    return a, st['room'], st['you']


async def full_game(s):
    a, room, me = await make_room(s, 'Alice', 3)
    await a.send_json({'type': 'start'})
    st = await recv_state(a, lambda d: d['phase'] == 'pick')
    assert st['settings']['rule'] == 'survival' and all(p['hp'] == 100 and p['out_round'] is None for p in st['players'])
    hp = {p['pid']: 100 for p in st['players']}
    out = {}
    rounds = 0
    while True:
        rounds += 1
        assert st['round'] == rounds, (st['round'], rounds)
        alive = [p for p in st['players'] if not p['out_round']]
        assert sorted(p['pid'] for p in alive) == sorted(x for x in hp if x not in out)
        mine = next(p for p in st['players'] if p['pid'] == me)
        if not mine['out_round']:
            assert len(st['hand']) == 8, len(st['hand'])   # 毎ラウンド1枚引くので8枚のまま
            if rounds > 1:
                assert st['new_card'] in st['hand']
            await a.send_json({'type': 'pick', 'card': st['hand'][0]})
        else:
            assert st['hand'] == [] and st['live'] is not None   # 脱落した人は観戦（みんなの選んでいる国旗が見える）
        rv = await recv_state(a, lambda d: d['phase'] == 'reveal' and d['round'] == rounds)
        rows = rv['reveal']['rows']
        assert sorted(x['pid'] for x in rows) == sorted(p['pid'] for p in alive), 'only alive players play'
        exp = expected_damage(rows)
        for x in rows:
            assert x['damage'] == exp[x['pid']] and x['points'] is None, x
            assert x['hp_before'] == hp[x['pid']] and x['hp'] == max(0, hp[x['pid']] - x['damage']), x
            hp[x['pid']] = x['hp']
            if x['out']:
                out[x['pid']] = rounds
        left = [x for x in hp if x not in out]
        assert rv['reveal']['alive'] == len(left) and rv['reveal']['last'] == (len(left) <= 1 or rounds >= 20)
        print(f"R{rounds} " + ' | '.join(f"{x['name']} -{x['damage']}→{x['hp']}{' KO' if x['out'] else ''}" for x in rows))
        if rv['reveal']['last']:
            break
        st = await recv_state(a, lambda d: d['phase'] == 'pick' and d['round'] == rounds + 1, timeout=20)
    e = await recv_state(a, lambda d: d['phase'] == 'end', timeout=20)
    fin = e['final']
    assert len(fin) == 4 and fin[0]['out_round'] is None and fin[0]['place'] == 1
    outs = [x['out_round'] for x in fin[1:]]
    assert outs == sorted(outs, reverse=True) and all(x['out_round'] for x in fin[1:]), fin   # あとまで残った人ほど上
    assert len(e['history']) == rounds
    # もう一戦: 体力が100に戻る
    await a.send_json({'type': 'start'})
    st = await recv_state(a, lambda d: d['phase'] == 'pick' and d['round'] == 1)
    assert all(p['hp'] == 100 and p['out_round'] is None for p in st['players']) and len(st['hand']) == 8
    await a.close()
    print(f'OK game: ended in {rounds} rounds, winner {fin[0]["name"]} hp={fin[0]["hp"]}; rematch resets hp')


async def two_players(s):
    a, room, me = await make_room(s, 'Bob', 1)
    await a.send_json({'type': 'start'})
    st = await recv_state(a, lambda d: d['phase'] == 'pick')
    await a.send_json({'type': 'pick', 'card': st['hand'][0]})
    rv = await recv_state(a, lambda d: d['phase'] == 'reveal')
    rows = rv['reveal']['rows']
    dmg = sorted(x['damage'] for x in rows)
    assert dmg in ([0, 30], [0, 0]), rows   # 負けた方が30（同じ値なら0と0）
    await a.close()
    print('OK two players: loser -30')


async def last_one_by_leaving(s):
    a, room, me = await make_room(s, 'Carol', 0)
    b = await s.ws_connect(URL)
    await b.send_json({'type': 'join', 'room': room, 'name': 'Dave'})
    await recv_state(b, lambda d: len(d['players']) == 2)
    await a.send_json({'type': 'start'})
    await recv_state(a, lambda d: d['phase'] == 'pick')
    await b.send_json({'type': 'leave'})   # 2人で遊んでいて1人が抜ける → 残った人の勝ちで、その場で終わる
    e = await recv_state(a, lambda d: d['phase'] == 'end')
    assert [(x['name'], x['place']) for x in e['final']] == [('Carol', 1), ('Dave', 2)] and e['final'][1]['out_round'] == 1, e['final']
    await a.close(); await b.close()
    print('OK leaving: the last one wins at once')


async def solo_start_adds_two_bots(s):
    a, room, me = await make_room(s, 'Fay', 0)
    await a.send_json({'type': 'start', 'with_bot': True})   # ひとりで「botとサバイバル開始」→ ボット2体で3人（2人だと4回ほどで終わるので）
    st = await recv_state(a, lambda d: d['phase'] == 'pick')
    bots = [p for p in st['players'] if p['is_bot']]
    assert len(st['players']) == 3 and len(bots) == 2 and len({p['name'] for p in st['players']}) == 3, st['players']
    await a.close()
    b, room2, _ = await make_room(s, 'Gus', 0, survival=False)   # 点のルールは今までどおり1体
    await b.send_json({'type': 'start', 'with_bot': True})
    st = await recv_state(b, lambda d: d['phase'] == 'pick')
    assert len(st['players']) == 2 and sum(p['is_bot'] for p in st['players']) == 1, st['players']
    await b.close()
    print('OK solo start: survival adds 2 bots (3 players), points adds 1')


async def points_unchanged(s):
    a, room, me = await make_room(s, 'Eve', 1, survival=False)
    await a.send_json({'type': 'start'})
    st = await recv_state(a, lambda d: d['phase'] == 'pick')
    assert st['settings']['rule'] == 'points' and all(p['hp'] is None for p in st['players'])
    await a.send_json({'type': 'pick', 'card': st['hand'][0]})
    rv = await recv_state(a, lambda d: d['phase'] == 'reveal')
    assert all(x['points'] >= 1 and 'damage' not in x for x in rv['reveal']['rows']) and 'last' not in rv['reveal']
    await a.close()
    print('OK points rule: no hp, points as before')


async def main():
    unit_tests()
    async with aiohttp.ClientSession() as s:
        await full_game(s)
        await two_players(s)
        await last_one_by_leaving(s)
        await solo_start_adds_two_bots(s)
        await points_unchanged(s)


asyncio.run(main())
