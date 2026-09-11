import { isShuttingDown, onShutdown, scheduleInterval, shutdownSignal } from "../lifecycle";
import { PREFECTURES, type RegionName } from "../data/prefectures";
import { fetchJson } from "../utils/http";
import { logger } from "../utils/logger";
import { DAY_MS, MINUTE_MS, SECOND_MS } from "../utils/time";

/**
 * 気象庁の警報・注意報API（{code}.json）で使われる予報区コードは、都道府県と
 * 必ずしも1対1ではない（例: 北海道は宗谷地方・上川地方など複数の予報区に分割）。
 * このモジュールは気象庁が公開しているエリアマスタ（非公式・無保証）を取得し、
 * 予報区コード → 都道府県 → 地方区分 のマッピングを動的に構築する。
 * ハードコードした対応表を持たないことで、気象庁側の予報区構成の変更にも追従できる。
 */

const AREA_MASTER_URL = "https://www.jma.go.jp/bosai/common/const/area.json";
const REFRESH_INTERVAL_MS = DAY_MS;
/**
 * 取得に失敗したときの再試行間隔（指数バックオフ）。
 * エリアマスタが無いと警報監視は1件もチェックできないため、次の定期取得（24時間後）まで
 * 待っていると丸一日通知が止まる。起動直後にネットワークが未確立だった場合などに備え、
 * 成功するまで短い間隔で再試行する。
 */
const RETRY_BASE_DELAY_MS = 30 * SECOND_MS;
const RETRY_MAX_DELAY_MS = 10 * MINUTE_MS;

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

function resolvePrefecture(officeName: string): (typeof PREFECTURES)[number] | undefined {
  const exact = PREFECTURES.find((p) => p.name === officeName);
  if (exact) return exact;

  for (const rule of SUBAREA_TO_PREFECTURE) {
    if (rule.keywords.some((keyword) => officeName.includes(keyword))) {
      return PREFECTURES.find((p) => p.name === rule.prefecture);
    }
  }
  return undefined;
}

let cachedMap: Map<string, OfficeRegionInfo> | null = null;

export async function loadJmaOfficeRegionMap(): Promise<Map<string, OfficeRegionInfo>> {
  const data = await fetchJson<JmaAreaMaster>(AREA_MASTER_URL, { signal: shutdownSignal });

  const map = new Map<string, OfficeRegionInfo>();
  let unmapped = 0;

  for (const [code, office] of Object.entries(data.offices ?? {})) {
    const prefecture = resolvePrefecture(office.name);
    if (!prefecture) {
      unmapped++;
      continue;
    }
    map.set(code, {
      prefecture: prefecture.name,
      region: prefecture.region,
      officeName: office.name,
    });
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

export function startAreaMasterRefresh(): void {
  let retryCount = 0;
  let retryTimer: NodeJS.Timeout | undefined;

  // 再試行は成功するまで繰り返すため、タイマの登録は1本に保つ（解除漏れで終了が遅れないように）。
  onShutdown(() => clearTimeout(retryTimer));

  const refresh = (): void => {
    if (isShuttingDown()) return;

    loadJmaOfficeRegionMap()
      .then(() => {
        retryCount = 0;
      })
      .catch((error) => {
        if (isShuttingDown()) return;

        // 一度取得できていれば古いマッピングで動き続けられるため、失敗の深刻度が異なる。
        const hasCache = cachedMap !== null;
        const delayMs = Math.min(RETRY_BASE_DELAY_MS * 2 ** retryCount, RETRY_MAX_DELAY_MS);
        retryCount++;

        logger.error(
          hasCache
            ? `気象庁エリアマスタの再取得に失敗しました。取得済みのマッピングで監視を継続し、${delayMs / SECOND_MS}秒後に再試行します。`
            : `気象庁エリアマスタの取得に失敗しました。取得できるまで警報監視は動作しません。${delayMs / SECOND_MS}秒後に再試行します。`,
          error,
        );
        clearTimeout(retryTimer);
        retryTimer = setTimeout(refresh, delayMs);
      });
  };

  refresh();
  scheduleInterval(refresh, REFRESH_INTERVAL_MS);
}
