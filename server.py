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
# 初期名（日本でよくある名前）とボット名（アメリカでよくある名前）
JP_NAMES = ['さくら', 'ゆうき', 'はると', 'みお', 'そうた', 'ひなた', 'りく', 'あおい', 'ゆい', 'こうき',
            'はな', 'だいき', 'めい', 'たくみ', 'りん', 'けんた', 'ももか', 'しょうた', 'あかり', 'ゆうと',
            'なな', 'かいと', 'ひかり', 'れん', 'みさき', 'たいち', 'ことね', 'ゆうま', 'まお', 'しゅん',
            'ひろと', 'えみ', 'まさき', 'かな', 'りょう', 'あやか', 'つばさ', 'みゆ', 'けい', 'なつき']
BOT_NAMES = ['エミリー', 'マイケル', 'オリビア', 'ジェームズ', 'ソフィア', 'ノア', 'エマ', 'リアム', 'アヴァ', 'イーサン',
             'ミア', 'ジェイコブ', 'イザベラ', 'メイソン', 'シャーロット', 'ルーカス', 'アメリア', 'ベンジャミン', 'ハーパー', 'ローガン',
             'エヴリン', 'アレクサンダー', 'アビゲイル', 'ダニエル', 'エミリア', 'ヘンリー', 'エラ', 'ジャクソン', 'グレース', 'サミュエル']

DEFAULT_SETTINGS = {
    'categories': ['basic', 'climate', 'religion', 'society'],
    'rounds': 7,
    'hand_size': 8,
    'show_names': False,   # 国旗の下に国名を表示（初心者向け）
    'timer': 30,           # 回答の制限時間（秒）。0で無制限。時間切れは手札からランダムに出る
    'max_star': 3,         # 出題する難易度の上限
    'public': False,       # 公開部屋一覧に載せる（世界の誰かと遊ぶ）
}

MAX_ROOMS = 300
MAX_PLAYERS = 8
ROOM_TTL = 6 * 3600
EMPTY_GRACE = 90       # 秒。人間が全員切断しても、この間は部屋を残す（リロード・再接続用）
CHAT_INTERVAL = 0.7    # 秒。連投制限
REVEAL_SECONDS = 5     # 結果表示の秒数。経過後は自動で次のラウンドへ

rooms = {}  # code -> Room


def clean_name(v, room=None):
    name = ''.join(ch for ch in str(v or '') if ch.isprintable()).strip()[:16]
    if name:
        return name
    used = {p.name for p in room.players.values()} if room else set()
    return random.choice([x for x in JP_NAMES if x not in used] or JP_NAMES)


def cleanup_rooms():
    now = time.time()
    for code, r in list(rooms.items()):
        if now - r.created > ROOM_TTL or (r.empty_since and now - r.empty_since > EMPTY_GRACE):
            for task in (r.timer_task, r.reveal_task):
                if task:
                    task.cancel()
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
        self.title = ''
        self.deck = []
        self.history = []   # 各ラウンドの公開結果（最終結果の一覧用）
        self.timer_task = None
        self.reveal_task = None
        self.deadline = None
        self.next_at = None     # 結果表示が終わり次のラウンドに進む時刻
        self.empty_since = None # 人間が全員いなくなった時刻
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
        self.deck = deck   # 途中参加者に配る残り山札
        self.history = []
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
        self.history.append({'round': self.round, **self.reveal})
        self.phase = 'reveal'
        self.deadline = None
        self.next_at = time.time() + REVEAL_SECONDS

    def next_round(self):
        if self.round >= len(self.prompts):
            self.phase = 'end'
        else:
            self.begin_round()

    def deal_late(self, p):
        """途中参加者に、残りラウンド数＋1枚を配る（元の「1枚余る」感覚を維持）。"""
        remaining = len(self.prompts) - self.round + (1 if self.phase == 'pick' else 0)
        need = max(1, remaining + 1)
        if len(self.deck) < need:   # 山札不足なら誰も持っていないカードを補充
            held = {c for pl in self.players.values() for c in pl.hand}
            extra = [c['id'] for c in COUNTRIES if c['id'] not in held and c['id'] not in self.deck]
            random.shuffle(extra); self.deck += extra
        p.hand = [self.deck.pop() for _ in range(min(need, len(self.deck)))]
        p.score, p.won, p.pick = 0, [], None

    def display_title(self):
        if self.title:
            return self.title
        host = self.players.get(self.host)
        return f"{host.name}の部屋" if host else '部屋'

    def reset_to_lobby(self):
        if self.reveal_task:
            self.reveal_task.cancel()
        self.phase, self.round, self.reveal, self.next_at = 'lobby', 0, None, None
        for p in self.players.values():
            p.hand, p.pick, p.score, p.won = [], None, 0, []
        self.history = []

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
            'type': 'state', 'room': self.code, 'title': self.display_title(), 'title_raw': self.title, 'host': self.host, 'you': pid,
            'token': me.token if me else None,   # 本人の再接続用トークン（他人には送られない）
            'phase': self.phase, 'round': self.round, 'total_rounds': len(self.prompts) or self.settings['rounds'],
            'settings': self.settings, 'players': self.public_players(),
            'prompt': self.current_prompt() if self.phase in ('pick', 'reveal') else None,
            'hand': me.hand if me else [],
            'hands': {x: pl.hand for x, pl in self.players.items()},   # 全員の手札（出したカードは公開まで手札に残るので選択は漏れない）
            'history': self.history if self.phase == 'end' else None,
            'my_pick': me.pick if me else None,
            'reveal': self.reveal,
            'deadline': self.deadline,
            'next_at': self.next_at if self.phase == 'reveal' else None,
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


