import { describeWeatherCode, type WeatherCategory } from "../data/weatherCodes";

const OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast";
const HOURS_TO_SHOW = 12;

export interface HourlyForecastEntry {
  time: Date;
  temperature: number;
  weatherEmoji: string;
  weatherLabel: string;
  weatherCategory: WeatherCategory;
}

interface OpenMeteoResponse {
  hourly: {
    time: string[];
    temperature_2m: number[];
    weather_code: number[];
  };
}

export async function fetchHourlyForecast(
  latitude: number,
  longitude: number,
): Promise<HourlyForecastEntry[]> {
  const url = new URL(OPEN_METEO_BASE_URL);
  url.searchParams.set("latitude", latitude.toString());
  url.searchParams.set("longitude", longitude.toString());
  url.searchParams.set("hourly", "temperature_2m,weather_code");
  url.searchParams.set("timezone", "Asia/Tokyo");
  url.searchParams.set("forecast_days", "2");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Open-Meteo APIエラー: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as OpenMeteoResponse;
  const currentHourStart = new Date();
  currentHourStart.setMinutes(0, 0, 0);

  const entries: HourlyForecastEntry[] = data.hourly.time.map((isoTime, index) => {
    const weather = describeWeatherCode(data.hourly.weather_code[index]);
    return {
      time: new Date(isoTime),
      temperature: data.hourly.temperature_2m[index],
      weatherEmoji: weather.emoji,
      weatherLabel: weather.label,
      weatherCategory: weather.category,
    };
  });

  return entries.filter((entry) => entry.time >= currentHourStart).slice(0, HOURS_TO_SHOW);
}
