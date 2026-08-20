"""Minimal CSV sanity backtest scaffold.

This intentionally does not claim a win rate. Extend it with multi-timeframe resampling,
transaction costs/spread assumptions, walk-forward splits and immutable trade logs.
Expected CSV columns: timestamp,open,high,low,close,volume
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path


def main(path: str) -> None:
    rows = list(csv.DictReader(Path(path).open()))
    if len(rows) < 300:
        raise SystemExit("Need at least 300 base candles")
    print(f"Loaded {len(rows)} rows. Backtest evaluator scaffold is ready for strategy research.")
    print("No win-rate claim is produced until multi-timeframe, spread, and walk-forward logic are enabled.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/backtest.py data.csv")
    main(sys.argv[1])
