/** 都道府県の静的マスタデータ。地方区分は気象警報の地方ロールメンションに使用する。 */

export type RegionName =
  | "北海道"
  | "東北"
  | "関東"
  | "中部"
  | "近畿"
  | "中国"
  | "四国"
  | "九州・沖縄";

export interface Prefecture {
  /** 都道府県名（例: 東京都） */
  name: string;
  /** 地方区分（地方ロールメンションに使用） */
  region: RegionName;
}

export const PREFECTURES: Prefecture[] = [
  { name: "北海道", region: "北海道" },
  { name: "青森県", region: "東北" },
  { name: "岩手県", region: "東北" },
  { name: "宮城県", region: "東北" },
  { name: "秋田県", region: "東北" },
  { name: "山形県", region: "東北" },
  { name: "福島県", region: "東北" },
  { name: "茨城県", region: "関東" },
  { name: "栃木県", region: "関東" },
  { name: "群馬県", region: "関東" },
  { name: "埼玉県", region: "関東" },
  { name: "千葉県", region: "関東" },
  { name: "東京都", region: "関東" },
  { name: "神奈川県", region: "関東" },
  { name: "新潟県", region: "中部" },
  { name: "富山県", region: "中部" },
  { name: "石川県", region: "中部" },
  { name: "福井県", region: "中部" },
  { name: "山梨県", region: "中部" },
  { name: "長野県", region: "中部" },
  { name: "岐阜県", region: "中部" },
  { name: "静岡県", region: "中部" },
  { name: "愛知県", region: "中部" },
  { name: "三重県", region: "近畿" },
  { name: "滋賀県", region: "近畿" },
  { name: "京都府", region: "近畿" },
  { name: "大阪府", region: "近畿" },
  { name: "兵庫県", region: "近畿" },
  { name: "奈良県", region: "近畿" },
  { name: "和歌山県", region: "近畿" },
  { name: "鳥取県", region: "中国" },
  { name: "島根県", region: "中国" },
  { name: "岡山県", region: "中国" },
  { name: "広島県", region: "中国" },
  { name: "山口県", region: "中国" },
  { name: "徳島県", region: "四国" },
  { name: "香川県", region: "四国" },
  { name: "愛媛県", region: "四国" },
  { name: "高知県", region: "四国" },
  { name: "福岡県", region: "九州・沖縄" },
  { name: "佐賀県", region: "九州・沖縄" },
  { name: "長崎県", region: "九州・沖縄" },
  { name: "熊本県", region: "九州・沖縄" },
  { name: "大分県", region: "九州・沖縄" },
  { name: "宮崎県", region: "九州・沖縄" },
  { name: "鹿児島県", region: "九州・沖縄" },
  { name: "沖縄県", region: "九州・沖縄" },
];

const BY_NAME = new Map(PREFECTURES.map((p) => [p.name, p]));

export function findPrefecture(name: string): Prefecture | undefined {
  return BY_NAME.get(name);
}

/**
 * 都道府県名の部分一致検索（スラッシュコマンドのオートコンプリート用）。
 * 「東京」のような正式名称の一部でもヒットするようにする。
 */
export function searchPrefectures(query: string, limit = 25): Prefecture[] {
  const q = query.trim();
  if (!q) return PREFECTURES.slice(0, limit);
  return PREFECTURES.filter((p) => p.name.includes(q)).slice(0, limit);
}
