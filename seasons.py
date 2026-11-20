"""季節の装飾（templates/seasons/）を配る。

装飾1つ = フォルダ1つ（theme.css・theme.js・meta.json）。画面は共通の templates/minimal/seasonal.js を読み、
端末（controller）から知らされた装飾のフォルダだけを読み込む。デモのページは /demo/ の下から同じものを読む。
meta.json は管理画面での名前と、管理画面で変えていないときの期間。controller は /api/status の seasons から読む。
"""
import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

SEASONS_DIR = Path(__file__).parent / "templates" / "seasons"
_TYPES = {".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
          ".png": "image/png", ".webp": "image/webp"}
_HEADERS = {"Cache-Control": "no-store"}

router = APIRouter()


_MONTH_DAY = re.compile(r"(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])")


def season_ids() -> list[str]:
    return sorted(p.name for p in SEASONS_DIR.iterdir() if p.is_dir() and (p / "theme.js").is_file())


def read_meta(season: str) -> dict:
    meta = json.loads((SEASONS_DIR / season / "meta.json").read_text(encoding="utf-8"))
    if not (isinstance(meta.get("label"), str) and meta["label"]
            and all(isinstance(meta.get(k), str) and _MONTH_DAY.fullmatch(meta[k]) for k in ("from", "to"))):
        raise ValueError(f"{season}/meta.json needs label, from and to (MM-DD)")
    return {"id": season, "label": meta["label"], "from": meta["from"], "to": meta["to"]}


def catalog() -> list[dict]:
    """装飾の一覧（期間の始まりが早い順）。meta.json が無い・壊れているフォルダは載せない"""
    items = []
    for season in season_ids():
        try:
            items.append(read_meta(season))
        except (OSError, ValueError):
            pass
    return sorted(items, key=lambda item: (item["from"], item["id"]))


@router.api_route("/assets/seasonal.js", methods=["GET", "HEAD"])
@router.api_route("/demo/assets/seasonal.js", methods=["GET", "HEAD"])
async def seasonal_loader():
    return FileResponse(SEASONS_DIR.parent / "minimal" / "seasonal.js", media_type="text/javascript", headers=_HEADERS)


@router.api_route("/assets/seasons/{season}/{name}", methods=["GET", "HEAD"])
@router.api_route("/demo/assets/seasons/{season}/{name}", methods=["GET", "HEAD"])
async def season_file(season: str, name: str):
    # 実在するフォルダとファイルの名前に一致したものだけを返す（パスを組み立てて外へ出られないように）
    if season not in season_ids():
        raise HTTPException(404, "Not Found")
    files = {p.name: p for p in (SEASONS_DIR / season).iterdir() if p.is_file() and p.suffix in _TYPES}
    if name not in files:
        raise HTTPException(404, "Not Found")
    return FileResponse(files[name], media_type=_TYPES[files[name].suffix], headers=_HEADERS)
