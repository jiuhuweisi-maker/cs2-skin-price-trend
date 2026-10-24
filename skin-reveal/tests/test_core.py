import pytest
from fastapi import HTTPException

from core import downsample, match_name, normalize, parse_csv, parse_official_history, parse_site_history, resolve_item, site_item_path, site_search_terms, split_names


def test_csv_and_normalization():
    item = parse_csv(b"date,price\n2020-01-01,10\n2020-02-01,20\n", "test")
    assert item["rows"][1]["median"] == 20
    assert normalize(item["rows"])[1]["normalized"] == 200


def test_official_documented_shape():
    text = '{"data":[{"market_hash_name":"AWP | Dragon Lore","dates":[{"date":"2026-01-01","prices":[{"market":"steam","price":1200},{"market":"other","price":1000}]},{"date":"2026-01-02","prices":[{"market":"steam","price":1400}]}]}]}'
    item = parse_official_history(text, "AWP | Dragon Lore")
    assert item["rows"][0]["lowest"] == 10
    assert item["rows"][0]["median"] == 11


def test_aliases_and_split():
    assert split_names("龙狙、咆哮\nHowl") == ["龙狙", "咆哮", "Howl"]
    assert match_name("龙狙")[0] == "AWP | Dragon Lore"


def test_doppler_phase_and_wear_resolution():
    ruby = resolve_item("红宝石蝴蝶刀 崭新出厂")
    assert ruby["match"] == "★ Butterfly Knife | Doppler"
    assert ruby["phase"] == "Ruby"
    assert ruby["wear"] == "Factory New"
    assert ruby["market_hash_name"] == "★ Butterfly Knife | Doppler (Factory New)"
    assert resolve_item("Butterfly Knife Doppler Ruby MW")["wear"] == "Minimal Wear"
    assert resolve_item("暗金红宝石蝴蝶刀 崭新")["market_hash_name"] == "★ StatTrak™ Butterfly Knife | Doppler (Factory New)"
    assert resolve_item("红宝石蝴蝶刀 久经沙场")["match"] == ""


def test_official_phase_is_required_when_name_is_ambiguous():
    name = "★ Butterfly Knife | Doppler (Factory New)"
    entries = [{"market_hash_name": name, "phase": phase, "dates": [
        {"date": "2026-01-01", "prices": [{"price": price}]},
        {"date": "2026-01-02", "prices": [{"price": price + 100}]}
    ]} for phase, price in [("Ruby", 1000000), ("Phase 2", 200000)]]
    import json
    payload = json.dumps({"data": entries})
    with pytest.raises(ValueError, match="phase"):
        parse_official_history(payload, name)
    ruby = parse_official_history(payload, name, "Ruby")
    assert ruby["phase"] == "Ruby"
    assert ruby["rows"][0]["median"] == 10000


def test_site_chart_identity_and_usd_cents():
    path = site_item_path("★ Butterfly Knife | Doppler (Factory New)", "Ruby")
    assert path == "/items/butterfly-knife-doppler-ruby/factory-new"
    assert site_item_path("★ StatTrak™ Butterfly Knife | Doppler (Minimal Wear)", "Ruby").endswith("/stattrak-minimal-wear")
    item = parse_site_history([["2020-05-29", 356000, 1, 1], ["2020-09-29", 423412, 1, 1]],
                              "★ Butterfly Knife | Doppler (Factory New) · Ruby", "https://csgoskins.gg" + path)
    assert item["rows"][0]["lowest"] == 3560
    assert item["rows"][1]["lowest"] == 4234.12
    assert item["metric_only"] == "lowest"


def test_site_search_chinese_and_exact_catalog_result():
    import app as server
    assert site_search_terms("蝴蝶刀传说") == "Butterfly Knife Lore"
    assert site_search_terms("蝴蝶刀传説") == "Butterfly Knife Lore"
    assert site_search_terms("Butterfly Knfie Lore") == "Butterfly Knife Lore"
    assert site_search_terms("AWP | 巨龙传说") == "AWP Dragon Lore"
    assert site_search_terms("红宝石蝴蝶刀 崭新出厂") == "Butterfly Knife Doppler Ruby"
    job = server.site_search_start(server.SiteSearchRequest(query="蝴蝶刀传说"))
    assert "Butterfly%20Knife%20Lore" in job["url"]
    server.site_search_receive(job["id"], server.SiteSearchResults(
        url=job["url"].split("#")[0], results=[
            {"name": "★ Butterfly Knife | Fade", "path": "/items/butterfly-knife-fade", "default_path": "/items/butterfly-knife-fade/factory-new"},
            {"name": "★ Butterfly Knife | Lore", "path": "/items/butterfly-knife-lore", "default_path": "/items/butterfly-knife-lore/factory-new"},
            {"name": "Fake", "path": "/other/fake"},
        ]))
    results = server.site_search_status(job["id"])["results"]
    assert results[0]["path"] == "/items/butterfly-knife-lore"
    assert results[0]["default_path"].endswith("/factory-new")
    assert len(results) == 2


def test_page_import_rejects_other_variant_and_saves_exact_page(tmp_path, monkeypatch):
    import app as server
    monkeypatch.setattr(server, "DB", tmp_path / "test.sqlite3")
    job = server.page_import_start(server.PageStartRequest(
        market_hash_name="★ Butterfly Knife | Doppler (Factory New)", phase="Ruby"))
    points = [["2020-05-29", 356000, 1, 1], ["2020-09-29", 423412, 1, 1]]
    with pytest.raises(HTTPException, match="页面与所选"):
        server.page_import_receive(job["id"], server.PageDataRequest(
            url="https://csgoskins.gg/items/butterfly-knife-doppler/factory-new", points=points))
    result = server.page_import_receive(job["id"], server.PageDataRequest(
        url=job["url"].split("#")[0], points=points))
    assert server.page_import_status(job["id"])["item_id"] == result["id"]
    with server.connection() as db:
        saved = db.execute("SELECT name,payload FROM series").fetchone()
    assert "Ruby" in saved["name"]
    assert len(__import__("json").loads(saved["payload"])["rows"]) == 2


def test_downsample():
    rows = [{"date": "2020-01-01"}, {"date": "2020-01-10"}, {"date": "2020-02-01"}, {"date": "2020-04-01"}]
    assert downsample(rows, "month") == rows
    assert downsample(rows, "quarter") == [rows[0], rows[2], rows[3]]


def test_expired_export_frames_are_cleaned(tmp_path, monkeypatch):
    import os
    import time
    import app as server
    monkeypatch.setattr(server, "EXPORTS", tmp_path)
    root = tmp_path / ".frames"
    expired, active = root / "expired", root / "active"
    expired.mkdir(parents=True)
    active.mkdir()
    old = time.time() - 3 * 60 * 60
    os.utime(expired, (old, old))
    server.cleanup_expired_frame_jobs()
    assert not expired.exists()
    assert active.exists()
