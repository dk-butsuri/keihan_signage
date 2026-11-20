import asyncio
import json
import os
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import AsyncGenerator, Optional

import httpx
import yaml

try:
    from version import VersionBook, code_hash
except ImportError:  # テストでは controller パッケージとして読み込む
    from controller.version import VersionBook, code_hash
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware

TRANSIT_URL = os.getenv("TRANSIT_URL", "http://transit:8000")
CLOCK_URL = os.getenv("CLOCK_URL", "http://clock:80")
# 未設定なら管理操作をすべて拒否する。既定のパスワードで動かさないため
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
DATA_DIR = Path(os.getenv("DATA_DIR", "/app/data"))
SCHEDULE_FILE = DATA_DIR / "schedule.json"
# バージョン（YYMMDD-N）の記録。controller と transit のプログラムが変わるたびに進む（version.py）
versions = VersionBook(DATA_DIR / "version.json")
CONFIG_FILE = Path(os.getenv("CONFIG_FILE", "/app/config.yml"))

VALID_MODES = {"transit", "clock"}
SERVICE_URLS = {"transit": TRANSIT_URL, "clock": CLOCK_URL}

app = FastAPI()
templates = Jinja2Templates(directory="templates")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

current_mode: str = "transit"
manual_override_until: Optional[datetime] = None
subscribers: list[asyncio.Queue] = []
display_clients: dict[int, dict] = {}
# 端末が自分で送ってくる画面・OSの情報。端末のタブごとの id で引く
display_info: dict[str, dict] = {}


def _require_admin(request: Request) -> None:
    if not ADMIN_TOKEN or request.headers.get("Authorization", "") != f"Bearer {ADMIN_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")


def load_schedule() -> dict:
    if SCHEDULE_FILE.exists():
        return json.loads(SCHEDULE_FILE.read_text(encoding="utf-8"))
    return {"default_mode": "transit", "rules": []}


