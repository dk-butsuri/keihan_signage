from pathlib import Path
import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from demo_scenarios import SCENARIOS, display_patterns, static_scenario
import weather_demo
import demo_playground


router = APIRouter()
DATA_FILE = Path(__file__).parent / "demo-data/replay.json"
PLAYER_FILE = Path(__file__).parent / "templates/minimal/demo.js"
PATTERN_PLAYER_FILE = PLAYER_FILE.with_name("demo-patterns.js")
INTRO_PLAYER_FILE = PLAYER_FILE.with_name("demo-intro.js")
ATLAS_MAP_FILE = PLAYER_FILE.with_name("demo-intro-atlas-map.json")
WEATHER_PLAYER_FILE = PLAYER_FILE.with_name("demo-weather.js")
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
    if not re.fullmatch(r"[a-z0-9-]+\.(png|gif)", name) or not path.is_file():
        raise HTTPException(404, "画像が見つかりません")
    return FileResponse(path, media_type="image/" + name.rsplit(".", 1)[1], headers=_HEADERS)


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
    if scenario["mode"] == "playground":
        return JSONResponse(jsonable_encoder(demo_playground.bootstrap()), headers=_HEADERS)
    if scenario["mode"] in ("intro", "chime", "weather", "clock"):
        raise HTTPException(404, "このデモに運行データはありません")
    return JSONResponse(static_scenario(scenario_id), headers=_HEADERS)


@router.post("/demo/playground/evaluate")
async def playground_evaluate(state: demo_playground.PlaygroundState):
    try:
        return JSONResponse(jsonable_encoder(demo_playground.evaluate(state)), headers=_HEADERS)
    except ValueError as error:
        raise HTTPException(400, str(error))


@router.api_route("/demo/playground/preview", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def playground_preview(request: Request):
    return templates.TemplateResponse(request, "index.html", {
        "station_name": "", "config": {"demo": {"id": "playground", "mode": "playground-preview"},
            "features": {"trains": True, "buses": True, "delays": True},
            "buses": {"stop_name": "同志社香里"}},
    }, headers=_HEADERS)


@router.api_route("/demo/playground/preview/player.js", methods=["GET", "HEAD"])
async def playground_preview_player():
    return FileResponse(PLAYER_FILE.with_name("demo-preview.js"), media_type="text/javascript", headers=_HEADERS)


@router.api_route("/demo/{scenario_id}/weather", methods=["GET", "HEAD"])
async def weather_cards(scenario_id: str, state: str = "{}"):
    if _scenario(scenario_id)["mode"] != "weather":
        raise HTTPException(404, "このデモに気象警報の判定はありません")
    try:
        return JSONResponse(weather_demo.evaluate(state), headers=_HEADERS)
    except (ValueError, KeyError, TypeError) as error:
        raise HTTPException(400, f"状況の指定が読めません: {error}")


@router.api_route("/demo/{scenario_id}/player.js", methods=["GET", "HEAD"])
async def player(scenario_id: str):
    scenario = _scenario(scenario_id)
    player_file = {"gallery": PATTERN_PLAYER_FILE, "intro": INTRO_PLAYER_FILE,
                   "chime": PLAYER_FILE.with_name("demo-chime.js"), "weather": WEATHER_PLAYER_FILE,
                   "playground": PLAYER_FILE.with_name("demo-playground.js")}.get(scenario["mode"], PLAYER_FILE)
    if scenario.get("variant") == "atlas":
        player_file = PLAYER_FILE.with_name("demo-clock-atlas.js" if scenario["mode"] == "clock" else "demo-intro-atlas.js")
    return FileResponse(player_file, media_type="text/javascript", headers=_HEADERS)


@router.api_route("/demo/{scenario_id}/chime-core.js", methods=["GET", "HEAD"])
async def chime_core(scenario_id: str):
    if _scenario(scenario_id)["mode"] != "chime":
        raise HTTPException(404, "このデモに時報の演出はありません")
    return FileResponse(PLAYER_FILE.with_name("chime-core.js"), media_type="text/javascript", headers=_HEADERS)


@router.api_route("/demo/{scenario_id}/weather.js", methods=["GET", "HEAD"])
async def weather_renderer(scenario_id: str):
    if _scenario(scenario_id)["mode"] not in ("weather", "clock"):
        raise HTTPException(404, "このデモに気象警報の札はありません")
    return FileResponse(PLAYER_FILE.with_name("weather.js"), media_type="text/javascript", headers=_HEADERS)


@router.api_route("/demo/{scenario_id}/map.json", methods=["GET", "HEAD"])
async def atlas_map(scenario_id: str):
    if _scenario(scenario_id).get("variant") != "atlas":
        raise HTTPException(404, "このデモに地図はありません")
    return FileResponse(ATLAS_MAP_FILE, media_type="application/json", headers=_HEADERS)


THUMBS = Path(__file__).parent / "docs/demo-thumbs"


@router.api_route("/demo/{scenario_id}/thumb.jpg", methods=["GET", "HEAD"])
async def thumbnail(scenario_id: str):
    # 一覧のサムネイル。tools/build_demo_thumbs.cjs で撮り直す
    path = THUMBS / (_scenario(scenario_id)["id"] + ".jpg")
    if not path.is_file():
        raise HTTPException(404, "サムネイルがありません")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})


