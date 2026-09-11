/**
 * 気象庁 警報・注意報コード対応表。
 *
 * 気象庁の警報・注意報 JSON（非公式・無保証の一般公開エンドポイント）は、各予報区の
 * 発表状況を数値コードのみで返し、コードと名称の対応表は別途公開されていない。
 * 以下は気象庁の発表資料・各種オープンソース実装を参照して作成した対応表である。
 *
 * コード体系には以下の規則性があるため、表に無いコードが増えても種別だけは判定できる。
 * 気象庁側でコードが追加されたときに「表に無いから通知しない」という取りこぼしが
 * 起きないよう、表に無いコードは inferTierFromCode() で数値帯から種別を推定する。
 *
 *   01〜09 … 警報（警戒レベル3相当。00 は「発表なし」を表す）
 *   10〜29 … 注意報（警戒レベル2相当）
 *   30〜39 … 特別警報（警戒レベル5相当）
 */

export type WarningTier = "special" | "warning" | "advisory";

export interface WarningCodeInfo {
  code: string;
  name: string;
  tier: WarningTier;
  /** 気象庁の警戒レベル相当情報（注意報=2 / 警報=3 / 特別警報=5）。 */
  level: WarningLevel;
}

export type WarningLevel = 2 | 3 | 5;

/** 種別ごとの警戒レベル相当情報。 */
export const WARNING_TIER_LEVEL: Record<WarningTier, WarningLevel> = {
  advisory: 2,
  warning: 3,
  special: 5,
};

/**
 * 自動通知の対象とする警戒レベルの下限。
 * 警報（レベル3）・特別警報（レベル5）のみを通知し、注意報（レベル2）は通知しない。
 */
export const NOTIFY_MIN_LEVEL: WarningLevel = 3;

/** コードと名称・種別の対応表。level は tier から自動的に決まるため持たせない。 */
const WARNING_NAME_TABLE: Record<string, { name: string; tier: WarningTier }> = {
  // 警報（警戒レベル3相当）
  "02": { name: "暴風雪警報", tier: "warning" },
  "03": { name: "大雨警報", tier: "warning" },
  "04": { name: "洪水警報", tier: "warning" },
  "05": { name: "暴風警報", tier: "warning" },
  "06": { name: "大雪警報", tier: "warning" },
  "07": { name: "波浪警報", tier: "warning" },
  "08": { name: "高潮警報", tier: "warning" },
  // 注意報（警戒レベル2相当）
  "10": { name: "大雨注意報", tier: "advisory" },
  "12": { name: "大雪注意報", tier: "advisory" },
  "13": { name: "風雪注意報", tier: "advisory" },
  "14": { name: "雷注意報", tier: "advisory" },
  "15": { name: "強風注意報", tier: "advisory" },
  "16": { name: "波浪注意報", tier: "advisory" },
  "17": { name: "融雪注意報", tier: "advisory" },
  "18": { name: "洪水注意報", tier: "advisory" },
  "19": { name: "高潮注意報", tier: "advisory" },
  "20": { name: "濃霧注意報", tier: "advisory" },
  "21": { name: "乾燥注意報", tier: "advisory" },
  "22": { name: "なだれ注意報", tier: "advisory" },
  "23": { name: "低温注意報", tier: "advisory" },
  "24": { name: "霜注意報", tier: "advisory" },
  "25": { name: "着氷注意報", tier: "advisory" },
  "26": { name: "着雪注意報", tier: "advisory" },
  "27": { name: "その他の注意報", tier: "advisory" },
  // 特別警報（警戒レベル5相当）
  "32": { name: "暴風雪特別警報", tier: "special" },
  "33": { name: "大雨特別警報", tier: "special" },
  "35": { name: "大雪特別警報", tier: "special" },
  "36": { name: "暴風特別警報", tier: "special" },
  "37": { name: "波浪特別警報", tier: "special" },
  "38": { name: "高潮特別警報", tier: "special" },
};

/**
 * 発表状況なし・解除を表すコード。警報・注意報が一つも発表されていないエリアでは
 * `{"code":"00", "status":"発表警報・注意報はなし"}` のような形で返ってくる。
 */
const NO_WARNING_CODES = new Set(["00", ""]);

const WARNING_TIER_SUFFIX: Record<WarningTier, string> = {
  special: "特別警報",
  warning: "警報",
  advisory: "注意報",
};

/**
 * 対応表に無いコードの種別を、コードの数値帯から推定する。
 * 気象庁がコードを追加した場合でも、警報・特別警報を取りこぼさないための保険。
 */
function inferTierFromCode(code: string): WarningTier | undefined {
  if (!/^\d+$/.test(code)) return undefined;

  const value = Number(code);
  if (value >= 1 && value <= 9) return "warning";
  if (value >= 10 && value <= 29) return "advisory";
  if (value >= 30 && value <= 39) return "special";
  return undefined;
}

export function describeWarningCode(code: string): WarningCodeInfo {
  const known = WARNING_NAME_TABLE[code];
  if (known) {
    return { code, name: known.name, tier: known.tier, level: WARNING_TIER_LEVEL[known.tier] };
  }

  // 表に無いコードでも、数値帯から種別が分かる場合は種別相当として扱う（取りこぼし防止）。
  const inferred = inferTierFromCode(code);
  const tier = inferred ?? "advisory";
  const name = inferred
    ? `${WARNING_TIER_SUFFIX[inferred]}（コード${code}）`
    : `不明な警報コード(${code})`;

  return { code, name, tier, level: WARNING_TIER_LEVEL[tier] };
}

/** 対応表にも数値帯のルールにも当てはまらない未知コードかどうか（ログ通知用）。 */
export function isUnknownWarningCode(code: string): boolean {
  return !WARNING_NAME_TABLE[code] && inferTierFromCode(code) === undefined;
}

/** 「発表なし」「解除」を表すコードかどうか。 */
export function isNoWarningCode(code: string): boolean {
  return NO_WARNING_CODES.has(code);
}

/**
 * 自動通知の対象とするコードかどうか。
 * 警戒レベル3（警報）以上、すなわち警報・特別警報のみを通知対象とする。
 */
export function shouldNotify(code: string): boolean {
  if (isNoWarningCode(code)) return false;
  return describeWarningCode(code).level >= NOTIFY_MIN_LEVEL;
}
