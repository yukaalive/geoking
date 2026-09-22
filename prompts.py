# -*- coding: utf-8 -*-
"""お題（プロンプト）定義。key は countries.json のフィールド名。dir は max/min。star は難易度(1-3)。"""

CATEGORIES = {
    'basic':    {'name': '基本（国旗王スタイル）', 'icon': '🏳️'},
    'climate':  {'name': '気候・自然', 'icon': '🌦️'},
    'religion': {'name': '宗教', 'icon': '🛐'},
    'society':  {'name': '社会・暮らし', 'icon': '🏙️'},
}

# fmt: 表示形式
FIELDS = {
    'area':        {'label': '面積', 'fmt': 'km2'},
    'population':  {'label': '人口', 'fmt': 'people'},
    'gdp':         {'label': 'GDP', 'fmt': 'usd'},
    'gdp_pc':      {'label': '一人当たりGDP', 'fmt': 'usd_small'},
    'name_len':    {'label': '正式名称の文字数', 'fmt': 'chars'},
    'lat':         {'label': '緯度', 'fmt': 'lat'},
    'lng':         {'label': '経度', 'fmt': 'lng'},
    'abs_lat':     {'label': '赤道からの緯度差', 'fmt': 'deg'},
    'borders':     {'label': '隣接国数', 'fmt': 'count'},
    'languages':   {'label': '公用語数', 'fmt': 'count'},
    'military':    {'label': '軍事費', 'fmt': 'usd'},
    'temp':        {'label': '年平均気温', 'fmt': 'temp'},
    'precip':      {'label': '年間降水量', 'fmt': 'mm'},
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
    P('name_max', 'basic', '正式名称（日本語）が長い国は？', 'name_len', 'max', 2, '例：「グレートブリテン及び北アイルランド連合王国」'),
    P('name_min', 'basic', '正式名称（日本語）が短い国は？', 'name_len', 'min', 2, '例：「日本国」は3文字'),
    P('north', 'basic', '最も北にある国は？', 'lat', 'max', 1, '国土の中心付近の緯度で比較'),
    P('south', 'basic', '最も南にある国は？', 'lat', 'min', 1, '国土の中心付近の緯度で比較'),
    P('east', 'basic', '最も東にある国は？', 'lng', 'max', 2, '経度（東経が大きいほど東）で比較'),
    P('borders_max', 'basic', '国境を接する国が多い国は？', 'borders', 'max', 2),
    P('military_max', 'basic', '軍事費が高い国は？', 'military', 'max', 3),
    P('lang_max', 'basic', '公用語の数が多い国は？', 'languages', 'max', 3),
    # --- 気候・自然
    P('temp_max', 'climate', '年平均気温が高い国は？', 'temp', 'max', 1),
    P('temp_min', 'climate', '年平均気温が低い国は？', 'temp', 'min', 1),
    P('precip_max', 'climate', '年間降水量が多い国は？', 'precip', 'max', 2),
    P('precip_min', 'climate', '年間降水量が少ない国は？', 'precip', 'min', 2),
    P('equator', 'climate', '赤道に近い国は？', 'abs_lat', 'min', 1),
    # --- 宗教
    P('chr_max', 'religion', 'キリスト教徒の割合が高い国は？', 'rel_chr', 'max', 1),
    P('mus_max', 'religion', 'イスラム教徒の割合が高い国は？', 'rel_mus', 'max', 1),
    P('bud_max', 'religion', '仏教徒の割合が高い国は？', 'rel_bud', 'max', 2),
    P('hin_max', 'religion', 'ヒンドゥー教徒の割合が高い国は？', 'rel_hin', 'max', 2),
    P('non_max', 'religion', '無宗教の割合が高い国は？', 'rel_non', 'max', 2),
    # --- 社会・暮らし
    P('life_max', 'society', '平均寿命が長い国は？', 'life_exp', 'max', 1),
    P('life_min', 'society', '平均寿命が短い国は？', 'life_exp', 'min', 2),
    P('age65_max', 'society', '高齢化率（65歳以上）が高い国は？', 'age65_pct', 'max', 2),
    P('fert_max', 'society', '出生率が高い国は？', 'fertility', 'max', 2),
    P('urban_max', 'society', '都市人口率が高い国は？', 'urban_pct', 'max', 3),
]
PROMPT_BY_ID = {p['id']: p for p in PROMPTS}
