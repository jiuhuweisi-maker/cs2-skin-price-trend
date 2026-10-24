"""Create clearly synthetic offline demonstration histories."""
from __future__ import annotations

import csv
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "samples"
ROOT.mkdir(exist_ok=True)
for filename, base, yearly, phase in [
    ("dragon_lore_demo.csv", 950, 1.27, 0.2),
    ("howl_demo.csv", 640, 1.24, 1.8),
]:
    with (ROOT / filename).open("w", encoding="utf-8", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["date", "lowest", "median"])
        for i in range(121):
            year = 2016 + i // 12
            month = i % 12 + 1
            drift = base * yearly ** (i / 12)
            cycle = 1 + .18 * math.sin(i * .24 + phase) + .08 * math.sin(i * .83 + phase)
            median = round(drift * cycle, 2)
            writer.writerow([f"{year:04}-{month:02}-01", round(median * .92, 2), median])
