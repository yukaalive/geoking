# -*- coding: utf-8 -*-
"""GeoKing（地理王） オンライン対戦サーバー。aiohttp + WebSocket。
    python3 server.py  →  http://localhost:8080
"""
import asyncio, json, os, random, string, time, uuid
from aiohttp import web, WSMsgType
from prompts import PROMPTS, PROMPT_BY_ID, CATEGORIES, FIELDS

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'data', 'countries.json'), encoding='utf-8') as f:
    COUNTRIES = json.load(f)
COUNTRY_BY_ID = {c['id']: c for c in COUNTRIES}
BOT_NAMES = ['ボット・アトラス', 'ボット・コンパス', 'ボット・グローブ', 'ボット・メルカトル', 'ボット・ポラリス']

DEFAULT_SETTINGS = {
    'categories': ['basic', 'climate', 'religion', 'society'],
    'rounds': 7,
    'hand_size': 8,
    'show_names': False,   # 国旗の下に国名を表示（初心者向け）
    'timer': 0,            # 秒。0で無制限
    'max_star': 3,         # 出題する難易度の上限
    'public': False,       # 公開部屋一覧に載せる（世界の誰かと遊ぶ）
}

rooms = {}  # code -> Room


def new_code():
    while True:
        code = ''.join(random.choices(string.ascii_uppercase.replace('O', '').replace('I', '') + '23456789', k=4))
        if code not in rooms:
            return code


class Player:
    def __init__(self, pid, name, is_bot=False):
        self.pid, self.name, self.is_bot = pid, name, is_bot
        self.ws = None
        self.hand = []      # country ids
        self.score = 0
        self.won = []       # 獲得したお題id
        self.pick = None    # 今ラウンドに出したカード
        self.connected = is_bot
        self.last_seen = time.time()


