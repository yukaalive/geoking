# -*- coding: utf-8 -*-
"""バトルのレート（強さの目安の数字）と全国ランキング（2026-10-03、ユーザーが選んだ案B）。

- 持ち主: 端末ごとの合言葉 rk（画面が localStorage に作るランダムな文字）。サーバーは合言葉そのものは持たず、
  ハッシュした番号 rid だけを持つ（ランキングやスプレッドシートにも rid しか出さない）。登録はいらない
- 計算: バトルの最後の順位で、ほかの全員と1対1の勝ち負けを数える（イロレーティング）。最初は START。
  強い人に勝つほど大きく上がり、弱い人に負けるほど大きく下がる。はじめの NEW_GAMES 試合は動きを大きく（早く自分の強さに近づく）
- ボットはいつも BOT_RATE の相手。ボットに勝って上がるのは BOT_CAP まで（ボットだけで上の称号やランキングの上位に届かないように）。
  ボットに負けたときは、ふつうに下がる
- ランキングに載るのは、GAMES_TO_RANK 回以上バトルした人（ボット戦も数える。2026-10-03 ユーザーの指定「botと1回対戦しても乗るようにして」。
  前は人と10回）。名前を出さない設定もある。人と戦った試合数 h は記録だけ続ける
- 消えないように（Render の無料プランは止まるとメモリが消える）:
  ① 運営者のスプレッドシート（sheet_log と同じ Apps Script の「レート」のシート。server.py が起動時に読み、変わった分を送る）
  ② 更新時の部屋の引っ越しで、新しいサーバーへ一緒に送る
  ③ 端末の控え: サーバーの署名つきの控え（copy_of）を画面が持ち、サーバーが忘れていたら、つないだときに戻す（restore）。
     署名はサーバーしか作れないので、書き換えた控えは受け取らない。古い控えは、今の記録より試合数が多いときだけ使う
"""
import hashlib
import hmac
import json
import os
import re
import time

START = 1000.0
BOT_RATE = 1000.0
BOT_CAP = 1200.0
K_NEW, K = 48.0, 32.0
NEW_GAMES = 10
GAMES_TO_RANK = 1
TOP_N = 50
MAX_RECORDS = 200000

RATINGS = {}    # rid -> {'r': レート, 'n': 試合数, 'h': 人と戦った試合数, 'best': いちばん高かったレート, 'name': 最後の名前, 'hide': 名前を出さない, 't': 更新した時刻}
DIRTY = set()   # スプレッドシートへまだ送っていない rid
_cache = {'ver': 0, 'at': -1, 'sorted': []}   # ランキングの並べ替えの使い回し（変わったら作り直す）
_ver = [0]

_SECRET = hashlib.sha256(('geoking-rating\n' + (os.environ.get('RATING_SECRET') or os.environ.get('MIGRATE_KEY') or 'dev-only')).encode('utf-8')).digest()
_RK = re.compile(r'^[A-Za-z0-9_-]{16,64}$')
_RID = re.compile(r'^[0-9a-f]{20}$')


def rid_of(rk):
    """合言葉 → 番号。合言葉の形がおかしければ None"""
    if not isinstance(rk, str) or not _RK.match(rk):
        return None
    return hashlib.sha256(('rk\n' + rk).encode('utf-8')).hexdigest()[:20]


def valid_rid(rid):
    return isinstance(rid, str) and bool(_RID.match(rid))


def _changed(rid):
    DIRTY.add(rid)
    _ver[0] += 1


def get(rid, create=False):
    rec = RATINGS.get(rid)
    if rec is None and create and valid_rid(rid) and len(RATINGS) < MAX_RECORDS:
        rec = RATINGS[rid] = {'r': START, 'n': 0, 'h': 0, 'best': START, 'name': '', 'hide': False, 't': 0.0}
    return rec


def rate_of(rid):
    rec = RATINGS.get(rid) if rid else None
    return round(rec['r']) if rec else None


def _sign(text):
    return hmac.new(_SECRET, text.encode('utf-8'), hashlib.sha256).hexdigest()[:32]


