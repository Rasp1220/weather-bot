/** Open-Meteo が返す WMO Weather interpretation code を絵文字・日本語表記に変換する。 */

export interface WeatherCodeInfo {
  emoji: string;
  label: string;
}

const WEATHER_CODE_TABLE: Record<number, WeatherCodeInfo> = {
  0: { emoji: "☀️", label: "快晴" },
  1: { emoji: "🌤️", label: "晴れ" },
  2: { emoji: "⛅", label: "晴れ時々曇り" },
  3: { emoji: "☁️", label: "曇り" },
  45: { emoji: "🌫️", label: "霧" },
  48: { emoji: "🌫️", label: "霧氷" },
  51: { emoji: "🌦️", label: "弱い霧雨" },
  53: { emoji: "🌦️", label: "霧雨" },
  55: { emoji: "🌧️", label: "強い霧雨" },
  56: { emoji: "🌧️", label: "着氷性の霧雨" },
  57: { emoji: "🌧️", label: "強い着氷性の霧雨" },
  61: { emoji: "🌦️", label: "弱い雨" },
  63: { emoji: "🌧️", label: "雨" },
  65: { emoji: "🌧️", label: "強い雨" },
  66: { emoji: "🌧️", label: "着氷性の雨" },
  67: { emoji: "🌧️", label: "強い着氷性の雨" },
  71: { emoji: "🌨️", label: "弱い雪" },
  73: { emoji: "❄️", label: "雪" },
  75: { emoji: "❄️", label: "強い雪" },
  77: { emoji: "❄️", label: "雪粒" },
  80: { emoji: "🌦️", label: "弱いにわか雨" },
  81: { emoji: "🌧️", label: "にわか雨" },
  82: { emoji: "⛈️", label: "激しいにわか雨" },
  85: { emoji: "🌨️", label: "弱いにわか雪" },
  86: { emoji: "🌨️", label: "強いにわか雪" },
  95: { emoji: "⛈️", label: "雷雨" },
  96: { emoji: "⛈️", label: "雷雨（雹を伴う）" },
  99: { emoji: "⛈️", label: "雷雨（激しい雹を伴う）" },
};

export function describeWeatherCode(code: number): WeatherCodeInfo {
  return WEATHER_CODE_TABLE[code] ?? { emoji: "❓", label: "不明" };
}