class Room:
    def __init__(self, code, host_pid):
        self.code, self.host = code, host_pid
        self.players = {}   # pid -> Player
        self.order = []     # 参加順
        self.settings = dict(DEFAULT_SETTINGS)
        self.phase = 'lobby'  # lobby | pick | reveal | end
        self.round = 0
        self.prompts = []
        self.reveal = None
        self.chat = []
        self.timer_task = None
        self.deadline = None
        self.created = time.time()

    # ---------- game flow
    def start(self):
        s = self.settings
        pool = [p for p in PROMPTS if p['cat'] in s['categories'] and p['star'] <= s['max_star']]
        if len(pool) < s['rounds']:
            pool = pool * ((s['rounds'] // max(len(pool), 1)) + 1)
        self.prompts = random.sample(pool, s['rounds'])
        deck = [c['id'] for c in COUNTRIES]
        random.shuffle(deck)
        for pid in self.order:
            p = self.players[pid]
            p.hand = [deck.pop() for _ in range(s['hand_size'])]
            p.score, p.won, p.pick = 0, [], None
        self.round = 0
        self.begin_round()

    def begin_round(self):
        self.round += 1
        self.phase = 'pick'
        self.reveal = None
        for p in self.players.values():
            p.pick = None
        self.deadline = time.time() + self.settings['timer'] if self.settings['timer'] else None

    def current_prompt(self):
        return self.prompts[self.round - 1] if 0 < self.round <= len(self.prompts) else None

    def all_picked(self):
        return all(p.pick is not None for p in self.players.values() if p.connected or p.is_bot)

    def do_reveal(self):
        pr = self.current_prompt()
        key, direction = pr['key'], pr['dir']
        rows = []
        for pid in self.order:
            p = self.players[pid]
            if p.pick is None:
                continue
            c = COUNTRY_BY_ID[p.pick]
            v = c.get(key)
            rows.append({'pid': pid, 'name': p.name, 'card': p.pick, 'value': v})
        valid = [r for r in rows if r['value'] is not None]
        valid.sort(key=lambda r: r['value'], reverse=(direction == 'max'))
        best = valid[0]['value'] if valid else None
        rank = 0
        prev = object()
        for r in valid:
            if r['value'] != prev:
                rank += 1
                prev = r['value']
            r['rank'] = rank
        for r in rows:
            if r['value'] is None:
                r['rank'] = None
            r['winner'] = best is not None and r['value'] == best
            if r['winner']:
                self.players[r['pid']].score += 1
                self.players[r['pid']].won.append(pr['id'])
        for p in self.players.values():
            if p.pick in p.hand:
                p.hand.remove(p.pick)
        self.reveal = {'prompt': pr, 'rows': sorted(rows, key=lambda r: (r['rank'] is None, r['rank'] or 0))}
        self.phase = 'reveal'
        self.deadline = None

    def next_round(self):
        if self.round >= len(self.prompts):
            self.phase = 'end'
        else:
            self.begin_round()

    # ---------- views
    def public_players(self):
        return [{
            'pid': pid, 'name': p.name, 'score': p.score, 'is_bot': p.is_bot,
            'connected': p.connected, 'picked': p.pick is not None, 'won': p.won,
            'hand_count': len(p.hand),
        } for pid, p in ((pid, self.players[pid]) for pid in self.order)]

    def state_for(self, pid):
        me = self.players.get(pid)
        return {
            'type': 'state', 'room': self.code, 'host': self.host, 'you': pid,
            'phase': self.phase, 'round': self.round, 'total_rounds': len(self.prompts) or self.settings['rounds'],
            'settings': self.settings, 'players': self.public_players(),
            'prompt': self.current_prompt() if self.phase in ('pick', 'reveal') else None,
            'hand': me.hand if me else [],
            'my_pick': me.pick if me else None,
            'reveal': self.reveal,
            'deadline': self.deadline,
            'chat': self.chat[-30:],
        }


# ---------- helpers
async def send(ws, msg):
    if ws is None or ws.closed:
        return
    try:
        await ws.send_json(msg)
    except Exception:
        pass


async def broadcast(room):
    await asyncio.gather(*(send(p.ws, room.state_for(pid)) for pid, p in room.players.items() if not p.is_bot))


async def bots_play(room):
    for p in room.players.values():
        if p.is_bot and p.pick is None and p.hand:
            await asyncio.sleep(random.uniform(0.6, 1.8))
            if room.phase == 'pick' and p.pick is None:
                p.pick = random.choice(p.hand)
                if not room.all_picked():
                    await broadcast(room)   # ✓ 表示を更新
    await maybe_reveal(room)


async def maybe_reveal(room):
    if room.phase == 'pick' and room.all_picked():
        room.do_reveal()
        await broadcast(room)


async def start_timer(room):
    if room.timer_task:
        room.timer_task.cancel()
    if not room.deadline:
        return
    async def _run():
        await asyncio.sleep(max(0, room.deadline - time.time()))
        if room.phase == 'pick':
            for p in room.players.values():
                if p.pick is None and p.hand:
                    p.pick = random.choice(p.hand)  # 時間切れはランダム
            room.do_reveal()
            await broadcast(room)
    room.timer_task = asyncio.create_task(_run())


async def enter_pick_phase(room):
    await broadcast(room)
    await start_timer(room)
    asyncio.create_task(bots_play(room))


# ---------- websocket handler
async def ws_handler(request):
    ws = web.WebSocketResponse(heartbeat=25)
    await ws.prepare(request)
    room, pid = None, None

    async def error(msg):
        await send(ws, {'type': 'error', 'message': msg})

    async for msg in ws:
        if msg.type != WSMsgType.TEXT:
            continue
        try:
            data = json.loads(msg.data)
        except Exception:
            continue
        t = data.get('type')

        if t == 'create':
            name = (data.get('name') or 'プレイヤー').strip()[:16]
            pid = data.get('pid') or uuid.uuid4().hex[:12]
            room = Room(new_code(), pid)
            rooms[room.code] = room
            p = Player(pid, name); p.ws = ws; p.connected = True
            room.players[pid] = p; room.order.append(pid)
            await broadcast(room)

        elif t == 'join':
            code = (data.get('room') or '').strip().upper()
            r = rooms.get(code)
            if not r:
                await error('その部屋コードは見つかりません'); continue
            name = (data.get('name') or 'プレイヤー').strip()[:16]
            pid = data.get('pid') or uuid.uuid4().hex[:12]
            if pid in r.players:          # 再接続
                p = r.players[pid]; p.ws = ws; p.connected = True; p.name = name or p.name
            else:
                if r.phase != 'lobby':
                    await error('このゲームはすでに開始しています'); continue
                if len(r.players) >= 8:
                    await error('満員です（最大8人）'); continue
                p = Player(pid, name); p.ws = ws; p.connected = True
                r.players[pid] = p; r.order.append(pid)
            room = r
            await broadcast(room)

        elif room is None:
            await error('先に部屋を作成または参加してください')

        elif t == 'settings' and pid == room.host and room.phase == 'lobby':
            s = data.get('settings') or {}
            cats = [c for c in s.get('categories', room.settings['categories']) if c in CATEGORIES] or ['basic']
            room.settings.update({
                'categories': cats,
                'rounds': max(3, min(12, int(s.get('rounds', room.settings['rounds'])))),
                'hand_size': max(4, min(12, int(s.get('hand_size', room.settings['hand_size'])))),
                'show_names': bool(s.get('show_names', room.settings['show_names'])),
                'timer': max(0, min(180, int(s.get('timer', room.settings['timer'])))),
                'max_star': max(1, min(3, int(s.get('max_star', room.settings['max_star'])))),
                'public': bool(s.get('public', room.settings['public'])),
            })
            if room.settings['hand_size'] < room.settings['rounds']:
                room.settings['hand_size'] = room.settings['rounds'] + 1
            await broadcast(room)

        elif t == 'add_bot' and pid == room.host and room.phase == 'lobby':
            if len(room.players) >= 8:
                await error('満員です'); continue
            used = {p.name for p in room.players.values()}
            name = next((n for n in BOT_NAMES if n not in used), f'ボット{len(room.players)}')
            bpid = 'bot_' + uuid.uuid4().hex[:6]
            room.players[bpid] = Player(bpid, name, is_bot=True); room.order.append(bpid)
            await broadcast(room)

        elif t == 'kick' and pid == room.host and room.phase == 'lobby':
            target = data.get('pid')
            if target in room.players and target != room.host:
                room.players.pop(target); room.order.remove(target)
                await broadcast(room)

        elif t == 'start' and pid == room.host and room.phase in ('lobby', 'end'):
            if len(room.players) < 2:
                await error('2人以上（ボット可）で開始できます'); continue
            room.start()
            await enter_pick_phase(room)

        elif t == 'pick' and room.phase == 'pick':
            p = room.players[pid]
            card = data.get('card')
            if card in p.hand:
                p.pick = card
                await broadcast(room)
                await maybe_reveal(room)

        elif t == 'next' and pid == room.host and room.phase == 'reveal':
            room.next_round()
            if room.phase == 'pick':
                await enter_pick_phase(room)
            else:
                await broadcast(room)

        elif t == 'chat':
            text = (data.get('text') or '').strip()[:80]
            if text:
                room.chat.append({'name': room.players[pid].name, 'text': text, 'ts': time.time()})
                await broadcast(room)

        elif t == 'to_lobby' and pid == room.host:
            room.phase = 'lobby'; room.round = 0; room.reveal = None
            for p in room.players.values():
                p.hand, p.pick, p.score, p.won = [], None, 0, []
            await broadcast(room)

    # 切断処理
    if room and pid in room.players:
        p = room.players[pid]
        p.connected = False; p.ws = None
        if room.phase == 'lobby':
            room.players.pop(pid); room.order.remove(pid)
            if room.host == pid and room.order:
                room.host = room.order[0]
        elif room.phase == 'pick' and room.all_picked():
            room.do_reveal()
        if not any(pl.connected and not pl.is_bot for pl in room.players.values()):
            rooms.pop(room.code, None)
        else:
            await broadcast(room)
    return ws


# ---------- REST
async def api_meta(request):
    return web.json_response({
        'countries': {c['id']: c for c in COUNTRIES},
        'fields': FIELDS, 'categories': CATEGORIES,
        'prompts': PROMPTS,
    })

async def index(request):
    raise web.HTTPFound('/static/index.html')

async def api_rooms(request):
    """募集中（ロビー状態）の公開部屋一覧。"""
    now = time.time()
    for code in [c for c, r in rooms.items() if now - r.created > 6 * 3600]:
        rooms.pop(code, None)  # 6時間で自動掃除
    out = []
    for r in rooms.values():
        if r.settings['public'] and r.phase == 'lobby' and 0 < len(r.players) < 8:
            host = r.players.get(r.host)
            out.append({'room': r.code, 'host': host.name if host else '', 'players': len(r.players),
                        'categories': r.settings['categories'], 'rounds': r.settings['rounds'], 'age': int(now - r.created)})
    out.sort(key=lambda x: x['age'])
    return web.json_response({'rooms': out[:20]})

async def healthz(request):
    return web.json_response({'ok': True, 'rooms': len(rooms)})


def make_app():
    app = web.Application()
    app.router.add_get('/', index)
    app.router.add_get('/healthz', healthz)
    app.router.add_get('/api/meta', api_meta)
    app.router.add_get('/api/rooms', api_rooms)
    app.router.add_get('/ws', ws_handler)
    app.router.add_static('/static/', os.path.join(HERE, 'static'))
    return app


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8080'))
    print(f'GeoKing server: http://localhost:{port}')
    web.run_app(make_app(), port=port, print=None)
