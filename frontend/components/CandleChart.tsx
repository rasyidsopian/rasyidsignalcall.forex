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
  const lastLengthRef = useRef(0);
  const firstTsRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height: 380,
      layout: {
        background: { type: ColorType.Solid, color: "#0b1020" },
        textColor: "#9ba7bd",
      },
      grid: {
        vertLines: { color: "#182035" },
        horzLines: { color: "#182035" },
      },
      rightPriceScale: { borderColor: "#25304a" },
      timeScale: { borderColor: "#25304a", timeVisible: true, secondsVisible: false },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#19c37d",
      downColor: "#ef4f5f",
      borderVisible: false,
      wickUpColor: "#19c37d",
      wickDownColor: "#ef4f5f",
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const resize = () => chart.applyOptions({ width: ref.current?.clientWidth ?? 800 });
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || candles.length === 0) return;

    const firstTs = candles[0]?.timestamp ?? null;
    const structuralChange = candles.length !== lastLengthRef.current || firstTs !== firstTsRef.current;

    if (structuralChange || lastLengthRef.current === 0) {
      series.setData(candles.map(toPoint));
      if (lastLengthRef.current === 0) chart.timeScale().fitContent();
    } else {
      series.update(toPoint(candles.at(-1)!));
    }

    lastLengthRef.current = candles.length;
    firstTsRef.current = firstTs;
  }, [candles]);

  return <div ref={ref} className="chart" />;
}
