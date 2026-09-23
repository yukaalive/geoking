"""動画撮影用の2人目プレイヤー: 部屋に入り、挨拶し、各ラウンドで数秒考えてからカードを出す。結果に一言。"""
import asyncio, json, random, sys, time, aiohttp
ROOM = sys.argv[1]; NAME = sys.argv[2] if len(sys.argv) > 2 else 'たろう'
async def main():
    async with aiohttp.ClientSession() as s:
        async with s.ws_connect('ws://localhost:8080/ws') as ws:
            await ws.send_json({'type': 'join', 'room': ROOM, 'name': NAME})
            last_key = None; picked_round = None; greeted = False; my = None
            async for msg in ws:
                if msg.type != aiohttp.WSMsgType.TEXT: break
                d = json.loads(msg.data)
                if d.get('type') != 'state': continue
                st = d['state'] if 'state' in d else d
                my = st.get('you', my)
                if st['phase'] == 'lobby' and not greeted:
                    greeted = True; await asyncio.sleep(1.5); await ws.send_json({'type': 'chat', 'text': 'よろしく〜！国旗ぜんぜん分からないけど頑張る'})
                if st['phase'] == 'pick' and picked_round != st['round'] and st.get('hand'):
                    picked_round = st['round']
                    hand = list(st['hand'])
                    async def think(hand=hand, rnd=st['round']):
                        await asyncio.sleep(random.uniform(2.5, 4.5))
                        c1 = random.choice(hand); await ws.send_json({'type': 'selecting', 'card': c1})
                        await asyncio.sleep(random.uniform(1.5, 3))
                        c2 = random.choice(hand); await ws.send_json({'type': 'pick', 'card': c2})
                        if rnd == 2: await asyncio.sleep(1); await ws.send_json({'type': 'chat', 'text': 'これ難しい…勘で出した！'})
                    asyncio.ensure_future(think())
                key = (st['phase'], st['round'])
                if key != last_key and st['phase'] == 'reveal' and st.get('reveal'):
                    me = next((r for r in st['reveal']['rows'] if r.get('pid') == my), None)
                    if me and st['round'] in (1, 3):
                        await asyncio.sleep(2.5); await ws.send_json({'type': 'chat', 'text': 'やったー！' if me.get('winner') else 'くやしい〜！'})
                last_key = key
                if st['phase'] == 'end':
                    await asyncio.sleep(3); break
asyncio.run(main())
