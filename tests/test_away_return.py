"""部屋にいる人が LINE など別のアプリに行って戻ってきたとき、部屋に戻れること。
2026-09-25: 全員が切れて90秒たつと部屋が消え、LINE で招待を送って戻ると「その名前の部屋は見つかりません」になった。
また、すぐ戻ったとき（古い接続がまだ残っているうち）にロビーから外され、返事が来ずに画面が止まった。
サーバーを手元で動かし（猶予と生存確認の間隔をテスト用に短くする）、つなぎ直しを試す。15秒ほど。
実行: python3 tests/test_away_return.py"""
import asyncio, json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import server
import aiohttp
from aiohttp import web

# 本番の長さ: LINE で招待を送って返事を待つ間（数分）は残し、Render 無料プランが止まる15分よりは短く
assert 5 * 60 <= server.EMPTY_GRACE < 15 * 60, f'全員が切れた部屋を残す長さが {server.EMPTY_GRACE} 秒（5〜15分にする）'
assert server.LEFT_GRACE <= 120, f'自分で退出して空になった部屋を残す長さが {server.LEFT_GRACE} 秒（長いと部屋名がふさがる）'
print(f'OK: 全員が切れた部屋は {server.EMPTY_GRACE // 60} 分残し、自分で退出して空になった部屋は {server.LEFT_GRACE} 秒で消す')

HB = 3            # 秒。生存確認の間隔（本番は25秒）。返事のない接続に気づくのは約 1.5 倍後
server.EMPTY_GRACE = 6   # 本番は600秒（全員が切れた部屋を残す長さ）
server.LEFT_GRACE = 2    # 本番は90秒（最後の人が自分で退出した部屋を残す長さ）
PORT = 18790
WS = f'http://127.0.0.1:{PORT}/ws'


class ShortHeartbeat(web.WebSocketResponse):
    def __init__(self, *a, heartbeat=None, **k):
        super().__init__(*a, heartbeat=HB, **k)


server.web.WebSocketResponse = ShortHeartbeat


async def recv(ws, want=None, timeout=4):
    """次の状態（want に合うもの）かエラーを待つ。来なければ None（返事が来ない＝画面が止まる）"""
    end = time.time() + timeout
    while (left := end - time.time()) > 0:
        try:
            m = await asyncio.wait_for(ws.receive(), left)
        except asyncio.TimeoutError:
            return None
        if m.type != aiohttp.WSMsgType.TEXT:
            return {'type': 'closed'}
        d = json.loads(m.data)
        if d['type'] == 'error' or (d['type'] == 'state' and (want is None or want(d))):
            return d
    return None


class Friend:
    """ずっとつながっている友だち（届いた状態を覚えておく）"""
    def __init__(self, ws):
        self.ws, self.last = ws, None
        self.task = asyncio.create_task(self._run())

    async def _run(self):
        async for m in self.ws:
            if m.type == aiohttp.WSMsgType.TEXT and json.loads(m.data)['type'] == 'state':
                self.last = json.loads(m.data)


async def until(cond, timeout=8):
    end = time.time() + timeout
    while not cond():
        assert time.time() < end, '待っても変わらない'
        await asyncio.sleep(0.05)


async def create(s, name, silent=False):
    ws = await s.ws_connect(WS, autoping=not silent)   # silent: 生存確認に返事をしない（アプリが裏で止まっている）
    await ws.send_json({'type': 'create', 'name': name})
    st = await recv(ws)
    return ws, st


async def rejoin(s, st, name):
    ws = await s.ws_connect(WS)
    await ws.send_json({'type': 'join', 'room': st['room'], 'name': name, 'pid': st['you'], 'token': st['token']})
    return ws, await recv(ws)