def save_schedule(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SCHEDULE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# 季節の装飾（transit の templates/seasons/ のフォルダ名）。期間は月日で書き、毎年そのまま使う。
# override は None なら期間どおり、"off" なら出さない、装飾の名前ならそれを出し続ける
SEASON_FILE = DATA_DIR / "season.json"
DEFAULT_SEASONS = {"override": None, "periods": [{"id": "christmas", "from": "12-01", "to": "12-25"},
                                                 {"id": "shogatsu", "from": "01-01", "to": "01-03"}]}
_SEASON_ID = re.compile(r"[a-z0-9-]{1,32}")
_MONTH_DAY = re.compile(r"(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])")


def load_seasons() -> dict:
    try:
        return _valid_seasons(json.loads(SEASON_FILE.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return DEFAULT_SEASONS


def _valid_seasons(data) -> dict:
    if not isinstance(data, dict) or not isinstance(data.get("periods"), list):
        raise ValueError("periods must be a list")
    override = data.get("override")
    if override is not None and not (isinstance(override, str) and _SEASON_ID.fullmatch(override)):
        raise ValueError("override must be null, \"off\" or a season id")
    periods = []
    for period in data["periods"]:
        values = [period.get(key) for key in ("id", "from", "to")] if isinstance(period, dict) else [None]
        if not all(isinstance(value, str) for value in values):
            raise ValueError("each period needs id, from and to")
        if not (_SEASON_ID.fullmatch(values[0]) and _MONTH_DAY.fullmatch(values[1]) and _MONTH_DAY.fullmatch(values[2])):
            raise ValueError("id must be a season id, from and to must be MM-DD")
        periods.append(dict(zip(("id", "from", "to"), values)))
    return {"override": override, "periods": periods}


def active_season(data: dict, today: Optional[datetime] = None) -> Optional[str]:
    if data["override"]:
        return None if data["override"] == "off" else data["override"]
    day = (today or datetime.now()).strftime("%m-%d")
    for period in data["periods"]:
        start, end = period["from"], period["to"]
        # 年をまたぐ期間（12-28〜01-03 など）は、始まり以降か終わり以前
        if (start <= day <= end) if start <= end else (day >= start or day <= end):
            return period["id"]
    return None


def _features() -> dict:
    """表示する情報のオン・オフ。管理画面と同じく、書かれていない項目はオンとみなす"""
    try:
        features = (yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8")) or {}).get("features") or {}
    except Exception:
        features = {}
    return {key: features.get(key, True) is not False for key in ("trains", "buses", "delays", "weather")}


def _transit_features() -> tuple[bool, bool]:
    """列車とバスがそれぞれオンか"""
    features = _features()
    return features["trains"], features["buses"]


def _transit_disabled() -> bool:
    """列車とバスがどちらもオフなら、交通情報の画面に出すものがないので時計にする"""
    return _transit_features() == (False, False)


# 京阪が見合わせ時の画面（transit の /api/status の trains.suspended）になっているか。schedule_loop が30秒ごとに取り直す
keihan_suspended = False


async def _refresh_suspension() -> bool:
    """見合わせ時の画面かどうかを transit から取り直し、変わったら True を返す。取れないときは前の状態のまま。
    ついでに transit のプログラムのハッシュを読み、変わっていればバージョンを進めて端末に知らせる"""
    global keihan_suspended
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{TRANSIT_URL}/api/status")
        status = response.json()
        suspended = bool(status["trains"]["suspended"])
    except Exception:
        return False
    build = versions.build
    try:
        versions.note("transit", status.get("code_hash") or "")
    except OSError:
        pass
    changed = suspended != keihan_suspended
    keihan_suspended = suspended
    if versions.build != build:
        await broadcast_status()
    return changed


def _transit_view() -> str:
    """交通情報の時間帯に出す画面。
    両方オンならいつもの画面（full）。片方だけオンなら、その発車案内を主役にした画面（transit の /board/...）。
    ただし京阪が見合わせ時の画面になるときは、片方だけでも、その専用の画面を持ついつもの画面にする"""
    trains, buses = _transit_features()
    if keihan_suspended:
        return "full"
    if trains and not buses:
        return "train"
    if buses and not trains:
        return "bus"
    return "full"


def _mode_status() -> dict:
    now = datetime.now()
    if manual_override_until and now < manual_override_until:
        status = {
            "mode": current_mode,
            "source": "manual",
            "override_until": manual_override_until.isoformat(),
        }
    else:
        status = {"mode": current_mode, "source": "schedule", "override_until": None}
    # 予定・手動で決まった画面は scheduled_mode に残し、オフが解ければそちらに戻す
    status["scheduled_mode"] = current_mode
    status["transit_disabled"] = _transit_disabled()
    status["transit_view"] = _transit_view()
    status["features"] = _features()
    # 端末は build が変わったら画面を読み直す（version は人が読む番号）
    status["version"] = versions.version
    status["build"] = versions.build
    status["season"] = active_season(load_seasons())
    if status["transit_disabled"]:
        status["mode"] = "clock"
    return status


async def broadcast_status() -> None:
    payload = json.dumps(_mode_status())
    for q in subscribers:
        await q.put(payload)


async def _apply_schedule() -> None:
    global current_mode
    sched = load_schedule()
    now = datetime.now()
    now_str = f"{now.hour:02d}:{now.minute:02d}"
    matched_mode = sched.get("default_mode", "transit")
    for rule in sorted(sched.get("rules", []), key=lambda r: r["time"]):
        if rule["time"] <= now_str:
            matched_mode = rule["mode"]
    if matched_mode != current_mode:
        current_mode = matched_mode
    await broadcast_status()


async def schedule_loop() -> None:
    global manual_override_until
    while True:
        await asyncio.sleep(30)
        try:
            await _refresh_suspension()
            if manual_override_until and datetime.now() < manual_override_until:
                # 手動切り替え中も、列車・バスのオンオフを直接 config.yml で変えたときに端末へ届ける
                await broadcast_status()
                continue
            manual_override_until = None
            await _apply_schedule()
        except Exception:
            pass


@app.on_event("startup")
async def startup() -> None:
    global current_mode
    try:
        versions.note("controller", code_hash(Path(__file__).parent))
    except OSError:
        pass
    sched = load_schedule()
    current_mode = sched.get("default_mode", "transit")
    asyncio.create_task(schedule_loop())
    asyncio.create_task(_refresh_suspension())


@app.get("/", response_class=HTMLResponse)
async def display(request: Request):
    return templates.TemplateResponse("display.html", {"request": request})


SERVICE_WORKER = Path(__file__).parent / "sw.js"


# 範囲を / にするため、ルートから配る。build を埋め込むので、版が変わるとブラウザが新しい版に入れ替える
@app.get("/sw.js")
async def service_worker():
    return Response(content=SERVICE_WORKER.read_text(encoding="utf-8").replace("__BUILD__", versions.build),
                    media_type="text/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/admin", response_class=HTMLResponse)
async def admin(request: Request):
    return templates.TemplateResponse("admin.html", {"request": request})


@app.get("/api/version")
async def get_version():
    return versions.summary()


@app.get("/api/mode")
async def get_mode():
    return _mode_status()


@app.post("/api/mode")
async def set_mode(request: Request):
    _require_admin(request)
    body = await request.json()
    mode = body.get("mode")
    if mode not in VALID_MODES:
        raise HTTPException(status_code=400, detail=f"mode must be one of {VALID_MODES}")
    override_minutes = int(body.get("override_minutes", 60))
    global current_mode, manual_override_until
    current_mode = mode
    manual_override_until = datetime.now() + timedelta(minutes=override_minutes)
    await broadcast_status()
    return _mode_status()


@app.delete("/api/mode/override")
async def clear_override(request: Request):
    _require_admin(request)
    global manual_override_until
    manual_override_until = None
    await _apply_schedule()
    return _mode_status()


@app.get("/api/mode/stream")
async def mode_stream(request: Request):
    queue: asyncio.Queue = asyncio.Queue()
    subscribers.append(queue)
    # 管理画面以外の接続はすべて表示端末として数える（更新前に開いた端末は client を付けずに接続してくる）
    is_display = request.query_params.get("client") != "admin"
    if is_display:
        display_clients[id(queue)] = {"since": datetime.now(), "id": request.query_params.get("id", "")[:64]}

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            yield f"data: {json.dumps(_mode_status())}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=25)
                    yield f"data: {payload}\n\n"
                except asyncio.TimeoutError:
                    # コメント行だと端末の onmessage に届かず、途切れたことに気づけないので、名前付きのイベントで送る
                    yield "event: ping\ndata: {}\n\n"
        finally:
            subscribers.remove(queue)
            display_clients.pop(id(queue), None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/auth")
async def check_auth(request: Request):
    _require_admin(request)
    return Response(status_code=204)


def _display_groups() -> list[dict]:
    """つながっている端末を、タブごとの id でまとめる。
    Cloudflare 越しだと切れた接続がしばらく残るので、同じタブの接続は1台に数える（id を送らない古い端末は1本ずつ）"""
    groups: dict[str, dict] = {}
    for key, client in display_clients.items():
        group_key = client["id"] or f"conn-{key}"
        group = groups.setdefault(group_key, {"id": client["id"], "since": client["since"], "connections": 0})
        group["since"] = max(group["since"], client["since"])
        group["connections"] += 1
    return sorted(groups.values(), key=lambda g: g["since"])


def _is_admin(request: Request) -> bool:
    return bool(ADMIN_TOKEN) and request.headers.get("Authorization", "") == f"Bearer {ADMIN_TOKEN}"


@app.get("/api/displays")
async def get_displays(request: Request):
    groups = _display_groups()
    result = {"count": len(groups), "connected_since": [g["since"].isoformat() for g in groups]}
    # 画面やOSの情報は端末を特定する手がかりになるので、ログインした管理画面にだけ返す
    if _is_admin(request):
        result["clients"] = [{"since": g["since"].isoformat(), "connections": g["connections"],
                              **display_info.get(g["id"], {})} for g in groups]
    return result


def _numbers(value, count: int) -> Optional[list]:
    if not isinstance(value, list) or len(value) != count or not all(isinstance(v, (int, float)) and 0 <= v < 100000 for v in value):
        return None
    return value


def _ago(milliseconds) -> Optional[datetime]:
    if not isinstance(milliseconds, (int, float)) or not 0 <= milliseconds < 400 * 86400000:
        return None
    return datetime.now() - timedelta(milliseconds=milliseconds)


@app.post("/api/displays/info", status_code=204)
async def post_display_info(request: Request):
    body = await request.body()
    if len(body) > 4096:
        raise HTTPException(status_code=413, detail="too large")
    try:
        data = json.loads(body)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid json")
    if not isinstance(data, dict) or not isinstance(data.get("id"), str) or not data["id"]:
        raise HTTPException(status_code=400, detail="id is required")
    connected = {c["id"] for c in display_clients.values()}
    for key in [k for k, v in display_info.items() if k not in connected and datetime.now() - v["updated"] > timedelta(hours=1)]:
        display_info.pop(key, None)
    if data["id"][:64] not in display_info and len(display_info) >= 50:
        raise HTTPException(status_code=429, detail="too many displays")
    display_info[data["id"][:64]] = {
        "user_agent": request.headers.get("user-agent", "")[:300],
        "screen": _numbers(data.get("screen"), 2), "viewport": _numbers(data.get("viewport"), 2),
        "dpr": data.get("dpr") if isinstance(data.get("dpr"), (int, float)) and 0 < data["dpr"] < 20 else None,
        "platform": _text(data.get("platform"), 40), "platform_version": _text(data.get("platform_version"), 40),
        "model": _text(data.get("model"), 80), "browser": _text(data.get("browser"), 80),
        "language": _text(data.get("language"), 20), "updated": datetime.now(),
        "tab_started": _ago(data.get("tab_age_ms")), "page_loaded": _ago(data.get("page_age_ms")),
        "page": _text(data.get("page"), 100), "build": _text(data.get("build"), 40), "version": _text(data.get("version"), 40),
    }
    return Response(status_code=204)


# ホストが NTP で同期しているので、自前で NTP に問い合わせない（待つ間の分だけ表示が進んでいた）
@app.get("/api/time")
async def get_time():
    return JSONResponse(content={"ts": time.time()}, headers={"Cache-Control": "no-store"})



ERRORS_FILE = DATA_DIR / "errors.json"
ERRORS_KEEP = 100
ERROR_KINDS = {"error", "rejection", "resource", "offline"}
# 端末は認証なしで送ってくるので、外から大量に送られてもファイルが膨らまないよう、受け付ける量に上限を置く
ERROR_RATE_PER_MINUTE = 60
_error_times: list[float] = []


def load_errors() -> list[dict]:
    try:
        return json.loads(ERRORS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _text(value, limit: int) -> str:
    return str(value or "")[:limit]


@app.post("/api/errors", status_code=204)
async def report_errors(request: Request):
    body = await request.body()
    if len(body) > 32768:
        raise HTTPException(status_code=413, detail="too large")
    try:
        reports = json.loads(body)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid json")
    if not isinstance(reports, list):
        raise HTTPException(status_code=400, detail="must be a list")
    now = time.time()
    _error_times[:] = [t for t in _error_times if now - t < 60]
    room = ERROR_RATE_PER_MINUTE - len(_error_times)
    if room <= 0:
        raise HTTPException(status_code=429, detail="too many reports")
    items = load_errors()
    by_key = {(i["kind"], i["message"], i["source"], i["page"]): i for i in items}
    stamp = datetime.now().isoformat(timespec="seconds")
    for report in reports[:min(20, room)]:
        if not isinstance(report, dict) or report.get("kind") not in ERROR_KINDS:
            continue
        _error_times.append(now)
        key = (report["kind"], _text(report.get("message"), 300), _text(report.get("source"), 200), _text(report.get("page"), 100))
        count = report.get("count")
        count = count if isinstance(count, int) and 0 < count < 10000 else 1
        item = by_key.get(key)
        if item is None:
            item = by_key[key] = {"kind": key[0], "message": key[1], "source": key[2], "page": key[3], "count": 0, "first": stamp}
        item["count"] += count
        item["last"] = stamp
        item["build"] = _text(report.get("build"), 20)
        item["detail"] = _text(report.get("detail"), 500)
    kept = sorted(by_key.values(), key=lambda i: i["last"], reverse=True)[:ERRORS_KEEP]
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ERRORS_FILE.write_text(json.dumps(kept, ensure_ascii=False, indent=1), encoding="utf-8")
    return Response(status_code=204)


@app.get("/api/errors")
async def get_errors():
    return {"items": load_errors()}


@app.delete("/api/errors", status_code=204)
async def clear_errors(request: Request):
    _require_admin(request)
    ERRORS_FILE.unlink(missing_ok=True)
    return Response(status_code=204)


@app.get("/api/schedule")
async def get_schedule():
    return load_schedule()


@app.put("/api/schedule")
async def put_schedule(request: Request):
    _require_admin(request)
    data = await request.json()
    save_schedule(data)
    return data


@app.get("/api/season")
async def get_season():
    data = load_seasons()
    return {**data, "active": active_season(data)}


@app.put("/api/season")
async def put_season(request: Request):
    _require_admin(request)
    try:
        data = _valid_seasons(await request.json())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SEASON_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    await broadcast_status()
    return {**data, "active": active_season(data)}


@app.get("/api/config")
async def get_config():
    if not CONFIG_FILE.exists():
        raise HTTPException(status_code=404, detail="config.yml not found")
    return Response(content=CONFIG_FILE.read_text(encoding="utf-8"), media_type="text/plain; charset=utf-8")


@app.get("/api/config/json")
async def get_config_json():
    if not CONFIG_FILE.exists():
        raise HTTPException(status_code=404, detail="config.yml not found")
    return yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8"))


@app.put("/api/config")
async def put_config(request: Request):
    _require_admin(request)
    text = (await request.body()).decode("utf-8")
    try:
        yaml.safe_load(text)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")
    return await _write_config(text)


@app.put("/api/config/json")
async def put_config_json(request: Request):
    _require_admin(request)
    data = await request.json()
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="config must be an object")
    return await _write_config(yaml.safe_dump(data, allow_unicode=True, sort_keys=False))


async def _write_config(text: str) -> dict:
    # config.yml はファイル単位の bind mount なので、置き換えずに中身だけ書き換える（inode を保つ）
    with CONFIG_FILE.open("r+", encoding="utf-8") as f:
        f.seek(0)
        f.write(text)
        f.truncate()
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{TRANSIT_URL}/api/config/reload")
        reloaded = True
    except Exception:
        reloaded = False
    # 列車・バスをオフにしたら30秒を待たずに時計へ切り替える
    await broadcast_status()
    return {"ok": True, "reloaded": reloaded}


async def _proxy(target_base: str, path: str, request: Request) -> Response:
    url = f"{target_base}/{path}"
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.request(
                method=request.method,
                url=url,
                params=request.query_params.multi_items(),
                headers={k: v for k, v in request.headers.items() if k.lower() != "host"},
                content=await request.body(),
            )
            excluded = {"transfer-encoding", "connection"}
            headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}
            return Response(content=resp.content, status_code=resp.status_code, headers=headers)
        except httpx.RequestError:
            raise HTTPException(status_code=502, detail="Upstream unreachable")


@app.api_route("/demo", methods=["GET", "HEAD"])
@app.api_route("/demo/", methods=["GET", "HEAD"])
async def proxy_demo_root(request: Request):
    return await _proxy(TRANSIT_URL, "demo", request)


@app.post("/demo/playground/evaluate")
async def proxy_playground_evaluate(request: Request):
    return await _proxy(TRANSIT_URL, "demo/playground/evaluate", request)


@app.api_route("/demo/{path:path}", methods=["GET", "HEAD"])
async def proxy_demo(path: str, request: Request):
    return await _proxy(TRANSIT_URL, f"demo/{path}", request)


@app.api_route("/transit/{path:path}", methods=["GET", "HEAD", "POST"])
async def proxy_transit(path: str, request: Request):
    return await _proxy(TRANSIT_URL, path, request)


@app.api_route("/transit", methods=["GET", "HEAD", "POST"])
@app.api_route("/transit/", methods=["GET", "HEAD", "POST"])
async def proxy_transit_root(request: Request):
    return await _proxy(TRANSIT_URL, "", request)


@app.api_route("/clock/{path:path}", methods=["GET", "HEAD", "POST"])
async def proxy_clock(path: str, request: Request):
    return await _proxy(CLOCK_URL, path, request)


@app.api_route("/clock", methods=["GET", "HEAD", "POST"])
@app.api_route("/clock/", methods=["GET", "HEAD", "POST"])
async def proxy_clock_root(request: Request):
    return await _proxy(CLOCK_URL, "", request)
