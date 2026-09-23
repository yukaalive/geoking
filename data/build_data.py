# -*- coding: utf-8 -*-
"""mledoze/countries + World Bank API + 手動データ を統合して countries.json を生成する。"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from manual_data import TEMP, RELIGION, CLIMATE

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

NAME_OFFICIAL_OVERRIDES = {
    'ES': 'スペイン王国', 'KP': '朝鮮民主主義人民共和国', 'AE': 'アラブ首長国連邦',
}
NAME_COMMON_OVERRIDES = {
    'AE': 'アラブ首長国連邦',
}

# 排他的経済水域 (km²)。Wikipedia "Exclusive economic zone" の主権国合計（内陸国は 0）。raw/eez_by_cca2.json
EEZ_OVERRIDES = {'NU': 316584}   # ニウエ（表に無いため概算）

# 五十音順用の読み（カタカナ以外を含む国名）
KANA_OVERRIDES = {
    'AE': 'あらぶしゅちょうこくれんぽう', 'CD': 'こんごみんしゅきょうわこく', 'CF': 'ちゅうおうあふりか', 'CG': 'こんごきょうわこく',
    'CK': 'くっくしょとう', 'CN': 'ちゅうごく', 'DM': 'どみにかこく', 'DO': 'どみにかきょうわこく', 'GQ': 'せきどうぎにあ',
    'JP': 'にほん', 'KN': 'せんときっつ・ねーヴぃすれんぽう', 'KP': 'きたちょうせん', 'KR': 'かんこく', 'MH': 'まーしゃるしょとう',
    'MK': 'きたまけどにあ', 'SB': 'そろもんしょとう', 'SS': 'みなみすーだん', 'TL': 'ひがしてぃもーる', 'ZA': 'みなみあふりか',
}

# 正式名称の読み（漢字部分の辞書。長いものから順に置換）
KANJI_READINGS = [
    ('朝鮮民主主義人民共和国', 'ちょうせんみんしゅしゅぎじんみんきょうわこく'), ('中華人民共和国', 'ちゅうかじんみんきょうわこく'), ('大韓民国', 'だいかんみんこく'),
    ('グレートブリテン及び北アイルランド連合王国', 'ぐれーとぶりてんおよびきたあいるらんどれんごうおうこく'),
    ('民主社会主義共和国', 'みんしゅしゃかいしゅぎきょうわこく'), ('社会主義共和国', 'しゃかいしゅぎきょうわこく'), ('人民民主共和国', 'じんみんみんしゅきょうわこく'),
    ('民主人民共和国', 'みんしゅじんみんきょうわこく'), ('連邦民主共和国', 'れんぽうみんしゅきょうわこく'), ('人民共和国', 'じんみんきょうわこく'),
    ('民主共和国', 'みんしゅきょうわこく'), ('連邦共和国', 'れんぽうきょうわこく'), ('イスラム共和国', 'いすらむきょうわこく'), ('協同共和国', 'きょうどうきょうわこく'),
    ('連合共和国', 'れんごうきょうわこく'), ('東方共和国', 'とうほうきょうわこく'), ('アラブ共和国', 'あらぶきょうわこく'), ('共和国', 'きょうわこく'),
    ('首長国連邦', 'しゅちょうこくれんぽう'), ('多民族国', 'たみんぞくこく'), ('独立国', 'どくりつこく'), ('合衆国', 'がっしゅうこく'), ('大公国', 'たいこうこく'),
    ('公国', 'こうこく'), ('王国', 'おうこく'), ('市国', 'しこく'), ('連邦', 'れんぽう'), ('連合', 'れんごう'), ('諸島', 'しょとう'), ('日本国', 'にほんこく'),
    ('中央', 'ちゅうおう'), ('赤道', 'せきどう'), ('及び', 'および'), ('北', 'きた'), ('南', 'みなみ'), ('東', 'ひがし'), ('国', 'こく'),
]

def official_kana(name):
    """正式名称（日本語）をひらがなの読みに。カタカナ→ひらがな、漢字は辞書で置換。中黒・空白は除く"""
    t = name
    for k, v in KANJI_READINGS:
        t = t.replace(k, v)
    out = ''
    for ch in t:
        o = ord(ch)
        if 0x30A1 <= o <= 0x30F6: out += chr(o - 0x60)
        elif ch in '・ 　': continue
        else: out += ch
    return out.replace('ゔ', 'う')

def to_hira(text):
    """カタカナ→ひらがな（五十音順の比較用。長音・中黒は除く）"""
    out = ''
    for ch in text:
        o = ord(ch)
        if 0x30A1 <= o <= 0x30F6: out += chr(o - 0x60)
        elif ch in 'ー・': continue
        else: out += ch
    return out.replace('ヴ', 'ゔ').replace('ゔ', 'う')

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
        jp = dict(c['translations'].get('jpn', {}))
        # 日本語名の補正（外務省表記に合わせる）
        jp['official'] = NAME_OFFICIAL_OVERRIDES.get(c['cca2'], jp.get('official'))
        jp['common'] = NAME_COMMON_OVERRIDES.get(c['cca2'], jp.get('common'))
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
            'climate': CLIMATE.get(c['cca2']),   # 気候区分（文字列。お題には使わず、カード裏面の表示のみ）
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

    # ---- 追加指標: EEZ・人口密度・五十音順
    eez = load('eez_by_cca2.json') if os.path.exists(os.path.join(RAW, 'eez_by_cca2.json')) else {}
    for r in out:
        code = r['id'].upper()
        r['eez'] = 0 if r['landlocked'] else EEZ_OVERRIDES.get(code, eez.get(r['id']))
        r['density'] = round(r['population'] / r['area'], 1) if r.get('population') and r.get('area') else None
        r['name_kana'] = KANA_OVERRIDES.get(code, to_hira(r['name']))
        r['official_kana'] = official_kana(r['name_official'])
        r['name_len'] = len(r['official_kana'])   # 正式名称の文字数＝ひらがなの読みの文字数（「ー」は数える、「・」は数えない）
    for rank, r in enumerate(sorted(out, key=lambda x: x['name_kana']), 1):
        r['kana_rank'] = rank
    out.sort(key=lambda r: r['id'])
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=0)
    print('countries:', len(out))
    missing = {k: [r['id'] for r in out if r.get(k) is None] for k in list(WB_INDICATORS.values()) + ['temp', 'eez', 'density']}
    for k, v in missing.items():
        if v: print(f'  missing {k} ({len(v)}): {" ".join(v)}')
    norel = [r['id'] for r in out if r['id'].upper() not in RELIGION]
    if norel: print('  missing religion:', norel)

if __name__ == '__main__':
    main()
