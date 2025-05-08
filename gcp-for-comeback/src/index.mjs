import { BudgetServiceClient } from "@google-cloud/billing-budgets";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

// Secretを取得する関数
async function getSecret(name) {
  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({
    name: `projects/gcp-cost-monitor/secrets/${name}/versions/latest`,
  });
  return version.payload.data.toString();
}

export async function checkGCPCosts(req, res) {
  console.log("コスト監視機能を開始します");

  // 環境変数の取得 (すべて Secret Manager を利用)
  let SLACK_WEBHOOK_URL, BILLING_ACCOUNT_ID, ACCOUNT_NAME;
  try {
    // 並列で複数のシークレットを取得
    [SLACK_WEBHOOK_URL, BILLING_ACCOUNT_ID, ACCOUNT_NAME] = await Promise.all([
      getSecret("gcp-cost-monitor-slack-webhook-url"),
      getSecret("gcp-cost-monitor-billing-account-id"),
      getSecret("gcp-cost-monitor-account-name"),
    ]);
    console.log("Secret Manager から設定を取得しました");
  } catch (error) {
    console.warn("Secret Manager からの取得に失敗しました:", error);
    // フォールバックとして環境変数を使用
    SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
    BILLING_ACCOUNT_ID = process.env.BILLING_ACCOUNT_ID;
    ACCOUNT_NAME = process.env.ACCOUNT_NAME;
    console.log("環境変数から設定を使用します");
  }

  // 他の環境変数を取得)
  const THRESHOLD = parseFloat(process.env.THRESHOLD || "0.1");

  console.log(`監視対象請求先アカウント: ${BILLING_ACCOUNT_ID}`);
  console.log(`しきい値: ${THRESHOLD} USD`);

  try {
    // 日付設定
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const formatDate = (date) => {
      return date.toISOString().split("T")[0];
    };

    console.log(`期間: ${formatDate(yesterday)} から ${formatDate(today)}`);

    // 予算情報とコスト情報の取得
    const budgetClient = new BudgetServiceClient();
    const parent = `billingAccounts/${BILLING_ACCOUNT_ID}`;

    console.log("予算情報を取得中...");
    const [budgets] = await budgetClient.listBudgets({ parent });

    if (budgets.length === 0) {
      const message = `❌ 請求先アカウント ${ACCOUNT_NAME} (${BILLING_ACCOUNT_ID}) に予算が設定されていません。`;
      console.warn(message);
      await sendSlackNotification(SLACK_WEBHOOK_URL, message);
      res.status(200).send("No budgets found");
      return;
    }

    console.log(`取得された予算数: ${budgets.length}`);

    // 各予算の実績コストを確認し、しきい値を超えるものを通知
    let hasExceededThreshold = false;
    let totalMessage = `📊 GCPコストチェック（${formatDate(yesterday)}）\n`;
    totalMessage += `- 対象アカウント: ${ACCOUNT_NAME}\n`;
    totalMessage += `- 請求先アカウントID: ${BILLING_ACCOUNT_ID}\n\n`;

    for (const budget of budgets) {
      // 予算情報の抽出
      const budgetName = budget.displayName || budget.name.split("/").pop();
      const budgetAmount = budget.amount?.specifiedAmount?.units || "N/A";
      const budgetCurrency =
        budget.amount?.specifiedAmount?.currencyCode || "USD";

      // 実績コストの抽出
      const actualSpend = budget.amount?.actualSpend;
      let cost = 0;

      if (actualSpend) {
        // units (整数部) と nanos (小数部) からコスト値を計算
        const units = actualSpend.units ? parseInt(actualSpend.units) : 0;
        const nanos = actualSpend.nanos ? actualSpend.nanos / 1_000_000_000 : 0;
        cost = units + nanos;
      }

      // 予算ごとのメッセージ
      const budgetMessage =
        `【${budgetName}】\n` +
        `- 予算額: ${budgetAmount} ${budgetCurrency}\n` +
        `- 使用量: ${cost.toFixed(6)} ${budgetCurrency}\n`;

      totalMessage += budgetMessage;

      // しきい値チェック
      if (cost > THRESHOLD) {
        hasExceededThreshold = true;
      }
    }

    // しきい値超過判定のメッセージ追加
    if (hasExceededThreshold) {
      totalMessage += `\n⚠️ しきい値（${THRESHOLD} USD）を超えている予算があります！`;
    } else {
      totalMessage += "\n✅ すべての予算がしきい値内で問題ありません。";
    }

    // Slackに通知
    console.log("Slackに通知を送信中...");
    await sendSlackNotification(SLACK_WEBHOOK_URL, totalMessage);

    console.log("処理が完了しました");
    res.status(200).send("Cost check completed successfully");
  } catch (error) {
    console.error("エラーが発生しました:", error);

    // エラーメッセージを構築
    const errorMessage = `❌ エラーが発生しました: ${error.message}`;

    // エラーをSlackに通知
    try {
      await sendSlackNotification(SLACK_WEBHOOK_URL, errorMessage);
    } catch (slackError) {
      console.error("Slack通知に失敗しました:", slackError);
    }

    res.status(500).send({ error: error.message });
  }
}

async function sendSlackNotification(webhookUrl, message) {
  console.log(`Slackに送信するメッセージ: ${message}`);

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

  console.log("Slack通知が成功しました");
  return response.status;
}
