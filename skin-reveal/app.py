"""Local-only Skin Reveal server. Run: python app.py"""
from __future__ import annotations

import json
import re
import threading
import shutil
import sqlite3
import subprocess
import tempfile
import time
import uuid
import webbrowser
from pathlib import Path
from urllib.parse import quote, urlparse

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from core import ALIASES, canonical_site_name, parse_csv, parse_official_history, parse_site_history, rank_site_results, resolve_item, site_item_path, site_search_terms, split_names

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
EXPORTS = ROOT / "exports"
DATA.mkdir(exist_ok=True)
EXPORTS.mkdir(exist_ok=True)
DB = DATA / "skin_reveal.sqlite3"
PAGE_JOBS: dict[str, dict] = {}
PAGE_JOBS_LOCK = threading.Lock()


def connection():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    db.execute("CREATE TABLE IF NOT EXISTS series (id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL, payload TEXT NOT NULL, updated REAL NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS presets (id TEXT PRIMARY KEY, title TEXT NOT NULL, payload TEXT NOT NULL, updated REAL NOT NULL)")
    return db


app = FastAPI(title="CS 饰品 Reveal 走势图", version="1.0")


class NamesRequest(BaseModel):
    text: str


class JsonRequest(BaseModel):
    text: str
    name: str
    phase: str | None = None


class PresetRequest(BaseModel):
    title: str
    config: dict


class ExportRequest(BaseModel):
    format: str = "mp4"
    fps: int = 30
    frames: int


class PageStartRequest(BaseModel):
    market_hash_name: str
    phase: str | None = None
    site_path: str | None = None


class SiteSearchRequest(BaseModel):
    query: str


class SiteSearchResults(BaseModel):
    url: str
    results: list[dict]


class PageDataRequest(BaseModel):
    url: str
    points: list[list]
    name: str | None = None


class PageErrorRequest(BaseModel):
    error: str


@app.get("/api/health")
def health():
    return {"ok": True, "ffmpeg": bool(shutil.which("ffmpeg")), "time": time.time()}


@app.get("/api/catalog")
def catalog():
    with connection() as db:
        series = [{**json.loads(r["payload"]), "updated": r["updated"]} for r in db.execute("SELECT * FROM series ORDER BY updated DESC")]
    return {"series": series, "aliases": ALIASES}


@app.post("/api/match")
def match(req: NamesRequest):
    with connection() as db:
        names = [r[0] for r in db.execute("SELECT name FROM series")]
    return [resolve_item(q, names) for q in split_names(req.text)]


@app.post("/api/page-import/start")
def page_import_start(req: PageStartRequest):
    try:
        path = req.site_path or site_item_path(req.market_hash_name.strip(), req.phase)
        if not re.fullmatch(r"/items/[a-z0-9-]+(?:/(?:stattrak-)?(?:factory-new|minimal-wear|field-tested|well-worn|battle-scarred))?", path):
            raise ValueError("网站饰品链接无效")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    job_id = str(uuid.uuid4())
    with PAGE_JOBS_LOCK:
        for old_id, job in list(PAGE_JOBS.items()):
            if time.time() - job["created"] > 600:
                del PAGE_JOBS[old_id]
        PAGE_JOBS[job_id] = {"created": time.time(), "status": "waiting", "path": path,
                             "name": req.market_hash_name.strip() + (f" · {req.phase}" if req.phase else "")}
    return {"id": job_id, "url": f"https://csgoskins.gg{path}#skin-reveal-job={job_id}"}


@app.post("/api/site-search/start")
def site_search_start(req: SiteSearchRequest):
    query = req.query.strip()[:120]
    terms = site_search_terms(query)
    if not query or not terms:
        raise HTTPException(400, "请填写饰品名称")
    job_id = str(uuid.uuid4())
    with PAGE_JOBS_LOCK:
        PAGE_JOBS[job_id] = {"created": time.time(), "status": "waiting", "kind": "search", "query": query}
    return {"id": job_id, "url": f"https://csgoskins.gg/?query={quote(terms)}#skin-reveal-search={job_id}", "terms": terms}


