# -*- coding: utf-8 -*-
"""GeoKing（地理王） オンライン対戦サーバー。aiohttp + WebSocket。
    python3 server.py  →  http://localhost:8080
"""
import asyncio, json, os, random, secrets, string, time, uuid
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

MAX_ROOMS = 300
MAX_PLAYERS = 8
ROOM_TTL = 6 * 3600
CHAT_INTERVAL = 0.7    # 秒。連投制限

rooms = {}  # code -> Room


def clean_name(v):
    name = ''.join(ch for ch in str(v or '') if ch.isprintable()).strip()[:16]
    return name or 'プレイヤー'


def cleanup_rooms():
    now = time.time()
    for code in [c for c, r in rooms.items() if now - r.created > ROOM_TTL]:
        rooms.pop(code, None)


def new_code():
    alphabet = string.ascii_uppercase.replace('O', '').replace('I', '') + '23456789'
    while True:
        code = ''.join(random.choices(alphabet, k=4))
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
        self.token = None if is_bot else secrets.token_hex(16)  # 再接続用の秘密。本人にだけ送る
        self.last_chat = 0.0


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
        if not pool:
            pool = [p for p in PROMPTS if p['cat'] in s['categories']] or list(PROMPTS)
        if len(pool) < s['rounds']:
            pool = pool * ((s['rounds'] // len(pool)) + 1)
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
            rows.append({'pid': pid, 'name': p.name, 'card': p.pick, 'value': c.get(key)})
        valid = [r for r in rows if r['value'] is not None]
        valid.sort(key=lambda r: r['value'], reverse=(direction == 'max'))
        best = valid[0]['value'] if valid else None
        rank, prev = 0, object()
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

    def reset_to_lobby(self):
        self.phase, self.round, self.reveal = 'lobby', 0, None
        for p in self.players.values():
            p.hand, p.pick, p.score, p.won = [], None, 0, []

    def remove_player(self, pid):
        self.players.pop(pid, None)
        if pid in self.order:
            self.order.remove(pid)
        if self.host == pid:
            humans = [x for x in self.order if not self.players[x].is_bot]
            self.host = humans[0] if humans else (self.order[0] if self.order else None)

    def has_humans(self):
        return any(p.connected and not p.is_bot for p in self.players.values())

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
            'token': me.token if me else None,   # 本人の再接続用トークン（他人には送られない）
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
    for p in list(room.players.values()):
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


def to_int(v, lo, hi, default):
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


# ---------- websocket handler
async def ws_handler(request):
    ws = web.WebSocketResponse(heartbeat=25)
    await ws.prepare(request)
    ctx = {'room': None, 'pid': None}

    async def error(msg):
        await send(ws, {'type': 'error', 'message': msg})

    async def handle(data):
        t = data.get('type')
        room, pid = ctx['room'], ctx['pid']

        if t == 'create':
            cleanup_rooms()
            if len(rooms) >= MAX_ROOMS:
                return await error('現在満室です。しばらくしてからお試しください')
            pid = uuid.uuid4().hex[:12]
            room = Room(new_code(), pid)
            rooms[room.code] = room
            p = Player(pid, clean_name(data.get('name')))
            p.ws, p.connected = ws, True
            room.players[pid] = p
            room.order.append(pid)
            ctx['room'], ctx['pid'] = room, pid
            return await broadcast(room)

        if t == 'join':
            code = str(data.get('room') or '').strip().upper()[:4]
            r = rooms.get(code)
            if not r:
                return await error('その部屋コードは見つかりません')
            want_pid = str(data.get('pid') or '')[:12]
            if want_pid and want_pid in r.players:
                # 再接続: 秘密トークンが一致した本人のみ（他人のIDでのなりすまし防止）
                p = r.players[want_pid]
                if p.is_bot or not secrets.compare_digest(str(data.get('token') or ''), p.token or ''):
                    return await error('再接続の認証に失敗しました')
                if p.ws is not None and p.ws is not ws and not p.ws.closed:
                    await p.ws.close()
                p.ws, p.connected = ws, True
                pid = want_pid
            else:
                if r.phase != 'lobby':
                    return await error('このゲームはすでに開始しています')
                if len(r.players) >= MAX_PLAYERS:
                    return await error('満員です（最大8人）')
                pid = uuid.uuid4().hex[:12]
                p = Player(pid, clean_name(data.get('name')))
                p.ws, p.connected = ws, True
                r.players[pid] = p
                r.order.append(pid)
            ctx['room'], ctx['pid'] = r, pid
            return await broadcast(r)

        if room is None or pid not in room.players:
            return await error('先に部屋を作成または参加してください')
        is_host = (pid == room.host)

        if t == 'settings':
            if not (is_host and room.phase == 'lobby'):
                return
            s = data.get('settings') or {}
            if not isinstance(s, dict):
                return await error('入力値が不正です')
            cats = s.get('categories', room.settings['categories'])
            cats = [c for c in cats if c in CATEGORIES] if isinstance(cats, list) else room.settings['categories']
            cur = room.settings
            room.settings.update({
                'categories': cats or ['basic'],
                'rounds': to_int(s.get('rounds', cur['rounds']), 3, 12, cur['rounds']),
                'hand_size': to_int(s.get('hand_size', cur['hand_size']), 4, 12, cur['hand_size']),
                'show_names': bool(s.get('show_names', cur['show_names'])),
                'timer': to_int(s.get('timer', cur['timer']), 0, 180, cur['timer']),
                'max_star': to_int(s.get('max_star', cur['max_star']), 1, 3, cur['max_star']),
                'public': bool(s.get('public', cur['public'])),
            })
            if room.settings['hand_size'] < room.settings['rounds']:
                room.settings['hand_size'] = room.settings['rounds'] + 1
            return await broadcast(room)

        if t == 'add_bot':
            if not (is_host and room.phase == 'lobby'):
                return
            if len(room.players) >= MAX_PLAYERS:
                return await error('満員です')
            used = {p.name for p in room.players.values()}
            name = next((n for n in BOT_NAMES if n not in used), f'ボット{len(room.players)}')
            bpid = 'bot_' + uuid.uuid4().hex[:6]
            room.players[bpid] = Player(bpid, name, is_bot=True)
            room.order.append(bpid)
            return await broadcast(room)

        if t == 'kick':
            if not (is_host and room.phase == 'lobby'):
                return
            target = str(data.get('pid') or '')
            if target in room.players and target != room.host:
                tp = room.players[target]
                room.remove_player(target)
                if tp.ws is not None and not tp.ws.closed:
                    await send(tp.ws, {'type': 'error', 'message': 'ホストによって退出させられました'})
                    await tp.ws.close()
            return await broadcast(room)

        if t == 'start':
            if not (is_host and room.phase in ('lobby', 'end')):
                return
            if len(room.players) < 2:
                return await error('2人以上（ボット可）で開始できます')
            room.start()
            return await enter_pick_phase(room)

        if t == 'pick':
            if room.phase != 'pick':
                return
            p = room.players[pid]
            card = data.get('card')
            if isinstance(card, str) and card in p.hand:
                p.pick = card
                await broadcast(room)
                await maybe_reveal(room)
            return

        if t == 'next':
            if not (is_host and room.phase == 'reveal'):
                return
            room.next_round()
            if room.phase == 'pick':
                return await enter_pick_phase(room)
            return await broadcast(room)

        if t == 'chat':
            text = ''.join(ch for ch in str(data.get('text') or '') if ch.isprintable()).strip()[:80]
            p = room.players[pid]
            now = time.time()
            if text and now - p.last_chat >= CHAT_INTERVAL:
                p.last_chat = now
                room.chat.append({'name': p.name, 'text': text, 'ts': now})
                room.chat = room.chat[-60:]
                return await broadcast(room)
            return

        if t == 'to_lobby':
            if not is_host:
                return
            room.reset_to_lobby()
            return await broadcast(room)

    async for msg in ws:
        if msg.type != WSMsgType.TEXT:
            continue
        if len(msg.data) > 4000:
            await error('メッセージが大きすぎます')
            continue
        try:
            data = json.loads(msg.data)
            if not isinstance(data, dict):
                raise ValueError
        except ValueError:
            await error('入力値が不正です')
            continue
        try:
            await handle(data)
        except Exception:   # 1人の不正入力で接続や部屋を落とさない
            await error('処理に失敗しました')

    # ---------- 切断処理
    room, pid = ctx['room'], ctx['pid']
    if room and pid in room.players and room.players[pid].ws is ws:
        p = room.players[pid]
        p.connected, p.ws = False, None
        if room.phase == 'lobby':
            room.remove_player(pid)
        elif room.phase == 'pick' and room.all_picked():
            room.do_reveal()
        if not room.has_humans():
            if room.timer_task:
                room.timer_task.cancel()
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


async def api_rooms(request):
    """募集中（ロビー状態）の公開部屋一覧。"""
    cleanup_rooms()
    now = time.time()
    out = []
    for r in rooms.values():
        if r.settings['public'] and r.phase == 'lobby' and 0 < len(r.players) < MAX_PLAYERS:
            host = r.players.get(r.host)
            out.append({'room': r.code, 'host': host.name if host else '', 'players': len(r.players),
                        'categories': r.settings['categories'], 'rounds': r.settings['rounds'], 'age': int(now - r.created)})
    out.sort(key=lambda x: x['age'])
    return web.json_response({'rooms': out[:20]})


async def index(request):
    raise web.HTTPFound('/static/index.html')


async def healthz(request):
    return web.json_response({'ok': True, 'rooms': len(rooms)})


@web.middleware
async def security_headers(request, handler):
    resp = await handler(request)
    resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
    resp.headers.setdefault('X-Frame-Options', 'DENY')
    resp.headers.setdefault('Referrer-Policy', 'no-referrer')
    return resp


def make_app():
    app = web.Application(middlewares=[security_headers], client_max_size=64 * 1024)
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