def copy_of(rid):
    """端末に持たせる控え（c: 中身の文字、s: 署名）。試合をしたことがなければ None"""
    rec = RATINGS.get(rid) if rid else None
    if not rec or not rec['n']:
        return None
    c = json.dumps({'rid': rid, 'r': round(rec['r'], 2), 'n': rec['n'], 'h': rec['h'], 'best': round(rec['best'], 2), 'hide': rec['hide'], 't': round(rec['t'])},
                   separators=(',', ':'))
    return {'c': c, 's': _sign(c)}


def restore(rid, c, s):
    """端末の控えから戻す。署名が合い、番号が同じで、今の記録より試合数が多いときだけ。戻したら True"""
    if not (valid_rid(rid) and isinstance(c, str) and isinstance(s, str) and len(c) < 400):
        return False
    if not hmac.compare_digest(_sign(c), s[:64]):
        return False
    try:
        d = json.loads(c)
        r, n, h, best = float(d['r']), int(d['n']), int(d['h']), float(d['best'])
    except (ValueError, KeyError, TypeError):
        return False
    if d.get('rid') != rid or n <= 0:
        return False
    rec = get(rid, create=True)
    if rec is None or n <= rec['n']:
        return False
    rec.update({'r': r, 'n': n, 'h': h, 'best': max(best, r), 'hide': bool(d.get('hide')), 't': float(d.get('t') or time.time())})
    _changed(rid)
    return True


def title_index(r):
    """称号の段（0 見習い・1 旅人・2 探検家・3 地理博士・4 地理名人・5 地理王）。画面の common.js の RATE_TITLES と同じ区切り"""
    return sum(1 for x in (1000, 1100, 1200, 1350, 1500) if r >= x)


def expected(a, b):
    return 1.0 / (1.0 + 10 ** ((b - a) / 400.0))


def apply_game(entries, now=None):
    """1試合ぶんのレートを動かす。entries: [{'rid': 番号 or None, 'is_bot': bool, 'place': 順位, 'name': 名前}]
    （ボットは rid なし。人でも合言葉がない古い画面の人は rid なし＝数えない）。
    同じ番号が2人いる（同じ端末の2つの画面）ときは、その番号は数えない。
    返り値: {rid: {'before', 'after', 'cap'}}（cap: ボットに勝った分を BOT_CAP で止めた）"""
    now = time.time() if now is None else now
    seen = {}
    for e in entries:
        if e.get('rid'):
            seen[e['rid']] = seen.get(e['rid'], 0) + 1
    players = [e for e in entries if e.get('is_bot') or (e.get('rid') and seen[e['rid']] == 1)]
    humans = [e for e in players if not e.get('is_bot')]
    if len(players) < 2 or not humans:
        return {}
    cur = {e['rid']: get(e['rid'], create=True) for e in humans}
    if any(v is None for v in cur.values()):
        return {}
    rate = lambda e: BOT_RATE if e.get('is_bot') else cur[e['rid']]['r']
    out = {}
    for e in humans:
        rec = cur[e['rid']]
        k = K_NEW if rec['n'] < NEW_GAMES else K
        vs_h = vs_b = 0.0
        for o in players:
            if o is e:
                continue
            s = 1.0 if e['place'] < o['place'] else 0.5 if e['place'] == o['place'] else 0.0
            d = s - expected(rate(e), rate(o))
            if o.get('is_bot'):
                vs_b += d
            else:
                vs_h += d
        n = len(players) - 1
        d_h, d_b = k * vs_h / n, k * vs_b / n
        cap = False
        if d_b > 0 and rec['r'] + d_h + d_b > BOT_CAP:   # ボットに勝った分で上がるのは BOT_CAP まで（人に勝った分はそのまま）
            d_b = max(0.0, BOT_CAP - (rec['r'] + d_h))
            cap = True
        out[e['rid']] = {'before': rec['r'], 'after': rec['r'] + d_h + d_b, 'cap': cap}
    others = {e['rid']: any(o is not e and not o.get('is_bot') for o in players) for e in humans}
    for e in humans:
        rec, res = cur[e['rid']], out[e['rid']]
        rec['r'] = res['after']
        rec['n'] += 1
        rec['h'] += 1 if others[e['rid']] else 0
        rec['best'] = max(rec['best'], rec['r'])
        rec['t'] = now
        if e.get('name'):
            rec['name'] = str(e['name'])[:16]
        _changed(e['rid'])
    return out


