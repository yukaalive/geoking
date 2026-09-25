# -*- coding: utf-8 -*-
"""GeoKing（地理王） オンライン対戦サーバー。aiohttp + WebSocket。
    python3 server.py  →  http://localhost:8080
"""
import asyncio, collections, json, logging, os, random, secrets, string, time, uuid
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
EMPTY_GRACE = 600      # 秒。人間が全員切断しても、この間は部屋を残す（LINE など別のアプリに行って戻る・リロード・再接続用。Render 無料プランが止まる15分より短く）
LEFT_GRACE = 90        # 秒。最後の人が自分で「退出」して空になった部屋は、これまでどおり短く残す（長く残すと部屋名がふさがり、同じ名前で作ると「名前2」になる）
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


# ---------- スプレッドシートへの記録
# サーバーのログ（Render の Logs は無料プランで7日）や管理者ページ（メモリ）は更新で消えるので、部屋や画面の出来事を
# 30秒ごとにまとめて、運営者の Google スプレッドシート（Apps Script のウェブアプリ）へ送る。送れなかった分は次の回に送り直す。
# 送るのは裏でだけで、ゲームの動きは待たせない。スプレッドシート側のプログラムと設定の手順は docs/sheet-log/（90日より古い行はそちらで毎日消す）
# 環境変数 SHEET_LOG_URL（ウェブアプリのアドレス）と SHEET_LOG_KEY（合言葉。Apps Script のスクリプト プロパティ LOG_KEY と同じ値）がそろったときだけ動く
SHEET_LOG_URL = os.environ.get('SHEET_LOG_URL', '').strip()
SHEET_LOG_KEY = os.environ.get('SHEET_LOG_KEY', '').strip()
SHEET_LOG_EVERY = float(os.environ.get('SHEET_LOG_EVERY', '30'))   # 秒。まとめて送る間隔
SHEET_LOG_BATCH = 500             # 1回に送る行の上限
SHEET_ROWS = collections.deque(maxlen=5000)   # 送る前の行。送れないまま増えたら古い方から捨てる（メモリを使いすぎない）
SHEET_LOCK = asyncio.Lock()
SHEET_PER_MIN = {'visit': 120, 'room': 600}   # 1分に残す行の上限（画面を開いた記録は誰でも送れるので少なめ）。超えた分は残さない
sheet_minute = {'at': 0, 'visit': 0, 'room': 0}
SHEET_GIVE_UP = 20     # 返事は来るのに書けない（合言葉違い・シートがいっぱい等）が続いたら、その回の分をあきらめて先へ進む（いつまでも止まらないように）
sheet_pending = None   # 送りかけの1回分 {'id', 'rows'}。書けたか分からないとき（返事が来ない等）は同じ id で送り直し、スプレッドシート側で二重に書かない
sheet_fail_count = 0