async def finish_reveal(room):
    """結果を公開し、REVEAL_SECONDS 後に自動で次のラウンド（または結果発表）へ進む。"""
    room.do_reveal()
    await broadcast(room)
    if room.reveal_task:
        room.reveal_task.cancel()

    async def _advance():
        await asyncio.sleep(REVEAL_SECONDS)
        if room.phase != 'reveal' or rooms.get(room.code) is not room:
            return
        room.next_round()
        if room.phase == 'pick':
            await enter_pick_phase(room)
        else:
            await broadcast(room)
    room.reveal_task = asyncio.create_task(_advance())


async def maybe_reveal(room):
    if room.phase == 'pick' and room.all_picked():
        await finish_reveal(room)


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
            await finish_reveal(room)
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


async def after_player_gone(room, name):
    """退出・キック・切断後の後始末。"""
    if not room.has_humans():
        room.empty_since = room.empty_since or time.time()   # 猶予後に cleanup_rooms が削除
        return
    if room.phase in ('pick', 'reveal', 'end') and name:
        room.chat.append({'name': 'システム', 'text': f'{name} さんが退出しました', 'ts': time.time()})
        room.chat = room.chat[-60:]
    if room.phase == 'pick' and room.all_picked():
        return await finish_reveal(room)
    await broadcast(room)


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
                r.empty_since = None
            else:
                if len(r.players) >= MAX_PLAYERS:
                    return await error('満員です（最大8人）')
                if r.phase == 'end':
                    return await error('このゲームは終了しています。ホストが再戦を始めるまでお待ちください')
                pid = uuid.uuid4().hex[:12]
                p = Player(pid, clean_name(data.get('name'), r))
                p.ws, p.connected = ws, True
                r.players[pid] = p
                r.order.append(pid)
                r.empty_since = None
                if r.phase in ('pick', 'reveal'):   # 途中参加
                    r.deal_late(p)
                    r.chat.append({'name': 'システム', 'text': f'{p.name} さんが途中参加しました', 'ts': time.time()})
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
            if 'title' in s:
                room.title = ''.join(ch for ch in str(s.get('title') or '') if ch.isprintable()).strip()[:20]
            if room.settings['hand_size'] < room.settings['rounds']:
                room.settings['hand_size'] = room.settings['rounds'] + 1
            return await broadcast(room)

        if t == 'add_bot':
            if not (is_host and room.phase == 'lobby'):
                return
            if len(room.players) >= MAX_PLAYERS:
                return await error('満員です')
            used = {p.name for p in room.players.values()}
            name = random.choice([x for x in BOT_NAMES if x not in used] or BOT_NAMES)
            bpid = 'bot_' + uuid.uuid4().hex[:6]
            room.players[bpid] = Player(bpid, name, is_bot=True)
            room.order.append(bpid)
            return await broadcast(room)

        if t == 'kick':
            if not is_host:
                return
            target = str(data.get('pid') or '')
            if target in room.players and target != room.host:
                tp = room.players[target]
                room.remove_player(target)
                if tp.ws is not None and not tp.ws.closed:
                    await send(tp.ws, {'type': 'left', 'message': 'ホストによって退出させられました'})
                    await tp.ws.close()
                await after_player_gone(room, tp.name)
            return

        if t == 'leave':
            p = room.players[pid]
            room.remove_player(pid)
            ctx['room'], ctx['pid'] = None, None
            await send(ws, {'type': 'left', 'message': '部屋から退出しました'})
            return await after_player_gone(room, p.name)

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
        await after_player_gone(room, None)
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
        if r.settings['public'] and r.phase != 'end' and 0 < len(r.players) < MAX_PLAYERS and r.has_humans():
            host = r.players.get(r.host)
            out.append({'room': r.code, 'title': r.display_title(), 'phase': r.phase, 'round': r.round,
                        'host': host.name if host else '', 'players': len(r.players),
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


async def periodic_cleanup(app):
    async def _run():
        while True:
            await asyncio.sleep(30)
            cleanup_rooms()
    task = asyncio.create_task(_run())
    yield
    task.cancel()


def make_app():
    app = web.Application(middlewares=[security_headers], client_max_size=64 * 1024)
    app.cleanup_ctx.append(periodic_cleanup)
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
