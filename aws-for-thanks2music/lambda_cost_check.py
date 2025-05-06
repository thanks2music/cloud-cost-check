import json
import boto3
import os
from datetime import datetime, timedelta
import urllib3

def lambda_handler(event, context):
    # Slack Webhook URLを環境変数から取得
    SLACK_WEBHOOK_URL = os.environ.get('SLACK_WEBHOOK_URL')
    
    # しきい値を環境変数から取得（デフォルト: 0.1 USD）
    THRESHOLD = float(os.environ.get('THRESHOLD', '0.1'))
    
    # AWS Cost Explorerクライアントを作成
    ce_client = boto3.client('ce')
    
    # 日付の設定
    today = datetime.utcnow().date()
    yesterday = today - timedelta(days=1)
    
    # コストを取得
    try:
        response = ce_client.get_cost_and_usage(
            TimePeriod={
                'Start': yesterday.strftime('%Y-%m-%d'),
                'End': today.strftime('%Y-%m-%d')
            },
            Granularity='DAILY',
            Metrics=['UnblendedCost']
        )
        
        cost = float(response['ResultsByTime'][0]['Total']['UnblendedCost']['Amount'])
        
        # メッセージを作成
        message = f"📊 AWSコストチェック（{yesterday.strftime('%Y-%m-%d')}）\n"
        message += f"- 使用量: {cost:.6f} USD\n"
        
        # しきい値チェック
        if cost > THRESHOLD:
            message += f"⚠️ しきい値（{THRESHOLD} USD）を超えています！"
        else:
            message += "✅ 無料枠内で問題ありません。"
        
        # Slackに通知
        send_slack_notification(SLACK_WEBHOOK_URL, message)
        
        return {
            'statusCode': 200,
            'body': json.dumps('Cost check completed successfully')
        }
        
    except Exception as e:
        error_message = f"❌ エラーが発生しました: {str(e)}"
        send_slack_notification(SLACK_WEBHOOK_URL, error_message)
        
        return {
            'statusCode': 500,
            'body': json.dumps(f'Error: {str(e)}')
        }

def send_slack_notification(webhook_url, message):
    """Slackに通知を送信する関数"""
    http = urllib3.PoolManager()
    
    payload = {
        'text': message
    }
    
    encoded_data = json.dumps(payload).encode('utf-8')
    
    response = http.request(
        'POST',
        webhook_url,
        body=encoded_data,
        headers={'Content-Type': 'application/json'}
    )
    
    return response.status