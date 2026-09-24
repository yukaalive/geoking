# -*- coding: utf-8 -*-
"""GeoKing（地理王） オンライン対戦サーバー。aiohttp + WebSocket。
    python3 server.py  →  http://localhost:8080
"""
import asyncio, json, logging, os, random, secrets, string, time, uuid
import hmac
import html
from datetime import datetime, timezone, timedelta
from aiohttp import web, WSMsgType
from prompts import PROMPTS, PROMPT_BY_ID, CATEGORIES, FIELDS, round_value
from moderation import check_name, check_chat

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
log = logging.getLogger('geoking')   # Render の Logs タブ / ローカルの標準出力に出る

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'data', 'countries.json'), encoding='utf-8') as f:
    COUNTRIES = json.load(f)
COUNTRY_BY_ID = {c['id']: c for c in COUNTRIES}
# お題ごとの世界順位計算用: 指標 → データがある国の値一覧
WORLD_VALUES = {p['key']: [round_value(p['key'], c[p['key']]) for c in COUNTRIES if c.get(p['key']) is not None] for p in PROMPTS}   # 表示桁で丸め
# ボット名（アメリカでよくある名前）
BOT_NAMES = ['エミリー', 'マイケル', 'オリビア', 'ジェームズ', 'ソフィア', 'ノア', 'エマ', 'リアム', 'アヴァ', 'イーサン',
             'ミア', 'ジェイコブ', 'イザベラ', 'メイソン', 'シャーロット', 'ルーカス', 'アメリア', 'ベンジャミン', 'ハーパー', 'ローガン',
             'エヴリン', 'アレクサンダー', 'アビゲイル', 'ダニエル', 'エミリア', 'ヘンリー', 'エラ', 'ジャクソン', 'グレース', 'サミュエル']
BOT_NAMES_EN = ['Emily', 'Michael', 'Olivia', 'James', 'Sophia', 'Noah', 'Emma', 'Liam', 'Ava', 'Ethan',
                'Mia', 'Jacob', 'Isabella', 'Mason', 'Charlotte', 'Lucas', 'Amelia', 'Benjamin', 'Harper', 'Logan',
                'Evelyn', 'Alexander', 'Abigail', 'Daniel', 'Emilia', 'Henry', 'Ella', 'Jackson', 'Grace', 'Samuel']

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
# チャットは moderation.check_chat（NGワード・連絡先・URL・連打）を通過したものだけ流れる
REPORTS_TO_MUTE = 2   # 異なる2人から通報されたら、その部屋ではチャット禁止
REVEAL_SECONDS = 8     # 結果表示の秒数。経過後は自動で次のラウンドへ
if os.environ.get('GEOKING_DEMO'):   # 撮影用デモ: 操作に時間がかかるので制限時間と結果表示を長く
    DEFAULT_SETTINGS['timer'] = 120
    REVEAL_SECONDS = 25

rooms = {}  # code -> Room


def norm_title(s):
    """部屋名の照合用: 全角半角・大文字小文字・空白の違いを無視"""
    import unicodedata
    return ''.join(unicodedata.normalize('NFKC', str(s or '')).casefold().split())


def find_room_by_title(name, exclude=None):
    key = norm_title(name)
    if not key:
        return None
    for r in rooms.values():
        if r is not exclude and norm_title(r.title) == key:
            return r
    return None


def unique_title(base, exclude=None):
    """他の部屋と重ならない部屋名（重なったら 2, 3… を付ける）"""
    base = (base or '部屋')[:18]
    cand, n = base, 2
    while find_room_by_title(cand, exclude):
        cand = f'{base}{n}'; n += 1
    return cand


def clean_name(v, room=None):
    """名前は必須。空なら '' を返し、呼び出し側でエラーにする。"""
    return ''.join(ch for ch in str(v or '') if ch.isprintable()).strip()[:16]


