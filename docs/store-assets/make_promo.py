# -*- coding: utf-8 -*-
"""ストア用の紹介画像を生成する。
   上: キャッチコピー ／ 中: スマホ枠に入れたアプリ画面 ／ 下: 説明文（深緑の帯）
   使い方: python3 make_promo.py            → promo/ に Google Play 用 (1080x2400) と App Store 用 (1290x2796) を出力
   依存: macOS の qlmanage（SVG→PNG）, sips
"""
import base64, os, subprocess, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'promo')
INK, CREAM, GREEN, YELLOW, CARD = '#1c2b22', '#f7f1df', '#1f6f4a', '#f4c542', '#fffdf6'
FONT = "Hiragino Sans, Hiragino Kaku Gothic ProN, sans-serif"

# (スクリーンショット, 見出し行, 説明行[(text, highlight)])
FRAMES = [
    ('android-1-home.png',   ['国旗だけで、', '勝負！'],
     [('裏のデータは見ないで、', False), ('お題に合いそうな国旗を1枚出す。', False), ('めくって一番近い人が1点！', True)]),
    ('android-3-game.png',   ['お題に合う', '国旗を選べ'],
     [('面積・人口・気温・宗教…', False), ('約30種のデータが裏側に。', True), ('知識より、勘と度胸！', False)]),
    ('android-4-reveal.png', ['めくって、', '勝負！'],
     [('7ラウンドで最多得点が地理王。', True), ('友だちと部屋コードで、', False), ('公開部屋で世界の誰かとも。', False)]),
    ('android-5-modal.png',  ['めくった国の', 'ことが分かる'],
     [('197の国旗と国のデータ、', False), ('首都・気候・宗教まで丸わかり。', True), ('遊ぶほど、世界に強くなる。', False)]),
]

