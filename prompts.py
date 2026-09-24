# -*- coding: utf-8 -*-
"""お題（プロンプト）定義。key は countries.json のフィールド名。dir は max/min。star は難易度(1-3)。"""

CATEGORIES = {
    'basic':    {'name': '基本（国旗王スタイル）', 'icon': 'flag'},
    'climate':  {'name': '気候・自然', 'icon': 'weather'},
    'religion': {'name': '宗教', 'icon': 'temple'},
    'society':  {'name': '社会・暮らし', 'icon': 'city'},
}

# fmt: 表示形式
FIELDS = {
    'area':        {'label': '面積', 'fmt': 'km2'},
    'population':  {'label': '人口', 'fmt': 'people'},
    'gdp':         {'label': 'GDP', 'fmt': 'usd'},
    'gdp_pc':      {'label': '一人当たりGDP', 'fmt': 'usd_small'},
    'name_len':    {'label': '正式名称の文字数', 'fmt': 'chars'},
    'eez':         {'label': '排他的経済水域（EEZ）', 'fmt': 'km2'},
    'density':     {'label': '人口密度', 'fmt': 'density'},
    'kana_rank':   {'label': '五十音順', 'fmt': 'kana_rank'},
    'lat':         {'label': '緯度', 'fmt': 'lat'},
    'lng':         {'label': '経度', 'fmt': 'lng'},
    'abs_lat':     {'label': '赤道からの緯度差', 'fmt': 'deg'},
    'borders':     {'label': '隣接国数', 'fmt': 'countries'},
    'military':    {'label': '軍事費', 'fmt': 'usd'},
    'temp':        {'label': '年平均気温', 'fmt': 'temp'},
    'climate':     {'label': '気候区分', 'fmt': 'text'},
    'forest_pct':  {'label': '森林率', 'fmt': 'pct'},
    'agri_pct':    {'label': '農地率', 'fmt': 'pct'},
    'co2_pc':      {'label': 'CO2排出量/人', 'fmt': 'ton'},
    'rel_chr':     {'label': 'キリスト教徒', 'fmt': 'pct'},
    'rel_mus':     {'label': 'イスラム教徒', 'fmt': 'pct'},
    'rel_bud':     {'label': '仏教徒', 'fmt': 'pct'},
    'rel_hin':     {'label': 'ヒンドゥー教徒', 'fmt': 'pct'},
    'rel_non':     {'label': '無宗教', 'fmt': 'pct'},
    'rel_folk':    {'label': '民間信仰', 'fmt': 'pct'},
    'rel_jew':     {'label': 'ユダヤ教徒', 'fmt': 'pct'},
    'rel_div':     {'label': '宗教多様度', 'fmt': 'pct'},
    'life_exp':    {'label': '平均寿命', 'fmt': 'years'},
    'age65_pct':   {'label': '65歳以上の割合', 'fmt': 'pct'},
    'fertility':   {'label': '出生率', 'fmt': 'float2'},
    'urban_pct':   {'label': '都市人口率', 'fmt': 'pct'},
    'internet_pct':{'label': 'ネット利用率', 'fmt': 'pct'},
    'tourists':    {'label': '外国人観光客数/年', 'fmt': 'people'},
    'physicians':  {'label': '医師数/1000人', 'fmt': 'float2'},
    'elec_pct':    {'label': '電力アクセス率', 'fmt': 'pct'},
}

# 表示形式ごとの小数桁。順位比較はこの桁に丸めた値で行う（画面に同じ値が出るなら同順位にする）
FMT_DECIMALS = {'float2': 2, 'years': 1, 'temp': 1, 'pct': 1, 'ton': 2, 'lat': 1, 'lng': 1, 'deg': 1, 'density': 1,
                'mm': 0, 'km2': 0, 'people': 0, 'usd': 0, 'usd_small': 0, 'chars': 0, 'countries': 0, 'langs': 0, 'kana_rank': 0, 'text': 0}
for _k, _f in FIELDS.items():
    _f['dec'] = FMT_DECIMALS.get(_f['fmt'], 2)