def cleanup_rooms():
    now = time.time()
    for code, r in list(rooms.items()):
        if now - r.created > ROOM_TTL or (r.empty_since and now - r.empty_since > EMPTY_GRACE):
            for task in (r.timer_task, r.reveal_task):
                if task:
                    task.cancel()
            rooms.pop(code, None)
            log.info('room %s removed (%s), rooms=%d', code, 'ttl' if now - r.created > ROOM_TTL else 'empty', len(rooms))


def new_code():
    alphabet = string.ascii_uppercase.replace('O', '').replace('I', '') + '23456789'
    while True:
        code = ''.join(random.choices(alphabet, k=4))
        if code not in rooms:
            return code


class Player:
    def __init__(self, pid, name, is_bot=False):
        self.pid, self.name, self.is_bot = pid, name, is_bot
        self.name_en = None      # ボットの英語名（英語表示用）
        self.ws = None
        self.hand = []      # country ids
        self.score = 0
        self.won = []       # 獲得したお題id
        self.pick = None    # 今ラウンドに出したカード
        self.selecting = None  # いま選んでいる（まだ出していない）カード。観戦者にだけ見せる
        self.connected = is_bot
        self.token = None if is_bot else secrets.token_hex(16)  # 再接続用の秘密。本人にだけ送る
        self.spectator = False   # 観戦中（途中参加者は既定で観戦。次のゲームから、または「途中から参加」で参加）
        self.last_chat = 0.0
        self.muted = set()       # 自分が非表示にした相手の pid
        self.reported_by = set() # 自分を通報した人の pid
        self.chat_banned = False # 通報が重なりチャット禁止


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
        # 撮影用デモ（環境変数 GEOKING_DEMO="お題id:国コード,国コード,…"）: 1問目のお題と各プレイヤーの手札に入れる国を固定。本番では未設定
        demo = os.environ.get('GEOKING_DEMO', '')
        fixed = []
        if demo and ':' in demo:
            pid_, cards_ = demo.split(':', 1)
            if pid_ in PROMPT_BY_ID:
                self.prompts = [PROMPT_BY_ID[pid_]] + [p for p in self.prompts if p['id'] != pid_][:s['rounds'] - 1]
            fixed = [c for c in cards_.split(',') if c in deck]
            for c in fixed: deck.remove(c)
        for i, pid in enumerate(self.order):
            p = self.players[pid]
            p.spectator = False
            p.hand = [deck.pop() for _ in range(s['hand_size'])]
            if i < len(fixed):
                p.hand[random.randrange(len(p.hand))] = fixed[i]
            p.score, p.won, p.pick = 0, [], None
        self.deck = deck   # 途中参加者に配る残り山札
        self.history = []
        self.round = 0
        log.info('room %s start: players=%s rounds=%d cats=%s', self.code,
                 [self.players[x].name + ('(bot)' if self.players[x].is_bot else '') for x in self.order], s['rounds'], ','.join(s['categories']))
        self.begin_round()

    def begin_round(self):
        self.round += 1
        self.phase = 'pick'
        self.reveal = None
        for p in self.players.values():
            p.pick = None
            p.selecting = None
        self.deadline = time.time() + self.settings['timer'] if self.settings['timer'] else None

    def current_prompt(self):
        return self.prompts[self.round - 1] if 0 < self.round <= len(self.prompts) else None

    def all_picked(self):
        return all(p.pick is not None for p in self.players.values() if (p.connected or p.is_bot) and not p.spectator)

    def do_reveal(self):
        pr = self.current_prompt()
        key, direction = pr['key'], pr['dir']
        rows = []
        for pid in self.order:
            p = self.players[pid]
            if p.pick is None:
                continue
            c = COUNTRY_BY_ID[p.pick]
            v = round_value(key, c.get(key))   # 表示桁で丸めて比較（例: 平均寿命 84.04 と 84.0 は同じ 84.0 歳 → 同順位）
            wr = None
            if v is not None:   # 世界順位: データがある国の中で、自分より良い値の国の数 + 1
                better = sum(1 for x in WORLD_VALUES[key] if (x > v if direction == 'max' else x < v))
                wr = better + 1
            rows.append({'pid': pid, 'name': p.name, 'name_en': p.name_en, 'card': p.pick, 'value': 0 if v is None else v, 'missing': v is None,
                         'world_rank': wr, 'world_total': len(WORLD_VALUES[key])})
        valid = sorted(rows, key=lambda r: r['value'], reverse=(direction == 'max'))
        best = valid[0]['value'] if valid else None
        rank, prev = 0, object()
        for r in valid:
            if r['value'] != prev:
                rank += 1
                prev = r['value']
            r['rank'] = rank
        for r in rows:
            r['winner'] = best is not None and r['value'] == best
            if r['winner']:
                self.players[r['pid']].score += 1
                self.players[r['pid']].won.append(pr['id'])
        for p in self.players.values():
            if p.pick in p.hand:
                p.hand.remove(p.pick)
        self.reveal = {'prompt': pr, 'rows': sorted(rows, key=lambda r: (r['rank'] is None, r['rank'] or 0))}
        self.history.append({'round': self.round, **self.reveal})
        log.info('room %s R%d %s -> %s', self.code, self.round, pr['text'],
                 ' | '.join(f"{r['name']}:{r['card']}={r['value']}{'*' if r['winner'] else ''}" for r in rows))
        self.phase = 'reveal'
        self.deadline = None
        self.next_at = time.time() + REVEAL_SECONDS

    def next_round(self):
        if self.round >= len(self.prompts):
            self.phase = 'end'
            log.info('room %s end: %s', self.code, {self.players[x].name: self.players[x].score for x in self.order})
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

    def display_title(self):   # 互換用（title は作成時に必ず入る）
        if self.title:
            return self.title
        host = self.players.get(self.host)
        return f"{host.name}の部屋" if host else '部屋'

    def reset_to_lobby(self):
        for task in (self.reveal_task, self.timer_task):
            if task:
                task.cancel()
        self.phase, self.round, self.reveal, self.next_at, self.deadline = 'lobby', 0, None, None, None
        self.history, self.prompts = [], []
        for p in self.players.values():
            p.hand, p.pick, p.selecting, p.score, p.won, p.spectator = [], None, None, 0, [], False
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
            'pid': pid, 'name': p.name, 'name_en': p.name_en, 'score': p.score, 'is_bot': p.is_bot,
            'connected': p.connected, 'picked': p.pick is not None, 'won': p.won, 'spectator': p.spectator,
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
            # 観戦者にだけ、各プレイヤーが「いま選んでいる／出した」カードをリアルタイムで見せる
            'live': ({x: {'selecting': pl.selecting, 'pick': pl.pick} for x, pl in self.players.items() if not pl.spectator}
                     if (me and me.spectator and self.phase == 'pick') else None),
            'history': self.history if self.phase == 'end' else None,
            'leftover': ({x: pl.hand for x, pl in self.players.items() if not pl.spectator and pl.hand} if self.phase == 'end' else None),   # 使わなかった手札
            'my_pick': me.pick if me else None,
            'reveal': self.reveal,
            'deadline': self.deadline,
            'next_at': self.next_at if self.phase == 'reveal' else None,
            'chat': [c for c in self.chat[-40:] if not (me and c.get('pid') in me.muted)][-30:],
            'muted': sorted(me.muted) if me else [],
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
        room.chat.append({'name': 'システム', 'text': f'{name}さんが退出しました', 'ts': time.time()})
        room.chat = room.chat[-60:]
    if room.phase == 'pick' and room.all_picked():
        return await finish_reveal(room)
    await broadcast(room)


