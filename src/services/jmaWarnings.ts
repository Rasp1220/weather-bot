import { EmbedBuilder } from "discord.js";
import type { Client } from "discord.js";
import { getCachedOfficeRegionMap, type OfficeRegionInfo } from "./jmaAreaMaster";
import {
  describeWarningCode,
  isUnknownWarningCode,
  NOTIFY_MIN_LEVEL,
  shouldNotify,
  type WarningCodeInfo,
} from "../data/warningCodes";
import { isShuttingDown, scheduleInterval, scheduleTimeout, shutdownSignal } from "../lifecycle";
import { buildRegionMention } from "./mentions";
import { getChannelId } from "./settings";
import { fetchNotificationChannel } from "../utils/discord";
import { fetchJson } from "../utils/http";
import { dataFilePath, readJsonFile, writeJsonFile } from "../utils/jsonStore";
import { logger } from "../utils/logger";
import { MINUTE_MS, SECOND_MS, sleep } from "../utils/time";

const warningJsonUrl = (officeCode: string): string =>
  `https://www.jma.go.jp/bosai/warning/data/warning/${officeCode}.json`;

// この文字列が status に入っている場合は「発表されていない／解除済み」とみなす。
// 「発表警報・注意報はなし」は警報が一つも発表されていないエリアで status のみ
// 返され code は付与されない（気象庁APIの実際の仕様）。気象庁側の表記ゆれに備え、
// それ以外の値はすべて「発表中」として扱う。
const INACTIVE_STATUSES = new Set(["発表警報・注意報はなし", "解除", ""]);

const STATE_FILE = dataFilePath("state.json");
const STATE_DESCRIPTION = "警報状態ファイル(data/state.json)";
/** 気象庁サーバへの短時間集中アクセスを避けるためのリクエスト間隔。 */
const REQUEST_INTERVAL_MS = 300;
/** エリアマスタの初回取得を待ってから最初のチェックを行うまでの猶予。 */
const INITIAL_DELAY_MS = 10 * SECOND_MS;

interface JmaWarningEntry {
  code: string;
  status: string;
}

interface JmaWarningArea {
  code: string;
  warnings?: JmaWarningEntry[];
}

interface JmaWarningAreaType {
  areas?: JmaWarningArea[];
}

interface JmaWarningResponse {
  areaTypes?: JmaWarningAreaType[];
}

/** areaコード -> 発表中の警報/注意報コード一覧 */
type ActiveCodesByArea = Record<string, string[]>;
/** officeコード -> ActiveCodesByArea */
type WarningState = Record<string, ActiveCodesByArea>;

const state: WarningState = readJsonFile<WarningState>(STATE_FILE, STATE_DESCRIPTION) ?? {};

/**
 * 警報監視の稼働状況。「警報が出ているのに通知が来ない」ときに、どこで止まっているかを
 * `/config show` から確認できるようにするための診断情報。
 */
interface WatcherStatus {
  lastPollStartedAt?: Date;
  lastPollFinishedAt?: Date;
  /** 直近の巡回で参照した予報区の数。0 のままならエリアマスタが取得できていない。 */
  officeCount: number;
  /** 直近の巡回で気象庁からの取得に失敗した予報区の数。 */
  fetchErrorCount: number;
  lastNotifiedAt?: Date;
  /** 通知に失敗して次回ポーリングに持ち越している予報区の数。 */
  pendingOfficeCount: number;
  /** 直近の通知失敗の理由（チャンネル未設定・権限不足など）。 */
  lastDeliveryError?: string;
}

const watcherStatus: WatcherStatus = {
  officeCount: 0,
  fetchErrorCount: 0,
  pendingOfficeCount: 0,
};

export function getWarningWatcherStatus(): Readonly<WatcherStatus> {
  return { ...watcherStatus };
}

function fetchOfficeWarnings(officeCode: string): Promise<JmaWarningResponse> {
  return fetchJson<JmaWarningResponse>(warningJsonUrl(officeCode), { signal: shutdownSignal });
}

/** レスポンスに含まれる全エリアの警報エントリを平坦化して列挙する。 */
function* iterateAreas(
  data: JmaWarningResponse,
): Generator<{ areaCode: string; warnings: JmaWarningEntry[] }> {
  for (const areaType of data.areaTypes ?? []) {
    for (const area of areaType.areas ?? []) {
      yield { areaCode: area.code, warnings: area.warnings ?? [] };
    }
  }
}

function isActive(warning: JmaWarningEntry): boolean {
  return Boolean(warning.code) && !INACTIVE_STATUSES.has(warning.status);
}

