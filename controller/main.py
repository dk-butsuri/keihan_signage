import asyncio
import json
import os
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
display_clients: dict[int, datetime] = {}


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


def _transit_features() -> tuple[bool, bool]:
    """列車とバスがそれぞれオンか。管理画面と同じく、書かれていない項目はオンとみなす"""
    try:
        features = (yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8")) or {}).get("features") or {}
    except Exception:
        return True, True
    return features.get("trains", True) is not False, features.get("buses", True) is not False


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
    # 端末は build が変わったら画面を読み直す（version は人が読む番号）
    status["version"] = versions.version
    status["build"] = versions.build
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
        display_clients[id(queue)] = datetime.now()

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


@app.get("/api/displays")
async def get_displays():
    return {"count": len(display_clients),
            "connected_since": sorted(t.isoformat() for t in display_clients.values())}


# ホストが NTP で同期しているので、自前で NTP に問い合わせない（待つ間の分だけ表示が進んでいた）
@app.get("/api/time")
async def get_time():
    return JSONResponse(content={"ts": time.time()}, headers={"Cache-Control": "no-store"})



@app.get("/api/schedule")
async def get_schedule():
    return load_schedule()


@app.put("/api/schedule")
async def put_schedule(request: Request):
    _require_admin(request)
    data = await request.json()
    save_schedule(data)
    return data


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