def round_value(key, v):
    """比較用に、その指標の表示桁で丸める。None はそのまま"""
    if v is None:
        return None
    return round(float(v), FIELDS[key]['dec'])


def P(id, cat, text, key, dir, star, hint=''):
    return {'id': id, 'cat': cat, 'text': text, 'key': key, 'dir': dir, 'star': star, 'hint': hint}

PROMPTS = [
    # --- 基本（国旗王のお題を再現）
    P('area_max', 'basic', '面積が大きい国は？', 'area', 'max', 1),
    P('area_min', 'basic', '面積が小さい国は？', 'area', 'min', 1),
    P('pop_max', 'basic', '人口が多い国は？', 'population', 'max', 1),
    P('pop_min', 'basic', '人口が少ない国は？', 'population', 'min', 2),
    P('gdp_max', 'basic', 'GDPが高い国は？', 'gdp', 'max', 2),
    P('gdp_min', 'basic', 'GDPが低い国は？', 'gdp', 'min', 3),
    P('gdppc_max', 'basic', '一人当たりGDPが高い国は？', 'gdp_pc', 'max', 2),
    P('gdppc_min', 'basic', '一人当たりGDPが低い国は？', 'gdp_pc', 'min', 2),
    P('density_max', 'basic', '人口密度が高い国は？', 'density', 'max', 2, '人口 ÷ 面積。都市国家や島国が強い'),
    P('density_min', 'basic', '人口密度が低い国は？', 'density', 'min', 2, '人口 ÷ 面積。広くて人が少ない国'),
    P('eez_max', 'basic', '排他的経済水域（EEZ）が広い国は？', 'eez', 'max', 3, '沿岸から200海里の海の領域。島が多い国・海洋国が強い。内陸国は0'),
    P('eez_min', 'basic', '排他的経済水域（EEZ）が狭い国は？', 'eez', 'min', 3, '内陸国は0'),
    P('kana_first', 'basic', '国名が五十音順で早い国は？（「ア」に近い）', 'kana_rank', 'min', 2, 'カタカナの国名（日本＝にほん）で比較'),
    P('kana_last', 'basic', '国名が五十音順で遅い国は？（「ワ」に近い）', 'kana_rank', 'max', 2, 'カタカナの国名（日本＝にほん）で比較'),
    P('name_max', 'basic', '正式名称（日本語）が長い国は？', 'name_len', 'max', 2, 'ひらがなの読みで数えます。例：日本国＝にほんこく＝5文字'),
    P('name_min', 'basic', '正式名称（日本語）が短い国は？', 'name_len', 'min', 2, 'ひらがなの読みで数えます。例：日本国＝にほんこく＝5文字'),
    P('north', 'basic', '最も北にある国は？', 'lat', 'max', 1, '国土の中心付近の緯度で比較'),
    P('south', 'basic', '最も南にある国は？', 'lat', 'min', 1, '国土の中心付近の緯度で比較'),
    P('east', 'basic', '最も東にある国は？', 'lng', 'max', 2, '経度（東経が大きいほど東）で比較'),
    P('borders_max', 'basic', '国境を接する国が多い国は？', 'borders', 'max', 2),
    P('military_max', 'basic', '軍事費が高い国は？', 'military', 'max', 3),
    # --- 気候・自然
    P('temp_max', 'climate', '年平均気温が高い国は？', 'temp', 'max', 1),
    P('temp_min', 'climate', '年平均気温が低い国は？', 'temp', 'min', 1),
    P('equator', 'climate', '赤道に近い国は？', 'abs_lat', 'min', 1),
    # --- 宗教
    P('chr_max', 'religion', 'キリスト教徒の割合が高い国は？', 'rel_chr', 'max', 1),
    P('mus_max', 'religion', 'イスラム教徒の割合が高い国は？', 'rel_mus', 'max', 1),
    P('non_max', 'religion', '無宗教の割合が高い国は？', 'rel_non', 'max', 2),
    # --- 社会・暮らし
    P('life_max', 'society', '平均寿命が長い国は？', 'life_exp', 'max', 1),
    P('life_min', 'society', '平均寿命が短い国は？', 'life_exp', 'min', 2),
    P('age65_max', 'society', '高齢化率（65歳以上）が高い国は？', 'age65_pct', 'max', 2),
    P('fert_max', 'society', '出生率が高い国は？', 'fertility', 'max', 2),
]
PROMPT_BY_ID = {p['id']: p for p in PROMPTS}


