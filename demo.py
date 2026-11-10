from pathlib import Path
import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from demo_scenarios import SCENARIOS, display_patterns, static_scenario


router = APIRouter()
DATA_FILE = Path(__file__).parent / "demo-data/replay.json"
PLAYER_FILE = Path(__file__).parent / "templates/minimal/demo.js"
PATTERN_PLAYER_FILE = PLAYER_FILE.with_name("demo-patterns.js")
INTRO_PLAYER_FILE = PLAYER_FILE.with_name("demo-intro.js")
ASSEMBLY_PLAYER_FILE = PLAYER_FILE.with_name("assembly.js")
MARKED_FILE = PLAYER_FILE.with_name("marked.min.js")
README_FILE = Path(__file__).parent / "README.md"
README_IMAGES = Path(__file__).parent / "docs/readme"
templates = Jinja2Templates(directory=str(PLAYER_FILE.parent))
_HEADERS = {"Cache-Control": "no-store"}


def _catalog():
    return [{**scenario, "available": scenario["mode"] != "replay" or DATA_FILE.is_file()} for scenario in SCENARIOS]


def _scenario(scenario_id):
    scenario = next((scenario for scenario in SCENARIOS if scenario["id"] == scenario_id), None)
    if scenario is None:
        raise HTTPException(404, "デモが見つかりません")
    return scenario


def _recording():
    if not DATA_FILE.is_file():
        raise HTTPException(503, "再生用の記録がまだ用意されていません")
    return FileResponse(DATA_FILE, media_type="application/json", headers=_HEADERS)


@router.api_route("/demo", methods=["GET", "HEAD"], response_class=HTMLResponse)
@router.api_route("/demo/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def catalog(request: Request):
    return templates.TemplateResponse(request, "demo-catalog.html", {"demos": _catalog()}, headers=_HEADERS)


@router.api_route("/demo/readme", methods=["GET", "HEAD"], response_class=HTMLResponse)
@router.api_route("/demo/readme/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def readme(request: Request):
    return templates.TemplateResponse(request, "demo-readme.html", {}, headers=_HEADERS)


@router.api_route("/demo/readme/README.md", methods=["GET", "HEAD"])
async def readme_text():
    return FileResponse(README_FILE, media_type="text/markdown; charset=utf-8", headers=_HEADERS)


@router.api_route("/demo/readme/marked.js", methods=["GET", "HEAD"])
async def readme_renderer():
    return FileResponse(MARKED_FILE, media_type="text/javascript", headers=_HEADERS)


@router.api_route("/demo/readme/images/{name}", methods=["GET", "HEAD"])
async def readme_image(name: str):
    path = README_IMAGES / name
    if not re.fullmatch(r"[a-z0-9-]+\.png", name) or not path.is_file():
        raise HTTPException(404, "画像が見つかりません")
    return FileResponse(path, media_type="image/png", headers=_HEADERS)


@router.api_route("/demo/data", methods=["GET", "HEAD"])
async def legacy_data():
    return _recording()


@router.api_route("/demo/player.js", methods=["GET", "HEAD"])
async def legacy_player():
    return FileResponse(PLAYER_FILE, media_type="text/javascript", headers=_HEADERS)


@router.api_route("/demo/{scenario_id}/data", methods=["GET", "HEAD"])
async def data(scenario_id: str):
    scenario = _scenario(scenario_id)
    if scenario["mode"] == "replay":
        return _recording()
    if scenario["mode"] == "gallery":
        return JSONResponse(display_patterns(), headers=_HEADERS)
    if scenario["mode"] == "intro":
        raise HTTPException(404, "このデモに運行データはありません")
    return JSONResponse(static_scenario(scenario_id), headers=_HEADERS)


@router.api_route("/demo/{scenario_id}/player.js", methods=["GET", "HEAD"])
async def player(scenario_id: str):
    scenario = _scenario(scenario_id)
    player_file = {"gallery": PATTERN_PLAYER_FILE, "intro": INTRO_PLAYER_FILE}.get(scenario["mode"], PLAYER_FILE)
    return FileResponse(player_file, media_type="text/javascript", headers=_HEADERS)


@router.api_route("/demo/{scenario_id}/assembly.js", methods=["GET", "HEAD"])
async def assembly_player(scenario_id: str):
    if _scenario(scenario_id)["mode"] != "intro":
        raise HTTPException(404, "このデモに組み上げ演出はありません")
    return FileResponse(ASSEMBLY_PLAYER_FILE, media_type="text/javascript", headers=_HEADERS)


@router.api_route("/demo/{scenario_id}", methods=["GET", "HEAD"], response_class=HTMLResponse)
@router.api_route("/demo/{scenario_id}/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def display(scenario_id: str, request: Request):
    scenario = _scenario(scenario_id)
    if scenario["mode"] == "intro":
        return templates.TemplateResponse(request, "demo-intro.html",
                                          {"demo": scenario, "demos": _catalog()}, headers=_HEADERS)
    if scenario["mode"] == "gallery":
        return templates.TemplateResponse(request, "demo-patterns.html",
                                          {"demo": scenario, "demos": _catalog()}, headers=_HEADERS)
    if scenario["mode"] == "replay" and not DATA_FILE.is_file():
        raise HTTPException(503, "再生用の記録がまだ用意されていません")
    return templates.TemplateResponse(request, "index.html", {
        "station_name": "", "config": {"demo": {**scenario, "catalog": _catalog()},
            "features": {"trains": True, "buses": True, "delays": True}, "buses": {"stop_name": "同志社香里"}},
    }, headers=_HEADERS)
