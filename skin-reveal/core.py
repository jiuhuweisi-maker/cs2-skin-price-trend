"""Data transformations shared by the local server and tests."""
from __future__ import annotations

import csv
import io
import json
import math
import re
from datetime import date
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
from statistics import median

ALIASES = {
    "龙狙": "AWP | Dragon Lore", "dl": "AWP | Dragon Lore", "dragon lore": "AWP | Dragon Lore",
    "咆哮": "M4A4 | Howl", "howl": "M4A4 | Howl", "红线": "AK-47 | Redline",
    "火神": "AK-47 | Vulcan", "渐变": "Glock-18 | Fade", "霓虹革命": "AK-47 | Neon Revolution",
    "neon revolution": "AK-47 | Neon Revolution", "二西莫夫": "AWP | Asiimov",
    "永恒之枪": "AWP | Gungnir", "王子": "AWP | The Prince", "美杜莎": "AWP | Medusa",
    "沙漠九头蛇": "AWP | Desert Hydra", "血腥运动": "AK-47 | Bloodsport",
    "皇后": "AK-47 | The Empress", "燃料喷射器": "AK-47 | Fuel Injector",
    "火蛇": "AK-47 | Fire Serpent", "表面淬火": "AK-47 | Case Hardened",
    "黄金藤蔓": "AK-47 | Gold Arabesque", "水栽竹": "AK-47 | Hydroponic",
    "印花集": "M4A4 | The Coalition", "喧嚣杀戮": "M4A4 | Buzz Kill",
    "皇家圣骑士": "M4A4 | Royal Paladin", "次时代": "M4A1-S | Printstream",
    "女火神": "M4A1-S | Chantico's Fire", "暴怒野兽": "M4A1-S | Hyper Beast",
    "黑色魅影": "USP-S | Kill Confirmed", "脑洞大开": "USP-S | Cortex",
    "破铜烂铁": "Desert Eagle | Printstream", "炽烈之炎": "Desert Eagle | Blaze",
    "伽玛多普勒": "Karambit | Gamma Doppler", "多普勒": "Karambit | Doppler",
    "蝴蝶刀": "Butterfly Knife", "爪子刀": "Karambit", "运动手套": "Sport Gloves",
    "潘多拉之盒": "Sport Gloves | Pandora's Box", "迈阿密风云": "Sport Gloves | Vice",
    "崭新出厂": "Factory New", "略有磨损": "Minimal Wear", "久经沙场": "Field-Tested",
    "破损不堪": "Well-Worn", "战痕累累": "Battle-Scarred",
}

WEARS = {
    "Factory New": ("崭新出厂", "崭新", "fn"),
    "Minimal Wear": ("略有磨损", "略磨", "mw"),
    "Field-Tested": ("久经沙场", "久经", "ft"),
    "Well-Worn": ("破损不堪", "破损", "ww"),
    "Battle-Scarred": ("战痕累累", "战痕", "bs"),
}
PHASES = {"Ruby": ("红宝石",), "Sapphire": ("蓝宝石",), "Black Pearl": ("黑珍珠",),
          "Phase 1": ("p1", "相位1", "相位 1"), "Phase 2": ("p2", "相位2", "相位 2"),
          "Phase 3": ("p3", "相位3", "相位 3"), "Phase 4": ("p4", "相位4", "相位 4")}
DOPPLER_WEARS = ["Factory New", "Minimal Wear"]
DOPPLER_PHASES = list(PHASES)
SPECIAL_BASES = {
    "★ Butterfly Knife | Doppler": ("蝴蝶刀多普勒", "多普勒蝴蝶刀", "butterfly knife doppler"),
    "★ Karambit | Doppler": ("爪子刀多普勒", "多普勒爪子刀", "karambit doppler"),
}

