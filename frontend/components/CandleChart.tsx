"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  ColorType,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "../types";

function isFiniteCandle(c: Candle) {
  const ts = new Date(c.timestamp).getTime();
  return Number.isFinite(ts) && ts > 0 && [c.open, c.high, c.low, c.close].every(Number.isFinite) && c.high >= c.low;
}

function sanitize(candles: Candle[]) {
  const map = new Map<number, Candle>();
  for (const candle of candles) {
    if (!isFiniteCandle(candle)) continue;
    const ts = Math.floor(new Date(candle.timestamp).getTime() / 1000);
    map.set(ts, candle);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .slice(-720)
    .map(([, candle]) => candle);
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

export default function CandleChart({ candles }: { candles: Candle[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const firstTimeRef = useRef<number | null>(null);
  const initializedRef = useRef(false);
  const clean = useMemo(() => sanitize(candles), [candles]);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height: 400,
      layout: {
        background: { type: ColorType.Solid, color: "#0b1020" },
        textColor: "#9ba7bd",
      },
      grid: {
        vertLines: { color: "#182035" },
        horzLines: { color: "#182035" },
      },
      rightPriceScale: { borderColor: "#25304a", autoScale: true },
      timeScale: {
        borderColor: "#25304a",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 6,
        fixLeftEdge: false,
      },
      crosshair: { vertLine: { labelVisible: true }, horzLine: { labelVisible: true } },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#19c37d",
      downColor: "#ef4f5f",
      borderVisible: false,
      wickUpColor: "#19c37d",
      wickDownColor: "#ef4f5f",
      priceLineVisible: true,
      lastValueVisible: true,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const resize = () => {
      const width = ref.current?.clientWidth ?? 800;
      if (width > 0) chart.applyOptions({ width });
    };
    resize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    if (ref.current && observer) observer.observe(ref.current);
    window.addEventListener("resize", resize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      initializedRef.current = false;
      lastTimeRef.current = null;
      firstTimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || clean.length === 0) return;

    const firstTime = Math.floor(new Date(clean[0].timestamp).getTime() / 1000);
    const last = clean.at(-1)!;
    const lastTime = Math.floor(new Date(last.timestamp).getTime() / 1000);
    const structureChanged = firstTimeRef.current !== firstTime || lastTimeRef.current !== lastTime;

    try {
      if (!initializedRef.current || structureChanged) {
        series.setData(clean.map(toPoint));
        initializedRef.current = true;
        if (clean.length <= 180) chart.timeScale().fitContent();
        else chart.timeScale().scrollToRealTime();
      } else {
        series.update(toPoint(last));
        chart.timeScale().scrollToRealTime();
      }
    } catch {
      // Defensive full redraw if a browser/tab restore or an out-of-order tick invalidates an incremental update.
      try {
        series.setData(clean.map(toPoint));
        chart.timeScale().scrollToRealTime();
      } catch {
        // Keep the chart container alive; the next valid data update will redraw it.
      }
    }

    firstTimeRef.current = firstTime;
    lastTimeRef.current = lastTime;
  }, [clean]);

  return <div ref={ref} className="chart" aria-label="Realtime XAU/USD one-minute candlestick chart" />;
}