# ---------- websocket handler
async def ws_handler(request):
    ws = web.WebSocketResponse(heartbeat=25)
    await ws.prepare(request)
    ctx = {'room': None, 'pid': None}

    async def error(msg, code=None):
        await send(ws, {'type': 'error', 'message': msg, 'code': code})   # code: クライアントが言語に合わせて表示

    async def handle(data):
        t = data.get('type')
        room, pid = ctx['room'], ctx['pid']

        if t == 'create':
            cleanup_rooms()
            if len(rooms) >= MAX_ROOMS:
                return await error('現在満室です。しばらくしてからお試しください', 'room_full_global')
            name = clean_name(data.get('name'))
            ok, why, why_code = check_name(name)
            if not ok:
                return await error(why, why_code)
            pid = uuid.uuid4().hex[:12]
            room = Room(new_code(), pid)
            rooms[room.code] = room
            p = Player(pid, name)
            p.ws, p.connected = ws, True
            room.players[pid] = p
            room.order.append(pid)
            room.title = unique_title(name)   # 既定の部屋名はホストの名前。友だちはこの名前で参加する
            ctx['room'], ctx['pid'] = room, pid
            log.info('room %s created by %s, rooms=%d', room.code, name, len(rooms))
            return await broadcast(room)

        if t == 'join':
            code = str(data.get('room') or '').strip().upper()[:4]
            r = rooms.get(code) if code else None
            if not r and data.get('room_name'):   # 部屋名で参加（招待リンクはコード）
                r = find_room_by_title(str(data.get('room_name'))[:40])
            if not r:
                return await error('その名前の部屋は見つかりません', 'room_not_found')
            want_pid = str(data.get('pid') or '')[:12]
            if want_pid and want_pid in r.players:
                # 再接続: 秘密トークンが一致した本人のみ（他人のIDでのなりすまし防止）
                p = r.players[want_pid]
                if p.is_bot or not secrets.compare_digest(str(data.get('token') or ''), p.token or ''):
                    return await error('再接続の認証に失敗しました', 'reauth_failed')
                if p.ws is not None and p.ws is not ws and not p.ws.closed:
                    await p.ws.close()
                p.ws, p.connected = ws, True
                pid = want_pid
                r.empty_since = None
                log.info('room %s reconnect %s', r.code, p.name)
            else:
                if len(r.players) >= MAX_PLAYERS:
                    return await error('満員です（最大8人）', 'room_full')
                name = clean_name(data.get('name'))
                ok, why, why_code = check_name(name)
                if not ok:
                    return await error(why, why_code)
                pid = uuid.uuid4().hex[:12]
                p = Player(pid, name)
                p.ws, p.connected = ws, True
                r.players[pid] = p
                r.order.append(pid)
                r.empty_since = None
                log.info('room %s join %s%s players=%d', r.code, name, ' (spectator)' if r.phase != 'lobby' else '', len(r.players))
                if r.phase != 'lobby':   # 途中参加はまず観戦。次のゲームから自動で参加、または「途中から参加」
                    p.spectator = True
                    r.chat.append({'name': 'システム', 'key': 'spectating', 'params': {'name': p.name}, 'text': f'{p.name}さんが観戦しました', 'ts': time.time()})
                else:
                    r.chat.append({'name': 'システム', 'key': 'joined', 'params': {'name': p.name}, 'text': f'{p.name}さんが入室しました', 'ts': time.time()})
                r.chat = r.chat[-60:]
            ctx['room'], ctx['pid'] = r, pid
            return await broadcast(r)

        if t == 'ping':
            return await send(ws, {'type': 'pong'})

        if room is None or pid not in room.players:
            return await error('先に部屋を作成または参加してください', 'join_first')
        is_host = (pid == room.host)

        if t == 'settings':
            if not (is_host and room.phase == 'lobby'):
                return
            s = data.get('settings') or {}
            if not isinstance(s, dict):
                return await error('入力値が不正です', 'bad_input')
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
                title = ''.join(ch for ch in str(s.get('title') or '') if ch.isprintable()).strip()[:20]
                if title and not check_name(title)[0]:
                    return await error('その部屋名は使えません（不適切な表現や連絡先を含みます）', 'bad_title')
                if title and find_room_by_title(title, exclude=room):
                    return await error('その部屋名はすでに使われています。別の名前にしてください', 'title_taken')
                host = room.players.get(room.host)
                room.title = title or unique_title(host.name if host else '部屋', exclude=room)
            if room.settings['hand_size'] < room.settings['rounds']:
                room.settings['hand_size'] = room.settings['rounds'] + 1
            return await broadcast(room)

        if t == 'add_bot':
            if not (is_host and room.phase == 'lobby'):
                return
            if len(room.players) >= MAX_PLAYERS:
                return await error('満員です', 'room_full')
            used = {p.name for p in room.players.values()}
            name = random.choice([x for x in BOT_NAMES if x not in used] or BOT_NAMES)
            bpid = 'bot_' + uuid.uuid4().hex[:6]
            bp = Player(bpid, name, is_bot=True)
            bp.name_en = BOT_NAMES_EN[BOT_NAMES.index(name)] if name in BOT_NAMES else name
            room.players[bpid] = bp
            room.order.append(bpid)
            return await broadcast(room)

        if t == 'kick':
            if not is_host:
                return
            target = str(data.get('pid') or '')
            if target in room.players and target != room.host:
                tp = room.players[target]
                room.remove_player(target)
                log.info('room %s kick %s by %s', room.code, tp.name, room.players[pid].name)
                if tp.ws is not None and not tp.ws.closed:
                    await send(tp.ws, {'type': 'left', 'message': 'ホストによって退出させられました', 'code': 'kicked'})
                    await tp.ws.close()
                await after_player_gone(room, tp.name)
            return

        if t == 'selecting':   # 選択中のカード（観戦者向けのライブ表示。プレイヤー同士には見えない）
            if room.phase != 'pick':
                return
            p = room.players[pid]
            card = data.get('card')
            p.selecting = card if (isinstance(card, str) and card in p.hand) else None
            if any(pl.spectator and pl.connected for pl in room.players.values()):
                await broadcast(room)
            return

        if t == 'mute':   # 相手の発言を自分の画面から非表示に（相手には知らされない）
            target = str(data.get('pid') or '')
            me = room.players[pid]
            if target in room.players and target != pid:
                if data.get('on', True):
                    me.muted.add(target)
                else:
                    me.muted.discard(target)
                await send(ws, room.state_for(pid))
            return

        if t == 'report':   # 通報: ログに残し、異なる2人から通報された人はその部屋でチャット禁止
            target = str(data.get('pid') or '')
            reason = ''.join(ch for ch in str(data.get('reason') or '') if ch.isprintable())[:40]
            if target in room.players and target != pid:
                tp = room.players[target]
                tp.reported_by.add(pid)
                log.warning('room %s REPORT %s -> %s reason=%s recent=%s', room.code, room.players[pid].name, tp.name, reason,
                            [c['text'] for c in room.chat if c.get('pid') == target][-5:])
                if len(tp.reported_by) >= REPORTS_TO_MUTE and not tp.chat_banned:
                    tp.chat_banned = True
                    room.chat.append({'name': 'システム', 'text': f'{tp.name}さんのチャットは通報により制限されました', 'ts': time.time()})
                    await broadcast(room)
                await send(ws, {'type': 'toast', 'message': '通報しました。運営が確認します', 'code': 'reported'})
            return

        if t == 'leave':
            p = room.players[pid]
            room.remove_player(pid)
            ctx['room'], ctx['pid'] = None, None
            log.info('room %s leave %s', room.code, p.name)
            await send(ws, {'type': 'left', 'message': '部屋から退出しました', 'code': 'left'})
            return await after_player_gone(room, p.name)

        if t == 'start':
            if not (is_host and room.phase in ('lobby', 'end')):
                return
            if len(room.players) < 2:
                return await error('2人以上（ボット可）で開始できます', 'need_two')
            room.start()
            return await enter_pick_phase(room)

        if t == 'pick':
            if room.phase != 'pick':
                return
            p = room.players[pid]
            if p.spectator:
                return
            card = data.get('card')
            if isinstance(card, str) and card in p.hand:
                p.pick = card
                await broadcast(room)
                await maybe_reveal(room)
            return

        if t == 'chat':
            text = ''.join(ch for ch in str(data.get('text') or '') if ch.isprintable()).strip()[:80]
            p = room.players[pid]
            if p.chat_banned:
                return await error('通報が複数あったため、この部屋ではチャットできません', 'chat_banned')
            ok, why, why_code = check_chat(text)   # NGワード・URL・連絡先・連打
            if not ok:
                log.info('room %s chat blocked from %s: %r', room.code, p.name, text)
                return await error(why, why_code)
            now = time.time()
            if text and now - p.last_chat >= CHAT_INTERVAL:
                p.last_chat = now
                room.chat.append({'name': p.name, 'pid': pid, 'text': text, 'ts': now})
                room.chat = room.chat[-60:]
                return await broadcast(room)
            return

        if t == 'to_lobby':
            if not is_host:
                return
            was_playing = room.phase in ('pick', 'reveal')
            room.reset_to_lobby()
            if was_playing:
                room.chat.append({'name': 'システム', 'key': 'host_lobby', 'params': {}, 'text': 'ホストがゲームを中断してロビーに戻りました', 'ts': time.time()})
                log.info('room %s host returned to lobby mid-game', room.code)
            return await broadcast(room)

    async for msg in ws:
        if msg.type != WSMsgType.TEXT:
            continue
        if len(msg.data) > 4000:
            await error('メッセージが大きすぎます', 'msg_big')
            continue
        try:
            data = json.loads(msg.data)
            if not isinstance(data, dict):
                raise ValueError
        except ValueError:
            await error('入力値が不正です', 'bad_input')
            continue
        try:
            await handle(data)
        except Exception:   # 1人の不正入力で接続や部屋を落とさない
            log.exception('handle failed: type=%s room=%s', data.get('type'), ctx['room'].code if ctx['room'] else None)
            await error('処理に失敗しました', 'failed')

    # ---------- 切断処理
    room, pid = ctx['room'], ctx['pid']
    if room and pid in room.players and room.players[pid].ws is ws:
        p = room.players[pid]
        p.connected, p.ws = False, None
        log.info('room %s disconnect %s (phase=%s)', room.code, p.name, room.phase)
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
            out.append({'room': r.code, 'title': r.display_title(), 'title_raw': r.title, 'phase': r.phase, 'round': r.round,
                        'host': host.name if host else '', 'players': len(r.players),
                        'categories': r.settings['categories'], 'rounds': r.settings['rounds'], 'age': int(now - r.created)})
    out.sort(key=lambda x: x['age'])
    return web.json_response({'rooms': out[:20]})


