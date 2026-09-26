"""順位で点: 出した人がN人なら 1位N点、2位N-1点…最下位1点。同じ値は同じ順位・同じ点（次の順位は飛ばす）。
データのない国は順位に入れず1点（以前は0として比べ、「GDPが低い国は？」でバチカンが1位になっていた）。
2026-09-26 に「1位だけ1点」から変えた。実行: python3 tests/test_rank_points.py"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import server


def play(prompt_id, cards):
    """cards: [(名前, 国コード)] を出したときの (名前 → (順位, 点, 1位か)) と合計点"""
    r = server.Room('RKPT', 'p0')
    for i, (name, _) in enumerate(cards):
        pid = f'p{i}'
        r.players[pid] = server.Player(pid, name); r.order.append(pid)
    r.settings.update({'rounds': 3, 'hand_size': 4})
    r.start()
    r.prompts[r.round - 1] = server.PROMPT_BY_ID[prompt_id]
    for i, (_, card) in enumerate(cards):
        p = r.players[f'p{i}']
        p.pick = card
        p.hand.append(card)
    r.do_reveal()
    got = {row['name']: (row['rank'], row['points'], row['winner']) for row in r.reveal['rows']}
    scores = {r.players[f'p{i}'].name: r.players[f'p{i}'].score for i in range(len(cards))}
    for name, (_, pts, _) in got.items():
        assert scores[name] == pts, (name, scores[name], pts)
    return got


g = play('area_max', [('A', 'br'), ('B', 'mn'), ('C', 'ke'), ('D', 'jp'), ('E', 'mt')])
assert {k: v[1] for k, v in g.items()} == {'A': 5, 'B': 4, 'C': 3, 'D': 2, 'E': 1}, g
assert g['A'][2] and not any(v[2] for k, v in g.items() if k != 'A')
print('OK: 5人で「面積が大きい国は？」: ブラジル5点・モンゴル4点・ケニア3点・日本2点・マルタ1点、1位はブラジルだけ')

g = play('life_max', [('A', 'it'), ('B', 'jp'), ('C', 'fr'), ('D', 'br'), ('E', 'ke')])
assert {k: (v[0], v[1]) for k, v in g.items()} == {'A': (1, 5), 'B': (1, 5), 'C': (3, 3), 'D': (4, 2), 'E': (5, 1)}, g
assert g['A'][2] and g['B'][2]
print('OK: 同じ値（イタリア・日本 84.0歳）はどちらも1位で5点、次のフランスは3位で3点')

g = play('gdp_min', [('A', 'va'), ('B', 'tv'), ('C', 'nr'), ('D', 'jp'), ('E', 'us')])
assert g['A'] == (None, 1, False), g['A']
assert {k: v[1] for k, v in g.items() if k != 'A'} == {'B': 5, 'C': 4, 'D': 3, 'E': 2}, g
print('OK: 「GDPが低い国は？」でデータのないバチカンは1位にならず1点。ほかの4人はデータのある国の中の順位で5・4・3・2点')

g = play('gdp_min', [('A', 'va'), ('B', 'va')])
assert all(v == (None, 1, False) for v in g.values()), g
print('OK: 全員データなしなら、全員1点で1位なし')

g = play('area_max', [('A', 'br'), ('B', 'jp')])
assert {k: v[1] for k, v in g.items()} == {'A': 2, 'B': 1}, g
print('OK: 2人なら1位2点・2位1点（点の差は1点で、今までの「1位だけ1点」と勝ち負けは同じ）')
server.rooms.pop('RKPT', None)
print('ALL OK')