@router.api_route("/demo/{scenario_id}/assembly.js", methods=["GET", "HEAD"])
async def assembly_player(scenario_id: str):
    if _scenario(scenario_id)["mode"] != "intro":
        raise HTTPException(404, "このデモに組み上げ演出はありません")
    return FileResponse(ASSEMBLY_PLAYER_FILE, media_type="text/javascript", headers=_HEADERS)


# サイネージの時計の画面。デモの時計「測量」を、見出しや操作の部品を除いて画面いっぱいに出す。
# 端末は controller の /clock/ から開く（controller が transit の /clock/ に中継する）。
CLOCK_SCENARIO = "clock-atlas"


@router.api_route("/clock", methods=["GET", "HEAD"], response_class=HTMLResponse)
@router.api_route("/clock/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def signage_clock(request: Request):
    return templates.TemplateResponse(request, "demo-clock-atlas.html",
                                      {"demo": _scenario(CLOCK_SCENARIO), "demos": [], "signage": True}, headers=_HEADERS)


_ATLAS_FILES = {"player.js": PLAYER_FILE.with_name("demo-clock-atlas.js"),
                "weather.js": PLAYER_FILE.with_name("weather.js"), "map.json": ATLAS_MAP_FILE}


def _atlas_file(name: str):
    if name not in _ATLAS_FILES:
        raise HTTPException(404, "Not Found")
    return FileResponse(_ATLAS_FILES[name], headers=_HEADERS)


@router.api_route("/clock/{name}", methods=["GET", "HEAD"])
async def signage_clock_file(name: str):
    return _atlas_file(name)


# 列車とバスのどちらか片方だけを出すときの画面。時計「測量」の地図を背景に、発車案内を主役にする。
# controller は、片方だけがオンのとき交通情報の代わりに /transit/board/bus/ か /transit/board/train/ を出す。
BOARD_SCENARIOS = {"bus": "bus-atlas", "train": "train-atlas"}


@router.api_route("/board/{kind}", methods=["GET", "HEAD"], response_class=HTMLResponse)
@router.api_route("/board/{kind}/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def signage_board(kind: str, request: Request):
    if kind not in BOARD_SCENARIOS:
        raise HTTPException(404, "Not Found")
    return templates.TemplateResponse(request, "demo-clock-atlas.html",
                                      {"demo": _scenario(BOARD_SCENARIOS[kind]), "demos": [], "signage": True}, headers=_HEADERS)


@router.api_route("/board/{kind}/{name}", methods=["GET", "HEAD"])
async def signage_board_file(kind: str, name: str):
    if kind not in BOARD_SCENARIOS:
        raise HTTPException(404, "Not Found")
    return _atlas_file(name)


@router.api_route("/demo/{scenario_id}", methods=["GET", "HEAD"], response_class=HTMLResponse)
@router.api_route("/demo/{scenario_id}/", methods=["GET", "HEAD"], response_class=HTMLResponse)
async def display(scenario_id: str, request: Request):
    scenario = _scenario(scenario_id)
    if scenario["mode"] == "playground":
        return templates.TemplateResponse(request, "demo-playground.html",
                                          {"demo": scenario}, headers=_HEADERS)
    if scenario["mode"] == "intro":
        return templates.TemplateResponse(request, "demo-intro-atlas.html" if scenario.get("variant") == "atlas" else "demo-intro.html",
                                          {"demo": scenario, "demos": _catalog()}, headers=_HEADERS)
    if scenario["mode"] == "clock":
        return templates.TemplateResponse(request, "demo-clock-atlas.html",
                                          {"demo": scenario, "demos": _catalog()}, headers=_HEADERS)
    if scenario["mode"] == "chime":
        return templates.TemplateResponse(request, "demo-chime.html",
                                          {"demo": scenario, "demos": _catalog()}, headers=_HEADERS)
    if scenario["mode"] == "weather":
        return templates.TemplateResponse(request, "demo-weather.html",
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