def eligible(rec):
    return bool(rec) and rec['n'] >= GAMES_TO_RANK


def _sorted():
    if _cache['ver'] != _ver[0] or _cache['at'] < 0:
        _cache['sorted'] = sorted((rid for rid, rec in RATINGS.items() if eligible(rec)), key=lambda x: (-RATINGS[x]['r'], -RATINGS[x]['n'], x))
        _cache['ver'], _cache['at'] = _ver[0], 1
    return _cache['sorted']


def rank_of(rid):
    """(全国の順位 or None, ランキングに載っている人数)。順位は表示のレート（四捨五入）が同じなら同じ順位"""
    lst = _sorted()
    rec = RATINGS.get(rid)
    if not eligible(rec):
        return None, len(lst)
    mine = round(rec['r'])
    return 1 + sum(1 for x in lst if round(RATINGS[x]['r']) > mine), len(lst)


def summary(rid):
    """ホームの「あなたのレート」と、結果発表のための自分の記録"""
    rec = RATINGS.get(rid)
    if not rec:
        return None
    rank, total = rank_of(rid)
    return {'rate': round(rec['r']), 'n': rec['n'], 'h': rec['h'], 'best': round(rec['best']), 'hide': rec['hide'],
            'rank': rank, 'total': total, 'need': max(0, GAMES_TO_RANK - rec['n'])}


def ranking(rid=None):
    """上位 TOP_N 人と、自分の記録"""
    lst = _sorted()
    top, rank, prev = [], 0, None
    for i, x in enumerate(lst):
        rv = round(RATINGS[x]['r'])
        if rv != prev:
            rank, prev = i + 1, rv
        if i >= TOP_N:
            break
        rec = RATINGS[x]
        top.append({'rank': rank, 'name': None if rec['hide'] else (rec['name'] or None), 'rate': rv, 'me': x == rid})
    return {'top': top, 'total': len(lst), 'need_games': GAMES_TO_RANK, 'me': summary(rid) if rid else None}


def set_hide(rid, hide):
    rec = RATINGS.get(rid)
    if not rec:
        return False
    if rec['hide'] != bool(hide):
        rec['hide'] = bool(hide)
        rec['t'] = max(rec['t'], time.time())
        _changed(rid)
    return True


def export_rows(rids=None):
    """スプレッドシート・引っ越しへ送る形"""
    ids = RATINGS.keys() if rids is None else [x for x in rids if x in RATINGS]
    return [{'rid': x, 'r': round(RATINGS[x]['r'], 2), 'n': RATINGS[x]['n'], 'h': RATINGS[x]['h'], 'best': round(RATINGS[x]['best'], 2),
             'name': RATINGS[x]['name'], 'hide': RATINGS[x]['hide'], 't': round(RATINGS[x]['t'])} for x in ids]


def merge(rows, mark_dirty=False):
    """スプレッドシート・引っ越しから受け取る。試合数が多い方（同じなら新しい方）を残す。受け取った数を返す"""
    got = 0
    for d in rows or []:
        try:
            rid = str(d['rid'])
            n, h, r = int(d['n']), int(d['h']), float(d['r'])
            best, t = float(d.get('best') or r), float(d.get('t') or 0)
        except (ValueError, KeyError, TypeError):
            continue
        if not valid_rid(rid) or n < 0 or h < 0 or not (0 < r < 10000):
            continue
        rec = RATINGS.get(rid)
        if rec is not None and (n, t) <= (rec['n'], rec['t']):
            continue
        if rec is None and len(RATINGS) >= MAX_RECORDS:
            continue
        RATINGS[rid] = {'r': r, 'n': n, 'h': h, 'best': max(best, r), 'name': str(d.get('name') or '')[:16], 'hide': bool(d.get('hide')), 't': t}
        _ver[0] += 1
        if mark_dirty:
            DIRTY.add(rid)
        got += 1
    return got
