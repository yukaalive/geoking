"""前のラウンドの制限時間が、次のラウンドの始まりに鳴らないこと（鳴ると次のラウンドの結果がすぐ出て「結果が2回続けて出る」）。
実行: python3 tests/test_round_timer.py"""
import asyncio, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import server


async def main():
    room = server.Room('TEST', 'h')
    room.players['h'] = server.Player('h', 'Alice')
    room.order.append('h')
    server.add_bot(room)
    room.settings.update({'rounds': 3, 'hand_size': 4, 'timer': 30})
    room.start()                                  # 1ラウンド目
    room.deadline = time.time() + 0.3             # 1ラウンド目の締め切り（テスト用に短く）
    await server.start_timer(room)
    await asyncio.sleep(0.05)                     # 時計が動き出して1ラウンド目の締め切りを読むところまで進める（実際の対戦と同じ）
    # 締め切り前に全員が出して結果 → 次のラウンドへ進んだ直後（次の時計をかける前）を作る
    for p in room.players.values():
        p.pick = p.hand[0]
    room.do_reveal()
    room.next_round()                             # 2ラウンド目の選ぶ時間が始まった
    assert room.phase == 'pick' and room.round == 2
    await asyncio.sleep(0.5)                      # 1ラウンド目の締め切りを過ぎる
    assert room.phase == 'pick' and room.round == 2, f'前のラウンドの時計で2ラウンド目の結果が出てしまった: phase={room.phase}'
    assert all(p.pick is None for p in room.players.values()), '前のラウンドの時計が2ラウンド目のカードを勝手に出した'
    room.timer_task.cancel()
    print('OK: 前のラウンドの時計は次のラウンドで鳴らない')

asyncio.run(main())
