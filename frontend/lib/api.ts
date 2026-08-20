import type { Candle, Signal } from "../types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? API_URL.replace(/^http/, "ws");

export async function getSignal(): Promise<Signal> {
  const response = await fetch(`${API_URL}/api/signals/current/XAUUSD`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Signal API failed: ${response.status}`);
  return response.json();
}

export async function getCandles(): Promise<Candle[]> {
  const response = await fetch(`${API_URL}/api/market/XAUUSD?timeframe=15min&outputsize=220`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Market API failed: ${response.status}`);
  const data = await response.json();
  return data.candles;
}

export async function getHistory(): Promise<{ items: any[] }> {
  const response = await fetch(`${API_URL}/api/signals/history?limit=30`, { cache: "no-store" });
  if (!response.ok) throw new Error(`History API failed: ${response.status}`);
  return response.json();
}
