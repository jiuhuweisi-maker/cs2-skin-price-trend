"""Small, honest connectivity probe for the sources used by Skin Reveal."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

UA = "SkinReveal/1.0 (personal research)"
TARGETS = {
    "official_docs": "https://csgoskins.gg/docs/",
    "official_history_api": "https://csgoskins.gg/api/v1/price-histories?range=7d&limit=1",
    "item_page": "https://csgoskins.gg/items/awp-dragon-lore/stats?currency=USD",
}


def probe(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json,text/html"})
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            sample = response.read(800).decode("utf-8", "replace")
            return {"status": response.status, "content_type": response.headers.get("Content-Type"), "sample": sample[:280]}
    except urllib.error.HTTPError as exc:
        sample = exc.read(400).decode("utf-8", "replace")
        return {"status": exc.code, "error": sample[:200]}
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}


if __name__ == "__main__":
    print("proxy environment:", {k: bool(os.environ.get(k)) for k in ("HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY")})
    for name, url in TARGETS.items():
        print(name, json.dumps(probe(url), ensure_ascii=False))
