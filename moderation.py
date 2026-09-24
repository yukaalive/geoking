# -*- coding: utf-8 -*-
"""チャット・名前の安全対策（フィルタ）。
   - NGワード（日本語・英語の侮辱・差別・性的・暴力表現、出会い/勧誘）
   - URL・メールアドレス・電話番号など、個人情報や外部誘導につながる文字列
   - 同じ文字の連打、長すぎる文字列
   判定は正規化（全角→半角、大文字→小文字、記号・空白の除去、カタカナ→ひらがな）してから行うので、
   「バ.カ」「ＢＡＫＡ」「ｂａｋａ」のような回避も拾う。
   ※ 完全ではありません。通報・ミュート・自動ミュートと組み合わせて運用します。
"""
import re
import unicodedata

# 侮辱・罵倒・差別・性的・暴力・自傷・出会い/勧誘（部分一致）。追加・削除はこのリストを編集
NG_WORDS = [
    # 侮辱・罵倒
    'ばか', 'あほ', 'しね', 'ころす', 'ころして', 'きえろ', 'うざい', 'うぜえ', 'きもい', 'きしょい', 'くず', 'ごみ', 'ぶす', 'ぶた',
    'でぶ', 'はげ', 'ちび', 'まぬけ', 'のろま', 'くたばれ', 'だまれ', 'ざこ', 'かす', 'くそ', 'ぼけ', 'やろう',
    'しょうがい', 'がいじ', 'きちがい', 'いかれ', 'せいしんびょう', 'ちしょう', 'つんぼ', 'めくら', 'びっこ',
    # 差別
    'ちょん', 'ちゃんころ', 'くろんぼ', 'えた', 'ひにん', 'ぶらく', 'ざいにち', 'がいじん', 'にがー', 'にぐろ',
    # 性的
    'せっくす', 'えっち', 'えろ', 'ちんこ', 'ちんぽ', 'まんこ', 'おっぱい', 'ちくび', 'せいこう', 'おなにー', 'れいぷ', 'ごうかん',
    'ぱんつ', 'ぬーど', 'はだか', 'ぽるの', 'あだると', 'えんこう', 'ぱぱかつ', 'うりせん', 'ふうぞく',
    # 暴力・自傷
    'しにたい', 'じさつ', 'ころしてやる', 'なぐる', 'ばくは', 'てろ',
    # 出会い・勧誘・詐欺
    'らいん', 'かかおとーく', 'でぃすこーど', 'てれぐらむ', 'いんすた', 'ついった', 'ふぉろー', 'あいでぃー', 'あいでぃ',
    'ともだちぼしゅう', 'あって', 'あおう', 'あおうよ', 'かねかせぐ', 'もうかる', 'ふくぎょう', 'とうし', 'かせげる',
    # ローマ字（日本語の回避）
    'baka', 'aho', 'shine', 'kuso', 'busu', 'debu', 'hage', 'manko', 'chinko', 'chinpo', 'unko', 'kimoi', 'uzai',
    # 英語
    'fuck', 'shit', 'bitch', 'asshole', 'dick', 'pussy', 'cunt', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut',
    'sex', 'porn', 'nude', 'rape', 'kill yourself', 'kys', 'kill you', 'die', 'stfu', 'wtf', 'motherfucker',
    'kik', 'snapchat', 'onlyfans', 'telegram', 'whatsapp', 'line', 'discord', 'insta', 'instagram', 'twitter', 'tiktok', 'kakao',
]
# 半角英字の単語は「英字の並びの一部」でなければ一致（Caroline の line は無視、LINE交換 の line は検出）
_LATIN = re.compile(r'^[a-z ]+$')

# 正規表現で拾うもの
PATTERNS = [
    re.compile(r'https?://|www\.|\.com\b|\.jp\b|\.net\b|\.org\b|\.io\b|\.me\b', re.I),           # URL・ドメイン
    re.compile(r'[\w.+-]+@[\w-]+\.[\w.]+'),                                                       # メールアドレス
    re.compile(r'(?<!\d)(?:0\d{1,4}[-\s()]?\d{1,4}[-\s()]?\d{3,4})(?!\d)'),                       # 電話番号（日本）
    re.compile(r'(?<!\d)\d{10,}(?!\d)'),                                                           # 10桁以上の数字列
    re.compile(r'(.)\1{7,}'),                                                                      # 同じ文字の8連打以上
    re.compile(r'@[A-Za-z0-9_]{3,}'),                                                              # SNSのID
]

_KATA_TO_HIRA = {chr(k): chr(k - 0x60) for k in range(0x30A1, 0x30F7)}   # ァ..ヶ → ぁ..ゖ


def normalize(text: str) -> str:
    """判定用に文字列をならす。全角→半角、小文字化、カタカナ→ひらがな、空白・記号・長音・濁点分離を除去。"""
    t = unicodedata.normalize('NFKC', text or '').lower()
    t = ''.join(_KATA_TO_HIRA.get(ch, ch) for ch in t)
    t = re.sub(r'[\s\W_ー〜~]+', '', t)       # 記号・空白・長音
    t = re.sub(r'[゛゜]', '', t)
    return t


def find_ng(text: str):
    """NGに該当する理由を返す。問題なければ None。"""
    raw = text or ''
    for pat in PATTERNS:
        if pat.search(raw):
            return 'link_or_personal'
    n = normalize(raw)
    low = unicodedata.normalize('NFKC', raw).lower()
    for w in NG_WORDS:
        if _LATIN.match(w):
            if re.search(r'(?<![a-z])' + re.escape(w.replace(' ', '')) + r'(?![a-z])', low.replace(' ', '')):
                return 'ng_word'
        elif normalize(w) in n:
            return 'ng_word'
    return None


REASON_TEXT = {
    'ng_word': '不適切な表現が含まれているため送信できません',
    'link_or_personal': 'URL・連絡先・IDなどは送信できません',
}


def check_chat(text: str):
    """チャット本文のチェック。(ok, message) を返す。"""
    if not text or not text.strip():
        return False, '空のメッセージです', 'chat_empty'
    if len(text) > 80:
        return False, 'メッセージが長すぎます（80文字まで）', 'chat_long'
    reason = find_ng(text)
    if reason:
        return False, REASON_TEXT[reason], reason
    return True, '', None


def check_name(name: str):
    """ニックネーム・部屋名のチェック。"""
    if not name:
        return False, '名前を入力してください', 'name_empty'
    reason = find_ng(name)
    if reason:
        return False, 'その名前は使えません（不適切な表現や連絡先を含みます）', 'name_bad'
    return True, '', None
