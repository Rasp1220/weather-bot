import type { RegionName } from "../data/prefectures";
import { getRegionRoleId } from "./settings";

/**
 * 災害通知のメンションを、被災地方に応じて組み立てる。
 *
 * - ロールが紐づいている地方 … その地方ロールだけをメンションする（例: 関東で地震 → `@関東`）
 * - ロールが紐づいていない地方 … `@here` でチャンネル全体に届ける
 * - 対象地方が特定できない場合 … `@here`（通知が誰にも届かない状態を作らないため）
 *
 * ロールが紐づいた地方と紐づいていない地方が同時に含まれる場合は、両方を並べて
 * メンションする（`@関東 @here` のようになる）。
 */

const HERE_MENTION = "@here";

export interface RegionMention {
  /** メッセージ本文に載せるメンション文字列。必ず1つ以上のメンションを含む。 */
  content: string;
  /**
   * 実際に通知を飛ばす対象の指定。ここに含めないメンションは文字列として表示されるだけで
   * 通知は飛ばないため、意図しない全体通知を防げる。
   */
  allowedMentions: { parse: Array<"everyone">; roles: string[] };
  /** ログ出力用の内訳（例: `関東=ロール, 東北=@here`）。 */
  description: string;
}

export function buildRegionMention(regions: Iterable<RegionName>): RegionMention {
  const roleIds: string[] = [];
  const seenRoleIds = new Set<string>();
  const details: string[] = [];
  let hasRegion = false;
  let needsHere = false;

  for (const region of regions) {
    hasRegion = true;
    const roleId = getRegionRoleId(region);

    if (!roleId) {
      needsHere = true;
      details.push(`${region}=@here`);
      continue;
    }

    details.push(`${region}=ロール`);
    // 複数の地方に同じロールを割り当てている場合に同じメンションを重ねない。
    if (seenRoleIds.has(roleId)) continue;
    seenRoleIds.add(roleId);
    roleIds.push(roleId);
  }

  if (!hasRegion) {
    needsHere = true;
    details.push("対象地方不明=@here");
  }

  const parts = roleIds.map((roleId) => `<@&${roleId}>`);
  if (needsHere) parts.push(HERE_MENTION);

  return {
    content: parts.join(" "),
    // @here は allowedMentions では everyone と同じ種別として扱われる。
    allowedMentions: { parse: needsHere ? ["everyone"] : [], roles: roleIds },
    description: details.join(", "),
  };
}