def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def build_svg(shot_path, head, desc, W, H, status_bar_px=110):
    b64 = base64.b64encode(open(shot_path, 'rb').read()).decode()
    s = W / 1080.0                        # 1080 基準のスケール
    # レイアウト（1080x2400 基準）
    head_size = 150 * s
    head_y0 = 330 * s
    phone_w, phone_x = 780 * s, (W - 780 * s) / 2
    phone_y = 620 * s
    band_y = H - 520 * s
    phone_h = band_y - phone_y + 80 * s   # 帯に少し重なる
    radius = 70 * s
    # スクショはステータスバー分を上でクリップし、枠内に width 基準でフィット
    img_w = phone_w - 36 * s
    img_x = phone_x + 18 * s
    img_y = phone_y + 18 * s
    img_h_full = img_w * 2400 / 1080
    img_dy = status_bar_px * (img_w / 1080)   # クリップ分を上にずらす
    clip_h = phone_h - 18 * s

    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}" viewBox="0 0 {W} {H}">']
    parts.append(f'''<defs>
  <pattern id="dots" width="{36*s}" height="{36*s}" patternUnits="userSpaceOnUse"><circle cx="{18*s}" cy="{18*s}" r="{2.2*s}" fill="{INK}" opacity=".08"/></pattern>
  <clipPath id="screen"><rect x="{img_x}" y="{img_y}" width="{img_w}" height="{clip_h}" rx="{radius-18*s}" ry="{radius-18*s}"/></clipPath>
</defs>''')
    # 背景
    parts.append(f'<rect width="{W}" height="{H}" fill="{CREAM}"/><rect width="{W}" height="{H}" fill="url(#dots)"/>')
    parts.append(f'<circle cx="{W*0.86}" cy="{H*0.08}" r="{380*s}" fill="{YELLOW}" opacity=".35"/>')
    parts.append(f'<circle cx="{W*0.08}" cy="{H*0.36}" r="{260*s}" fill="{GREEN}" opacity=".12"/>')
    # 小さなロゴ
    parts.append(f'<g transform="translate({54*s} {54*s}) scale({2.6*s})"><path d="M3.5 17.5 5 8.5l4.6 3.6L12 5l2.4 7.1L19 8.5l1.5 9z" fill="{YELLOW}" stroke="{INK}" stroke-width="1.6" stroke-linejoin="round"/><rect x="3.5" y="17.5" width="17" height="3" rx="1" fill="{YELLOW}" stroke="{INK}" stroke-width="1.6"/></g>')
    parts.append(f'<text x="{130*s}" y="{102*s}" font-family="{FONT}" font-weight="900" font-size="{46*s}" fill="{INK}">地理王</text>')
    # 見出し（黄色の縁取り）
    for i, line in enumerate(head):
        y = head_y0 + i * head_size * 1.12
        parts.append(f'<text x="{W/2}" y="{y}" text-anchor="middle" font-family="{FONT}" font-weight="900" font-size="{head_size}" fill="{GREEN}" stroke="{YELLOW}" stroke-width="{18*s}" stroke-linejoin="round" paint-order="stroke">{esc(line)}</text>')
    # スマホ枠
    parts.append(f'<rect x="{phone_x+14*s}" y="{phone_y+14*s}" width="{phone_w}" height="{phone_h}" rx="{radius}" fill="{INK}" opacity=".25"/>')
    parts.append(f'<rect x="{phone_x}" y="{phone_y}" width="{phone_w}" height="{phone_h}" rx="{radius}" fill="{INK}"/>')
    parts.append(f'<g clip-path="url(#screen)"><rect x="{img_x}" y="{img_y}" width="{img_w}" height="{clip_h}" fill="{CREAM}"/>'
                 f'<image x="{img_x}" y="{img_y - img_dy}" width="{img_w}" height="{img_h_full}" xlink:href="data:image/png;base64,{b64}"/></g>')
    parts.append(f'<circle cx="{W/2}" cy="{phone_y + 44*s}" r="{12*s}" fill="#0a120e"/>')
    # 下の帯
    parts.append(f'<rect x="0" y="{band_y}" width="{W}" height="{H-band_y}" fill="{GREEN}"/>')
    parts.append(f'<rect x="0" y="{band_y}" width="{W}" height="{8*s}" fill="{INK}"/>')
    fs = 56 * s
    y = band_y + 150 * s
    for text, hl in desc:
        tw = len(text) * fs * 0.98
        x = 70 * s
        if hl:
            parts.append(f'<rect x="{x-14*s}" y="{y-fs*0.95}" width="{tw+28*s}" height="{fs*1.28}" rx="{10*s}" fill="{YELLOW}"/>')
            parts.append(f'<text x="{x}" y="{y}" font-family="{FONT}" font-weight="900" font-size="{fs}" fill="{INK}">{esc(text)}</text>')
        else:
            parts.append(f'<text x="{x}" y="{y}" font-family="{FONT}" font-weight="800" font-size="{fs}" fill="#ffffff">{esc(text)}</text>')
        y += fs * 1.65
    parts.append('</svg>')
    return '\n'.join(parts)

def render(svg_text, out_png, W, H):
    # qlmanage は正方形のキャンバスに描くので、いったん S×S の正方形 SVG に中央配置してから切り出す
    S = max(W, H)
    inner = svg_text.replace('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"',
                             f'<svg x="{(S-W)/2}" y="{(S-H)/2}"', 1)
    outer = (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{S}" height="{S}" viewBox="0 0 {S} {S}">'
             f'<rect width="{S}" height="{S}" fill="{CREAM}"/>{inner}</svg>')
    tmp_svg = out_png.replace('.png', '.svg')
    open(tmp_svg, 'w', encoding='utf-8').write(outer)
    subprocess.run(['qlmanage', '-t', '-s', str(S), '-o', os.path.dirname(out_png), tmp_svg], capture_output=True)
    shutil.move(tmp_svg + '.png', out_png)
    subprocess.run(['sips', '-c', str(H), str(W), out_png], capture_output=True)   # 中央を W×H に切り出し
    os.remove(tmp_svg)

def main():
    os.makedirs(OUT, exist_ok=True)
    for i, (shot, head, desc) in enumerate(FRAMES, 1):
        src = os.path.join(HERE, shot)
        for tag, W, H in (('play', 1080, 2400), ('appstore', 1290, 2796)):
            out = os.path.join(OUT, f'{tag}-{i}.png')
            render(build_svg(src, head, desc, W, H), out, W, H)
            print('wrote', out)

if __name__ == '__main__':
    main()
