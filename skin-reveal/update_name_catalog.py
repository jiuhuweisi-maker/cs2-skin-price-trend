"""Refresh compact Chinese/English skin names from ByMykel/CSGO-API (MIT)."""
from __future__ import annotations

import json
from pathlib import Path
from urllib.request import urlopen

BASE = "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api"
ROOT = Path(__file__).resolve().parent
OUT = ROOT / "catalog" / "skins_zh_en.json"


def fetch(language: str) -> list[dict]:
    with urlopen(f"{BASE}/{language}/skins.json", timeout=30) as response:
        return json.load(response)


def main() -> None:
    english = {row["id"]: row["name"] for row in fetch("en")}
    chinese = fetch("zh-CN")
    rows = [{"zh": row["name"], "en": english[row["id"]]}
            for row in chinese if row["id"] in english]
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Saved {len(rows)} name pairs to {OUT}")


if __name__ == "__main__":
    main()
