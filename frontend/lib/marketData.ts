import type { Candle } from "../types";

const BASE = "https://api.twelvedata.com/time_series";

export function getSavedApiKey(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("twelve_data_api_key") ?? "";
}

export function saveApiKey(key: string) {
  window.localStorage.setItem("twelve_data_api_key", key.trim());
}

export function clearApiKey() {
  window.localStorage.removeItem("twelve_data_api_key");
}

export async function fetchCandles(apiKey: string, interval: "5min" | "15min" | "1h", outputsize = 240): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol: "XAU/USD",
    interval,
    outputsize: String(outputsize),
    apikey: apiKey,
    format: "JSON",
  });
  const response = await fetch(`${BASE}?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Market data HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.status === "error" || !Array.isArray(payload.values)) {
    throw new Error(payload.message ?? "Twelve Data tidak mengembalikan candle XAU/USD");
  }
  return payload.values
    .map((v: any) => ({
      timestamp: `${v.datetime.replace(" ", "T")}Z`,
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: Number(v.volume ?? 0),
    }))
    .reverse();
}

export async function fetchAllTimeframes(apiKey: string) {
  const [c5, c15, c1h] = await Promise.all([
    fetchCandles(apiKey, "5min"),
    fetchCandles(apiKey, "15min"),
    fetchCandles(apiKey, "1h"),
  ]);
  return { c5, c15, c1h };
}
