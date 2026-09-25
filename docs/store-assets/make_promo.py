# -*- coding: utf-8 -*-
"""ストア用の紹介画像を生成する（地理王オリジナル構成）。
   ・斜めの深緑の地に、左寄せの「ラベル札」風キャッチコピー
   ・少し傾けたスマホ枠と、その足元に扇状の国旗カード
   ・吹き出し型の説明カード、ステップ番号の丸バッジ
   使い方: python3 make_promo.py → promo/ に Play 用 (1080x2400) と App Store 用 (1290x2796 / 1284x2778 / 1320x2868)
           python3 make_promo.py appstore → App Store 用だけ作り直す（Play 用はそのまま）
   画面の写真: Play 用は android-*.png（Android エミュレーター）、App Store 用は ios-*.png（iPhone シミュレーター。2026-09-26 撮影）
   依存: macOS の qlmanage（SVG→PNG）, sips
"""
import base64, os, subprocess, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'promo')
INK, CREAM, GREEN, YELLOW, CARD, CORAL = '#1c2b22', '#f7f1df', '#1f6f4a', '#f4c542', '#fffdf6', '#e8674a'
FONT = "Hiragino Sans, Hiragino Kaku Gothic ProN, sans-serif"

# (スクリーンショット, 見出し行, 説明行[(text, highlight)], 飾りの国旗)
FRAMES = [
    (('android-1-home.png', 'ios-1-home.png'),     ['国旗だけで、', '勝負！'],
     [('お題に合う国旗を、1枚出すだけ。', True)], ['br', 'jp', 'ke']),
    (('android-3-game.png', 'ios-2-game.png'),     ['お題に合う', '国旗を選べ'],
     [('お題は、面積・人口など約30種。', True)], ['no', 'ar', 'eg']),
    (('android-4-reveal.png', 'ios-3-reveal.png'), ['答え合わせで、', '勝負！'],
     [('一番近い国旗を出した人が1点！', True)], ['jp', 'eg', 'br']),
    (('android-5-modal.png', 'ios-4-modal.png'),   ['出した国の', 'ことが分かる'],
     [('首都・気候・宗教まで丸わかり。', True)], ['ke', 'no', 'ar']),
    ((None, 'ios-5-zukan.png'),                    ['図鑑で', '世界を知る'],
     [('気になる国を、じっくり調べる。', True)], ['jp', 'br', 'ar']),
    ((None, 'ios-6-quiz.png'),                     ['ひとりで', '国旗クイズ'],
     [('10問・4択で腕だめし！', True)], ['eg', 'ke', 'no']),
]

def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def b64(path):
    return base64.b64encode(open(path, 'rb').read()).decode()

def png_size(path):
    import struct
    with open(path, 'rb') as f:
        return struct.unpack('>II', f.read(24)[16:24])

