// index.js
import { CloudBillingClient } from "@google-cloud/billing";
import { GoogleAuth } from "google-auth-library";

export async function checkGCPCosts(req, res) {
  // 環境変数の取得
  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
  const THRESHOLD = parseFloat(process.env.THRESHOLD || "0.1");
  const PROJECT_ID = process.env.PROJECT_ID;
  const PROJECT_NAME = process.env.PROJECT_NAME || PROJECT_ID;

  try {
    // 認証設定
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    // Cloud Billing クライアントを作成
    const billingClient = new CloudBillingClient();

    // 日付の設定
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    // 日付フォーマット関数
    const formatDate = (date) => {
      return date.toISOString().split("T")[0];
    };

    // プロジェクト名の取得
    const projectName = PROJECT_NAME || `GCP Project (${PROJECT_ID})`;

    // Billing API を使ってコストを取得
    const [response] = await billingClient.getBillingInfo({
      name: `projects/${PROJECT_ID}`,
    });

    const billingAccount = response.billingAccountName;

    // 課金アカウントからコスト情報を取得
    const [costInfo] = await billingClient.getBillingAccountCosts({
      name: billingAccount,
      options: {
        startTime: {
          seconds: Math.floor(yesterday.getTime() / 1000),
          nanos: 0,
        },
        endTime: {
          seconds: Math.floor(today.getTime() / 1000),
          nanos: 0,
        },
      },
    });

    // 前日のコストを取得
    const cost = parseFloat(costInfo.costAmount.amount);

    // メッセージを作成
    let message = `📊 GCPコストチェック（${formatDate(yesterday)}）\n`;
    message += `- 対象プロジェクト: ${projectName}\n`;
    message += `- 使用量: ${cost.toFixed(6)} USD\n`;

    // しきい値チェック
    if (cost > THRESHOLD) {
      message += `⚠️ しきい値（${THRESHOLD} USD）を超えています！`;
    } else {
      message += "✅ 予算内で問題ありません。";
    }

    // Slackに通知
    await sendSlackNotification(SLACK_WEBHOOK_URL, message);

    res.status(200).send("Cost check completed successfully");
  } catch (error) {
    const errorMessage = `❌ エラーが発生しました: ${error.message}`;

    // エラーをSlackに通知
    try {
      await sendSlackNotification(SLACK_WEBHOOK_URL, errorMessage);
    } catch (slackError) {
      console.error("Slack notification failed:", slackError);
    }

    res.status(500).send({ error: error.message });
  }
}

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
