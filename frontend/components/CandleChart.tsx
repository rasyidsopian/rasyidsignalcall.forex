"use client";

import { useEffect, useRef } from "react";
import {
  ColorType,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "../types";

function valid(c: Candle) {
  const ts = new Date(c.timestamp).getTime();
  return Number.isFinite(ts) && ts > 0 && [c.open, c.high, c.low, c.close].every(Number.isFinite) && c.high >= c.low;
}

function toPoint(c: Candle): CandlestickData<UTCTimestamp> {
  return {
    time: Math.floor(new Date(c.timestamp).getTime() / 1000) as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
}

function fullData(candles: Candle[]) {
  const map = new Map<number, Candle>();
  for (const c of candles.slice(-720)) {
    if (!valid(c)) continue;
    map.set(Math.floor(new Date(c.timestamp).getTime() / 1000), c);
  }
  return [...map.entries()].sort(([a], [b]) => a - b).map(([, c]) => toPoint(c));
}

export default function CandleChart({ candles }: { candles: Candle[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const lastLengthRef = useRef(0);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height: 400,
      layout: { background: { type: ColorType.Solid, color: "#0b1020" }, textColor: "#9ba7bd" },
      grid: { vertLines: { color: "#182035" }, horzLines: { color: "#182035" } },
      rightPriceScale: { borderColor: "#25304a", autoScale: true },
      timeScale: { borderColor: "#25304a", timeVisible: true, secondsVisible: true, rightOffset: 4, barSpacing: 6 },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#19c37d", downColor: "#ef4f5f", borderVisible: false,
      wickUpColor: "#19c37d", wickDownColor: "#ef4f5f", priceLineVisible: true, lastValueVisible: true,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const resize = () => {
      const width = ref.current?.clientWidth ?? 800;
      if (width > 0) chart.applyOptions({ width });
    };
    resize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(ref.current);
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      initializedRef.current = false;
      lastTimeRef.current = null;
      lastLengthRef.current = 0;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || candles.length === 0) return;
    const last = candles.at(-1)!;
    if (!valid(last)) return;
    const lastTime = Math.floor(new Date(last.timestamp).getTime() / 1000);
    const structureChanged = !initializedRef.current || candles.length !== lastLengthRef.current || lastTimeRef.current !== lastTime;

    try {
      if (structureChanged) {
        const data = fullData(candles);
        if (!data.length) return;
        series.setData(data);
        initializedRef.current = true;
        chart.timeScale().scrollToRealTime();
      } else {
        // Hot path: on every provider tick only update the current candle. No 720-candle sanitize pass.
        series.update(toPoint(last));
      }
    } catch {
      try { series.setData(fullData(candles)); chart.timeScale().scrollToRealTime(); } catch {}
    }

    lastTimeRef.current = lastTime;
    lastLengthRef.current = candles.length;
  }, [candles]);

  return <div ref={ref} className="chart" aria-label="Realtime XAU/USD one-minute candlestick chart" />;
}
