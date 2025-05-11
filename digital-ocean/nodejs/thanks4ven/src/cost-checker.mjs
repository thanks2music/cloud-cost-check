import axios from "axios";
import { DateTime } from "luxon";
import dotenv from "dotenv";
dotenv.config();

// 環境変数の取得
const DO_API_TOKEN = process.env.DO_API_TOKEN;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const THRESHOLD = parseFloat(process.env.DO_COST_THRESHOLD || "0.1");
const ACCOUNT_NAME = process.env.DO_ACCOUNT_NAME || "DigitalOcean Account";

// エラーが発生した場合にプロセスを終了せずエラー内容を返す関数
const handleError = async (message, error) => {
  console.error(`${message}: ${error.message}`);

  if (error.response) {
    console.error(
      `Status: ${error.response.status}, Data:`,
      error.response.data
    );
  }

  try {
    await sendSlackNotification(
      `❌ *エラー: ${message}*\n\`\`\`${error.message}\`\`\``
    );
  } catch (slackError) {
    console.error(`Slack通知エラー: ${slackError.message}`);
  }
};

// Slackに通知を送信する関数
async function sendSlackNotification(message) {
  console.log("Slack通知を送信します:", message.substring(0, 100) + "...");

  try {
    const response = await axios.post(SLACK_WEBHOOK_URL, { text: message });
    console.log(`Slack通知送信成功: ${response.status}`);
    return response;
  } catch (error) {
    console.error(`Slack通知送信失敗: ${error.message}`);
    throw error;
  }
}

// DigitalOcean APIクライアント
const doClient = axios.create({
  baseURL: "https://api.digitalocean.com/v2",
  headers: {
    Authorization: `Bearer ${DO_API_TOKEN}`,
    "Content-Type": "application/json",
  },
  timeout: 10000, // 10秒タイムアウト
});

// ドロップレットサイズに基づく時間単価の取得（概算）
function getDropletHourlyPrice(sizeSlug) {
  // 一般的なサイズの時間単価（2023年時点の概算、実際の価格は変動します）
  const prices = {
    "s-1vcpu-1gb": 0.007, // $5/月
    "s-1vcpu-2gb": 0.015, // $10/月
    "s-2vcpu-2gb": 0.022, // $15/月
    "s-2vcpu-4gb": 0.03, // $20/月
    "s-4vcpu-8gb": 0.06, // $40/月
    // その他サイズは必要に応じて追加
  };

  return prices[sizeSlug] || 0.007; // 不明なサイズは最小価格で計算
}

// リソースに基づいて日次コスト概算を計算
function calculateDailyCost(droplets, databases, volumes) {
  // ドロップレットのコスト計算
  const dropletCost = droplets.reduce((total, droplet) => {
    const hourlyPrice = getDropletHourlyPrice(droplet.size_slug);
    return total + hourlyPrice * 24; // 1日分
  }, 0);

  // ボリュームのコスト計算（$0.10/GB/月として概算）
  const volumeCost = volumes.reduce((total, volume) => {
    return total + (volume.size_gigabytes * 0.1) / 30; // 月額を日割り
  }, 0);

  // データベースのコスト計算（簡易概算）
  const databaseCost = databases.reduce((total, db) => {
    // データベースサイズによって価格設定
    // これは概算なので、実際の料金は確認が必要
    return total + 15 / 30; // 最小$15/月を日割り
  }, 0);

  return {
    total: parseFloat((dropletCost + volumeCost + databaseCost).toFixed(6)),
    breakdown: {
      droplets: parseFloat(dropletCost.toFixed(6)),
      volumes: parseFloat(volumeCost.toFixed(6)),
      databases: parseFloat(databaseCost.toFixed(6)),
    },
  };
}

