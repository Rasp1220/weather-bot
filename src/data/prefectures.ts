/** 都道府県の静的マスタデータ。地方区分は気象警報の地方ロールメンションに、緯度経度は /weather コマンドの天気取得に使用する。 */

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
  /** 代表都市の緯度 */
  latitude: number;
  /** 代表都市の経度 */
  longitude: number;
}

export const PREFECTURES: Prefecture[] = [
  { name: "北海道", region: "北海道", latitude: 43.0642, longitude: 141.3469 },
  { name: "青森県", region: "東北", latitude: 40.8244, longitude: 140.74 },
  { name: "岩手県", region: "東北", latitude: 39.7036, longitude: 141.1527 },
  { name: "宮城県", region: "東北", latitude: 38.2682, longitude: 140.8694 },
  { name: "秋田県", region: "東北", latitude: 39.7186, longitude: 140.1024 },
  { name: "山形県", region: "東北", latitude: 38.2404, longitude: 140.3633 },
  { name: "福島県", region: "東北", latitude: 37.7503, longitude: 140.4676 },
  { name: "茨城県", region: "関東", latitude: 36.3418, longitude: 140.4468 },
  { name: "栃木県", region: "関東", latitude: 36.5658, longitude: 139.8836 },
  { name: "群馬県", region: "関東", latitude: 36.3906, longitude: 139.0608 },
  { name: "埼玉県", region: "関東", latitude: 35.8617, longitude: 139.6455 },
  { name: "千葉県", region: "関東", latitude: 35.6073, longitude: 140.1063 },
  { name: "東京都", region: "関東", latitude: 35.6895, longitude: 139.6917 },
  { name: "神奈川県", region: "関東", latitude: 35.4478, longitude: 139.6425 },
  { name: "新潟県", region: "中部", latitude: 37.9026, longitude: 139.0232 },
  { name: "富山県", region: "中部", latitude: 36.6953, longitude: 137.2113 },
  { name: "石川県", region: "中部", latitude: 36.5947, longitude: 136.6256 },
  { name: "福井県", region: "中部", latitude: 36.0652, longitude: 136.2216 },
  { name: "山梨県", region: "中部", latitude: 35.6642, longitude: 138.5686 },
  { name: "長野県", region: "中部", latitude: 36.6513, longitude: 138.181 },
  { name: "岐阜県", region: "中部", latitude: 35.3912, longitude: 136.7223 },
  { name: "静岡県", region: "中部", latitude: 34.9769, longitude: 138.3831 },
  { name: "愛知県", region: "中部", latitude: 35.1802, longitude: 136.9066 },
  { name: "三重県", region: "近畿", latitude: 34.7303, longitude: 136.5086 },
  { name: "滋賀県", region: "近畿", latitude: 35.0045, longitude: 135.8686 },
  { name: "京都府", region: "近畿", latitude: 35.0116, longitude: 135.7681 },
  { name: "大阪府", region: "近畿", latitude: 34.6863, longitude: 135.52 },
  { name: "兵庫県", region: "近畿", latitude: 34.6913, longitude: 135.183 },
  { name: "奈良県", region: "近畿", latitude: 34.6851, longitude: 135.8049 },
  { name: "和歌山県", region: "近畿", latitude: 34.2261, longitude: 135.1675 },
  { name: "鳥取県", region: "中国", latitude: 35.5039, longitude: 134.2381 },
  { name: "島根県", region: "中国", latitude: 35.4723, longitude: 133.0505 },
  { name: "岡山県", region: "中国", latitude: 34.6618, longitude: 133.935 },
  { name: "広島県", region: "中国", latitude: 34.3966, longitude: 132.4596 },
  { name: "山口県", region: "中国", latitude: 34.1859, longitude: 131.4714 },
  { name: "徳島県", region: "四国", latitude: 34.0658, longitude: 134.5593 },
  { name: "香川県", region: "四国", latitude: 34.3401, longitude: 134.0434 },
  { name: "愛媛県", region: "四国", latitude: 33.8416, longitude: 132.7657 },
  { name: "高知県", region: "四国", latitude: 33.5597, longitude: 133.5311 },
  { name: "福岡県", region: "九州・沖縄", latitude: 33.6064, longitude: 130.4181 },
  { name: "佐賀県", region: "九州・沖縄", latitude: 33.2494, longitude: 130.2988 },
  { name: "長崎県", region: "九州・沖縄", latitude: 32.7448, longitude: 129.8737 },
  { name: "熊本県", region: "九州・沖縄", latitude: 32.7898, longitude: 130.7417 },
  { name: "大分県", region: "九州・沖縄", latitude: 33.2382, longitude: 131.6126 },
  { name: "宮崎県", region: "九州・沖縄", latitude: 31.9111, longitude: 131.4239 },
  { name: "鹿児島県", region: "九州・沖縄", latitude: 31.5602, longitude: 130.5581 },
  { name: "沖縄県", region: "九州・沖縄", latitude: 26.2124, longitude: 127.6809 },
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