def build_svg(shot_path, head, desc, flags, index, W, H, status_bar_px=None):
    src_w, src_h = png_size(shot_path)
    if status_bar_px is None:   # 画面の上の状態表示（時刻など）の帯を切り落とす高さ
        status_bar_px = 150 if src_w == 1206 else 110 * src_w / 1080
    s = W / 1080.0
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}" viewBox="0 0 {W} {H}">']
    # ---- スマホの寸法（傾けて右寄せ）
    phone_w = 700 * s
    phone_h = 1400 * s
    phone_x = W - phone_w - 40 * s
    phone_y = 640 * s
    radius = 64 * s
    img_x, img_y, img_w = phone_x + 16 * s, phone_y + 16 * s, phone_w - 32 * s
    img_h_full = img_w * src_h / src_w
    img_dy = status_bar_px * (img_w / src_w)
    clip_h = phone_h - 32 * s
    tilt = -6
    cx, cy = phone_x + phone_w / 2, phone_y + phone_h / 2
    parts.append(f'''<defs>
  <pattern id="dots" width="{34*s}" height="{34*s}" patternUnits="userSpaceOnUse"><circle cx="{17*s}" cy="{17*s}" r="{2.2*s}" fill="{INK}" opacity=".09"/></pattern>
  <pattern id="stripes" width="{40*s}" height="{40*s}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="{14*s}" height="{40*s}" fill="#ffffff" opacity=".06"/></pattern>
  <clipPath id="screen"><rect x="{img_x}" y="{img_y}" width="{img_w}" height="{clip_h}" rx="{radius-16*s}" ry="{radius-16*s}"/></clipPath>
</defs>''')
    # ---- 背景: クリーム＋ドット、下半分は斜めの深緑（ストライプ入り）
    parts.append(f'<rect width="{W}" height="{H}" fill="{CREAM}"/><rect width="{W}" height="{H}" fill="url(#dots)"/>')
    parts.append(f'<polygon points="0,{H*0.62} {W},{H*0.47} {W},{H} 0,{H}" fill="{GREEN}"/>')
    parts.append(f'<polygon points="0,{H*0.62} {W},{H*0.47} {W},{H} 0,{H}" fill="url(#stripes)"/>')
    parts.append(f'<polygon points="0,{H*0.62-12*s} {W},{H*0.47-12*s} {W},{H*0.47} 0,{H*0.62}" fill="{INK}"/>')
    # 黄色の丸（差し色）
    parts.append(f'<circle cx="{W*0.92}" cy="{H*0.30}" r="{170*s}" fill="{YELLOW}" opacity=".9"/>')
    # ---- 左上ロゴ、右上ステップ番号
    parts.append(f'<g transform="translate({56*s} {56*s}) scale({2.6*s})"><path d="M3.5 17.5 5 8.5l4.6 3.6L12 5l2.4 7.1L19 8.5l1.5 9z" fill="{YELLOW}" stroke="{INK}" stroke-width="1.6" stroke-linejoin="round"/><rect x="3.5" y="17.5" width="17" height="3" rx="1" fill="{YELLOW}" stroke="{INK}" stroke-width="1.6"/></g>')
    parts.append(f'<text x="{132*s}" y="{104*s}" font-family="{FONT}" font-weight="900" font-size="{46*s}" fill="{INK}">地理王</text>')
    parts.append(f'<circle cx="{W-110*s}" cy="{100*s}" r="{58*s}" fill="{CARD}" stroke="{INK}" stroke-width="{6*s}"/>')
    parts.append(f'<text x="{W-110*s}" y="{124*s}" text-anchor="middle" font-family="{FONT}" font-weight="900" font-size="{64*s}" fill="{INK}">{index}</text>')
    # ---- 見出し: 左寄せの「ラベル札」を2枚、少し傾けて重ねる
    head_size = 132 * s
    y0 = 300 * s
    for i, line in enumerate(head):
        tw = len(line) * head_size * 0.96 + 60 * s
        x = 56 * s + i * 40 * s
        y = y0 + i * (head_size * 1.42)
        rot = -2.5 if i == 0 else 1.5
        color = CARD if i == 0 else YELLOW
        parts.append(f'<g transform="rotate({rot} {x+tw/2} {y})">'
                     f'<rect x="{x+14*s}" y="{y-head_size*0.86+14*s}" width="{tw}" height="{head_size*1.22}" rx="{22*s}" fill="{INK}"/>'
                     f'<rect x="{x}" y="{y-head_size*0.86}" width="{tw}" height="{head_size*1.22}" rx="{22*s}" fill="{color}" stroke="{INK}" stroke-width="{7*s}"/>'
                     f'<text x="{x+30*s}" y="{y+head_size*0.1}" font-family="{FONT}" font-weight="900" font-size="{head_size}" fill="{GREEN if i==0 else INK}">{esc(line)}</text></g>')
    # ---- スマホ（傾き）
    parts.append(f'<g transform="rotate({tilt} {cx} {cy})">')
    parts.append(f'<rect x="{phone_x+22*s}" y="{phone_y+22*s}" width="{phone_w}" height="{phone_h}" rx="{radius}" fill="{INK}" opacity=".35"/>')
    parts.append(f'<rect x="{phone_x}" y="{phone_y}" width="{phone_w}" height="{phone_h}" rx="{radius}" fill="{INK}"/>')
    parts.append(f'<g clip-path="url(#screen)"><rect x="{img_x}" y="{img_y}" width="{img_w}" height="{clip_h}" fill="{CREAM}"/>'
                 f'<image x="{img_x}" y="{img_y-img_dy}" width="{img_w}" height="{img_h_full}" xlink:href="data:image/png;base64,{b64(shot_path)}"/></g>')
    parts.append(f'<rect x="{cx-70*s}" y="{phone_y+24*s}" width="{140*s}" height="{22*s}" rx="{11*s}" fill="#0a120e"/>')
    parts.append('</g>')
    # ---- 国旗カードの扇（スマホの左下に重ねる）
    fan_x, fan_y = 70 * s, phone_y + phone_h - 300 * s
    for i, code in enumerate(flags):
        fp = os.path.join(HERE, 'flags', f'{code}.png')
        if not os.path.exists(fp):
            continue
        cw, ch = 260 * s, 174 * s
        rot = -18 + i * 14
        x = fan_x + i * 120 * s
        y = fan_y + abs(i - 1) * 26 * s
        parts.append(f'<g transform="rotate({rot} {x+cw/2} {y+ch})">'
                     f'<rect x="{x+10*s}" y="{y+10*s}" width="{cw}" height="{ch}" rx="{16*s}" fill="{INK}"/>'
                     f'<rect x="{x}" y="{y}" width="{cw}" height="{ch}" rx="{16*s}" fill="#fff" stroke="{INK}" stroke-width="{6*s}"/>'
                     f'<image x="{x+14*s}" y="{y+14*s}" width="{cw-28*s}" height="{ch-28*s}" preserveAspectRatio="none" xlink:href="data:image/png;base64,{b64(fp)}"/></g>')
    # ---- 説明の吹き出し（左下）
    fs = 50 * s
    bw, bh = W - 120 * s, fs * 1.6 * len(desc) + 90 * s
    bx, by = 60 * s, H - bh - 90 * s
    parts.append(f'<rect x="{bx+14*s}" y="{by+14*s}" width="{bw}" height="{bh}" rx="{28*s}" fill="{INK}"/>')
    parts.append(f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="{28*s}" fill="{CARD}" stroke="{INK}" stroke-width="{7*s}"/>')
    parts.append(f'<polygon points="{bx+150*s},{by-2*s} {bx+230*s},{by-2*s} {bx+165*s},{by-60*s}" fill="{CARD}" stroke="{INK}" stroke-width="{7*s}" stroke-linejoin="round"/>')
    parts.append(f'<rect x="{bx+152*s}" y="{by-6*s}" width="{76*s}" height="{14*s}" fill="{CARD}"/>')
    y = by + 78 * s
    for text, hl in desc:
        x = bx + 44 * s
        if hl:
            tw = len(text) * fs * 0.98
            parts.append(f'<rect x="{x-6*s}" y="{y-fs*0.35}" width="{tw+12*s}" height="{fs*0.55}" rx="{6*s}" fill="{YELLOW}"/>')
        parts.append(f'<text x="{x}" y="{y}" font-family="{FONT}" font-weight="{900 if hl else 800}" font-size="{fs}" fill="{INK}">{esc(text)}</text>')
        y += fs * 1.6
    parts.append('</svg>')
    return '\n'.join(parts)

def render(svg_text, out_png, W, H):
    # qlmanage は正方形キャンバスに描くので、S×S に中央配置してから切り出す
    S = max(W, H)
    inner = svg_text.replace('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"',
                             f'<svg x="{(S-W)/2}" y="{(S-H)/2}"', 1)
    outer = (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{S}" height="{S}" viewBox="0 0 {S} {S}">'
             f'<rect width="{S}" height="{S}" fill="{CREAM}"/>{inner}</svg>')
    tmp_svg = out_png.replace('.png', '.svg')
    open(tmp_svg, 'w', encoding='utf-8').write(outer)
    subprocess.run(['qlmanage', '-t', '-s', str(S), '-o', os.path.dirname(out_png), tmp_svg], capture_output=True)
    shutil.move(tmp_svg + '.png', out_png)
    subprocess.run(['sips', '-c', str(H), str(W), out_png], capture_output=True)
    os.remove(tmp_svg)

def main():
    import sys
    only = sys.argv[1] if len(sys.argv) > 1 else ''   # 'appstore' なら App Store 用だけ、'play' なら Play 用だけ
    os.makedirs(OUT, exist_ok=True)
    for i, (shots, head, desc, flags) in enumerate(FRAMES, 1):
        for tag, W, H in (('play', 1080, 2400), ('appstore', 1290, 2796), ('appstore65', 1284, 2778), ('appstore69', 1320, 2868)):
            if only and not tag.startswith(only):
                continue
            shot = shots[0] if tag == 'play' else shots[1]
            if shot is None:   # 図鑑・クイズ（5・6枚目）は App Store 用だけ
                continue
            src = os.path.join(HERE, shot)
            out = os.path.join(OUT, f'{tag}-{i}.png')
            render(build_svg(src, head, desc, flags, i, W, H), out, W, H)
            print('wrote', out)

if __name__ == '__main__':
    main()
