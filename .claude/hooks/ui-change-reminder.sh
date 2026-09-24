#!/bin/bash
# 画面のファイル（static/ の HTML・CSS・JS）や server.py を編集したとき、確認の手順を Claude に思い出させる。
# PostToolUse（Edit / Write / MultiEdit）から呼ばれる。ほかのファイルでは何も出さない。
f=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
case "$f" in
  */static/*.html|*/static/*.css|*/static/*.js)
    msg="画面のファイル（${f##*/}）を変えました。geoking-ui-change スキルの手順で、報告の前に layoutCompare('before')（変更前後の比較。頼まれた所以外が変わっていないか）と tests/layout_check.js を流すこと。画面移動・native.js・sfx.js に関わるなら tests/app_frame_check.js も。頼まれていない見た目の変更は入れない。" ;;
  */server.py)
    msg="server.py を変えました。確認用サーバー（geoking-check）を立て直し、tests/e2e_two_players.py と tests/e2e_solo_bot.py を流してから報告すること。画面の動きが変わるなら geoking-ui-change スキルの確認も。" ;;
  *) exit 0 ;;
esac
jq -n --arg m "$msg" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $m}}'
