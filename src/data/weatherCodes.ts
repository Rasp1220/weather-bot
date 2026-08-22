/** Open-Meteo が返す WMO Weather interpretation code を絵文字・日本語表記に変換する。 */

/** 天気アイコン画像描画用の大分類。 */
export type WeatherCategory = "sun" | "sun-cloud" | "cloud" | "fog" | "rain" | "snow" | "thunder";

export interface WeatherCodeInfo {
  emoji: string;
  label: string;
  category: WeatherCategory;
}

const WEATHER_CODE_TABLE: Record<number, WeatherCodeInfo> = {
  0: { emoji: "☀️", label: "快晴", category: "sun" },
  1: { emoji: "🌤️", label: "晴れ", category: "sun" },
  2: { emoji: "⛅", label: "晴れ時々曇り", category: "sun-cloud" },
  3: { emoji: "☁️", label: "曇り", category: "cloud" },
  45: { emoji: "🌫️", label: "霧", category: "fog" },
  48: { emoji: "🌫️", label: "霧氷", category: "fog" },
  51: { emoji: "🌦️", label: "弱い霧雨", category: "rain" },
  53: { emoji: "🌦️", label: "霧雨", category: "rain" },
  55: { emoji: "🌧️", label: "強い霧雨", category: "rain" },
  56: { emoji: "🌧️", label: "着氷性の霧雨", category: "rain" },
  57: { emoji: "🌧️", label: "強い着氷性の霧雨", category: "rain" },
  61: { emoji: "🌦️", label: "弱い雨", category: "rain" },
  63: { emoji: "🌧️", label: "雨", category: "rain" },
  65: { emoji: "🌧️", label: "強い雨", category: "rain" },
  66: { emoji: "🌧️", label: "着氷性の雨", category: "rain" },
  67: { emoji: "🌧️", label: "強い着氷性の雨", category: "rain" },
  71: { emoji: "🌨️", label: "弱い雪", category: "snow" },
  73: { emoji: "❄️", label: "雪", category: "snow" },
  75: { emoji: "❄️", label: "強い雪", category: "snow" },
  77: { emoji: "❄️", label: "雪粒", category: "snow" },
  80: { emoji: "🌦️", label: "弱いにわか雨", category: "rain" },
  81: { emoji: "🌧️", label: "にわか雨", category: "rain" },
  82: { emoji: "⛈️", label: "激しいにわか雨", category: "rain" },
  85: { emoji: "🌨️", label: "弱いにわか雪", category: "snow" },
  86: { emoji: "🌨️", label: "強いにわか雪", category: "snow" },
  95: { emoji: "⛈️", label: "雷雨", category: "thunder" },
  96: { emoji: "⛈️", label: "雷雨（雹を伴う）", category: "thunder" },
  99: { emoji: "⛈️", label: "雷雨（激しい雹を伴う）", category: "thunder" },
};

const UNKNOWN_WEATHER: WeatherCodeInfo = { emoji: "❓", label: "不明", category: "cloud" };

export function describeWeatherCode(code: number): WeatherCodeInfo {
  return WEATHER_CODE_TABLE[code] ?? UNKNOWN_WEATHER;
}