const WARNING_TIER_ORDER: Record<WarningCodeInfo["tier"], number> = {
  special: 0,
  warning: 1,
  advisory: 2,
};

/**
 * 指定した予報区（office）で現在発表中の警報・注意報を、重複を除いて重要度順に返す。
 * `/weather` コマンドでの現況表示用（発表状況の差分検知は行わない）。
 */
export async function fetchActiveWarnings(officeCode: string): Promise<WarningCodeInfo[]> {
  const data = await fetchOfficeWarnings(officeCode);

  const activeByCode = new Map<string, WarningCodeInfo>();
  for (const { warnings } of iterateAreas(data)) {
    for (const warning of warnings) {
      if (!isActive(warning)) continue;
      if (!activeByCode.has(warning.code)) {
        activeByCode.set(warning.code, describeWarningCode(warning.code));
      }
    }
  }

  return [...activeByCode.values()].sort(
    (a, b) => WARNING_TIER_ORDER[a.tier] - WARNING_TIER_ORDER[b.tier],
  );
}

/**
 * 新規発表された警報を通知する。
 * 送信できた場合のみ true を返す。false を返した場合、呼び出し側は発表状況を保存せず、
 * 次回のポーリングで同じ警報を再度通知対象として扱う（取りこぼしを残さないため）。
 */
async function announceNewWarnings(
  client: Client,
  channelId: string,
  info: OfficeRegionInfo,
  newCodes: string[],
): Promise<boolean> {
  const channel = await fetchNotificationChannel(client, channelId);
  if (!channel) {
    watcherStatus.lastDeliveryError =
      `通知チャンネル(${channelId})にアクセスできません。チャンネルIDと、Botの「チャンネルを見る」「メッセージを送信」権限を確認してください。`;
    return false;
  }

  const warnings = newCodes
    .map((code) => describeWarningCode(code))
    .sort((a, b) => WARNING_TIER_ORDER[a.tier] - WARNING_TIER_ORDER[b.tier]);

  const lines = warnings.map((warning) => {
    const emoji = warning.tier === "special" ? "🟣" : "🔴";
    return `${emoji} **${warning.name}**（警戒レベル${warning.level}相当）`;
  });

  const highestLevel = Math.max(...warnings.map((warning) => warning.level));
  const embed = new EmbedBuilder()
    .setTitle(`⚠️ 気象警報発表（${info.region}地方）`)
    .setColor(highestLevel >= 5 ? 0x8e24aa : 0xff5252)
    .setDescription(`**対象地域:** ${info.prefecture}\n\n${lines.join("\n")}`)
    .setFooter({ text: "情報提供: 気象庁" })
    .setTimestamp(new Date());

  // 通知対象は警戒レベル3以上（警報・特別警報）のみなので、常にメンションする。
  const mention = buildRegionMention([info.region]);

  try {
    await channel.send({
      content: mention.content,
      embeds: [embed],
      allowedMentions: mention.allowedMentions,
    });
  } catch (error) {
    watcherStatus.lastDeliveryError = `通知チャンネル(${channelId})への送信に失敗しました: ${
      error instanceof Error ? error.message : String(error)
    }`;
    logger.error(`警報の通知送信に失敗しました: ${info.prefecture} (${info.region})`, error);
    return false;
  }

  watcherStatus.lastNotifiedAt = new Date();
  watcherStatus.lastDeliveryError = undefined;
  logger.info(
    `警報を通知しました: ${info.prefecture} (${info.region}) - ${warnings
      .map((warning) => warning.name)
      .join(", ")} / メンション: ${mention.description}`,
  );
  return true;
}

/**
 * 1予報区分の発表状況を取得し、前回から新たに発表された警報だけを通知する。
 * 発表状況に変化があった場合は true を返す（呼び出し側で状態ファイルの保存要否を判断する）。
 */