async def api_room(request):
    """招待リンク用: 部屋の概要（存在するか、名前、人数、進行状況）。"""
    code = request.match_info['code'].upper()[:4]
    r = rooms.get(code)
    if not r or not r.has_humans():
        return web.json_response({'found': False}, status=404)
    host = r.players.get(r.host)
    return web.json_response({'found': True, 'room': r.code, 'title': r.display_title(), 'host': host.name if host else '',
                              'players': len(r.players), 'max': MAX_PLAYERS, 'phase': r.phase, 'round': r.round,
                              'names': [r.players[x].name for x in r.order]})


async def index(request):
    raise web.HTTPFound('/static/index.html')


async def manifest(request):
    return web.FileResponse(os.path.join(HERE, 'static', 'manifest.json'), headers={'Content-Type': 'application/manifest+json'})


async def service_worker(request):
    return web.FileResponse(os.path.join(HERE, 'static', 'sw.js'), headers={'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache'})


async def healthz(request):
    return web.json_response({'ok': True, 'rooms': len(rooms)})


# 利用ログ（ざっくり）: 対戦画面・図鑑を「誰が」「何分」見たかを運用ログに残す。
# クライアントが開いた時・5分ごと・離れた時に POST してくる。保存はせずログ出力のみ
VISIT_MODES = {'game': '対戦', 'zukan': '図鑑', 'quiz': 'クイズ'}
async def api_visit(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'ok': False}, status=400)
    if not isinstance(data, dict):
        return web.json_response({'ok': False}, status=400)
    mode = VISIT_MODES.get(str(data.get('mode') or ''), None)
    event = str(data.get('event') or '')
    if not mode or event not in ('start', 'ping', 'leave'):
        return web.json_response({'ok': False}, status=400)
    name = ''.join(ch for ch in str(data.get('name') or '') if ch.isprintable()).strip()[:20] or '(名前なし)'
    vid = ''.join(ch for ch in str(data.get('id') or '') if ch.isalnum())[:12]
    sec = to_int(data.get('sec'), 0, 24 * 3600, 0)
    label = {'start': '開始', 'ping': '滞在中', 'leave': '離脱'}[event]
    log.info('visit %s %s name=%s 滞在=%d分%02d秒 id=%s', mode, label, name, sec // 60, sec % 60, vid)
    # 管理者ページ用にメモリにも残す（サーバー再起動で消える。長期の記録は Render のログ）
    v = VISITS.get(vid)
    if v is None:
        if len(VISITS) >= 3000:
            del VISITS[next(iter(VISITS))]
        v = VISITS[vid] = {'mode': mode, 'name': name, 'start': time.time(), 'sec': 0, 'state': '開始'}
    if name != '(名前なし)':
        v['name'] = name
    v['sec'] = max(v['sec'], sec)
    v['state'] = '離脱' if event == 'leave' else '滞在中'
    return web.json_response({'ok': True})


VISITS = {}   # 訪問id -> {mode, name, start, sec, state}
ADMIN_KEY = os.environ.get('ADMIN_KEY', '')


ADMIN_FAILS = {}          # IP -> [失敗回数, 最終失敗時刻]。5回失敗で15分ロック
ADMIN_LOCK_SEC, ADMIN_MAX_FAILS = 15 * 60, 5

def client_ip(request):
    xff = request.headers.get('X-Forwarded-For', '')
    return (xff.split(',')[0].strip() if xff else (request.remote or '?'))

def admin_auth(request):
    """管理者ページの認証。ブラウザの ID/パスワード入力（Basic 認証、ユーザー名 admin、パスワード ADMIN_KEY）。
    合言葉を URL に載せない（履歴・ログ・リファラに残らない）。失敗が続く IP はロック。"""
    ip = client_ip(request); now = time.time()
    f = ADMIN_FAILS.get(ip)
    if f and f[0] >= ADMIN_MAX_FAILS and now - f[1] < ADMIN_LOCK_SEC:
        log.warning('admin locked ip=%s', ip)
        return web.Response(status=429, text='しばらく待ってから再試行してください')
    ok = False
    auth = request.headers.get('Authorization', '')
    if ADMIN_KEY and auth.startswith('Basic '):
        try:
            import base64
            user, _, pw = base64.b64decode(auth[6:]).decode('utf-8', 'replace').partition(':')
            ok = hmac.compare_digest(user, 'admin') and hmac.compare_digest(pw, ADMIN_KEY)
        except Exception:
            ok = False
    if not ok:
        if auth:   # 入力して間違えた時だけ失敗回数を数える（最初のダイアログ表示は数えない）
            ADMIN_FAILS[ip] = [(f[0] + 1 if f and now - f[1] < ADMIN_LOCK_SEC else 1), now]
            log.warning('admin auth failed ip=%s fails=%d', ip, ADMIN_FAILS[ip][0])
        return web.Response(status=401, text='認証が必要です', headers={'WWW-Authenticate': 'Basic realm="geoking admin", charset="UTF-8"'})
    ADMIN_FAILS.pop(ip, None)
    log.info('admin access ip=%s path=%s', ip, request.path)
    return None


async def admin_visits(request):
    """管理者用の利用一覧。環境変数 ADMIN_KEY を設定し、/admin/visits を開いて admin / ADMIN_KEY を入力。"""
    denied = admin_auth(request)
    if denied:
        return denied
    rows = sorted(VISITS.values(), key=lambda v: v['start'], reverse=True)
    jst = timezone(timedelta(hours=9))
    total_game = sum(v['sec'] for v in rows if v['mode'] == '対戦'); total_zukan = sum(v['sec'] for v in rows if v['mode'] == '図鑑')
    names = len({v['name'] for v in rows})
    def fmt(sec): return f"{sec // 60}分{sec % 60:02d}秒"
    body = ''.join(
        f"<tr><td>{datetime.fromtimestamp(v['start'], jst).strftime('%m/%d %H:%M')}</td><td>{v['mode']}</td><td>{html.escape(v['name'])}</td><td>{fmt(v['sec'])}</td><td>{v['state']}</td></tr>"
        for v in rows)
    page = f"""<!DOCTYPE html><html lang=ja><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=robots content=noindex><title>利用ログ - 地理王</title>
<style>body{{font-family:system-ui,sans-serif;margin:16px;background:#f7f1df;color:#1c2b22}}table{{border-collapse:collapse;width:100%;font-size:14px}}td,th{{border-bottom:1px solid #ccc;padding:6px 8px;text-align:left;white-space:nowrap}}th{{background:#1f6f4a;color:#fff}}p{{font-size:14px}}</style></head>
<body><h1>利用ログ（直近・サーバー起動後）</h1>
<p>訪問 {len(rows)} 件／名前 {names} 種類／対戦 合計 {fmt(total_game)}／図鑑 合計 {fmt(total_zukan)}。サーバーが再起動（無料プランのスリープ）すると消えます。長期の記録は Render のログ（visit で検索）を参照。</p>
<table><tr><th>開始（日本時間）</th><th>画面</th><th>名前</th><th>滞在</th><th>状態</th></tr>{body}</table></body></html>"""
    return web.Response(text=page, content_type='text/html', headers={'Cache-Control': 'no-store'})


@web.middleware
async def security_headers(request, handler):
    if request.method == 'OPTIONS' and request.path.startswith('/api/'):
        resp = web.Response(status=204)
    else:
        resp = await handler(request)
    if request.path.startswith('/api/'):
        resp.headers['Access-Control-Allow-Origin'] = '*'
        resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    # 画面の部品（HTML/CSS/JS/JSON/SVG）は毎回サーバーに確認させ、更新をすぐ反映（ETag があるので転送は軽い）
    if request.path.startswith('/static/') and request.path.rsplit('.', 1)[-1] in ('html', 'css', 'js', 'json', 'svg'):
        resp.headers.setdefault('Cache-Control', 'no-cache')
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
    app.router.add_get('/manifest.json', manifest)
    app.router.add_get('/sw.js', service_worker)
    app.router.add_get('/api/meta', api_meta)
    app.router.add_post('/api/visit', api_visit)
    app.router.add_get('/admin/visits', admin_visits)
    app.router.add_get('/api/rooms', api_rooms)
    app.router.add_get('/api/room/{code}', api_room)
    app.router.add_get('/ws', ws_handler)
    app.router.add_static('/static/', os.path.join(HERE, 'static'))
    return app


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8080'))
    log.info('GeoKing server: http://localhost:%d', port)
    web.run_app(make_app(), port=port, print=None, access_log=None)   # HTTPアクセスログは出さず、ゲームの出来事だけ記録
