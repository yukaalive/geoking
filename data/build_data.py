# -*- coding: utf-8 -*-
"""mledoze/countries + World Bank API + 手動データ を統合して countries.json を生成する。"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from manual_data import TEMP, RELIGION

RAW = os.path.join(os.path.dirname(__file__), 'raw')
OUT = os.path.join(os.path.dirname(__file__), 'countries.json')

WB_INDICATORS = {
    'NY.GDP.MKTP.CD': 'gdp',            # GDP (USD)
    'NY.GDP.PCAP.CD': 'gdp_pc',         # 一人当たりGDP (USD)
    'SP.POP.TOTL': 'population',        # 人口
    'SP.DYN.LE00.IN': 'life_exp',       # 平均寿命
    'AG.LND.PRCP.MM': 'precip',         # 年間降水量 (mm)
    'AG.LND.FRST.ZS': 'forest_pct',     # 森林率 (%)
    'SP.URB.TOTL.IN.ZS': 'urban_pct',   # 都市人口率 (%)
    'MS.MIL.XPND.CD': 'military',       # 軍事費 (USD)
    'IT.NET.USER.ZS': 'internet_pct',   # ネット利用率 (%)
    'SP.POP.65UP.TO.ZS': 'age65_pct',   # 65歳以上率 (%)
    'SP.DYN.TFRT.IN': 'fertility',      # 出生率 (人)
    'ST.INT.ARVL': 'tourists',          # 外国人観光客数
    'EN.GHG.CO2.PC.CE.AR5': 'co2_pc',   # CO2排出/人 (t)
    'AG.LND.AGRI.ZS': 'agri_pct',       # 農地率 (%)
    'EG.ELC.ACCS.ZS': 'elec_pct',       # 電力アクセス率 (%)
    'SH.MED.PHYS.ZS': 'physicians',     # 医師数/1000人
}

# World Bank に無い小国等の補完（概算・要検証）
OVERRIDES = {
    'VA': {'population': 800, 'gdp': None, 'life_exp': 82.0, 'urban_pct': 100, 'forest_pct': 0, 'precip': 800, 'internet_pct': 90, 'elec_pct': 100},
    'CK': {'population': 15000, 'gdp': 300_000_000, 'gdp_pc': 20000, 'life_exp': 76.0, 'urban_pct': 76, 'forest_pct': 65, 'precip': 2000, 'internet_pct': 60, 'elec_pct': 100, 'age65_pct': 12, 'fertility': 2.2},
    'NU': {'population': 1700, 'gdp': 25_000_000, 'gdp_pc': 15000, 'life_exp': 74.0, 'urban_pct': 46, 'forest_pct': 70, 'precip': 2100, 'internet_pct': 80, 'elec_pct': 100, 'age65_pct': 13, 'fertility': 2.5},
    'KP': {'gdp': 16_000_000_000, 'gdp_pc': 620},
}

def load(name):
    with open(os.path.join(RAW, name), encoding='utf-8') as f:
        return json.load(f)

def main():
    src = load('mledoze.json')
    wb_meta = {c['id']: c for c in load('wb_countries.json')[1]}
    wb = {}
    for ind, key in WB_INDICATORS.items():
        rows = load(f'wb_{ind}.json')[1]
        for r in rows:
            if r['value'] is None or not r['countryiso3code']:
                continue
            wb.setdefault(r['countryiso3code'], {})[key] = (r['value'], r['date'])

    # 197カ国 = 国連加盟193 + バチカン + コソボ + クック諸島 + ニウエ（国旗王と同じ構成）
    extra = {'XK', 'CK', 'NU'}
    out = []
    for c in src:
        if not (c.get('unMember') or c['cca2'] in extra):
            continue
        cca3 = c['cca3']
        wbkey = 'XKX' if c['cca2'] == 'XK' else cca3
        jp = c['translations'].get('jpn', {})
        rec = {
            'id': c['cca2'].lower(),
            'cca3': cca3,
            'name': jp.get('common') or c['name']['common'],
            'name_official': jp.get('official') or c['name']['official'],
            'name_en': c['name']['common'],
            'region': c['region'],
            'subregion': c.get('subregion', ''),
            'capital': (c.get('capital') or [''])[0],
            'lat': c['latlng'][0], 'lng': c['latlng'][1],
            'area': c['area'],
            'landlocked': c['landlocked'],
            'borders': len(c.get('borders') or []),
            'languages': len(c.get('languages') or {}),
            'name_len': len(jp.get('official') or ''),
            'name_en_len': len(c['name']['official']),
            'income': wb_meta.get(wbkey, {}).get('incomeLevel', {}).get('value', ''),
            'temp': TEMP.get(c['cca2']),
        }
        rel = dict(RELIGION.get(c['cca2'], {}))
        total = sum(rel.values())
        if total < 100:
            rel['oth'] = round(rel.get('oth', 0) + (100 - total), 1)
        for k in ['chr', 'mus', 'non', 'hin', 'bud', 'folk', 'jew', 'oth']:
            rec['rel_' + k] = rel.get(k, 0)
        years = {}
        for key in WB_INDICATORS.values():
            v = wb.get(wbkey, {}).get(key)
            rec[key] = v[0] if v else None
            if v: years[key] = v[1]
        rec['_years'] = years
        for k, v in OVERRIDES.get(c['cca2'], {}).items():
            if rec.get(k) is None: rec[k] = v
        rec['abs_lat'] = abs(rec['lat'])
        rec['rel_div'] = round(100 - max(v for k, v in rec.items() if k.startswith('rel_')), 1)
        out.append(rec)

    out.sort(key=lambda r: r['id'])
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=0)
    print('countries:', len(out))
    missing = {k: [r['id'] for r in out if r.get(k) is None] for k in list(WB_INDICATORS.values()) + ['temp']}
    for k, v in missing.items():
        if v: print(f'  missing {k} ({len(v)}): {" ".join(v)}')
    norel = [r['id'] for r in out if r['id'].upper() not in RELIGION]
    if norel: print('  missing religion:', norel)

if __name__ == '__main__':
    main()
