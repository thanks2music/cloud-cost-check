import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from "@aws-sdk/client-cost-explorer";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

export const handler = async (event) => {
  // 環境変数の取得
  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
  const THRESHOLD = parseFloat(process.env.THRESHOLD || "0.1");

  // AWS Cost Explorerクライアントを作成
  const client = new CostExplorerClient({ region: "us-east-1" });

  // 日付の設定（date-fnsを使わずに）
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  // YYYY-MM-DD形式にフォーマット
  const formatDate = (date) => {
    return date.toISOString().split("T")[0];
  };

  try {
    // アカウント情報を取得
    const stsCommand = new GetCallerIdentityCommand({});
    const stsResponse = await stsClient.send(stsCommand);
    const accountId = stsResponse.Account;

    // アカウント名の設定（オプションで環境変数から取得も可能）
    const accountName =
      process.env.ACCOUNT_NAME || `AWS Account (${accountId})`;

    // コストを取得
    const command = new GetCostAndUsageCommand({
      TimePeriod: {
        Start: formatDate(yesterday),
        End: formatDate(today),
      },
      Granularity: "DAILY",
      Metrics: ["UnblendedCost"],
    });

    const response = await client.send(command);
    const cost = parseFloat(
      response.ResultsByTime[0].Total.UnblendedCost.Amount
    );

    // メッセージを作成
    let message = `📊 AWSコストチェック（${formatDate(yesterday)}）\n`;
    message += `- 対象アカウント: ${accountName}\n`;
    message += `- 使用量: ${cost.toFixed(6)} USD\n`;

    // しきい値チェック
    if (cost > THRESHOLD) {
      message += `⚠️ しきい値（${THRESHOLD} USD）を超えています！`;
    } else {
      message += "✅ 無料枠内で問題ありません。";
    }

    // Slackに通知
    await sendSlackNotification(SLACK_WEBHOOK_URL, message);

    return {
      statusCode: 200,
      body: JSON.stringify("Cost check completed successfully"),
    };
  } catch (error) {
    const errorMessage = `❌ エラーが発生しました: ${error.message}`;

    // エラーをSlackに通知
    try {
      await sendSlackNotification(SLACK_WEBHOOK_URL, errorMessage);
    } catch (slackError) {
      console.error("Slack notification failed:", slackError);
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

async function sendSlackNotification(webhookUrl, message) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: message,
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack API returned ${response.status}`);
  }

  return response.status;
}