# The site searches English names. Translate familiar Chinese names into search
# words, then let the site's own catalog decide which items actually exist.
SEARCH_WORDS = {
    "蝴蝶刀": "Butterfly Knife", "爪子刀": "Karambit", "刺刀": "Bayonet",
    "M9刺刀": "M9 Bayonet", "折叠刀": "Flip Knife", "猎杀者匕首": "Huntsman Knife",
    "鲍伊猎刀": "Bowie Knife", "弯刀": "Falchion Knife", "短剑": "Shadow Daggers",
    "骷髅匕首": "Skeleton Knife", "锯齿爪刀": "Talon Knife", "海豹短刀": "Ursus Knife",
    "流浪者匕首": "Nomad Knife", "系绳匕首": "Paracord Knife",
    "传说": "Lore", "红宝石": "Doppler Ruby", "蓝宝石": "Doppler Sapphire",
    "黑珍珠": "Doppler Black Pearl", "渐变之色": "Fade", "渐变": "Fade",
    "多普勒": "Doppler", "伽玛多普勒": "Gamma Doppler", "虎牙": "Tiger Tooth",
    "深红之网": "Crimson Web", "屠夫": "Slaughter", "大马士革钢": "Damascus Steel",
    "表面淬火": "Case Hardened", "森林迷彩": "Forest DDPAT", "噩梦之夜": "Night",
    "龙狙": "AWP Dragon Lore", "咆哮": "M4A4 Howl", "火神": "AK-47 Vulcan",
}


def site_search_terms(query: str) -> str:
    """Turn a mixed Chinese/English user name into the site's search words."""
    value = query.strip()
    for wear, terms in WEARS.items():
        value = _remove_terms(value, [wear, *terms])
    value = _remove_terms(value, ["StatTrak™", "StatTrak", "暗金", "★"])
    if re.search(r"[\u3400-\u9fff]", value) and value not in SEARCH_WORDS:
        translated = lookup_chinese_name(value)
        if translated:
            value = translated
    elif not re.search(r"[\u3400-\u9fff]", value):
        corrected = lookup_english_name(value)
        if corrected:
            value = corrected
    for chinese, english in sorted(SEARCH_WORDS.items(), key=lambda pair: -len(pair[0])):
        value = value.replace(chinese, f" {english} ")
    value = value.replace("|", " ").replace("★", " ")
    value = re.sub(r"\s+", " ", value).strip()
    for weapon in ("Butterfly Knife", "M9 Bayonet", "Huntsman Knife", "Bowie Knife", "Falchion Knife", "Flip Knife", "Karambit", "Bayonet"):
        if weapon.casefold() in value.casefold() and not value.casefold().startswith(weapon.casefold()):
            value = weapon + " " + re.sub(re.escape(weapon), "", value, flags=re.IGNORECASE).strip()
            break
    return re.sub(r"\s+", " ", value).strip()


@lru_cache(maxsize=1)
def _name_catalog() -> list[dict]:
    path = Path(__file__).resolve().parent / "catalog" / "skins_zh_en.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


def _compact_name(name: str) -> str:
    return re.sub(r"[^a-z0-9\u3400-\u9fff]+", "", name.casefold())


def lookup_chinese_name(query: str) -> str:
    key = _compact_name(query)
    if len(key) < 4:
        return ""
    pairs = [(_compact_name(row["zh"]), row["en"]) for row in _name_catalog()]
    exact = next((en for zh, en in pairs if zh == key), None)
    if exact:
        return exact
    scored = sorted(((SequenceMatcher(None, key, zh).ratio(), en) for zh, en in pairs), reverse=True)
    if scored and scored[0][0] >= .8 and (len(scored) == 1 or scored[0][0] - scored[1][0] >= .035):
        return scored[0][1]
    return ""


def lookup_english_name(query: str) -> str:
    key = _compact_name(query)
    if len(key) < 8:
        return ""
    pairs = [(_compact_name(row["en"]), row["en"]) for row in _name_catalog()]
    exact = next((en for normalized, en in pairs if normalized == key), None)
    if exact:
        return exact
    scored = sorted(((SequenceMatcher(None, key, normalized).ratio(), en) for normalized, en in pairs), reverse=True)
    if scored and scored[0][0] >= .86 and (len(scored) == 1 or scored[0][0] - scored[1][0] >= .035):
        return scored[0][1]
    return ""


def rank_site_results(query: str, results: list[dict]) -> list[dict]:
    words = site_search_terms(query).casefold()
    words = re.sub(r"[^a-z0-9]+", " ", words).strip()
    def score(row: dict) -> float:
        name = re.sub(r"[^a-z0-9]+", " ", row["name"].casefold()).strip()
        if name == words:
            return 2.0
        if name.replace(" ", "") == words.replace(" ", ""):
            return 1.9
        common = sum(part in name.split() for part in words.split()) / max(1, len(words.split()))
        return common + SequenceMatcher(None, words, name).ratio() / 2
    return sorted(results, key=score, reverse=True)