@app.get("/api/site-search/{job_id}")
def site_search_status(job_id: str):
    with PAGE_JOBS_LOCK:
        job = PAGE_JOBS.get(job_id)
        if not job or job.get("kind") != "search":
            raise HTTPException(404, "搜索任务不存在或已过期")
        return {"status": job["status"], "results": job.get("results", []), "error": job.get("error")}


@app.post("/api/site-search/{job_id}")
def site_search_receive(job_id: str, req: SiteSearchResults):
    parsed = urlparse(req.url)
    if parsed.scheme != "https" or parsed.hostname != "csgoskins.gg" or parsed.path not in ("", "/"):
        raise HTTPException(400, "搜索结果不是 CSGOSKINS.GG 页面")
    with PAGE_JOBS_LOCK:
        job = PAGE_JOBS.get(job_id)
        if not job or job.get("kind") != "search" or time.time() - job["created"] > 600:
            raise HTTPException(404, "搜索任务不存在或已过期")
        cleaned = []
        for row in req.results[:100]:
            name, path = str(row.get("name", ""))[:120].strip(), str(row.get("path", ""))
            default_path = str(row.get("default_path", ""))
            if name and re.fullmatch(r"/items/[a-z0-9-]+", path):
                if not re.fullmatch(re.escape(path) + r"/(?:factory-new|minimal-wear|field-tested|well-worn|battle-scarred)", default_path):
                    default_path = path
                cleaned.append({"name": canonical_site_name(name), "path": path, "default_path": default_path})
        job["results"] = rank_site_results(job["query"], cleaned)[:30]
        job["status"] = "ready"
    return {"count": len(job["results"])}


@app.get("/api/page-import/{job_id}")
def page_import_status(job_id: str):
    with PAGE_JOBS_LOCK:
        job = PAGE_JOBS.get(job_id)
        if not job:
            raise HTTPException(404, "读取任务不存在或已过期")
        return {"status": job["status"], "item_id": job.get("item_id"), "error": job.get("error")}


@app.post("/api/page-import/{job_id}")
def page_import_receive(job_id: str, req: PageDataRequest):
    with PAGE_JOBS_LOCK:
        job = PAGE_JOBS.get(job_id)
        if not job or time.time() - job["created"] > 600:
            raise HTTPException(404, "读取任务不存在或已过期")
        if job["status"] == "ready":
            return {"id": job["item_id"]}
        path = job["path"]
        name = job["name"]
    parsed = urlparse(req.url)
    if parsed.scheme != "https" or parsed.hostname != "csgoskins.gg" or parsed.path.rstrip("/") != path:
        raise HTTPException(400, "页面与所选饰品、磨损度或相位不符")
    if req.name and req.name.startswith(("★ ", "AWP |", "AK-47 |", "M4A4 |", "M4A1-S |", "USP-S |", "Glock-18 |", "Desert Eagle |")):
        name = req.name[:120] + (" · " + path.split("/")[-1] if path.count("/") >= 3 else "")
    try:
        item = parse_site_history(req.points, name, f"https://csgoskins.gg{path}")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    with connection() as db:
        existing = next((r for r in db.execute("SELECT id,payload FROM series WHERE source=?", (item["source"],))
                         if json.loads(r["payload"]).get("source_url") == item["source_url"]), None)
        item["id"] = existing["id"] if existing else str(uuid.uuid4())
        if existing:
            db.execute("UPDATE series SET name=?,payload=?,updated=? WHERE id=?",
                       (item["name"], json.dumps(item, ensure_ascii=False), time.time(), item["id"]))
        else:
            db.execute("INSERT INTO series VALUES (?,?,?,?,?)",
                       (item["id"], item["name"], item["source"], json.dumps(item, ensure_ascii=False), time.time()))
    with PAGE_JOBS_LOCK:
        job["status"] = "ready"
        job["item_id"] = item["id"]
    return {"id": item["id"], "points": len(item["rows"])}


