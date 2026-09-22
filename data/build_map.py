# -*- coding: utf-8 -*-
"""世界地図（正距円筒図法, viewBox 1000x500）の国別SVGパスを static/worldmap.json に生成する。
入力: data/raw/countries.geo.json（johan/world.geo.json, Natural Earth 110m 由来）"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1000, 500
ID_FIX = {'CS-KM': 'UNK'}   # コソボ
SKIP = {'ATA'}              # 南極は描かない

def proj(lng, lat):
    return round((lng + 180) / 360 * W, 1), round((90 - lat) / 180 * H, 1)

def ring_path(ring):
    pts = [proj(x, y) for x, y in ring]
    out = []
    last = None
    for x, y in pts:
        if last and abs(x - last[0]) < 0.5 and abs(y - last[1]) < 0.5:
            continue   # 小さすぎる移動は間引き
        out.append(f"{'M' if not out else 'L'}{x} {y}")
        last = (x, y)
    return ''.join(out) + 'Z' if len(out) >= 3 else ''

def main():
    g = json.load(open(os.path.join(HERE, 'raw', 'countries.geo.json'), encoding='utf-8'))
    paths = {}
    for f in g['features']:
        iso = ID_FIX.get(f['id'], f['id'])
        if not iso or iso == '-99' or iso in SKIP:
            continue
        geom = f['geometry']
        polys = geom['coordinates'] if geom['type'] == 'Polygon' else [p for mp in geom['coordinates'] for p in mp]
        d = ''.join(ring_path(ring) for ring in polys)
        if d:
            paths[iso] = paths.get(iso, '') + d
    out = os.path.join(HERE, '..', 'static', 'worldmap.json')
    json.dump(paths, open(out, 'w'), separators=(',', ':'))
    print('countries drawn:', len(paths), 'bytes:', os.path.getsize(out))

if __name__ == '__main__':
    main()
