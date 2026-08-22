/**
 * 気象庁 警報・注意報コード対応表。
 *
 * 気象庁の警報・注意報 JSON（非公式・無保証の一般公開エンドポイント）は、各予報区の
 * 発表状況を数値コードのみで返し、コードと名称の対応表は別途公開されていない。
 * 以下は各種オープンソース実装や気象庁の発表基準資料を参照して作成した対応表であり、
 * 気象庁の仕様変更によりコード体系が変わる可能性がある。運用開始前に、実際のAPIレスポンス
 * と照らし合わせて内容を確認・調整することを推奨する。
 */

export type WarningTier = "special" | "warning" | "advisory";

export interface WarningCodeInfo {
  code: string;
  name: string;
  tier: WarningTier;
}

export const WARNING_CODE_TABLE: Record<string, WarningCodeInfo> = {
  // 警報
  "02": { code: "02", name: "暴風雪警報", tier: "warning" },
  "03": { code: "03", name: "大雨警報", tier: "warning" },
  "04": { code: "04", name: "洪水警報", tier: "warning" },
  "05": { code: "05", name: "暴風警報", tier: "warning" },
  "06": { code: "06", name: "大雪警報", tier: "warning" },
  "07": { code: "07", name: "波浪警報", tier: "warning" },
  "08": { code: "08", name: "高潮警報", tier: "warning" },
  // 注意報
  "09": { code: "09", name: "大雨注意報", tier: "advisory" },
  "10": { code: "10", name: "大雪注意報", tier: "advisory" },
  "11": { code: "11", name: "風雪注意報", tier: "advisory" },
  "12": { code: "12", name: "強風注意報", tier: "advisory" },
  "13": { code: "13", name: "波浪注意報", tier: "advisory" },
  "14": { code: "14", name: "洪水注意報", tier: "advisory" },
  "15": { code: "15", name: "高潮注意報", tier: "advisory" },
  "16": { code: "16", name: "濃霧注意報", tier: "advisory" },
  "17": { code: "17", name: "雷注意報", tier: "advisory" },
  "18": { code: "18", name: "乾燥注意報", tier: "advisory" },
  "19": { code: "19", name: "なだれ注意報", tier: "advisory" },
  "20": { code: "20", name: "低温注意報", tier: "advisory" },
  "21": { code: "21", name: "霜注意報", tier: "advisory" },
  "22": { code: "22", name: "着氷注意報", tier: "advisory" },
  "23": { code: "23", name: "着雪注意報", tier: "advisory" },
  "24": { code: "24", name: "融雪注意報", tier: "advisory" },
  // 特別警報
  "32": { code: "32", name: "大雨特別警報", tier: "special" },
  "33": { code: "33", name: "暴風特別警報", tier: "special" },
  "34": { code: "34", name: "暴風雪特別警報", tier: "special" },
  "35": { code: "35", name: "大雪特別警報", tier: "special" },
  "36": { code: "36", name: "波浪特別警報", tier: "special" },
  "37": { code: "37", name: "高潮特別警報", tier: "special" },
};

/**
 * 通知対象とする注意報コード。
 * 「特別警報」「警報」は tier で全件通知するため、ここには含めない。
 * 乾燥注意報・濃霧注意報など緊急性の低いものは意図的に含めていない。
 */
export const NOTIFY_ADVISORY_CODES = new Set<string>([
  "17", // 雷注意報
]);

export function shouldNotify(code: string): boolean {
  const info = WARNING_CODE_TABLE[code];
  if (!info) return false;
  if (info.tier === "special" || info.tier === "warning") return true;
  return NOTIFY_ADVISORY_CODES.has(code);
}

export function describeWarningCode(code: string): WarningCodeInfo {
  return WARNING_CODE_TABLE[code] ?? { code, name: `不明な警報コード(${code})`, tier: "advisory" };
}