@app.post("/api/page-import/{job_id}/error")
def page_import_error(job_id: str, req: PageErrorRequest):
    with PAGE_JOBS_LOCK:
        job = PAGE_JOBS.get(job_id)
        if not job:
            raise HTTPException(404, "读取任务不存在或已过期")
        if job["status"] == "waiting":
            job["status"] = "error"
            job["error"] = req.error[:180]
    return {"ok": True}


@app.post("/api/import/csv")
async def import_csv(file: UploadFile = File(...), name: str = Form(""), currency: str = Form("CNY")):
    raw = await file.read()
    if len(raw) > 10_000_000:
        raise HTTPException(413, "CSV 超过 10 MB")
    display = name.strip() or Path(file.filename or "导入数据").stem
    try:
        item = parse_csv(raw, display, currency)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    item["id"] = str(uuid.uuid4())
    if "演示" in display:
        item["source"] = "演示 CSV（合成数据）"
    with connection() as db:
        db.execute("INSERT INTO series VALUES (?,?,?,?,?)", (item["id"], item["name"], item["source"], json.dumps(item, ensure_ascii=False), time.time()))
    return item


@app.post("/api/import/json")
def import_json(req: JsonRequest):
    try:
        item = parse_official_history(req.text, req.name.strip(), req.phase)
    except (ValueError, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(400, str(exc)) from exc
    item["id"] = str(uuid.uuid4())
    with connection() as db:
        db.execute("INSERT INTO series VALUES (?,?,?,?,?)", (item["id"], item["name"], item["source"], json.dumps(item, ensure_ascii=False), time.time()))
    return item


@app.delete("/api/series/{item_id}")
def delete_series(item_id: str):
    with connection() as db:
        db.execute("DELETE FROM series WHERE id=?", (item_id,))
    return {"ok": True}


@app.get("/api/presets")
def presets():
    with connection() as db:
        return [{"id": r["id"], "title": r["title"], "config": json.loads(r["payload"]), "updated": r["updated"]} for r in db.execute("SELECT * FROM presets ORDER BY updated DESC")]


@app.post("/api/presets")
def save_preset(req: PresetRequest):
    preset_id = str(uuid.uuid4())
    with connection() as db:
        db.execute("INSERT INTO presets VALUES (?,?,?,?)", (preset_id, req.title[:80].strip() or "未命名预设", json.dumps(req.config, ensure_ascii=False), time.time()))
    return {"id": preset_id}


@app.delete("/api/presets/{preset_id}")
def delete_preset(preset_id: str):
    with connection() as db:
        db.execute("DELETE FROM presets WHERE id=?", (preset_id,))
    return {"ok": True}


def frame_job(job_id: str) -> Path:
    try:
        safe_id = str(uuid.UUID(job_id))
    except ValueError as exc:
        raise HTTPException(404, "导出任务不存在") from exc
    folder = EXPORTS / ".frames" / safe_id
    if not folder.is_dir():
        raise HTTPException(404, "导出任务不存在")
    return folder


def cleanup_expired_frame_jobs(max_age: int = 2 * 60 * 60) -> None:
    """Remove abandoned frame uploads so interrupted exports cannot fill disk."""
    root = EXPORTS / ".frames"
    if not root.is_dir():
        return
    cutoff = time.time() - max_age
    for folder in root.iterdir():
        if not folder.is_dir():
            continue
        try:
            if folder.stat().st_mtime < cutoff:
                shutil.rmtree(folder)
        except OSError:
            # A concurrent export may still be writing this folder.
            continue


@app.post("/api/export/start")
def export_start(req: ExportRequest):
    if req.format not in ("mp4", "gif", "webm") or req.fps not in (24, 30) or not 1 <= req.frames <= 1800:
        raise HTTPException(400, "导出参数无效")
    if not shutil.which("ffmpeg"):
        raise HTTPException(503, "未找到 ffmpeg")
    cleanup_expired_frame_jobs()
    job_id = str(uuid.uuid4())
    folder = EXPORTS / ".frames" / job_id
    folder.mkdir(parents=True)
    (folder / "job.json").write_text(json.dumps(req.model_dump()), encoding="utf-8")
    return {"id": job_id}


@app.post("/api/export/{job_id}/batch")
async def export_batch(job_id: str, request: Request, start: int):
    folder = frame_job(job_id)
    config = json.loads((folder / "job.json").read_text(encoding="utf-8"))
    body = await request.body()
    if len(body) > 30_000_000 or start < 0 or start >= config["frames"]:
        raise HTTPException(413, "帧批次过大或编号无效")
    position = 0
    index = start
    while position < len(body):
        if position + 4 > len(body):
            raise HTTPException(400, "帧数据不完整")
        length = int.from_bytes(body[position:position + 4], "little")
        position += 4
        if length < 100 or length > 2_000_000 or position + length > len(body) or index >= config["frames"]:
            raise HTTPException(400, "JPEG 帧无效")
        frame = body[position:position + length]
        if not frame.startswith(b"\xff\xd8") or not frame.endswith(b"\xff\xd9"):
            raise HTTPException(400, "帧不是 JPEG")
        (folder / f"frame-{index:05}.jpg").write_bytes(frame)
        position += length
        index += 1
    return {"accepted": index - start}


@app.post("/api/export/{job_id}/finish")
def export_finish(job_id: str):
    folder = frame_job(job_id)
    config = json.loads((folder / "job.json").read_text(encoding="utf-8"))
    count = len(list(folder.glob("frame-*.jpg")))
    if count != config["frames"]:
        raise HTTPException(400, f"只收到 {count}/{config['frames']} 帧")
    output = EXPORTS / f"skin-reveal-{int(time.time())}-{uuid.uuid4().hex[:6]}.{config['format']}"
    source = str(folder / "frame-%05d.jpg")
    base = ["ffmpeg", "-y", "-framerate", str(config["fps"]), "-i", source]
    if config["format"] == "mp4":
        cmd = base + ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output)]
    elif config["format"] == "gif":
        cmd = base + ["-vf", "fps=12,scale=540:-1:flags=lanczos", "-loop", "0", str(output)]
    else:
        cmd = base + ["-an", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "5", "-b:v", "2M", str(output)]
    try:
        done = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
        if done.returncode:
            raise HTTPException(500, "ffmpeg 合成失败：" + done.stderr[-350:])
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        output.unlink(missing_ok=True)
        raise
    shutil.rmtree(folder, ignore_errors=True)
    return {"url": f"/exports/{output.name}", "bytes": output.stat().st_size, "frames": count}