// コスト情報をフォーマットしてSlackに送信
async function sendCostReport(costInfo, accountName, threshold) {
  const { date, estimatedDailyCost, resources } = costInfo;

  // メッセージの作成
  let message = `📊 *DigitalOceanコストチェック（${date}）*\n`;
  message += `- 対象アカウント: ${accountName}\n`;
  message += `- 推定日次コスト: *${estimatedDailyCost.total}* USD\n\n`;

  // コスト内訳
  message += `*【コスト内訳】*\n`;
  message += `- Droplets: ${estimatedDailyCost.breakdown.droplets} USD\n`;
  message += `- Volumes: ${estimatedDailyCost.breakdown.volumes} USD\n`;
  message += `- Databases: ${estimatedDailyCost.breakdown.databases} USD\n\n`;

  // リソース情報
  message += `*【リソース一覧】*\n`;
  message += `- Droplets: ${resources.droplets.count}個\n`;
  message += `- Databases: ${resources.databases.count}個\n`;
  message += `- Volumes: ${resources.volumes.count}個 (合計${
    resources.volumes.totalSizeGb || 0
  }GB)\n\n`;

  // しきい値チェック
  if (estimatedDailyCost.total > threshold) {
    message += `⚠️ *警告: しきい値（${threshold} USD）を超過しています！*\n`;

    // コスト削減提案
    message += `\n*【コスト削減案】*\n`;
    message += `- 未使用リソースの削除\n`;
    message += `- ドロップレットサイズのダウングレード\n`;
    message += `- リザーブドリソースの検討\n`;
  } else {
    message += `✅ コストは閾値（${threshold} USD）以内に収まっています。\n`;
  }

  // Dropletの詳細情報（3つまで表示）
  if (resources.droplets.count > 0) {
    message += `\n*【Droplet詳細】*\n`;
    resources.droplets.items.slice(0, 3).forEach((droplet) => {
      message += `- ${droplet.name}: ${droplet.size} (${droplet.region}) - ${(
        droplet.hourlyPrice * 24
      ).toFixed(4)}/日\n`;
    });

    if (resources.droplets.count > 3) {
      message += `他 ${resources.droplets.count - 3} 個のDroplet...\n`;
    }
  }

  await sendSlackNotification(message);
}

// メイン関数
async function checkCosts() {
  console.log("コスト監視を開始します");

  try {
    // APIトークンの確認
    if (!DO_API_TOKEN) {
      throw new Error("DO_API_TOKENが設定されていません");
    }

    if (!SLACK_WEBHOOK_URL) {
      throw new Error("SLACK_WEBHOOK_URLが設定されていません");
    }

    // 昨日の日付
    const yesterday = DateTime.now().minus({ days: 1 });
    const formattedDate = yesterday.toFormat("yyyy-MM-dd");

    console.log(`${formattedDate}の課金情報を取得中...`);

    // 各リソースの取得（リソースごとに遅延を入れてレート制限を回避）
    console.log("Dropletsを取得中...");
    const dropletsResponse = await doClient.get("/droplets");
    await new Promise((resolve) => setTimeout(resolve, 500)); // APIレート制限を回避するための遅延

    console.log("Databasesを取得中...");
    const databasesResponse = await doClient.get("/databases");
    await new Promise((resolve) => setTimeout(resolve, 500));

    console.log("Volumesを取得中...");
    const volumesResponse = await doClient.get("/volumes");
    await new Promise((resolve) => setTimeout(resolve, 500));

    // コストの概算用にデータを整形
    const droplets = dropletsResponse.data.droplets || [];
    const databases = databasesResponse.data.databases || [];
    const volumes = volumesResponse.data.volumes || [];

    // 日次のコスト概算を計算
    const estimatedDailyCost = calculateDailyCost(droplets, databases, volumes);

    // リソース情報の整形
    const resources = {
      droplets: {
        count: droplets.length,
        items: droplets.map((d) => ({
          id: d.id,
          name: d.name,
          size: d.size_slug,
          region: d.region.slug,
          hourlyPrice: getDropletHourlyPrice(d.size_slug),
        })),
      },
      databases: {
        count: databases.length,
      },
      volumes: {
        count: volumes.length,
        totalSizeGb: volumes.reduce((sum, vol) => sum + vol.size_gigabytes, 0),
      },
    };

    // コスト情報をまとめる
    const costInfo = {
      date: formattedDate,
      estimatedDailyCost,
      resources,
    };

    // Slackに通知
    await sendCostReport(costInfo, ACCOUNT_NAME, THRESHOLD);

    console.log("コスト監視が完了しました");
    return {
      success: true,
      date: costInfo.date,
      cost: costInfo.estimatedDailyCost.total,
    };
  } catch (error) {
    await handleError("コスト監視でエラーが発生しました", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// スクリプト実行
checkCosts()
  .then((result) => {
    if (result.success) {
      console.log(
        `コスト監視が成功しました: ${result.date}, コスト: ${result.cost}`
      );
      process.exit(0);
    } else {
      console.error(`コスト監視が失敗しました: ${result.error}`);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(`予期しないエラーが発生しました: ${err.message}`);
    process.exit(1);
  });