async def main():
    runner = web.AppRunner(server.make_app()); await runner.setup()
    await web.TCPSite(runner, '127.0.0.1', PORT).start()
    try:
        async with aiohttp.ClientSession() as s:
            # 1. ロビーにひとりで LINE へ（接続が切れる）→ しばらくして戻る
            ws, st = await create(s, 'Alice')
            code = st['room']
            await ws.close()
            await until(lambda: not server.rooms[code].has_humans())
            await asyncio.sleep(server.LEFT_GRACE + 1)
            server.cleanup_rooms()
            ws, back = await rejoin(s, st, 'Alice')
            assert back and back['type'] == 'state' and back['room'] == code and back['host'] == back['you'], f'戻れない: {back}'
            print('OK: ロビーにひとりで別のアプリへ行き、しばらくして戻っても同じ部屋に戻れる')
            await ws.close()
            await until(lambda: not server.rooms[code].has_humans())
            await asyncio.sleep(server.EMPTY_GRACE + 0.5)
            server.cleanup_rooms()
            ws, back = await rejoin(s, st, 'Alice')
            assert back and back.get('code') == 'room_not_found', f'猶予を過ぎても部屋が残っている: {back}'
            print('OK: 猶予（本番は10分）を過ぎたら、これまでどおり部屋は消える')
            await ws.close()

            # 2. ボットと対戦中に LINE へ → 戻ると同じ人として続きから
            ws, st = await create(s, 'Bob')
            code = st['room']
            await ws.send_json({'type': 'start', 'with_bot': True})
            assert await recv(ws, lambda d: d['phase'] == 'pick')
            await ws.close()
            await until(lambda: not server.rooms[code].players[st['you']].connected)
            await asyncio.sleep(server.LEFT_GRACE + 1)
            server.cleanup_rooms()
            ws, back = await rejoin(s, st, 'Bob')
            assert back and back['type'] == 'state' and back['you'] == st['you'], f'対戦に戻れない: {back}'
            print('OK: 対戦中に別のアプリへ行って戻っても、同じ人として続きから遊べる')
            await ws.close()

            # 3. すぐ戻る（サーバーにはまだ古い接続が残っている）→ 返事が来て、同じ人・ホストのまま始められる
            old, st = await create(s, 'Cao', silent=True)
            code = st['room']
            ws, back = await rejoin(s, st, 'Cao')
            assert back is not None, 'すぐ戻ると返事が来ない（画面が止まる）'
            assert back['type'] == 'state' and back['you'] == st['you'] and back['host'] == st['you'], f'別の人として入り直した: {back}'
            await ws.send_json({'type': 'start', 'with_bot': True})
            assert await recv(ws, lambda d: d['phase'] == 'pick'), 'すぐ戻ったあと開始できない'
            print('OK: すぐ戻っても返事が来て、同じ人・ホストのまま開始できる')
            await ws.close(); await old.close()

            # 4. 友だちがいるロビーから、ホストがすぐ戻る → ホストのまま（友だちがホストにならない）
            old, st = await create(s, 'Dan', silent=True)
            code = st['room']
            f = Friend(await s.ws_connect(WS))
            await f.ws.send_json({'type': 'join', 'room': code, 'name': 'Eve'})
            await until(lambda: f.last and len(f.last['players']) == 2)
            ws, back = await rejoin(s, st, 'Dan')
            assert back and back['type'] == 'state' and back['you'] == st['you'] and back['host'] == st['you'], f'ホストが戻れない: {back}'
            await until(lambda: f.last['host'] == st['you'] and len(f.last['players']) == 2)
            print('OK: 友だちのいるロビーにすぐ戻っても、ホストのまま（友だちの画面でも）')
            f.task.cancel(); await f.ws.close(); await ws.close(); await old.close()

            # 5. 最後の人が自分で「退出」した部屋は、これまでどおり短く（本番は90秒）で消え、部屋名が空く
            ws, st = await create(s, 'Lea')
            code = st['room']
            await ws.send_json({'type': 'leave'})
            await until(lambda: not server.rooms[code].players)
            assert code in server.rooms
            await asyncio.sleep(server.LEFT_GRACE + 0.5)
            server.cleanup_rooms()
            assert code not in server.rooms, '退出して空になった部屋が残っている（部屋名がふさがる）'
            ws2, st2 = await create(s, 'Lea')
            assert st2['title_raw'] == 'Lea', f'部屋名が空いていない: {st2["title_raw"]}'
            print('OK: 自分で退出して空になった部屋は、これまでどおり短い時間で消え、同じ名前で作れる')
            await ws.close(); await ws2.close()

            # 6. 更新時の引っ越し: ひとりで LINE に行ったホストのロビーの部屋も新しいサーバーへ送る
            ws, st = await create(s, 'Mia')
            code = st['room']
            await ws.close()
            await until(lambda: not server.rooms[code].has_humans())
            r = server.rooms[code]
            assert server.room_worth_moving(r), '猶予中の部屋が引っ越しの対象になっていない'
            d = json.loads(json.dumps(server.room_to_dict(r, time.time())))
            server.rooms.pop(code)   # 新しいサーバーにはまだこの部屋がない
            assert d['empty_for'] is not None and server.room_from_dict(d, time.time(), source='test').empty_since is not None
            print('OK: 猶予中の部屋も更新時に新しいサーバーへ送られ、残り時間も引き継ぐ')
    finally:
        await runner.cleanup()
    print('ALL OK')

asyncio.run(main())