@app.post("/api/convert")
async def convert(file: UploadFile = File(...), format: str = Form("mp4")):
    if format not in ("mp4", "gif", "webm"):
        raise HTTPException(400, "不支持的导出格式")
    if format != "webm" and not shutil.which("ffmpeg"):
        raise HTTPException(503, "未找到 ffmpeg；请导出 WebM 或安装 ffmpeg")
    output = EXPORTS / f"skin-reveal-{int(time.time())}-{uuid.uuid4().hex[:6]}.{format}"
    with tempfile.TemporaryDirectory() as temp:
        source = Path(temp) / "capture.webm"
        total = 0
        with source.open("wb") as f:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > 300_000_000:
                    raise HTTPException(413, "视频超过 300 MB")
                f.write(chunk)
        if format == "webm":
            shutil.copy2(source, output)
        else:
            if format == "mp4":
                cmd = ["ffmpeg", "-y", "-i", str(source), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "29", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output)]
            else:
                cmd = ["ffmpeg", "-y", "-i", str(source), "-vf", "fps=12,scale=540:-1:flags=lanczos", "-loop", "0", str(output)]
            done = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if done.returncode:
                raise HTTPException(500, "ffmpeg 转换失败：" + done.stderr[-350:])
    return {"url": f"/exports/{output.name}", "bytes": output.stat().st_size}


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html")


app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
app.mount("/exports", StaticFiles(directory=EXPORTS), name="exports")
app.mount("/samples", StaticFiles(directory=ROOT / "samples"), name="samples")


if __name__ == "__main__":
    import threading
    import uvicorn

    threading.Timer(1.0, lambda: webbrowser.open("http://127.0.0.1:8765")).start()
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
