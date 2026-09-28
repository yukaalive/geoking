"""データを作るプログラム（data/build_data.py）で作り直すと、今の data/countries.json と1文字も違わないこと。
2026-09-28: 作り直すと、お題から消した「公用語数」「年間降水量」が戻り、並び・改行も変わっていた（首都を直すときに気づいた）。
首都・国のデータを直すときは、data/manual_data.py などを直してから python3 data/build_data.py で作り直し、このテストを流す。
実行: python3 tests/test_build_data.py（数秒。ネットは使わない。data/raw の保存済みデータから作る）"""
import json, os, subprocess, sys, tempfile
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CUR = os.path.join(ROOT, 'data', 'countries.json')

with tempfile.TemporaryDirectory() as tmp:
    out = os.path.join(tmp, 'countries.json')
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'data', 'build_data.py')], env={**os.environ, 'GEOKING_DATA_OUT': out}, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    new, cur = open(out, encoding='utf-8').read(), open(CUR, encoding='utf-8').read()
    if new != cur:
        a, b = json.loads(new), json.loads(cur)
        diff = [(x['id'], k) for x, y in zip(a, b) for k in set(x) | set(y) if x.get(k) != y.get(k)]
        raise AssertionError(f'作り直すと countries.json が変わる: 値のちがい {diff[:10]} / 並びや書き方のちがいなら {"なし" if diff else "あり"}')
print('OK: 作り直しても今の countries.json と同じ（1文字も違わない）')

data = json.loads(cur)
for k in ('languages', 'precip'):
    assert all(k not in c for c in data) and all(k not in c['_years'] for c in data), f'{k} が残っている'
print('OK: お題から消した公用語数・年間降水量は作らない')

sys.path.insert(0, os.path.join(ROOT, 'data'))
from manual_data import CAPITAL_JA, CAPITAL_EN_OVERRIDES
bad = [c['id'] for c in data if c['capital_ja'] != CAPITAL_JA.get(c['id'].upper(), '') or (c['id'].upper() in CAPITAL_EN_OVERRIDES and c['capital'] != CAPITAL_EN_OVERRIDES[c['id'].upper()])]
assert not bad, bad
print('OK: 首都は manual_data.py の表のとおり（日本語は CAPITAL_JA、英語の補正は CAPITAL_EN_OVERRIDES）')
print('ALL OK')
