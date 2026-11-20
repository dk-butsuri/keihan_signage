"""季節の装飾（templates/seasons/）を配る。

装飾1つ = フォルダ1つ（theme.css と theme.js）。画面は共通の templates/minimal/seasonal.js を読み、
端末（controller）から知らされた装飾のフォルダだけを読み込む。デモのページは /demo/ の下から同じものを読む。
"""
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

SEASONS_DIR = Path(__file__).parent / "templates" / "seasons"
_TYPES = {".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
          ".png": "image/png", ".webp": "image/webp"}
_HEADERS = {"Cache-Control": "no-store"}

router = APIRouter()


def season_ids() -> list[str]:
    return sorted(p.name for p in SEASONS_DIR.iterdir() if p.is_dir() and (p / "theme.js").is_file())


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
