import asyncio
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import AsyncGenerator, Optional

import httpx
import yaml
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from time_sync import get_ntp_time

TRANSIT_URL = os.getenv("TRANSIT_URL", "http://transit:8000")
CLOCK_URL = os.getenv("CLOCK_URL", "http://clock:80")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "changeme")
DATA_DIR = Path(os.getenv("DATA_DIR", "/app/data"))
SCHEDULE_FILE = DATA_DIR / "schedule.json"
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


def load_schedule() -> dict:
    if SCHEDULE_FILE.exists():
        return json.loads(SCHEDULE_FILE.read_text(encoding="utf-8"))
    return {"default_mode": "transit", "rules": []}


def save_schedule(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SCHEDULE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _mode_status() -> dict:
    now = datetime.now()
    if manual_override_until and now < manual_override_until:
        return {
            "mode": current_mode,
            "source": "manual",
            "override_until": manual_override_until.isoformat(),
        }
    return {"mode": current_mode, "source": "schedule", "override_until": None}


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
            if manual_override_until and datetime.now() < manual_override_until:
                continue
            manual_override_until = None
            await _apply_schedule()
        except Exception:
            pass


@app.on_event("startup")
async def startup() -> None:
    global current_mode
    sched = load_schedule()
    current_mode = sched.get("default_mode", "transit")
    asyncio.create_task(schedule_loop())


@app.get("/", response_class=HTMLResponse)
async def display(request: Request):
    return templates.TemplateResponse("display.html", {"request": request})


@app.get("/admin", response_class=HTMLResponse)
async def admin(request: Request):
    return templates.TemplateResponse("admin.html", {"request": request})


@app.get("/api/mode")
async def get_mode():
    return _mode_status()


@app.post("/api/mode")
async def set_mode(request: Request):
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {ADMIN_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")
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
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {ADMIN_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    global manual_override_until
    manual_override_until = None
    await _apply_schedule()
    return _mode_status()


@app.get("/api/mode/stream")
async def mode_stream(request: Request):
    queue: asyncio.Queue = asyncio.Queue()
    subscribers.append(queue)

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
                    yield ": keepalive\n\n"
        finally:
            subscribers.remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/time")
async def get_time():
    from fastapi.responses import JSONResponse
    data = await asyncio.to_thread(get_ntp_time)
    return JSONResponse(content=data, headers={"Cache-Control": "no-store"})



@app.get("/api/schedule")
async def get_schedule():
    return load_schedule()


@app.put("/api/schedule")
async def put_schedule(request: Request):
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {ADMIN_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")
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
    auth = request.headers.get("Authorization", "")
    if auth != f"Bearer {ADMIN_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    text = (await request.body()).decode("utf-8")
    try:
        yaml.safe_load(text)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")
    CONFIG_FILE.write_text(text, encoding="utf-8")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{TRANSIT_URL}/api/config/reload")
        reloaded = True
    except Exception:
        reloaded = False
    return {"ok": True, "reloaded": reloaded}


async def _proxy(target_base: str, path: str, request: Request) -> Response:
    url = f"{target_base}/{path}"
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.request(
                method=request.method,
                url=url,
                headers={k: v for k, v in request.headers.items() if k.lower() != "host"},
                content=await request.body(),
            )
            excluded = {"transfer-encoding", "connection"}
            headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}
            return Response(content=resp.content, status_code=resp.status_code, headers=headers)
        except httpx.RequestError:
            raise HTTPException(status_code=502, detail="Upstream unreachable")


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