def canonical_site_name(card_name: str) -> str:
    """Format a catalog card label in the site's weapon | finish style."""
    if " | " in card_name:
        return card_name
    weapons = ("Butterfly Knife", "Huntsman Knife", "Falchion Knife", "Shadow Daggers",
               "Skeleton Knife", "Paracord Knife", "Bowie Knife", "Flip Knife",
               "Gut Knife", "M9 Bayonet", "Karambit", "Bayonet", "Talon Knife",
               "Ursus Knife", "Nomad Knife", "Classic Knife", "Navaja Knife",
               "Sport Gloves", "Driver Gloves", "Hand Wraps", "Moto Gloves",
               "Hydra Gloves", "Broken Fang Gloves", "Specialist Gloves", "AWP",
               "AK-47", "M4A4", "M4A1-S", "USP-S", "Glock-18", "Desert Eagle")
    for weapon in weapons:
        if card_name.startswith(weapon + " "):
            prefix = "★ " if "Knife" in weapon or weapon in ("Karambit", "Bayonet", "Shadow Daggers", "Sport Gloves", "Driver Gloves", "Hand Wraps", "Moto Gloves", "Hydra Gloves", "Broken Fang Gloves", "Specialist Gloves") else ""
            return f"{prefix}{weapon} | {card_name[len(weapon)+1:]}"
    return card_name