# ---------- 英語（クライアントが言語設定に応じて text_en / name_en / label_en を使う）
PROMPT_EN = {
    'area_max': 'Which country has the largest area?', 'area_min': 'Which country has the smallest area?',
    'pop_max': 'Which country has the largest population?', 'pop_min': 'Which country has the smallest population?',
    'gdp_max': 'Which country has the highest GDP?', 'gdp_min': 'Which country has the lowest GDP?',
    'gdppc_max': 'Which country has the highest GDP per capita?', 'gdppc_min': 'Which country has the lowest GDP per capita?',
    'density_max': 'Which country has the highest population density?', 'density_min': 'Which country has the lowest population density?',
    'eez_max': 'Which country has the largest exclusive economic zone (EEZ)?', 'eez_min': 'Which country has the smallest exclusive economic zone (EEZ)?',
    'kana_first': "Whose Japanese name comes first in kana order (closest to \u30a2)?", 'kana_last': "Whose Japanese name comes last in kana order (closest to \u30ef)?",
    'name_max': 'Which country has the longest official name in Japanese?', 'name_min': 'Which country has the shortest official name in Japanese?',
    'north': 'Which country is farthest north?', 'south': 'Which country is farthest south?', 'east': 'Which country is farthest east?',
    'borders_max': 'Which country borders the most countries?', 'military_max': 'Which country spends the most on its military?',
    'temp_max': 'Which country has the highest average temperature?', 'temp_min': 'Which country has the lowest average temperature?',
    'equator': 'Which country is closest to the equator?',
    'chr_max': 'Which country has the highest share of Christians?', 'mus_max': 'Which country has the highest share of Muslims?',
    'non_max': 'Which country has the highest share of religiously unaffiliated people?',
    'life_max': 'Which country has the longest life expectancy?', 'life_min': 'Which country has the shortest life expectancy?',
    'age65_max': 'Which country has the highest share of people aged 65+?', 'fert_max': 'Which country has the highest fertility rate?',
}
for _p in PROMPTS:
    _p['text_en'] = PROMPT_EN.get(_p['id'], _p['text'])
CATEGORY_EN = {'basic': 'Basics', 'climate': 'Climate & Nature', 'religion': 'Religion', 'society': 'Society & Life'}
for _k, _v in CATEGORIES.items():
    _v['name_en'] = CATEGORY_EN.get(_k, _v['name'])
FIELD_EN = {
    'area': 'Area', 'population': 'Population', 'gdp': 'GDP', 'gdp_pc': 'GDP per capita', 'name_len': 'Official name length (Japanese)',
    'eez': 'Exclusive economic zone (EEZ)', 'density': 'Population density', 'kana_rank': 'Japanese kana order', 'lat': 'Latitude', 'lng': 'Longitude',
    'abs_lat': 'Distance from the equator', 'borders': 'Neighboring countries', 'military': 'Military spending',
    'temp': 'Avg. temperature', 'climate': 'Climate', 'forest_pct': 'Forest cover', 'agri_pct': 'Agricultural land',
    'co2_pc': 'CO\u2082 per capita', 'rel_chr': 'Christians', 'rel_mus': 'Muslims', 'rel_bud': 'Buddhists', 'rel_hin': 'Hindus', 'rel_non': 'Unaffiliated',
    'rel_folk': 'Folk religions', 'rel_jew': 'Jews', 'rel_div': 'Religious diversity', 'life_exp': 'Life expectancy', 'age65_pct': 'Aged 65+',
    'fertility': 'Fertility rate', 'urban_pct': 'Urban population', 'internet_pct': 'Internet users', 'tourists': 'Tourist arrivals / yr',
    'physicians': 'Physicians per 1,000', 'elec_pct': 'Electricity access',
}
for _k, _f in FIELDS.items():
    _f['label_en'] = FIELD_EN.get(_k, _f['label'])