def sheet_log(event, room=None, name='', detail='', kind='room'):
    """スプレッドシートに1行残す（ここではためるだけ。送るのは sheet_log_ctx の見張り）。列: 日時・出来事・部屋コード・部屋名・ニックネーム・人数・くわしく"""
    if not (SHEET_LOG_URL and SHEET_LOG_KEY):
        return
    minute = int(time.time() // 60)
    if sheet_minute['at'] != minute:
        over = {k: sheet_minute[k] - SHEET_PER_MIN[k] for k in SHEET_PER_MIN if sheet_minute[k] > SHEET_PER_MIN[k]}
        if over:
            log.warning('sheet log: too many rows in a minute, dropped %s', over)
        sheet_minute.update({'at': minute, 'visit': 0, 'room': 0})
    sheet_minute[kind] += 1
    if sheet_minute[kind] > SHEET_PER_MIN[kind]:
        return
    SHEET_ROWS.append({'ts': round(time.time(), 3), 'event': event, 'room': room.code if room else '',
                       'title': room.display_title() if room else '', 'name': name or '',
                       'count': len(room.players) if room else '', 'detail': str(detail or '')[:300]})


async def sheet_flush(session, timeout=15):
    """ためた行を送る。送れたら True。送れなかった分は次の回に同じ中身・同じ id で送り直す"""
    global sheet_fail_count, sheet_pending
    from aiohttp import ClientTimeout
    async with SHEET_LOCK:
        while sheet_pending or SHEET_ROWS:
            if sheet_pending is None:
                sheet_pending = {'id': secrets.token_hex(8), 'rows': [SHEET_ROWS.popleft() for _ in range(min(SHEET_LOG_BATCH, len(SHEET_ROWS)))]}
            why = ''
            answered = False
            try:   # Apps Script は書き込んだあと別のアドレスへ転送して返事を返すので、転送先までたどる（aiohttp が自動でたどる）
                async with session.post(SHEET_LOG_URL, json={'key': SHEET_LOG_KEY, **sheet_pending}, timeout=ClientTimeout(total=timeout)) as r:
                    answered = True
                    body = await r.text()
                    try:
                        ok = r.status == 200 and json.loads(body).get('ok') is True
                    except ValueError:
                        ok = False
                    why = f'status={r.status} body={body[:120]!r}'
            except Exception as e:
                ok, why = False, repr(e)
            if not ok:
                sheet_fail_count += 1
                if sheet_fail_count in (1, 3) or sheet_fail_count % 20 == 0:   # 同じ失敗でログを埋めない
                    log.warning('sheet log: send failed %d times (%s), %d rows waiting', sheet_fail_count, why, len(SHEET_ROWS) + len(sheet_pending['rows']))
                if answered and sheet_fail_count >= SHEET_GIVE_UP:   # 通信はできているのに書けない: この回の分をあきらめる（通信できないときは書けたかもしれないので送り直し続ける）
                    log.warning('sheet log: gave up %d rows after %d failures (%s)', len(sheet_pending['rows']), sheet_fail_count, why)
                    sheet_pending, sheet_fail_count = None, 0
                return False
            sheet_pending = None
            if sheet_fail_count:
                log.info('sheet log: sent again after %d failures', sheet_fail_count)
                sheet_fail_count = 0
    return True


async def sheet_log_ctx(app):
    if not (SHEET_LOG_URL and SHEET_LOG_KEY):
        log.info('sheet log: off (SHEET_LOG_URL / SHEET_LOG_KEY is not set)')
        yield
        return
    from aiohttp import ClientSession
    session = app['sheet_session'] = ClientSession()
    log.info('sheet log: on (every %.0fs)', SHEET_LOG_EVERY)

    async def _run():
        while True:
            await asyncio.sleep(SHEET_LOG_EVERY)
            try:
                await sheet_flush(session)
            except Exception:   # 見張りが止まらないように
                log.exception('sheet log: flush error')
    task = asyncio.create_task(_run())
    yield
    task.cancel()
    try:
        await sheet_flush(session, timeout=5)   # 止める前に残りを送る
    except Exception:
        pass
    await session.close()


async def sheet_log_on_shutdown(app):
    """止める合図（SIGTERM）のとき: Render は30秒で強制終了するので、接続の後片付けを待たずに先に送る"""
    session = app.get('sheet_session')
    if session is not None:
        try:
            await asyncio.wait_for(sheet_flush(session, timeout=5), 8)
        except Exception:
            pass


def cleanup_rooms():
    now = time.time()
    for code, r in list(rooms.items()):
        if now - r.created > ROOM_TTL or (r.empty_since and now - r.empty_since > EMPTY_GRACE):
            for task in (r.timer_task, r.reveal_task):
                if task:
                    task.cancel()
            rooms.pop(code, None)
            log.info('room %s removed (%s), rooms=%d', code, 'ttl' if now - r.created > ROOM_TTL else 'empty', len(rooms))
            sheet_log('部屋削除', r, detail='6時間たった' if now - r.created > ROOM_TTL else '誰もいなくなった')


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
        host = self.players.get(self.host)
        sheet_log('ゲーム開始', self, host.name if host else '',
                  '、'.join(self.players[x].name + ('（ボット）' if self.players[x].is_bot else '') for x in self.order) + f'／{s["rounds"]}ラウンド')
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
            ranked = sorted((x for x in self.order if not self.players[x].spectator), key=lambda x: -self.players[x].score)   # 途中から観戦で入った人は遊んでいないので入れない
            top = self.players[ranked[0]].score if ranked else 0
            nm = lambda x: self.players[x].name + ('（ボット）' if self.players[x].is_bot else '')
            sheet_log('ゲーム終了', self, '・'.join(nm(x) for x in ranked if self.players[x].score == top),
                      '、'.join(f'{nm(x)} {self.players[x].score}点' for x in ranked))
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
            self.host = humans[0] if humans else None   # ボットには渡さない（次に入った人がホストになる）

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
            if migrating or moved or getattr(room, 'dead', False):   # 引っ越し中・後、置き換えた部屋は進めない（新しいサーバー・新しい部屋が続きを出す）
                return
            if room.phase == 'pick' and p.pick is None:
                p.pick = random.choice(p.hand)
                if not room.all_picked():
                    await broadcast(room)   # ✓ 表示を更新
    await maybe_reveal(room)


async def finish_reveal(room):
    """結果を公開し、REVEAL_SECONDS 後に自動で次のラウンド（または結果発表）へ進む。"""
    if migrating or moved or getattr(room, 'dead', False):   # 引っ越し中・後、置き換えた部屋は結果を出さない（送った中身と食い違わないように）
        return
    room.do_reveal()
    await broadcast(room)
    schedule_advance(room, REVEAL_SECONDS)


def schedule_advance(room, delay):
    """結果表示のあと delay 秒で次のラウンド（または結果発表）へ進む。"""
    if room.reveal_task:
        room.reveal_task.cancel()

    async def _advance():
        await asyncio.sleep(max(0, delay))
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
    rnd = room.round

    async def _run():
        await asyncio.sleep(max(0, room.deadline - time.time()))
        if room.phase == 'pick' and room.round == rnd:   # 前のラウンドの時計が、次のラウンドの始まりに鳴らないように（鳴ると次の結果がすぐ出てしまう）
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


def add_bot(room):
    used = {p.name for p in room.players.values()}
    name = random.choice([x for x in BOT_NAMES if x not in used] or BOT_NAMES)
    bpid = 'bot_' + uuid.uuid4().hex[:6]
    bp = Player(bpid, name, is_bot=True)
    bp.name_en = BOT_NAMES_EN[BOT_NAMES.index(name)] if name in BOT_NAMES else name
    room.players[bpid] = bp
    room.order.append(bpid)
    return bp


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


# ---------- 更新時の部屋の引っ越し
# Render は更新のとき新しいサーバーを立て、/healthz に応えたら接続先を切り替える。古いサーバーは切り替えの60秒後に止まり、
# 部屋はメモリにしかないので、そのままだと対戦中の部屋が消える。そこで古いサーバーが、公開アドレスの /healthz が
# 自分より後に起動したサーバー（新しいサーバー）を指したのに気づいたら、全部の部屋の中身を新しいサーバーへ送り、送り終えたら接続を切る。
# 画面は切れると 0.3 秒ほどで自動でつなぎ直す（同じ pid・token で）ので、新しいサーバーの同じ部屋から続きを遊べる。
BOOT_ID = secrets.token_hex(8)   # このサーバー（起動ごと）の目印。/healthz で返し、切り替わったかの判定に使う
STARTED = time.time()            # 起動した時刻。自分より後に起動したサーバーにだけ送る（切り替えの途中で古い方へ送り返さないように）
MIGRATE_KEY = os.environ.get('MIGRATE_KEY', '')   # 引っ越し用の合言葉（render.yaml で Render が自動で作る。両方のサーバーで同じ値）
PUBLIC_URL = (os.environ.get('MIGRATE_URL') or os.environ.get('RENDER_EXTERNAL_URL') or '').rstrip('/')   # 公開アドレス（Render が自動で入れる）
MIGRATE_POLL = float(os.environ.get('MIGRATE_POLL', '2'))   # 秒。部屋がある間だけ、この間隔で確かめる（部屋がなければ確かめないので、無料プランのスリープの邪魔をしない）
MIGRATE_EXTRA_PICK = 3     # 秒。引っ越しで止まった分、選ぶ時間の残りに足す
MIGRATE_EXTRA_REVEAL = 1   # 秒。結果表示の残りに足す
MIGRATE_GRACE = float(os.environ.get('MIGRATE_GRACE', '20'))   # 秒。引っ越してきた人がつなぎ直すまで「いる」ものとして待つ（その間にラウンドが勝手に決まらないように）
MIGRATE_WAIT_JOIN = 8      # 秒。起動直後の新しいサーバーに、部屋が届く前につなぎ直してきた人を待たせる長さ（すぐ「部屋がない」と返してホームに戻さない）
MIGRATE_MAX = 8 * 1024 * 1024   # 引っ越しで1回に受け取る中身の上限（バイト）
MIGRATE_BATCH = int(os.environ.get('MIGRATE_BATCH', '20'))   # 1回に送る部屋の数（大きな部屋でも1部屋 80KB ほどなので、上限に十分収まる）
migrating = False   # 部屋の中身を送っている最中（この間に届いた操作は、送り終わるか失敗するまで待たせる）
moved = False       # 部屋を新しいサーバーへ送り終えた（このサーバーはもう部屋を持たない）
LIVE_SOCKETS = set()   # つながっている全部の WebSocket（送り終えたら、部屋に入る前の接続も含めて全部切る）


def player_to_dict(p):
    return {'pid': p.pid, 'name': p.name, 'name_en': p.name_en, 'is_bot': p.is_bot, 'hand': list(p.hand), 'score': p.score,
            'won': list(p.won), 'pick': p.pick, 'selecting': p.selecting, 'connected': p.connected, 'token': p.token,
            'spectator': p.spectator, 'muted': sorted(p.muted), 'reported_by': sorted(p.reported_by), 'chat_banned': p.chat_banned}


def room_to_dict(r, now):
    """部屋の中身を送れる形に。時刻は「あと何秒」で送る（サーバーどうしの時計のずれに左右されない）。"""
    return {'code': r.code, 'host': r.host, 'order': list(r.order), 'settings': r.settings, 'phase': r.phase, 'round': r.round,
            'prompts': r.prompts, 'reveal': r.reveal, 'chat': r.chat, 'title': r.title, 'deck': list(r.deck), 'history': r.history,
            'deadline_in': (r.deadline - now) if (r.phase == 'pick' and r.deadline) else None,
            'next_in': (r.next_at - now) if (r.phase == 'reveal' and r.next_at) else None,
            'age': now - r.created, 'empty_for': (now - r.empty_since) if r.empty_since else None,
            'players': [player_to_dict(p) for p in r.players.values()]}


def room_from_dict(d, now, source=None):
    """送られてきた部屋を組み立てる。今のサーバーのお題・国データで扱えない中身なら ValueError（その部屋は受け取らない）。"""
    code = str(d['code'])[:4]
    if code in rooms and getattr(rooms[code], 'migrated_from', None) != source:
        raise ValueError('code already used')   # 新しいサーバーで先に同じコードの部屋ができていた（まれ）
    prompts = [PROMPT_BY_ID.get(p.get('id'), p) for p in d['prompts']]
    if any(p.get('key') not in WORLD_VALUES for p in prompts):
        raise ValueError('unknown prompt')
    r = Room(code, d['host'])
    r.migrated_from = source   # 送ってきた古いサーバー（同じサーバーが送り直してきたら置き換える）
    r.settings = {**DEFAULT_SETTINGS, **d['settings']}
    r.phase, r.round, r.prompts = d['phase'], int(d['round']), prompts
    if r.phase not in ('lobby', 'pick', 'reveal', 'end'):
        raise ValueError('bad phase')
    r.reveal, r.chat, r.history = d['reveal'], list(d['chat'])[-60:], list(d['history'])
    r.deck = [c for c in d['deck'] if c in COUNTRY_BY_ID]
    old = rooms.get(code)
    r.title = d['title'] if not find_room_by_title(d['title'], exclude=old) else unique_title(d['title'], exclude=old)   # 同じ名前の部屋が新しいサーバーで先にできていたら番号を付ける
    for pd in d['players']:
        p = Player(str(pd['pid']), pd['name'], is_bot=bool(pd['is_bot']))
        p.name_en, p.hand, p.score, p.won = pd['name_en'], list(pd['hand']), int(pd['score']), list(pd['won'])
        p.pick, p.selecting, p.spectator, p.chat_banned = pd['pick'], pd['selecting'], bool(pd['spectator']), bool(pd['chat_banned'])
        p.token = pd['token']
        p.muted, p.reported_by = set(pd['muted']), set(pd['reported_by'])
        p.connected = bool(pd['connected'])   # つながっていた人は、つなぎ直すまで（MIGRATE_GRACE 秒まで）いるものとして扱う
        if any(c not in COUNTRY_BY_ID for c in p.hand + ([p.pick] if p.pick else [])):
            raise ValueError('unknown card')
        r.players[p.pid] = p
    r.order = [x for x in d['order'] if x in r.players]
    if r.phase == 'pick' and d['deadline_in'] is not None:
        r.deadline = now + max(0, d['deadline_in']) + MIGRATE_EXTRA_PICK
    if r.phase == 'reveal':
        r.next_at = now + max(0, d['next_in'] or 0) + MIGRATE_EXTRA_REVEAL
    r.created = now - float(d['age'])
    r.empty_since = (now - float(d['empty_for'])) if d['empty_for'] is not None else None
    return r


def resume_room(room):
    """引っ越し後（または送れなかったとき）に、止めていた時計を動かし直す。"""
    if room.phase == 'pick':
        asyncio.create_task(start_timer(room))
        if any(p.is_bot and p.pick is None and p.hand for p in room.players.values()):   # まだ出していないボットだけ動かす（全員出していれば古いサーバーと同じく、人の操作か時間切れまで待つ。
            asyncio.create_task(bots_play(room))                                          #  ここで結果に進めると、いったん切れていた人のいない間にラウンドが決まってしまう）
    elif room.phase == 'reveal' and room.next_at:
        schedule_advance(room, room.next_at - time.time())


def room_worth_moving(r):
    """送る価値のある部屋: 人（ボット以外）がいる部屋。いまは全員切れていても、つなぎ直しの猶予中なら送る（アプリを裏に回した人など）。"""
    return r.empty_since is not None or any(not p.is_bot for p in r.players.values())   # ロビーでは切れた人はすぐ外れるので、猶予中（empty_since あり）の部屋も送る（ひとりで LINE に行ったホストの部屋）


async def migrated_grace(room):
    """引っ越してきた部屋で、MIGRATE_GRACE 秒たってもつなぎ直さない人は、切断したものとして扱う（ふつうの切断と同じ後始末）。"""
    await asyncio.sleep(MIGRATE_GRACE)
    if rooms.get(room.code) is not room:
        return
    gone = [p for p in room.players.values() if not p.is_bot and p.connected and p.ws is None]
    for p in gone:
        p.connected = False
        if room.phase == 'lobby':
            room.remove_player(p.pid)
    if gone:
        log.info('room %s migrated: %d player(s) did not reconnect', room.code, len(gone))
        await after_player_gone(room, None)


async def wait_migrated_room(code):
    """起動して間もない新しいサーバーで、まだ届いていない部屋につなぎ直してきた人を少し待たせる（古いサーバーが送るまでの数秒）。"""
    if not MIGRATE_KEY or time.time() - STARTED > 120:
        return rooms.get(code)
    end = time.time() + MIGRATE_WAIT_JOIN
    while code not in rooms and time.time() < end:
        await asyncio.sleep(0.2)
    return rooms.get(code)


def retire_room(prev, keep):
    """送り直しで置き換えた前の部屋を止める（前の部屋の時計やボットが、古い中身を画面に送らないように）。"""
    prev.dead = True
    for task in (prev.timer_task, prev.reveal_task):
        if task:
            task.cancel()
    for op in prev.players.values():
        np = keep.players.get(op.pid)
        if op.ws is not None:
            if np is not None:   # すでにこちらへつなぎ直した人の接続は、新しい方の部屋に引き継ぐ
                np.ws, np.connected = op.ws, True
            else:                # 新しい中身にいない人（送り直しの間に入ってきた人）は切って、つなぎ直してもらう
                asyncio.create_task(op.ws.close())
        op.ws, op.connected = None, False


def key_ok(got):
    try:
        return bool(MIGRATE_KEY) and hmac.compare_digest(got.encode('utf-8', 'surrogateescape'), MIGRATE_KEY.encode('utf-8'))
    except Exception:
        return False


async def internal_migrate(request):
    """新しいサーバー側: 古いサーバーから部屋を受け取る。合言葉が合うときだけ。"""
    if not key_ok(request.headers.get('X-Migrate-Key', '')):
        raise web.HTTPNotFound()
    if moved or migrating:   # 自分も部屋を送っている・送り終えたサーバーは受け取らない（受け取っても行き場がない）
        return web.json_response({'ok': False, 'error': 'moving'}, status=409)
    body = b''
    async for chunk in request.content.iter_chunked(64 * 1024):   # アプリ全体の上限（64KB）より大きい中身を受け取る
        body += chunk
        if len(body) > MIGRATE_MAX:
            return web.json_response({'ok': False, 'error': 'too_big'}, status=413)
    try:
        data = json.loads(body)
        if data.get('v') != 1 or data.get('from') == BOOT_ID:
            raise ValueError
    except Exception:
        return web.json_response({'ok': False, 'error': 'bad'}, status=400)
    now, got, skipped = time.time(), [], []
    for d in data.get('rooms') or []:
        try:
            if len(rooms) >= MAX_ROOMS and not (isinstance(d, dict) and str(d.get('code'))[:4] in rooms):
                raise ValueError('full')
            r = room_from_dict(d, now, source=data.get('from'))
        except Exception as e:
            skipped.append(str(d.get('code') if isinstance(d, dict) else '?'))
            log.warning('migrate in: skip room %s (%s)', skipped[-1], e)
            continue
        prev = rooms.get(r.code)
        if prev is not None:   # 同じ古いサーバーからの送り直し（前の返事が届かなかった）: 前に受け取った方を止めて置き換える
            retire_room(prev, r)
            r.replaced = True
        rooms[r.code] = r
        got.append(r)
    for r in got:
        resume_room(r)
        asyncio.create_task(migrated_grace(r))
        if getattr(r, 'replaced', False):   # 置き換える前にこちらへつなぎ直していた人に、新しい中身を送る
            asyncio.create_task(broadcast(r))
    log.info('migrate in: %d room(s) from %s, skipped=%s, rooms=%d', len(got), data.get('from'), skipped, len(rooms))
    return web.json_response({'ok': True, 'rooms': len(got), 'skipped': skipped})


async def migrate_out(session, timeout=6):
    """古いサーバー側: 全部の部屋を新しいサーバーへ送る。送れたら接続を切り、画面に新しいサーバーへつなぎ直させる。"""
    global migrating, moved
    from aiohttp import ClientTimeout
    migrating = True
    for r in rooms.values():   # 送った後に進まないよう、時計を止める
        for task in (r.timer_task, r.reveal_task):
            if task:
                task.cancel()
    now = time.time()
    res = {'ok': True, 'rooms': 0, 'skipped': []}
    try:
        items = [room_to_dict(r, now) for r in rooms.values()]
        for i in range(0, len(items), MIGRATE_BATCH):   # 部屋が多くても受け取りの上限を超えないよう、何部屋かずつ送る（送り直しは受け取る側で置き換わる）
            body = json.dumps({'v': 1, 'from': BOOT_ID, 'rooms': items[i:i + MIGRATE_BATCH]}, ensure_ascii=False).encode('utf-8')
            async with session.post(PUBLIC_URL + '/internal/migrate', data=body, timeout=ClientTimeout(total=timeout),
                                    headers={'X-Migrate-Key': MIGRATE_KEY, 'Content-Type': 'application/json'}) as resp:
                part = await resp.json(content_type=None) if resp.status == 200 else {'ok': False, 'status': resp.status}
            if not part.get('ok'):
                res = part
                break
            res['rooms'] += part.get('rooms', 0); res['skipped'] += part.get('skipped', [])
    except Exception as e:   # どこで失敗しても、止めた時計を戻してこのサーバーで続ける（固まらないように）
        res = {'ok': False, 'error': repr(e)}
    if not res.get('ok'):
        log.warning('migrate out failed: %s (keep rooms here and retry)', res)
        frozen = time.time() - now   # 止めていた間の分、残り時間を戻す
        for r in rooms.values():
            if r.deadline:
                r.deadline += frozen
            if r.next_at:
                r.next_at += frozen
        migrating = False   # 待たせていた操作は、このあとそのまま続きを処理する
        for r in rooms.values():
            resume_room(r)
        return False
    moved = True
    log.info('migrate out: %d room(s) moved (%s skipped by the new server)', res.get('rooms'), res.get('skipped'))
    sockets = [ws for ws in LIVE_SOCKETS if not ws.closed]
    rooms.clear()
    # 画面は自動でつなぎ直し、新しいサーバーの同じ部屋に入る（相手の返事は長く待たない）
    await asyncio.gather(*(asyncio.wait_for(ws.close(), 2) for ws in sockets), return_exceptions=True)
    return True


fail_count = 0
async def switched_to_other(session, timeout=5):
    """公開アドレスの /healthz が、自分より後に起動したサーバーを指していたら True（Render が新しいサーバーに切り替えた）。"""
    global fail_count
    from aiohttp import ClientTimeout
    try:
        async with session.get(PUBLIC_URL + '/healthz', params={'from': BOOT_ID}, headers={'Cache-Control': 'no-cache'},
                               timeout=ClientTimeout(total=timeout)) as resp:
            h = (await resp.json(content_type=None)) if resp.status == 200 else {'status': resp.status}
    except Exception as e:
        h = {'error': type(e).__name__}
    if not h.get('boot'):
        fail_count += 1
        if fail_count in (1, 10) or fail_count % 100 == 0:   # 確かめられないときは、ときどき記録に残す（なぜ引っ越せなかったかを後で追えるように）
            log.warning('migrate: cannot check %s/healthz (%s, %d times)', PUBLIC_URL, h, fail_count)
        return False
    fail_count = 0
    return h['boot'] != BOOT_ID and float(h.get('started') or 0) > STARTED and not h.get('moved')


async def migrate_watch(app):
    """古いサーバー側の見張り: 部屋がある間だけ、公開アドレスが新しいサーバーに切り替わったかを数秒おきに確かめる。"""
    if not (MIGRATE_KEY and PUBLIC_URL):   # 手元の開発などで合言葉か公開アドレスがなければ何もしない
        log.info('migrate: off (%s)', 'MIGRATE_KEY is not set' if not MIGRATE_KEY else 'no public URL')
        yield
        return
    log.info('migrate: on (url=%s, every %.0fs while rooms exist)', PUBLIC_URL, MIGRATE_POLL)
    from aiohttp import ClientSession, ClientTimeout
    session = app['migrate_session'] = ClientSession(timeout=ClientTimeout(total=10))

    async def _run():
        while not moved:
            await asyncio.sleep(MIGRATE_POLL)
            if migrating or not any(room_worth_moving(r) for r in rooms.values()):
                continue
            try:
                if await switched_to_other(session):
                    await migrate_out(session)
            except Exception:   # 見張りが止まらないように
                log.exception('migrate: watcher error')
    app['migrate_task'] = asyncio.create_task(_run())
    yield
    app['migrate_task'].cancel()
    await session.close()


async def migrate_on_shutdown(app):
    """止める合図（SIGTERM）が見張りより先に来たとき: 接続を切る前に、切り替わっていれば最後に部屋を送る（Render が強制終了する前に終わるよう短く）。"""
    session = app.get('migrate_session')
    if session is None or moved or migrating:
        return
    app['migrate_task'].cancel()
    try:
        if any(room_worth_moving(r) for r in rooms.values()) and await switched_to_other(session, timeout=3):
            await migrate_out(session, timeout=5)
    except Exception:
        log.exception('migrate: shutdown attempt failed')


# ---------- websocket handler
async def ws_handler(request):
    ws = web.WebSocketResponse(heartbeat=25)
    await ws.prepare(request)
    if moved:   # 部屋はもう新しいサーバーにある。切れば画面がつなぎ直して新しいサーバーへ行く
        await ws.close()
        return ws
    LIVE_SOCKETS.add(ws)
    try:
        return await ws_session(ws)
    finally:
        LIVE_SOCKETS.discard(ws)


async def ws_session(ws):
    ctx = {'room': None, 'pid': None}

    async def error(msg, code=None):
        await send(ws, {'type': 'error', 'message': msg, 'code': code})   # code: クライアントが言語に合わせて表示

    async def handle(data):
        t = data.get('type')
        room, pid = ctx['room'], ctx['pid']
        if room is not None and rooms.get(room.code) not in (None, room):   # 引っ越しの送り直しで部屋が新しい中身に置き換わった
            room = ctx['room'] = rooms[room.code]

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
            sheet_log('部屋作成', room, name)
            return await broadcast(room)

        if t == 'join':
            code = str(data.get('room') or '').strip().upper()[:4]
            r = rooms.get(code) if code else None
            if not r and data.get('room_name'):   # 部屋名で参加（招待リンクはコード）
                r = find_room_by_title(str(data.get('room_name'))[:40])
            if not r and code and data.get('pid') and data.get('token'):   # 更新の直後: 古いサーバーから部屋が届くのを少し待つ（すぐ「ない」と返すとホームに戻ってしまう）
                r = await wait_migrated_room(code)
            if not r:
                return await error('その名前の部屋は見つかりません', 'room_not_found')
            want_pid = str(data.get('pid') or '')[:12]
            if want_pid and want_pid in r.players:
                # 再接続: 秘密トークンが一致した本人のみ（他人のIDでのなりすまし防止）
                p = r.players[want_pid]
                if p.is_bot or not secrets.compare_digest(str(data.get('token') or ''), p.token or ''):
                    return await error('再接続の認証に失敗しました', 'reauth_failed')
                if p.ws is not None and p.ws is not ws and not p.ws.closed:
                    old, p.ws = p.ws, None   # 先に外す: 閉じるのを待つ間に古い接続の切断処理が走り、ロビーではこの人を部屋から外してしまう（新しい接続が部屋にいない人につながり、返事が来なくなる）
                    await old.close()
                if migrating or moved or getattr(r, 'dead', False):   # 閉じるのを待つ間に引っ越し・置き換えが起きた: つなぎ直してもらう
                    return await ws.close()
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
                if r.host not in r.players or r.players[r.host].is_bot:   # ホストがいない部屋（ひとりでリロードした等）に戻ってきた人をホストに
                    r.host = pid
                r.empty_since = None
                log.info('room %s join %s%s players=%d', r.code, name, ' (spectator)' if r.phase != 'lobby' else '', len(r.players))
                sheet_log('入室' if r.phase == 'lobby' else '観戦で入室', r, name)
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
            was_title, was_public = room.display_title(), cur['public']
            room.settings.update({
                'categories': cats or ['basic'],
                'rounds': to_int(s.get('rounds', cur['rounds']), 3, 12, cur['rounds']),
                'hand_size': to_int(s.get('hand_size', cur['hand_size']), 4, 12, cur['hand_size']),
                'show_names': bool(s.get('show_names', cur['show_names'])),
                'timer': to_int(s.get('timer', cur['timer']), 0, 180, cur['timer']),
                'max_star': to_int(s.get('max_star', cur['max_star']), 1, 3, cur['max_star']),
                'public': bool(s.get('public', cur['public'])),
            })
            host = room.players.get(room.host)
            if room.settings['public'] != was_public:
                sheet_log('公開部屋にした' if room.settings['public'] else '公開部屋をやめた', room, host.name if host else '')
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
            host = room.players.get(room.host)
            if room.display_title() != was_title:
                sheet_log('部屋名変更', room, host.name if host else '', f'{was_title} → {room.display_title()}')
            return await broadcast(room)

        if t == 'add_bot':
            if not (is_host and room.phase == 'lobby'):
                return
            if len(room.players) >= MAX_PLAYERS:
                return await error('満員です', 'room_full')
            add_bot(room)
            return await broadcast(room)

        if t == 'kick':
            if not is_host:
                return
            target = str(data.get('pid') or '')
            if target in room.players and target != room.host:
                tp = room.players[target]
                room.remove_player(target)
                log.info('room %s kick %s by %s', room.code, tp.name, room.players[pid].name)
                sheet_log('退出させた', room, tp.name, f'ホスト {room.players[pid].name} が退出させた')
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
                sheet_log('通報', room, tp.name, f'{room.players[pid].name} が通報／理由: {reason}')   # チャットの中身は残さない
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
            sheet_log('退出', room, p.name)
            await send(ws, {'type': 'left', 'message': '部屋から退出しました', 'code': 'left'})
            await after_player_gone(room, p.name)
            if room.empty_since and not any(not x.is_bot for x in room.players.values()):   # 最後の人が自分で退出した（戻ってくる人がいない）: EMPTY_GRACE ではなく、これまでどおり LEFT_GRACE で消す
                room.empty_since -= EMPTY_GRACE - LEFT_GRACE
            return

        if t == 'start':
            if not (is_host and room.phase in ('lobby', 'end')):
                return
            if room.phase == 'lobby':   # ロビーでは切れた人はすぐ抜けるので、接続のない人は引っ越しのあとまだつなぎ直していない人。開始の前に外す（いない人に手札を配らない）
                for gp in [x for x in room.players.values() if not x.is_bot and x.ws is None and x.pid != pid]:
                    room.remove_player(gp.pid)
            if len(room.players) < 2:
                if not data.get('with_bot'):
                    return await error('2人以上（ボット可）で開始できます', 'need_two')
                add_bot(room)   # 「botとゲーム開始」: ひとりのときはボットを1体入れて始める
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
                host = room.players.get(room.host)
                sheet_log('ゲーム中断', room, host.name if host else '', 'ホストがロビーに戻した')
            return await broadcast(room)

    async for msg in ws:
        if msg.type != WSMsgType.TEXT:
            continue
        if '"ping"' in msg.data and msg.data.replace(' ', '') in ('{"type":"ping"}',):   # 生存確認はいつでもすぐ返す（引っ越し中に返さないと、画面が切れたと思ってつなぎ直してしまう）
            await send(ws, {'type': 'pong'})
            continue
        while migrating:   # 部屋を新しいサーバーへ送っている最中の操作は、終わるまで待たせる（送れなかったら、そのまま続きを処理する）
            await asyncio.sleep(0.05)
        if moved:   # 送り終えた: この操作は新しいサーバーでやり直してもらう（切ると画面がつなぎ直す）
            await ws.close()
            break
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
    if moved:   # 引っ越しで切った接続。部屋は新しいサーバーにあるので、ここでは何もしない
        return ws
    room, pid = ctx['room'], ctx['pid']
    if room is not None and rooms.get(room.code) not in (None, room):   # 引っ越しの送り直しで部屋が置き換わった
        room = rooms[room.code]
    if room and pid in room.players and room.players[pid].ws is ws:
        p = room.players[pid]
        p.connected, p.ws = False, None
        log.info('room %s disconnect %s (phase=%s)', room.code, p.name, room.phase)
        if room.phase == 'lobby':
            room.remove_player(pid)
            sheet_log('切断', room, p.name, 'ロビーで接続が切れた（戻ると入室になる）')
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
    r = rooms.get(code) or await wait_migrated_room(code)
    if not r or not r.has_humans():
        return web.json_response({'found': False}, status=404)
    host = r.players.get(r.host)
    return web.json_response({'found': True, 'room': r.code, 'title': r.display_title(), 'host': host.name if host else '',
                              'players': len(r.players), 'max': MAX_PLAYERS, 'phase': r.phase, 'round': r.round,
                              'names': [r.players[x].name for x in r.order]})


async def index(request):   # トップ（/）でもホームを返す。Google はサイト名（検索結果の「地理王」）をトップのページから取り、転送だけだと「Render」になる
    return web.FileResponse(os.path.join(HERE, 'static', 'index.html'), headers={'Cache-Control': 'no-cache'})


async def manifest(request):
    return web.FileResponse(os.path.join(HERE, 'static', 'manifest.json'), headers={'Content-Type': 'application/manifest+json'})


async def favicon(request):   # Google の検索結果のアイコンや、アイコンの指定がないページでブラウザが読みに来る
    return web.FileResponse(os.path.join(HERE, 'static', 'icons', 'favicon.ico'), headers={'Content-Type': 'image/x-icon', 'Cache-Control': 'public, max-age=86400'})


async def service_worker(request):
    return web.FileResponse(os.path.join(HERE, 'static', 'sw.js'), headers={'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache'})


# 検索エンジン向け: クロールしてよい範囲と、載せてほしいページの一覧
SITE_URL = os.environ.get('SITE_URL', 'https://geoking-vlgh.onrender.com').rstrip('/')
SITEMAP_PAGES = ['/', '/static/zukan.html', '/static/quiz.html', '/static/privacy.html']

async def robots_txt(request):   # 国データ（/api/meta）は図鑑の表示に要るので許可。利用ログ送信などは除外
    return web.Response(text=f"User-agent: *\nAllow: /api/meta\nDisallow: /api/\nDisallow: /admin/\n\nSitemap: {SITE_URL}/sitemap.xml\n")


async def sitemap_xml(request):
    urls = ''.join(f'<url><loc>{SITE_URL}{p}</loc></url>' for p in SITEMAP_PAGES)
    return web.Response(text=f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>\n',
                        content_type='application/xml')


# Google Search Console の所有確認（HTML ファイル方式）。Render の Environment に
# GOOGLE_SITE_VERIFICATION=google0123abcd.html のようにファイル名を入れると、そのファイルを返す
GOOGLE_SITE_VERIFICATION = os.environ.get('GOOGLE_SITE_VERIFICATION', '').strip()

async def google_verification(request):
    name = request.match_info['name'] + '.html'
    if not GOOGLE_SITE_VERIFICATION or not hmac.compare_digest(name, GOOGLE_SITE_VERIFICATION):
        raise web.HTTPNotFound()
    return web.Response(text=f'google-site-verification: {name}')


def compute_asset_version():
    """画面の部品（static/ の全ファイル）の中身から作る版の目印。画面を変えて公開したときだけ変わる（サーバーの再起動やスリープからの復帰では変わらない）。"""
    import hashlib
    h = hashlib.sha1(os.environ.get('GEOKING_VERSION_SALT', '').encode())   # 確かめ用: 中身を変えずに「新しい版」を作る
    root = os.path.join(HERE, 'static')
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for fn in sorted(filenames):
            if fn.startswith('.'):
                continue
            path = os.path.join(dirpath, fn)
            h.update(os.path.relpath(path, root).encode())
            with open(path, 'rb') as f:
                h.update(f.read())
    return h.hexdigest()[:12]


ASSET_VERSION = compute_asset_version()


async def api_version(request):
    """画面の版。画面（app.js）が数分おきとアプリに戻ったときに見て、変わっていれば対戦中でないときに読み直す。"""
    return web.json_response({'v': ASSET_VERSION}, headers={'Cache-Control': 'no-store'})


async def healthz(request):
    return web.json_response({'ok': True, 'rooms': len(rooms), 'boot': BOOT_ID, 'started': STARTED, 'moved': moved})   # boot・started: 更新時に、古いサーバーが新しいサーバーへ切り替わったかを見分ける


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
    if name != '(名前なし)' and not check_name(name)[0]:   # 部屋に入るときに断られる名前（電話番号・SNS の ID・不適切な言葉など）は残さない
        name = '(名前なし)'
    vid = ''.join(ch for ch in str(data.get('id') or '') if ch.isalnum())[:12]
    sec = to_int(data.get('sec'), 0, 24 * 3600, 0)
    label = {'start': '開始', 'ping': '滞在中', 'leave': '離脱'}[event]
    log.info('visit %s %s name=%s 滞在=%d分%02d秒 id=%s', mode, label, name, sec // 60, sec % 60, vid)
    v = VISITS.get(vid)
    # スプレッドシートには、1回の訪問（id）につき「開いた」「離れた」を1行ずつだけ（5分ごとの「滞在中」や、同じ訪問の送り直しは残さない）
    if (event == 'start' and v is None) or (event == 'leave' and (v is None or v['state'] != '離脱')):
        sheet_log(f'{mode}を開いた' if event == 'start' else f'{mode}を離れた', None, name,
                  f'滞在 {sec // 60}分{sec % 60:02d}秒／id={vid}' if event == 'leave' else f'id={vid}', kind='visit')
    # 管理者ページ用にメモリにも残す（サーバー再起動で消える。長期の記録は Render のログ）
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
    resp.headers.setdefault('X-Frame-Options', 'SAMEORIGIN')   # アプリ内フレーム（同じサイト）で図鑑・クイズを開けるように
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
    app.cleanup_ctx.append(migrate_watch)
    app.cleanup_ctx.append(sheet_log_ctx)
    app.on_shutdown.append(migrate_on_shutdown)
    app.on_shutdown.append(sheet_log_on_shutdown)
    app.router.add_get('/', index)
    app.router.add_get('/healthz', healthz)
    app.router.add_get('/robots.txt', robots_txt)
    app.router.add_get('/sitemap.xml', sitemap_xml)
    app.router.add_get('/{name:google[0-9a-f]+}.html', google_verification)
    app.router.add_get('/manifest.json', manifest)
    app.router.add_get('/favicon.ico', favicon)
    app.router.add_get('/sw.js', service_worker)
    app.router.add_get('/api/meta', api_meta)
    app.router.add_get('/api/version', api_version)
    app.router.add_post('/api/visit', api_visit)
    app.router.add_get('/admin/visits', admin_visits)
    app.router.add_get('/api/rooms', api_rooms)
    app.router.add_get('/api/room/{code}', api_room)
    app.router.add_get('/ws', ws_handler)
    app.router.add_post('/internal/migrate', internal_migrate)
    app.router.add_static('/static/', os.path.join(HERE, 'static'))
    if os.environ.get('GEOKING_DEV'):   # 開発用: tests/ にある画面の確認スクリプトをブラウザから読めるようにする（本番では環境変数を入れないので出ない）
        app.router.add_static('/dev/tests/', os.path.join(HERE, 'tests'))
    return app


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8080'))
    log.info('GeoKing server: http://localhost:%d', port)
    web.run_app(make_app(), port=port, print=None, access_log=None)   # HTTPアクセスログは出さず、ゲームの出来事だけ記録
