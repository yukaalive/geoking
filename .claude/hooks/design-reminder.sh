#!/bin/bash
# ユーザーが案・検討・配置・機能の相談をしたとき、geoking-design スキル（オブジェクト指向 × ユーザー目線）を Claude に思い出させる。
# UserPromptSubmit から呼ばれる。当てはまらない依頼では何も出さない。
p=$(jq -r '.prompt // empty')
if printf '%s' "$p" | grep -Eq '案|提案|検討|考えて|どうしたら|どうすれば|いいですか|配置|レイアウト|アイデア|機能|仕様|ルール|説明|ボタン|画面|表示'; then
  msg="このプロジェクトでは必ずオブジェクト指向（画面に出る「もの」から考え、操作や説明はそのもののそばに置く）とユーザー目線（はじめての人・ホスト・いつもの人・観戦・ひとり・英語・320px）で考える。案や配置・機能の相談なら geoking-design スキルに従って案A/B/C を比べて出し、ユーザーが選んでから geoking-ui-change の手順で作る。"
  jq -n --arg m "$msg" '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $m}}'
fi
exit 0