async function checkOffice(
  client: Client,
  channelId: string | undefined,
  officeCode: string,
  info: OfficeRegionInfo,
): Promise<boolean> {
  const data = await fetchOfficeWarnings(officeCode);

  const previousForOffice = state[officeCode] ?? {};
  const nextForOffice: ActiveCodesByArea = {};
  const newlyIssued = new Set<string>();
  let changed = false;

  for (const { areaCode, warnings } of iterateAreas(data)) {
    const activeCodes: string[] = [];
    for (const warning of warnings) {
      if (!isActive(warning)) continue;
      if (isUnknownWarningCode(warning.code)) {
        // 気象庁がコード体系を変更した場合に気付けるよう記録する（通知はしない）。
        logger.warn(
          `未知の警報コードを受信しました (officeCode=${officeCode}, areaCode=${areaCode}, code=${warning.code}, status=${warning.status})`,
        );
        continue;
      }
      if (shouldNotify(warning.code)) activeCodes.push(warning.code);
    }

    nextForOffice[areaCode] = activeCodes;

    const previousCodes = previousForOffice[areaCode] ?? [];
    if (activeCodes.length !== previousCodes.length) changed = true;

    const previousCodeSet = new Set(previousCodes);
    for (const code of activeCodes) {
      if (!previousCodeSet.has(code)) {
        newlyIssued.add(code);
        changed = true;
      }
    }
  }

  // 予報区の構成変更などでエリアそのものが増減した場合も保存対象とする。
  if (Object.keys(nextForOffice).length !== Object.keys(previousForOffice).length) changed = true;

  if (newlyIssued.size > 0) {
    // 通知できなかった場合は発表状況を保存しない。保存してしまうと、実際には投稿されて
    // いない警報が「通知済み」として扱われ、以後のポーリングで二度と再送されなくなる。
    // チャンネル未設定・権限不足・Discord APIエラーのいずれも同じ扱いとし、
    // 設定や権限が直った時点で次のポーリングから通知されるようにする。
    if (!channelId) {
      watcherStatus.lastDeliveryError =
        "警報通知チャンネルが未設定です。/config channel set コマンドで設定してください。";
      watcherStatus.pendingOfficeCount++;
      return false;
    }

    const delivered = await announceNewWarnings(client, channelId, info, [...newlyIssued]);
    if (!delivered) {
      watcherStatus.pendingOfficeCount++;
      return false;
    }
  }

  state[officeCode] = nextForOffice;

  return changed;
}

/** 全予報区を1周チェックする。定期ポーリングの本体。 */
export async function runWarningCheck(client: Client): Promise<void> {
  watcherStatus.lastPollStartedAt = new Date();
  watcherStatus.fetchErrorCount = 0;
  watcherStatus.pendingOfficeCount = 0;

  const officeMap = getCachedOfficeRegionMap();
  if (!officeMap || officeMap.size === 0) {
    watcherStatus.officeCount = 0;
    watcherStatus.lastPollFinishedAt = new Date();
    logger.warn("気象庁エリアマスタが未取得のため、今回の警報チェックをスキップします。");
    return;
  }
  watcherStatus.officeCount = officeMap.size;

  const channelId = getChannelId("warning");
  if (!channelId) {
    logger.warn(
      "警報通知チャンネルが未設定です。新規発表された警報は保留され、/config channel set で設定後のポーリングで通知されます。",
    );
  }

  let changed = false;

  for (const [officeCode, info] of officeMap) {
    if (isShuttingDown()) break;

    try {
      changed = (await checkOffice(client, channelId, officeCode, info)) || changed;
    } catch (error) {
      if (isShuttingDown()) break;
      watcherStatus.fetchErrorCount++;
      logger.error(`警報情報の取得に失敗しました (officeCode=${officeCode})`, error);
    }

    // 終了処理が始まった場合は待機を打ち切り、残りの予報区の巡回も止める。
    if (!(await sleep(REQUEST_INTERVAL_MS, shutdownSignal))) break;
  }

  // 発表状況に変化が無いときは全予報区分を書き戻す必要がない。
  if (changed) {
    writeJsonFile(STATE_FILE, state, STATE_DESCRIPTION, false);
  }

  watcherStatus.lastPollFinishedAt = new Date();

  if (watcherStatus.pendingOfficeCount > 0) {
    logger.warn(
      `${watcherStatus.pendingOfficeCount}件の予報区で警報を通知できませんでした。次回のポーリングで再送します。理由: ${
        watcherStatus.lastDeliveryError ?? "不明"
      }`,
    );
  }
}

export function startJmaWarningWatcher(client: Client, intervalMinutes: number): void {
  let running = false;

  const run = (): void => {
    // 予報区の巡回には数十秒かかるため、前回の巡回が終わる前に次を始めない。
    if (running || isShuttingDown()) return;
    running = true;

    runWarningCheck(client)
      .catch((error) => logger.error("警報チェックの実行中にエラーが発生しました。", error))
      .finally(() => {
        running = false;
      });
  };

  logger.info(
    `警報監視を開始します（${intervalMinutes}分間隔 / 警戒レベル${NOTIFY_MIN_LEVEL}以上を通知）。`,
  );
  scheduleTimeout(run, INITIAL_DELAY_MS);
  scheduleInterval(run, intervalMinutes * MINUTE_MS);
}
