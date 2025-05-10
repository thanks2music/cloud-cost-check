#!/bin/bash

# Slack Webhookの読み込み
source "$(dirname "$0")/.env"

# 本日の日付を取得
TODAY=$(date +%Y-%m-%d)
YESTERDAY=$(date -v -1d +%Y-%m-%d) # macOS用、Linuxは `date -d 'yesterday'`

# 予算のしきい値（例：0.1ドル）
THRESHOLD=0.1

# AWS CLIで料金取得（昨日から今日までの合計）
COST=$(aws ce get-cost-and-usage \
  --time-period Start=$YESTERDAY,End=$TODAY \
  --granularity DAILY \
  --metrics "UnblendedCost" \
  --query 'ResultsByTime[0].Total.UnblendedCost.Amount' \
  --output text)

# 結果を整形
MESSAGE="📊 AWSコストチェック（$YESTERDAY）\n- 使用量: $COST USD"

# しきい値チェック
if (( $(echo "$COST > $THRESHOLD" | bc -l) )); then
  MESSAGE="$MESSAGE\n⚠️ しきい値（$THRESHOLD USD）を超えています！"
else
  MESSAGE="$MESSAGE\n✅ 無料枠内で問題ありません。"
fi

# Slack通知
curl -X POST -H 'Content-type: application/json' \
  --data "{\"text\":\"$MESSAGE\"}" \
  "$SLACK_WEBHOOK_URL"
