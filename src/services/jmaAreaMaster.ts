import { logger } from "../utils/logger";
import { PREFECTURES, type RegionName } from "../data/prefectures";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

/**
 * 気象庁の警報・注意報API（{code}.json）で使われる予報区コードは、都道府県と
 * 必ずしも1対1ではない（例: 北海道は宗谷地方・上川地方など複数の予報区に分割）。
 * このモジュールは気象庁が公開しているエリアマスタ（非公式・無保証）を取得し、
 * 予報区コード → 都道府県 → 地方区分 のマッピングを動的に構築する。
 * ハードコードした対応表を持たないことで、気象庁側の予報区構成の変更にも追従できる。
 */

const AREA_MASTER_URL = "https://www.jma.go.jp/bosai/common/const/area.json";
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface JmaOfficeEntry {
  name: string;
  enName?: string;
  officeName?: string;
  parent?: string;
}

interface JmaAreaMaster {
  offices?: Record<string, JmaOfficeEntry>;
}

export interface OfficeRegionInfo {
  prefecture: string;
  region: RegionName;
  officeName: string;
}

// 複数の予報区に分割されている道県について、細分区域名からの正規化ルール。
const SUBAREA_TO_PREFECTURE: Array<{ keywords: string[]; prefecture: string }> = [
  {
    keywords: [
      "宗谷", "上川", "留萌", "石狩", "空知", "後志",
      "胆振", "日高", "渡島", "檜山", "オホーツク", "十勝", "釧路", "根室",
    ],
    prefecture: "北海道",
  },
  { keywords: ["沖縄本島", "大東島", "宮古島", "八重山"], prefecture: "沖縄県" },
  { keywords: ["奄美"], prefecture: "鹿児島県" },
];

function resolvePrefectureName(officeName: string): string | undefined {
  const exact = PREFECTURES.find((p) => p.name === officeName);
  if (exact) return exact.name;

  for (const rule of SUBAREA_TO_PREFECTURE) {
    if (rule.keywords.some((keyword) => officeName.includes(keyword))) {
      return rule.prefecture;
    }
  }
  return undefined;
}

let cachedMap: Map<string, OfficeRegionInfo> | null = null;

export async function loadJmaOfficeRegionMap(): Promise<Map<string, OfficeRegionInfo>> {
  const response = await fetchWithTimeout(AREA_MASTER_URL);
  if (!response.ok) {
    throw new Error(`気象庁エリアマスタの取得に失敗しました: HTTP ${response.status}`);
  }

  const data = (await response.json()) as JmaAreaMaster;
  const map = new Map<string, OfficeRegionInfo>();
  let unmapped = 0;

  for (const [code, office] of Object.entries(data.offices ?? {})) {
    const prefName = resolvePrefectureName(office.name);
    const pref = prefName ? PREFECTURES.find((p) => p.name === prefName) : undefined;
    if (!pref) {
      unmapped++;
      continue;
    }
    map.set(code, { prefecture: pref.name, region: pref.region, officeName: office.name });
  }

  if (map.size === 0) {
    throw new Error(
      "気象庁エリアマスタから予報区コードを1件もマッピングできませんでした。APIレスポンスの形式が変更された可能性があります。",
    );
  }

  logger.info(`気象庁エリアマスタを読み込みました（${map.size}件マッピング / ${unmapped}件未対応）`);
  cachedMap = map;
  return map;
}

export function getCachedOfficeRegionMap(): Map<string, OfficeRegionInfo> | null {
  return cachedMap;
}

/**
 * 天気予報API (forecast/data/forecast/{officeCode}.json) 用に、都道府県を代表する
 * 予報区コードを1件返す。北海道・沖縄県など複数の予報区に分割されている道県は、
 * 予報区名が都道府県名と完全一致するもの（＝道県全体を代表する主要予報区）を優先し、
 * 該当が無ければ最初に見つかった予報区にフォールバックする。
 */
export function getRepresentativeOfficeCode(prefectureName: string): string | undefined {
  if (!cachedMap) return undefined;

  let fallback: string | undefined;
  for (const [code, info] of cachedMap) {
    if (info.prefecture !== prefectureName) continue;
    if (info.officeName === prefectureName) return code;
    if (!fallback) fallback = code;
  }
  return fallback;
}

let refreshInterval: NodeJS.Timeout | null = null;

export function startAreaMasterRefresh(): void {
  loadJmaOfficeRegionMap().catch((error) =>
    logger.error("気象庁エリアマスタの初回取得に失敗しました。警報監視が開始できません。", error),
  );
  refreshInterval = setInterval(() => {
    loadJmaOfficeRegionMap().catch((error) => logger.error("気象庁エリアマスタの再取得に失敗しました。", error));
  }, REFRESH_INTERVAL_MS);
}

export function stopAreaMasterRefresh(): void {
  if (refreshInterval) clearInterval(refreshInterval);
}