def _remove_terms(value: str, terms: list[str]) -> str:
    for term in sorted(terms, key=len, reverse=True):
        value = re.sub(re.escape(term), " ", value, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", value).strip(" ·|-()")


def resolve_item(query: str, names: list[str] | None = None) -> dict:
    """Resolve a name without treating a Doppler phase as part of market_hash_name."""
    original = query.strip()
    working = original.casefold()
    wear = next((name for name, terms in WEARS.items()
                 if any(re.search(r"(?<![a-z])" + re.escape(term) + r"(?![a-z])", working)
                        for term in (name.casefold(), *terms))), None)
    if wear:
        working = _remove_terms(working, [wear.casefold(), *WEARS[wear]])
    phase = next((name for name, terms in PHASES.items()
                  if any(term in working for term in (name.casefold(), *terms))), None)
    if phase:
        working = _remove_terms(working, [phase.casefold(), *PHASES[phase]])
    stattrak = bool(re.search(r"stattrak|暗金", working, re.IGNORECASE))
    working = _remove_terms(working, ["stattrak", "暗金", "★", "多普勒" if phase else "__never__"])
    working = working.strip()
    if phase and working in ("蝴蝶刀", "蝴蝶", "butterfly knife"):
        base, confidence = "★ Butterfly Knife | Doppler", 1.0
    elif phase and working in ("爪子刀", "爪刀", "karambit"):
        base, confidence = "★ Karambit | Doppler", 1.0
    else:
        aliases = {**ALIASES}
        for base_name, terms in SPECIAL_BASES.items():
            aliases.update({term: base_name for term in terms})
            aliases[base_name.casefold()] = base_name
        pool = list(dict.fromkeys([*aliases.values(), *(names or [])]))
        base = aliases.get(working, "")
        confidence = 1.0 if base else 0.0
        if not base:
            base = next((x for x in pool if x.casefold() == working), "")
            confidence = 1.0 if base else 0.0
        if not base and working:
            aliases_ranked = sorted(((SequenceMatcher(None, working, a).ratio(), b)
                                     for a, b in aliases.items()), reverse=True)
            if aliases_ranked and aliases_ranked[0][0] >= .7:
                confidence, base = aliases_ranked[0]
    if phase and base and "Doppler" not in base:
        base, confidence = "", 0.0
    if base in SPECIAL_BASES and wear and wear not in DOPPLER_WEARS:
        return {"input": original, "match": "", "confidence": 0.0, "error": "这款多普勒只提供崭新出厂、略有磨损"}
    available_wears = DOPPLER_WEARS if base in SPECIAL_BASES else list(WEARS)
    available_phases = DOPPLER_PHASES if base in SPECIAL_BASES else []
    hash_name = f"{base} ({wear})" if base and wear else base
    if stattrak and hash_name:
        hash_name = hash_name.replace("★ ", "★ StatTrak™ ", 1) if hash_name.startswith("★ ") else "StatTrak™ " + hash_name
    return {"input": original, "match": base, "confidence": round(confidence, 3),
            "wear": wear, "phase": phase, "stattrak": stattrak,
            "available_wears": available_wears, "available_phases": available_phases,
            "market_hash_name": hash_name}


def split_names(text: str) -> list[str]:
    return [x.strip() for x in re.split(r"[\n,，、;；]+", text) if x.strip()]


def match_name(query: str, names: list[str] | None = None) -> tuple[str, float]:
    q = query.strip()
    if not q:
        return "", 0.0
    pool = list(dict.fromkeys([*ALIASES.values(), *(names or [])]))
    normalized = q.casefold()
    if normalized in ALIASES:
        return ALIASES[normalized], 1.0
    for candidate in pool:
        if candidate.casefold() == normalized:
            return candidate, 1.0
    ranked = sorted(((SequenceMatcher(None, normalized, n.casefold()).ratio(), n) for n in pool), reverse=True)
    return ranked[0][1], round(ranked[0][0], 3)


def _number(value: str | int | float | None) -> float | None:
    if value is None or str(value).strip() in ("", "NaN", "null", "None"):
        return None
    try:
        n = float(str(value).replace(",", "").replace("¥", "").replace("$", ""))
    except ValueError as exc:
        raise ValueError(f"无效价格：{value}") from exc
    if not math.isfinite(n) or n <= 0:
        raise ValueError(f"价格必须大于零：{value}")
    return n


def parse_csv(content: bytes, name: str, currency: str = "CNY") -> dict:
    decoded = None
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            decoded = content.decode(encoding)
            break
        except UnicodeDecodeError:
            pass
    if decoded is None:
        raise ValueError("CSV 编码无法识别，请保存为 UTF-8 或 GB18030")
    reader = csv.DictReader(io.StringIO(decoded))
    if not reader.fieldnames:
        raise ValueError("CSV 没有表头")
    cols = {x.strip().lower(): x for x in reader.fieldnames}
    if "date" not in cols or not any(x in cols for x in ("price", "median", "lowest")):
        raise ValueError("CSV 需要 date,price 或 date,lowest,median 列")
    rows = []
    for line, raw in enumerate(reader, 2):
        if not any(raw.values()):
            continue
        try:
            d = date.fromisoformat((raw.get(cols["date"]) or "").strip()[:10]).isoformat()
        except ValueError as exc:
            raise ValueError(f"第 {line} 行日期无效，请用 YYYY-MM-DD") from exc
        price = _number(raw.get(cols["price"])) if "price" in cols else None
        low = _number(raw.get(cols["lowest"])) if "lowest" in cols else price
        med = _number(raw.get(cols["median"])) if "median" in cols else price
        if low is None and med is None:
            continue
        rows.append({"date": d, "lowest": low or med, "median": med or low})
    if len(rows) < 2:
        raise ValueError("至少需要两个有效日期的价格")
    deduped = {row["date"]: row for row in rows}
    if currency not in ("CNY", "USD", "EUR"):
        raise ValueError("CSV 币种只支持 CNY、USD、EUR")
    return {"id": re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-") or name,
            "name": name, "source": "CSV", "currency": currency,
            "rows": sorted(deduped.values(), key=lambda x: x["date"])}


def parse_official_history(content: str | bytes, chosen_name: str, phase: str | None = None) -> dict:
    """Parse the *documented* paid API response; per-market values are USD cents."""
    obj = json.loads(content)
    items = obj.get("data") if isinstance(obj, dict) else None
    if not isinstance(items, list):
        raise ValueError("JSON 缺少 data 数组")
    matches = [x for x in items if x.get("market_hash_name", "").casefold() == chosen_name.casefold()]
    if phase:
        matches = [x for x in matches if (x.get("phase") or "").casefold() == phase.casefold()]
    if not matches:
        raise ValueError("JSON 中没有指定饰品；请检查 market_hash_name")
    if len(matches) > 1:
        raise ValueError("同名饰品有多个多普勒相位，请指定 phase")
    chosen = matches[0]
    rows = []
    for day in chosen.get("dates", []):
        values = [p["price"] / 100 for p in day.get("prices", []) if isinstance(p.get("price"), (int, float)) and p["price"] > 0]
        if values:
            rows.append({"date": date.fromisoformat(day["date"]).isoformat(), "lowest": min(values), "median": median(values)})
    if len(rows) < 2:
        raise ValueError("历史记录不足两个有效日期")
    selected_phase = chosen.get("phase")
    display = chosen_name + (f" · {selected_phase}" if selected_phase else "")
    return {"id": display, "name": display, "market_hash_name": chosen_name, "phase": selected_phase,
            "source": "CSGOSKINS.GG API JSON · USD", "currency": "USD", "rows": sorted(rows, key=lambda x: x["date"])}


def site_item_path(market_hash_name: str, phase: str | None = None) -> str:
    """Build the public item URL for the resolved item/exterior, not a search guess."""
    name = re.sub(r"^★\s*", "", market_hash_name).strip()
    stattrak = name.startswith("StatTrak™ ")
    if stattrak:
        name = name[len("StatTrak™ "):]
    match = re.fullmatch(r"(.+?)\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)", name)
    if not match:
        raise ValueError("请先选择磨损度")
    base, wear = match.groups()
    slug = re.sub(r"[^a-z0-9]+", "-", base.casefold().replace(" | ", "-")).strip("-")
    if phase:
        if "doppler" not in slug or phase not in PHASES:
            raise ValueError("相位与饰品名称不匹配")
        slug += "-" + re.sub(r"[^a-z0-9]+", "-", phase.casefold()).strip("-")
    exterior = re.sub(r"[^a-z0-9]+", "-", wear.casefold()).strip("-")
    return f"/items/{slug}/{'stattrak-' if stattrak else ''}{exterior}"


def parse_site_history(points: list, name: str, source_url: str) -> dict:
    """CSGOSKINS.GG page chart: [date, lowest USD cents, offers, sold]."""
    if not isinstance(points, list) or len(points) > 20000:
        raise ValueError("网站历史价数据量无效")
    rows = {}
    for point in points:
        if not isinstance(point, list) or len(point) < 2:
            continue
        try:
            day = date.fromisoformat(str(point[0])[:10]).isoformat()
        except ValueError:
            continue
        cents = point[1]
        if not isinstance(cents, (int, float)) or isinstance(cents, bool) or not math.isfinite(cents) or cents <= 0 or cents > 10**12:
            continue
        price = round(cents / 100, 2)
        rows[day] = {"date": day, "lowest": price, "median": price}
    if len(rows) < 2:
        raise ValueError("页面没有至少两个有效历史价格点")
    return {"name": name, "source": "CSGOSKINS.GG 页面 · Lowest Price · USD", "source_url": source_url,
            "currency": "USD",
            "metric_only": "lowest", "rows": sorted(rows.values(), key=lambda x: x["date"])}


def downsample(rows: list[dict], granularity: str = "month") -> list[dict]:
    ordered = sorted(rows, key=lambda row: row["date"])
    if granularity == "day" or not ordered:
        return ordered
    if granularity not in ("week", "month", "quarter"):
        raise ValueError("不支持的取点间隔")
    buckets: dict[str, dict] = {}
    for row in ordered:
        day = date.fromisoformat(row["date"])
        if granularity == "week":
            key = f"{day.isocalendar().year}-{day.isocalendar().week:02}"
        elif granularity == "quarter":
            key = f"{day.year}-Q{(day.month - 1) // 3 + 1}"
        else:
            key = day.strftime("%Y-%m")
        buckets[key] = row
    result = [ordered[0]]
    result.extend(row for row in buckets.values() if row["date"] != result[0]["date"])
    return result


def normalize(rows: list[dict], field: str = "median") -> list[dict]:
    base = next((r[field] for r in rows if r.get(field)), None)
    if base is None:
        raise ValueError("没有可用于归一化的起始价格")
    return [{**r, "normalized": (r[field] / base * 100) if r.get(field) else None} for r in rows]
